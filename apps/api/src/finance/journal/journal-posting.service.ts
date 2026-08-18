import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import {
  FinanceAccountStatus,
  FinanceJournalEntryStatus,
  Prisma,
} from '../../generated/prisma/client.js';
import { FinancePeriodService } from '../finance-period.service.js';

const JOURNAL_REVERSAL_SOURCE_TYPE = 'journal_reversal';
const MAX_DECIMAL_18_4 = new Prisma.Decimal('99999999999999.9999');

export type JournalPostingLine = Readonly<{
  accountId: string;
  debitAmount?: string;
  creditAmount?: string;
  description?: string;
}>;

export type PostJournalEntryInput = Readonly<{
  tenantId: string;
  companyId: string;
  actorUserId: string;
  requestId: string;
  sourceType: string;
  sourceReference: string;
  businessDate: Date;
  description?: string;
  lines: readonly JournalPostingLine[];
}>;

export type ReverseJournalEntryInput = Readonly<{
  tenantId: string;
  companyId: string;
  actorUserId: string;
  requestId: string;
  journalEntryId: string;
  businessDate: Date;
  reason: string;
}>;

export type JournalPostingReceipt = Readonly<{
  journalEntryId: string;
  fiscalPeriodId: string;
  totalDebit: string;
  totalCredit: string;
}>;

@Injectable()
export class JournalPostingService {
  constructor(private readonly periods: FinancePeriodService) {}

  async postInTransaction(
    transaction: Prisma.TransactionClient,
    input: PostJournalEntryInput,
  ): Promise<JournalPostingReceipt> {
    const sourceType = this.requiredText(input.sourceType, 'A journal source type is required.', 80);
    const sourceReference = this.requiredText(input.sourceReference, 'A journal source reference is required.', 160);
    const requestId = this.requiredText(input.requestId, 'A request identifier is required.', 120);
    const normalizedLines = this.normalizeLines(input.lines);
    const fiscalPeriodId = await this.periods.assertExactlyOneOpenPeriodForDate(transaction, input);

    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${input.companyId}:journal:${sourceType}:${sourceReference}`}, 0))
    `;
    const existing = await transaction.financeJournalEntry.findFirst({
      where: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        sourceType,
        sourceReference,
      },
      select: { id: true },
    });
    if (existing) throw new ConflictException('A journal entry already exists for this source reference.');

    await this.assertActiveAccounts(transaction, input.tenantId, input.companyId, normalizedLines.map((line) => line.accountId));

    const journalEntryId = randomUUID();
    const totalDebit = normalizedLines.reduce((sum, line) => sum.plus(line.debitAmount), new Prisma.Decimal(0));
    const totalCredit = normalizedLines.reduce((sum, line) => sum.plus(line.creditAmount), new Prisma.Decimal(0));
    await transaction.financeJournalEntry.create({
      data: {
        id: journalEntryId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        fiscalPeriodId,
        sourceType,
        sourceReference,
        businessDate: input.businessDate,
        description: this.optionalText(input.description, 1_000) ?? null,
        createdByUserId: input.actorUserId,
        requestId,
      },
    });
    await transaction.financeJournalLine.createMany({
      data: normalizedLines.map((line, index) => ({
        id: randomUUID(),
        tenantId: input.tenantId,
        companyId: input.companyId,
        journalEntryId,
        accountId: line.accountId,
        lineNumber: index + 1,
        debitAmount: line.debitAmount,
        creditAmount: line.creditAmount,
        description: line.description ?? null,
      })),
    });
    await this.updateDailyBalances(transaction, input, normalizedLines);
    await transaction.financeJournalEntry.update({
      where: { id: journalEntryId },
      data: { isSealed: true, sealedAt: new Date() },
    });
    const receipt: JournalPostingReceipt = {
      journalEntryId,
      fiscalPeriodId,
      totalDebit: totalDebit.toFixed(4),
      totalCredit: totalCredit.toFixed(4),
    };
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: 'finance.journal.posted',
        entityType: 'FinanceJournalEntry',
        entityId: journalEntryId,
        requestId,
        afterJson: receipt as Prisma.InputJsonValue,
      },
    });
    return receipt;
  }

  async reverseInTransaction(
    transaction: Prisma.TransactionClient,
    input: ReverseJournalEntryInput,
  ): Promise<JournalPostingReceipt> {
    const reason = this.requiredText(input.reason, 'A reversal reason is required.', 1_000);
    const requestId = this.requiredText(input.requestId, 'A request identifier is required.', 120);
    const fiscalPeriodId = await this.periods.assertExactlyOneOpenPeriodForDate(transaction, input);
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${input.companyId}:journal-reversal:${input.journalEntryId}`}, 0))
    `;
    const original = await transaction.financeJournalEntry.findFirst({
      where: {
        id: input.journalEntryId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        status: FinanceJournalEntryStatus.POSTED,
        sourceType: { not: JOURNAL_REVERSAL_SOURCE_TYPE },
      },
      include: {
        reversalEntry: { select: { id: true } },
        lines: { orderBy: { lineNumber: 'asc' } },
      },
    });
    if (!original) throw new NotFoundException('The posted original journal entry was not found.');
    if (original.reversalEntry) throw new ConflictException('This journal entry has already been reversed.');

    await this.assertActiveAccounts(transaction, input.tenantId, input.companyId, original.lines.map((line) => line.accountId));

    const journalEntryId = randomUUID();
    const totalDebit = original.lines.reduce((sum, line) => sum.plus(line.creditAmount), new Prisma.Decimal(0));
    const totalCredit = original.lines.reduce((sum, line) => sum.plus(line.debitAmount), new Prisma.Decimal(0));
    await transaction.financeJournalEntry.create({
      data: {
        id: journalEntryId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        fiscalPeriodId,
        sourceType: JOURNAL_REVERSAL_SOURCE_TYPE,
        sourceReference: original.id,
        businessDate: input.businessDate,
        description: `Reversal of journal ${original.id}`,
        reversalOfEntryId: original.id,
        reversalReason: reason,
        createdByUserId: input.actorUserId,
        requestId,
      },
    });
    await transaction.financeJournalLine.createMany({
      data: original.lines.map((line) => ({
        id: randomUUID(),
        tenantId: input.tenantId,
        companyId: input.companyId,
        journalEntryId,
        accountId: line.accountId,
        lineNumber: line.lineNumber,
        debitAmount: line.creditAmount,
        creditAmount: line.debitAmount,
        description: line.description ?? null,
      })),
    });
    // The projection must follow the same POSTED-only rule as ledger reads:
    // remove the original contribution once its status becomes REVERSED, then
    // add the reversal entry's opposite lines.
    await this.updateDailyBalances(transaction, {
      tenantId: input.tenantId,
      companyId: input.companyId,
      businessDate: original.businessDate,
    }, original.lines, -1);
    await this.updateDailyBalances(transaction, {
      tenantId: input.tenantId,
      companyId: input.companyId,
      businessDate: input.businessDate,
    }, original.lines.map((line) => ({
      accountId: line.accountId,
      debitAmount: line.creditAmount,
      creditAmount: line.debitAmount,
    })));
    await transaction.financeJournalEntry.update({
      where: { id: journalEntryId },
      data: { isSealed: true, sealedAt: new Date() },
    });
    await transaction.financeJournalEntry.update({
      where: { id: original.id },
      data: { status: FinanceJournalEntryStatus.REVERSED },
    });
    const receipt: JournalPostingReceipt = {
      journalEntryId,
      fiscalPeriodId,
      totalDebit: totalDebit.toFixed(4),
      totalCredit: totalCredit.toFixed(4),
    };
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        tenantId: input.tenantId,
        companyId: input.companyId,
        actorUserId: input.actorUserId,
        action: 'finance.journal.reversed',
        entityType: 'FinanceJournalEntry',
        entityId: original.id,
        requestId,
        afterJson: { ...receipt, reversalReason: reason } as Prisma.InputJsonValue,
      },
    });
    return receipt;
  }

  private normalizeLines(lines: readonly JournalPostingLine[]): Array<{
    accountId: string;
    debitAmount: Prisma.Decimal;
    creditAmount: Prisma.Decimal;
    description?: string;
  }> {
    if (lines.length < 2) throw new BadRequestException('A journal entry must contain at least two lines.');
    const normalized = lines.map((line) => {
      const accountId = this.requiredText(line.accountId, 'Every journal line needs an account.', 36);
      const debitAmount = this.decimalAmount(line.debitAmount);
      const creditAmount = this.decimalAmount(line.creditAmount);
      if ((debitAmount.gt(0) && creditAmount.gt(0)) || (debitAmount.eq(0) && creditAmount.eq(0))) {
        throw new BadRequestException('Every journal line must contain exactly one positive debit or credit amount.');
      }
      const description = this.optionalText(line.description, 1_000);
      return { accountId, debitAmount, creditAmount, ...(description ? { description } : {}) };
    });
    const totalDebit = normalized.reduce((sum, line) => sum.plus(line.debitAmount), new Prisma.Decimal(0));
    const totalCredit = normalized.reduce((sum, line) => sum.plus(line.creditAmount), new Prisma.Decimal(0));
    if (!totalDebit.eq(totalCredit) || totalDebit.lte(0)) {
      throw new BadRequestException('Journal debits and credits must balance to a positive amount.');
    }
    return normalized;
  }

  private async assertActiveAccounts(
    transaction: Prisma.TransactionClient,
    tenantId: string,
    companyId: string,
    accountIds: readonly string[],
  ): Promise<void> {
    const uniqueAccountIds = [...new Set(accountIds)];
    const accounts = await transaction.financeAccount.findMany({
      where: {
        tenantId,
        companyId,
        status: FinanceAccountStatus.ACTIVE,
        id: { in: uniqueAccountIds },
      },
      select: { id: true },
    });
    if (accounts.length !== uniqueAccountIds.length) {
      throw new BadRequestException('Every journal line must use an active account from the selected company.');
    }
  }

  /**
   * Keeps the bounded daily read projection in the exact transaction that
   * changes the immutable journal. It is a cache of POSTED journal totals,
   * not a second ledger: the migration can rebuild it deterministically.
   */
  private async updateDailyBalances(
    transaction: Prisma.TransactionClient,
    input: Readonly<{ tenantId: string; companyId: string; businessDate: Date }>,
    lines: readonly Readonly<{ accountId: string; debitAmount: Prisma.Decimal; creditAmount: Prisma.Decimal }>[],
    multiplier = 1,
  ) {
    const byAccount = new Map<string, { debitAmount: Prisma.Decimal; creditAmount: Prisma.Decimal }>();
    for (const line of lines) {
      const current = byAccount.get(line.accountId) ?? { debitAmount: new Prisma.Decimal(0), creditAmount: new Prisma.Decimal(0) };
      current.debitAmount = current.debitAmount.plus(line.debitAmount).mul(multiplier);
      current.creditAmount = current.creditAmount.plus(line.creditAmount).mul(multiplier);
      byAccount.set(line.accountId, current);
    }
    await Promise.all([...byAccount.entries()].map(([accountId, amount]) => transaction.financeAccountDailyBalance.upsert({
      where: { tenantId_companyId_accountId_businessDate: { tenantId: input.tenantId, companyId: input.companyId, accountId, businessDate: input.businessDate } },
      create: { tenantId: input.tenantId, companyId: input.companyId, accountId, businessDate: input.businessDate, debitAmount: amount.debitAmount, creditAmount: amount.creditAmount },
      update: { debitAmount: { increment: amount.debitAmount }, creditAmount: { increment: amount.creditAmount } },
    })));
  }

  private decimalAmount(value: string | undefined): Prisma.Decimal {
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(value ?? '0');
    } catch {
      throw new BadRequestException('Journal amounts must be valid decimal values.');
    }
    if (!amount.isFinite() || amount.isNegative() || (amount.decimalPlaces() ?? 0) > 4 || amount.gt(MAX_DECIMAL_18_4)) {
      throw new BadRequestException('Journal amounts must be non-negative decimal values with at most four places.');
    }
    return amount;
  }

  private requiredText(value: string, message: string, maximumLength: number): string {
    const text = value.trim();
    if (!text || text.length > maximumLength) throw new BadRequestException(message);
    return text;
  }

  private optionalText(value: string | undefined, maximumLength: number): string | undefined {
    if (value === undefined) return undefined;
    const text = value.trim();
    if (!text) return undefined;
    if (text.length > maximumLength) throw new BadRequestException('Journal text exceeds the permitted length.');
    return text;
  }
}
