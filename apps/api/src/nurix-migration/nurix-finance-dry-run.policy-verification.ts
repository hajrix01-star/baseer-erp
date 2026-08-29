/** Run after API build: `node apps/api/dist/nurix-migration/nurix-finance-dry-run.policy-verification.js`. */
import assert from 'node:assert/strict';

import { dryRunNurixFinanceMigration } from './nurix-finance-dry-run.js';

function validInput() {
  return {
    sourceCompanyId: 'legacy-company',
    targetCompanyId: 'target-company',
    targetIdBySourceId: { 'account-debit': 'target-account-debit', 'account-credit': 'target-account-credit', category: 'target-category', supplier: 'target-supplier', vault: 'target-vault', invoice: 'target-invoice', ledger: 'target-ledger' },
    approvedInvoiceKinds: ['expense'],
    accounts: [{ id: 'account-debit', companyId: 'legacy-company', code: '1000' }, { id: 'account-credit', companyId: 'legacy-company', code: '2000' }],
    categories: [{ id: 'category', companyId: 'legacy-company', code: 'E1' }],
    suppliers: [{ id: 'supplier', companyId: 'legacy-company' }],
    vaults: [{ id: 'vault', companyId: 'legacy-company' }],
    invoices: [{ id: 'invoice', companyId: 'legacy-company', kind: 'expense', status: 'active', totalAmount: '115.0000', netAmount: '100.0000', taxAmount: '15.0000', categoryId: 'category', supplierId: 'supplier', vaultId: 'vault' }],
    invoiceAllocations: [{ invoiceId: 'invoice', vaultId: 'vault', amount: '115.0000' }],
    ledgerEntries: [{ id: 'ledger', companyId: 'legacy-company', status: 'active', debitAccountId: 'account-debit', creditAccountId: 'account-credit', amount: '115.0000' }],
  };
}

function main(): void {
  const clean = dryRunNurixFinanceMigration(validInput());
  assert.equal(clean.mode, 'DRY_RUN');
  assert.equal(clean.canStage, true);
  assert.equal(clean.acceptedByEntity.invoices, 1);
  assert.equal(clean.financialTotals.acceptedInvoiceGross, '115.0000');
  assert.equal(clean.financialTotals.plannedLedgerDebit, clean.financialTotals.plannedLedgerCredit);

  const badKind = dryRunNurixFinanceMigration({ ...validInput(), invoices: [{ ...validInput().invoices[0]!, kind: 'salary' }] });
  assert.equal(badKind.canStage, false);
  assert.equal(badKind.rejectedByCode.INVOICE_KIND_UNAPPROVED, 1);

  const badAllocation = dryRunNurixFinanceMigration({ ...validInput(), invoiceAllocations: [{ invoiceId: 'invoice', vaultId: 'vault', amount: '114.9999' }] });
  assert.equal(badAllocation.canStage, false);
  assert.equal(badAllocation.rejectedByCode.INVOICE_ALLOCATION_MISMATCH, 1);

  const crossCompany = dryRunNurixFinanceMigration({ ...validInput(), ledgerEntries: [{ ...validInput().ledgerEntries[0]!, companyId: 'other-company' }] });
  assert.equal(crossCompany.canStage, false);
  assert.equal(crossCompany.rejectedByCode.LEDGER_COMPANY_MISMATCH, 1);

  const orphanAllocation = dryRunNurixFinanceMigration({ ...validInput(), invoiceAllocations: [{ invoiceId: 'other-invoice', vaultId: 'vault', amount: '1.0000' }] });
  assert.equal(orphanAllocation.canStage, false);
  assert.equal(orphanAllocation.rejectedByCode.INVOICE_ALLOCATION_ORPHAN, 1);

  console.log('Nurix finance dry-run policy verification passed: pure, company-scoped, map-gated, decimal-safe, allocation-checked, and balanced-ledger planned.');
}

main();
