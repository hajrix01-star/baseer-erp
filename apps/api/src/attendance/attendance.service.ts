import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import type { ApproveAttendanceRosterRequest, ArchiveAttendanceScheduleTemplateRequest, AssignAttendanceEmployeeScheduleRequest, AssignAttendanceEmployeesScheduleRequest, AttendanceEmployeePortalSessionRequest, AttendanceEmployeeRecordRequest, ConfigureAttendanceEmployeeScheduleRequest, CreateAttendanceBranchRequest, CreateAttendanceScheduleExceptionRequest, CreateAttendanceScheduleTemplateRequest, CreateAttendanceScheduleVersionRequest, DecideAttendanceScheduleExceptionRequest, SaveAttendanceRosterDraftRequest, SetAttendanceEmployeePinRequest, SetAttendanceEmployeeWeeklyAdjustmentRequest, UpdateAttendanceBranchRequest, UpdateAttendanceScheduleTemplateRequest } from '@baseer-erp/contracts';
import { AttendanceEventType, AttendanceRosterApprovalMode, AttendanceRosterPlanStatus, AttendanceScheduleExceptionStatus, AttendanceScheduleTemplateStatus, AttendanceWeeklyAdjustmentKind, AttendanceWorkSessionStatus, HrEmployeeStatus, Prisma } from '../generated/prisma/client.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { hashPassword, verifyPassword } from '../identity/password.util.js';

@Injectable()
export class AttendanceService {
  constructor(private readonly database: DatabaseService) {}

  /** All manager-facing attendance operations are deliberately restricted to
   * the tenant owner or the designated company manager, even where a broader
   * capability could otherwise be granted to another role. */
  async assertManagementAuthority(context: TrustedCompanyActorContext) {
    await this.database.inTenantTransaction(context.tenantId, (tx) => this.assertPinDisplayAuthority(tx, context));
  }

  async setEmployeePin(context: TrustedCompanyActorContext, input: SetAttendanceEmployeePinRequest) {
    const pinHash = await hashPassword(input.pin);
    const pinLookupHash = this.pinLookup(context.companyId, input.pin);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const employee = await tx.hrEmployee.findFirst({ where: { id: input.employeeId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] } }, select: { id: true } });
      if (!employee) throw new BadRequestException('Choose an active employee from this company.');
      const clash = await tx.attendanceEmployeeCredential.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, pinLookupHash, employeeId: { not: employee.id } }, select: { id: true } });
      if (clash) throw new ConflictException('This four-digit attendance PIN is already assigned in this company.');
      const pinCiphertext = this.encryptPin(input.pin);
      await tx.attendanceEmployeeCredential.upsert({ where: { companyId_employeeId: { companyId: context.companyId, employeeId: employee.id } }, create: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId: employee.id, pinHash, pinLookupHash, pinCiphertext }, update: { pinHash, pinLookupHash, pinCiphertext, failedAttempts: 0, lockedUntil: null, rotatedAt: new Date() } });
      await this.audit(tx, context, 'attendance.employee_pin.set', 'AttendanceEmployeeCredential', employee.id, { employeeId: employee.id, pinRotated: true });
      return { employeeId: employee.id, replayed: false };
    });
  }

  async createBranch(context: TrustedCompanyActorContext, input: CreateAttendanceBranchRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const id = randomUUID();
      const branch = await tx.attendanceBranch.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, ...branchInput(input) } });
      await this.audit(tx, context, 'attendance.branch.created', 'AttendanceBranch', id, mapBranch(branch));
      return { branch: mapBranch(branch), replayed: false };
    });
  }

  async employeePinDisplay(context: TrustedCompanyActorContext, employeeId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.assertPinDisplayAuthority(tx, context);
      const credential = await tx.attendanceEmployeeCredential.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId }, select: { pinCiphertext: true } });
      if (!credential) return { employeeId, state: 'NOT_SET' as const, pin: null };
      if (!credential.pinCiphertext) return { employeeId, state: 'RESET_REQUIRED' as const, pin: null };
      return { employeeId, state: 'SET' as const, pin: this.decryptPin(credential.pinCiphertext) };
    });
  }

  async updateBranch(context: TrustedCompanyActorContext, input: UpdateAttendanceBranchRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const previous = await tx.attendanceBranch.findFirst({ where: { id: input.branchId, tenantId: context.tenantId, companyId: context.companyId } });
      if (!previous) throw new NotFoundException('Attendance branch was not found.');
      const branch = await tx.attendanceBranch.update({ where: { id: previous.id }, data: { ...branchInput(input), ...(input.isActive === undefined ? {} : { isActive: input.isActive }) } });
      await this.audit(tx, context, 'attendance.branch.updated', 'AttendanceBranch', branch.id, { before: mapBranch(previous), after: mapBranch(branch) });
      return { branch: mapBranch(branch), replayed: false };
    });
  }

  async listBranches(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => (await tx.attendanceBranch.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: { nameAr: 'asc' } })).map(mapBranch));
  }

  async listScheduleTemplates(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const templates = await tx.attendanceScheduleTemplate.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        include: { versions: { include: { periods: true }, orderBy: { effectiveFrom: 'desc' } } },
        orderBy: [{ status: 'asc' }, { nameAr: 'asc' }],
      });
      return templates.map(mapScheduleTemplate);
    });
  }

  async createScheduleTemplate(context: TrustedCompanyActorContext, input: CreateAttendanceScheduleTemplateRequest) {
    const periods = normalizeWeeklyPeriods(input.periods);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const templateId = randomUUID(); const versionId = randomUUID();
      await tx.attendanceScheduleTemplate.create({ data: { id: templateId, tenantId: context.tenantId, companyId: context.companyId, nameAr: input.nameAr, nameEn: input.nameEn ?? null } });
      await tx.attendanceScheduleTemplateVersion.create({ data: { id: versionId, tenantId: context.tenantId, companyId: context.companyId, templateId, versionNumber: 1, effectiveFrom: businessDateValue(input.effectiveFrom), createdByUserId: context.actorUserId } });
      await tx.attendanceSchedulePeriod.createMany({ data: periods.map((period) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, versionId, ...period })) });
      const template = await tx.attendanceScheduleTemplate.findFirstOrThrow({ where: { id: templateId }, include: { versions: { include: { periods: true } } } });
      await this.audit(tx, context, 'attendance.schedule_template.created', 'AttendanceScheduleTemplate', templateId, { effectiveFrom: input.effectiveFrom, periods: periods.length });
      return { template: mapScheduleTemplate(template), replayed: false };
    });
  }

  /** Renaming is safe; working-time rules are changed only through a new
   * effective-dated immutable version. */
  async updateScheduleTemplate(context: TrustedCompanyActorContext, input: UpdateAttendanceScheduleTemplateRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const previous = await tx.attendanceScheduleTemplate.findFirst({ where: { id: input.templateId, tenantId: context.tenantId, companyId: context.companyId } });
      if (!previous) throw new NotFoundException('Attendance schedule template was not found.');
      if (previous.status === AttendanceScheduleTemplateStatus.ARCHIVED) throw new ConflictException('Archived schedule templates cannot be renamed.');
      const template = await tx.attendanceScheduleTemplate.update({ where: { id: previous.id }, data: { nameAr: input.nameAr, ...(input.nameEn === undefined ? {} : { nameEn: input.nameEn }) }, include: { versions: { include: { periods: true }, orderBy: { effectiveFrom: 'desc' } } } });
      await this.audit(tx, context, 'attendance.schedule_template.renamed', 'AttendanceScheduleTemplate', template.id, { before: { nameAr: previous.nameAr, nameEn: previous.nameEn }, after: { nameAr: template.nameAr, nameEn: template.nameEn } });
      return { template: mapScheduleTemplate(template), replayed: false };
    });
  }

  async createScheduleVersion(context: TrustedCompanyActorContext, input: CreateAttendanceScheduleVersionRequest) {
    const periods = normalizeWeeklyPeriods(input.periods);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const template = await tx.attendanceScheduleTemplate.findFirst({ where: { id: input.templateId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, status: true } });
      if (!template) throw new NotFoundException('Attendance schedule template was not found.');
      if (template.status !== AttendanceScheduleTemplateStatus.ACTIVE) throw new ConflictException('A new version requires an active schedule template.');
      const existing = await tx.attendanceScheduleTemplateVersion.findFirst({ where: { templateId: template.id, effectiveFrom: businessDateValue(input.effectiveFrom) }, select: { id: true } });
      if (existing) throw new ConflictException('A schedule version already starts on this effective date.');
      const latest = await tx.attendanceScheduleTemplateVersion.aggregate({ where: { templateId: template.id }, _max: { versionNumber: true } });
      const versionId = randomUUID();
      await tx.attendanceScheduleTemplateVersion.create({ data: { id: versionId, tenantId: context.tenantId, companyId: context.companyId, templateId: template.id, versionNumber: (latest._max.versionNumber ?? 0) + 1, effectiveFrom: businessDateValue(input.effectiveFrom), createdByUserId: context.actorUserId } });
      await tx.attendanceSchedulePeriod.createMany({ data: periods.map((period) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, versionId, ...period })) });
      const version = await tx.attendanceScheduleTemplateVersion.findFirstOrThrow({ where: { id: versionId }, include: { periods: true } });
      await this.audit(tx, context, 'attendance.schedule_template.version_created', 'AttendanceScheduleTemplateVersion', version.id, { templateId: template.id, versionNumber: version.versionNumber, effectiveFrom: input.effectiveFrom, periods: periods.length });
      return { version: mapScheduleVersion(version), replayed: false };
    });
  }

  async archiveScheduleTemplate(context: TrustedCompanyActorContext, input: ArchiveAttendanceScheduleTemplateRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const template = await tx.attendanceScheduleTemplate.findFirst({ where: { id: input.templateId, tenantId: context.tenantId, companyId: context.companyId } });
      if (!template) throw new NotFoundException('Attendance schedule template was not found.');
      if (template.status === AttendanceScheduleTemplateStatus.ARCHIVED) return { templateId: template.id, archived: true, replayed: true };
      await tx.attendanceScheduleTemplate.update({ where: { id: template.id }, data: { status: AttendanceScheduleTemplateStatus.ARCHIVED, archivedAt: new Date() } });
      await this.audit(tx, context, 'attendance.schedule_template.archived', 'AttendanceScheduleTemplate', template.id, { templateId: template.id });
      return { templateId: template.id, archived: true, replayed: false };
    });
  }

  async assignEmployeeSchedule(context: TrustedCompanyActorContext, input: AssignAttendanceEmployeeScheduleRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const { assignments } = await this.createEmployeeScheduleAssignments(tx, context, {
        employeeIds: [input.employeeId],
        templateId: input.templateId,
        effectiveFromText: input.effectiveFrom,
        source: 'employee',
      });
      const assignment = await tx.attendanceEmployeeScheduleAssignment.findFirstOrThrow({
        where: { id: assignments[0]!.id, tenantId: context.tenantId, companyId: context.companyId },
        include: { template: { select: { nameAr: true, nameEn: true } } },
      });
      return { assignment: mapAssignment(assignment), replayed: false };
    });
  }

  /** A template-side assignment is all-or-nothing: managers never see a partly assigned group. */
  async assignEmployeesSchedule(context: TrustedCompanyActorContext, input: AssignAttendanceEmployeesScheduleRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.createEmployeeScheduleAssignments(tx, context, {
        employeeIds: input.employeeIds,
        templateId: input.templateId,
        effectiveFromText: input.effectiveFrom,
        source: 'template',
      });
      return { assignedEmployeeIds: input.employeeIds, effectiveFrom: input.effectiveFrom, replayed: false };
    });
  }

  /** Employee-file setup commits the work template and personal weekly rule together. */
  async configureEmployeeSchedule(context: TrustedCompanyActorContext, input: ConfigureAttendanceEmployeeScheduleRequest) {
    const periods = normalizeDailyPeriods(input.weeklyAdjustment.periods);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const effectiveFrom = businessDateValue(input.effectiveFrom);
      await this.assertActiveEmployee(tx, context, input.employeeId);
      const [template, assignmentClash, adjustmentClash] = await Promise.all([
        tx.attendanceScheduleTemplate.findFirst({ where: { id: input.templateId, tenantId: context.tenantId, companyId: context.companyId, status: AttendanceScheduleTemplateStatus.ACTIVE }, select: { id: true } }),
        tx.attendanceEmployeeScheduleAssignment.findFirst({ where: { employeeId: input.employeeId, effectiveFrom }, select: { id: true } }),
        tx.attendanceEmployeeWeeklyAdjustment.findFirst({ where: { employeeId: input.employeeId, dayOfWeek: input.weeklyAdjustment.dayOfWeek, effectiveFrom }, select: { id: true } }),
      ]);
      if (!template) throw new BadRequestException('Choose an active schedule template from this company.');
      if (assignmentClash || adjustmentClash) throw new ConflictException('A work schedule or weekly adjustment already starts on this date.');
      const assignmentId = randomUUID(); const adjustmentId = randomUUID();
      await tx.attendanceEmployeeScheduleAssignment.create({ data: { id: assignmentId, tenantId: context.tenantId, companyId: context.companyId, employeeId: input.employeeId, templateId: template.id, effectiveFrom, createdByUserId: context.actorUserId } });
      await tx.attendanceEmployeeWeeklyAdjustment.create({ data: { id: adjustmentId, tenantId: context.tenantId, companyId: context.companyId, employeeId: input.employeeId, dayOfWeek: input.weeklyAdjustment.dayOfWeek, effectiveFrom, kind: input.weeklyAdjustment.kind as AttendanceWeeklyAdjustmentKind, createdByUserId: context.actorUserId, periods: { create: periods.map((period) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, ...period })) } } });
      await Promise.all([
        this.audit(tx, context, 'attendance.employee_schedule.configured', 'AttendanceEmployeeScheduleAssignment', assignmentId, { employeeId: input.employeeId, templateId: template.id, effectiveFrom: input.effectiveFrom }),
        this.audit(tx, context, 'attendance.employee_weekly_adjustment.created', 'AttendanceEmployeeWeeklyAdjustment', adjustmentId, { employeeId: input.employeeId, dayOfWeek: input.weeklyAdjustment.dayOfWeek, effectiveFrom: input.effectiveFrom, kind: input.weeklyAdjustment.kind }),
      ]);
      return { employeeId: input.employeeId, effectiveFrom: input.effectiveFrom, replayed: false };
    });
  }

  async setEmployeeWeeklyAdjustment(context: TrustedCompanyActorContext, input: SetAttendanceEmployeeWeeklyAdjustmentRequest) {
    const periods = normalizeDailyPeriods(input.periods);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.assertActiveEmployee(tx, context, input.employeeId);
      const effectiveFrom = businessDateValue(input.effectiveFrom);
      const clash = await tx.attendanceEmployeeWeeklyAdjustment.findFirst({ where: { employeeId: input.employeeId, dayOfWeek: input.dayOfWeek, effectiveFrom }, select: { id: true } });
      if (clash) throw new ConflictException('A weekly adjustment already starts for this employee, weekday and date.');
      const adjustment = await tx.attendanceEmployeeWeeklyAdjustment.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId: input.employeeId, dayOfWeek: input.dayOfWeek, effectiveFrom, kind: input.kind as AttendanceWeeklyAdjustmentKind, createdByUserId: context.actorUserId, periods: { create: periods.map((period) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, ...period })) } }, include: { periods: true } });
      await this.audit(tx, context, 'attendance.employee_weekly_adjustment.created', 'AttendanceEmployeeWeeklyAdjustment', adjustment.id, { employeeId: input.employeeId, dayOfWeek: input.dayOfWeek, effectiveFrom: input.effectiveFrom, kind: input.kind });
      return { adjustment: mapWeeklyAdjustment(adjustment), replayed: false };
    });
  }

  async createScheduleException(context: TrustedCompanyActorContext, input: CreateAttendanceScheduleExceptionRequest) {
    const periods = normalizeDailyPeriods(input.periods);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.assertActiveEmployee(tx, context, input.employeeId);
      const businessDate = businessDateValue(input.businessDate);
      const existing = await tx.attendanceScheduleException.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: input.employeeId, businessDate, status: { in: [AttendanceScheduleExceptionStatus.PENDING, AttendanceScheduleExceptionStatus.APPROVED] } }, select: { id: true } });
      if (existing) throw new ConflictException('A pending or approved schedule exception already exists for this employee and date.');
      const exception = await tx.attendanceScheduleException.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId: input.employeeId, businessDate, kind: input.kind as AttendanceWeeklyAdjustmentKind, reason: input.reason, requestedByUserId: context.actorUserId, periods: { create: periods.map((period) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, ...period })) } }, include: { periods: true } });
      await this.audit(tx, context, 'attendance.schedule_exception.requested', 'AttendanceScheduleException', exception.id, { employeeId: input.employeeId, businessDate: input.businessDate, kind: input.kind });
      return { exception: mapScheduleException(exception), replayed: false };
    });
  }

  async decideScheduleException(context: TrustedCompanyActorContext, input: DecideAttendanceScheduleExceptionRequest) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const exception = await tx.attendanceScheduleException.findFirst({ where: { id: input.exceptionId, tenantId: context.tenantId, companyId: context.companyId }, include: { periods: true } });
      if (!exception) throw new NotFoundException('Attendance schedule exception was not found.');
      if (exception.status !== AttendanceScheduleExceptionStatus.PENDING) throw new ConflictException('Only pending schedule exceptions can be decided.');
      const status = input.decision === 'APPROVE' ? AttendanceScheduleExceptionStatus.APPROVED : input.decision === 'REJECT' ? AttendanceScheduleExceptionStatus.REJECTED : AttendanceScheduleExceptionStatus.CANCELLED;
      const decided = await tx.attendanceScheduleException.update({ where: { id: exception.id }, data: { status, decidedByUserId: context.actorUserId, decidedAt: new Date(), decisionNote: input.decisionNote ?? null }, include: { periods: true } });
      await this.audit(tx, context, `attendance.schedule_exception.${input.decision.toLowerCase()}`, 'AttendanceScheduleException', decided.id, { employeeId: decided.employeeId, businessDate: riyadhDate(decided.businessDate), decision: input.decision });
      return { exception: mapScheduleException(decided), replayed: false };
    });
  }

  /** The interactive editor reads one seven-day roster at a time. A draft is
   * deliberately local to this manager workflow; when there is no draft we
   * project the effective schedule rather than fabricating schedule records. */
  async roster(context: TrustedCompanyActorContext, requestedWeekStart?: string) {
    const weekStart = sundayAtOrBefore(requestedWeekStart ?? riyadhDate(new Date()));
    const days = businessDates(weekStart, addBusinessDays(weekStart, 6));
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [employees, draft] = await Promise.all([
        tx.hrEmployee.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: HrEmployeeStatus.ACTIVE }, select: { id: true, employeeNumber: true, nameAr: true, nameEn: true }, orderBy: [{ employeeNumber: 'asc' }, { id: 'asc' }] }),
        tx.attendanceRosterPlan.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, weekStart: businessDateValue(weekStart), status: AttendanceRosterPlanStatus.DRAFT }, include: { entries: { include: { periods: { orderBy: { startMinute: 'asc' } } } }, peakPeriods: { orderBy: [{ businessDate: 'asc' }, { startMinute: 'asc' }] } }, orderBy: { updatedAt: 'desc' } }),
      ]);
      const draftEntries = new Map((draft?.entries ?? []).map((entry) => [`${entry.employeeId}:${riyadhDate(entry.businessDate)}`, entry]));
      const effectiveSchedules = await this.resolveEffectiveSchedules(tx, context, employees.map((employee) => employee.id), days);
      const rosterEmployees = await Promise.all(employees.map(async (employee) => ({
        employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn,
        entries: await Promise.all(days.map(async (day) => {
          const draftEntry = draftEntries.get(`${employee.id}:${day}`);
          if (draftEntry) return mapRosterEntry(draftEntry);
          const effective = effectiveSchedules.get(scheduleResolutionKey(employee.id, day))!;
          return { employeeId: employee.id, businessDate: day, kind: effective.periods.length ? 'CUSTOM_PERIODS' as const : 'FULL_REST' as const, periods: effective.periods.map((period) => ({ startMinute: toMinute(period.startTime), endMinute: toMinute(period.endTime), endsNextDay: period.endsNextDay })) };
        })),
      })));
      return {
        weekStart, days,
        plan: draft ? mapRosterPlan(draft) : null,
        employees: rosterEmployees,
        peakPeriods: (draft?.peakPeriods ?? []).map((period) => ({ businessDate: riyadhDate(period.businessDate), startMinute: period.startMinute, endMinute: period.endMinute })),
      };
    });
  }

  /** Saving only persists a draft snapshot. It cannot alter a published
   * schedule, attendance evidence, payroll, or a historical employee file. */
  async saveRosterDraft(context: TrustedCompanyActorContext, input: SaveAttendanceRosterDraftRequest) {
    const weekStart = sundayAtOrBefore(input.weekStart);
    if (weekStart !== input.weekStart) throw new BadRequestException('Attendance roster weeks must start on Sunday.');
    const days = new Set(businessDates(weekStart, addBusinessDays(weekStart, 6)));
    const entries = normalizeRosterEntries(input.entries, days);
    const peakPeriods = normalizeRosterPeakPeriods(input.peakPeriods, days);
    await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      // There is intentionally no unique draft-plan constraint: approved plans
      // may share a week. Serialize only this company's mutable draft slot so
      // two managers cannot both create or replace it at the same time.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance-roster-draft:${context.tenantId}:${context.companyId}:${weekStart}`}, 0))`;
      const employeeIds = [...new Set(entries.map((entry) => entry.employeeId))];
      const activeEmployees = await tx.hrEmployee.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, id: { in: employeeIds }, status: HrEmployeeStatus.ACTIVE }, select: { id: true } });
      if (activeEmployees.length !== employeeIds.length) throw new BadRequestException('A roster draft may only contain active employees from this company.');
      const existing = await tx.attendanceRosterPlan.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, weekStart: businessDateValue(weekStart), status: AttendanceRosterPlanStatus.DRAFT }, orderBy: { updatedAt: 'desc' } });
      const expectedRevision = existing ? (input.baseRevision ?? existing.revision) : undefined;
      if (existing && input.baseRevision !== undefined && existing.revision !== input.baseRevision) throw new ConflictException('This roster was changed by another manager. Reload it before saving.');
      const plan = existing
        ? await this.updateRosterDraftRevision(tx, context, existing.id, expectedRevision!)
        : await tx.attendanceRosterPlan.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, weekStart: businessDateValue(weekStart), createdByUserId: context.actorUserId } });
      if (existing) {
        await tx.attendanceRosterPeakPeriod.deleteMany({ where: { tenantId: context.tenantId, companyId: context.companyId, planId: plan.id } });
        await tx.attendanceRosterEntryPeriod.deleteMany({ where: { tenantId: context.tenantId, companyId: context.companyId, entry: { planId: plan.id } } });
        await tx.attendanceRosterEntry.deleteMany({ where: { tenantId: context.tenantId, companyId: context.companyId, planId: plan.id } });
      }
      for (const entry of entries) await tx.attendanceRosterEntry.create({ data: {
        id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, planId: plan.id, employeeId: entry.employeeId, businessDate: businessDateValue(entry.businessDate), kind: entry.kind as AttendanceWeeklyAdjustmentKind,
        periods: { create: entry.periods.map((period) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, ...period })) },
      } });
      if (peakPeriods.length) await tx.attendanceRosterPeakPeriod.createMany({ data: peakPeriods.map((period) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, planId: plan.id, businessDate: businessDateValue(period.businessDate), startMinute: period.startMinute, endMinute: period.endMinute })) });
      await this.audit(tx, context, 'attendance.roster.draft_saved', 'AttendanceRosterPlan', plan.id, { weekStart, revision: plan.revision, entries: entries.length, peakPeriods: peakPeriods.length, requestKey: input.idempotencyKey });
    });
    return this.roster(context, weekStart);
  }

  /** Approval is the only point at which a draft changes an effective work
   * schedule. The mode is explicit so a weekly plan can never accidentally
   * become a permanent employee-file change. */
  async approveRoster(context: TrustedCompanyActorContext, input: ApproveAttendanceRosterRequest) {
    const weekStart = await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const plan = await tx.attendanceRosterPlan.findFirst({ where: { id: input.planId, tenantId: context.tenantId, companyId: context.companyId }, include: { entries: { include: { periods: { orderBy: { startMinute: 'asc' } } } } } });
      if (!plan) throw new NotFoundException('Attendance roster draft was not found.');
      if (plan.status !== AttendanceRosterPlanStatus.DRAFT) throw new ConflictException('Only a current draft can be approved.');
      if (plan.revision !== input.baseRevision) throw new ConflictException('This roster was changed by another manager. Reload it before approving.');
      const effectiveFromText = input.effectiveFrom ?? riyadhDate(plan.weekStart);
      const planWeekStart = riyadhDate(plan.weekStart);
      if (input.mode === 'WEEK' && effectiveFromText !== planWeekStart) {
        throw new BadRequestException('A weekly roster must take effect on its own week start.');
      }
      const effectiveFrom = businessDateValue(effectiveFromText);
      const effectiveUntil = input.mode === 'WEEK' ? businessDateValue(addBusinessDays(effectiveFromText, 6)) : input.mode === 'TEMPORARY' ? businessDateValue(addBusinessDays(effectiveFromText, input.temporaryDays! - 1)) : null;
      if (input.mode === 'TEMPORARY') {
        const source = rosterEntriesByEmployeeWeekday(plan.entries);
        await tx.attendanceRosterEntryPeriod.deleteMany({ where: { tenantId: context.tenantId, companyId: context.companyId, entry: { planId: plan.id } } });
        await tx.attendanceRosterEntry.deleteMany({ where: { tenantId: context.tenantId, companyId: context.companyId, planId: plan.id } });
        const targetDates = businessDates(effectiveFromText, riyadhDate(effectiveUntil!));
        for (const [employeeId, byWeekday] of source) for (const targetDate of targetDates) {
          const sourceEntry = byWeekday.get(isoWeekday(businessDateValue(targetDate)));
          if (!sourceEntry) continue;
          await tx.attendanceRosterEntry.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, planId: plan.id, employeeId, businessDate: businessDateValue(targetDate), kind: sourceEntry.kind, periods: { create: sourceEntry.periods.map((period) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, startMinute: period.startMinute, endMinute: period.endMinute, endsNextDay: period.endsNextDay })) } } });
        }
      }
      if (input.mode === 'PERMANENT') {
        const source = rosterEntriesByEmployeeWeekday(plan.entries);
        const records = [...source.entries()].flatMap(([employeeId, byWeekday]) => [...byWeekday.entries()].map(([dayOfWeek, entry]) => ({ employeeId, dayOfWeek, entry })));
        const clashes = await tx.attendanceEmployeeWeeklyAdjustment.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, effectiveFrom, OR: records.map((record) => ({ employeeId: record.employeeId, dayOfWeek: record.dayOfWeek })) }, select: { employeeId: true, dayOfWeek: true } });
        if (clashes.length) throw new ConflictException('A permanent work rule already starts for one or more employees on this date. Choose another effective date.');
        for (const record of records) await tx.attendanceEmployeeWeeklyAdjustment.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId: record.employeeId, dayOfWeek: record.dayOfWeek, effectiveFrom, kind: record.entry.kind, createdByUserId: context.actorUserId, periods: { create: record.entry.periods.map((period) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, startMinute: period.startMinute, endMinute: period.endMinute, endsNextDay: period.endsNextDay })) } } });
      }
      const finalized = await tx.attendanceRosterPlan.update({ where: { id: plan.id }, data: { status: input.mode === 'PERMANENT' ? AttendanceRosterPlanStatus.APPLIED : AttendanceRosterPlanStatus.APPROVED, approvalMode: input.mode as AttendanceRosterApprovalMode, effectiveFrom, effectiveUntil, approvedByUserId: context.actorUserId, approvedAt: new Date() } });
      await this.audit(tx, context, `attendance.roster.${input.mode.toLowerCase()}_approved`, 'AttendanceRosterPlan', finalized.id, { weekStart: riyadhDate(plan.weekStart), mode: input.mode, effectiveFrom: effectiveFromText, effectiveUntil: effectiveUntil ? riyadhDate(effectiveUntil) : null, revision: plan.revision, requestKey: input.idempotencyKey });
      return riyadhDate(plan.weekStart);
    });
    return this.roster(context, weekStart);
  }

  async employeeSchedule(context: TrustedCompanyActorContext, employeeId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.assertEmployeeExists(tx, context, employeeId);
      return (await this.readEmployeeSchedules(tx, context, [employeeId]))[0]!;
    });
  }

  /** Batch endpoint used by the schedule workspace.  It replaces one HTTP
   * request per employee with three bounded queries for the whole company. */
  async employeeSchedules(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const employees = await tx.hrEmployee.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: HrEmployeeStatus.ACTIVE }, select: { id: true }, orderBy: { id: 'asc' } });
      return this.readEmployeeSchedules(tx, context, employees.map((employee) => employee.id));
    });
  }

  private async readEmployeeSchedules(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, employeeIds: string[]) {
    if (!employeeIds.length) return [];
    const [assignments, weeklyAdjustments, exceptions] = await Promise.all([
      tx.attendanceEmployeeScheduleAssignment.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: { in: employeeIds } }, include: { template: { select: { nameAr: true, nameEn: true } } }, orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'desc' }] }),
      tx.attendanceEmployeeWeeklyAdjustment.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: { in: employeeIds } }, include: { periods: { orderBy: { startMinute: 'asc' } } }, orderBy: [{ employeeId: 'asc' }, { dayOfWeek: 'asc' }, { effectiveFrom: 'desc' }] }),
      tx.attendanceScheduleException.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: { in: employeeIds } }, include: { periods: { orderBy: { startMinute: 'asc' } } }, orderBy: [{ employeeId: 'asc' }, { businessDate: 'desc' }, { createdAt: 'desc' }] }),
    ]);
    const assignmentsByEmployee = groupBy(assignments, (item) => item.employeeId);
    const adjustmentsByEmployee = groupBy(weeklyAdjustments, (item) => item.employeeId);
    const exceptionsByEmployee = groupBy(exceptions, (item) => item.employeeId);
    return employeeIds.map((employeeId) => ({
      employeeId,
      assignments: (assignmentsByEmployee.get(employeeId) ?? []).map(mapAssignment),
      weeklyAdjustments: (adjustmentsByEmployee.get(employeeId) ?? []).map(mapWeeklyAdjustment),
      exceptions: (exceptionsByEmployee.get(employeeId) ?? []).slice(0, 200).map(mapScheduleException),
    }));
  }

  /** Resolver precedence mirrors global timekeeping systems: dated approved
   * exception, then employee recurring adjustment, then assigned template. */
  async effectiveEmployeeSchedule(context: TrustedCompanyActorContext, employeeId: string, date: string) {
    const businessDate = businessDateValue(date); const weekday = isoWeekday(businessDate);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.assertEmployeeExists(tx, context, employeeId);
      return this.resolveEffectiveSchedule(tx, context, employeeId, date, businessDate, weekday);
    });
  }

  private async resolveEffectiveSchedule(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, employeeId: string, businessDateText: string, businessDate: Date, weekday = isoWeekday(businessDate)) {
    const schedules = await this.resolveEffectiveSchedules(tx, context, [employeeId], [businessDateText]);
    return schedules.get(scheduleResolutionKey(employeeId, businessDateText))!;
  }

  /**
   * Central schedule engine.  Every reader uses the same precedence rules as
   * the single-employee resolver, but policy rows are fetched once per range
   * instead of once per employee/day.  It removes the N×days database pattern
   * without caching mutable attendance facts or moving calculations to the UI.
   */
  private async resolveEffectiveSchedules(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, rawEmployeeIds: string[], rawDates: string[]) {
    const employeeIds = [...new Set(rawEmployeeIds)];
    const dates = [...new Set(rawDates)].sort();
    const resolved = new Map<string, ResolvedEffectiveSchedule>();
    if (!employeeIds.length || !dates.length) return resolved;
    const start = businessDateValue(dates[0]!); const end = businessDateValue(dates.at(-1)!);
    const range = { gte: start, lte: end };
    const [rosterEntries, exceptions, adjustments, assignments] = await Promise.all([
      tx.attendanceRosterEntry.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: { in: employeeIds }, businessDate: range, plan: { status: AttendanceRosterPlanStatus.APPROVED, effectiveFrom: { lte: end }, effectiveUntil: { gte: start } } }, include: { periods: { orderBy: { startMinute: 'asc' } }, plan: { select: { approvedAt: true, effectiveFrom: true, effectiveUntil: true } } } }),
      tx.attendanceScheduleException.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: { in: employeeIds }, businessDate: range, status: AttendanceScheduleExceptionStatus.APPROVED }, include: { periods: { orderBy: { startMinute: 'asc' } } } }),
      tx.attendanceEmployeeWeeklyAdjustment.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: { in: employeeIds }, effectiveFrom: { lte: end } }, include: { periods: { orderBy: { startMinute: 'asc' } } } }),
      tx.attendanceEmployeeScheduleAssignment.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: { in: employeeIds }, effectiveFrom: { lte: end } } }),
    ]);
    const templateIds = [...new Set(assignments.map((assignment) => assignment.templateId))];
    const versions = templateIds.length ? await tx.attendanceScheduleTemplateVersion.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, templateId: { in: templateIds }, effectiveFrom: { lte: end } }, include: { periods: { orderBy: [{ dayOfWeek: 'asc' }, { startMinute: 'asc' }] } } }) : [];
    const rosterByKey = groupBy(rosterEntries, (entry) => scheduleResolutionKey(entry.employeeId, dateOnly(entry.businessDate)));
    const exceptionsByKey = groupBy(exceptions, (entry) => scheduleResolutionKey(entry.employeeId, dateOnly(entry.businessDate)));
    const adjustmentsByEmployeeDay = groupBy(adjustments, (entry) => `${entry.employeeId}:${entry.dayOfWeek}`);
    const assignmentsByEmployee = groupBy(assignments, (entry) => entry.employeeId);
    const versionsByTemplate = groupBy(versions, (entry) => entry.templateId);
    const newestBefore = <T extends { effectiveFrom: Date }>(entries: T[] | undefined, businessDate: Date) => entries?.filter((entry) => entry.effectiveFrom <= businessDate).sort((left, right) => right.effectiveFrom.valueOf() - left.effectiveFrom.valueOf())[0];

    for (const employeeId of employeeIds) for (const businessDateText of dates) {
      const businessDate = businessDateValue(businessDateText); const weekday = isoWeekday(businessDate); const key = scheduleResolutionKey(employeeId, businessDateText);
      const roster = rosterByKey.get(key)?.filter((entry) => entry.plan.effectiveFrom !== null && entry.plan.effectiveUntil !== null && entry.plan.effectiveFrom <= businessDate && entry.plan.effectiveUntil >= businessDate).sort((left, right) => (right.plan.approvedAt?.valueOf() ?? 0) - (left.plan.approvedAt?.valueOf() ?? 0))[0];
      if (roster) { resolved.set(key, { employeeId, businessDate: businessDateText, source: 'ROSTER', kind: roster.kind, templateId: null, templateVersionId: null, periods: roster.periods.map(mapTimePeriod) }); continue; }
      const exception = exceptionsByKey.get(key)?.sort((left, right) => (right.decidedAt?.valueOf() ?? 0) - (left.decidedAt?.valueOf() ?? 0))[0];
      if (exception) { resolved.set(key, { employeeId, businessDate: businessDateText, source: 'EXCEPTION', kind: exception.kind, templateId: null, templateVersionId: null, periods: exception.periods.map(mapTimePeriod) }); continue; }
      const adjustment = newestBefore(adjustmentsByEmployeeDay.get(`${employeeId}:${weekday}`), businessDate);
      if (adjustment) { resolved.set(key, { employeeId, businessDate: businessDateText, source: 'WEEKLY_ADJUSTMENT', kind: adjustment.kind, templateId: null, templateVersionId: null, periods: adjustment.periods.map(mapTimePeriod) }); continue; }
      const assignment = newestBefore(assignmentsByEmployee.get(employeeId), businessDate);
      if (!assignment) { resolved.set(key, emptyEffectiveSchedule(employeeId, businessDateText)); continue; }
      const version = newestBefore(versionsByTemplate.get(assignment.templateId), businessDate);
      if (!version) { resolved.set(key, emptyEffectiveSchedule(employeeId, businessDateText, assignment.templateId)); continue; }
      resolved.set(key, { employeeId, businessDate: businessDateText, source: 'TEMPLATE', kind: AttendanceWeeklyAdjustmentKind.CUSTOM_PERIODS, templateId: assignment.templateId, templateVersionId: version.id, periods: version.periods.filter((period) => period.dayOfWeek === weekday).map(mapTimePeriod) });
    }
    return resolved;
  }

  /** The employee-file and template-card flows deliberately share one
   * validation/write path. They differ only in their presentation and audit
   * source, never in who may receive a schedule or what an assignment means. */
  private async createEmployeeScheduleAssignments(
    tx: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    input: { employeeIds: string[]; templateId: string; effectiveFromText: string; source: 'employee' | 'template' },
  ) {
    const employeeIds = [...new Set(input.employeeIds)];
    if (employeeIds.length !== input.employeeIds.length) throw new BadRequestException('Choose each employee only once.');
    const effectiveFrom = businessDateValue(input.effectiveFromText);
    const [template, employees, clashes] = await Promise.all([
      tx.attendanceScheduleTemplate.findFirst({ where: { id: input.templateId, tenantId: context.tenantId, companyId: context.companyId, status: AttendanceScheduleTemplateStatus.ACTIVE }, select: { id: true } }),
      tx.hrEmployee.findMany({ where: { id: { in: employeeIds }, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] } }, select: { id: true } }),
      tx.attendanceEmployeeScheduleAssignment.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: { in: employeeIds }, effectiveFrom }, select: { employeeId: true } }),
    ]);
    if (!template) throw new BadRequestException('Choose an active schedule template from this company.');
    if (employees.length !== employeeIds.length) throw new BadRequestException('All assigned employees must be active in this company.');
    if (clashes.length) throw new ConflictException(employeeIds.length === 1 ? 'An employee schedule assignment already starts on this date.' : 'One or more employees already have a schedule starting on this date.');
    const assignments = employeeIds.map((employeeId) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId, templateId: template.id, effectiveFrom, createdByUserId: context.actorUserId }));
    try {
      await tx.attendanceEmployeeScheduleAssignment.createMany({ data: assignments });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('An employee schedule assignment already starts on this date.');
      throw error;
    }
    await Promise.all(assignments.map((assignment) => this.audit(tx, context, 'attendance.employee_schedule.assigned', 'AttendanceEmployeeScheduleAssignment', assignment.id, {
      employeeId: assignment.employeeId,
      templateId: assignment.templateId,
      effectiveFrom: input.effectiveFromText,
      ...(input.source === 'template' ? { source: 'template' } : {}),
    })));
    return { assignments, effectiveFrom };
  }

  /** Compare-and-swap makes the revision check durable, not merely a read
   * followed by a write. The advisory lock above handles draft creation while
   * this guard protects every replacement of an existing draft. */
  private async updateRosterDraftRevision(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, planId: string, expectedRevision: number) {
    const updated = await tx.attendanceRosterPlan.updateMany({
      where: { id: planId, tenantId: context.tenantId, companyId: context.companyId, status: AttendanceRosterPlanStatus.DRAFT, revision: expectedRevision },
      data: { revision: { increment: 1 } },
    });
    if (updated.count !== 1) throw new ConflictException('This roster was changed by another manager. Reload it before saving.');
    return { id: planId, revision: expectedRevision + 1 };
  }

  /** Manager-facing operational snapshot. It records facts only; lateness and
   * overtime are intentionally not inferred until an approved shift exists. */
  async dashboard(context: TrustedCompanyActorContext, date?: string) {
    const businessDate = date ?? riyadhDate(new Date());
    const dateValue = businessDateValue(businessDate);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [employees, sessions] = await Promise.all([
        tx.hrEmployee.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: HrEmployeeStatus.ACTIVE }, select: { id: true, employeeNumber: true, nameAr: true, nameEn: true }, orderBy: [{ employeeNumber: 'asc' }, { id: 'asc' }] }),
        tx.attendanceWorkSession.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, businessDate: dateValue }, select: { employeeId: true, status: true, checkInAt: true, checkOutAt: true }, orderBy: { checkInAt: 'desc' } }),
      ]);
      const byEmployee = new Map<string, Array<typeof sessions[number]>>();
      for (const session of sessions) byEmployee.set(session.employeeId, [...(byEmployee.get(session.employeeId) ?? []), session]);
      const schedules = await this.resolveEffectiveSchedules(tx, context, employees.map((employee) => employee.id), [businessDate]);
      const now = new Date();
      const rows = await Promise.all(employees.map(async (employee) => {
        const employeeSessions = byEmployee.get(employee.id) ?? [];
        const latest = employeeSessions[0];
        const schedule = schedules.get(scheduleResolutionKey(employee.id, businessDate))!;
        const evaluation = evaluateAttendanceDay(businessDate, schedule, employeeSessions, now);
        const workedMinutes = employeeSessions.filter((session) => session.checkOutAt).reduce((total, session) => total + minutesBetween(session.checkInAt, session.checkOutAt!), 0);
        return { employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn, state: !latest ? 'NOT_RECORDED' as const : latest.status === AttendanceWorkSessionStatus.OPEN ? 'IN_PROGRESS' as const : 'CHECKED_OUT' as const, checkInAt: latest?.checkInAt.toISOString() ?? null, checkOutAt: latest?.checkOutAt?.toISOString() ?? null, workedMinutes, evaluation };
      }));
      const checkedIn = rows.filter((row) => row.state !== 'NOT_RECORDED').length;
      const checkedOut = rows.filter((row) => row.state === 'CHECKED_OUT').length;
      const openSessions = rows.filter((row) => row.state === 'IN_PROGRESS').length;
      return { date: businessDate, summary: { activeEmployees: rows.length, checkedIn, checkedOut, notRecorded: rows.length - checkedIn, openSessions }, employees: rows };
    });
  }

  /**
   * Coverage is an operational view, not surveillance: planned coverage comes
   * from approved schedules and actual coverage comes only from check-in/out
   * evidence. It never reads continuous device location or changes payroll.
   */
  async coverage(context: TrustedCompanyActorContext, date?: string) {
    const businessDate = date ?? riyadhDate(new Date());
    const weekStart = sundayAtOrBefore(businessDate);
    const weekDates = businessDates(weekStart, addBusinessDays(weekStart, 6));
    const selectedDateValue = businessDateValue(businessDate);
    const range = riyadhRange(addBusinessDays(weekStart, -1), weekDates.at(-1)!);
    const intervalMinutes = 30;
    const timelineStartMinute = 8 * 60;
    const timelineEndMinute = 27 * 60;
    const bucketCount = (timelineEndMinute - timelineStartMinute) / intervalMinutes;
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [employees, sessions] = await Promise.all([
        tx.hrEmployee.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: HrEmployeeStatus.ACTIVE }, select: { id: true, employeeNumber: true, nameAr: true, nameEn: true }, orderBy: [{ employeeNumber: 'asc' }, { id: 'asc' }] }),
        tx.attendanceWorkSession.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, businessDate: { gte: range.start, lt: range.end } }, select: { employeeId: true, businessDate: true, status: true, checkInAt: true, checkOutAt: true } }),
      ]);
      const schedules = await this.resolveEffectiveSchedules(tx, context, employees.map((employee) => employee.id), weekDates);
      const plannedByDay = new Map<string, Array<{ employeeId: string; startMinute: number; endMinute: number }>>();
      for (const employee of employees) for (const day of weekDates) {
        const periods = coverageScheduleIntervals(schedules.get(scheduleResolutionKey(employee.id, day))!);
        plannedByDay.set(`${employee.id}:${day}`, periods.map((period) => ({ employeeId: employee.id, ...period })));
      }
      const sessionsByEmployee = new Map<string, Array<typeof sessions[number]>>();
      for (const session of sessions) sessionsByEmployee.set(session.employeeId, [...(sessionsByEmployee.get(session.employeeId) ?? []), session]);
      const now = new Date();
      const actualFor = (employeeId: string, day: string, maxMinute = 1_440) => coverageActualIntervals(sessionsByEmployee.get(employeeId) ?? [], day, now, maxMinute);
      const days = weekDates.map((day) => {
        const planned = employees.flatMap((employee) => plannedByDay.get(`${employee.id}:${day}`) ?? []);
        const actual = employees.flatMap((employee) => actualFor(employee.id, day));
        return {
          date: day,
          dayOfWeek: isoWeekday(businessDateValue(day)),
          plannedCounts: coverageBucketCounts(planned, timelineStartMinute, bucketCount, intervalMinutes),
          actualCounts: coverageBucketCounts(actual, timelineStartMinute, bucketCount, intervalMinutes),
        };
      });
      const timeline = employees.map((employee) => ({
        employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn,
        plannedPeriods: plannedByDay.get(scheduleResolutionKey(employee.id, businessDate))?.map(({ startMinute, endMinute }) => ({ startMinute, endMinute })) ?? [],
        actualPeriods: actualFor(employee.id, businessDate, timelineEndMinute),
      }));
      const plannedTotals = Array.from({ length: bucketCount }, (_, index) => days.reduce((total, day) => total + day.plannedCounts[index]!, 0));
      const peakIndex = plannedTotals.reduce((best, value, index) => value > plannedTotals[best]! ? index : best, 0);
      const gap = longestCoverageGap(plannedTotals, timelineStartMinute, intervalMinutes);
      const plannedEmployees = timeline.filter((row) => row.plannedPeriods.length > 0);
      const actualPresent = plannedEmployees.filter((row) => row.actualPeriods.some((actual) => row.plannedPeriods.some((planned) => actual.startMinute < planned.endMinute && actual.endMinute > planned.startMinute))).length;
      return {
        date: businessDate, weekStart, intervalMinutes, timelineStartMinute, timelineEndMinute, days, timeline,
        summary: {
          peakCount: plannedTotals[peakIndex] ? Math.ceil(plannedTotals[peakIndex]! / weekDates.length) : 0,
          peakStartMinute: timelineStartMinute + peakIndex * intervalMinutes,
          peakEndMinute: timelineStartMinute + (peakIndex + 1) * intervalMinutes,
          gapStartMinute: gap?.startMinute ?? null, gapEndMinute: gap?.endMinute ?? null,
          actualAttendancePercent: plannedEmployees.length ? Math.round((actualPresent / plannedEmployees.length) * 100) : 0,
        },
      };
    });
  }

  async report(context: TrustedCompanyActorContext, input: { from: string; to: string; employeeId?: string | undefined }) {
    const range = businessDateRange(input.from, input.to);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      if (input.employeeId) await this.assertEmployeeExists(tx, context, input.employeeId);
      const [employees, sessions] = await Promise.all([
        tx.hrEmployee.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: HrEmployeeStatus.ACTIVE, ...(input.employeeId ? { id: input.employeeId } : {}) }, select: { id: true, employeeNumber: true, nameAr: true, nameEn: true }, orderBy: [{ employeeNumber: 'asc' }, { id: 'asc' }] }),
        tx.attendanceWorkSession.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, ...(input.employeeId ? { employeeId: input.employeeId } : {}), businessDate: { gte: range.start, lt: range.end } }, select: { employeeId: true, businessDate: true, status: true, checkInAt: true, checkOutAt: true } }),
      ]);
      const sessionsByEmployeeDay = new Map<string, Array<typeof sessions[number]>>();
      const sessionsByEmployee = new Map<string, Array<typeof sessions[number]>>();
      for (const session of sessions) {
        const key = `${session.employeeId}:${dateOnly(session.businessDate)}`;
        sessionsByEmployeeDay.set(key, [...(sessionsByEmployeeDay.get(key) ?? []), session]);
        sessionsByEmployee.set(session.employeeId, [...(sessionsByEmployee.get(session.employeeId) ?? []), session]);
      }
      const dates = businessDates(input.from, input.to);
      const schedules = await this.resolveEffectiveSchedules(tx, context, employees.map((employee) => employee.id), dates);
      const now = new Date();
      const rows = await Promise.all(employees.map(async (employee) => {
        const days = await Promise.all(dates.map(async (date) => {
          const schedule = schedules.get(scheduleResolutionKey(employee.id, date))!;
          return evaluateAttendanceDay(date, schedule, sessionsByEmployeeDay.get(`${employee.id}:${date}`) ?? [], now);
        }));
        const employeeSessions = sessionsByEmployee.get(employee.id) ?? [];
        return {
          employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn,
          sessions: employeeSessions.length,
          completedSessions: employeeSessions.filter((session) => session.status === AttendanceWorkSessionStatus.CLOSED).length,
          workedMinutes: days.reduce((total, day) => total + day.workedMinutes, 0),
          plannedMinutes: days.reduce((total, day) => total + day.plannedMinutes, 0),
          lateMinutes: days.reduce((total, day) => total + day.lateMinutes, 0),
          earlyLeaveMinutes: days.reduce((total, day) => total + day.earlyLeaveMinutes, 0),
          extraMinutes: days.reduce((total, day) => total + day.extraMinutes, 0),
          shortageMinutes: days.reduce((total, day) => total + day.shortageMinutes, 0),
          missingCheckInDays: days.filter((day) => day.state === 'MISSING_CHECK_IN').length,
          days,
        };
      }));
      return {
        from: input.from, to: input.to,
        summary: {
          sessions: sessions.length,
          completedSessions: sessions.filter((item) => item.status === AttendanceWorkSessionStatus.CLOSED).length,
          openSessions: sessions.filter((item) => item.status === AttendanceWorkSessionStatus.OPEN).length,
          workedMinutes: rows.reduce((total, item) => total + item.workedMinutes, 0),
          plannedMinutes: rows.reduce((total, item) => total + item.plannedMinutes, 0),
          lateMinutes: rows.reduce((total, item) => total + item.lateMinutes, 0),
          earlyLeaveMinutes: rows.reduce((total, item) => total + item.earlyLeaveMinutes, 0),
          extraMinutes: rows.reduce((total, item) => total + item.extraMinutes, 0),
          shortageMinutes: rows.reduce((total, item) => total + item.shortageMinutes, 0),
          missingCheckInDays: rows.reduce((total, item) => total + item.missingCheckInDays, 0),
        },
        rows,
      };
    });
  }

  /** Operational alerts are derived from immutable evidence and the effective
   * schedule. They are advisory only: they never create payroll, overtime or
   * deduction records. */
  async alerts(context: TrustedCompanyActorContext, date?: string) {
    const businessDate = date ?? riyadhDate(new Date());
    const dateValue = businessDateValue(businessDate);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [employees, sessions] = await Promise.all([
        tx.hrEmployee.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: HrEmployeeStatus.ACTIVE }, select: { id: true, employeeNumber: true, nameAr: true, nameEn: true }, orderBy: [{ employeeNumber: 'asc' }, { id: 'asc' }] }),
        tx.attendanceWorkSession.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, businessDate: dateValue }, select: { id: true, employeeId: true, businessDate: true, status: true, checkInAt: true, checkOutAt: true } }),
      ]);
      const byEmployee = new Map<string, Array<typeof sessions[number]>>();
      for (const session of sessions) byEmployee.set(session.employeeId, [...(byEmployee.get(session.employeeId) ?? []), session]);
      const schedules = await this.resolveEffectiveSchedules(tx, context, employees.map((employee) => employee.id), [businessDate]);
      const now = new Date();
      const alerts = (await Promise.all(employees.map(async (employee) => {
        const employeeSessions = byEmployee.get(employee.id) ?? [];
        const schedule = schedules.get(scheduleResolutionKey(employee.id, businessDate))!;
        const evaluation = evaluateAttendanceDay(businessDate, schedule, employeeSessions, now);
        const result: Array<{ employeeId: string; employeeNumber: string; employeeNameAr: string; employeeNameEn: string | null; type: 'LATE' | 'MISSING_CHECK_IN' | 'OPEN_SESSION'; severity: 'INFO' | 'WARNING'; businessDate: string; minutes: number; messageAr: string }> = [];
        if (evaluation.lateMinutes > 0) result.push({ employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn, type: 'LATE', severity: 'WARNING', businessDate, minutes: evaluation.lateMinutes, messageAr: `تأخر عن بداية الدوام ${evaluation.lateMinutes} دقيقة.` });
        if (evaluation.state === 'MISSING_CHECK_IN' && hasScheduleStarted(businessDate, schedule.periods, now)) result.push({ employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn, type: 'MISSING_CHECK_IN', severity: 'WARNING', businessDate, minutes: 0, messageAr: 'لم يسجل حضورًا رغم بدء الدوام المخطط.' });
        const open = employeeSessions.find((session) => session.status === AttendanceWorkSessionStatus.OPEN);
        if (open) {
          const stale = isOpenSessionStale(businessDate, schedule.periods, open.checkInAt, now);
          result.push({ employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn, type: 'OPEN_SESSION', severity: stale ? 'WARNING' : 'INFO', businessDate, minutes: minutesBetween(open.checkInAt, now), messageAr: stale ? 'جلسة حضور مفتوحة تجاوزت الحد المعقول وتحتاج مراجعة مدير.' : 'جلسة حضور مفتوحة بانتظار تسجيل الانصراف.' });
        }
        return result;
      }))).flat();
      return { date: businessDate, summary: { late: alerts.filter((alert) => alert.type === 'LATE').length, missingCheckIn: alerts.filter((alert) => alert.type === 'MISSING_CHECK_IN').length, openSessions: alerts.filter((alert) => alert.type === 'OPEN_SESSION').length }, alerts };
    });
  }

  /** The manager-owned kiosk displays this signed short-lived value as a QR. */
  async issueQr(context: TrustedCompanyActorContext, branchId: string) {
    const branch = await this.database.inTenantTransaction(context.tenantId, (tx) => tx.attendanceBranch.findFirst({ where: { id: branchId, tenantId: context.tenantId, companyId: context.companyId, isActive: true }, select: { id: true, qrValiditySeconds: true } }));
    if (!branch) throw new NotFoundException('Active attendance branch was not found.');
    const expiresAt = Math.floor(Date.now() / 1_000) + branch.qrValiditySeconds;
    // `companyId` lets the unauthenticated employee PWA route the scanned
    // challenge to the right tenant. It is covered by the HMAC below and is
    // verified again on the server; it is not trusted from the browser.
    const body = Buffer.from(JSON.stringify({ companyId: context.companyId, branchId: branch.id, expiresAt, nonce: randomUUID() })).toString('base64url');
    return { token: `${body}.${this.sign(body)}`, expiresAt: new Date(expiresAt * 1_000).toISOString() };
  }

  /** A short employee-only session unlocks read-only schedule details and
   * removes the duplicate PIN step immediately before scanning a branch QR. */
  async createEmployeePortalSession(input: AttendanceEmployeePortalSessionRequest) {
    const company = { id: input.companyId, tenantId: input.tenantId };
    return this.database.inTenantTransaction(input.tenantId, async (tx) => {
      const exists = await tx.company.findFirst({ where: { id: company.id, tenantId: company.tenantId }, select: { id: true } });
      if (!exists) throw new ForbiddenException('Attendance company is unavailable.');
      const credential = await this.authenticateEmployeePin(tx, company, input.pin);
      const profile = await this.employeePortalProfileForEmployee(tx, company, credential.employee.id);
      const expiresAt = Math.floor(Date.now() / 1_000) + 10 * 60;
      const accessToken = this.createEmployeePortalToken(company.id, company.tenantId, credential.employee.id, expiresAt);
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: company.tenantId, companyId: company.id, action: 'attendance.employee_portal.opened', entityType: 'HrEmployee', entityId: credential.employee.id, requestId: randomUUID(), afterJson: { employeeId: credential.employee.id, expiresAt } } });
      return { accessToken, expiresAt: new Date(expiresAt * 1_000).toISOString(), profile };
    });
  }

  async employeePortalProfile(accessToken: string) {
    const access = this.verifyEmployeePortalToken(accessToken);
    const company = { id: access.companyId, tenantId: access.tenantId };
    return this.database.inTenantTransaction(access.tenantId, async (tx) => {
      const exists = await tx.company.findFirst({ where: { id: company.id, tenantId: company.tenantId }, select: { id: true } });
      if (!exists) throw new ForbiddenException('Attendance company is unavailable.');
      const credential = await tx.attendanceEmployeeCredential.findFirst({ where: { tenantId: company.tenantId, companyId: company.id, employeeId: access.employeeId }, select: { id: true } });
      if (!credential) throw new ForbiddenException('Employee portal access is no longer available.');
      return this.employeePortalProfileForEmployee(tx, company, access.employeeId);
    });
  }

  async recordFromEmployee(input: AttendanceEmployeeRecordRequest) {
    const company = { id: input.companyId, tenantId: input.tenantId };
    return this.database.inTenantTransaction(input.tenantId, async (tx) => {
      const exists = await tx.company.findFirst({ where: { id: company.id, tenantId: company.tenantId }, select: { id: true } });
      if (!exists) throw new ForbiddenException('Attendance company is unavailable.');
      const replay = await tx.attendanceEvent.findFirst({ where: { tenantId: company.tenantId, companyId: company.id, requestKey: input.idempotencyKey }, include: { employee: { select: { nameAr: true } }, session: true } });
      if (replay) return { employeeId: replay.employeeId, employeeNameAr: replay.employee.nameAr, operation: replay.eventType, occurredAt: replay.occurredAt.toISOString(), sessionId: replay.sessionId, replayed: true };
      const credential = input.portalToken
        ? await this.authenticateEmployeePortalToken(tx, company, input.portalToken)
        : await this.authenticateEmployeePin(tx, company, input.pin!);
      const branch = await tx.attendanceBranch.findFirst({ where: { id: input.branchId, tenantId: company.tenantId, companyId: company.id, isActive: true } });
      if (!branch) throw new BadRequestException('Attendance branch is unavailable.');
      const qr = this.verifyQr(input.qrToken, branch.id, company.id);
      const qrTokenHash = createHash('sha256').update(input.qrToken).digest('hex');
      if (input.accuracyMeters > branch.maxAccuracyMeters) throw new BadRequestException('Location accuracy is not sufficient. Please try again near a clearer signal.');
      if (distanceMeters(input.latitude, input.longitude, Number(branch.latitude), Number(branch.longitude)) > branch.radiusMeters) throw new ForbiddenException('You are outside the permitted attendance radius.');
      try {
        await tx.attendanceQrScanUse.create({ data: { id: randomUUID(), tenantId: company.tenantId, companyId: company.id, employeeId: credential.employee.id, qrTokenHash, expiresAt: qr.expiresAt } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new ConflictException('This QR was already used by this employee. Scan the refreshed code.');
        throw error;
      }
      const open = await tx.attendanceWorkSession.findFirst({ where: { tenantId: company.tenantId, companyId: company.id, employeeId: credential.employee.id, status: AttendanceWorkSessionStatus.OPEN }, orderBy: { checkInAt: 'desc' } });
      const occurredAt = new Date(); const sessionId = open?.id ?? randomUUID(); const eventType = open ? AttendanceEventType.CHECK_OUT : AttendanceEventType.CHECK_IN;
      if (open) {
        const openBusinessDate = dateOnly(open.businessDate);
        const schedule = await this.resolveEffectiveSchedule(tx, { tenantId: company.tenantId, companyId: company.id, actorUserId: 'attendance-kiosk' }, credential.employee.id, openBusinessDate, open.businessDate);
        if (isOpenSessionStale(openBusinessDate, schedule.periods, open.checkInAt, occurredAt)) {
          await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: company.tenantId, companyId: company.id, action: 'attendance.open_session.review_required', entityType: 'AttendanceWorkSession', entityId: open.id, requestId: input.idempotencyKey, afterJson: { employeeId: credential.employee.id, businessDate: openBusinessDate, checkInAt: open.checkInAt.toISOString() } } });
          throw new ConflictException('An older attendance session is still open and requires manager review before another operation.');
        }
      }
      const businessDate = open?.businessDate ?? businessDateValue(riyadhDate(occurredAt));
      if (open) {
        const closed = await tx.attendanceWorkSession.updateMany({ where: { id: open.id, status: AttendanceWorkSessionStatus.OPEN }, data: { status: AttendanceWorkSessionStatus.CLOSED, checkOutAt: occurredAt } });
        if (closed.count !== 1) throw new ConflictException('Attendance state changed; please retry.');
      } else {
        await tx.attendanceWorkSession.create({ data: { id: sessionId, tenantId: company.tenantId, companyId: company.id, branchId: branch.id, employeeId: credential.employee.id, status: AttendanceWorkSessionStatus.OPEN, businessDate, checkInAt: occurredAt } });
      }
      await tx.attendanceEvent.create({ data: { id: randomUUID(), tenantId: company.tenantId, companyId: company.id, branchId: branch.id, employeeId: credential.employee.id, sessionId, eventType, businessDate, occurredAt, latitude: new Prisma.Decimal(input.latitude), longitude: new Prisma.Decimal(input.longitude), accuracyMeters: new Prisma.Decimal(input.accuracyMeters), qrTokenHash, requestKey: input.idempotencyKey } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: company.tenantId, companyId: company.id, action: `attendance.${eventType.toLowerCase()}`, entityType: 'AttendanceEvent', entityId: sessionId, requestId: input.idempotencyKey, afterJson: { employeeId: credential.employee.id, branchId: branch.id, eventType, accuracyAccepted: true, qrConsumedForEmployee: true } } });
      return { employeeId: credential.employee.id, employeeNameAr: credential.employee.nameAr, operation: eventType, occurredAt: occurredAt.toISOString(), sessionId, replayed: false };
    });
  }

  private async assertEmployeeExists(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, employeeId: string) {
    const employee = await tx.hrEmployee.findFirst({ where: { id: employeeId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true } });
    if (!employee) throw new BadRequestException('Choose an employee from this company.');
  }

  private async assertActiveEmployee(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, employeeId: string) {
    const employee = await tx.hrEmployee.findFirst({ where: { id: employeeId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] } }, select: { id: true } });
    if (!employee) throw new BadRequestException('Choose an active employee from this company.');
  }

  private async authenticateEmployeePin(tx: Prisma.TransactionClient, company: { id: string; tenantId: string }, pin: string) {
    const credential = await tx.attendanceEmployeeCredential.findFirst({ where: { tenantId: company.tenantId, companyId: company.id, pinLookupHash: this.pinLookup(company.id, pin) }, include: { employee: { select: { id: true, nameAr: true, status: true } } } });
    const pinIsValid = credential ? await verifyPassword(pin, credential.pinHash) : false;
    if (!credential || (credential.lockedUntil && credential.lockedUntil > new Date()) || credential.employee.status !== HrEmployeeStatus.ACTIVE || !pinIsValid) {
      if (credential) {
        const failedCredentialUpdate = credential.failedAttempts >= 4
          ? { failedAttempts: { increment: 1 }, lockedUntil: new Date(Date.now() + 15 * 60_000) }
          : { failedAttempts: { increment: 1 } };
        await tx.attendanceEmployeeCredential.update({ where: { id: credential.id }, data: failedCredentialUpdate });
      }
      throw new ForbiddenException('Attendance PIN is invalid or temporarily locked.');
    }
    if (credential.failedAttempts) await tx.attendanceEmployeeCredential.update({ where: { id: credential.id }, data: { failedAttempts: 0, lockedUntil: null } });
    return credential;
  }

  private async authenticateEmployeePortalToken(tx: Prisma.TransactionClient, company: { id: string; tenantId: string }, accessToken: string) {
    const access = this.verifyEmployeePortalToken(accessToken);
    if (access.companyId !== company.id || access.tenantId !== company.tenantId) throw new ForbiddenException('Employee portal access belongs to another company.');
    const credential = await tx.attendanceEmployeeCredential.findFirst({ where: { tenantId: company.tenantId, companyId: company.id, employeeId: access.employeeId }, include: { employee: { select: { id: true, nameAr: true, status: true } } } });
    if (!credential || credential.employee.status !== HrEmployeeStatus.ACTIVE) throw new ForbiddenException('Employee portal access is no longer available.');
    return credential;
  }

  private async employeePortalProfileForEmployee(tx: Prisma.TransactionClient, company: { id: string; tenantId: string }, employeeId: string) {
    const employee = await tx.hrEmployee.findFirst({ where: { id: employeeId, tenantId: company.tenantId, companyId: company.id, status: HrEmployeeStatus.ACTIVE }, select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } });
    if (!employee) throw new ForbiddenException('Employee portal access is no longer available.');
    const startText = riyadhDate(new Date()); const start = businessDateValue(startText);
    const dates = Array.from({ length: 7 }, (_, offset) => { const next = new Date(start); next.setUTCDate(next.getUTCDate() + offset); return dateOnly(next); });
    const context = { tenantId: company.tenantId, companyId: company.id, actorUserId: 'attendance-employee-portal' };
    const monthStart = `${startText.slice(0, 7)}-01`;
    // The employee-facing indicator uses only completed calendar days. This
    // prevents a current open shift from being assessed as a shortage.
    const previousDay = new Date(start); previousDay.setUTCDate(previousDay.getUTCDate() - 1);
    const completedDates = previousDay >= businessDateValue(monthStart) ? businessDates(monthStart, dateOnly(previousDay)) : [];
    const [open, priorSessions] = await Promise.all([
      tx.attendanceWorkSession.findFirst({ where: { tenantId: company.tenantId, companyId: company.id, employeeId: employee.id, status: AttendanceWorkSessionStatus.OPEN }, select: { id: true } }),
      completedDates.length ? tx.attendanceWorkSession.findMany({ where: { tenantId: company.tenantId, companyId: company.id, employeeId: employee.id, businessDate: { gte: businessDateValue(completedDates[0]!), lte: businessDateValue(completedDates.at(-1)!) } }, select: { businessDate: true, status: true, checkInAt: true, checkOutAt: true } }) : Promise.resolve([]),
    ]);
    const effectiveSchedules = await this.resolveEffectiveSchedules(tx, context, [employee.id], [...dates, ...completedDates]);
    const schedule = dates.map((businessDate) => {
      const effective = effectiveSchedules.get(scheduleResolutionKey(employee.id, businessDate))!;
      return { businessDate: effective.businessDate, source: effective.source, kind: effective.kind, periods: effective.periods };
    });
    const sessionsByDay = new Map<string, SessionEvidence[]>();
    for (const session of priorSessions) {
      const date = dateOnly(session.businessDate);
      sessionsByDay.set(date, [...(sessionsByDay.get(date) ?? []), session]);
    }
    const evaluatedAt = new Date();
    const evaluations = completedDates.map((businessDate) => evaluateAttendanceDay(businessDate, effectiveSchedules.get(scheduleResolutionKey(employee.id, businessDate))!, sessionsByDay.get(businessDate) ?? [], evaluatedAt));
    const plannedMinutes = evaluations.reduce((total, day) => total + day.plannedMinutes, 0);
    const shortageMinutes = evaluations.reduce((total, day) => total + day.shortageMinutes, 0);
    const evaluatedDays = evaluations.filter((day) => day.plannedMinutes > 0).length;
    const commitment = { score: plannedMinutes ? Math.max(0, Math.min(100, Math.round(((plannedMinutes - shortageMinutes) / plannedMinutes) * 100))) : null, plannedMinutes, shortageMinutes, evaluatedDays };
    return { companyId: company.id, employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, employeeNameEn: employee.nameEn, businessDate: startText, state: open ? 'IN_PROGRESS' as const : 'READY' as const, commitment, schedule };
  }

  private createEmployeePortalToken(companyId: string, tenantId: string, employeeId: string, expiresAt: number) {
    const body = Buffer.from(JSON.stringify({ companyId, tenantId, employeeId, expiresAt, nonce: randomUUID() })).toString('base64url');
    return `v1.${body}.${this.signEmployeePortal(body)}`;
  }

  private verifyEmployeePortalToken(value: string) {
    const [version, body, signature, extra] = value.split('.');
    if (version !== 'v1' || !body || !signature || extra || this.signEmployeePortal(body) !== signature) throw new ForbiddenException('Employee portal access is invalid.');
    try {
      const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { companyId?: string; tenantId?: string; employeeId?: string; expiresAt?: number };
      if (!parsed.companyId || !parsed.tenantId || !parsed.employeeId || !Number.isInteger(parsed.expiresAt) || (parsed.expiresAt ?? 0) * 1_000 < Date.now()) throw new Error('expired');
      return { companyId: parsed.companyId, tenantId: parsed.tenantId, employeeId: parsed.employeeId };
    } catch { throw new ForbiddenException('Employee portal access has expired.'); }
  }

  private pinLookup(companyId: string, pin: string) { return createHmac('sha256', this.secret('ATTENDANCE_PIN_PEPPER')).update(`${companyId}:${pin}`).digest('hex'); }
  private encryptPin(pin: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', this.pinEncryptionKey(), iv); const ciphertext = Buffer.concat([cipher.update(pin, 'utf8'), cipher.final()]); return `v1.${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${ciphertext.toString('base64url')}`; }
  private decryptPin(value: string) { const [version, ivValue, tagValue, ciphertextValue, extra] = value.split('.'); if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue || extra) throw new ConflictException('Attendance PIN display requires a PIN reset.'); try { const decipher = createDecipheriv('aes-256-gcm', this.pinEncryptionKey(), Buffer.from(ivValue, 'base64url')); decipher.setAuthTag(Buffer.from(tagValue, 'base64url')); const pin = Buffer.concat([decipher.update(Buffer.from(ciphertextValue, 'base64url')), decipher.final()]).toString('utf8'); if (!/^\d{4}$/.test(pin)) throw new Error('invalid'); return pin; } catch { throw new ConflictException('Attendance PIN display requires a PIN reset.'); } }
  private pinEncryptionKey() { return createHash('sha256').update(`${this.secret('ATTENDANCE_PIN_PEPPER')}:attendance-pin-display:v1`).digest(); }
  private sign(value: string) { return createHmac('sha256', this.secret('ATTENDANCE_QR_SECRET')).update(value).digest('base64url'); }
  private signEmployeePortal(value: string) { return createHmac('sha256', this.secret('ATTENDANCE_QR_SECRET')).update(`employee-portal:v1:${value}`).digest('base64url'); }
  private async assertPinDisplayAuthority(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext) { const [owner, membership] = await Promise.all([tx.tenantAdministrationAssignment.findFirst({ where: { tenantId: context.tenantId, userId: context.actorUserId, isOwner: true }, select: { userId: true } }), tx.companyMembership.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, userId: context.actorUserId }, include: { role: { select: { code: true, isSystem: true } } } })]); if (owner || (membership?.role.isSystem && membership.role.code === 'BASEER_COMPANY_MANAGER')) return; throw new ForbiddenException('Only the tenant owner or company manager can view attendance PINs.'); }
  private secret(name: string) { const value = process.env[name]; if (!value || value.length < 32) throw new Error(`${name} must be configured with at least 32 characters.`); return value; }
  private verifyQr(token: string, branchId: string, companyId: string) { const [body, signature, extra] = token.split('.'); if (!body || !signature || extra || this.sign(body) !== signature) throw new ForbiddenException('Attendance QR is invalid.'); try { const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { companyId?: string; branchId?: string; expiresAt?: number; nonce?: string }; const expiresAt = payload.expiresAt; if (payload.companyId !== companyId || payload.branchId !== branchId || !Number.isInteger(expiresAt) || typeof payload.nonce !== 'string' || !payload.nonce || (expiresAt as number) * 1_000 < Date.now()) throw new Error('expired'); return { expiresAt: new Date((expiresAt as number) * 1_000) }; } catch { throw new ForbiddenException('Attendance QR has expired. Scan the current code.'); } }
  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityType: string, entityId: string, afterJson: Prisma.InputJsonValue) { await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType, entityId, requestId: randomUUID(), afterJson } }); }
}

function branchInput(input: Pick<CreateAttendanceBranchRequest, 'nameAr' | 'nameEn' | 'latitude' | 'longitude' | 'radiusMeters' | 'maxAccuracyMeters' | 'qrValiditySeconds'>) { return { nameAr: input.nameAr, nameEn: input.nameEn ?? null, latitude: new Prisma.Decimal(input.latitude), longitude: new Prisma.Decimal(input.longitude), radiusMeters: input.radiusMeters, maxAccuracyMeters: input.maxAccuracyMeters, qrValiditySeconds: input.qrValiditySeconds }; }
function mapBranch(value: { id: string; nameAr: string; nameEn: string | null; latitude: Prisma.Decimal; longitude: Prisma.Decimal; radiusMeters: number; maxAccuracyMeters: number; qrValiditySeconds: number; isActive: boolean }) { return { id: value.id, nameAr: value.nameAr, nameEn: value.nameEn, latitude: Number(value.latitude), longitude: Number(value.longitude), radiusMeters: value.radiusMeters, maxAccuracyMeters: value.maxAccuracyMeters, qrValiditySeconds: value.qrValiditySeconds, isActive: value.isActive }; }
type InputPeriod = { startTime: string; endTime: string };
type InputWeeklyPeriod = InputPeriod & { dayOfWeek: number };
function toMinute(value: string) { const parts = value.split(':'); const hours = Number(parts[0]); const minutes = Number(parts[1]); return hours * 60 + minutes; }
function formatMinute(value: number) { return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`; }
function normalizeDailyPeriods(periods: InputPeriod[]) {
  const normalized = periods.map((period) => { const startMinute = toMinute(period.startTime); const endMinute = toMinute(period.endTime); return { startMinute, endMinute, endsNextDay: endMinute < startMinute }; });
  assertPeriodsDoNotOverlap(normalized);
  return normalized;
}
function normalizeWeeklyPeriods(periods: InputWeeklyPeriod[]) {
  const normalized = periods.map((period) => ({ dayOfWeek: period.dayOfWeek, ...normalizeDailyPeriods([period])[0]! }));
  // Project overnight parts into the following weekday before overlap checks.
  // This prevents, for example, a Monday 20:00-01:00 period colliding with a
  // Tuesday 00:30-03:00 period.
  for (let dayOfWeek = 1; dayOfWeek <= 7; dayOfWeek += 1) {
    const projected = normalized.flatMap((period) => {
      const previousDay = dayOfWeek === 1 ? 7 : dayOfWeek - 1;
      const result: Array<{ startMinute: number; endMinute: number; endsNextDay: boolean }> = [];
      if (period.dayOfWeek === dayOfWeek) result.push({ startMinute: period.startMinute, endMinute: period.endsNextDay ? 1_440 : period.endMinute, endsNextDay: false });
      if (period.endsNextDay && period.dayOfWeek === previousDay) result.push({ startMinute: 0, endMinute: period.endMinute, endsNextDay: false });
      return result;
    });
    assertPeriodsDoNotOverlap(projected);
  }
  return normalized;
}
/** Normal intervals must never overlap. Overnight periods are safely allowed;
 * their following-day window is checked separately too. */
function assertPeriodsDoNotOverlap(periods: Array<{ startMinute: number; endMinute: number; endsNextDay: boolean }>) {
  const intervals = periods.flatMap((period) => period.endsNextDay ? [[period.startMinute, 1440], [0, period.endMinute]] : [[period.startMinute, period.endMinute]]).sort((a, b) => a[0]! - b[0]!);
  for (let index = 1; index < intervals.length; index += 1) { const current = intervals[index]!; const previous = intervals[index - 1]!; if (current[0]! < previous[1]!) throw new BadRequestException('Attendance work periods overlap.'); }
}
function mapTimePeriod(value: { startMinute: number; endMinute: number; endsNextDay: boolean }) { const minutes = value.endsNextDay ? 1_440 - value.startMinute + value.endMinute : value.endMinute - value.startMinute; return { startTime: formatMinute(value.startMinute), endTime: formatMinute(value.endMinute), endsNextDay: value.endsNextDay, minutes }; }
function mapScheduleVersion(value: { id: string; versionNumber: number; effectiveFrom: Date; periods: Array<{ startMinute: number; endMinute: number; endsNextDay: boolean; dayOfWeek: number }> }) { return { id: value.id, versionNumber: value.versionNumber, effectiveFrom: dateOnly(value.effectiveFrom), periods: value.periods.slice().sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinute - b.startMinute).map((period) => ({ dayOfWeek: period.dayOfWeek, ...mapTimePeriod(period) })) }; }
function mapScheduleTemplate(value: { id: string; nameAr: string; nameEn: string | null; status: AttendanceScheduleTemplateStatus; archivedAt: Date | null; versions: Array<{ id: string; versionNumber: number; effectiveFrom: Date; periods: Array<{ startMinute: number; endMinute: number; endsNextDay: boolean; dayOfWeek: number }> }> }) { return { id: value.id, nameAr: value.nameAr, nameEn: value.nameEn, status: value.status, archivedAt: value.archivedAt?.toISOString() ?? null, versions: value.versions.map(mapScheduleVersion) }; }
function mapAssignment(value: { id: string; templateId: string; effectiveFrom: Date; createdAt: Date; template: { nameAr: string; nameEn: string | null } }) { return { id: value.id, templateId: value.templateId, templateNameAr: value.template.nameAr, templateNameEn: value.template.nameEn, effectiveFrom: dateOnly(value.effectiveFrom), createdAt: value.createdAt.toISOString() }; }
function mapWeeklyAdjustment(value: { id: string; dayOfWeek: number; effectiveFrom: Date; kind: AttendanceWeeklyAdjustmentKind; createdAt: Date; periods: Array<{ startMinute: number; endMinute: number; endsNextDay: boolean }> }) { return { id: value.id, dayOfWeek: value.dayOfWeek, effectiveFrom: dateOnly(value.effectiveFrom), kind: value.kind, periods: value.periods.slice().sort((a, b) => a.startMinute - b.startMinute).map(mapTimePeriod), createdAt: value.createdAt.toISOString() }; }
function mapScheduleException(value: { id: string; businessDate: Date; kind: AttendanceWeeklyAdjustmentKind; status: AttendanceScheduleExceptionStatus; reason: string; decisionNote: string | null; decidedAt: Date | null; createdAt: Date; periods: Array<{ startMinute: number; endMinute: number; endsNextDay: boolean }> }) { return { id: value.id, businessDate: dateOnly(value.businessDate), kind: value.kind, status: value.status, reason: value.reason, decisionNote: value.decisionNote, decidedAt: value.decidedAt?.toISOString() ?? null, periods: value.periods.slice().sort((a, b) => a.startMinute - b.startMinute).map(mapTimePeriod), createdAt: value.createdAt.toISOString() }; }
type RosterPeriod = { startMinute: number; endMinute: number; endsNextDay: boolean };
type RosterEntry = { employeeId: string; businessDate: string; kind: 'FULL_REST' | 'CUSTOM_PERIODS'; periods: RosterPeriod[] };
function mapRosterEntry(value: { employeeId: string; businessDate: Date; kind: AttendanceWeeklyAdjustmentKind; periods: RosterPeriod[] }): RosterEntry { return { employeeId: value.employeeId, businessDate: riyadhDate(value.businessDate), kind: value.kind, periods: value.periods.map((period) => ({ startMinute: period.startMinute, endMinute: period.endMinute, endsNextDay: period.endsNextDay })) }; }
function mapRosterPlan(value: { id: string; status: AttendanceRosterPlanStatus; revision: number; approvalMode: AttendanceRosterApprovalMode | null; effectiveFrom: Date | null; effectiveUntil: Date | null; updatedAt: Date }) { return { id: value.id, status: value.status, revision: value.revision, approvalMode: value.approvalMode, effectiveFrom: value.effectiveFrom ? riyadhDate(value.effectiveFrom) : null, effectiveUntil: value.effectiveUntil ? riyadhDate(value.effectiveUntil) : null, updatedAt: value.updatedAt.toISOString() }; }
function normalizeRosterEntries(entries: RosterEntry[], allowedDates: Set<string>) {
  const seen = new Set<string>();
  return entries.map((entry) => {
    if (!allowedDates.has(entry.businessDate)) throw new BadRequestException('Roster entries must stay within their selected week.');
    const key = `${entry.employeeId}:${entry.businessDate}`;
    if (seen.has(key)) throw new BadRequestException('A roster contains duplicate employee days.');
    seen.add(key);
    if (entry.kind === 'FULL_REST' && entry.periods.length) throw new BadRequestException('A rest day cannot contain work periods.');
    if (entry.kind === 'CUSTOM_PERIODS' && !entry.periods.length) throw new BadRequestException('A roster workday needs a work period.');
    assertPeriodsDoNotOverlap(entry.periods);
    return entry;
  });
}
function normalizeRosterPeakPeriods(periods: Array<{ businessDate: string; startMinute: number; endMinute: number }>, allowedDates: Set<string>) {
  const byDay = new Map<string, Array<{ businessDate: string; startMinute: number; endMinute: number }>>();
  for (const period of periods) {
    if (!allowedDates.has(period.businessDate)) throw new BadRequestException('Peak periods must stay within their selected week.');
    if (period.endMinute <= period.startMinute || period.endMinute - period.startMinute > 1_440) throw new BadRequestException('Invalid peak period.');
    byDay.set(period.businessDate, [...(byDay.get(period.businessDate) ?? []), period]);
  }
  for (const dayPeriods of byDay.values()) {
    if (dayPeriods.length > 4) throw new BadRequestException('A day can have at most four peak periods.');
    const sorted = [...dayPeriods].sort((left, right) => left.startMinute - right.startMinute);
    if (sorted.some((period, index) => index > 0 && period.startMinute < sorted[index - 1]!.endMinute)) throw new BadRequestException('Peak periods cannot overlap.');
  }
  return [...byDay.values()].flat().sort((left, right) => left.businessDate.localeCompare(right.businessDate) || left.startMinute - right.startMinute);
}
function rosterEntriesByEmployeeWeekday(entries: Array<{ employeeId: string; businessDate: Date; kind: AttendanceWeeklyAdjustmentKind; periods: RosterPeriod[] }>) {
  const result = new Map<string, Map<number, { kind: AttendanceWeeklyAdjustmentKind; periods: RosterPeriod[] }>>();
  for (const entry of entries) {
    const byWeekday = result.get(entry.employeeId) ?? new Map<number, { kind: AttendanceWeeklyAdjustmentKind; periods: RosterPeriod[] }>();
    byWeekday.set(isoWeekday(entry.businessDate), { kind: entry.kind, periods: entry.periods.map((period) => ({ startMinute: period.startMinute, endMinute: period.endMinute, endsNextDay: period.endsNextDay })) });
    result.set(entry.employeeId, byWeekday);
  }
  return result;
}
function businessDateValue(value: string) { if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('Invalid attendance business date.'); const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.valueOf()) || dateOnly(date) !== value) throw new BadRequestException('Invalid attendance business date.'); return date; }
function businessDateRange(from: string, to: string) { const start = businessDateValue(from); const end = businessDateValue(to); if (end < start) throw new BadRequestException('Invalid attendance report range.'); return { start, end: new Date(end.valueOf() + 24 * 60 * 60 * 1_000) }; }
function dateOnly(value: Date) { return value.toISOString().slice(0, 10); }
function isoWeekday(date: Date) { const weekday = date.getUTCDay(); return weekday === 0 ? 7 : weekday; }
function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number) { const r = 6_371_000; const rad = Math.PI / 180; const dLat = (bLat - aLat) * rad; const dLng = (bLng - aLng) * rad; const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2; return 2 * r * Math.asin(Math.sqrt(h)); }
function riyadhDate(value: Date) { const parts = new Intl.DateTimeFormat('en', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(value); const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }
function riyadhRange(from: string, to = from) { const parse = (value: string) => { const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value); if (!match) throw new BadRequestException('Invalid attendance business date.'); const [, y, m, d] = match; const instant = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)) - 3 * 60 * 60 * 1_000); if (Number.isNaN(instant.valueOf()) || riyadhDate(instant) !== value) throw new BadRequestException('Invalid attendance business date.'); return instant; }; const start = parse(from); const endStart = parse(to); if (endStart < start) throw new BadRequestException('Invalid attendance report range.'); return { start, end: new Date(endStart.valueOf() + 24 * 60 * 60 * 1_000) }; }
function minutesBetween(start: Date, end: Date) { return Math.max(0, Math.floor((end.valueOf() - start.valueOf()) / 60_000)); }

type EffectiveSchedule = { source: 'ROSTER' | 'EXCEPTION' | 'WEEKLY_ADJUSTMENT' | 'TEMPLATE' | 'NONE'; kind: AttendanceWeeklyAdjustmentKind | null; periods: Array<{ startTime: string; endTime: string; endsNextDay: boolean; minutes: number }> };
type ResolvedEffectiveSchedule = EffectiveSchedule & { employeeId: string; businessDate: string; templateId: string | null; templateVersionId: string | null };
type SessionEvidence = { status: AttendanceWorkSessionStatus; checkInAt: Date; checkOutAt: Date | null };
type DateInterval = { start: Date; end: Date };

function scheduleResolutionKey(employeeId: string, businessDate: string) { return `${employeeId}:${businessDate}`; }
function emptyEffectiveSchedule(employeeId: string, businessDate: string, templateId: string | null = null): ResolvedEffectiveSchedule { return { employeeId, businessDate, source: 'NONE', kind: null, templateId, templateVersionId: null, periods: [] }; }
function groupBy<T>(items: T[], key: (item: T) => string) { const result = new Map<string, T[]>(); for (const item of items) { const itemKey = key(item); result.set(itemKey, [...(result.get(itemKey) ?? []), item]); } return result; }

/**
 * Computes report-only planned-versus-actual facts. It deliberately exposes
 * `extraMinutes`, not approved overtime: approval and payroll remain manual.
 * Raw attendance rows are only read here, never changed.
 */
function evaluateAttendanceDay(businessDate: string, schedule: EffectiveSchedule, sessions: SessionEvidence[], now: Date) {
  const hasOpenSession = sessions.some((session) => session.status === AttendanceWorkSessionStatus.OPEN);
  // Only a currently plausible open shift may grow to `now`. A forgotten
  // historical session stays evidence requiring review, never a fabricated
  // multi-day worked/extra total in reports.
  const actual = unionIntervals(sessions.flatMap((session) => {
    const end = session.checkOutAt ?? (isOpenSessionStale(businessDate, schedule.periods, session.checkInAt, now) ? null : now);
    return end && end > session.checkInAt ? [{ start: session.checkInAt, end }] : [];
  }));
  if (schedule.source === 'NONE') return { businessDate, scheduleSource: schedule.source, scheduleKind: null, state: 'NO_SCHEDULE' as const, plannedMinutes: 0, workedMinutes: intervalMinutes(actual), lateMinutes: 0, earlyLeaveMinutes: 0, extraMinutes: 0, shortageMinutes: 0, hasOpenSession };
  if (schedule.kind === AttendanceWeeklyAdjustmentKind.FULL_REST) return { businessDate, scheduleSource: schedule.source, scheduleKind: schedule.kind, state: 'REST_DAY' as const, plannedMinutes: 0, workedMinutes: intervalMinutes(actual), lateMinutes: 0, earlyLeaveMinutes: 0, extraMinutes: intervalMinutes(actual), shortageMinutes: 0, hasOpenSession };
  const planned = schedule.periods.map((period) => periodToInterval(businessDate, period));
  const plannedMinutes = intervalMinutes(planned);
  const workedMinutes = intervalMinutes(actual);
  const matched = planned.map((period) => actual.filter((interval) => interval.start < period.end && interval.end > period.start));
  const attendedPlannedMinutes = matched.reduce((total, intervals, index) => total + intervals.reduce((sum, interval) => sum + overlapMinutes(interval, planned[index]!), 0), 0);
  const lateMinutes = matched.reduce((total, intervals, index) => {
    if (!intervals.length) return total;
    const first = intervals.reduce((earliest, interval) => interval.start < earliest.start ? interval : earliest);
    return total + Math.max(0, Math.min(minutesBetween(planned[index]!.start, first.start), minutesBetween(planned[index]!.start, planned[index]!.end)));
  }, 0);
  const earlyLeaveMinutes = matched.reduce((total, intervals, index) => {
    if (!intervals.length) return total;
    const last = intervals.reduce((latest, interval) => interval.end > latest.end ? interval : latest);
    return total + Math.max(0, Math.min(minutesBetween(last.end, planned[index]!.end), minutesBetween(planned[index]!.start, planned[index]!.end)));
  }, 0);
  const shortageMinutes = Math.max(0, plannedMinutes - attendedPlannedMinutes);
  const extraMinutes = Math.max(0, workedMinutes - attendedPlannedMinutes);
  const started = hasScheduleStarted(businessDate, schedule.periods, now);
  const staleOpen = sessions.some((session) => session.status === AttendanceWorkSessionStatus.OPEN && isOpenSessionStale(businessDate, schedule.periods, session.checkInAt, now));
  const state = staleOpen ? 'ATTENTION' as const : !actual.length ? (started ? 'MISSING_CHECK_IN' as const : 'ON_TIME' as const) : hasOpenSession ? 'IN_PROGRESS' as const : lateMinutes || earlyLeaveMinutes || shortageMinutes ? 'ATTENTION' as const : 'ON_TIME' as const;
  return { businessDate, scheduleSource: schedule.source, scheduleKind: schedule.kind, state, plannedMinutes, workedMinutes, lateMinutes, earlyLeaveMinutes, extraMinutes, shortageMinutes, hasOpenSession };
}

function periodToInterval(businessDate: string, period: EffectiveSchedule['periods'][number]) { return { start: riyadhMoment(businessDate, toMinute(period.startTime)), end: riyadhMoment(businessDate, toMinute(period.endTime), period.endsNextDay ? 1 : 0) }; }
function riyadhMoment(businessDate: string, minute: number, nextDay = 0) { const [year, month, day] = businessDate.split('-').map(Number); return new Date(Date.UTC(year!, month! - 1, day! + nextDay, 0, minute) - 3 * 60 * 60 * 1_000); }
function unionIntervals(intervals: DateInterval[]) { const sorted = intervals.slice().sort((a, b) => a.start.valueOf() - b.start.valueOf()); const result: DateInterval[] = []; for (const interval of sorted) { const previous = result.at(-1); if (previous && interval.start <= previous.end) { if (interval.end > previous.end) previous.end = interval.end; } else result.push({ ...interval }); } return result; }
function intervalMinutes(intervals: DateInterval[]) { return intervals.reduce((total, interval) => total + minutesBetween(interval.start, interval.end), 0); }
function overlapMinutes(a: DateInterval, b: DateInterval) { return minutesBetween(new Date(Math.max(a.start.valueOf(), b.start.valueOf())), new Date(Math.min(a.end.valueOf(), b.end.valueOf()))); }
function hasScheduleStarted(businessDate: string, periods: EffectiveSchedule['periods'], now: Date) { return periods.some((period) => riyadhMoment(businessDate, toMinute(period.startTime)) <= now); }
/** A stale session is never auto-closed by a later scan. The grace window
 * permits normal cross-midnight operations while protecting historical facts. */
function isOpenSessionStale(businessDate: string, periods: EffectiveSchedule['periods'], checkInAt: Date, now: Date) {
  const fallbackDeadline = new Date(checkInAt.valueOf() + 18 * 60 * 60 * 1_000);
  const plannedDeadline = periods.length ? new Date(Math.max(...periods.map((period) => periodToInterval(businessDate, period).end.valueOf())) + 4 * 60 * 60 * 1_000) : fallbackDeadline;
  return now > fallbackDeadline || now > plannedDeadline;
}
function businessDates(from: string, to: string) { const { start, end } = businessDateRange(from, to); const dates: string[] = []; for (let cursor = start; cursor < end; cursor = new Date(cursor.valueOf() + 24 * 60 * 60 * 1_000)) dates.push(dateOnly(cursor)); return dates; }

type CoverageInterval = { startMinute: number; endMinute: number };
function addBusinessDays(value: string, days: number) { const date = businessDateValue(value); date.setUTCDate(date.getUTCDate() + days); return dateOnly(date); }
function sundayAtOrBefore(value: string) { const date = businessDateValue(value); date.setUTCDate(date.getUTCDate() - date.getUTCDay()); return dateOnly(date); }
function coverageScheduleIntervals(schedule: EffectiveSchedule): CoverageInterval[] {
  return schedule.periods.map((period) => ({ startMinute: toMinute(period.startTime), endMinute: toMinute(period.endTime) + (period.endsNextDay ? 1_440 : 0) }));
}
function coverageActualIntervals(sessions: Array<{ checkInAt: Date; checkOutAt: Date | null }>, businessDate: string, now: Date, maxMinute = 1_440): CoverageInterval[] {
  const dayStart = riyadhMoment(businessDate, 0);
  const dayEnd = riyadhMoment(businessDate, maxMinute);
  const useNow = now > dayStart && now < dayEnd;
  return unionIntervals(sessions.flatMap((session) => {
    const end = session.checkOutAt ?? (useNow ? now : null);
    if (!end || end <= dayStart || session.checkInAt >= dayEnd) return [];
    const start = new Date(Math.max(session.checkInAt.valueOf(), dayStart.valueOf()));
    const clampedEnd = new Date(Math.min(end.valueOf(), dayEnd.valueOf()));
    if (clampedEnd <= start) return [];
    return [{ start, end: clampedEnd }];
  })).map((interval) => ({
    startMinute: Math.max(0, Math.floor((interval.start.valueOf() - dayStart.valueOf()) / 60_000)),
    endMinute: Math.min(maxMinute, Math.ceil((interval.end.valueOf() - dayStart.valueOf()) / 60_000)),
  }));
}
function coverageBucketCounts(intervals: CoverageInterval[], startMinute: number, bucketCount: number, intervalMinutes: number) {
  return Array.from({ length: bucketCount }, (_, index) => {
    const start = startMinute + index * intervalMinutes;
    const end = start + intervalMinutes;
    return intervals.filter((period) => period.startMinute < end && period.endMinute > start).length;
  });
}
function longestCoverageGap(counts: number[], startMinute: number, intervalMinutes: number) {
  const first = counts.findIndex((value) => value > 0);
  const last = counts.length - 1 - [...counts].reverse().findIndex((value) => value > 0);
  if (first < 0 || last <= first) return null;
  let best: { startMinute: number; endMinute: number; length: number } | null = null;
  let currentStart: number | null = null;
  for (let index = first; index <= last; index += 1) {
    if (counts[index] === 0 && currentStart === null) currentStart = index;
    if ((counts[index] !== 0 || index === last) && currentStart !== null) {
      const endIndex = counts[index] === 0 && index === last ? index + 1 : index;
      const length = endIndex - currentStart;
      if (!best || length > best.length) best = { startMinute: startMinute + currentStart * intervalMinutes, endMinute: startMinute + endIndex * intervalMinutes, length };
      currentStart = null;
    }
  }
  return best;
}
