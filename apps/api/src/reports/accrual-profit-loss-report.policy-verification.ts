import assert from 'node:assert/strict';

import { REPORTING_R0_A_POLICY_VERSION } from '../finance/finance-pnl-mapping.service.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  applyVatPresentationToJournalContributions,
  accrualProfitLossCoverageForHistoricalPayrollRuns,
  accrualProfitLossPayrollMonthCoverageRange,
  calculateAccrualProfitLossMappingChecksum,
  calculateAccrualProfitLossTotals,
  hasCompleteAccrualProfitLossAccountCoverage,
  verifyAccrualProfitLossMappingSnapshot,
  type AccrualProfitLossMappingSnapshot,
} from './accrual-profit-loss-report.service.js';

const salesEvent = {
  kind: 'SALES_COLLECTION' as const,
  direction: 'INFLOW' as const,
  grossAmount: new Prisma.Decimal('115.0000'),
  netAmount: new Prisma.Decimal('100.0000'),
  vatAmount: new Prisma.Decimal('15.0000'),
  vatBreakdownKnown: true,
};
const purchaseEvent = {
  kind: 'PURCHASE_PAYMENT' as const,
  direction: 'OUTFLOW' as const,
  grossAmount: new Prisma.Decimal('230.0000'),
  netAmount: new Prisma.Decimal('200.0000'),
  vatAmount: new Prisma.Decimal('30.0000'),
  vatBreakdownKnown: true,
};
const vatModeContributions = [
  { journalEntryId: 'sales-journal', statementLineId: 'sales-line', section: 'REVENUE' as const, amount: new Prisma.Decimal('100.0000'), event: salesEvent },
  // Historical source already posted the gross amount to the mapped expense
  // account; exclusive mode must normalize it back to the event net amount.
  { journalEntryId: 'purchase-journal', statementLineId: 'purchase-line', section: 'EXPENSE' as const, amount: new Prisma.Decimal('230.0000'), event: purchaseEvent },
  { journalEntryId: 'accrual-journal', statementLineId: 'expense-line', section: 'EXPENSE' as const, amount: new Prisma.Decimal('50.0000'), event: null },
];
const vatControlLines = new Map([['accrual-journal', { input: new Prisma.Decimal('7.5000'), output: new Prisma.Decimal('0.0000') }]]);
const inclusive = applyVatPresentationToJournalContributions(vatModeContributions, vatControlLines, true);
assert.equal(inclusive.amountByStatementLine.get('sales-line')?.toFixed(4), '115.0000');
assert.equal(inclusive.amountByStatementLine.get('purchase-line')?.toFixed(4), '230.0000');
assert.equal(inclusive.amountByStatementLine.get('expense-line')?.toFixed(4), '57.5000');
assert.equal(inclusive.audit.state, 'COMPLETE');
const exclusive = applyVatPresentationToJournalContributions(vatModeContributions, vatControlLines, false);
assert.equal(exclusive.amountByStatementLine.get('sales-line')?.toFixed(4), '100.0000');
assert.equal(exclusive.amountByStatementLine.get('purchase-line')?.toFixed(4), '200.0000');
assert.equal(exclusive.amountByStatementLine.get('expense-line')?.toFixed(4), '50.0000');
assert.equal(exclusive.audit.state, 'COMPLETE');

const totals = calculateAccrualProfitLossTotals([
  { section: 'REVENUE', amount: new Prisma.Decimal('100.0000') },
  { section: 'EXPENSE', amount: new Prisma.Decimal('35.0000') },
  { section: 'EXPENSE', amount: new Prisma.Decimal('5.0000') },
]);
assert.equal(totals.revenue.toFixed(4), '100.0000');
assert.equal(totals.expenses.toFixed(4), '40.0000');
assert.equal(totals.netProfit.toFixed(4), '60.0000');

const payrollOnly = calculateAccrualProfitLossTotals([
  { section: 'EXPENSE', amount: new Prisma.Decimal('35000.0000') },
]);
assert.equal(payrollOnly.expenses.toFixed(4), '35000.0000');
assert.equal(payrollOnly.netProfit.toFixed(4), '-35000.0000');

const partialJulyRange = accrualProfitLossPayrollMonthCoverageRange({
  from: new Date('2026-07-15T00:00:00.000Z'),
  to: new Date('2026-07-20T00:00:00.000Z'),
});
assert.equal(partialJulyRange.from.toISOString(), '2026-07-01T00:00:00.000Z');
assert.equal(partialJulyRange.to.toISOString(), '2026-07-01T00:00:00.000Z');
assert.equal(accrualProfitLossCoverageForHistoricalPayrollRuns(1).state, 'APPROVED_HISTORICAL_EXCEPTION');

const crossMonthRange = accrualProfitLossPayrollMonthCoverageRange({
  from: new Date('2026-07-15T00:00:00.000Z'),
  to: new Date('2026-09-04T00:00:00.000Z'),
});
assert.equal(crossMonthRange.from.toISOString(), '2026-07-01T00:00:00.000Z');
assert.equal(crossMonthRange.to.toISOString(), '2026-09-01T00:00:00.000Z');
assert.equal(accrualProfitLossCoverageForHistoricalPayrollRuns(0).state, 'COMPLETE');

const mappingId = '11111111-1111-4111-8111-111111111111';
const revenueAccountId = '22222222-2222-4222-8222-222222222222';
const expenseAccountId = '33333333-3333-4333-8333-333333333333';
const laterExpenseAccountId = '44444444-4444-4444-8444-444444444444';
const statementLines = [
  {
    id: '55555555-5555-4555-8555-555555555555', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', companyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', mappingVersionId: mappingId,
    code: 'REVENUE', nameAr: 'الإيرادات', nameEn: 'Revenue', presentationNature: 'REVENUE', sortOrder: 10, isSubtotal: false, createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  {
    id: '66666666-6666-4666-8666-666666666666', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', companyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', mappingVersionId: mappingId,
    code: 'OPERATING_EXPENSE', nameAr: 'المصروفات التشغيلية', nameEn: 'Operating expenses', presentationNature: 'OPERATING_EXPENSE', sortOrder: 20, isSubtotal: false, createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
] as const;
const accountMappings = [
  {
    id: '77777777-7777-4777-8777-777777777777', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', companyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', mappingVersionId: mappingId,
    statementLineId: statementLines[0].id, accountId: revenueAccountId, presentationSign: 'CREDIT_NATURE', createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
  {
    id: '88888888-8888-4888-8888-888888888888', tenantId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', companyId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', mappingVersionId: mappingId,
    statementLineId: statementLines[1].id, accountId: expenseAccountId, presentationSign: 'DEBIT_NATURE', createdAt: new Date('2026-08-01T00:00:00.000Z'),
  },
] as const;
const checksum = calculateAccrualProfitLossMappingChecksum({
  versionNumber: 1,
  effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
  effectiveTo: null,
  statementLines,
  accountMappings,
});
const frozenMapping: AccrualProfitLossMappingSnapshot = {
  id: mappingId,
  checksum,
  policyVersion: REPORTING_R0_A_POLICY_VERSION,
  versionNumber: 1,
  effectiveFrom: new Date('2026-08-01T00:00:00.000Z'),
  effectiveTo: null,
  statementLines,
  accountMappings,
};

assert.equal(verifyAccrualProfitLossMappingSnapshot(frozenMapping, { id: mappingId, checksum }), true);
assert.equal(hasCompleteAccrualProfitLossAccountCoverage([revenueAccountId, expenseAccountId], [revenueAccountId, expenseAccountId]), true);
// A later live account makes the current mapping incomplete, but must not
// invalidate a previously issued official run that retained this snapshot.
assert.equal(hasCompleteAccrualProfitLossAccountCoverage([revenueAccountId, expenseAccountId], [revenueAccountId, expenseAccountId, laterExpenseAccountId]), false);
assert.equal(verifyAccrualProfitLossMappingSnapshot(frozenMapping, { id: mappingId, checksum }), true);

const tamperedMapping: AccrualProfitLossMappingSnapshot = {
  ...frozenMapping,
  statementLines: [{ ...statementLines[0], nameAr: 'تم التعديل' }, statementLines[1]],
};
assert.equal(verifyAccrualProfitLossMappingSnapshot(tamperedMapping, { id: mappingId, checksum }), false);
assert.equal(verifyAccrualProfitLossMappingSnapshot(frozenMapping, { id: '99999999-9999-4999-8999-999999999999', checksum }), false);
assert.equal(verifyAccrualProfitLossMappingSnapshot(frozenMapping, { id: mappingId, checksum: '0'.repeat(64) }), false);

console.log('Accrual profit-and-loss calculation policy verification passed.');
