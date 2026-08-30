import fs from 'node:fs/promises';
import { SpreadsheetFile, Workbook } from '@oai/artifact-tool';

const outputDir = process.argv[2];
if (!outputDir) throw new Error('Provide the output directory as the first argument.');

const workbook = Workbook.create();
const sheets = [
  ['Manifest', [
    ['Baseer ERP — Noorix Excel Import Package'],
    ['Fill the values below. Do not add formulas, macros, or external links.'],
    ['Field', 'Value', 'Rule'],
    ['template_version', 'nurix-excel-package/v3', 'Required; final Baseer category codes are written directly on invoices and all official sheets remain present.'],
    ['source_system', 'NOORIX', 'Required; exact value.'],
    ['source_company_id', '', 'Required; original Noorix company ID as text.'],
    ['source_company_name', '', 'Required; original Noorix company name.'],
    ['exported_at', '', 'Required; ISO 8601 timestamp, for example 2026-08-29T12:00:00Z.'],
    ['package_sha256', '', 'Filled by the exporter or upload gate; do not calculate in Excel.'],
    ['invoices_count', '', 'Required whole number.'],
    ['allocations_count', '', 'Required whole number.'],
    ['ledger_entries_count', '', 'Required whole number.'],
  ]],
  ['Suppliers', [['source_id', 'name_ar', 'name_en', 'supplier_category_source_id', 'status', 'notes']]],
  ['Accounts', [['source_id', 'code', 'name_ar', 'name_en', 'account_type', 'status']]],
  ['Categories', [['baseer_category_code', 'name_ar', 'name_en', 'category_type', 'parent_baseer_category_code', 'status', 'classification_source', 'confidence']]],
  ['Vaults', [['source_id', 'name_ar', 'name_en', 'status']]],
  ['Employees', [['source_id', 'employee_serial', 'name_ar', 'name_en', 'iqama_number', 'job_title', 'join_date', 'status', 'notes']]],
  ['Invoices', [[
    'source_id', 'source_company_id', 'kind', 'status', 'document_number', 'supplier_source_id', 'baseer_category_code', 'vault_source_id',
    'transaction_date', 'invoice_date', 'net_amount', 'tax_amount', 'gross_amount', 'payment_method_source_id', 'source_reference', 'notes'
  ]]],
  ['InvoiceAllocations', [['source_id', 'invoice_source_id', 'vault_source_id', 'payment_method_source_id', 'amount']]],
  ['LedgerEntries', [[
    'source_id', 'source_company_id', 'reference_entity', 'reference_source_id', 'debit_account_source_id', 'credit_account_source_id',
    'vault_source_id', 'entry_date', 'amount', 'status', 'notes'
  ]]],
  ['RecurringExpenseProfiles', [['source_id', 'name_ar', 'name_en', 'supplier_source_id', 'baseer_category_code', 'expected_amount', 'interval_months', 'status', 'service_number', 'notes']]],
  ['RecurringExpensePayments', [['source_id', 'profile_source_id', 'supplier_source_id', 'baseer_category_code', 'vault_source_id', 'document_number', 'transaction_date', 'net_amount', 'tax_amount', 'gross_amount', 'status', 'notes']]],
  ['EmployeeServices', [['source_id', 'employee_source_id', 'service_type', 'reference_number', 'issue_date', 'expiry_date', 'supplier_source_id', 'baseer_category_code', 'cost_invoice_source_id', 'status', 'notes']]],
  ['EmployeeDeductions', [['source_id', 'employee_source_id', 'deduction_type', 'amount', 'transaction_date', 'source_reference', 'notes']]],
  ['EmployeeMovements', [['source_id', 'employee_source_id', 'movement_type', 'amount', 'previous_value', 'new_value', 'effective_date', 'notes']]],
  ['DailySalesClosings', [['source_id', 'summary_number', 'transaction_date', 'shift', 'customer_count', 'cash_on_hand', 'total_amount', 'status', 'notes']]],
  ['DailySalesAllocations', [['source_id', 'closing_source_id', 'vault_source_id', 'amount']]],
  ['BankStatements', [['source_id', 'file_name', 'bank_name', 'start_date', 'end_date', 'status', 'total_deposits', 'total_withdrawals', 'transaction_count']]],
  ['BankTransactions', [['source_id', 'statement_source_id', 'transaction_date', 'description', 'debit', 'credit', 'balance', 'reference', 'notes', 'classification_name', 'transaction_type', 'manually_classified']]],
  ['VatPlanning', [['source_id', 'year', 'quarter', 'payment_target', 'filing_submitted', 'imported_at', 'notes']]],
  ['Assets', [['source_id', 'name_ar', 'name_en', 'serial_number', 'location', 'purchase_date', 'acquisition_cost', 'supplier_source_id', 'invoice_source_id', 'baseer_category_code', 'warranty_description', 'warranty_start_date', 'warranty_end_date', 'notes']]],
  ['CategoryAudit', [['source_category_id', 'source_category_name_ar', 'baseer_category_code', 'baseer_category_name_ar', 'confidence', 'reason_ar', 'invoice_count']]],
  ['Exceptions', [['source_sheet', 'source_id', 'severity', 'code', 'message', 'resolution']]],
];

const headerFormat = { fill: '#0C7A55', font: { bold: true, color: '#FFFFFF' }, horizontalAlignment: 'center', verticalAlignment: 'center', wrapText: true };
const titleFormat = { fill: '#0F3D2E', font: { bold: true, color: '#FFFFFF', size: 16 }, horizontalAlignment: 'right', verticalAlignment: 'center' };
const noteFormat = { fill: '#E8F4EF', font: { color: '#24483A', italic: true }, wrapText: true, verticalAlignment: 'center' };
const border = { preset: 'outside', style: 'thin', color: '#C7DED2' };

for (const [name, rows] of sheets) {
  const sheet = workbook.worksheets.add(name);
  sheet.showGridLines = false;
  if (name === 'Manifest') {
    sheet.getRange('A1:C1').merge();
    sheet.getRange('A1').values = [[rows[0][0]]];
    sheet.getRange('A1').format = titleFormat;
    sheet.getRange('A2:C2').merge();
    sheet.getRange('A2').values = [[rows[1][0]]];
    sheet.getRange('A2').format = noteFormat;
    sheet.getRange('A3:C3').values = [rows[2]];
    sheet.getRange('A3:C3').format = headerFormat;
    sheet.getRange(`A4:C${rows.length}`).values = rows.slice(3);
    sheet.getRange(`A3:C${rows.length}`).format.borders = border;
    sheet.getRange(`A4:A${rows.length}`).format.font = { bold: true, color: '#183C2D' };
    sheet.getRange('A:A').format.columnWidth = 27;
    sheet.getRange('B:B').format.columnWidth = 34;
    sheet.getRange('C:C').format.columnWidth = 55;
    sheet.getRange('A1:C2').format.rowHeight = 26;
    sheet.freezePanes.freezeRows(3);
  } else {
    const headers = rows[0];
    const endColumn = sheet.getCell(0, headers.length - 1).address.replace(/\d/g, '');
    sheet.getRange(`A1:${endColumn}1`).values = [headers];
    sheet.getRange(`A1:${endColumn}1`).format = headerFormat;
    sheet.getRange(`A1:${endColumn}1`).format.borders = border;
    sheet.getRange(`A2:${endColumn}201`).format.numberFormat = '@';
    sheet.getRange(`A1:${endColumn}201`).format.wrapText = false;
    sheet.getRange(`A1:${endColumn}1`).format.rowHeight = 30;
    sheet.getRange(`A1:${endColumn}201`).format.borders = { preset: 'outside', style: 'thin', color: '#E0ECE6' };
    sheet.getRange(`A1:${endColumn}1`).format.autofitColumns();
    for (let i = 0; i < headers.length; i += 1) sheet.getCell(0, i).format.columnWidth = Math.max(18, Math.min(32, String(headers[i]).length + 8));
    sheet.freezePanes.freezeRows(1);
  }
}

const output = await SpreadsheetFile.exportXlsx(workbook);
await fs.mkdir(outputDir, { recursive: true });
await output.save(`${outputDir}/noorix-excel-import-template-v3.xlsx`);

for (const [name] of sheets) {
  const preview = await workbook.render({ sheetName: name, autoCrop: 'all', scale: 1, format: 'png' });
  await fs.writeFile(`${outputDir}/${name}.png`, new Uint8Array(await preview.arrayBuffer()));
}

const overview = await workbook.inspect({ kind: 'workbook,sheet,table', maxChars: 5000, tableMaxRows: 4, tableMaxCols: 8 });
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A', options: { useRegex: true, maxResults: 100 }, summary: 'formula errors' });
console.log(overview.ndjson);
console.log(errors.ndjson);
