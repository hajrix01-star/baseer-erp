import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { CreateHrEmployeeLeaveRequest, ReturnHrEmployeeLeaveRequest } from '@baseer-erp/contracts';
import { BusinessDateService } from '../business-date/business-date.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import { HrEmployeeLeaveStatus, HrEmployeeStatus, Prisma } from '../generated/prisma/client.js';

type CreateInput = Omit<CreateHrEmployeeLeaveRequest, 'idempotencyKey'>;
type ReturnInput = Omit<ReturnHrEmployeeLeaveRequest, 'idempotencyKey'>;

@Injectable()
export class HrLeaveService {
  constructor(
    private readonly database: DatabaseService,
    private readonly idempotency: IdempotencyService,
    private readonly dates: BusinessDateService,
  ) {}

  async list(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const leaves = await tx.hrEmployeeLeave.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        orderBy: [{ startDate: 'desc' }, { id: 'desc' }],
        take: 500,
        include: { employee: { select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } } },
      });
      return leaves.map(mapLeave);
    });
  }

  async detail(context: TrustedCompanyActorContext, leaveId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const leave = await tx.hrEmployeeLeave.findFirst({
        where: { id: leaveId, tenantId: context.tenantId, companyId: context.companyId },
        include: { employee: { select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } } },
      });
      if (!leave) throw new NotFoundException('The employee leave was not found.');
      return { leave: mapLeave(leave) };
    });
  }

  async create(context: TrustedCompanyActorContext, raw: CreateInput, idempotencyKey: string) {
    const input = normalizeCreate(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, {
        operation: 'hr.leave.create', key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow(),
      });
      if (begun.kind === 'replay') return begun.response.body as { id: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The employee leave is already being processed.');
      if (input.endDate.getTime() < input.startDate.getTime()) throw new BadRequestException('The leave end date cannot be before the start date.');

      const employee = await tx.hrEmployee.findFirst({
        where: { id: input.employeeId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] } },
        select: { id: true },
      });
      if (!employee) throw new BadRequestException('Choose an active employee from this company.');

      const overlap = await tx.hrEmployeeLeave.findFirst({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          employeeId: input.employeeId,
          status: HrEmployeeLeaveStatus.APPROVED,
          startDate: { lte: input.endDate },
          endDate: { gte: input.startDate },
        },
        select: { id: true },
      });
      if (overlap) throw new ConflictException('This leave overlaps an approved leave for the employee.');

      const leaveId = randomUUID();
      const leave = await tx.hrEmployeeLeave.create({
        data: {
          id: leaveId,
          tenantId: context.tenantId,
          companyId: context.companyId,
          employeeId: input.employeeId,
          leaveType: input.leaveType,
          startDate: input.startDate,
          endDate: input.endDate,
          notes: input.notes,
          approvedByUserId: context.actorUserId,
        },
        include: { employee: { select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } } },
      });
      const current = await this.dates.resolveInTransaction(tx, context, { kind: 'current' });
      await this.synchronizeEmployeeStatus(tx, context, input.employeeId, dateFromBusinessDate(current.businessDate));
      const receipt = { id: leaveId, replayed: false };
      await this.audit(tx, context, 'hr.employee_leave.approved', leaveId, null, mapLeave(leave));
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  async returnEmployee(context: TrustedCompanyActorContext, raw: ReturnInput, idempotencyKey: string) {
    const input = normalizeReturn(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, {
        operation: 'hr.leave.return', key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow(),
      });
      if (begun.kind === 'replay') return begun.response.body as { id: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The employee return is already being processed.');
      const current = await this.dates.assertNotFutureInTransaction(tx, context, input.returnDate, 'The actual return date cannot be in the future.');
      const prior = await tx.hrEmployeeLeave.findFirst({
        where: { id: input.leaveId, tenantId: context.tenantId, companyId: context.companyId, status: HrEmployeeLeaveStatus.APPROVED },
        include: { employee: { select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } } },
      });
      if (!prior) throw new NotFoundException('An approved employee leave was not found.');
      if (input.returnDate.getTime() < prior.startDate.getTime()) throw new BadRequestException('The actual return date cannot be before the leave start date.');
      const returned = await tx.hrEmployeeLeave.update({
        where: { id: prior.id },
        data: {
          status: HrEmployeeLeaveStatus.RETURNED,
          actualReturnDate: input.returnDate,
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          returnedByUserId: context.actorUserId,
          returnedAt: new Date(),
        },
        include: { employee: { select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } } },
      });
      await this.synchronizeEmployeeStatus(tx, context, prior.employeeId, dateFromBusinessDate(current.businessDate));
      const receipt = { id: returned.id, replayed: false };
      await this.audit(tx, context, 'hr.employee_leave.returned', returned.id, mapLeave(prior), mapLeave(returned));
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  /** Synchronize only active/on-leave employees; terminated records stay immutable. */
  private async synchronizeEmployeeStatus(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, employeeId: string, currentDate: Date) {
    const activeLeave = await tx.hrEmployeeLeave.findFirst({
      where: {
        tenantId: context.tenantId,
        companyId: context.companyId,
        employeeId,
        status: HrEmployeeLeaveStatus.APPROVED,
        startDate: { lte: currentDate },
        endDate: { gte: currentDate },
      },
      select: { id: true },
    });
    const employee = await tx.hrEmployee.findFirst({
      where: { id: employeeId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] } },
      select: { id: true, status: true },
    });
    if (!employee) return;
    const nextStatus = activeLeave ? HrEmployeeStatus.ON_LEAVE : HrEmployeeStatus.ACTIVE;
    if (employee.status !== nextStatus) await tx.hrEmployee.update({ where: { id: employee.id }, data: { status: nextStatus } });
  }

  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityId: string, before: unknown, after: unknown) {
    await tx.auditEvent.create({
      data: {
        id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
        action, entityType: 'HrEmployeeLeave', entityId, requestId: `${action}:${entityId}`,
        beforeJson: before === null ? Prisma.JsonNull : before as Prisma.InputJsonValue,
        afterJson: after as Prisma.InputJsonValue,
      },
    });
  }
}

function normalizeCreate(value: CreateInput) { return { employeeId: value.employeeId, leaveType: value.leaveType, startDate: value.startDate, endDate: value.endDate, notes: nullable(value.notes) }; }
function normalizeReturn(value: ReturnInput) { return { leaveId: value.leaveId, returnDate: value.returnDate, ...(value.notes !== undefined ? { notes: nullable(value.notes) } : {}) }; }
function nullable(value: string | null | undefined) { const text = value?.trim(); return text || null; }
function day(value: Date | null) { return value ? value.toISOString().slice(0, 10) : null; }
function dateFromBusinessDate(value: string) { return new Date(`${value}T00:00:00.000Z`); }
function tomorrow() { return new Date(Date.now() + 86_400_000); }
function jsonPayload(value: unknown): never { return JSON.parse(JSON.stringify(value)) as never; }
function rethrowIdempotency(error: unknown): never { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different employee-leave data.'); throw error; }
function mapLeave(value: { id: string; employeeId: string; leaveType: string; status: string; startDate: Date; endDate: Date; actualReturnDate: Date | null; notes: string | null; employee: { employeeNumber: string; nameAr: string; nameEn: string | null } }) {
  return { id: value.id, employeeId: value.employeeId, employeeNumber: value.employee.employeeNumber, employeeNameAr: value.employee.nameAr, employeeNameEn: value.employee.nameEn, leaveType: value.leaveType as CreateHrEmployeeLeaveRequest['leaveType'], status: value.status as 'APPROVED' | 'RETURNED', startDate: day(value.startDate)!, endDate: day(value.endDate)!, actualReturnDate: day(value.actualReturnDate), notes: value.notes };
}
