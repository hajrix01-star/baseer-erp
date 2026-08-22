import assert from 'node:assert/strict';

import fc from 'fast-check';

import { Prisma } from '../../generated/prisma/client.js';
import { normalizeJournalLines } from './journal-line-normalization.js';

function amountFromUnits(units: number): string {
  return `${Math.floor(units / 10_000)}.${String(units % 10_000).padStart(4, '0')}`;
}

const positiveUnits = fc.array(
  fc.integer({ min: 1, max: 1_000_000_000 }),
  { minLength: 1, maxLength: 24 },
);

fc.assert(fc.property(positiveUnits, (units) => {
  const totalUnits = units.reduce((sum, unit) => sum + unit, 0);
  const lines = [
    ...units.map((unit, index) => ({
      accountId: `debit-${index}`,
      debitAmount: amountFromUnits(unit),
    })),
    { accountId: 'credit-total', creditAmount: amountFromUnits(totalUnits) },
  ];
  const normalized = normalizeJournalLines(lines);
  const debit = normalized.reduce((sum, line) => sum.plus(line.debitAmount), new Prisma.Decimal(0));
  const credit = normalized.reduce((sum, line) => sum.plus(line.creditAmount), new Prisma.Decimal(0));
  assert.equal(debit.toFixed(4), amountFromUnits(totalUnits));
  assert.equal(credit.toFixed(4), amountFromUnits(totalUnits));
}));

fc.assert(fc.property(positiveUnits, (units) => {
  const totalUnits = units.reduce((sum, unit) => sum + unit, 0);
  const lines = [
    ...units.map((unit, index) => ({
      accountId: `debit-${index}`,
      debitAmount: amountFromUnits(unit),
    })),
    { accountId: 'credit-total', creditAmount: amountFromUnits(totalUnits + 1) },
  ];
  assert.throws(
    () => normalizeJournalLines(lines),
    /Journal debits and credits must balance to a positive amount/,
  );
}));

console.log('Journal balancing property verification passed.');
