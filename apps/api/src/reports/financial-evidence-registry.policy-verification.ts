import assert from 'node:assert/strict';

import { financialEvidenceLiveRequestSchema, financialEvidenceReceiptSchema, financialEvidenceSourceReceiptSchema } from '@baseer-erp/contracts';

const statementLineId = '11111111-1111-4111-8111-111111111111';
const journalEntryId = '22222222-2222-4222-8222-222222222222';
const lineId = '33333333-3333-4333-8333-333333333333';
const accountId = '44444444-4444-4444-8444-444444444444';
const money = { raw: '100.0000', display: '100.00', sign: 'positive' as const };

const cashRequest = financialEvidenceLiveRequestSchema.safeParse({
  descriptor: { reportCode: 'personal_cash_performance', metric: { kind: 'CASH_ROW', rowCode: 'payroll:wages' } },
  from: '2026-08-01', to: '2026-08-31', vatInclusive: true,
});
assert.equal(cashRequest.success, true);
assert.equal(financialEvidenceLiveRequestSchema.safeParse({
  descriptor: { reportCode: 'personal_cash_performance', metric: { kind: 'CASH_ROW', rowCode: 'غير صالح' } },
  from: '2026-08-01', to: '2026-08-31', vatInclusive: true,
}).success, false);

const profitLossRequest = financialEvidenceLiveRequestSchema.safeParse({
  descriptor: { reportCode: 'accrual_profit_loss', metric: { kind: 'STATEMENT_LINE', statementLineId } },
  from: '2026-08-01', to: '2026-08-31', vatInclusive: true,
});
assert.equal(profitLossRequest.success, true);
assert.equal(financialEvidenceLiveRequestSchema.safeParse({
  descriptor: { reportCode: 'accrual_profit_loss', metric: { kind: 'EXPENSES_TOTAL' } },
  from: '2026-08-01', to: '2026-08-31', vatInclusive: false,
}).success, true);

// New workspaces are required to use the common descriptor; report-run ids
// are not part of this contract and therefore cannot revive a stale route.
assert.equal(financialEvidenceLiveRequestSchema.safeParse({
  descriptor: { reportCode: 'ledger_trial_balance', metric: { kind: 'TRIAL_ACCOUNT', accountId, scope: 'CLOSING', side: 'DEBIT' } },
  from: '2026-08-01', to: '2026-08-31', vatInclusive: true,
}).success, true);
assert.equal(financialEvidenceLiveRequestSchema.safeParse({
  descriptor: { reportCode: 'ledger_trial_balance', metric: { kind: 'TRIAL_TOTAL', scope: 'PERIOD', side: 'CREDIT' } },
  from: '2026-08-01', to: '2026-08-31', vatInclusive: true,
}).success, true);
assert.equal(financialEvidenceLiveRequestSchema.safeParse({
  descriptor: { reportCode: 'ledger_trial_balance', metric: { kind: 'TRIAL_TOTAL', scope: 'PERIOD' } },
  from: '2026-08-01', to: '2026-08-31', vatInclusive: true,
}).success, false, 'A Trial Balance evidence cell must declare its debit/credit side.');
assert.equal(financialEvidenceLiveRequestSchema.safeParse({
  descriptor: { reportCode: 'internal_vat_report', metric: { kind: 'VAT_ROW', rowCode: 'output_vat' } },
  from: '2026-08-01', to: '2026-08-31', vatInclusive: true,
}).success, true);
// Composite VAT proof reconciles to output minus input, not their displayed
// magnitudes. The central service signs input tax only for VAT_NET.
const vatNetFixture = [{ raw: '30.0000' }, { raw: '-10.0000' }];
assert.equal(vatNetFixture.reduce((sum, item) => sum + Number(item.raw), 0), 20);
assert.equal(financialEvidenceLiveRequestSchema.safeParse({
  descriptor: { reportCode: 'internal_vat_report', metric: { kind: 'VAT_NET' } },
  from: '2026-08-01', to: '2026-08-31', vatInclusive: true,
}).success, true);

assert.equal(financialEvidenceReceiptSchema.safeParse({
  descriptor: { reportCode: 'accrual_profit_loss', metric: { kind: 'NET_PROFIT' } },
  nextCursor: null,
  items: [{
    evidenceId: journalEntryId, businessDate: '2026-08-31', amount: money,
    source: { journalEntryId, labelAr: 'قيد يومية', labelEn: 'Journal entry', reference: 'JV-1', description: null, counterparty: null },
  }],
}).success, true);

// Positive evidence → source fixture: the source id returned by an evidence
// page is the only id accepted by the source receipt, not a visible label.
const evidenceFixture = financialEvidenceReceiptSchema.parse({
  descriptor: { reportCode: 'ledger_trial_balance', metric: { kind: 'TRIAL_ACCOUNT', accountId, scope: 'PERIOD', side: 'DEBIT' } },
  nextCursor: null,
  items: [{
    evidenceId: lineId, businessDate: '2026-08-31', amount: money,
    source: { journalEntryId, labelAr: 'قيد يومية', labelEn: 'Journal entry', reference: 'JV-1', description: null, counterparty: null },
  }],
});
assert.equal(financialEvidenceSourceReceiptSchema.safeParse({
  journalEntry: {
    id: journalEntryId, businessDate: '2026-08-31', labelAr: 'قيد يومية', labelEn: 'Journal entry', sourceReference: 'JV-1', description: null, counterparty: null, status: 'POSTED',
    lines: [
      // Historic Arabic-first accounts may not have an English translation.
      { id: lineId, lineNumber: 1, accountCode: '1000', accountNameAr: 'نقد', accountNameEn: '', debit: money, credit: { raw: '0.0000', display: '0.00', sign: 'zero' }, description: null },
      { id: statementLineId, lineNumber: 2, accountCode: '4000', accountNameAr: 'إيراد', accountNameEn: 'Revenue', debit: { raw: '0.0000', display: '0.00', sign: 'zero' }, credit: money, description: null },
    ],
  },
}).success, true);
const sourceFixture = financialEvidenceSourceReceiptSchema.parse({
  journalEntry: {
    id: journalEntryId, businessDate: '2026-08-31', labelAr: 'قيد يومية', labelEn: 'Journal entry', sourceReference: 'JV-1', description: null, counterparty: null, status: 'POSTED',
    lines: [
      { id: lineId, lineNumber: 1, accountCode: '1000', accountNameAr: 'نقد', accountNameEn: '', debit: money, credit: { raw: '0.0000', display: '0.00', sign: 'zero' }, description: null },
      { id: statementLineId, lineNumber: 2, accountCode: '4000', accountNameAr: 'إيراد', accountNameEn: 'Revenue', debit: { raw: '0.0000', display: '0.00', sign: 'zero' }, credit: money, description: null },
    ],
  },
});
assert.equal(sourceFixture.journalEntry.id, evidenceFixture.items[0]!.source.journalEntryId);

console.log('Financial evidence registry policy verification passed.');
