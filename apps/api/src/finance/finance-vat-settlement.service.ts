import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { BusinessDateService } from '../business-date/business-date.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceAccountStatus,
  FinanceCashPerformanceDirection,
  FinanceCashPerformanceEventKind,
  FinanceVatSettlementKind,
  FinanceVatSettlementStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { FinanceCashPerformanceEventService } from './finance-cash-performance-event.service.js';
import { FinanceVaultService } from './finance-vault.service.js';
import { JournalPostingService } from './journal/journal-posting.service.js';

export type RecordVatSettlementRequest = Readonly<{
  kind: FinanceVatSettlementKind;
  vaultId: string;
  amount: string;
  businessDate: Date;
  referenceNumber: string;
  notes?: string;
}>;

export type ReverseVatSettlementRequest = Readonly<{
  settlementId: string;
  businessDate: Date;
  reason: string;
}>;

/** Service-only source command; a permitted controller is intentionally later. */
@Injectable()
export class FinanceVatSettlementService {
  constructor(
    private readonly database: DatabaseService,
    private readonly dates: BusinessDateService,
    private readonly vaults: FinanceVaultService,
    private readonly journals: JournalPostingService,
    private readonly cashEvents: FinanceCashPerformanceEventService,
  ) {}

  async record(context: TrustedCompanyActorContext, request: RecordVatSettlementRequest) {
    const amount = positiveAmount(request.amount);
    const referenceNumber = text(request.referenceNumber, 160, 'A VAT settlement reference is required.');
    const notes = request.notes?.trim() || null;
    if (!Object.values(FinanceVatSettlementKind).includes(request.kind)) throw new BadRequestException('A valid VAT settlement kind is required.');
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await this.dates.assertNotFutureInTransaction(transaction, context, request.businessDate, 'A VAT settlement cannot use a future business date.');
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:vat-settlement:${referenceNumber}`}, 0))`;
      const prior = await transaction.financeVatSettlement.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, referenceNumber },
        select: { id: true, journalEntryId: true, kind: true, amount: true, businessDate: true, status: true },
      });
      if (prior) {
        if (prior.kind !== request.kind || !prior.amount.equals(amount) || prior.businessDate.valueOf() !== request.businessDate.valueOf()) {
          throw new ConflictException('A VAT settlement already uses this reference with different financial data.');
        }
        return { settlementId: prior.id, journalEntryId: prior.journalEntryId, status: prior.status, replayed: true };
      }
      const vault = await this.vaults.assertActivePaymentDestination(transaction, { ...context, vaultId: request.vaultId });
      const account = await transaction.financeAccount.findFirst({
        where: {
          tenantId: context.tenantId, companyId: context.companyId,
          systemKey: request.kind === FinanceVatSettlementKind.PAYMENT ? 'VAT_OUTPUT' : 'VAT_INPUT',
          status: FinanceAccountStatus.ACTIVE,
        }, select: { id: true },
      });
      if (!account) throw new ConflictException('The required VAT control account is not available.');
      const settlementId = randomUUID();
      const journal = await this.journals.postInTransaction(transaction, {
        ...context, requestId: `vat-settlement:${settlementId}`, sourceType: 'finance_vat_settlement', sourceReference: settlementId,
        businessDate: request.businessDate, description: notes ?? `VAT ${request.kind.toLowerCase()} ${referenceNumber}`,
        lines: request.kind === FinanceVatSettlementKind.PAYMENT
          ? [{ accountId: account.id, debitAmount: amount.toFixed(4) }, { accountId: vault.accountId, creditAmount: amount.toFixed(4) }]
          : [{ accountId: vault.accountId, debitAmount: amount.toFixed(4) }, { accountId: account.id, creditAmount: amount.toFixed(4) }],
      });
      await transaction.financeVatSettlement.create({
        data: { id: settlementId, tenantId: context.tenantId, companyId: context.companyId, kind: request.kind, vaultId: vault.id, amount, businessDate: request.businessDate, referenceNumber, notes, journalEntryId: journal.journalEntryId, createdByUserId: context.actorUserId },
      });
      await this.cashEvents.recordInTransaction(transaction, context, {
        kind: request.kind === FinanceVatSettlementKind.PAYMENT ? FinanceCashPerformanceEventKind.VAT_PAYMENT : FinanceCashPerformanceEventKind.VAT_REFUND,
        direction: request.kind === FinanceVatSettlementKind.PAYMENT ? FinanceCashPerformanceDirection.OUTFLOW : FinanceCashPerformanceDirection.INFLOW,
        businessDate: request.businessDate, grossAmount: amount, netAmount: amount, vatAmount: new Prisma.Decimal(0),
        sourceType: 'finance_vat_settlement', sourceId: settlementId, sourceJournalEntryId: journal.journalEntryId, ledgerRevision: journal.ledgerRevision,
        destinations: [{ vaultId: vault.id, amount: amount.toFixed(4), paymentMethod: vault.paymentMethod }],
      });
      return { settlementId, journalEntryId: journal.journalEntryId, status: FinanceVatSettlementStatus.POSTED, replayed: false };
    });
  }

  async reverse(context: TrustedCompanyActorContext, request: ReverseVatSettlementRequest) {
    const reason = text(request.reason, 1_000, 'A VAT settlement reversal reason is required.');
    if (!isUuid(request.settlementId)) throw new BadRequestException('A valid VAT settlement identifier is required.');
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await this.dates.assertNotFutureInTransaction(transaction, context, request.businessDate, 'A VAT settlement reversal cannot use a future business date.');
      const settlement = await transaction.financeVatSettlement.findFirst({
        where: { id: request.settlementId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceVatSettlementStatus.POSTED },
        include: { reversalEntry: { select: { id: true } } },
      });
      if (!settlement) throw new NotFoundException('The posted VAT settlement was not found.');
      if (settlement.reversalEntry) throw new ConflictException('This VAT settlement has already been reversed.');
      const journal = await this.journals.reverseInTransaction(transaction, { ...context, requestId: `vat-settlement-reversal:${settlement.id}`, journalEntryId: settlement.journalEntryId, businessDate: request.businessDate, reason });
      await this.cashEvents.recordReversalForJournalInTransaction(transaction, context, {
        originalJournalEntryId: settlement.journalEntryId, reversalJournalEntryId: journal.journalEntryId,
        reversalLedgerRevision: journal.ledgerRevision, businessDate: request.businessDate,
        sourceType: 'finance_vat_settlement_reversal', sourceId: settlement.id,
      });
      const reversalId = randomUUID();
      await transaction.financeVatSettlement.update({ where: { id: settlement.id }, data: { status: FinanceVatSettlementStatus.REVERSED } });
      await transaction.financeVatSettlement.create({
        data: { id: reversalId, tenantId: context.tenantId, companyId: context.companyId, kind: settlement.kind, status: FinanceVatSettlementStatus.REVERSED, vaultId: settlement.vaultId, amount: settlement.amount, businessDate: request.businessDate, referenceNumber: `${settlement.referenceNumber}-REV`, notes: reason, journalEntryId: journal.journalEntryId, reversalOfId: settlement.id, createdByUserId: context.actorUserId },
      });
      return { reversalSettlementId: reversalId, reversalJournalEntryId: journal.journalEntryId };
    });
  }
}

function positiveAmount(value: string): Prisma.Decimal {
  let amount: Prisma.Decimal;
  try { amount = new Prisma.Decimal(value); } catch { throw new BadRequestException('A positive VAT settlement amount is required.'); }
  if (!amount.isFinite() || amount.lte(0) || (amount.decimalPlaces() ?? 0) > 4) throw new BadRequestException('A positive VAT settlement amount is required.');
  return amount;
}
function text(value: string, limit: number, message: string): string { const normalized = value?.trim(); if (!normalized || normalized.length > limit) throw new BadRequestException(message); return normalized; }
function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
