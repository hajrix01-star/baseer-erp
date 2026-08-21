import { Prisma } from '../generated/prisma/client.js';
import { calculateTrialAmounts, isEligibleTrialBalanceAccount } from './ledger-trial-balance-report.service.js';

const amount = (value: string) => new Prisma.Decimal(value);
const aggregate = (debit: string, credit: string) => ({ debitAmount: amount(debit), creditAmount: amount(credit) });
const equal = (actual: Prisma.Decimal, expected: string, label: string) => {
  if (!actual.equals(expected)) throw new Error(`${label}: expected ${expected}, received ${actual.toFixed(4)}.`);
};

// Jan: Dr Cash / Cr Revenue 100. Feb: Dr Expense / Cr Cash 40.
const cash = calculateTrialAmounts(aggregate('100', '0'), aggregate('0', '40'));
const revenue = calculateTrialAmounts(aggregate('0', '100'), aggregate('0', '0'));
const expense = calculateTrialAmounts(aggregate('0', '0'), aggregate('40', '0'));
equal(cash.openingDebit, '100', 'Cash opening debit');
equal(cash.periodCredit, '40', 'Cash period credit');
equal(cash.closingDebit, '60', 'Cash closing debit');
equal(revenue.openingCredit, '100', 'Revenue opening credit');
equal(expense.periodDebit, '40', 'Expense period debit');
equal(expense.closingDebit, '40', 'Expense closing debit');

const totals = [cash, revenue, expense].reduce((sum, row) => ({
  openingDebit: sum.openingDebit.plus(row.openingDebit), openingCredit: sum.openingCredit.plus(row.openingCredit),
  periodDebit: sum.periodDebit.plus(row.periodDebit), periodCredit: sum.periodCredit.plus(row.periodCredit),
  closingDebit: sum.closingDebit.plus(row.closingDebit), closingCredit: sum.closingCredit.plus(row.closingCredit),
}), { openingDebit: amount('0'), openingCredit: amount('0'), periodDebit: amount('0'), periodCredit: amount('0'), closingDebit: amount('0'), closingCredit: amount('0') });
for (const [debit, credit, label] of [['openingDebit', 'openingCredit', 'opening'], ['periodDebit', 'periodCredit', 'period'], ['closingDebit', 'closingCredit', 'closing']] as const) {
  if (!totals[debit].equals(totals[credit])) throw new Error(`Trial Balance ${label} totals are not equal.`);
}

// A later reversal is a new opposite ledger entry. A historic ReportRun
// includes only the original revision; a later run includes both and nets it.
const originalOnly = calculateTrialAmounts(undefined, aggregate('100', '0'));
const originalAndReversal = calculateTrialAmounts(undefined, aggregate('100', '100'));
equal(originalOnly.closingDebit, '100', 'Historic original closing debit');
equal(originalAndReversal.closingDebit, '0', 'Reversal closing debit');
equal(originalAndReversal.closingCredit, '0', 'Reversal closing credit');

const settledArchived = calculateTrialAmounts(aggregate('100', '100'), undefined);
if (isEligibleTrialBalanceAccount({ status: 'ARCHIVED', isSystem: false }, true, settledArchived, false)) throw new Error('A zero archived account should honour the hide-zero option.');
if (!isEligibleTrialBalanceAccount({ status: 'ARCHIVED', isSystem: false }, true, settledArchived, true)) throw new Error('A historical archived account must be available when zero rows are requested.');
if (!isEligibleTrialBalanceAccount({ status: 'ARCHIVED', isSystem: true }, false, settledArchived, false)) throw new Error('A system account must remain visible at zero.');

console.log('ledger trial-balance policy verification passed');
