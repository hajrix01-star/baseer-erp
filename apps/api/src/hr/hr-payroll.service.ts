import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type {
  ApproveHrPayrollRunRequest,
  DiscardHrPayrollRunRequest,
  ApproveHrCompensationPolicyVersionRequest,
  CreateHrCompensationPolicyRequest,
  CreateHrCompensationPolicyVersionRequest,
  CreateHrPayrollRunRequest,
  PreviewHrPayrollRunRequest,
  PayHrPayrollRunRequest,
  ReverseHrPayrollRunRequest,
  SetHrEmployeeCompensationRequest,
  OnboardHrEmployeeRequest,
} from '@baseer-erp/contracts';

import { BusinessDateService } from '../business-date/business-date.service.js';
import { DocumentSerialService } from '../core-controls/document-serial.service.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceAccountStatus,
  HrEmployeeAdministrativeDeductionActionType,
  HrEmployeeAdministrativeDeductionStatus,
  HrEmployeeAdvanceSettlementSource,
  HrEmployeeAdvanceStatus,
  HrEmployeeFinancialMovementType,
  HrEmployeeStatus,
  HrCompensationMethod,
  HrCompensationFormulaCode,
  HrCompensationPolicyVersionStatus,
  HrPayrollCalculationFormulaCode,
  HrPayrollLineEligibilityCode,
  HrPayrollRunStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { FinanceVaultService } from '../finance/finance-vault.service.js';
import { FinanceFoundationService } from '../finance/finance-foundation.service.js';
import { JournalPostingService } from '../finance/journal/journal-posting.service.js';
import { generateHrEmployeeNumber } from './hr-employee-number.util.js';
import { isHrDateOnOrAfter, isSameHrBusinessMonth, latestHrBusinessDate } from './hr-financial-date.util.js';
import { hrAdministrativeDeductionLockKey, hrEmployeeAdvanceLockKey, hrPayrollRunLockKey } from './hr-financial-lock.util.js';
import { hrReplayReceipt } from './hr-idempotency.util.js';

const COMPENSATION_OPERATION = 'hr.compensation.set';
const EMPLOYEE_ONBOARDING_OPERATION = 'hr.employee.onboard';
const POLICY_CREATE_OPERATION = 'hr.compensation_policy.create';
const POLICY_VERSION_OPERATION = 'hr.compensation_policy.version.create';
const POLICY_APPROVE_OPERATION = 'hr.compensation_policy.version.approve';
const CREATE_OPERATION = 'hr.payroll.create';
const APPROVE_OPERATION = 'hr.payroll.approve';
const DISCARD_OPERATION = 'hr.payroll.discard';
const PAY_OPERATION = 'hr.payroll.pay';
const REVERSE_OPERATION = 'hr.payroll.reverse';
const PAYROLL_EXPENSE = 'PAYROLL_EXPENSE';
const PAYROLL_PAYABLE = 'PAYROLL_PAYABLE';
const EMPLOYEE_ADVANCES = 'EMPLOYEE_ADVANCES';
const ADMIN_DEDUCTION_RECOVERY = 'EMPLOYEE_ADMIN_DEDUCTION_RECOVERY';

type CreateInput = Omit<CreateHrPayrollRunRequest, 'idempotencyKey'>;
type PreviewInput = PreviewHrPayrollRunRequest;
type ApproveInput = Omit<ApproveHrPayrollRunRequest, 'idempotencyKey'>;
type DiscardInput = Omit<DiscardHrPayrollRunRequest, 'idempotencyKey'>;
type PayInput = Omit<PayHrPayrollRunRequest, 'idempotencyKey'>;
type ReverseInput = Omit<ReverseHrPayrollRunRequest, 'idempotencyKey'>;
type CompensationInput = Omit<SetHrEmployeeCompensationRequest, 'idempotencyKey'>;
type EmployeeOnboardingInput = Omit<OnboardHrEmployeeRequest, 'idempotencyKey'>;
type CompensationPolicyCreateInput = Omit<CreateHrCompensationPolicyRequest, 'idempotencyKey'>;
type CompensationPolicyVersionInput = Omit<CreateHrCompensationPolicyVersionRequest, 'idempotencyKey'>;
type CompensationPolicyApprovalInput = Omit<ApproveHrCompensationPolicyVersionRequest, 'idempotencyKey'>;
type PayrollRunListQuery = Readonly<{ status?: HrPayrollRunStatus; cursor?: string; pageSize: number }>;
type PayrollRunDetailQuery = Readonly<{ lineCursor?: string; linePageSize: number; paymentCursor?: string; paymentPageSize: number }>;
type EmployeePayrollHistoryQuery = Readonly<{ cursor?: string; pageSize: number }>;
type PayrollCalculationPeriod = Readonly<{ calculationPeriodStart: Date; calculationPeriodEnd: Date; eligibleDays: number; calendarDaysInMonth: number; prorationRatio: Prisma.Decimal; eligibilityCode: HrPayrollLineEligibilityCode; formulaCode: HrPayrollCalculationFormulaCode }>;

@Injectable()
export class HrPayrollService {
  constructor(
    private readonly database: DatabaseService,
    private readonly dates: BusinessDateService,
    private readonly serials: DocumentSerialService,
    private readonly idempotency: IdempotencyService,
    private readonly vaults: FinanceVaultService,
    private readonly journals: JournalPostingService,
    private readonly foundation: FinanceFoundationService,
  ) {}

  async listCompensationPolicies(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const policies = await tx.hrCompensationPolicy.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        orderBy: { code: 'asc' },
        include: { versions: { orderBy: { versionNumber: 'desc' } } },
      });
      return { policies: policies.map((policy) => mapPolicy(policy)) };
    });
  }

  async createCompensationPolicy(context: TrustedCompanyActorContext, input: CompensationPolicyCreateInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const current = await this.dates.resolveInTransaction(tx, context, { kind: 'current' });
      assertNotPast(input.effectiveFrom, current.businessDate, 'A compensation policy cannot start in the past.');
      assertFirstDayOfMonth(input.effectiveFrom, 'A compensation policy must start on the first day of a month.');
      const begun = await this.begin(tx, context, POLICY_CREATE_OPERATION, key, input);
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; policyVersionId: string; replayed: boolean }>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The compensation policy request is already being processed.');
      const duplicate = await tx.hrCompensationPolicy.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, code: input.code }, select: { id: true } });
      if (duplicate) throw new ConflictException('The compensation policy code already exists for this company.');
      const id = randomUUID();
      const policyVersionId = randomUUID();
      await tx.hrCompensationPolicy.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, code: input.code.trim(), nameAr: input.nameAr.trim(), nameEn: nullable(input.nameEn), createdByUserId: context.actorUserId } });
      await tx.hrCompensationPolicyVersion.create({ data: { id: policyVersionId, tenantId: context.tenantId, companyId: context.companyId, policyId: id, versionNumber: 1, effectiveFrom: input.effectiveFrom, status: HrCompensationPolicyVersionStatus.DRAFT, formulaCode: HrCompensationFormulaCode.STANDARD_MONTHLY_V1, createdByUserId: context.actorUserId } });
      const receipt = { id, policyVersionId, replayed: false };
      await this.complete(tx, context, begun.receiptId, receipt);
      await this.audit(tx, context, 'hr.compensation_policy.created', 'HrCompensationPolicy', id, receipt);
      return receipt;
    });
  }

  async createCompensationPolicyVersion(context: TrustedCompanyActorContext, input: CompensationPolicyVersionInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const current = await this.dates.resolveInTransaction(tx, context, { kind: 'current' });
      assertNotPast(input.effectiveFrom, current.businessDate, 'A compensation policy version cannot start in the past.');
      assertFirstDayOfMonth(input.effectiveFrom, 'A compensation policy version must start on the first day of a month.');
      const begun = await this.begin(tx, context, POLICY_VERSION_OPERATION, key, input);
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; policyVersionId: string; replayed: boolean }>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The compensation policy version request is already being processed.');
      const policy = await tx.hrCompensationPolicy.findFirst({ where: { id: input.policyId, tenantId: context.tenantId, companyId: context.companyId }, include: { versions: { select: { versionNumber: true, effectiveFrom: true } } } });
      if (!policy) throw new NotFoundException('The compensation policy is not available for this company.');
      if (policy.versions.some((version) => version.effectiveFrom.getTime() === input.effectiveFrom.getTime())) throw new ConflictException('A policy version already starts on this effective date.');
      const policyVersionId = randomUUID();
      await tx.hrCompensationPolicyVersion.create({ data: { id: policyVersionId, tenantId: context.tenantId, companyId: context.companyId, policyId: policy.id, versionNumber: Math.max(0, ...policy.versions.map((version) => version.versionNumber)) + 1, effectiveFrom: input.effectiveFrom, status: HrCompensationPolicyVersionStatus.DRAFT, formulaCode: HrCompensationFormulaCode.STANDARD_MONTHLY_V1, createdByUserId: context.actorUserId } });
      const receipt = { id: policy.id, policyVersionId, replayed: false };
      await this.complete(tx, context, begun.receiptId, receipt);
      await this.audit(tx, context, 'hr.compensation_policy.version_created', 'HrCompensationPolicyVersion', policyVersionId, receipt);
      return receipt;
    });
  }

  async approveCompensationPolicyVersion(context: TrustedCompanyActorContext, input: CompensationPolicyApprovalInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const current = await this.dates.resolveInTransaction(tx, context, { kind: 'current' });
      const begun = await this.begin(tx, context, POLICY_APPROVE_OPERATION, key, input);
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; policyVersionId: string; replayed: boolean }>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The compensation policy approval is already being processed.');
      const target = await tx.hrCompensationPolicyVersion.findFirst({ where: { id: input.policyVersionId, tenantId: context.tenantId, companyId: context.companyId, status: HrCompensationPolicyVersionStatus.DRAFT }, select: { id: true, policyId: true, effectiveFrom: true } });
      if (!target) throw new NotFoundException('A draft compensation policy version was not found.');
      assertNotPast(target.effectiveFrom, current.businessDate, 'A past compensation policy version cannot be approved.');
      const conflicting = await tx.hrCompensationPolicyVersion.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, policyId: target.policyId, status: HrCompensationPolicyVersionStatus.APPROVED, effectiveFrom: { gte: target.effectiveFrom } }, select: { id: true } });
      if (conflicting) throw new ConflictException('An approved policy version already covers this date or a later scheduled date.');
      const preceding = await tx.hrCompensationPolicyVersion.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, policyId: target.policyId, status: HrCompensationPolicyVersionStatus.APPROVED, effectiveFrom: { lt: target.effectiveFrom }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: target.effectiveFrom } }] }, orderBy: { effectiveFrom: 'desc' } });
      if (preceding) await tx.hrCompensationPolicyVersion.update({ where: { id: preceding.id }, data: { effectiveTo: previousDay(target.effectiveFrom), status: HrCompensationPolicyVersionStatus.SUPERSEDED } });
      await tx.hrCompensationPolicyVersion.update({ where: { id: target.id }, data: { status: HrCompensationPolicyVersionStatus.APPROVED, approvedByUserId: context.actorUserId, approvedAt: new Date() } });
      const receipt = { id: target.policyId, policyVersionId: target.id, replayed: false };
      await this.complete(tx, context, begun.receiptId, receipt);
      await this.audit(tx, context, 'hr.compensation_policy.version_approved', 'HrCompensationPolicyVersion', target.id, receipt);
      return receipt;
    });
  }

  async setCompensation(context: TrustedCompanyActorContext, input: CompensationInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      // Serialise all effective-dated agreements for one employee. A generic
      // uniqueness key cannot protect range overlap when two future requests
      // race in separate transactions.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:employee-compensation:${input.employeeId}`}, 0))`;
      const currentDate = await this.dates.resolveInTransaction(tx, context, { kind: 'current' });
      const employee = await tx.hrEmployee.findFirst({ where: { id: input.employeeId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] } }, select: { id: true, hireDate: true } });
      if (!employee) throw new NotFoundException('The employee is not available for compensation.');
      const agreements = await tx.hrEmployeeCompensationProfile.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: input.employeeId },
        orderBy: { effectiveFrom: 'asc' },
      });
      const isFirstAgreementForCurrentMonthHire = agreements.length === 0
        && firstOfMonth(input.effectiveFrom).getTime() === firstOfMonth(employee.hireDate).getTime()
        && firstOfMonth(input.effectiveFrom).getTime() === firstOfMonth(new Date(`${currentDate.businessDate}T00:00:00.000Z`)).getTime();
      if (!isFirstAgreementForCurrentMonthHire) {
        assertNotPast(input.effectiveFrom, currentDate.businessDate, 'Compensation cannot start in the past. Create a future agreement instead.');
      }
      assertFirstDayOfMonth(input.effectiveFrom, 'A compensation agreement must start on the first day of a month.');
      const begun = await this.begin(tx, context, COMPENSATION_OPERATION, key, input);
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; replayed: boolean }>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The compensation request is already being processed.');
      const approvedRun = await tx.hrPayrollRun.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrPayrollRunStatus.APPROVED, HrPayrollRunStatus.PARTIALLY_PAID, HrPayrollRunStatus.PAID] }, payrollMonth: { gte: firstOfMonth(input.effectiveFrom) }, lines: { some: { employeeId: input.employeeId } } },
        select: { id: true },
      });
      if (approvedRun) throw new ConflictException('A compensation agreement cannot alter a month with an approved payroll run.');
      const policyVersion = await this.resolveCompensationPolicyVersion(tx, context, input.effectiveFrom, input.policyVersionId);
      if (agreements.some((agreement) => agreement.effectiveFrom.getTime() >= input.effectiveFrom.getTime())) {
        throw new ConflictException('A future compensation agreement already starts on or after this date. Agreements must be added chronologically.');
      }
      const overlapping = agreements.filter((agreement) => agreement.effectiveFrom.getTime() < input.effectiveFrom.getTime() && (!agreement.effectiveTo || agreement.effectiveTo.getTime() >= input.effectiveFrom.getTime()));
      if (overlapping.length > 1) throw new ConflictException('Existing compensation agreements overlap and must be repaired before adding another agreement.');
      const preceding = overlapping[0];
      if (preceding) await tx.hrEmployeeCompensationProfile.update({ where: { id: preceding.id }, data: { effectiveTo: previousDay(input.effectiveFrom) } });
      const compensation = calculateCompensation({
        monthlyGross: amount(input.monthlyGross),
        compensationMethod: input.compensationMethod,
        foodAllowance: nonNegativeAmount(input.foodAllowance),
        housingAllowance: nonNegativeAmount(input.housingAllowance),
        transportAllowance: nonNegativeAmount(input.transportAllowance),
        otherAllowance: nonNegativeAmount(input.otherAllowance),
        scheduledHoursPerDay: input.scheduledHoursPerDay ?? null,
        scheduledWorkDays: input.scheduledWorkDays ?? null,
      }, policyVersion.formulaCode);
      const id = randomUUID();
      await tx.hrEmployeeCompensationProfile.create({ data: {
        id, tenantId: context.tenantId, companyId: context.companyId, employeeId: input.employeeId, policyVersionId: policyVersion.id, effectiveFrom: input.effectiveFrom,
        monthlyGross: compensation.gross, compensationMethod: compensation.method, foodAllowance: compensation.foodAllowance,
        housingAllowance: compensation.housingAllowance, transportAllowance: compensation.transportAllowance, otherAllowance: compensation.otherAllowance, scheduledHoursPerDay: compensation.scheduledHoursPerDay,
        scheduledWorkDays: compensation.scheduledWorkDays, notes: nullable(input.notes), createdByUserId: context.actorUserId,
      } });
      const receipt = { id, replayed: false };
      await this.complete(tx, context, begun.receiptId, receipt);
      await this.audit(tx, context, 'hr.compensation.set', 'HrEmployeeCompensationProfile', id, receipt);
      return receipt;
    });
  }

  /** The first agreement belongs to the employee creation itself. Keeping both
   * writes in one transaction prevents an employee record without a salary
   * agreement when a later request fails. */
  async onboardEmployee(context: TrustedCompanyActorContext, input: EmployeeOnboardingInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.begin(tx, context, EMPLOYEE_ONBOARDING_OPERATION, key, input);
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; compensationId: string; replayed: boolean }>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The employee onboarding request is already being processed.');

      const [currentDate, employeeNumber] = await Promise.all([
        this.dates.resolveInTransaction(tx, context, { kind: 'current' }),
        generateHrEmployeeNumber(tx, context.companyId),
      ]);
      const duplicate = await tx.hrEmployee.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeNumber }, select: { id: true } });
      if (duplicate) throw new ConflictException('Employee-number generation conflicted. Please submit the employee again.');

      const effectiveFrom = firstOfMonth(input.hireDate);
      const currentMonth = firstOfMonth(new Date(`${currentDate.businessDate}T00:00:00.000Z`));
      if (effectiveFrom.getTime() !== currentMonth.getTime()) {
        assertNotPast(effectiveFrom, currentDate.businessDate, 'Compensation cannot start in the past. Choose a hire date in the current month or create the employee without payroll onboarding.');
      }

      const employeeId = randomUUID();
      const employee = await tx.hrEmployee.create({ data: {
        id: employeeId, tenantId: context.tenantId, companyId: context.companyId, employeeNumber,
        nameAr: input.nameAr.trim(), nameEn: nullable(input.nameEn), jobTitle: nullable(input.jobTitle),
        phone: nullable(input.phone), email: nullable(input.email), iqamaNumber: nullable(input.iqamaNumber),
        workSchedule: nullable(input.workSchedule), hireDate: input.hireDate, notes: nullable(input.notes),
      } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:employee-compensation:${employeeId}`}, 0))`;
      const policyVersion = await this.resolveCompensationPolicyVersion(tx, context, effectiveFrom, input.initialCompensation.policyVersionId);
      const compensation = calculateCompensation({
        monthlyGross: amount(input.initialCompensation.monthlyGross), compensationMethod: input.initialCompensation.compensationMethod,
        foodAllowance: nonNegativeAmount(input.initialCompensation.foodAllowance), housingAllowance: nonNegativeAmount(input.initialCompensation.housingAllowance),
        transportAllowance: nonNegativeAmount(input.initialCompensation.transportAllowance), otherAllowance: nonNegativeAmount(input.initialCompensation.otherAllowance),
        scheduledHoursPerDay: input.initialCompensation.scheduledHoursPerDay ?? null, scheduledWorkDays: input.initialCompensation.scheduledWorkDays ?? null,
      }, policyVersion.formulaCode);
      const compensationId = randomUUID();
      await tx.hrEmployeeCompensationProfile.create({ data: {
        id: compensationId, tenantId: context.tenantId, companyId: context.companyId, employeeId, policyVersionId: policyVersion.id, effectiveFrom,
        monthlyGross: compensation.gross, compensationMethod: compensation.method, foodAllowance: compensation.foodAllowance,
        housingAllowance: compensation.housingAllowance, transportAllowance: compensation.transportAllowance, otherAllowance: compensation.otherAllowance,
        scheduledHoursPerDay: compensation.scheduledHoursPerDay, scheduledWorkDays: compensation.scheduledWorkDays,
        notes: nullable(input.initialCompensation.notes), createdByUserId: context.actorUserId,
      } });
      const receipt = { id: employeeId, compensationId, replayed: false };
      await this.audit(tx, context, 'hr.employee.created', 'HrEmployee', employeeId, { employeeNumber: employee.employeeNumber, onboarding: true });
      await this.audit(tx, context, 'hr.compensation.set', 'HrEmployeeCompensationProfile', compensationId, receipt);
      await this.complete(tx, context, begun.receiptId, receipt);
      return receipt;
    });
  }

  async list(context: TrustedCompanyActorContext, query: PayrollRunListQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const runScope: Prisma.HrPayrollRunWhereInput = { tenantId: context.tenantId, companyId: context.companyId, ...(query.status ? { status: query.status } : {}) };
      const cursor = query.cursor ? await tx.hrPayrollRun.findFirst({ where: { id: query.cursor, ...runScope }, select: { id: true, payrollMonth: true } }) : null;
      if (query.cursor && !cursor) throw new BadRequestException('The payroll-run cursor is invalid.');
      const rows = await tx.hrPayrollRun.findMany({
        where: {
          ...runScope,
          ...(cursor ? { OR: [{ payrollMonth: { lt: cursor.payrollMonth } }, { payrollMonth: cursor.payrollMonth, id: { lt: cursor.id } }] } : {}),
        },
        orderBy: [{ payrollMonth: 'desc' }, { id: 'desc' }],
        take: query.pageSize + 1,
      });
      const hasMore = rows.length > query.pageSize;
      const runs = hasMore ? rows.slice(0, query.pageSize) : rows;
      return { payrollRuns: runs.map(mapRun), hasMore, nextCursor: hasMore ? runs.at(-1)?.id ?? null : null };
    });
  }

  async listForEmployee(context: TrustedCompanyActorContext, employeeId: string, query: EmployeePayrollHistoryQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const employee = await tx.hrEmployee.findFirst({ where: { id: employeeId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true } });
      if (!employee) throw new NotFoundException('The employee is not available for this company.');
      const cursor = query.cursor ? await tx.hrPayrollLine.findFirst({
        where: { id: query.cursor, tenantId: context.tenantId, companyId: context.companyId, employeeId },
        select: { id: true, payrollRun: { select: { payrollMonth: true } } },
      }) : null;
      if (query.cursor && !cursor) throw new BadRequestException('The employee-payroll cursor is invalid.');
      const rows = await tx.hrPayrollLine.findMany({
        where: {
          tenantId: context.tenantId, companyId: context.companyId, employeeId,
          ...(cursor ? { OR: [{ payrollRun: { payrollMonth: { lt: cursor.payrollRun.payrollMonth } } }, { payrollRun: { payrollMonth: cursor.payrollRun.payrollMonth }, id: { lt: cursor.id } }] } : {}),
        },
        orderBy: [{ payrollRun: { payrollMonth: 'desc' } }, { id: 'desc' }],
        take: query.pageSize + 1,
        include: { payrollRun: { select: { id: true, runNumber: true, payrollMonth: true, businessDate: true, status: true } } },
      });
      const hasMore = rows.length > query.pageSize;
      const lines = hasMore ? rows.slice(0, query.pageSize) : rows;
      return {
        lines: lines.map((line) => ({
          id: line.id, employeeId: line.employeeId, employeeNumber: line.employeeNumberSnapshot, employeeNameAr: line.employeeNameArSnapshot, employeeNameEn: line.employeeNameEnSnapshot,
          grossSalary: fixed(line.grossSalary), eligibilityCode: line.eligibilityCode, compensationMethod: line.compensationMethod,
          basicSalary: fixed(line.basicSalary), foodAllowance: fixed(line.foodAllowance), housingAllowance: fixed(line.housingAllowance), transportAllowance: fixed(line.transportAllowance), otherAllowance: fixed(line.otherAllowance), overtimeAmount: fixed(line.overtimeAmount), overtimeHours: fixed(line.overtimeHours),
          scheduledHoursPerDay: line.scheduledHoursPerDay, scheduledWorkDays: line.scheduledWorkDays,
          compensationPolicySnapshot: compensationPolicySnapshot(line.compensationPolicySnapshotJson),
          payrollCalculationSnapshot: parsePayrollCalculationSnapshot(line.payrollCalculationSnapshotJson),
          advanceSettlementAmount: fixed(line.advanceSettlementAmount), administrativeDeductionAmount: fixed(line.administrativeDeductionAmount), netPayableAmount: fixed(line.netPayableAmount), paidAmount: fixed(line.paidAmount), advances: [], administrativeDeductions: [],
          payrollRunId: line.payrollRun.id, runNumber: line.payrollRun.runNumber, payrollMonth: ymd(line.payrollRun.payrollMonth), businessDate: ymd(line.payrollRun.businessDate), payrollStatus: line.payrollRun.status,
        })),
        hasMore,
        nextCursor: hasMore ? lines.at(-1)?.id ?? null : null,
      };
    });
  }

  async detail(context: TrustedCompanyActorContext, payrollRunId: string, query: PayrollRunDetailQuery = { linePageSize: 1_000, paymentPageSize: 500 }) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const scope = { tenantId: context.tenantId, companyId: context.companyId, payrollRunId } as const;
      const run = await tx.hrPayrollRun.findFirst({ where: { id: payrollRunId, tenantId: context.tenantId, companyId: context.companyId } });
      if (!run) throw new NotFoundException('The payroll run was not found.');
      const [lineCursor, paymentCursor] = await Promise.all([
        query.lineCursor ? tx.hrPayrollLine.findFirst({ where: { id: query.lineCursor, ...scope }, select: { id: true, employeeNumberSnapshot: true } }) : null,
        query.paymentCursor ? tx.hrPayrollPayment.findFirst({ where: { id: query.paymentCursor, ...scope }, select: { id: true, businessDate: true } }) : null,
      ]);
      if (query.lineCursor && !lineCursor) throw new BadRequestException('The payroll-line cursor is invalid for this run.');
      if (query.paymentCursor && !paymentCursor) throw new BadRequestException('The payroll-payment cursor is invalid for this run.');
      const [lineRows, paymentRows] = await Promise.all([
        tx.hrPayrollLine.findMany({
          where: { ...scope, ...(lineCursor ? { OR: [{ employeeNumberSnapshot: { gt: lineCursor.employeeNumberSnapshot } }, { employeeNumberSnapshot: lineCursor.employeeNumberSnapshot, id: { gt: lineCursor.id } }] } : {}) },
          orderBy: [{ employeeNumberSnapshot: 'asc' }, { id: 'asc' }],
          take: query.linePageSize + 1,
          include: {
            advanceApplications: { include: { advance: { select: { advanceNumber: true } } } },
            deductionApplications: { include: { deduction: { select: { deductionNumber: true } } } },
          },
        }),
        tx.hrPayrollPayment.findMany({
          where: { ...scope, ...(paymentCursor ? { OR: [{ businessDate: { lt: paymentCursor.businessDate } }, { businessDate: paymentCursor.businessDate, id: { lt: paymentCursor.id } }] } : {}) },
          orderBy: [{ businessDate: 'desc' }, { id: 'desc' }],
          take: query.paymentPageSize + 1,
        }),
      ]);
      const hasMoreLines = lineRows.length > query.linePageSize;
      const lines = hasMoreLines ? lineRows.slice(0, query.linePageSize) : lineRows;
      const hasMorePayments = paymentRows.length > query.paymentPageSize;
      const payments = hasMorePayments ? paymentRows.slice(0, query.paymentPageSize) : paymentRows;
      return {
        payrollRun: mapRun(run),
        lines: lines.map((line) => ({
          id: line.id, employeeId: line.employeeId, employeeNumber: line.employeeNumberSnapshot, employeeNameAr: line.employeeNameArSnapshot, employeeNameEn: line.employeeNameEnSnapshot,
          grossSalary: fixed(line.grossSalary), eligibilityCode: line.eligibilityCode, compensationMethod: line.compensationMethod,
          basicSalary: fixed(line.basicSalary), foodAllowance: fixed(line.foodAllowance), housingAllowance: fixed(line.housingAllowance), transportAllowance: fixed(line.transportAllowance), otherAllowance: fixed(line.otherAllowance), overtimeAmount: fixed(line.overtimeAmount), overtimeHours: fixed(line.overtimeHours),
          scheduledHoursPerDay: line.scheduledHoursPerDay, scheduledWorkDays: line.scheduledWorkDays,
          compensationPolicySnapshot: compensationPolicySnapshot(line.compensationPolicySnapshotJson),
          payrollCalculationSnapshot: parsePayrollCalculationSnapshot(line.payrollCalculationSnapshotJson),
          advanceSettlementAmount: fixed(line.advanceSettlementAmount), administrativeDeductionAmount: fixed(line.administrativeDeductionAmount), netPayableAmount: fixed(line.netPayableAmount), paidAmount: fixed(line.paidAmount),
          advances: line.advanceApplications.map((app) => ({ id: app.id, amount: fixed(app.amount), referenceNumber: app.advance.advanceNumber })),
          administrativeDeductions: line.deductionApplications.map((app) => ({ id: app.id, amount: fixed(app.amount), referenceNumber: app.deduction.deductionNumber })),
        })),
        payments: payments.map((payment) => ({ id: payment.id, paymentNumber: payment.paymentNumber, businessDate: ymd(payment.businessDate), amount: fixed(payment.amount), journalEntryId: payment.journalEntryId })),
        hasMoreLines,
        nextLineCursor: hasMoreLines ? lines.at(-1)?.id ?? null : null,
        hasMorePayments,
        nextPaymentCursor: hasMorePayments ? payments.at(-1)?.id ?? null : null,
      };
    });
  }

  /**
   * Preview is deliberately read-only: it shows the server's population and
   * currently available settlements, but create recalculates both inside its
   * own transaction.  Browser input never determines the ACTIVE population.
   */
  async preview(context: TrustedCompanyActorContext, input: PreviewInput) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const currentDate = await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const payrollMonth = firstOfMonth(input.payrollMonth);
      if (ymd(payrollMonth).slice(0, 7) !== currentDate.businessDate.slice(0, 7)) throw new BadRequestException('Payroll preview is available only for the current operational business month.');
      if (!isSameHrBusinessMonth(input.businessDate, payrollMonth)) throw new BadRequestException('The payroll business date must belong to the payroll month.');
      return this.previewPopulation(tx, context, payrollMonth, input, input.businessDate);
    });
  }

  async create(context: TrustedCompanyActorContext, input: CreateInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const currentDate = await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const begun = await this.begin(tx, context, CREATE_OPERATION, key, input);
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; runNumber: string; replayed: boolean }>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The payroll creation request is already being processed.');
      const payrollMonth = firstOfMonth(input.payrollMonth);
      if (ymd(payrollMonth).slice(0, 7) !== currentDate.businessDate.slice(0, 7)) throw new BadRequestException('A payroll run can be created only for the current operational business month.');
      if (!isSameHrBusinessMonth(input.businessDate, payrollMonth)) throw new BadRequestException('The payroll business date must belong to the payroll month.');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:payroll:${ymd(payrollMonth)}`}, 0))`;
      const existing = await tx.hrPayrollRun.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, payrollMonth }, select: { id: true } });
      if (existing) throw new ConflictException('A payroll run already exists for this month.');
      const population = await this.loadPayrollPopulation(tx, context, payrollMonth, input.businessDate, input.includeOnLeaveEmployeeIds);
      const employees = population.employees;
      if (population.hiredAfterBusinessDate.length) throw new BadRequestException(`Employees hired after the payroll business date cannot be included: ${population.hiredAfterBusinessDate.slice(0, 10).map((employee) => employee.employeeNumber).join(', ')}.`);
      if (population.compensationCoverageIssue.length) throw new BadRequestException(`Compensation agreements must cover the entire payroll calculation period: ${population.compensationCoverageIssue.slice(0, 10).map((employee) => employee.employeeNumber).join(', ')}.`);
      if (population.activeMissingProfile.length) throw new BadRequestException(`Active employees without a valid monthly compensation agreement: ${population.activeMissingProfile.slice(0, 10).map((employee) => employee.employeeNumber).join(', ')}.`);
      if (population.onLeaveMissingProfile.length) throw new BadRequestException(`Included employees on leave without a valid monthly compensation agreement: ${population.onLeaveMissingProfile.slice(0, 10).map((employee) => employee.employeeNumber).join(', ')}.`);
      if (!employees.length) throw new BadRequestException('No active employees with a valid compensation agreement are available for this payroll run.');
      const requestedEmployeeIds = [...new Set(input.lines.map((line) => line.employeeId))];
      if (requestedEmployeeIds.length !== input.lines.length) throw new BadRequestException('An employee can appear once in payroll settlement applications.');
      const requestedLines = new Map(input.lines.map((line) => [line.employeeId, line]));
      const eligibleIds = new Set(employees.map((employee) => employee.id));
      if (requestedEmployeeIds.some((employeeId) => !eligibleIds.has(employeeId))) throw new BadRequestException('Settlement applications can only target an employee included by the server in this payroll run.');
      const lines = employees.map((employee) => requestedLines.get(employee.id) ?? { employeeId: employee.id, advances: [], administrativeDeductions: [] });
      const uniqueEmployeeIds = employees.map((employee) => employee.id);
      const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
      const profileByEmployee = population.profileByEmployee;
      const applicationsByEmployee = await this.resolvePayrollApplications(tx, context, lines);
      const runId = randomUUID();
      const serial = await this.serials.reserveInTransaction(tx, context, { series: 'PAYROLL_RUN', businessDate: ymd(input.businessDate) });
      const runNumber = `PAY-${ymd(payrollMonth).slice(0, 7).replace('-', '')}-${serial.toString().padStart(4, '0')}`;
      const defaultPolicyVersion = await this.ensureDefaultCompensationPolicyVersion(tx, context);
      const rows = lines.map((line) => {
        const employee = employeeById.get(line.employeeId)!;
        const profile = profileByEmployee.get(line.employeeId)!;
        const policyVersion = profile.policyVersion ?? defaultPolicyVersion;
        if (policyVersion.status !== HrCompensationPolicyVersionStatus.APPROVED && policyVersion.status !== HrCompensationPolicyVersionStatus.SUPERSEDED) throw new ConflictException('A payroll compensation agreement must reference an approved policy version.');
        const fullCompensation = calculateCompensation(profile, policyVersion.formulaCode);
        const period = population.periodByEmployee.get(employee.id)!;
        const compensation = prorateCompensation(fullCompensation, period);
        const gross = compensation.gross;
        const applications = applicationsByEmployee.get(line.employeeId)!;
        const advances = applications.advances;
        const deductions = applications.deductions;
        const advanceAmount = sum(advances.map((item) => item.amount));
        const deductionAmount = sum(deductions.map((item) => item.amount));
        if (advanceAmount.plus(deductionAmount).gt(gross)) throw new BadRequestException('Employee deductions cannot exceed the gross salary.');
        const calculationSnapshot = payrollCalculationSnapshot(period, profile.monthlyGross);
        return { id: randomUUID(), employee, compensation, policyVersion, eligibilityCode: period.eligibilityCode, calculationSnapshot, gross, advances, deductions, advanceAmount, deductionAmount, net: gross.minus(advanceAmount).minus(deductionAmount) };
      });
      const grossAmount = sum(rows.map((row) => row.gross));
      const advanceSettlementAmount = sum(rows.map((row) => row.advanceAmount));
      const administrativeDeductionAmount = sum(rows.map((row) => row.deductionAmount));
      const netPayableAmount = grossAmount.minus(advanceSettlementAmount).minus(administrativeDeductionAmount);
      await tx.hrPayrollRun.create({ data: { id: runId, tenantId: context.tenantId, companyId: context.companyId, runNumber, payrollMonth, businessDate: input.businessDate, employeeCount: rows.length, grossAmount, advanceSettlementAmount, administrativeDeductionAmount, netPayableAmount, notes: nullable(input.notes), createdByUserId: context.actorUserId } });
      for (const rowChunk of chunks(rows, 500)) await tx.hrPayrollLine.createMany({ data: rowChunk.map((row) => ({
          id: row.id, tenantId: context.tenantId, companyId: context.companyId, payrollRunId: runId, employeeId: row.employee.id,
          employeeNumberSnapshot: row.employee.employeeNumber, employeeNameArSnapshot: row.employee.nameAr, employeeNameEnSnapshot: row.employee.nameEn,
          compensationPolicyVersionId: row.policyVersion.id, compensationPolicySnapshotJson: policySnapshot(row.policyVersion) as Prisma.InputJsonValue, payrollCalculationSnapshotJson: row.calculationSnapshot as Prisma.InputJsonValue,
          grossSalary: row.gross, eligibilityCode: row.eligibilityCode, compensationMethod: row.compensation.method, basicSalary: row.compensation.basicSalary,
          foodAllowance: row.compensation.foodAllowance, housingAllowance: row.compensation.housingAllowance, transportAllowance: row.compensation.transportAllowance, otherAllowance: row.compensation.otherAllowance,
          overtimeAmount: row.compensation.overtimeAmount, overtimeHours: row.compensation.overtimeHours,
          scheduledHoursPerDay: row.compensation.scheduledHoursPerDay, scheduledWorkDays: row.compensation.scheduledWorkDays,
          advanceSettlementAmount: row.advanceAmount, administrativeDeductionAmount: row.deductionAmount, netPayableAmount: row.net,
      })) });
      const advanceApplications = rows.flatMap((row) => row.advances.map((app) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, payrollLineId: row.id, advanceId: app.id, amount: app.amount })));
      const deductionApplications = rows.flatMap((row) => row.deductions.map((app) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, payrollLineId: row.id, deductionId: app.id, amount: app.amount })));
      for (const applicationChunk of chunks(advanceApplications, 500)) await tx.hrPayrollAdvanceApplication.createMany({ data: applicationChunk });
      for (const applicationChunk of chunks(deductionApplications, 500)) await tx.hrPayrollAdministrativeDeductionApplication.createMany({ data: applicationChunk });
      const receipt = { id: runId, runNumber, replayed: false };
      await this.complete(tx, context, begun.receiptId, receipt);
      await this.audit(tx, context, 'hr.payroll.created', 'HrPayrollRun', runId, { ...receipt, includedEmployeeCount: rows.length, includeOnLeaveEmployeeIds: input.includeOnLeaveEmployeeIds });
      return receipt;
    });
  }

  async approve(context: TrustedCompanyActorContext, input: ApproveInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const begun = await this.begin(tx, context, APPROVE_OPERATION, key, input);
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; runNumber: string; replayed: boolean }>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The payroll approval is already being processed.');
      await this.lockPayrollRun(tx, context, input.payrollRunId);
      const run = await this.findRun(tx, context, input.payrollRunId, true);
      if (run.status !== HrPayrollRunStatus.DRAFT) throw new ConflictException('Only a draft payroll run can be approved.');
      if (!isHrDateOnOrAfter(input.businessDate, run.businessDate)) throw new BadRequestException('The payroll approval date cannot be before the payroll business date.');
      // Older or newly created companies may not yet have all payroll accounts.
      // Initialising here is idempotent and runs in this same transaction before
      // the first payroll accrual; it never changes an existing journal entry.
      await this.foundation.initializeInTransaction(tx, context);
      const accounts = await this.systemAccounts(tx, context, [PAYROLL_EXPENSE, PAYROLL_PAYABLE, EMPLOYEE_ADVANCES, ADMIN_DEDUCTION_RECOVERY]);
      const journal = await this.journals.postInTransaction(tx, { tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, requestId: `payroll-accrual:${run.id}`, sourceType: 'hr_payroll_accrual', sourceReference: run.id, businessDate: input.businessDate, description: `Payroll accrual ${run.runNumber}`, lines: [
        { accountId: accounts.get(PAYROLL_EXPENSE)!, debitAmount: fixed(run.grossAmount), description: run.runNumber },
        ...(run.advanceSettlementAmount.gt(0) ? [{ accountId: accounts.get(EMPLOYEE_ADVANCES)!, creditAmount: fixed(run.advanceSettlementAmount), description: `${run.runNumber} advance settlements` }] : []),
        ...(run.administrativeDeductionAmount.gt(0) ? [{ accountId: accounts.get(ADMIN_DEDUCTION_RECOVERY)!, creditAmount: fixed(run.administrativeDeductionAmount), description: `${run.runNumber} administrative recoveries` }] : []),
        ...(run.netPayableAmount.gt(0) ? [{ accountId: accounts.get(PAYROLL_PAYABLE)!, creditAmount: fixed(run.netPayableAmount), description: `${run.runNumber} net payroll payable` }] : []),
      ] });
      for (const line of run.lines) {
        for (const app of line.advanceApplications) await this.applyAdvance(tx, context, app.advanceId, app.amount, input.businessDate, journal.journalEntryId, run.runNumber);
        for (const app of line.deductionApplications) await this.applyDeduction(tx, context, app.deductionId, app.amount, input.businessDate, run.runNumber);
        await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId: line.employeeId, journalEntryId: journal.journalEntryId, movementType: HrEmployeeFinancialMovementType.PAYROLL_ACCRUAL, businessDate: input.businessDate, amount: line.grossSalary, sourceReference: run.runNumber, description: 'Payroll accrued' } });
      }
      await tx.hrPayrollRun.update({ where: { id: run.id }, data: { status: HrPayrollRunStatus.APPROVED, accrualJournalEntryId: journal.journalEntryId, approvedAt: new Date() } });
      const receipt = { id: run.id, runNumber: run.runNumber, replayed: false };
      await this.complete(tx, context, begun.receiptId, receipt);
      await this.audit(tx, context, 'hr.payroll.approved', 'HrPayrollRun', run.id, { ...receipt, businessDate: ymd(input.businessDate), journalEntryId: journal.journalEntryId });
      return receipt;
    });
  }

  /** Drafts have no posted journal, so discarding them is safe and leaves no financial history. */
  async discard(context: TrustedCompanyActorContext, input: DiscardInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.begin(tx, context, DISCARD_OPERATION, key, input);
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; runNumber: string; replayed: boolean }>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The payroll discard is already being processed.');
      await this.lockPayrollRun(tx, context, input.payrollRunId);
      const run = await this.findRun(tx, context, input.payrollRunId, false);
      if (run.status !== HrPayrollRunStatus.DRAFT) throw new ConflictException('Only a draft payroll run can be discarded.');
      const lineIds = run.lines.map((line) => line.id);
      if (lineIds.length) {
        await tx.hrPayrollAdvanceApplication.deleteMany({ where: { tenantId: context.tenantId, companyId: context.companyId, payrollLineId: { in: lineIds } } });
        await tx.hrPayrollAdministrativeDeductionApplication.deleteMany({ where: { tenantId: context.tenantId, companyId: context.companyId, payrollLineId: { in: lineIds } } });
        await tx.hrPayrollLine.deleteMany({ where: { tenantId: context.tenantId, companyId: context.companyId, payrollRunId: run.id } });
      }
      await tx.hrPayrollRun.delete({ where: { id: run.id } });
      const receipt = { id: run.id, runNumber: run.runNumber, replayed: false };
      await this.complete(tx, context, begun.receiptId, receipt);
      await this.audit(tx, context, 'hr.payroll.discarded', 'HrPayrollRun', run.id, receipt);
      return receipt;
    });
  }

  async pay(context: TrustedCompanyActorContext, input: PayInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const begun = await this.begin(tx, context, PAY_OPERATION, key, input);
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; runNumber: string; replayed: boolean }>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The payroll payment is already being processed.');
      // Lifecycle commands share one lock so payments cannot calculate their
      // remaining payable from the same snapshot or race an accrual reversal.
      await this.lockPayrollRun(tx, context, input.payrollRunId);
      const run = await this.findRun(tx, context, input.payrollRunId, true);
      if (run.status !== HrPayrollRunStatus.APPROVED && run.status !== HrPayrollRunStatus.PARTIALLY_PAID) throw new ConflictException('Only an approved unpaid payroll can be paid.');
      const paymentFloor = latestHrBusinessDate(run.accrualJournal?.businessDate, run.payments[0]?.businessDate);
      if (!paymentFloor) throw new ConflictException('The payroll accrual is missing.');
      if (!isHrDateOnOrAfter(input.businessDate, paymentFloor)) throw new BadRequestException('The payroll payment date cannot be before its approval or latest payment date.');
      await this.foundation.initializeInTransaction(tx, context);
      const allocations = await this.validateAllocations(tx, context, input.allocations);
      const paymentAmount = sum(allocations.map((allocation) => allocation.amount));
      const remaining = run.netPayableAmount.minus(run.paidAmount);
      if (paymentAmount.gt(remaining)) throw new BadRequestException('Payroll payment cannot exceed the unpaid net amount.');
      const account = await this.systemAccounts(tx, context, [PAYROLL_PAYABLE]);
      const serial = await this.serials.reserveInTransaction(tx, context, { series: 'PAYROLL_PAYMENT', businessDate: ymd(input.businessDate) });
      const paymentNumber = `PPY-${serial.toString().padStart(6, '0')}`;
      const journal = await this.journals.postInTransaction(tx, { tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, requestId: `payroll-payment:${paymentNumber}`, sourceType: 'hr_payroll_payment', sourceReference: paymentNumber, businessDate: input.businessDate, description: `Payroll payment ${run.runNumber}`, lines: [{ accountId: account.get(PAYROLL_PAYABLE)!, debitAmount: fixed(paymentAmount), description: run.runNumber }, ...allocations.map((allocation) => ({ accountId: allocation.accountId, creditAmount: fixed(allocation.amount), description: paymentNumber }))] });
      const paymentId = randomUUID();
      await tx.hrPayrollPayment.create({ data: { id: paymentId, tenantId: context.tenantId, companyId: context.companyId, payrollRunId: run.id, paymentNumber, businessDate: input.businessDate, amount: paymentAmount, journalEntryId: journal.journalEntryId, createdByUserId: context.actorUserId } });
      await tx.hrPayrollPaymentAllocation.createMany({ data: allocations.map((allocation) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, payrollPaymentId: paymentId, vaultId: allocation.vaultId, paymentMethod: allocation.paymentMethod, amount: allocation.amount })) });
      let remainder = paymentAmount;
      for (const line of run.lines) {
        if (remainder.lte(0)) break;
        const lineRemaining = line.netPayableAmount.minus(line.paidAmount);
        const paid = Prisma.Decimal.min(lineRemaining, remainder);
        if (paid.lte(0)) continue;
        await tx.hrPayrollLine.update({ where: { id: line.id }, data: { paidAmount: { increment: paid } } });
        await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId: line.employeeId, journalEntryId: journal.journalEntryId, movementType: HrEmployeeFinancialMovementType.PAYROLL_PAYMENT, businessDate: input.businessDate, amount: paid, sourceReference: paymentNumber, description: `Payroll payment ${run.runNumber}` } });
        remainder = remainder.minus(paid);
      }
      const nowPaid = run.paidAmount.plus(paymentAmount);
      await tx.hrPayrollRun.update({ where: { id: run.id }, data: { paidAmount: nowPaid, status: nowPaid.eq(run.netPayableAmount) ? HrPayrollRunStatus.PAID : HrPayrollRunStatus.PARTIALLY_PAID } });
      const receipt = { id: run.id, runNumber: run.runNumber, replayed: false };
      await this.complete(tx, context, begun.receiptId, receipt);
      await this.audit(tx, context, 'hr.payroll.paid', 'HrPayrollRun', run.id, { ...receipt, paymentNumber, journalEntryId: journal.journalEntryId });
      return receipt;
    });
  }

  async reverse(context: TrustedCompanyActorContext, input: ReverseInput, key: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const begun = await this.begin(tx, context, REVERSE_OPERATION, key, input);
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; runNumber: string; replayed: boolean }>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The payroll reversal is already being processed.');
      await this.lockPayrollRun(tx, context, input.payrollRunId);
      const run = await this.findRun(tx, context, input.payrollRunId, true);
      if (run.status !== HrPayrollRunStatus.APPROVED) throw new ConflictException('A payroll must be unpaid before its accrual can be reversed.');
      if (run.payments.length) throw new ConflictException('A payroll with payment history cannot be reversed as unpaid.');
      if (!run.accrualJournalEntryId) throw new ConflictException('The payroll accrual is missing.');
      if (!run.accrualJournal || !isHrDateOnOrAfter(input.businessDate, run.accrualJournal.businessDate)) throw new BadRequestException('The payroll reversal date cannot be before its approval date.');
      const reversalJournal = await this.journals.reverseInTransaction(tx, { tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, requestId: `payroll-reversal:${run.id}`, journalEntryId: run.accrualJournalEntryId, businessDate: input.businessDate, reason: input.reason });
      for (const line of run.lines) {
        await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId: line.employeeId, journalEntryId: reversalJournal.journalEntryId, movementType: HrEmployeeFinancialMovementType.PAYROLL_ACCRUAL, businessDate: input.businessDate, amount: line.grossSalary.negated(), sourceReference: `${run.runNumber}-REV`, description: `Payroll accrual reversed: ${input.reason}` } });
        for (const app of line.advanceApplications) await this.reverseAdvance(tx, context, app.advanceId, app.amount, input.businessDate, reversalJournal.journalEntryId, run.runNumber);
        for (const app of line.deductionApplications) await this.reverseDeduction(tx, context, app.deductionId, app.amount, input.businessDate, run.runNumber, input.reason);
      }
      await tx.hrPayrollRun.update({ where: { id: run.id }, data: { status: HrPayrollRunStatus.REVERSED, reversedAt: new Date(), reversalReason: input.reason } });
      const receipt = { id: run.id, runNumber: run.runNumber, replayed: false };
      await this.complete(tx, context, begun.receiptId, receipt);
      await this.audit(tx, context, 'hr.payroll.reversed', 'HrPayrollRun', run.id, { ...receipt, reversalJournalEntryId: reversalJournal.journalEntryId });
      return receipt;
    });
  }

  private async loadPayrollPopulation(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, payrollMonth: Date, businessDate: Date, requestedOnLeaveEmployeeIds: readonly string[]) {
    const onLeaveEmployeeIds = uniqueIds(requestedOnLeaveEmployeeIds, 'An employee on leave can be included once.');
    const explicitOnLeave = onLeaveEmployeeIds.length ? await tx.hrEmployee.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId, id: { in: onLeaveEmployeeIds } },
      select: { id: true, employeeNumber: true, nameAr: true, nameEn: true, status: true, hireDate: true },
    }) : [];
    if (explicitOnLeave.length !== onLeaveEmployeeIds.length || explicitOnLeave.some((employee) => employee.status !== HrEmployeeStatus.ON_LEAVE)) {
      throw new BadRequestException('includeOnLeaveEmployeeIds may contain only current ON_LEAVE employees in this company.');
    }
    const active = await this.listEmployeesByStatus(tx, context, HrEmployeeStatus.ACTIVE);
    const monthStart = firstOfMonth(payrollMonth);
    const candidates = [...new Map([...active, ...explicitOnLeave].map((employee) => [employee.id, employee])).values()];
    const hiredAfterBusinessDate = candidates.filter((employee) => employee.hireDate > businessDate);
    const employees = candidates.filter((employee) => employee.hireDate <= businessDate).sort((left, right) => left.id.localeCompare(right.id));
    const fullMonthEnd = lastDayOfMonth(payrollMonth);
    const periodByEmployee = new Map<string, PayrollCalculationPeriod>(employees.map((employee) => {
      const isNewHire = employee.hireDate > monthStart;
      const calendarDaysInMonth = daysInMonth(payrollMonth);
      const eligibleDays = isNewHire ? inclusiveDays(employee.hireDate, businessDate) : calendarDaysInMonth;
      const prorationRatio = new Prisma.Decimal(eligibleDays).div(calendarDaysInMonth).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      return [employee.id, { calculationPeriodStart: isNewHire ? employee.hireDate : payrollMonth, calculationPeriodEnd: isNewHire ? businessDate : fullMonthEnd, eligibleDays, calendarDaysInMonth, prorationRatio, eligibilityCode: isNewHire ? HrPayrollLineEligibilityCode.PRORATED_NEW_HIRE_V1 : employee.status === HrEmployeeStatus.ON_LEAVE ? HrPayrollLineEligibilityCode.FULL_MONTH_ON_LEAVE_EXCEPTION_V1 : HrPayrollLineEligibilityCode.FULL_MONTH_V1, formulaCode: isNewHire ? HrPayrollCalculationFormulaCode.PRORATED_NEW_HIRE_V1 : HrPayrollCalculationFormulaCode.FULL_MONTH_V1 }] as const;
    }));
    const profiles = await this.findProfilesForPeriods(tx, context, periodByEmployee);
    const activeMissingProfile = active.filter((employee) => employees.some((included) => included.id === employee.id) && !profiles.profileByEmployee.has(employee.id) && !profiles.incompleteCoverageEmployeeIds.has(employee.id));
    const onLeaveMissingProfile = explicitOnLeave.filter((employee) => employees.some((included) => included.id === employee.id) && !profiles.profileByEmployee.has(employee.id) && !profiles.incompleteCoverageEmployeeIds.has(employee.id));
    const compensationCoverageIssue = employees.filter((employee) => profiles.incompleteCoverageEmployeeIds.has(employee.id));
    return { employees, profileByEmployee: profiles.profileByEmployee, periodByEmployee, activeEmployees: active, activeMissingProfile, onLeaveMissingProfile, compensationCoverageIssue, hiredAfterBusinessDate };
  }

  private async previewPopulation(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, payrollMonth: Date, input: PreviewInput, businessDate: Date) {
    const population = await this.loadPayrollPopulation(tx, context, payrollMonth, businessDate, input.includeOnLeaveEmployeeIds);
    const onLeaveEmployeeIds = uniqueIds(input.includeOnLeaveEmployeeIds, 'An employee on leave can be included once.');
    const base = { tenantId: context.tenantId, companyId: context.companyId };
    const onLeave = await tx.hrEmployee.count({ where: { ...base, status: HrEmployeeStatus.ON_LEAVE } });
    const missingExamples = population.activeMissingProfile.slice(0, 100);
    const active = population.activeEmployees.length;
    const activeWithProfile = population.employees.filter((employee) => employee.status === HrEmployeeStatus.ACTIVE && population.profileByEmployee.has(employee.id)).length;
    const includedOnLeaveWithProfile = population.employees.filter((employee) => employee.status === HrEmployeeStatus.ON_LEAVE && population.profileByEmployee.has(employee.id)).length;
    const previewCursor = input.cursor ? await tx.hrEmployee.findFirst({
      where: { id: input.cursor, ...base, status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] } },
      select: { id: true },
    }) : null;
    if (input.cursor && !previewCursor) throw new BadRequestException('The payroll-preview cursor is invalid for this company and population.');
    const page = await tx.hrEmployee.findMany({
      where: { ...base, status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] } },
      orderBy: { id: 'asc' }, take: input.pageSize + 1,
      ...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
      select: { id: true, employeeNumber: true, nameAr: true, nameEn: true, status: true, hireDate: true },
    });
    const hasMore = page.length > input.pageSize;
    const employeesPage = hasMore ? page.slice(0, input.pageSize) : page;
    const profileByEmployee = population.profileByEmployee;
    const employeeIds = employeesPage.map((employee) => employee.id);
    const [advances, deductions] = await Promise.all([
      employeeIds.length ? tx.hrEmployeeAdvance.findMany({ where: { ...base, employeeId: { in: employeeIds }, status: { in: [HrEmployeeAdvanceStatus.ISSUED, HrEmployeeAdvanceStatus.PARTIALLY_SETTLED] } }, orderBy: { id: 'asc' }, select: { id: true, employeeId: true, advanceNumber: true, remainingAmount: true } }) : [],
      employeeIds.length ? tx.hrEmployeeAdministrativeDeduction.findMany({ where: { ...base, employeeId: { in: employeeIds }, status: { in: [HrEmployeeAdministrativeDeductionStatus.OPEN, HrEmployeeAdministrativeDeductionStatus.PARTIALLY_APPLIED, HrEmployeeAdministrativeDeductionStatus.DEFERRED] } }, orderBy: { id: 'asc' }, select: { id: true, employeeId: true, deductionNumber: true, remainingAmount: true } }) : [],
    ]);
    const advancesByEmployee = groupByEmployee(advances, (row) => ({ id: row.id, referenceNumber: row.advanceNumber, remainingAmount: fixed(row.remainingAmount) }));
    const deductionsByEmployee = groupByEmployee(deductions, (row) => ({ id: row.id, referenceNumber: row.deductionNumber, remainingAmount: fixed(row.remainingAmount) }));
    const included = activeWithProfile + includedOnLeaveWithProfile;
    const requestedEmployeeIds = uniqueIds(input.lines.map((line) => line.employeeId), 'An employee can appear once in payroll settlement applications.');
    const eligibleIds = new Set(population.employees.filter((employee) => population.profileByEmployee.has(employee.id)).map((employee) => employee.id));
    if (requestedEmployeeIds.some((employeeId) => !eligibleIds.has(employeeId))) throw new BadRequestException('Settlement applications can only target an employee included by the server in this payroll preview.');
    const calculatedByEmployee = new Map([...population.profileByEmployee.entries()].map(([employeeId, profile]) => [employeeId, prorateCompensation(calculateCompensation(profile, profile.policyVersion?.formulaCode ?? HrCompensationFormulaCode.STANDARD_MONTHLY_V1), population.periodByEmployee.get(employeeId)!)]));
    const selectedApplications = await this.resolvePayrollApplications(tx, context, input.lines);
    const selectedAdvanceAmount = sum([...selectedApplications.values()].flatMap((selection) => selection.advances.map((application) => application.amount)));
    const selectedDeductionAmount = sum([...selectedApplications.values()].flatMap((selection) => selection.deductions.map((application) => application.amount)));
    for (const [employeeId, selection] of selectedApplications) {
      const gross = calculatedByEmployee.get(employeeId)?.gross;
      if (gross && sum(selection.advances.map((application) => application.amount)).plus(sum(selection.deductions.map((application) => application.amount))).gt(gross)) throw new BadRequestException('Employee deductions cannot exceed the gross salary.');
    }
    const grossAmount = sum([...calculatedByEmployee.values()].map((compensation) => compensation.gross));
    return {
      counts: { active, onLeave, included, excluded: active + onLeave - included, exceptions: population.activeMissingProfile.length + population.onLeaveMissingProfile.length + population.compensationCoverageIssue.length + population.hiredAfterBusinessDate.length },
      totals: { employeeCount: included, grossAmount: fixed(grossAmount), advanceSettlementAmount: fixed(selectedAdvanceAmount), administrativeDeductionAmount: fixed(selectedDeductionAmount), netPayableAmount: fixed(grossAmount.minus(selectedAdvanceAmount).minus(selectedDeductionAmount)) },
      exceptions: [...missingExamples.map((employee) => ({ employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, reason: 'ACTIVE_MISSING_COMPENSATION' as const })), ...population.onLeaveMissingProfile.map((employee) => ({ employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, reason: 'ON_LEAVE_MISSING_COMPENSATION' as const })), ...population.compensationCoverageIssue.map((employee) => ({ employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, reason: 'COMPENSATION_DOES_NOT_COVER_PAYROLL_PERIOD' as const })), ...population.hiredAfterBusinessDate.map((employee) => ({ employeeId: employee.id, employeeNumber: employee.employeeNumber, employeeNameAr: employee.nameAr, reason: 'HIRED_AFTER_BUSINESS_DATE' as const }))].slice(0, 100),
      employees: employeesPage.map((employee) => {
        const hasProfile = profileByEmployee.has(employee.id);
        const onLeave = employee.status === HrEmployeeStatus.ON_LEAVE;
        const explicitlyIncluded = onLeaveEmployeeIds.includes(employee.id);
        const afterBusinessDate = employee.hireDate > businessDate;
        const period = population.periodByEmployee.get(employee.id);
        const coverageIssue = population.compensationCoverageIssue.some((candidate) => candidate.id === employee.id);
        const compensation = calculatedByEmployee.get(employee.id);
        const reason = afterBusinessDate ? 'HIRED_AFTER_BUSINESS_DATE'
          : coverageIssue ? 'COMPENSATION_DOES_NOT_COVER_PAYROLL_PERIOD'
          : period?.eligibilityCode === HrPayrollLineEligibilityCode.PRORATED_NEW_HIRE_V1 && hasProfile ? 'ACTIVE_NEW_HIRE_PRORATED'
          : employee.status === HrEmployeeStatus.ACTIVE ? (hasProfile ? 'ACTIVE_WITH_VALID_COMPENSATION' : 'ACTIVE_MISSING_COMPENSATION')
          : (!explicitlyIncluded ? 'ON_LEAVE_REQUIRES_EXPLICIT_INCLUSION' : (hasProfile ? 'ON_LEAVE_EXPLICITLY_INCLUDED' : 'ON_LEAVE_MISSING_COMPENSATION'));
        return { id: employee.id, employeeNumber: employee.employeeNumber, nameAr: employee.nameAr, nameEn: employee.nameEn, status: employee.status, included: Boolean(compensation) && !afterBusinessDate && !coverageIssue && (!onLeave || explicitlyIncluded), reason, eligibilityCode: period?.eligibilityCode ?? null, calculationPeriodStart: period ? ymd(period.calculationPeriodStart) : null, calculationPeriodEnd: period ? ymd(period.calculationPeriodEnd) : null, eligibleDays: period?.eligibleDays ?? null, calendarDaysInMonth: period?.calendarDaysInMonth ?? null, prorationRatio: period ? fixed(period.prorationRatio) : null, monthlyGrossAmount: profileByEmployee.get(employee.id) ? fixed(profileByEmployee.get(employee.id)!.monthlyGross) : null, estimatedGrossAmount: compensation ? fixed(compensation.gross) : null, advances: (advancesByEmployee.get(employee.id) ?? []).slice(0, 100), administrativeDeductions: (deductionsByEmployee.get(employee.id) ?? []).slice(0, 100) };
      }),
      hasMore, nextCursor: hasMore ? employeesPage.at(-1)!.id : null,
    };
  }

  private async listEmployeesByStatus(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, status: HrEmployeeStatus) {
    const employees: Array<{ id: string; employeeNumber: string; nameAr: string; nameEn: string | null; status: HrEmployeeStatus; hireDate: Date }> = [];
    let cursor: string | undefined;
    do {
      const page = await tx.hrEmployee.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status }, orderBy: { id: 'asc' }, take: 500, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), select: { id: true, employeeNumber: true, nameAr: true, nameEn: true, status: true, hireDate: true } });
      employees.push(...page); cursor = page.length === 500 ? page.at(-1)?.id : undefined;
    } while (cursor);
    return employees;
  }

  private async findProfilesForPeriods(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, periods: ReadonlyMap<string, PayrollCalculationPeriod>) {
    const profileByEmployee = new Map<string, Prisma.HrEmployeeCompensationProfileGetPayload<{ include: { policyVersion: { include: { policy: true } } } }>>();
    const incompleteCoverageEmployeeIds = new Set<string>();
    for (const employeeChunk of chunks([...periods.keys()], 500)) {
      const profiles = await tx.hrEmployeeCompensationProfile.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, employeeId: { in: employeeChunk }, effectiveFrom: { lte: maxPeriodEnd(periods, employeeChunk) }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: minPeriodStart(periods, employeeChunk) } }] }, orderBy: [{ employeeId: 'asc' }, { effectiveFrom: 'desc' }], include: { policyVersion: { include: { policy: true } } } });
      const profilesByEmployee = new Map<string, typeof profiles>();
      for (const profile of profiles) { const current = profilesByEmployee.get(profile.employeeId) ?? []; current.push(profile); profilesByEmployee.set(profile.employeeId, current); }
      for (const employeeId of employeeChunk) {
        const period = periods.get(employeeId)!;
        const candidates = profilesByEmployee.get(employeeId) ?? [];
        const covering = candidates.filter((profile) => profile.effectiveFrom <= period.calculationPeriodStart && (!profile.effectiveTo || profile.effectiveTo >= period.calculationPeriodEnd));
        if (covering.length > 1) throw new ConflictException('Employee compensation agreements overlap for the payroll calculation period.');
        if (covering.length === 1) profileByEmployee.set(employeeId, covering[0]!);
        else if (candidates.length) incompleteCoverageEmployeeIds.add(employeeId);
      }
    }
    return { profileByEmployee, incompleteCoverageEmployeeIds };
  }

  private async resolvePayrollApplications(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, lines: readonly { employeeId: string; advances: readonly { id: string; amount: string }[]; administrativeDeductions: readonly { id: string; amount: string }[] }[]) {
    const advanceRequests = lines.flatMap((line) => line.advances.map((application) => ({ ...application, employeeId: line.employeeId })));
    const deductionRequests = lines.flatMap((line) => line.administrativeDeductions.map((application) => ({ ...application, employeeId: line.employeeId })));
    const advanceIds = uniqueIds(advanceRequests.map((application) => application.id), 'An advance can be selected once per payroll run.');
    const deductionIds = uniqueIds(deductionRequests.map((application) => application.id), 'An administrative deduction can be selected once per payroll run.');
    const advances = [] as Array<{ id: string; employeeId: string; remainingAmount: Prisma.Decimal }>;
    const deductions = [] as Array<{ id: string; employeeId: string; remainingAmount: Prisma.Decimal }>;
    for (const ids of chunks(advanceIds, 500)) advances.push(...await tx.hrEmployeeAdvance.findMany({ where: { id: { in: ids }, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeAdvanceStatus.ISSUED, HrEmployeeAdvanceStatus.PARTIALLY_SETTLED] } }, select: { id: true, employeeId: true, remainingAmount: true } }));
    for (const ids of chunks(deductionIds, 500)) deductions.push(...await tx.hrEmployeeAdministrativeDeduction.findMany({ where: { id: { in: ids }, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeAdministrativeDeductionStatus.OPEN, HrEmployeeAdministrativeDeductionStatus.PARTIALLY_APPLIED, HrEmployeeAdministrativeDeductionStatus.DEFERRED] } }, select: { id: true, employeeId: true, remainingAmount: true } }));
    if (advances.length !== advanceIds.length || deductions.length !== deductionIds.length) throw new BadRequestException('A selected advance or administrative deduction is unavailable.');
    const advanceById = new Map(advances.map((advance) => [advance.id, advance]));
    const deductionById = new Map(deductions.map((deduction) => [deduction.id, deduction]));
    const result = new Map<string, { advances: Array<{ id: string; amount: Prisma.Decimal }>; deductions: Array<{ id: string; amount: Prisma.Decimal }> }>();
    for (const line of lines) result.set(line.employeeId, { advances: [], deductions: [] });
    for (const application of advanceRequests) { const advance = advanceById.get(application.id)!; const value = amount(application.amount); if (advance.employeeId !== application.employeeId || value.gt(advance.remainingAmount)) throw new BadRequestException('Advance settlement is unavailable for the selected employee or exceeds its balance.'); result.get(application.employeeId)!.advances.push({ id: application.id, amount: value }); }
    for (const application of deductionRequests) { const deduction = deductionById.get(application.id)!; const value = amount(application.amount); if (deduction.employeeId !== application.employeeId || value.gt(deduction.remainingAmount)) throw new BadRequestException('Administrative deduction is unavailable for the selected employee or exceeds its balance.'); result.get(application.employeeId)!.deductions.push({ id: application.id, amount: value }); }
    return result;
  }

  private async findRun(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, id: string, _detail = true) {
    const run = await tx.hrPayrollRun.findFirst({
      where: { id, tenantId: context.tenantId, companyId: context.companyId },
      include: {
        accrualJournal: { select: { businessDate: true } },
        lines: {
          orderBy: { employeeNumberSnapshot: 'asc' },
          include: {
            advanceApplications: { include: { advance: { select: { advanceNumber: true } } } },
            deductionApplications: { include: { deduction: { select: { deductionNumber: true } } } },
          },
        },
        payments: { orderBy: [{ businessDate: 'desc' }, { id: 'desc' }] },
      },
    });
    if (!run) throw new NotFoundException('The payroll run was not found.');
    return run;
  }

  private async resolveAdvanceApplications(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, employeeId: string, applications: readonly { id: string; amount: string }[]) {
    const ids = applications.map((item) => item.id); if (new Set(ids).size !== ids.length) throw new BadRequestException('An advance can be selected once per employee.');
    if (!ids.length) return [] as Array<{ id: string; amount: Prisma.Decimal }>;
    const advances = await tx.hrEmployeeAdvance.findMany({ where: { id: { in: ids }, tenantId: context.tenantId, companyId: context.companyId, employeeId, status: { in: [HrEmployeeAdvanceStatus.ISSUED, HrEmployeeAdvanceStatus.PARTIALLY_SETTLED] } }, select: { id: true, remainingAmount: true } });
    if (advances.length !== ids.length) throw new BadRequestException('A selected advance is unavailable for this employee.');
    const balances = new Map(advances.map((advance) => [advance.id, advance.remainingAmount]));
    return applications.map((item) => { const value = amount(item.amount); if (value.gt(balances.get(item.id)!)) throw new BadRequestException('Advance settlement exceeds its remaining balance.'); return { id: item.id, amount: value }; });
  }

  private async resolveDeductionApplications(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, employeeId: string, applications: readonly { id: string; amount: string }[]) {
    const ids = applications.map((item) => item.id); if (new Set(ids).size !== ids.length) throw new BadRequestException('An administrative deduction can be selected once per employee.');
    if (!ids.length) return [] as Array<{ id: string; amount: Prisma.Decimal }>;
    const deductions = await tx.hrEmployeeAdministrativeDeduction.findMany({ where: { id: { in: ids }, tenantId: context.tenantId, companyId: context.companyId, employeeId, status: { in: [HrEmployeeAdministrativeDeductionStatus.OPEN, HrEmployeeAdministrativeDeductionStatus.PARTIALLY_APPLIED, HrEmployeeAdministrativeDeductionStatus.DEFERRED] } }, select: { id: true, remainingAmount: true } });
    if (deductions.length !== ids.length) throw new BadRequestException('A selected administrative deduction is unavailable for this employee.');
    const balances = new Map(deductions.map((deduction) => [deduction.id, deduction.remainingAmount]));
    return applications.map((item) => { const value = amount(item.amount); if (value.gt(balances.get(item.id)!)) throw new BadRequestException('Administrative deduction exceeds its remaining balance.'); return { id: item.id, amount: value }; });
  }

  private async applyAdvance(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, advanceId: string, applied: Prisma.Decimal, businessDate: Date, journalEntryId: string, reference: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hrEmployeeAdvanceLockKey(context.tenantId, context.companyId, advanceId)}, 0))`;
    const advance = await tx.hrEmployeeAdvance.findFirst({ where: { id: advanceId, tenantId: context.tenantId, companyId: context.companyId } });
    if (!advance || advance.remainingAmount.lt(applied)) throw new ConflictException('An advance changed before payroll approval.');
    if (!isHrDateOnOrAfter(businessDate, advance.businessDate)) throw new BadRequestException('A payroll advance settlement cannot predate the employee-advance issue.');
    const remaining = advance.remainingAmount.minus(applied);
    await tx.hrEmployeeAdvance.update({ where: { id: advanceId }, data: { settledAmount: { increment: applied }, remainingAmount: remaining, nextSettlementDate: null, status: remaining.eq(0) ? HrEmployeeAdvanceStatus.SETTLED : HrEmployeeAdvanceStatus.PARTIALLY_SETTLED } });
    await tx.hrEmployeeAdvanceSettlement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, advanceId, source: HrEmployeeAdvanceSettlementSource.PAYROLL, businessDate, amount: applied, journalEntryId } });
  }

  private async applyDeduction(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, deductionId: string, applied: Prisma.Decimal, businessDate: Date, reference: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hrAdministrativeDeductionLockKey(context.tenantId, context.companyId, deductionId)}, 0))`;
    const deduction = await tx.hrEmployeeAdministrativeDeduction.findFirst({ where: { id: deductionId, tenantId: context.tenantId, companyId: context.companyId } });
    if (!deduction || deduction.remainingAmount.lt(applied)) throw new ConflictException('An administrative deduction changed before payroll approval.');
    const remaining = deduction.remainingAmount.minus(applied);
    await tx.hrEmployeeAdministrativeDeduction.update({ where: { id: deductionId }, data: { appliedAmount: { increment: applied }, remainingAmount: remaining, plannedPayrollDate: null, status: remaining.eq(0) ? HrEmployeeAdministrativeDeductionStatus.APPLIED : HrEmployeeAdministrativeDeductionStatus.PARTIALLY_APPLIED } });
    await tx.hrEmployeeAdministrativeDeductionAction.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, deductionId, actionType: HrEmployeeAdministrativeDeductionActionType.APPLIED, businessDate, amount: applied, reason: reference, createdByUserId: context.actorUserId } });
  }

  private async reverseAdvance(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, advanceId: string, applied: Prisma.Decimal, businessDate: Date, journalEntryId: string, reference: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hrEmployeeAdvanceLockKey(context.tenantId, context.companyId, advanceId)}, 0))`;
    const advance = await tx.hrEmployeeAdvance.findFirst({ where: { id: advanceId, tenantId: context.tenantId, companyId: context.companyId } });
    if (!advance || advance.settledAmount.lt(applied)) throw new ConflictException('Advance settlement cannot be reversed safely.');
    const remaining = advance.remainingAmount.plus(applied);
    await tx.hrEmployeeAdvance.update({ where: { id: advanceId }, data: { settledAmount: { decrement: applied }, remainingAmount: remaining, status: advance.settledAmount.eq(applied) ? HrEmployeeAdvanceStatus.ISSUED : HrEmployeeAdvanceStatus.PARTIALLY_SETTLED } });
    await tx.hrEmployeeAdvanceSettlement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, advanceId, source: HrEmployeeAdvanceSettlementSource.PAYROLL, businessDate, amount: applied.negated(), journalEntryId } });
  }

  private async reverseDeduction(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, deductionId: string, applied: Prisma.Decimal, businessDate: Date, reference: string, reason: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hrAdministrativeDeductionLockKey(context.tenantId, context.companyId, deductionId)}, 0))`;
    const deduction = await tx.hrEmployeeAdministrativeDeduction.findFirst({ where: { id: deductionId, tenantId: context.tenantId, companyId: context.companyId } });
    if (!deduction || deduction.appliedAmount.lt(applied)) throw new ConflictException('Administrative deduction cannot be reversed safely.');
    const remaining = deduction.remainingAmount.plus(applied);
    await tx.hrEmployeeAdministrativeDeduction.update({ where: { id: deductionId }, data: { appliedAmount: { decrement: applied }, remainingAmount: remaining, status: deduction.appliedAmount.eq(applied) ? HrEmployeeAdministrativeDeductionStatus.OPEN : HrEmployeeAdministrativeDeductionStatus.PARTIALLY_APPLIED } });
    await tx.hrEmployeeAdministrativeDeductionAction.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, deductionId, actionType: HrEmployeeAdministrativeDeductionActionType.REVERSED, businessDate, amount: applied, reason: `${reference}: ${reason}`, createdByUserId: context.actorUserId } });
  }

  private async resolveCompensationPolicyVersion(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, effectiveFrom: Date, requestedPolicyVersionId: string | undefined) {
    if (!requestedPolicyVersionId) return this.ensureDefaultCompensationPolicyVersion(tx, context);
    const version = await tx.hrCompensationPolicyVersion.findFirst({
      where: { id: requestedPolicyVersionId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrCompensationPolicyVersionStatus.APPROVED, HrCompensationPolicyVersionStatus.SUPERSEDED] }, effectiveFrom: { lte: effectiveFrom }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: effectiveFrom } }] },
      include: { policy: true },
    });
    if (!version) throw new BadRequestException('Choose an approved company compensation policy version effective on the agreement date.');
    return version;
  }

  /** A read-only system policy preserves existing companies while keeping the
   * formula server-owned. Custom company policies remain explicit and require
   * an approval step before an employee agreement may select them. */
  private async ensureDefaultCompensationPolicyVersion(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:compensation-default-policy`}, 0))`;
    const existing = await tx.hrCompensationPolicyVersion.findFirst({
      where: { tenantId: context.tenantId, companyId: context.companyId, status: HrCompensationPolicyVersionStatus.APPROVED, policy: { code: 'BASEER_STANDARD' } },
      include: { policy: true },
    });
    if (existing) return existing;

    // Older companies can already have the system policy shell (or an
    // unfinished draft) without an approved version. Do not try to create
    // the same company/code again: that would violate the policy key and turn
    // an ordinary employee onboarding request into a server error.
    const policy = await tx.hrCompensationPolicy.findFirst({
      where: { tenantId: context.tenantId, companyId: context.companyId, code: 'BASEER_STANDARD' },
      select: { id: true },
    });
    const policyId = policy?.id ?? randomUUID();
    if (!policy) await tx.hrCompensationPolicy.create({ data: {
      id: policyId, tenantId: context.tenantId, companyId: context.companyId, code: 'BASEER_STANDARD', nameAr: 'السياسة القياسية لبصير', nameEn: 'Baseer standard policy', createdByUserId: context.actorUserId,
    } });

    const [latestVersion, occupiedDefaultDate] = await Promise.all([
      tx.hrCompensationPolicyVersion.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, policyId }, orderBy: { versionNumber: 'desc' }, select: { versionNumber: true } }),
      tx.hrCompensationPolicyVersion.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, policyId, effectiveFrom: new Date('2000-01-01T00:00:00.000Z') }, select: { id: true } }),
    ]);
    return tx.hrCompensationPolicyVersion.create({ data: {
      id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, policyId, versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
      // A legacy draft may already occupy the original system start date.
      // The next day remains effective for every live company and preserves
      // the draft for an explicit policy workflow.
      effectiveFrom: occupiedDefaultDate ? new Date('2000-01-02T00:00:00.000Z') : new Date('2000-01-01T00:00:00.000Z'), status: HrCompensationPolicyVersionStatus.APPROVED,
      formulaCode: HrCompensationFormulaCode.STANDARD_MONTHLY_V1, approvedByUserId: context.actorUserId, approvedAt: new Date(), createdByUserId: context.actorUserId,
    }, include: { policy: true } });
  }

  private async validateAllocations(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, allocations: readonly { vaultId: string; amount: string; paymentMethod?: 'CASH' | 'BANK_TRANSFER' | 'BANK_CARD' | 'BANK_PAYMENT' | 'APP' | undefined }[]) {
    const used = new Set<string>();
    const result: Array<{ vaultId: string; accountId: string; amount: Prisma.Decimal; paymentMethod: 'CASH' | 'BANK_TRANSFER' | 'BANK_CARD' | 'BANK_PAYMENT' | 'APP' }> = [];
    for (const allocation of allocations) {
      const vault = await this.vaults.assertActivePaymentDestination(tx, { tenantId: context.tenantId, companyId: context.companyId, vaultId: allocation.vaultId });
      const paymentMethod = allocation.paymentMethod ?? vault.paymentMethod;
      if (!vault.paymentMethods.includes(paymentMethod)) throw new BadRequestException('The payment method is not enabled for the selected vault.');
      const duplicate = `${allocation.vaultId}:${paymentMethod}`; if (used.has(duplicate)) throw new BadRequestException('A vault/payment method can appear once in a payroll payment.'); used.add(duplicate);
      result.push({ vaultId: allocation.vaultId, accountId: vault.accountId, amount: amount(allocation.amount), paymentMethod });
    }
    return result;
  }

  private async systemAccounts(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, keys: readonly string[]) {
    const accounts = await tx.financeAccount.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, systemKey: { in: [...keys] }, status: FinanceAccountStatus.ACTIVE }, select: { systemKey: true, id: true } });
    if (accounts.length !== keys.length) throw new ConflictException('The company finance foundation is missing a required payroll account.');
    return new Map(accounts.map((account) => [account.systemKey!, account.id]));
  }

  private async begin(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, operation: string, key: string, request: object) {
    try { return await this.idempotency.beginInTransaction(tx, context, { operation, key, request: jsonPayload(request), expiresAt: tomorrow() }); }
    catch (error) { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with a different payroll request.'); throw error; }
  }
  private async complete(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, receiptId: string, body: object) { await this.idempotency.completeInTransaction(tx, context, { receiptId, response: { status: 201, headers: null, body: body as never } }); }
  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityType: string, entityId: string, afterJson: object) { await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType, entityId, requestId: `${action}:${entityId}`, afterJson: afterJson as Prisma.InputJsonValue } }); }
  private async lockPayrollRun(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, payrollRunId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hrPayrollRunLockKey(context.tenantId, context.companyId, payrollRunId)}, 0))`;
  }
}

function amount(value: string) { const parsed = new Prisma.Decimal(value); if (!parsed.isFinite() || parsed.lte(0) || (parsed.decimalPlaces() ?? 0) > 4) throw new BadRequestException('A payroll amount must be a positive decimal with at most four places.'); return parsed; }
function nonNegativeAmount(value: string) { const parsed = new Prisma.Decimal(value); if (!parsed.isFinite() || parsed.lt(0) || (parsed.decimalPlaces() ?? 0) > 4) throw new BadRequestException('A compensation allowance must be a non-negative decimal with at most four places.'); return parsed; }
function jsonPayload(value: unknown): never { return JSON.parse(JSON.stringify(value)) as never; }
function sum(values: readonly Prisma.Decimal[]) { return values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0)); }
function fixed(value: Prisma.Decimal) { return value.toFixed(4); }
function nullable(value: string | undefined) { const text = value?.trim(); return text || null; }
function uniqueIds(values: readonly string[], message: string) { const unique = [...new Set(values)]; if (unique.length !== values.length) throw new BadRequestException(message); return unique; }
function chunks<T>(values: readonly T[], size: number) { const result: T[][] = []; for (let index = 0; index < values.length; index += size) result.push([...values.slice(index, index + size)]); return result; }
function groupByEmployee<T extends { employeeId: string }, V>(values: readonly T[], map: (value: T) => V) { const grouped = new Map<string, V[]>(); for (const value of values) { const current = grouped.get(value.employeeId) ?? []; if (current.length < 100) current.push(map(value)); grouped.set(value.employeeId, current); } return grouped; }
const STANDARD_MONTHLY_HOURS = new Prisma.Decimal(208);
const STANDARD_MONTHLY_DAYS = 26;

type CompensationInputForCalculation = Readonly<{
  monthlyGross: Prisma.Decimal;
  compensationMethod: HrCompensationMethod;
  foodAllowance: Prisma.Decimal;
  housingAllowance: Prisma.Decimal;
  transportAllowance: Prisma.Decimal;
  otherAllowance: Prisma.Decimal;
  scheduledHoursPerDay: number | null;
  scheduledWorkDays: number | null;
}>;
type CalculatedCompensation = ReturnType<typeof calculateCompensation>;

/**
 * Mirrors the agreed Noorix inverse package calculation. This is a payroll
 * calculation only: it neither approves a schedule nor determines legality.
 */
function calculateCompensation(input: CompensationInputForCalculation, formulaCode: HrCompensationFormulaCode) {
  if (formulaCode !== HrCompensationFormulaCode.STANDARD_MONTHLY_V1) throw new ConflictException('The selected compensation policy formula is not supported by this server.');
  if (input.compensationMethod === HrCompensationMethod.FIXED_MONTHLY) {
    const basicSalary = input.monthlyGross.minus(input.foodAllowance).minus(input.housingAllowance).minus(input.transportAllowance).minus(input.otherAllowance);
    if (basicSalary.lte(0)) throw new BadRequestException('The agreed total cannot be lower than its fixed allowances.');
    return {
      method: HrCompensationMethod.FIXED_MONTHLY,
      gross: input.monthlyGross,
      basicSalary,
      foodAllowance: input.foodAllowance,
      housingAllowance: input.housingAllowance,
      transportAllowance: input.transportAllowance,
      otherAllowance: input.otherAllowance,
      overtimeAmount: new Prisma.Decimal(0),
      overtimeHours: new Prisma.Decimal(0),
      scheduledHoursPerDay: input.scheduledHoursPerDay,
      scheduledWorkDays: input.scheduledWorkDays,
    };
  }
  const dailyHours = input.scheduledHoursPerDay;
  const workDays = input.scheduledWorkDays;
  if (!dailyHours || !workDays || dailyHours <= 8) throw new BadRequestException('An inclusive overtime agreement needs daily hours above eight and agreed monthly work days.');
  const regularDays = Math.min(workDays, STANDARD_MONTHLY_DAYS);
  const restDays = Math.max(workDays - STANDARD_MONTHLY_DAYS, 0);
  const overtimeHours = new Prisma.Decimal(dailyHours - 8).times(regularDays).plus(new Prisma.Decimal(restDays).times(dailyHours));
  const coefficient = overtimeHours.div(STANDARD_MONTHLY_HOURS);
  const allowances = input.foodAllowance.plus(input.housingAllowance).plus(input.transportAllowance).plus(input.otherAllowance);
  const basicSalary = input.monthlyGross.minus(allowances.times(new Prisma.Decimal(1).plus(coefficient))).div(new Prisma.Decimal(1).plus(coefficient.times(1.5))).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  if (basicSalary.lte(0)) throw new BadRequestException('The agreed total cannot cover the selected allowances and overtime schedule.');
  const overtimeAmount = input.monthlyGross.minus(basicSalary).minus(allowances).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  if (overtimeAmount.lt(0)) throw new BadRequestException('The agreed total cannot produce a non-negative overtime amount.');
  return {
    method: HrCompensationMethod.INCLUSIVE_OVERTIME,
    gross: input.monthlyGross,
      basicSalary,
      foodAllowance: input.foodAllowance,
      housingAllowance: input.housingAllowance,
      transportAllowance: input.transportAllowance,
      otherAllowance: input.otherAllowance,
    overtimeAmount,
    overtimeHours: overtimeHours.toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP),
    scheduledHoursPerDay: dailyHours,
    scheduledWorkDays: workDays,
  };
}
function prorateCompensation(compensation: CalculatedCompensation, period: PayrollCalculationPeriod) {
  if (period.formulaCode === HrPayrollCalculationFormulaCode.FULL_MONTH_V1) return compensation;
  const prorate = (value: Prisma.Decimal) => value.times(period.prorationRatio).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
  const gross = prorate(compensation.gross);
  const basicSalary = prorate(compensation.basicSalary);
  const foodAllowance = prorate(compensation.foodAllowance);
  const housingAllowance = prorate(compensation.housingAllowance);
  const transportAllowance = prorate(compensation.transportAllowance);
  const otherAllowance = prorate(compensation.otherAllowance);
  return { ...compensation, gross, basicSalary, foodAllowance, housingAllowance, transportAllowance, otherAllowance, overtimeAmount: gross.minus(basicSalary).minus(foodAllowance).minus(housingAllowance).minus(transportAllowance).minus(otherAllowance).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP), overtimeHours: prorate(compensation.overtimeHours) };
}
function assertNotPast(value: Date, currentYmd: string, message: string) { if (ymd(value) < currentYmd) throw new BadRequestException(message); }
function assertFirstDayOfMonth(value: Date, message: string) { if (ymd(value).slice(8, 10) !== '01') throw new BadRequestException(message); }
function policySnapshot(value: { id: string; policyId: string; versionNumber: number; effectiveFrom: Date; formulaCode: HrCompensationFormulaCode; policy: { code: string; nameAr: string; nameEn: string | null } }) {
  return { policyId: value.policyId, policyVersionId: value.id, policyCode: value.policy.code, policyNameAr: value.policy.nameAr, policyNameEn: value.policy.nameEn, versionNumber: value.versionNumber, effectiveFrom: ymd(value.effectiveFrom), formulaCode: value.formulaCode };
}
function mapPolicy(value: { id: string; code: string; nameAr: string; nameEn: string | null; versions: Array<{ id: string; policyId: string; versionNumber: number; effectiveFrom: Date; effectiveTo: Date | null; status: HrCompensationPolicyVersionStatus; formulaCode: HrCompensationFormulaCode }> }) {
  return { id: value.id, code: value.code, nameAr: value.nameAr, nameEn: value.nameEn, versions: value.versions.map((version) => ({ id: version.id, policyId: version.policyId, policyCode: value.code, policyNameAr: value.nameAr, policyNameEn: value.nameEn, versionNumber: version.versionNumber, effectiveFrom: ymd(version.effectiveFrom), effectiveTo: version.effectiveTo ? ymd(version.effectiveTo) : null, status: version.status, formulaCode: version.formulaCode })) };
}
function compensationPolicySnapshot(value: Prisma.JsonValue | null) {
  return value === null ? null : value as unknown as { policyId: string; policyVersionId: string; policyCode: string; policyNameAr: string; policyNameEn: string | null; versionNumber: number; effectiveFrom: string; formulaCode: HrCompensationFormulaCode };
}
function parsePayrollCalculationSnapshot(value: Prisma.JsonValue | null) {
  return value === null ? null : value as unknown as { formulaCode: HrPayrollCalculationFormulaCode; calculationPeriodStart: string; calculationPeriodEnd: string; eligibleDays: number; calendarDaysInMonth: number; prorationRatio: string; monthlyGrossAmount: string };
}
function payrollCalculationSnapshot(period: PayrollCalculationPeriod, monthlyGross: Prisma.Decimal) {
  return { formulaCode: period.formulaCode, calculationPeriodStart: ymd(period.calculationPeriodStart), calculationPeriodEnd: ymd(period.calculationPeriodEnd), eligibleDays: period.eligibleDays, calendarDaysInMonth: period.calendarDaysInMonth, prorationRatio: fixed(period.prorationRatio), monthlyGrossAmount: fixed(monthlyGross) };
}
function ymd(value: Date): `${number}-${number}-${number}` { return value.toISOString().slice(0, 10) as `${number}-${number}-${number}`; }
function firstOfMonth(value: Date) { return new Date(`${ymd(value).slice(0, 7)}-01T00:00:00.000Z`); }
function daysInMonth(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)).getUTCDate(); }
function lastDayOfMonth(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)); }
function inclusiveDays(start: Date, end: Date) { return Math.floor((Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate())) / 86_400_000) + 1; }
function minPeriodStart(periods: ReadonlyMap<string, PayrollCalculationPeriod>, employeeIds: readonly string[]) { return employeeIds.map((id) => periods.get(id)!.calculationPeriodStart).reduce((minimum, value) => value < minimum ? value : minimum); }
function maxPeriodEnd(periods: ReadonlyMap<string, PayrollCalculationPeriod>, employeeIds: readonly string[]) { return employeeIds.map((id) => periods.get(id)!.calculationPeriodEnd).reduce((maximum, value) => value > maximum ? value : maximum); }
function previousDay(value: Date) { return new Date(value.getTime() - 24 * 60 * 60 * 1_000); }
function tomorrow() { return new Date(Date.now() + 24 * 60 * 60 * 1_000); }
function mapRun(run: { id: string; runNumber: string; payrollMonth: Date; businessDate: Date; status: HrPayrollRunStatus; employeeCount: number; grossAmount: Prisma.Decimal; advanceSettlementAmount: Prisma.Decimal; administrativeDeductionAmount: Prisma.Decimal; netPayableAmount: Prisma.Decimal; paidAmount: Prisma.Decimal; notes: string | null; accrualJournalEntryId: string | null }) { return { id: run.id, runNumber: run.runNumber, payrollMonth: ymd(run.payrollMonth), businessDate: ymd(run.businessDate), status: run.status, employeeCount: run.employeeCount, grossAmount: fixed(run.grossAmount), advanceSettlementAmount: fixed(run.advanceSettlementAmount), administrativeDeductionAmount: fixed(run.administrativeDeductionAmount), netPayableAmount: fixed(run.netPayableAmount), paidAmount: fixed(run.paidAmount), notes: run.notes, accrualJournalEntryId: run.accrualJournalEntryId }; }
