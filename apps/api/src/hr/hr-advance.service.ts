import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { DeferHrEmployeeAdvanceRequest, IssueHrEmployeeAdvanceRequest, SettleHrEmployeeAdvanceDirectlyRequest } from '@baseer-erp/contracts';
import { BusinessDateService } from '../business-date/business-date.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DocumentSerialService } from '../core-controls/document-serial.service.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceAccountStatus, FinanceAccountType, FinanceVaultPaymentMethod, HrEmployeeAdvanceSettlementSource, HrEmployeeAdvanceStatus, HrEmployeeFinancialMovementType, HrEmployeeStatus, Prisma } from '../generated/prisma/client.js';
import { FinanceVaultService } from '../finance/finance-vault.service.js';
import { JournalPostingService } from '../finance/journal/journal-posting.service.js';

const ADVANCE_ASSET_SYSTEM_KEY = 'EMPLOYEE_ADVANCES';
const ISSUE_OPERATION = 'hr.employee_advance.issue';
const DIRECT_SETTLEMENT_OPERATION = 'hr.employee_advance.settle_directly';
const DEFERRAL_OPERATION = 'hr.employee_advance.defer';

type AdvanceIssueInput = Omit<IssueHrEmployeeAdvanceRequest, 'idempotencyKey'>;
type AdvanceSettlementInput = Omit<SettleHrEmployeeAdvanceDirectlyRequest, 'idempotencyKey'>;
type AdvanceDeferralInput = Omit<DeferHrEmployeeAdvanceRequest, 'idempotencyKey'>;
type AdvanceAllocationInput = { allocations: Array<{ vaultId: string; amount: Prisma.Decimal; paymentMethod?: FinanceVaultPaymentMethod }> };
type AdvanceListQuery = Readonly<{ employeeId?: string; status?: HrEmployeeAdvanceStatus; cursor?: string; pageSize: number }>;

@Injectable()
export class HrAdvanceService {
  constructor(
    private readonly database: DatabaseService,
    private readonly idempotency: IdempotencyService,
    private readonly dates: BusinessDateService,
    private readonly serials: DocumentSerialService,
    private readonly vaults: FinanceVaultService,
    private readonly journals: JournalPostingService,
  ) {}

  async list(context: TrustedCompanyActorContext, query: AdvanceListQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const cursor = query.cursor ? await tx.hrEmployeeAdvance.findFirst({ where: { id: query.cursor, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, businessDate: true } }) : null;
      if (query.cursor && !cursor) throw new BadRequestException('The employee-advance cursor is invalid.');
      const rows = await tx.hrEmployeeAdvance.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          ...(query.employeeId ? { employeeId: query.employeeId } : {}),
          ...(query.status ? { status: query.status } : {}),
          ...(cursor ? { OR: [{ businessDate: { lt: cursor.businessDate } }, { businessDate: cursor.businessDate, id: { lt: cursor.id } }] } : {}),
        },
        orderBy: [{ businessDate: 'desc' }, { id: 'desc' }],
        take: query.pageSize + 1,
        include: {
          employee: { select: { id: true, nameAr: true, nameEn: true } },
          allocations: { include: { vault: { select: { id: true, nameAr: true, nameEn: true } } }, orderBy: { createdAt: 'asc' } },
        },
      });
      const hasMore = rows.length > query.pageSize;
      const advances = hasMore ? rows.slice(0, query.pageSize) : rows;
      const values = advances.map((advance) => ({
        id: advance.id,
        employeeId: advance.employeeId,
        employeeNameAr: advance.employee.nameAr,
        employeeNameEn: advance.employee.nameEn,
        advanceNumber: advance.advanceNumber,
        businessDate: day(advance.businessDate),
        originalAmount: advance.originalAmount.toFixed(4),
        settledAmount: advance.settledAmount.toFixed(4),
        remainingAmount: advance.remainingAmount.toFixed(4),
        status: advance.status,
        nextSettlementDate: advance.nextSettlementDate ? day(advance.nextSettlementDate) : null,
        notes: advance.notes,
        journalEntryId: advance.issueJournalEntryId,
        allocations: advance.allocations.map((allocation) => ({
          vaultId: allocation.vaultId,
          vaultNameAr: allocation.vault.nameAr,
          vaultNameEn: allocation.vault.nameEn,
          paymentMethod: allocation.paymentMethod,
          amount: allocation.amount.toFixed(4),
        })),
      }));
      return { advances: values, hasMore, nextCursor: hasMore ? advances.at(-1)?.id ?? null : null };
    });
  }

  async detail(context: TrustedCompanyActorContext, advanceId: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const advance = await tx.hrEmployeeAdvance.findFirst({
        where: { id: advanceId, tenantId: context.tenantId, companyId: context.companyId },
        include: {
          employee: { select: { id: true, nameAr: true, nameEn: true } },
          allocations: { include: { vault: { select: { id: true, nameAr: true, nameEn: true } } }, orderBy: { createdAt: 'asc' } },
          settlements: { orderBy: [{ businessDate: 'desc' }, { id: 'desc' }], take: 500, include: { journalEntry: { select: { id: true, sourceReference: true } } } },
          deferrals: { orderBy: [{ businessDate: 'desc' }, { id: 'desc' }], take: 500 },
        },
      });
      if (!advance) throw new NotFoundException('The employee advance was not found.');
      return {
        advance: {
          id: advance.id, employeeId: advance.employeeId, employeeNameAr: advance.employee.nameAr, employeeNameEn: advance.employee.nameEn,
          advanceNumber: advance.advanceNumber, businessDate: day(advance.businessDate), originalAmount: advance.originalAmount.toFixed(4), settledAmount: advance.settledAmount.toFixed(4), remainingAmount: advance.remainingAmount.toFixed(4), status: advance.status,
          nextSettlementDate: advance.nextSettlementDate ? day(advance.nextSettlementDate) : null, notes: advance.notes, journalEntryId: advance.issueJournalEntryId,
          allocations: advance.allocations.map((allocation) => ({ vaultId: allocation.vaultId, vaultNameAr: allocation.vault.nameAr, vaultNameEn: allocation.vault.nameEn, paymentMethod: allocation.paymentMethod, amount: allocation.amount.toFixed(4) })),
        },
        settlements: advance.settlements.map((settlement) => ({ id: settlement.id, source: settlement.source, businessDate: day(settlement.businessDate), amount: settlement.amount.toFixed(4), journalEntryId: settlement.journalEntryId, sourceReference: settlement.journalEntry?.sourceReference ?? null })),
        deferrals: advance.deferrals.map((deferral) => ({ id: deferral.id, businessDate: day(deferral.businessDate), deferredUntil: day(deferral.deferredUntil), reason: deferral.reason })),
      };
    });
  }

  async issue(context: TrustedCompanyActorContext, raw: AdvanceIssueInput, idempotencyKey: string) {
    const input = normalize(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, {
        operation: ISSUE_OPERATION,
        key: idempotencyKey,
        request: jsonPayload(input),
        expiresAt: tomorrow(),
      });
      if (begun.kind === 'replay') return begun.response.body as { id: string; advanceNumber: string; journalEntryId: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The employee advance is already being processed.');

      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const employee = await tx.hrEmployee.findFirst({
        where: { id: input.employeeId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] } },
        select: { id: true, nameAr: true },
      });
      if (!employee) throw new BadRequestException('Choose an active employee from this company.');

      const advanceAsset = await tx.financeAccount.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, systemKey: ADVANCE_ASSET_SYSTEM_KEY, type: FinanceAccountType.ASSET, status: FinanceAccountStatus.ACTIVE },
        select: { id: true },
      });
      if (!advanceAsset) throw new ConflictException('The employee-advances account is not configured for this company.');

      const allocations = await this.resolveAllocations(tx, context, input);
      const allocationTotal = allocations.reduce((total, allocation) => total.plus(allocation.amount), new Prisma.Decimal(0));
      if (!allocationTotal.eq(input.amount)) throw new BadRequestException('The advance allocations must equal the advance amount.');

      const businessDate = day(input.businessDate);
      const serial = await this.serials.reserveInTransaction(tx, context, { series: 'EMPLOYEE_ADVANCE', businessDate });
      const advanceNumber = `ADV-${businessDate.replaceAll('-', '')}-${serial.toString()}`;
      const journal = await this.journals.postInTransaction(tx, {
        ...context,
        requestId: `hr-advance:${idempotencyKey}`,
        sourceType: 'hr_employee_advance',
        sourceReference: advanceNumber,
        businessDate: input.businessDate,
        description: input.notes ?? `Employee advance · ${employee.nameAr}`,
        lines: [
          { accountId: advanceAsset.id, debitAmount: input.amount.toFixed(4), description: advanceNumber },
          ...allocations.map((allocation) => ({ accountId: allocation.accountId, creditAmount: allocation.amount.toFixed(4), description: advanceNumber })),
        ],
      });

      const advanceId = randomUUID();
      await tx.hrEmployeeAdvance.create({
        data: {
          id: advanceId,
          tenantId: context.tenantId,
          companyId: context.companyId,
          employeeId: employee.id,
          advanceNumber,
          businessDate: input.businessDate,
          originalAmount: input.amount,
          remainingAmount: input.amount,
          notes: input.notes,
          issueJournalEntryId: journal.journalEntryId,
          createdByUserId: context.actorUserId,
        },
      });
      await tx.hrEmployeeAdvancePayoutAllocation.createMany({
        data: allocations.map((allocation) => ({
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, advanceId,
          vaultId: allocation.vaultId, amount: allocation.amount, paymentMethod: allocation.paymentMethod,
        })),
      });
      await tx.hrEmployeeFinancialMovement.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId,
          employeeId: employee.id, journalEntryId: journal.journalEntryId,
          movementType: HrEmployeeFinancialMovementType.ADVANCE_ISSUED,
          businessDate: input.businessDate, amount: input.amount,
          sourceReference: advanceNumber, description: input.notes,
        },
      });
      const receipt = { id: advanceId, advanceNumber, journalEntryId: journal.journalEntryId, replayed: false };
      await tx.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
          action: 'hr.employee_advance.issued', entityType: 'HrEmployeeAdvance', entityId: advanceId,
          requestId: `hr-advance:${idempotencyKey}`, afterJson: { ...receipt, employeeId: employee.id, amount: input.amount.toFixed(4), allocations: allocations.map((item) => ({ vaultId: item.vaultId, paymentMethod: item.paymentMethod, amount: item.amount.toFixed(4) })) } as Prisma.InputJsonValue,
        },
      });
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  async settleDirectly(context: TrustedCompanyActorContext, raw: AdvanceSettlementInput, idempotencyKey: string) {
    const input = normalizeSettlement(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, { operation: DIRECT_SETTLEMENT_OPERATION, key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow() });
      if (begun.kind === 'replay') return begun.response.body as { id: string; settlementNumber: string; advanceId: string; journalEntryId: string; remainingAmount: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The employee advance settlement is already being processed.');

      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      const advance = await tx.hrEmployeeAdvance.findFirst({
        where: { id: input.advanceId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeAdvanceStatus.ISSUED, HrEmployeeAdvanceStatus.PARTIALLY_SETTLED] } },
        include: { employee: { select: { id: true, nameAr: true } } },
      });
      if (!advance || advance.remainingAmount.lte(0)) throw new NotFoundException('An open employee advance was not found.');
      if (input.amount.gt(advance.remainingAmount)) throw new BadRequestException('The settlement amount cannot exceed the remaining employee-advance balance.');
      if (input.deferRemainingUntil && (!input.amount.lt(advance.remainingAmount) || input.deferRemainingUntil.getTime() <= input.businessDate.getTime())) throw new BadRequestException('A deferred collection date requires a partial settlement and must be after the settlement date.');

      const advanceAsset = await tx.financeAccount.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, systemKey: ADVANCE_ASSET_SYSTEM_KEY, type: FinanceAccountType.ASSET, status: FinanceAccountStatus.ACTIVE }, select: { id: true } });
      if (!advanceAsset) throw new ConflictException('The employee-advances account is not configured for this company.');
      const allocations = await this.resolveAllocations(tx, context, input);
      const allocationTotal = allocations.reduce((total, allocation) => total.plus(allocation.amount), new Prisma.Decimal(0));
      if (!allocationTotal.eq(input.amount)) throw new BadRequestException('The settlement allocations must equal the settlement amount.');

      const businessDate = day(input.businessDate);
      const serial = await this.serials.reserveInTransaction(tx, context, { series: 'EMPLOYEE_ADVANCE_RECEIPT', businessDate });
      const settlementNumber = `ADR-${businessDate.replaceAll('-', '')}-${serial.toString()}`;
      const journal = await this.journals.postInTransaction(tx, {
        ...context, requestId: `hr-advance-settlement:${idempotencyKey}`, sourceType: 'hr_employee_advance_receipt', sourceReference: settlementNumber, businessDate: input.businessDate,
        description: input.notes ?? `Advance repayment · ${advance.employee.nameAr}`,
        lines: [...allocations.map((allocation) => ({ accountId: allocation.accountId, debitAmount: allocation.amount.toFixed(4), description: settlementNumber })), { accountId: advanceAsset.id, creditAmount: input.amount.toFixed(4), description: settlementNumber }],
      });

      const nextRemaining = advance.remainingAmount.minus(input.amount);
      const nextSettled = advance.settledAmount.plus(input.amount);
      const nextStatus = nextRemaining.eq(0) ? HrEmployeeAdvanceStatus.SETTLED : HrEmployeeAdvanceStatus.PARTIALLY_SETTLED;
      const updated = await tx.hrEmployeeAdvance.updateMany({ where: { id: advance.id, tenantId: context.tenantId, companyId: context.companyId, remainingAmount: { gte: input.amount } }, data: { settledAmount: nextSettled, remainingAmount: nextRemaining, status: nextStatus, ...(nextRemaining.eq(0) ? { nextSettlementDate: null } : input.deferRemainingUntil ? { nextSettlementDate: input.deferRemainingUntil } : {}) } });
      if (updated.count !== 1) throw new ConflictException('The employee-advance balance changed. Refresh and try again.');
      const settlementId = randomUUID();
      await tx.hrEmployeeAdvanceSettlement.create({ data: { id: settlementId, tenantId: context.tenantId, companyId: context.companyId, advanceId: advance.id, source: HrEmployeeAdvanceSettlementSource.MANUAL_RECEIPT, businessDate: input.businessDate, amount: input.amount, journalEntryId: journal.journalEntryId } });
      if (input.deferRemainingUntil) await tx.hrEmployeeAdvanceDeferral.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, advanceId: advance.id, businessDate: input.businessDate, deferredUntil: input.deferRemainingUntil, reason: input.notes ?? 'Remaining balance deferred after direct repayment.', createdByUserId: context.actorUserId } });
      await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId: advance.employeeId, journalEntryId: journal.journalEntryId, movementType: HrEmployeeFinancialMovementType.ADVANCE_SETTLEMENT, businessDate: input.businessDate, amount: input.amount, sourceReference: settlementNumber, description: input.notes } });
      const receipt = { id: settlementId, settlementNumber, advanceId: advance.id, journalEntryId: journal.journalEntryId, remainingAmount: nextRemaining.toFixed(4), replayed: false };
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: 'hr.employee_advance.settled_directly', entityType: 'HrEmployeeAdvanceSettlement', entityId: settlementId, requestId: `hr-advance-settlement:${idempotencyKey}`, afterJson: { ...receipt, amount: input.amount.toFixed(4), allocations: allocations.map((item) => ({ vaultId: item.vaultId, paymentMethod: item.paymentMethod, amount: item.amount.toFixed(4) })) } as Prisma.InputJsonValue } });
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  async defer(context: TrustedCompanyActorContext, raw: AdvanceDeferralInput, idempotencyKey: string) {
    const input = normalizeDeferral(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, { operation: DEFERRAL_OPERATION, key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow() });
      if (begun.kind === 'replay') return begun.response.body as { id: string; advanceId: string; deferredUntil: string; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The employee advance deferral is already being processed.');
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      if (input.deferredUntil.getTime() <= input.businessDate.getTime()) throw new BadRequestException('The deferred collection date must be after the deferral date.');
      const advance = await tx.hrEmployeeAdvance.findFirst({ where: { id: input.advanceId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeAdvanceStatus.ISSUED, HrEmployeeAdvanceStatus.PARTIALLY_SETTLED] }, remainingAmount: { gt: 0 } }, select: { id: true, remainingAmount: true } });
      if (!advance) throw new NotFoundException('An open employee advance was not found.');
      const deferralId = randomUUID();
      await tx.hrEmployeeAdvance.update({ where: { id: advance.id }, data: { nextSettlementDate: input.deferredUntil } });
      await tx.hrEmployeeAdvanceDeferral.create({ data: { id: deferralId, tenantId: context.tenantId, companyId: context.companyId, advanceId: advance.id, businessDate: input.businessDate, deferredUntil: input.deferredUntil, reason: input.reason, createdByUserId: context.actorUserId } });
      const receipt = { id: deferralId, advanceId: advance.id, deferredUntil: day(input.deferredUntil), replayed: false };
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: 'hr.employee_advance.deferred', entityType: 'HrEmployeeAdvanceDeferral', entityId: deferralId, requestId: `hr-advance-deferral:${idempotencyKey}`, afterJson: { ...receipt, reason: input.reason, remainingAmount: advance.remainingAmount.toFixed(4) } as Prisma.InputJsonValue } });
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  private async resolveAllocations(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, input: AdvanceAllocationInput) {
    const grouped = new Map<string, { vaultId: string; paymentMethod?: FinanceVaultPaymentMethod; amount: Prisma.Decimal }>();
    for (const allocation of input.allocations) {
      const key = `${allocation.vaultId}:${allocation.paymentMethod ?? ''}`;
      const prior = grouped.get(key);
      grouped.set(key, { vaultId: allocation.vaultId, ...(allocation.paymentMethod ? { paymentMethod: allocation.paymentMethod } : {}), amount: (prior?.amount ?? new Prisma.Decimal(0)).plus(allocation.amount) });
    }
    const resolved: Array<{ vaultId: string; accountId: string; paymentMethod: FinanceVaultPaymentMethod; amount: Prisma.Decimal }> = [];
    for (const allocation of grouped.values()) {
      const vault = await this.vaults.assertActivePaymentDestination(tx, { ...context, vaultId: allocation.vaultId });
      const paymentMethod = allocation.paymentMethod ?? vault.paymentMethod;
      if (!vault.paymentMethods.includes(paymentMethod)) throw new BadRequestException('The selected payment method is not enabled for this vault.');
      resolved.push({ vaultId: vault.id, accountId: vault.accountId, paymentMethod, amount: allocation.amount });
    }
    return resolved;
  }
}

function normalize(value: AdvanceIssueInput) {
  const amount = decimal(value.amount, 'The advance amount is invalid.');
  if (amount.lte(0)) throw new BadRequestException('The advance amount must be positive.');
  return {
    employeeId: value.employeeId,
    businessDate: value.businessDate,
    amount,
    allocations: value.allocations.map((allocation) => ({ vaultId: allocation.vaultId, amount: decimal(allocation.amount, 'The allocation amount is invalid.'), ...(allocation.paymentMethod ? { paymentMethod: allocation.paymentMethod } : {}) })),
    notes: value.notes?.trim() || null,
  };
}
function normalizeSettlement(value: AdvanceSettlementInput) {
  const amount = decimal(value.amount, 'The settlement amount is invalid.');
  if (amount.lte(0)) throw new BadRequestException('The settlement amount must be positive.');
  return { advanceId: value.advanceId, businessDate: value.businessDate, amount, allocations: value.allocations.map((allocation) => ({ vaultId: allocation.vaultId, amount: decimal(allocation.amount, 'The allocation amount is invalid.'), ...(allocation.paymentMethod ? { paymentMethod: allocation.paymentMethod } : {}) })), ...(value.deferRemainingUntil ? { deferRemainingUntil: value.deferRemainingUntil } : {}), notes: value.notes?.trim() || null };
}
function normalizeDeferral(value: AdvanceDeferralInput) { return { advanceId: value.advanceId, businessDate: value.businessDate, deferredUntil: value.deferredUntil, reason: value.reason.trim() }; }
function decimal(value: string, message: string) { try { const amount = new Prisma.Decimal(value); if (!amount.isFinite() || amount.decimalPlaces()! > 4) throw new Error(); return amount; } catch { throw new BadRequestException(message); } }
function day(value: Date) { return value.toISOString().slice(0, 10) as `${number}-${number}-${number}`; }
function tomorrow() { return new Date(Date.now() + 86_400_000); }
function jsonPayload(value: unknown): never { return JSON.parse(JSON.stringify(value)) as never; }
function rethrowIdempotency(error: unknown): never { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different advance data.'); throw error; }
