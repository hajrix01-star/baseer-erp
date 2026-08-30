import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { DeferHrEmployeeAdvanceRequest, IssueHrEmployeeAdvanceRequest, SettleHrEmployeeAdvanceDirectlyRequest } from '@baseer-erp/contracts';
import { BusinessDateService } from '../business-date/business-date.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DocumentSerialService } from '../core-controls/document-serial.service.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceAccountStatus, FinanceAccountType, FinanceVaultPaymentMethod, FinanceVaultStatus, HrEmployeeAdvanceSettlementSource, HrEmployeeAdvanceStatus, HrEmployeeFinancialMovementType, HrEmployeeStatus, Prisma } from '../generated/prisma/client.js';
import { FinanceVaultService } from '../finance/finance-vault.service.js';
import { JournalPostingService } from '../finance/journal/journal-posting.service.js';
import { hrEmployeeAdvanceLockKey } from './hr-financial-lock.util.js';
import { isHrDateOnOrAfter, latestHrBusinessDate } from './hr-financial-date.util.js';
import { hrReplayReceipt } from './hr-idempotency.util.js';

const ADVANCE_ASSET_SYSTEM_KEY = 'EMPLOYEE_ADVANCES';
const ISSUE_OPERATION = 'hr.employee_advance.issue';
const DIRECT_SETTLEMENT_OPERATION = 'hr.employee_advance.settle_directly';
const DEFERRAL_OPERATION = 'hr.employee_advance.defer';
const REVERSE_ISSUE_OPERATION = 'hr.employee_advance.reverse_issue';

type AdvanceIssueInput = Omit<IssueHrEmployeeAdvanceRequest, 'idempotencyKey'>;
type AdvanceSettlementInput = Omit<SettleHrEmployeeAdvanceDirectlyRequest, 'idempotencyKey'>;
type AdvanceDeferralInput = Omit<DeferHrEmployeeAdvanceRequest, 'idempotencyKey'>;
export type AdvanceIssueReversalInput = Readonly<{ advanceId: string; businessDate: Date; reason: string }>;
type AdvanceAllocationInput = { allocations: Array<{ vaultId: string; amount: Prisma.Decimal; paymentMethod?: FinanceVaultPaymentMethod }> };
type AdvanceListQuery = Readonly<{ employeeId?: string; status?: HrEmployeeAdvanceStatus; search?: string; cursor?: string; pageSize: number }>;
type AdvanceDetailQuery = Readonly<{ settlementCursor?: string; settlementPageSize: number; deferralCursor?: string; deferralPageSize: number }>;

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

  /**
   * Deliberately narrow reference data for a user who can issue an advance
   * but is not allowed to browse the employee register or finance settings.
   */
  async entryReferences(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [employees, vaults] = await Promise.all([
        tx.hrEmployee.findMany({
          where: {
            tenantId: context.tenantId,
            companyId: context.companyId,
            status: { in: [HrEmployeeStatus.ACTIVE, HrEmployeeStatus.ON_LEAVE] },
          },
          orderBy: [{ employeeNumber: 'asc' }, { id: 'asc' }],
          select: { id: true, employeeNumber: true, nameAr: true, nameEn: true, status: true },
        }),
        tx.financeVault.findMany({
          where: {
            tenantId: context.tenantId,
            companyId: context.companyId,
            status: FinanceVaultStatus.ACTIVE,
            isPaymentDestination: true,
          },
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: { id: true, nameAr: true, nameEn: true, paymentMethod: true, paymentMethods: true },
        }),
      ]);
      return { companyId: context.companyId, employees, vaults };
    });
  }

  async list(context: TrustedCompanyActorContext, query: AdvanceListQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const matchingStatuses = query.search ? enumMatches(HrEmployeeAdvanceStatus, query.search) : [];
      const advanceScope: Prisma.HrEmployeeAdvanceWhereInput = {
        tenantId: context.tenantId,
        companyId: context.companyId,
        ...(query.employeeId ? { employeeId: query.employeeId } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.search ? { OR: [
          { advanceNumber: { contains: query.search, mode: 'insensitive' } },
          { notes: { contains: query.search, mode: 'insensitive' } },
          { employee: { employeeNumber: { contains: query.search, mode: 'insensitive' } } },
          { employee: { nameAr: { contains: query.search, mode: 'insensitive' } } },
          { employee: { nameEn: { contains: query.search, mode: 'insensitive' } } },
          ...(matchingStatuses.length > 0 ? [{ status: { in: matchingStatuses } }] : []),
        ] } : {}),
      };
      const cursor = query.cursor ? await tx.hrEmployeeAdvance.findFirst({ where: { id: query.cursor, ...advanceScope }, select: { id: true, businessDate: true } }) : null;
      if (query.cursor && !cursor) throw new BadRequestException('The employee-advance cursor is invalid.');
      const rows = await tx.hrEmployeeAdvance.findMany({
        where: cursor ? { AND: [advanceScope, { OR: [{ businessDate: { lt: cursor.businessDate } }, { businessDate: cursor.businessDate, id: { lt: cursor.id } }] }] } : advanceScope,
        orderBy: [{ businessDate: 'desc' }, { id: 'desc' }],
        take: query.pageSize + 1,
        include: {
          employee: { select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } },
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

  async detail(context: TrustedCompanyActorContext, advanceId: string, query: AdvanceDetailQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const advance = await tx.hrEmployeeAdvance.findFirst({
        where: { id: advanceId, tenantId: context.tenantId, companyId: context.companyId },
        include: {
          employee: { select: { id: true, nameAr: true, nameEn: true } },
          allocations: { include: { vault: { select: { id: true, nameAr: true, nameEn: true } } }, orderBy: { createdAt: 'asc' } },
        },
      });
      if (!advance) throw new NotFoundException('The employee advance was not found.');
      const childScope = { tenantId: context.tenantId, companyId: context.companyId, advanceId } as const;
      const [settlementCursor, deferralCursor] = await Promise.all([
        query.settlementCursor ? tx.hrEmployeeAdvanceSettlement.findFirst({ where: { id: query.settlementCursor, ...childScope }, select: { id: true, businessDate: true } }) : null,
        query.deferralCursor ? tx.hrEmployeeAdvanceDeferral.findFirst({ where: { id: query.deferralCursor, ...childScope }, select: { id: true, businessDate: true } }) : null,
      ]);
      if (query.settlementCursor && !settlementCursor) throw new BadRequestException('The advance-settlement cursor is invalid.');
      if (query.deferralCursor && !deferralCursor) throw new BadRequestException('The advance-deferral cursor is invalid.');
      const [settlementRows, deferralRows, sourceAnnotations] = await Promise.all([
        tx.hrEmployeeAdvanceSettlement.findMany({
          where: settlementCursor ? { AND: [childScope, { OR: [{ businessDate: { lt: settlementCursor.businessDate } }, { businessDate: settlementCursor.businessDate, id: { lt: settlementCursor.id } }] }] } : childScope,
          orderBy: [{ businessDate: 'desc' }, { id: 'desc' }], take: query.settlementPageSize + 1,
          include: { journalEntry: { select: { id: true, sourceReference: true } } },
        }),
        tx.hrEmployeeAdvanceDeferral.findMany({
          where: deferralCursor ? { AND: [childScope, { OR: [{ businessDate: { lt: deferralCursor.businessDate } }, { businessDate: deferralCursor.businessDate, id: { lt: deferralCursor.id } }] }] } : childScope,
          orderBy: [{ businessDate: 'desc' }, { id: 'desc' }], take: query.deferralPageSize + 1,
        }),
        tx.noorixSourceAnnotation.findMany({
          where: {
            tenantId: context.tenantId,
            targetCompanyId: context.companyId,
            targetEntity: 'HrEmployeeAdvance',
            targetId: advance.id,
          },
          orderBy: [{ sourceEntity: 'asc' }, { sourceId: 'asc' }, { field: 'asc' }],
          take: 25,
          select: { sourceEntity: true, sourceId: true, field: true, exactText: true },
        }),
      ]);
      const hasMoreSettlements = settlementRows.length > query.settlementPageSize;
      const settlements = hasMoreSettlements ? settlementRows.slice(0, query.settlementPageSize) : settlementRows;
      const hasMoreDeferrals = deferralRows.length > query.deferralPageSize;
      const deferrals = hasMoreDeferrals ? deferralRows.slice(0, query.deferralPageSize) : deferralRows;
      const settlementAnnotations = settlements.length
        ? await tx.noorixSourceAnnotation.findMany({
          where: {
            tenantId: context.tenantId,
            targetCompanyId: context.companyId,
            targetEntity: 'HrEmployeeAdvanceSettlement',
            targetId: { in: settlements.map((settlement) => settlement.id) },
          },
          orderBy: [{ targetId: 'asc' }, { sourceEntity: 'asc' }, { sourceId: 'asc' }, { field: 'asc' }],
          take: 2_500,
          select: { targetId: true, exactText: true },
        })
        : [];
      const settlementNotesById = new Map<string, string[]>();
      for (const annotation of settlementAnnotations) {
        if (!annotation.targetId) continue;
        const notes = settlementNotesById.get(annotation.targetId) ?? [];
        notes.push(annotation.exactText);
        settlementNotesById.set(annotation.targetId, notes);
      }
      return {
        advance: {
          id: advance.id, employeeId: advance.employeeId, employeeNameAr: advance.employee.nameAr, employeeNameEn: advance.employee.nameEn,
          advanceNumber: advance.advanceNumber, businessDate: day(advance.businessDate), originalAmount: advance.originalAmount.toFixed(4), settledAmount: advance.settledAmount.toFixed(4), remainingAmount: advance.remainingAmount.toFixed(4), status: advance.status,
          nextSettlementDate: advance.nextSettlementDate ? day(advance.nextSettlementDate) : null, notes: advance.notes, journalEntryId: advance.issueJournalEntryId,
          allocations: advance.allocations.map((allocation) => ({ vaultId: allocation.vaultId, vaultNameAr: allocation.vault.nameAr, vaultNameEn: allocation.vault.nameEn, paymentMethod: allocation.paymentMethod, amount: allocation.amount.toFixed(4) })),
        },
        // The operational note is already rendered separately.  Keep this
        // disclosure list for additional source text only, avoiding a
        // duplicate of the same original Noorix note in the dialog.
        sourceAnnotations: sourceAnnotations.filter((annotation) => annotation.exactText !== advance.notes),
        settlements: settlements.map((settlement) => ({ id: settlement.id, source: settlement.source, businessDate: day(settlement.businessDate), amount: settlement.amount.toFixed(4), journalEntryId: settlement.journalEntryId, sourceReference: settlement.journalEntry?.sourceReference ?? null, sourceNotes: settlementNotesById.get(settlement.id) ?? [] })),
        hasMoreSettlements,
        nextSettlementCursor: hasMoreSettlements ? settlements.at(-1)?.id ?? null : null,
        deferrals: deferrals.map((deferral) => ({ id: deferral.id, businessDate: day(deferral.businessDate), deferredUntil: day(deferral.deferredUntil), reason: deferral.reason })),
        hasMoreDeferrals,
        nextDeferralCursor: hasMoreDeferrals ? deferrals.at(-1)?.id ?? null : null,
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
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; advanceNumber: string; journalEntryId: string; replayed: boolean }>(begun.response.body);
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
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; settlementNumber: string; advanceId: string; journalEntryId: string; remainingAmount: string; replayed: boolean }>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The employee advance settlement is already being processed.');

      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      await this.lockAdvance(tx, context, input.advanceId);
      const advance = await tx.hrEmployeeAdvance.findFirst({
        where: { id: input.advanceId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeAdvanceStatus.ISSUED, HrEmployeeAdvanceStatus.PARTIALLY_SETTLED] } },
        include: { employee: { select: { id: true, nameAr: true } } },
      });
      if (!advance || advance.remainingAmount.lte(0)) throw new NotFoundException('An open employee advance was not found.');
      if (!isHrDateOnOrAfter(input.businessDate, advance.businessDate)) throw new BadRequestException('The settlement date cannot be before the employee-advance issue date.');
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

  async reverseIssue(context: TrustedCompanyActorContext, raw: AdvanceIssueReversalInput, idempotencyKey: string) {
    const input = { advanceId: raw.advanceId, businessDate: raw.businessDate, reason: raw.reason.trim() };
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, { operation: REVERSE_ISSUE_OPERATION, key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow() });
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; advanceNumber: string; reversalJournalEntryId: string; replayed: boolean }>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The employee-advance issue reversal is already being processed.');
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      if (!input.reason) throw new BadRequestException('An employee-advance reversal reason is required.');
      await this.lockAdvance(tx, context, input.advanceId);
      const advance = await tx.hrEmployeeAdvance.findFirst({
        where: { id: input.advanceId, tenantId: context.tenantId, companyId: context.companyId },
        include: {
          issueJournalEntry: { select: { id: true, reversalEntry: { select: { id: true, businessDate: true } } } },
          settlements: { orderBy: [{ businessDate: 'desc' }, { id: 'desc' }], take: 1, select: { businessDate: true } },
          deferrals: { orderBy: [{ businessDate: 'desc' }, { id: 'desc' }], take: 1, select: { businessDate: true } },
        },
      });
      if (!advance) throw new NotFoundException('The employee advance was not found.');
      if (advance.status === HrEmployeeAdvanceStatus.REVERSED || advance.issueJournalEntry.reversalEntry) throw new ConflictException('The employee-advance issue has already been reversed.');
      if (advance.status !== HrEmployeeAdvanceStatus.ISSUED || !advance.settledAmount.eq(0) || !advance.remainingAmount.eq(advance.originalAmount)) throw new ConflictException('Only a fully outstanding employee advance can have its issue reversed.');
      if (advance.createdByUserId === context.actorUserId) throw new ConflictException('The employee-advance issuer cannot reverse the same issue.');
      const reversalFloor = latestHrBusinessDate(advance.businessDate, advance.settlements[0]?.businessDate, advance.deferrals[0]?.businessDate)!;
      if (!isHrDateOnOrAfter(input.businessDate, reversalFloor)) throw new BadRequestException('The employee-advance issue reversal cannot predate its latest financial or collection event.');
      const journal = await this.journals.reverseInTransaction(tx, { ...context, requestId: `hr-advance-issue-reversal:${advance.id}`, journalEntryId: advance.issueJournalEntryId, businessDate: input.businessDate, reason: input.reason });
      const updated = await tx.hrEmployeeAdvance.updateMany({ where: { id: advance.id, tenantId: context.tenantId, companyId: context.companyId, status: HrEmployeeAdvanceStatus.ISSUED, settledAmount: 0, remainingAmount: advance.originalAmount }, data: { status: HrEmployeeAdvanceStatus.REVERSED, remainingAmount: 0, nextSettlementDate: null } });
      if (updated.count !== 1) throw new ConflictException('The employee advance changed while its issue reversal was being recorded.');
      await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, employeeId: advance.employeeId, journalEntryId: journal.journalEntryId, movementType: HrEmployeeFinancialMovementType.ADVANCE_ISSUED, businessDate: input.businessDate, amount: advance.originalAmount.negated(), sourceReference: `${advance.advanceNumber}-REV`, description: `Employee-advance issue reversed: ${input.reason}` } });
      const receipt = { id: advance.id, advanceNumber: advance.advanceNumber, reversalJournalEntryId: journal.journalEntryId, replayed: false };
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: 'hr.employee_advance.issue_reversed', entityType: 'HrEmployeeAdvance', entityId: advance.id, requestId: `hr-advance-issue-reversal:${advance.id}`, afterJson: { ...receipt, businessDate: day(input.businessDate), reason: input.reason } as Prisma.InputJsonValue } });
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    }).catch(rethrowIdempotency);
  }

  async defer(context: TrustedCompanyActorContext, raw: AdvanceDeferralInput, idempotencyKey: string) {
    const input = normalizeDeferral(raw);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, { operation: DEFERRAL_OPERATION, key: idempotencyKey, request: jsonPayload(input), expiresAt: tomorrow() });
      if (begun.kind === 'replay') return hrReplayReceipt<{ id: string; advanceId: string; deferredUntil: string; replayed: boolean }>(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The employee advance deferral is already being processed.');
      await this.dates.assertNotFutureInTransaction(tx, context, input.businessDate);
      if (input.deferredUntil.getTime() <= input.businessDate.getTime()) throw new BadRequestException('The deferred collection date must be after the deferral date.');
      await this.lockAdvance(tx, context, input.advanceId);
      const advance = await tx.hrEmployeeAdvance.findFirst({ where: { id: input.advanceId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [HrEmployeeAdvanceStatus.ISSUED, HrEmployeeAdvanceStatus.PARTIALLY_SETTLED] }, remainingAmount: { gt: 0 } }, select: { id: true, businessDate: true, remainingAmount: true } });
      if (!advance) throw new NotFoundException('An open employee advance was not found.');
      if (!isHrDateOnOrAfter(input.businessDate, advance.businessDate)) throw new BadRequestException('The deferral date cannot be before the employee-advance issue date.');
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

  private async lockAdvance(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, advanceId: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${hrEmployeeAdvanceLockKey(context.tenantId, context.companyId, advanceId)}, 0))`;
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
function enumMatches<T extends string>(values: Record<string, T>, search: string): T[] { const needle = search.trim().toUpperCase().replaceAll(' ', '_'); return Object.values(values).filter((value) => value.includes(needle)); }
function jsonPayload(value: unknown): never { return JSON.parse(JSON.stringify(value)) as never; }
function rethrowIdempotency(error: unknown): never { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different advance data.'); throw error; }
