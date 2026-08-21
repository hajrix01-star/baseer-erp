import { BadRequestException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import {
  FinanceCashPerformanceDirection,
  FinanceCashPerformanceEventKind,
  FinanceCategoryKind,
  Prisma,
} from '../generated/prisma/client.js';

export type CashPerformanceDestination = Readonly<{
  vaultId: string;
  amount: string;
  paymentMethod: string;
}>;

export type RecordCashPerformanceEventInput = Readonly<{
  kind: FinanceCashPerformanceEventKind;
  direction: FinanceCashPerformanceDirection;
  businessDate: Date;
  grossAmount: Prisma.Decimal | string;
  netAmount: Prisma.Decimal | string;
  vatAmount: Prisma.Decimal | string;
  vatBreakdownKnown?: boolean;
  sourceType: string;
  sourceId: string;
  sourceJournalEntryId: string;
  ledgerRevision: string | bigint;
  category?: Readonly<{ code: string; nameAr: string; nameEn?: string | null; kind: FinanceCategoryKind }>;
  destinations?: readonly CashPerformanceDestination[];
}>;

/**
 * Writes the immutable source facts consumed by the owner-facing personal
 * cash-performance report. This service never calculates a report and never
 * accepts an unsealed/unrelated journal: the database trigger verifies both.
 */
@Injectable()
export class FinanceCashPerformanceEventService {
  async recordInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    input: RecordCashPerformanceEventInput,
  ): Promise<string> {
    const amounts = normaliseAmounts(input.grossAmount, input.netAmount, input.vatAmount);
    const id = randomUUID();
    await transaction.financeCashPerformanceEvent.create({
      data: {
        id,
        tenantId: context.tenantId,
        companyId: context.companyId,
        kind: input.kind,
        direction: input.direction,
        businessDate: requiredDate(input.businessDate),
        grossAmount: amounts.gross,
        netAmount: amounts.net,
        vatAmount: amounts.vat,
        vatBreakdownKnown: input.vatBreakdownKnown ?? true,
        categoryCodeSnapshot: input.category?.code ?? null,
        categoryNameArSnapshot: input.category?.nameAr ?? null,
        categoryNameEnSnapshot: input.category?.nameEn ?? null,
        categoryKindSnapshot: input.category?.kind ?? null,
        ...(input.destinations?.length ? { settlementDestinationsJson: input.destinations as unknown as Prisma.InputJsonValue } : {}),
        sourceType: requiredText(input.sourceType, 80),
        sourceId: requiredUuid(input.sourceId),
        sourceJournalEntryId: requiredUuid(input.sourceJournalEntryId),
        ledgerRevision: requiredRevision(input.ledgerRevision),
        createdByUserId: context.actorUserId,
      },
    });
    return id;
  }

  /**
   * Appends the opposite event at the reversal business date. Returns false
   * only for evidence created before the event-model coverage start; callers
   * continue their legal correction, while the later report declares coverage.
   */
  async recordReversalForJournalInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    input: Readonly<{
      originalJournalEntryId: string;
      reversalJournalEntryId: string;
      reversalLedgerRevision: string | bigint;
      businessDate: Date;
      sourceType: string;
      sourceId: string;
    }>,
  ): Promise<boolean> {
    const original = await transaction.financeCashPerformanceEvent.findFirst({
      where: { sourceJournalEntryId: input.originalJournalEntryId, tenantId: context.tenantId, companyId: context.companyId },
      include: { reversalEvent: { select: { id: true } } },
    });
    if (!original) return false;
    if (original.reversalEvent) return false;
    await transaction.financeCashPerformanceEvent.create({
      data: {
        id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId,
        kind: original.kind,
        direction: original.direction === FinanceCashPerformanceDirection.INFLOW
          ? FinanceCashPerformanceDirection.OUTFLOW
          : FinanceCashPerformanceDirection.INFLOW,
        businessDate: requiredDate(input.businessDate),
        grossAmount: original.grossAmount, netAmount: original.netAmount, vatAmount: original.vatAmount,
        vatBreakdownKnown: original.vatBreakdownKnown,
        categoryCodeSnapshot: original.categoryCodeSnapshot,
        categoryNameArSnapshot: original.categoryNameArSnapshot,
        categoryNameEnSnapshot: original.categoryNameEnSnapshot,
        categoryKindSnapshot: original.categoryKindSnapshot,
        ...(original.settlementDestinationsJson === null ? {} : { settlementDestinationsJson: original.settlementDestinationsJson as Prisma.InputJsonValue }),
        sourceType: requiredText(input.sourceType, 80), sourceId: requiredUuid(input.sourceId),
        sourceJournalEntryId: requiredUuid(input.reversalJournalEntryId), ledgerRevision: requiredRevision(input.reversalLedgerRevision),
        reversalOfEventId: original.id, createdByUserId: context.actorUserId,
      },
    });
    return true;
  }
}

/** Shared future-report arithmetic: direction determines the event's sign. */
export function signedCashPerformanceAmount(
  direction: FinanceCashPerformanceDirection,
  amount: Prisma.Decimal,
): Prisma.Decimal {
  return direction === FinanceCashPerformanceDirection.INFLOW ? amount : amount.negated();
}

function normaliseAmounts(grossInput: Prisma.Decimal | string, netInput: Prisma.Decimal | string, vatInput: Prisma.Decimal | string) {
  const gross = decimal(grossInput, 'Cash-performance gross amount is invalid.');
  const net = decimal(netInput, 'Cash-performance net amount is invalid.');
  const vat = decimal(vatInput, 'Cash-performance VAT amount is invalid.');
  if (gross.lte(0) || net.lt(0) || vat.lt(0) || !net.plus(vat).equals(gross)) {
    throw new BadRequestException('Cash-performance gross amount must equal net amount plus VAT.');
  }
  return { gross, net, vat };
}

function decimal(value: Prisma.Decimal | string, message: string): Prisma.Decimal {
  let amount: Prisma.Decimal;
  try { amount = new Prisma.Decimal(value); } catch { throw new BadRequestException(message); }
  if (!amount.isFinite() || amount.decimalPlaces()! > 4) throw new BadRequestException(message);
  return amount;
}

function requiredDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf())) throw new BadRequestException('A valid cash-performance business date is required.');
  return value;
}

function requiredText(value: string, maxLength: number): string {
  const normalized = value?.trim();
  if (!normalized || normalized.length > maxLength) throw new BadRequestException('A valid cash-performance source type is required.');
  return normalized;
}

function requiredUuid(value: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new BadRequestException('A valid cash-performance source identifier is required.');
  }
  return value;
}

function requiredRevision(value: string | bigint): bigint {
  try {
    const revision = typeof value === 'bigint' ? value : BigInt(value);
    if (revision <= 0n) throw new Error('invalid');
    return revision;
  } catch {
    throw new BadRequestException('A valid sealed-ledger revision is required.');
  }
}
