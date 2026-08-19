import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { CancelHrEmployeeAdministrativeDeductionRequest, CreateHrEmployeeAdministrativeDeductionRequest, DeferHrEmployeeAdministrativeDeductionRequest } from '@baseer-erp/contracts';
import { BusinessDateService } from '../business-date/business-date.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DocumentSerialService } from '../core-controls/document-serial.service.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import { HrEmployeeAdministrativeDeductionStatus, HrEmployeeStatus, Prisma } from '../generated/prisma/client.js';

type CreateInput = Omit<CreateHrEmployeeAdministrativeDeductionRequest, 'idempotencyKey'>;
type DeferInput = Omit<DeferHrEmployeeAdministrativeDeductionRequest, 'idempotencyKey'>;
type CancelInput = Omit<CancelHrEmployeeAdministrativeDeductionRequest, 'idempotencyKey'>;

@Injectable()
export class HrAdministrativeDeductionService {
  constructor(
    private readonly database: DatabaseService,
    private readonly idempotency: IdempotencyService,
    private readonly dates: BusinessDateService,
    private readonly serials: DocumentSerialService,
  ) {}

  async list(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const deductions = await tx.hrEmployeeAdministrativeDeduction.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        orderBy: [{ businessDate: 'desc' }, { id: 'desc' }],
        take: 500,
        include: { employee: { select: { id: true, nameAr: true, nameEn: true } } },
      });
      return deductions.map((deduction) => ({
        id: deduction.id,
        employeeId: deduction.employeeId,
        employeeNameAr: deduction.employee.nameAr,
        employeeNameEn: deduction.employee.nameEn,
        deductionNumber: deduction.deductionNumber,
        businessDate: day(deduction.businessDate),
        originalAmount: deduction.originalAmount.toFixed(4),
        appliedAmount: deduction.appliedAmount.toFixed(4),
        remainingAmount: deduction.remainingAmount.toFixed(4),
        status: deduction.status,
        plannedPayrollDate: deduction.plannedPayrollDate ? day(deduction.plannedPayrollDate) : null,
        description: deduction.description,
        cancellationReason: deduction.cancellationReason,
      }));
    });
  }

  async create(context: TrustedCompanyActorContext, raw: CreateInput, idempotencyKey: string) {
    const input = normalizeCreate(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, { operation: 'hr.administrative_deduction.create', key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow() });
      if (begun.kind === 'replay') return begun.response.body as { id: string; deductionNumber: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The administrative deduction is already being processed.');
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      if (input.plannedPayrollDate && input.plannedPayrollDate.getTime() < input.businessDate.getTime()) throw new BadRequestException('The planned payroll date cannot be before the deduction date.');
      const employee = await tx.hrEmployee.findFirst({ where: { id: input.employeeId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] } }, select: { id: true } });
      if (!employee) throw new BadRequestException('Choose an active employee from this company.');
      const businessDate = day(input.businessDate);
      const serial = await this.serials.reserveInTransaction(tx, context, { series: 'EMPLOYEE_ADMIN_DEDUCTION', businessDate });
      const deductionNumber = `DED-${businessDate.replaceAll('-', '')}-${serial.toString()}`;
      const id = randomUUID();
      await tx.hrEmployeeAdministrativeDeduction.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, employeeId: input.employeeId, deductionNumber, businessDate: input.businessDate, originalAmount: input.amount, remainingAmount: input.amount, plannedPayrollDate: input.plannedPayrollDate ?? null, description: input.description, createdByUserId: context.actorUserId } });
      const receipt = { id, deductionNumber, replayed: false };
      await this.audit(tx, context, 'hr.administrative_deduction.created', id, null, { ...input, ...receipt, amount: input.amount.toFixed(4) });
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  async defer(context: TrustedCompanyActorContext, raw: DeferInput, idempotencyKey: string) {
    const input = normalizeDefer(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, { operation: 'hr.administrative_deduction.defer', key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow() });
      if (begun.kind === 'replay') return begun.response.body as { id: string; deductionNumber: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The administrative-deduction deferral is already being processed.');
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      if (input.deferredUntil.getTime() <= input.businessDate.getTime()) throw new BadRequestException('The deferred payroll date must be after the deferral date.');
      const prior = await this.openDeduction(tx, context, input.deductionId);
      const updated = await tx.hrEmployeeAdministrativeDeduction.update({ where: { id: prior.id }, data: { status: HrEmployeeAdministrativeDeductionStatus.DEFERRED, plannedPayrollDate: input.deferredUntil } });
      const receipt = { id: updated.id, deductionNumber: updated.deductionNumber, replayed: false };
      await this.audit(tx, context, 'hr.administrative_deduction.deferred', updated.id, mapDeduction(prior), { ...receipt, deferredUntil: day(input.deferredUntil), reason: input.reason });
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  async cancel(context: TrustedCompanyActorContext, raw: CancelInput, idempotencyKey: string) {
    const input = normalizeCancel(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, { operation: 'hr.administrative_deduction.cancel', key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow() });
      if (begun.kind === 'replay') return begun.response.body as { id: string; deductionNumber: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The administrative-deduction cancellation is already being processed.');
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const prior = await this.openDeduction(tx, context, input.deductionId);
      const updated = await tx.hrEmployeeAdministrativeDeduction.update({ where: { id: prior.id }, data: { status: HrEmployeeAdministrativeDeductionStatus.CANCELLED, remainingAmount: new Prisma.Decimal(0), plannedPayrollDate: null, cancellationReason: input.reason, cancelledAt: new Date() } });
      const receipt = { id: updated.id, deductionNumber: updated.deductionNumber, replayed: false };
      await this.audit(tx, context, 'hr.administrative_deduction.cancelled', updated.id, mapDeduction(prior), { ...receipt, reason: input.reason });
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  private async openDeduction(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, deductionId: string) {
    const deduction = await tx.hrEmployeeAdministrativeDeduction.findFirst({ where: { id: deductionId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeAdministrativeDeductionStatus.OPEN, HrEmployeeAdministrativeDeductionStatus.PARTIALLY_APPLIED, HrEmployeeAdministrativeDeductionStatus.DEFERRED] }, remainingAmount: { gt: 0 } } });
    if (!deduction) throw new NotFoundException('An open administrative deduction was not found.');
    return deduction;
  }

  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityId: string, before: unknown, after: unknown) {
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType: 'HrEmployeeAdministrativeDeduction', entityId, requestId: `${action}:${entityId}`, beforeJson: before === null ? Prisma.JsonNull : before as Prisma.InputJsonValue, afterJson: after as Prisma.InputJsonValue } });
  }
}

function normalizeCreate(value: CreateInput) { const amount = decimal(value.amount); return { employeeId: value.employeeId, businessDate: value.businessDate, amount, description: value.description.trim(), ...(value.plannedPayrollDate ? { plannedPayrollDate: value.plannedPayrollDate } : {}) }; }
function normalizeDefer(value: DeferInput) { return { deductionId: value.deductionId, businessDate: value.businessDate, deferredUntil: value.deferredUntil, reason: value.reason.trim() }; }
function normalizeCancel(value: CancelInput) { return { deductionId: value.deductionId, businessDate: value.businessDate, reason: value.reason.trim() }; }
function decimal(value: string) { try { const amount = new Prisma.Decimal(value); if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces()! > 4) throw new Error(); return amount; } catch { throw new BadRequestException('The administrative-deduction amount is invalid.'); } }
function day(value: Date) { return value.toISOString().slice(0, 10) as `${number}-${number}-${number}`; }
function tomorrow() { return new Date(Date.now() + 86_400_000); }
function jsonPayload(value: unknown): never { return JSON.parse(JSON.stringify(value)) as never; }
function rethrowIdempotency(error: unknown): never { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different administrative-deduction data.'); throw error; }
function mapDeduction(value: { id: string; deductionNumber: string; businessDate: Date; originalAmount: Prisma.Decimal; appliedAmount: Prisma.Decimal; remainingAmount: Prisma.Decimal; status: HrEmployeeAdministrativeDeductionStatus; plannedPayrollDate: Date | null; description: string; cancellationReason: string | null }) { return { id: value.id, deductionNumber: value.deductionNumber, businessDate: day(value.businessDate), originalAmount: value.originalAmount.toFixed(4), appliedAmount: value.appliedAmount.toFixed(4), remainingAmount: value.remainingAmount.toFixed(4), status: value.status, plannedPayrollDate: value.plannedPayrollDate ? day(value.plannedPayrollDate) : null, description: value.description, cancellationReason: value.cancellationReason }; }
