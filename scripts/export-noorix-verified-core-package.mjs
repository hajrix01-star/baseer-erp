/**
 * Builds a deterministic, evidence-only Noorix v3 package from the isolated
 * PostgreSQL snapshot.  It intentionally emits only paid purchase/expense
 * documents and daily sales.  Salary, employee advances, and employee-service
 * costs remain explicit exception evidence for their lifecycle writers.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import dotenv from 'dotenv';
import * as XLSX from 'xlsx';

const [sourceCompanyId, sourceCompanyName, outputPath, targetCompanyId, targetTenantId, createdSince = '', packageRevision = ''] = process.argv.slice(2);
const UUID = /^[0-9a-f-]{36}$/i;
if (!sourceCompanyId || !sourceCompanyName || !outputPath || !UUID.test(targetCompanyId ?? '') || !UUID.test(targetTenantId ?? '') || (createdSince && !/^\d{4}-\d{2}-\d{2}$/.test(createdSince))) {
  throw new Error('Usage: node scripts/export-noorix-verified-core-package.mjs <source-company-id> <source-company-name> <output.xlsx> <target-company-uuid> <target-tenant-uuid> [inclusive-created-date] [package-revision]');
}
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: false, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing to compare source lineage outside the canonical local Baseer test database.');
}
const q = (sql) => {
  const parsed = JSON.parse(execFileSync('docker', [
  'exec', 'baseer-noorix-snapshot-20260902', 'psql', '-U', 'nurix_restore', '-d', 'nurix_snapshot', '-t', '-A', '-c', sql,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim() || '[]');
  return Array.isArray(parsed) ? parsed : [parsed];
};
const sqlText = (value) => `'${String(value).replaceAll("'", "''")}'`;
const targetQ = (sql) => {
  const output = execFileSync('docker', [
    'exec', '-e', `PGPASSWORD=${decodeURIComponent(targetUrl.password)}`,
    'baseer-erp-postgres', 'psql', '-U', decodeURIComponent(targetUrl.username), '-d', 'baseer_erp_test', '-t', '-A', '-c', sql,
  ], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim();
  return JSON.parse(output.split(/\r?\n/).filter(Boolean).at(-1) || '[]');
};
const priorMaps = targetQ(`
  SELECT set_config('app.tenant_id', ${sqlText(targetTenantId)}, false);
  SELECT COALESCE(json_agg(json_build_object('entity', "sourceEntity", 'source_id', "sourceId")), '[]'::json)::text
  FROM (
    SELECT DISTINCT "sourceEntity", "sourceId"
    FROM "NurixExcelFinancialSourceMap"
    WHERE "targetCompanyId"=${sqlText(targetCompanyId)}
      AND state IN ('APPLIED','REUSED','REVERSED')
  ) m
`);
// A Noorix root code can meet two valid Baseer shapes: it can be a posting
// category itself, or a non-posting grouping category with posting children.
// Preserve the established company chart rather than imposing one structure
// across all companies.  A generated legacy child is needed only for the
// latter shape.
const targetCategories = targetQ(`
  SELECT set_config('app.tenant_id', ${sqlText(targetTenantId)}, false);
  SELECT COALESCE(json_agg(json_build_object(
    'code', c.code,
    'name_ar', c."nameAr",
    'kind', c.kind,
    'is_posting', c."isPosting",
    'account_id', c."accountId",
    'parent_code', p.code
  )), '[]'::json)::text
  FROM "FinanceCategory" c
  LEFT JOIN "FinanceCategory" p ON p.id=c."parentId"
  WHERE c."companyId"=${sqlText(targetCompanyId)} AND c.status='ACTIVE'
`);
const targetCategoryByCode = new Map(targetCategories.map((category) => [category.code, category]));
// Reuse the approved Noorix→Baseer category policy from the first migration.
// Most leaf codes are intentionally identical.  These four have different
// source meanings/codes and therefore must resolve to the approved Baseer
// leaf, never to an accidental same-code category.
const approvedSemanticCategoryCodes = new Map([
  ['E2-10', 'E2-8'],
  ['E2-11', 'E2-9'],
  ['E9-2', 'E4-2'],
  ['E9-3', 'E2-10'],
]);
const resolveBaseerCategoryCode = (sourceCode) => approvedSemanticCategoryCodes.get(sourceCode) ?? sourceCode;
const mappedIds = (entity) => priorMaps.filter((map) => map.entity === entity).map((map) => map.source_id);
// Delta membership is source creation time, never merely business date:
// Noorix can backdate a newly entered source record and it must still migrate.
// Identity matching is applied in memory after the source snapshot is read.
// This avoids sending a huge source-id list through Docker's command line.
const filter = createdSince ? ` AND i.created_at::date >= ${sqlText(createdSince)}` : '';
const salesFilter = createdSince ? ` AND d.created_at::date >= ${sqlText(createdSince)}` : '';

let payload = q(`
SELECT json_build_object(
  'accounts', COALESCE((SELECT json_agg(x ORDER BY x->>'code') FROM (
    SELECT json_build_object('source_id',a.id,'code',a.code,'name_ar',a.name_ar,'name_en',a.name_en,'account_type',a.type,'status',CASE WHEN a.is_active THEN 'active' ELSE 'archived' END) x
    FROM accounts a
    WHERE a.company_id=${sqlText(sourceCompanyId)}
      AND EXISTS (
        SELECT 1 FROM ledger_entries l JOIN invoices i ON i.id=l.reference_id
        WHERE l.company_id=a.company_id AND l.reference_type='invoice'
          AND i.kind IN ('purchase','expense','fixed_expense')${filter}
          AND (l.debit_account_id=a.id OR l.credit_account_id=a.id)
      )
  ) s), '[]'::json),
  'categories', COALESCE((SELECT json_agg(x ORDER BY x->>'code') FROM (
    SELECT json_build_object('source_id',c.id,'code',c.code,'name_ar',c.name_ar,'name_en',c.name_en,'category_type',c.type,'parent_code',p.code,'status',CASE WHEN c.is_active THEN 'active' ELSE 'inactive' END) x
    FROM categories c LEFT JOIN categories p ON p.id=c.parent_id WHERE c.company_id=${sqlText(sourceCompanyId)}
  ) s), '[]'::json),
  'suppliers', COALESCE((SELECT json_agg(x ORDER BY x->>'source_id') FROM (
    SELECT json_build_object('source_id',s.id,'name_ar',s.name_ar,'name_en',s.name_en,'status',CASE WHEN s.is_deleted THEN 'archived' ELSE 'active' END) x
    FROM suppliers s
    WHERE s.company_id=${sqlText(sourceCompanyId)}
      AND EXISTS (SELECT 1 FROM invoices i WHERE i.company_id=s.company_id AND i.supplier_id=s.id AND i.kind IN ('purchase','expense','fixed_expense')${filter})
  ) s), '[]'::json),
  'vaults', COALESCE((SELECT json_agg(x ORDER BY x->>'source_id') FROM (
    SELECT json_build_object('source_id',v.id,'name_ar',v.name_ar,'name_en',v.name_en,'status',CASE WHEN v.is_active AND NOT v.is_archived THEN 'active' ELSE 'archived' END) x
    FROM vaults v
    WHERE v.company_id=${sqlText(sourceCompanyId)}
      AND (
        EXISTS (SELECT 1 FROM invoices i WHERE i.company_id=v.company_id AND i.vault_id=v.id AND i.kind IN ('purchase','expense','fixed_expense')${filter})
        OR EXISTS (SELECT 1 FROM invoice_vault_allocations ia JOIN invoices i ON i.id=ia.invoice_id WHERE i.company_id=v.company_id AND ia.vault_id=v.id AND i.kind IN ('purchase','expense','fixed_expense')${filter})
        OR EXISTS (SELECT 1 FROM ledger_entries l JOIN daily_sales_summaries d ON d.id=l.reference_id WHERE l.company_id=v.company_id AND l.reference_type='sale' AND l.vault_id=v.id${salesFilter})
      )
  ) s), '[]'::json),
  'employees', COALESCE((SELECT json_agg(x ORDER BY x->>'employee_serial') FROM (
    SELECT json_build_object('source_id',e.id,'employee_serial',e.employee_serial,'name_ar',e.name,'name_en',e.name_en,'iqama_number',e.iqama_number,'job_title',e.job_title,'join_date',to_char(e.join_date::date,'YYYY-MM-DD'),'status',e.status,'notes',e.notes) x
    FROM employees e WHERE e.company_id=${sqlText(sourceCompanyId)}
  ) s), '[]'::json),
  'invoices', COALESCE((SELECT json_agg(x ORDER BY x->>'source_id') FROM (
    SELECT json_build_object(
      'source_id',i.id,'kind',CASE WHEN i.kind='purchase' THEN 'purchase' ELSE 'expense' END,'status',i.status,
      'document_number',i.invoice_number,'supplier_source_id',i.supplier_id,
      'category_code',COALESCE(c.code,da.code),'vault_source_id',i.vault_id,
      'transaction_date',to_char(i.transaction_date::date,'YYYY-MM-DD'),'invoice_date',to_char(i.invoice_date::date,'YYYY-MM-DD'),
      'net_amount',i.net_amount::text,'tax_amount',i.tax_amount::text,'gross_amount',i.total_amount::text,
      'payment_method_source_id',i.payment_method_id,'source_reference',i.kind,'notes',i.notes
    ) x
    FROM invoices i
    LEFT JOIN categories c ON c.id=i.category_id
    LEFT JOIN LATERAL (SELECT a.code FROM ledger_entries l JOIN accounts a ON a.id=l.debit_account_id WHERE l.company_id=i.company_id AND l.reference_id=i.id AND l.reference_type='invoice' AND l.status='active' ORDER BY l.id LIMIT 1) da ON true
    WHERE i.company_id=${sqlText(sourceCompanyId)} AND i.kind IN ('purchase','expense','fixed_expense')${filter}
  ) s), '[]'::json),
  'invoice_allocations', COALESCE((SELECT json_agg(x ORDER BY x->>'source_id') FROM (
    SELECT json_build_object('source_id',a.id,'invoice_source_id',a.invoice_id,'vault_source_id',a.vault_id,'payment_method_source_id','','amount',a.amount::text) x
    FROM invoice_vault_allocations a JOIN invoices i ON i.id=a.invoice_id
    WHERE i.company_id=${sqlText(sourceCompanyId)} AND i.kind IN ('purchase','expense','fixed_expense')${filter}
  ) s), '[]'::json),
  'ledger_entries', COALESCE((SELECT json_agg(x ORDER BY x->>'source_id') FROM (
    SELECT json_build_object('source_id',l.id,'reference_entity','Invoice','reference_source_id',l.reference_id,'debit_account_source_id',l.debit_account_id,'credit_account_source_id',l.credit_account_id,'vault_source_id',l.vault_id,'entry_date',to_char(l.transaction_date::date,'YYYY-MM-DD'),'amount',l.amount::text,'status',l.status,'notes','Noorix source ledger') x
    FROM ledger_entries l JOIN invoices i ON i.id=l.reference_id
    WHERE i.company_id=${sqlText(sourceCompanyId)} AND l.reference_type='invoice' AND i.kind IN ('purchase','expense','fixed_expense')${filter}
  ) s), '[]'::json),
  'sales', COALESCE((SELECT json_agg(x ORDER BY x->>'source_id') FROM (
    SELECT json_build_object('source_id',d.id,'summary_number',d.summary_number,'transaction_date',to_char(d.transaction_date::date,'YYYY-MM-DD'),'shift','all','customer_count',d.customer_count,'cash_on_hand',d.cash_on_hand::text,'total_amount',d.total_amount::text,'status',d.status,'notes',d.notes,'allocations',COALESCE((SELECT json_agg(json_build_object('source_id',l.id,'vault_source_id',l.vault_id,'amount',l.amount::text) ORDER BY l.id) FROM ledger_entries l WHERE l.company_id=d.company_id AND l.reference_id=d.id AND l.reference_type='sale' AND l.status='active'),'[]'::json)) x
    FROM daily_sales_summaries d WHERE d.company_id=${sqlText(sourceCompanyId)}${salesFilter}
  ) s), '[]'::json),
  'exceptions', COALESCE((SELECT json_agg(x ORDER BY x->>'source_id') FROM (
    SELECT json_build_object('source_id',i.id,'kind',i.kind,'number',i.invoice_number,'date',to_char(i.transaction_date::date,'YYYY-MM-DD'),'reason',CASE WHEN i.kind='salary' THEN 'PAYROLL_LIFECYCLE_REQUIRED' WHEN i.kind='advance' THEN 'EMPLOYEE_ADVANCE_LIFECYCLE_REQUIRED' ELSE 'EMPLOYEE_SERVICE_EVIDENCE_REQUIRED' END) x
    FROM invoices i WHERE i.company_id=${sqlText(sourceCompanyId)} AND i.kind IN ('salary','advance','hr_expense')${filter}
  ) s), '[]'::json)
)::text;
`)[0] ?? {};
const mappedInvoiceIds = new Set(mappedIds('Invoice'));
const mappedClosingIds = new Set(mappedIds('DailySalesClosing'));
// Cancelled invoices are retained as non-financial evidence, never posted as
// expenses or purchases.  Noorix has historical cancelled records without a
// category or direct vault; treating them as live financial documents would
// either invent classification or incorrectly affect reports.
const cancelledCoreInvoices = (payload.invoices ?? []).filter((row) => row.status !== 'active' && !mappedInvoiceIds.has(row.source_id));
const activeInvoices = (payload.invoices ?? []).filter((row) => row.status === 'active' && !mappedInvoiceIds.has(row.source_id));
const activeInvoiceIds = new Set(activeInvoices.map((row) => row.source_id));
const sourceCategories = payload.categories ?? [];
const sourceCategoryByCode = new Map(sourceCategories.map((row) => [row.code, row]));
const legacyRootCodes = new Set();
const fallbackVaultByInvoice = new Map(
  (payload.invoice_allocations ?? [])
    .filter((row) => activeInvoiceIds.has(row.invoice_source_id) && row.vault_source_id)
    .map((row) => [row.invoice_source_id, row.vault_source_id]),
);
// Noorix permits an invoice whose header has no vault when the payment is
// split across allocations.  Baseer needs a primary vault reference for the
// document envelope; the writer still posts every allocation exactly as given.
const invoices = activeInvoices.map((row) => ({
  ...(() => {
    const sourceCategoryCode = row.category_code;
    const baseerCategoryCode = resolveBaseerCategoryCode(sourceCategoryCode);
    const targetCategory = targetCategoryByCode.get(baseerCategoryCode);
    const needsPostingChild = /^(?:PUR|EXP)-\d{3}$/i.test(baseerCategoryCode)
      && targetCategory?.is_posting === false;
    if (needsPostingChild) legacyRootCodes.add(baseerCategoryCode);
    const originalNotes = row.notes ? String(row.notes).trim() : '';
    const mappingNote = sourceCategoryCode !== baseerCategoryCode
      ? `تصنيف نوركس: ${sourceCategoryCode} → تصنيف بصير المعتمد: ${baseerCategoryCode}`
      : '';
    return {
      ...row,
      noorix_category_code: sourceCategoryCode,
      category_code: needsPostingChild ? `${baseerCategoryCode}-LEGACY` : baseerCategoryCode,
      notes: [originalNotes, mappingNote, needsPostingChild ? `تصنيف نوركس غير مفصل: ${sourceCategoryCode}` : ''].filter(Boolean).join(' | ') || row.notes,
    };
  })(),
  vault_source_id: row.vault_source_id || fallbackVaultByInvoice.get(row.source_id) || '',
}));
const postingCategoryCode = (sourceCategoryCode) => {
  const baseerCategoryCode = resolveBaseerCategoryCode(sourceCategoryCode);
  const targetCategory = targetCategoryByCode.get(baseerCategoryCode);
  return /^(?:PUR|EXP)-\d{3}$/i.test(baseerCategoryCode) && targetCategory?.is_posting === false
    ? `${baseerCategoryCode}-LEGACY`
    : baseerCategoryCode;
};
const invoiceIds = new Set(invoices.map((row) => row.source_id));
const requiredCategoryCodes = new Set(invoices.map((row) => row.category_code).filter(Boolean));
const requiredExistingCategories = [...requiredCategoryCodes]
  .map((code) => targetCategoryByCode.get(code))
  .filter(Boolean)
  .map((category) => ({
    source_id: `BASEER:${category.code}`,
    code: category.code,
    name_ar: category.name_ar,
    name_en: category.name_ar,
    category_type: String(category.kind).toLowerCase(),
    parent_code: category.parent_code || '',
    status: 'active',
  }));
const sales = (payload.sales ?? []).filter((row) => !mappedClosingIds.has(row.source_id));
const supplierIds = new Set(invoices.map((row) => row.supplier_source_id).filter(Boolean));
const vaultIds = new Set([
  ...invoices.map((row) => row.vault_source_id),
  ...(payload.invoice_allocations ?? []).filter((row) => invoiceIds.has(row.invoice_source_id)).map((row) => row.vault_source_id),
  ...sales.flatMap((row) => (row.allocations ?? []).map((allocation) => allocation.vault_source_id)),
].filter(Boolean));
const ledgerEntries = (payload.ledger_entries ?? []).filter((row) => invoiceIds.has(row.reference_source_id));
const accountIds = new Set(ledgerEntries.flatMap((row) => [row.debit_account_source_id, row.credit_account_source_id]).filter(Boolean));
payload = {
  ...payload,
  // Finance categories are Baseer master data, not a second Noorix chart.
  // The CategoryAudit sheet records the source→Baseer decision; only a
  // generated posting child (needed below a non-posting Baseer root) enters
  // the master-data sheet.
  categories: [...new Map([
    ...requiredExistingCategories,
    ...[...legacyRootCodes].map((rootCode) => {
      const parent = sourceCategoryByCode.get(rootCode);
      const nameAr = parent?.name_ar || rootCode;
      const nameEn = parent?.name_en || rootCode;
      return {
        source_id: `DERIVED:${rootCode}:LEGACY`,
        code: `${rootCode}-LEGACY`,
        name_ar: `${nameAr} — غير مفصل في نوركس`,
        name_en: `${nameEn} — Noorix legacy detail`,
        category_type: parent?.category_type || 'expense',
        parent_code: rootCode,
        status: 'active',
      };
    }),
  ].map((category) => [category.code, category])).values()],
  accounts: (payload.accounts ?? []).filter((row) => accountIds.has(row.source_id)),
  suppliers: (payload.suppliers ?? []).filter((row) => supplierIds.has(row.source_id)),
  vaults: (payload.vaults ?? []).filter((row) => vaultIds.has(row.source_id)),
  invoices,
  invoice_allocations: (payload.invoice_allocations ?? []).filter((row) => invoiceIds.has(row.invoice_source_id)),
  ledger_entries: ledgerEntries,
  sales,
  exceptions: [
    ...(payload.exceptions ?? []),
    ...cancelledCoreInvoices.map((row) => ({
      source_id: row.source_id,
      kind: 'cancelled_invoice',
      number: row.document_number,
      date: row.transaction_date,
      reason: 'CANCELLED_SOURCE_EVIDENCE',
    })),
  ],
};

const headers = {
  Suppliers: ['source_id','name_ar','name_en','supplier_category_source_id','status','notes'],
  Accounts: ['source_id','code','name_ar','name_en','account_type','status'],
  Categories: ['baseer_category_code','name_ar','name_en','category_type','parent_baseer_category_code','status','classification_source','confidence'],
  Vaults: ['source_id','name_ar','name_en','status'],
  Employees: ['source_id','employee_serial','name_ar','name_en','iqama_number','job_title','join_date','status','notes'],
  Invoices: ['source_id','source_company_id','kind','status','document_number','supplier_source_id','baseer_category_code','vault_source_id','transaction_date','invoice_date','net_amount','tax_amount','gross_amount','payment_method_source_id','source_reference','notes'],
  InvoiceAllocations: ['source_id','invoice_source_id','vault_source_id','payment_method_source_id','amount'],
  LedgerEntries: ['source_id','source_company_id','reference_entity','reference_source_id','debit_account_source_id','credit_account_source_id','vault_source_id','entry_date','amount','status','notes'],
  RecurringExpenseProfiles: ['source_id','name_ar','name_en','supplier_source_id','baseer_category_code','expected_amount','interval_months','status','service_number','notes'],
  RecurringExpensePayments: ['source_id','profile_source_id','supplier_source_id','baseer_category_code','vault_source_id','document_number','transaction_date','net_amount','tax_amount','gross_amount','status','notes'],
  EmployeeServices: ['source_id','employee_source_id','service_type','reference_number','issue_date','expiry_date','supplier_source_id','baseer_category_code','cost_invoice_source_id','status','notes'],
  EmployeeDeductions: ['source_id','employee_source_id','deduction_type','amount','transaction_date','source_reference','notes'],
  EmployeeMovements: ['source_id','employee_source_id','movement_type','amount','previous_value','new_value','effective_date','notes'],
  DailySalesClosings: ['source_id','summary_number','transaction_date','shift','customer_count','cash_on_hand','total_amount','status','notes'],
  DailySalesAllocations: ['source_id','closing_source_id','vault_source_id','amount'],
  BankStatements: ['source_id','file_name','bank_name','start_date','end_date','status','total_deposits','total_withdrawals','transaction_count'],
  BankTransactions: ['source_id','statement_source_id','transaction_date','description','debit','credit','balance','reference','notes','classification_name','transaction_type','manually_classified'],
  VatPlanning: ['source_id','year','quarter','payment_target','filing_submitted','imported_at','notes'],
  Assets: ['source_id','name_ar','name_en','serial_number','location','purchase_date','acquisition_cost','supplier_source_id','invoice_source_id','baseer_category_code','warranty_description','warranty_start_date','warranty_end_date','notes'],
  CategoryAudit: ['source_category_id','source_category_name_ar','baseer_category_code','baseer_category_name_ar','confidence','reason_ar','invoice_count'],
  Exceptions: ['source_sheet','source_id','severity','code','message','resolution'],
};
const text = (value) => value == null ? '' : String(value);
const rows = {
  Suppliers: payload.suppliers.map((x) => [x.source_id,text(x.name_ar),text(x.name_en),'',x.status,'Noorix source supplier']),
  Accounts: payload.accounts.map((x) => [x.source_id,x.code,text(x.name_ar),text(x.name_en),String(x.account_type).toLowerCase(),x.status]),
  Categories: payload.categories.map((x) => [x.code,text(x.name_ar),text(x.name_en),String(x.category_type).toLowerCase(),text(x.parent_code),x.status,'LOCAL_CATEGORY_INTELLIGENCE','HIGH']),
  Vaults: payload.vaults.map((x) => [x.source_id,text(x.name_ar),text(x.name_en),x.status]),
  Employees: payload.employees.map((x) => [x.source_id,text(x.employee_serial),text(x.name_ar),text(x.name_en),text(x.iqama_number),text(x.job_title),text(x.join_date),x.status,text(x.notes)]),
  Invoices: payload.invoices.map((x) => [x.source_id,sourceCompanyId,x.kind,x.status,text(x.document_number),text(x.supplier_source_id),text(x.category_code),text(x.vault_source_id),x.transaction_date,x.invoice_date,x.net_amount,x.tax_amount,x.gross_amount,text(x.payment_method_source_id),text(x.source_reference),text(x.notes)]),
  InvoiceAllocations: payload.invoice_allocations.map((x) => [x.source_id,x.invoice_source_id,x.vault_source_id,text(x.payment_method_source_id),x.amount]),
  LedgerEntries: payload.ledger_entries.map((x) => [x.source_id,sourceCompanyId,x.reference_entity,x.reference_source_id,x.debit_account_source_id,x.credit_account_source_id,x.vault_source_id,x.entry_date,x.amount,x.status,text(x.notes)]),
  DailySalesClosings: [], DailySalesAllocations: [],
  CategoryAudit: sourceCategories.filter((x) => payload.invoices.some((invoice) => invoice.noorix_category_code === x.code)).map((x) => {
    const baseerCode = resolveBaseerCategoryCode(x.code);
    const postingCode = postingCategoryCode(x.code);
    const mapped = targetCategoryByCode.get(baseerCode);
    const semantic = x.code !== baseerCode;
    return [x.source_id,text(x.name_ar),postingCode,text(mapped?.name_ar || x.name_ar),'HIGH',semantic ? `مطابقة دلالية معتمدة: ${x.code} إلى ${baseerCode}.` : 'مطابقة مباشرة مع فئة بصير المعتمدة.',String(payload.invoices.filter((invoice) => invoice.noorix_category_code === x.code).length)];
  }),
  Exceptions: payload.exceptions.map((x) => ['Invoices',x.source_id,'INFO',x.reason,`تم حفظ مصدر ${x.kind} ${text(x.number)} لمسار الترحيل المتخصص.`,x.reason]),
};

for (const sale of payload.sales) {
  const allocations = sale.allocations ?? [];
  // A same-day Noorix closing is not discarded merely because its amount and
  // vault split resemble another closing.  Customer counts or source context
  // can differ.  The daily-sales writer consolidates those source closings
  // into one Baseer business-day close while retaining lineage for each row.
  rows.DailySalesClosings.push([sale.source_id,sale.summary_number,sale.transaction_date,String(sale.shift || 'all').toLowerCase(),String(sale.customer_count ?? 0),text(sale.cash_on_hand),sale.total_amount,sale.status,text(sale.notes)]);
  for (const allocation of allocations) rows.DailySalesAllocations.push([allocation.source_id,sale.source_id,allocation.vault_source_id,allocation.amount]);
}

for (const name of Object.keys(headers)) rows[name] ??= [];
const money = (items, index) => items.reduce((sum, row) => sum + Number(row[index] || 0), 0).toFixed(4);
const sourceFingerprint = sha({ sourceCompanyId, targetCompanyId, targetTenantId, createdSince, packageRevision, rows });
const manifestRows = [
  ['Baseer ERP — Noorix Excel Import Package'], ['No formulas, macros, or external links.'], ['Field','Value','Rule'],
  ['template_version','nurix-excel-package/v3','Required'], ['source_system','NOORIX','Required'], ['source_company_id',sourceCompanyId,'Required'], ['source_company_name',sourceCompanyName,'Required'], ['exported_at',new Date().toISOString(),'Required'], ['package_sha256',sha({ sourceFingerprint, generatedBy: 'export-noorix-verified-core-package/v1' }),'Control'], ['source_fingerprint',sourceFingerprint,'Required'],
  ['financial_invoices_count',String(rows.Invoices.length),'Control count'], ['recurring_payments_count','0','Control count'], ['daily_sales_count',String(rows.DailySalesClosings.length),'Control count'], ['employee_services_count','0','Control count'], ['assets_count','0','Control count'],
  ['financial_invoices_gross_amount',money(rows.Invoices,12),'Control total'], ['financial_invoice_allocations_amount',money(rows.InvoiceAllocations,4),'Control total'], ['financial_ledger_amount',money(rows.LedgerEntries,8),'Control total'], ['recurring_payments_gross_amount','0.0000','Control total'], ['daily_sales_total_amount',money(rows.DailySalesClosings,6),'Control total'], ['daily_sales_allocations_amount',money(rows.DailySalesAllocations,3),'Control total'], ['employee_deductions_amount','0.0000','Control total'], ['bank_transactions_debit_amount','0.0000','Control total'], ['bank_transactions_credit_amount','0.0000','Control total'], ['assets_acquisition_cost_amount','0.0000','Control total'],
];
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(manifestRows), 'Manifest');
for (const [name, columns] of Object.entries(headers)) XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([columns, ...rows[name]]), name);
await mkdir(dirname(resolve(outputPath)), { recursive: true });
const bytes = XLSX.write(book, { type: 'buffer', bookType: 'xlsx', compression: true });
await writeFile(resolve(outputPath), bytes);
console.log(JSON.stringify({ outputPath: resolve(outputPath), bytes: bytes.length, sourceFingerprint, targetCompanyId, createdSince: createdSince || null, packageRevision: packageRevision || null, previouslyMapped: { invoices: mappedIds('Invoice').length, sales: mappedIds('DailySalesClosing').length }, invoices: rows.Invoices.length, sales: rows.DailySalesClosings.length, exceptions: rows.Exceptions.length, grossInvoices: money(rows.Invoices, 12), totalSales: money(rows.DailySalesClosings, 6) }, null, 2));
