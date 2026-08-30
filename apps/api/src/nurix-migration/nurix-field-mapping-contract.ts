/**
 * Immutable field-level contract for Noorix Excel packages.
 *
 * This contract deliberately distinguishes a target field from an import
 * writer.  A mapped field may be direct, transformed, or retained as
 * historical evidence, but no writer may assume that a mapping alone is
 * authorization to post financial data.
 */
export type NurixFieldTreatment = 'DIRECT' | 'TRANSFORM' | 'HISTORICAL_ONLY' | 'GAP';

export type NurixExcelSheetDefinition = { name: string; requiredColumns: readonly string[] };
export type NurixFieldMapping = {
  sheet: string;
  sourceField: string;
  target: string;
  treatment: NurixFieldTreatment;
  writer: string;
  requiredForWrite: boolean;
};

const sheet = (name: string, requiredColumns: readonly string[]): NurixExcelSheetDefinition => ({ name, requiredColumns });

export const NURIX_EXCEL_SHEET_DEFINITIONS = [
  sheet('Manifest', ['Field', 'Value', 'Rule']),
  sheet('Suppliers', ['source_id', 'name_ar', 'name_en', 'supplier_category_source_id', 'status', 'notes']),
  sheet('Accounts', ['source_id', 'code', 'name_ar', 'name_en', 'account_type', 'status']),
  sheet('Categories', ['baseer_category_code', 'name_ar', 'name_en', 'category_type', 'parent_baseer_category_code', 'status', 'classification_source', 'confidence']),
  sheet('Vaults', ['source_id', 'name_ar', 'name_en', 'status']),
  sheet('Employees', ['source_id', 'employee_serial', 'name_ar', 'name_en', 'iqama_number', 'job_title', 'join_date', 'status', 'notes']),
  sheet('Invoices', ['source_id', 'source_company_id', 'kind', 'status', 'document_number', 'supplier_source_id', 'baseer_category_code', 'vault_source_id', 'transaction_date', 'invoice_date', 'net_amount', 'tax_amount', 'gross_amount', 'payment_method_source_id', 'source_reference', 'notes']),
  sheet('InvoiceAllocations', ['source_id', 'invoice_source_id', 'vault_source_id', 'payment_method_source_id', 'amount']),
  sheet('LedgerEntries', ['source_id', 'source_company_id', 'reference_entity', 'reference_source_id', 'debit_account_source_id', 'credit_account_source_id', 'vault_source_id', 'entry_date', 'amount', 'status', 'notes']),
  sheet('RecurringExpenseProfiles', ['source_id', 'name_ar', 'name_en', 'supplier_source_id', 'baseer_category_code', 'expected_amount', 'interval_months', 'status', 'service_number', 'notes']),
  sheet('RecurringExpensePayments', ['source_id', 'profile_source_id', 'supplier_source_id', 'baseer_category_code', 'vault_source_id', 'document_number', 'transaction_date', 'net_amount', 'tax_amount', 'gross_amount', 'status', 'notes']),
  sheet('EmployeeServices', ['source_id', 'employee_source_id', 'service_type', 'reference_number', 'issue_date', 'expiry_date', 'supplier_source_id', 'baseer_category_code', 'cost_invoice_source_id', 'status', 'notes']),
  sheet('EmployeeDeductions', ['source_id', 'employee_source_id', 'deduction_type', 'amount', 'transaction_date', 'source_reference', 'notes']),
  sheet('EmployeeMovements', ['source_id', 'employee_source_id', 'movement_type', 'amount', 'previous_value', 'new_value', 'effective_date', 'notes']),
  sheet('DailySalesClosings', ['source_id', 'summary_number', 'transaction_date', 'shift', 'customer_count', 'cash_on_hand', 'total_amount', 'status', 'notes']),
  sheet('DailySalesAllocations', ['source_id', 'closing_source_id', 'vault_source_id', 'amount']),
  sheet('BankStatements', ['source_id', 'file_name', 'bank_name', 'start_date', 'end_date', 'status', 'total_deposits', 'total_withdrawals', 'transaction_count']),
  sheet('BankTransactions', ['source_id', 'statement_source_id', 'transaction_date', 'description', 'debit', 'credit', 'balance', 'reference', 'notes', 'classification_name', 'transaction_type', 'manually_classified']),
  sheet('VatPlanning', ['source_id', 'year', 'quarter', 'payment_target', 'filing_submitted', 'imported_at', 'notes']),
  sheet('Assets', ['source_id', 'name_ar', 'name_en', 'serial_number', 'location', 'purchase_date', 'acquisition_cost', 'supplier_source_id', 'invoice_source_id', 'baseer_category_code', 'warranty_description', 'warranty_start_date', 'warranty_end_date', 'notes']),
  sheet('CategoryAudit', ['source_category_id', 'source_category_name_ar', 'baseer_category_code', 'baseer_category_name_ar', 'confidence', 'reason_ar', 'invoice_count']),
  sheet('Exceptions', ['source_sheet', 'source_id', 'severity', 'code', 'message', 'resolution']),
] as const;

const policy: Record<string, { target: string; treatment: NurixFieldTreatment; writer: string; requiredForWrite?: boolean }> = {
  Manifest: { target: 'LegacyMigrationPackage.metadata', treatment: 'DIRECT', writer: 'package-intake' },
  Suppliers: { target: 'FinanceSupplier', treatment: 'DIRECT', writer: 'supplier-writer', requiredForWrite: true },
  Accounts: { target: 'FinanceAccount', treatment: 'DIRECT', writer: 'account-writer', requiredForWrite: true },
  Categories: { target: 'FinanceCategory', treatment: 'DIRECT', writer: 'category-writer', requiredForWrite: true },
  Vaults: { target: 'FinanceVault', treatment: 'DIRECT', writer: 'vault-writer', requiredForWrite: true },
  Employees: { target: 'HrEmployee', treatment: 'DIRECT', writer: 'employee-writer', requiredForWrite: true },
  Invoices: { target: 'FinanceOutflowDocument', treatment: 'TRANSFORM', writer: 'outflow-writer', requiredForWrite: true },
  InvoiceAllocations: { target: 'FinanceOutflowAllocation', treatment: 'TRANSFORM', writer: 'outflow-writer', requiredForWrite: true },
  LedgerEntries: { target: 'FinanceJournalEntry (derived/reconciled)', treatment: 'TRANSFORM', writer: 'outflow-writer', requiredForWrite: true },
  RecurringExpenseProfiles: { target: 'FinanceRecurringExpenseProfile', treatment: 'DIRECT', writer: 'recurring-profile-writer', requiredForWrite: true },
  RecurringExpensePayments: { target: 'FinanceOutflowDocument + recurring coverage', treatment: 'TRANSFORM', writer: 'recurring-payment-writer', requiredForWrite: true },
  EmployeeServices: { target: 'HrEmployeeService', treatment: 'TRANSFORM', writer: 'employee-service-writer', requiredForWrite: true },
  EmployeeDeductions: { target: 'HrEmployeeAdministrativeDeduction', treatment: 'TRANSFORM', writer: 'employee-deduction-writer', requiredForWrite: true },
  EmployeeMovements: { target: 'HR lifecycle / historical evidence', treatment: 'TRANSFORM', writer: 'employee-movement-writer' },
  DailySalesClosings: { target: 'FinanceDailySalesClosing', treatment: 'TRANSFORM', writer: 'daily-sales-writer', requiredForWrite: true },
  DailySalesAllocations: { target: 'FinanceDailySalesAllocation', treatment: 'TRANSFORM', writer: 'daily-sales-writer', requiredForWrite: true },
  BankStatements: { target: 'Migration evidence / bank reconciliation', treatment: 'HISTORICAL_ONLY', writer: 'evidence-archive' },
  BankTransactions: { target: 'Migration evidence / bank reconciliation', treatment: 'HISTORICAL_ONLY', writer: 'evidence-archive' },
  VatPlanning: { target: 'VAT planning evidence; never a cash settlement', treatment: 'HISTORICAL_ONLY', writer: 'vat-evidence-writer' },
  Assets: { target: 'Asset warranty evidence after financial-document match', treatment: 'HISTORICAL_ONLY', writer: 'asset-evidence-writer' },
  CategoryAudit: { target: 'LegacyMigrationRecordMap review evidence', treatment: 'DIRECT', writer: 'migration-audit' },
  Exceptions: { target: 'LegacyMigrationException', treatment: 'DIRECT', writer: 'migration-exception-writer' },
};

const fieldTarget = (sheetName: string, sourceField: string, target: string) => {
  if (sourceField === 'source_id') return 'LegacyMigrationRecordMap.sourceId';
  if (sourceField.endsWith('_source_id') || sourceField === 'source_reference') return `Source lineage / ${target}`;
  return `${target}.${sourceField}`;
};

export const NURIX_FIELD_MAPPINGS: readonly NurixFieldMapping[] = NURIX_EXCEL_SHEET_DEFINITIONS.flatMap((definition) => {
  const rule = policy[definition.name];
  if (!rule) throw new Error(`Missing Noorix field policy for sheet: ${definition.name}`);
  return definition.requiredColumns.map((sourceField) => ({
    sheet: definition.name,
    sourceField,
    target: fieldTarget(definition.name, sourceField, rule.target),
    treatment: rule.treatment,
    writer: rule.writer,
    requiredForWrite: Boolean(rule.requiredForWrite && !['notes', 'name_en', 'payment_method_source_id'].includes(sourceField)),
  }));
});

/** Source domains not yet represented by V3; a live run remains impossible until these are implemented. */
export const NURIX_EXECUTION_BLOCKERS = [
  'PayrollRuns/PayrollLines: historical evidence archive is available; operational payroll, payment, journal, and employee-balance lifecycle remains deliberately blocked.',
  'EmployeeAdvances/AdvanceSettlements: dedicated lifecycle writer and balance reconciliation are not built.',
  'Operations orders, receipts, conversions, recipes, inventory and custody: separate lifecycle writers are not built.',
  'Financial fixed-asset register and depreciation: Baseer has no equivalent full asset-accounting writer.',
  'Bank statement transactions: evidence only; no automatic cash/ledger writer is allowed.',
] as const;

export function fieldCoverage() {
  const mapped = new Set(NURIX_FIELD_MAPPINGS.map((mapping) => `${mapping.sheet}:${mapping.sourceField}`));
  const missing = NURIX_EXCEL_SHEET_DEFINITIONS.flatMap((definition) => definition.requiredColumns
    .filter((field) => !mapped.has(`${definition.name}:${field}`))
    .map((field) => `${definition.name}.${field}`));
  const byTreatment = (treatment: NurixFieldTreatment) => NURIX_FIELD_MAPPINGS.filter((mapping) => mapping.treatment === treatment).length;
  return { contractVersion: 'noorix-field-contract/v1', mappedFields: NURIX_FIELD_MAPPINGS.length, unmappedFields: missing, direct: byTreatment('DIRECT'), transform: byTreatment('TRANSFORM'), historicalOnly: byTreatment('HISTORICAL_ONLY'), gaps: byTreatment('GAP'), executionBlockers: [...NURIX_EXECUTION_BLOCKERS] };
}
