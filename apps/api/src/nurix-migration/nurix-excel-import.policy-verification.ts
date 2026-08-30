/** Run after API build: `node apps/api/dist/nurix-migration/nurix-excel-import.policy-verification.js`. */
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { NurixExcelImportService } from './nurix-excel-import.service.js';

const companyId = 'noorix-arz';
const targetCompanyId = '11111111-1111-4111-8111-111111111111';
const exportedAt = '2026-08-29T10:00:00.000Z';
const headers: Record<string, string[]> = {
  Suppliers: ['source_id', 'name_ar', 'name_en', 'supplier_category_source_id', 'status', 'notes'], Accounts: ['source_id', 'code', 'name_ar', 'name_en', 'account_type', 'status'], Categories: ['baseer_category_code', 'name_ar', 'name_en', 'category_type', 'parent_baseer_category_code', 'status', 'classification_source', 'confidence'], Vaults: ['source_id', 'name_ar', 'name_en', 'status'],
  Employees: ['source_id', 'employee_serial', 'name_ar', 'name_en', 'iqama_number', 'job_title', 'join_date', 'status', 'notes'], RecurringExpenseProfiles: ['source_id', 'name_ar', 'name_en', 'supplier_source_id', 'baseer_category_code', 'expected_amount', 'interval_months', 'status', 'service_number', 'notes'], RecurringExpensePayments: ['source_id', 'profile_source_id', 'supplier_source_id', 'baseer_category_code', 'vault_source_id', 'document_number', 'transaction_date', 'net_amount', 'tax_amount', 'gross_amount', 'status', 'notes'], EmployeeServices: ['source_id', 'employee_source_id', 'service_type', 'reference_number', 'issue_date', 'expiry_date', 'supplier_source_id', 'baseer_category_code', 'cost_invoice_source_id', 'status', 'notes'], EmployeeDeductions: ['source_id', 'employee_source_id', 'deduction_type', 'amount', 'transaction_date', 'source_reference', 'notes'], EmployeeMovements: ['source_id', 'employee_source_id', 'movement_type', 'amount', 'previous_value', 'new_value', 'effective_date', 'notes'], DailySalesClosings: ['source_id', 'summary_number', 'transaction_date', 'shift', 'customer_count', 'cash_on_hand', 'total_amount', 'status', 'notes'], DailySalesAllocations: ['source_id', 'closing_source_id', 'vault_source_id', 'amount'], BankStatements: ['source_id', 'file_name', 'bank_name', 'start_date', 'end_date', 'status', 'total_deposits', 'total_withdrawals', 'transaction_count'], BankTransactions: ['source_id', 'statement_source_id', 'transaction_date', 'description', 'debit', 'credit', 'balance', 'reference', 'notes', 'classification_name', 'transaction_type', 'manually_classified'], VatPlanning: ['source_id', 'year', 'quarter', 'payment_target', 'filing_submitted', 'imported_at', 'notes'], Assets: ['source_id', 'name_ar', 'name_en', 'serial_number', 'location', 'purchase_date', 'acquisition_cost', 'supplier_source_id', 'invoice_source_id', 'baseer_category_code', 'warranty_description', 'warranty_start_date', 'warranty_end_date', 'notes'],
  Invoices: ['source_id', 'source_company_id', 'kind', 'status', 'document_number', 'supplier_source_id', 'baseer_category_code', 'vault_source_id', 'transaction_date', 'invoice_date', 'net_amount', 'tax_amount', 'gross_amount', 'payment_method_source_id', 'source_reference', 'notes'],
  InvoiceAllocations: ['source_id', 'invoice_source_id', 'vault_source_id', 'payment_method_source_id', 'amount'], LedgerEntries: ['source_id', 'source_company_id', 'reference_entity', 'reference_source_id', 'debit_account_source_id', 'credit_account_source_id', 'vault_source_id', 'entry_date', 'amount', 'status', 'notes'], CategoryAudit: ['source_category_id', 'source_category_name_ar', 'baseer_category_code', 'baseer_category_name_ar', 'confidence', 'reason_ar', 'invoice_count'], Exceptions: ['source_sheet', 'source_id', 'severity', 'code', 'message', 'resolution'],
};
function workbook(formula = false, allocation = true, reconciliationMismatch = false, invalidSupplier = false): Buffer {
  const data: Record<string, string[][]> = {
    Accounts: [['a1', '100', 'مدين', '', 'asset', 'active'], ['a2', '200', 'دائن', '', 'liability', 'active']], Categories: [['EXP-004', 'رواتب', '', 'expense', '', 'active', 'LOCAL_CATEGORY_INTELLIGENCE', 'HIGH']], Suppliers: [['s1', 'مورد', '', '', 'active', '']], Vaults: [['v1', 'نقد', '', 'active']],
    Invoices: [['i1', companyId, 'purchase', 'active', 'N-1', 's1', 'EXP-004', 'v1', exportedAt, exportedAt, '100.0000', '15.0000', '115.0000', '', '', '']], InvoiceAllocations: allocation ? [['al1', 'i1', 'v1', '', '115.0000']] : [], LedgerEntries: [['l1', companyId, 'invoice', 'i1', 'a1', 'a2', 'v1', exportedAt, '115.0000', 'active', '']], CategoryAudit: [['c1', 'مصروف', 'EXP-004', 'رواتب', 'HIGH', 'تجربة', '1']], Exceptions: [],
  };
  data.Suppliers![0]![4] = invalidSupplier ? 'unknown' : 'active';
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Baseer ERP — Noorix Excel Import Package'], ['Do not add formulas, macros, or external links.'], ['Field', 'Value', 'Rule'], ['template_version', 'nurix-excel-package/v3', 'Required'], ['source_system', 'NOORIX', 'Required'], ['source_company_id', companyId, 'Required'], ['source_company_name', 'ARZ', 'Required'], ['exported_at', exportedAt, 'Required'], ['package_sha256', 'a'.repeat(64), 'Required'], ['source_fingerprint', 'b'.repeat(64), 'Required'], ['financial_invoices_count', '1', 'Control count'], ['recurring_payments_count', '0', 'Control count'], ['daily_sales_count', '0', 'Control count'], ['employee_services_count', '0', 'Control count'], ['assets_count', '0', 'Control count'], ['financial_invoices_gross_amount', '115.0000', 'Control total'], ['financial_invoice_allocations_amount', allocation ? '115.0000' : '0.0000', 'Control total'], ['financial_ledger_amount', '115.0000', 'Control total'], ['recurring_payments_gross_amount', '0.0000', 'Control total'], ['daily_sales_total_amount', '0.0000', 'Control total'], ['daily_sales_allocations_amount', '0.0000', 'Control total'], ['employee_deductions_amount', '0.0000', 'Control total'], ['bank_transactions_debit_amount', '0.0000', 'Control total'], ['bank_transactions_credit_amount', '0.0000', 'Control total'], ['assets_acquisition_cost_amount', '0.0000', 'Control total']]), 'Manifest');
  for (const [name, head] of Object.entries(headers)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([head, ...(data[name] ?? [])]), name);
  if (reconciliationMismatch) book.Sheets.Manifest!['B11'] = { t: 's', v: '2' };
  if (formula) book.Sheets.Invoices!['J2'] = { f: '100', t: 'n', v: 100 };
  return XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
}
async function main(): Promise<void> {
  const persisted = { packages: [] as unknown[], batches: [] as unknown[], rows: [] as unknown[] };
  const database = { inTenantTransaction: async (_tenantId: string, callback: (tx: unknown) => Promise<unknown>) => callback({
    company: { findFirst: async () => ({ id: targetCompanyId, migrationReviewLocked: true }) },
    financeSupplier: { findMany: async () => [{ nameAr: 'مورد' }] },
    financeAccount: { findMany: async () => [{ code: '100', type: 'ASSET' }] },
    financeCategory: { findMany: async () => [{ code: 'EXP-004', kind: 'EXPENSE' }] },
    financeVault: { findMany: async () => [{ nameAr: 'نقد' }] },
    hrEmployee: { findMany: async () => [] },
    nurixExcelStagingPackage: { upsert: async (args: unknown) => { persisted.packages.push(args); return { id: '44444444-4444-4444-8444-444444444444', storageReference: null, encryptionIv: null, storedByteSize: null }; }, update: async () => ({}) },
    nurixExcelStagingBatch: { upsert: async (args: unknown) => { persisted.batches.push(args); return { id: 'batch-1' }; } },
    nurixExcelStagingRow: { createMany: async (args: { data: unknown[] }) => { persisted.rows.push(...args.data); return { count: args.data.length }; } },
  }) };
  const storage = { store: async () => ({ storageReference: 'packages/22222222-2222-4222-8222-222222222222/11111111-1111-4111-8111-111111111111.bin', encryptionIv: 'AAAAAAAAAAAAAAAA', storedByteSize: 1n }) };
  const service = new NurixExcelImportService(database as never, storage as never);
  const fieldMap = service.fieldMap();
  assert.ok(fieldMap.mappedFields > 100); assert.deepEqual(fieldMap.unmappedFields, []); assert.ok(fieldMap.executionBlockers.length > 0);
  const base = { targetCompanyId, sourceCompanyId: companyId, templateVersion: 'nurix-excel-package/v3' as const, workbook: { fileName: 'arz.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', byteSize: 1, exportedAt } };
  const context = { tenantId: '22222222-2222-4222-8222-222222222222', actorUserId: '33333333-3333-4333-8333-333333333333', isOwner: true };
  const parsed = await service.dryRun(context, { ...base, workbook: { ...base.workbook, contentsBase64: workbook().toString('base64') } });
  assert.equal(parsed.status, 'PARSED_DRY_RUN'); assert.equal(parsed.canStage, false); assert.equal(parsed.financialWrites, 0); assert.equal(parsed.rejectedRows, 0); assert.equal(parsed.reconciliation.passed, true);
  assert.equal(parsed.masterDataReadiness.availability, 'READ_ONLY_ANALYZED'); assert.equal(parsed.masterDataReadiness.exactMatches.suppliers, 1); assert.equal(parsed.masterDataReadiness.exactMatches.accounts, 1); assert.equal(parsed.masterDataReadiness.exactMatches.categories, 1); assert.equal(parsed.masterDataReadiness.exactMatches.vaults, 1); assert.equal(parsed.masterDataReadiness.createCandidates.accounts, 1); assert.equal(parsed.masterDataReadiness.canWrite, false);
  assert.equal(persisted.packages.length, 1); assert.equal(persisted.batches.length, 1); assert.ok(persisted.rows.length > 0);
  assert.match(JSON.stringify(persisted.packages[0]), /READY_FOR_RECONCILIATION/); assert.match(JSON.stringify(persisted.packages[0]), /sourceFingerprint/);
  const payable = await service.dryRun(context, { ...base, workbook: { ...base.workbook, contentsBase64: workbook(false, false).toString('base64') } });
  assert.equal(payable.status, 'PARSED_DRY_RUN'); assert.equal(payable.checks.find((check) => check.code === 'ROW_VALIDATION')?.passed, true);
  const mismatch = await service.dryRun(context, { ...base, workbook: { ...base.workbook, contentsBase64: workbook(false, true, true).toString('base64') } });
  assert.equal(mismatch.status, 'REJECTED'); assert.equal(mismatch.checks.find((check) => check.code === 'SOURCE_TO_STAGING_RECONCILIATION')?.passed, false);
  const formula = await service.dryRun(context, { ...base, workbook: { ...base.workbook, contentsBase64: workbook(true).toString('base64') } });
  assert.equal(formula.status, 'REJECTED'); assert.equal(formula.checks.some((check) => check.code === 'WORKBOOK_FORMULAS' && !check.passed), true);
  const invalidMaster = await service.dryRun(context, { ...base, workbook: { ...base.workbook, contentsBase64: workbook(false, true, false, true).toString('base64') } });
  assert.equal(invalidMaster.status, 'REJECTED'); assert.equal(invalidMaster.rowIssues.some((issue) => issue.sheet === 'Suppliers' && issue.code === 'SUPPLIER_MASTER_INVALID'), true);
  console.log('Nurix Excel import policy verification passed: server hashes bytes, rejects formulas, and validates the controlled workbook without financial writes.');
}
void main();
