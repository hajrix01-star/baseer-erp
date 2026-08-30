import assert from 'node:assert/strict';
import {
  NurixExcelFinancialImportService,
  type NurixHistoricalFinancePlanInput,
} from './nurix-excel-financial-import.service.js';

const hash = 'a'.repeat(64);
const input: NurixHistoricalFinancePlanInput = {
  packageId: 'package-1', workbookSha256: hash, sourceCompanyId: 'noorix-arz', targetCompanyId: 'baseer-arz',
  mapping: {
    checksum: hash,
    accountsBySourceId: { debit: { id: 'account-expense', active: true, code: 'E-1' }, credit: { id: 'account-cash', active: true, code: 'V-1' } },
    suppliersBySourceId: { supplier: { id: 'supplier-1', active: true } },
    vaultsBySourceId: { vault: { id: 'vault-1', active: true, paymentDestination: true, accountId: 'account-cash', defaultPaymentMethod: 'CASH', paymentMethods: ['CASH'] } },
    categoriesByCode: { 'E-1': { id: 'category-1', active: true, posting: true, accountId: 'account-expense', kind: 'EXPENSE' } },
  },
  invoices: [{ sourceId: 'invoice-1', sourceChecksum: hash, sourceCompanyId: 'noorix-arz', kind: 'expense', status: 'active', documentNumber: 'EXP-1', supplierSourceId: 'supplier', categoryCode: 'E-1', vaultSourceId: 'vault', transactionDate: '46085', invoiceDate: '46085', netAmount: '100.0000', taxAmount: '15.0000', grossAmount: '115.0000' }],
  allocations: [{ sourceId: 'allocation-1', sourceChecksum: hash, invoiceSourceId: 'invoice-1', vaultSourceId: 'vault', amount: '115.0000' }],
  ledgerEntries: [{ sourceId: 'ledger-1', sourceChecksum: hash, sourceCompanyId: 'noorix-arz', referenceEntity: 'invoice', referenceSourceId: 'invoice-1', debitAccountSourceId: 'debit', creditAccountSourceId: 'credit', vaultSourceId: 'vault', entryDate: '46085', amount: '115.0000', status: 'active' }],
};

const service = new NurixExcelFinancialImportService();
const plan = service.plan(input);
assert.equal(plan.canExecute, true);
assert.equal(plan.items.length, 1);
assert.equal(plan.items[0]?.businessDate, '2026-03-04');
assert.equal(plan.items[0]?.journalLines[0]?.debitAmount, '115.0000');
assert.equal(plan.items[0]?.journalLines[1]?.creditAmount, '115.0000');

const duplicateLedger = service.plan({ ...input, ledgerEntries: [...input.ledgerEntries, { ...input.ledgerEntries[0]!, sourceId: 'ledger-2', sourceChecksum: 'b'.repeat(64) }] });
assert.equal(duplicateLedger.canExecute, false);
assert.ok(duplicateLedger.issues.some((issue) => issue.code === 'LEDGER_CARDINALITY_INVALID'));

const mismatchedVault = service.plan({ ...input, mapping: { ...input.mapping, vaultsBySourceId: { vault: { ...input.mapping.vaultsBySourceId.vault!, accountId: 'other-cash' } } } });
assert.equal(mismatchedVault.canExecute, false);
assert.ok(mismatchedVault.issues.some((issue) => issue.code === 'VAULT_ACCOUNT_MISMATCH'));

console.log('Nurix historical financial planner verification passed.');
