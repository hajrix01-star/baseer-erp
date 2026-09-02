import { Prisma } from '../generated/prisma/client.js';
import assert from 'node:assert/strict';
import { ledgerTrialBalanceEvidenceReceiptSchema, ledgerTrialBalanceSourceReceiptSchema } from '@baseer-erp/contracts';
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
if (isEligibleTrialBalanceAccount({ status: 'ARCHIVED', isSystem: true }, false, settledArchived, false)) throw new Error('A zero system account must honour the hide-zero option.');
if (!isEligibleTrialBalanceAccount({ status: 'ARCHIVED', isSystem: true }, false, settledArchived, true)) throw new Error('A zero system account must appear when zero rows are requested.');

// Source actions are keyed by the precise journal line returned by evidence.
// A historical account can legitimately have no English translation; Arabic
// remains the reliable mandatory display name and the source must still open.
const reportRunId = '11111111-1111-4111-8111-111111111111';
const accountId = '22222222-2222-4222-8222-222222222222';
const journalEntryId = '33333333-3333-4333-8333-333333333333';
const evidenceLineId = '44444444-4444-4444-8444-444444444444';
const balancingLineId = '55555555-5555-4555-8555-555555555555';
const displayMoney = (raw: string) => ({ raw, display: raw.replace(/^-/, '').replace(/\.\d{4}$/, '.00'), sign: raw === '0.0000' ? 'zero' as const : raw.startsWith('-') ? 'negative' as const : 'positive' as const });
const evidence = ledgerTrialBalanceEvidenceReceiptSchema.parse({
  reportRunId, accountId, scope: 'PERIOD', nextCursor: null,
  items: [{ lineId: evidenceLineId, journalEntryId, businessDate: '2026-08-31', reference: 'JV-1', labelAr: 'قيد يومية', labelEn: 'Journal entry', description: null, debit: displayMoney('100.0000'), credit: displayMoney('0.0000'), cancellationLabelAr: null }],
});
const source = ledgerTrialBalanceSourceReceiptSchema.parse({
  journalEntry: {
    id: journalEntryId, businessDate: '2026-08-31', sourceReference: 'JV-1', labelAr: 'قيد يومية', labelEn: 'Journal entry', description: null, cancellationLabelAr: null,
    lines: [
      { id: evidenceLineId, lineNumber: 1, accountCode: '1000', accountNameAr: 'نقد', accountNameEn: '', debit: displayMoney('100.0000'), credit: displayMoney('0.0000'), description: null },
      { id: balancingLineId, lineNumber: 2, accountCode: '4000', accountNameAr: 'إيراد', accountNameEn: 'Revenue', debit: displayMoney('0.0000'), credit: displayMoney('100.0000'), description: null },
    ],
  },
});
assert.equal(source.journalEntry.id, evidence.items[0]!.journalEntryId);
assert.equal(source.journalEntry.lines.some((line) => line.id === evidence.items[0]!.lineId), true);

console.log('ledger trial-balance policy verification passed');
