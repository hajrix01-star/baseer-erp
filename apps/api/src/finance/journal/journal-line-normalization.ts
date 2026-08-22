import { BadRequestException } from '@nestjs/common';

import { Prisma } from '../../generated/prisma/client.js';

const MAX_DECIMAL_18_4 = new Prisma.Decimal('99999999999999.9999');

export type JournalPostingLine = Readonly<{
  accountId: string;
  debitAmount?: string;
  creditAmount?: string;
  description?: string;
}>;

export type NormalizedJournalPostingLine = Readonly<{
  accountId: string;
  debitAmount: Prisma.Decimal;
  creditAmount: Prisma.Decimal;
  description?: string;
}>;

/**
 * The financial balancing rule is pure: database access starts only after
 * these canonical decimal lines have passed validation.
 */
export function normalizeJournalLines(
  lines: readonly JournalPostingLine[],
): NormalizedJournalPostingLine[] {
  if (lines.length < 2) {
    throw new BadRequestException('A journal entry must contain at least two lines.');
  }
  const normalized = lines.map((line) => {
    const accountId = requiredText(line.accountId, 'Every journal line needs an account.', 36);
    const debitAmount = decimalAmount(line.debitAmount);
    const creditAmount = decimalAmount(line.creditAmount);
    if ((debitAmount.gt(0) && creditAmount.gt(0)) || (debitAmount.eq(0) && creditAmount.eq(0))) {
      throw new BadRequestException('Every journal line must contain exactly one positive debit or credit amount.');
    }
    const description = optionalText(line.description, 1_000);
    return { accountId, debitAmount, creditAmount, ...(description ? { description } : {}) };
  });
  const totalDebit = normalized.reduce((sum, line) => sum.plus(line.debitAmount), new Prisma.Decimal(0));
  const totalCredit = normalized.reduce((sum, line) => sum.plus(line.creditAmount), new Prisma.Decimal(0));
  if (!totalDebit.eq(totalCredit) || totalDebit.lte(0)) {
    throw new BadRequestException('Journal debits and credits must balance to a positive amount.');
  }
  return normalized;
}

function decimalAmount(value: string | undefined): Prisma.Decimal {
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

function requiredText(value: string, message: string, maximumLength: number): string {
  const text = value.trim();
  if (!text || text.length > maximumLength) throw new BadRequestException(message);
  return text;
}

function optionalText(value: string | undefined, maximumLength: number): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > maximumLength) throw new BadRequestException('Journal text exceeds the permitted length.');
  return text;
}
