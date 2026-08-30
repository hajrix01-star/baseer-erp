import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { Client } from 'pg';
import { NestFactory } from '@nestjs/core';

const APPROVAL = 'APPLY_APPROVED_NOORIX_ARZ_HISTORICAL_PAYROLL_ACCOUNTING_EVIDENCE_V2';
const SOURCE_COMPANY_ID = 'cmnf604ka009ay8lm556wgd9c';
const EXPECTED_RUNS = [
  ['cmnqg4yl7000433yfxwdo7fkk', 'PR-2604-001', '2026-03-01'],
  ['cmordbohm004611chxzl9vsmn', 'PR-2605-001', '2026-04-01'],
  ['cmq3qbbzy0001qfta2jg6kisv', 'PR-2606-001', '2026-05-01'],
  ['cmr9593oe00f03p7xcqi39ksm', 'PR-2607-001', '2026-06-01'],
  ['cmshh32o30004vpuedsszhlii', 'PR-2608-001', '2026-07-01'],
];

const [packageId, tenantId, companyId, actorUserId, sourceDatabaseUrl, mode] = process.argv.slice(2);
if (!packageId || !tenantId || !companyId || !actorUserId || !sourceDatabaseUrl || !['DRY_RUN', APPROVAL].includes(mode) || ![packageId, tenantId, companyId, actorUserId].every((value) => /^[0-9a-f-]{36}$/i.test(value))) {
  throw new Error(`Usage: node scripts/run-local-nurix-historical-payroll-import.mjs <package-uuid> <tenant-uuid> <ARZ-company-uuid> <owner-user-uuid> <noorix-readonly-db-url> DRY_RUN|${APPROVAL}`);
}
const sourceUrl = new URL(sourceDatabaseUrl);
if (sourceUrl.hostname !== '127.0.0.1' || sourceUrl.port !== '5433' || sourceUrl.pathname !== '/noorix_inspect') throw new Error('Refusing a Noorix source other than the local read-only noorix_inspect snapshot.');

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') throw new Error('Refusing historical payroll import outside the canonical local Baseer test database.');

const source = new Client({ connectionString: sourceDatabaseUrl, options: '-c default_transaction_read_only=on' });
await source.connect();
try {
  const ids = EXPECTED_RUNS.map(([id]) => id);
  const runs = await source.query(`
    SELECT r.id, r.run_number, r.payroll_month::date::text AS payroll_month,
      to_char(r.payroll_accrued_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+03:00' AS payroll_accrued_at,
      r.status, r.total_amount::text AS total_amount, r.employee_count
    FROM payroll_runs r
    WHERE r.company_id = $1 AND r.id = ANY($2::text[])
    ORDER BY r.payroll_month ASC`, [SOURCE_COMPANY_ID, ids]);
  if (runs.rows.length !== EXPECTED_RUNS.length || runs.rows.some((row, index) => row.id !== EXPECTED_RUNS[index][0] || row.run_number !== EXPECTED_RUNS[index][1] || row.payroll_month !== EXPECTED_RUNS[index][2])) throw new Error('The frozen five-run Noorix ARZ source set differs from the reviewed March–July snapshot.');
  const items = await source.query(`
    SELECT id, payroll_run_id, employee_id, gross_salary::text AS gross_salary, allowances_add::text AS allowances_add, deductions::text AS deductions, advances_deduct::text AS advances_deduct, net_salary::text AS net_salary
    FROM payroll_run_items WHERE payroll_run_id = ANY($1::text[]) ORDER BY payroll_run_id, id`, [ids]);
  // Noorix proves each run through one salary invoice SAL-<run_number>, then
  // active salary ledger entries referencing that invoice. Do not infer proof
  // from an invoice vault: July deliberately has a NULL invoice.vault_id but
  // two source ledger entries (cash + bank).
  const invoices = await source.query(`
    SELECT r.id AS payroll_run_id, i.id, i.company_id, i.invoice_number, i.kind,
      i.status, i.total_amount::text AS total_amount,
      to_char(i.transaction_date::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+03:00' AS transaction_at
    FROM payroll_runs r
    LEFT JOIN invoices i
      ON i.company_id = r.company_id
      AND i.invoice_number = 'SAL-' || r.run_number
    WHERE r.company_id = $1 AND r.id = ANY($2::text[])
    ORDER BY r.payroll_month ASC, i.id ASC`, [SOURCE_COMPANY_ID, ids]);
  const invoiceIds = invoices.rows.map((invoice) => invoice.id).filter(Boolean);
  const ledgerEntries = invoiceIds.length ? await source.query(`
    SELECT l.id, l.company_id, l.reference_id, l.reference_type, l.status,
      l.vault_id, l.amount::text AS amount,
      to_char(l.transaction_date::timestamp, 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+03:00' AS transaction_at,
      to_char(l.entry_date, 'YYYY-MM-DD"T"HH24:MI:SS.US') || '+03:00' AS posted_at
    FROM ledger_entries l
    WHERE l.reference_id = ANY($1::text[])
    ORDER BY l.reference_id ASC, l.id ASC`, [invoiceIds]) : { rows: [] };
  const itemsByRun = new Map();
  for (const item of items.rows) { const current = itemsByRun.get(item.payroll_run_id) ?? []; current.push(item); itemsByRun.set(item.payroll_run_id, current); }
  const invoicesByRun = new Map();
  for (const invoice of invoices.rows) { const current = invoicesByRun.get(invoice.payroll_run_id) ?? []; current.push(invoice); invoicesByRun.set(invoice.payroll_run_id, current); }
  const ledgersByInvoice = new Map();
  for (const ledger of ledgerEntries.rows) { const current = ledgersByInvoice.get(ledger.reference_id) ?? []; current.push(ledger); ledgersByInvoice.set(ledger.reference_id, current); }
  const moneyUnits = (value) => {
    const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,4}))?$/.exec(String(value));
    if (!match) throw new Error(`Malformed Noorix money evidence: ${value}`);
    return BigInt(match[1]) * 10000n + BigInt((match[2] ?? '').padEnd(4, '0'));
  };
  const exact = (actual, expected) => moneyUnits(actual) === moneyUnits(expected);
  const sourceRuns = runs.rows.map((run) => {
    const candidates = invoicesByRun.get(run.id) ?? [];
    if (candidates.length !== 1) throw new Error(`Noorix ${run.run_number} must have exactly one salary invoice candidate SAL-${run.run_number}.`);
    const invoice = candidates[0];
    if (invoice.company_id !== SOURCE_COMPANY_ID || invoice.invoice_number !== `SAL-${run.run_number}` || invoice.kind !== 'salary' || invoice.status !== 'active' || !invoice.transaction_at || !exact(invoice.total_amount, run.total_amount)) throw new Error(`Noorix ${run.run_number} salary invoice evidence is not an active, same-company SAL invoice matching the payroll total.`);
    const ledgers = ledgersByInvoice.get(invoice.id) ?? [];
    if (!ledgers.length || ledgers.some((ledger) => ledger.company_id !== SOURCE_COMPANY_ID || ledger.reference_id !== invoice.id || ledger.reference_type !== 'salary' || ledger.status !== 'active' || !ledger.vault_id || !ledger.transaction_at || !ledger.posted_at) || ledgers.reduce((total, ledger) => total + moneyUnits(ledger.amount), 0n) !== moneyUnits(invoice.total_amount)) throw new Error(`Noorix ${run.run_number} active salary ledger proof does not reconcile to its invoice or lacks a vault/date.`);
    return {
      sourceId: run.id, runNumber: run.run_number, payrollMonth: run.payroll_month, payrollAccruedAt: run.payroll_accrued_at, status: run.status, totalAmount: run.total_amount, employeeCount: Number(run.employee_count),
      paymentEvidenceKind: 'AMOUNT_ONLY', paymentEvidenceAmount: invoice.total_amount, paymentEvidenceAt: null,
      sourceInvoiceEvidence: 'PRESENT', sourceJournalEvidence: 'PRESENT',
      accountingDocuments: [
        { evidenceKind: 'PAYROLL_INVOICE', sourceId: invoice.id, sourceNumber: invoice.invoice_number, sourceDate: invoice.transaction_at, amount: invoice.total_amount },
        // sourceNumber holds the immutable ledger id plus its posting stamp;
        // sourceDate remains the Noorix transaction date used by the journal.
        ...ledgers.map((ledger) => ({ evidenceKind: 'JOURNAL_ENTRY', sourceId: ledger.id, sourceNumber: `${ledger.id} | posted:${ledger.posted_at}`, sourceDate: ledger.transaction_at, amount: ledger.amount })),
      ],
      vaultAllocations: ledgers.map((ledger) => ({ sourceId: ledger.id, vaultSourceId: ledger.vault_id, amount: ledger.amount })),
      items: (itemsByRun.get(run.id) ?? []).map((item) => ({ sourceId: item.id, employeeSourceId: item.employee_id, grossSalary: item.gross_salary, allowancesAdd: item.allowances_add, deductions: item.deductions, advancesDeduct: item.advances_deduct, netSalary: item.net_salary })),
    };
  });
  const payload = {
    packageId, sourceCompanyId: SOURCE_COMPANY_ID,
    runs: sourceRuns,
  };
  process.chdir(resolve('apps/api'));
  const { AppModule } = await import('../apps/api/dist/app.module.js');
  const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
  const { NurixHistoricalPayrollMigrationService } = await import('../apps/api/dist/nurix-migration/nurix-historical-payroll-migration.service.js');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const writer = new NurixHistoricalPayrollMigrationService(app.get(DatabaseService));
    // This read-only stage is mandatory in both modes. It validates the frozen
    // source, package/company ownership, all 73 employee lineage maps, dates,
    // totals, and source payment evidence before any target write is possible.
    const dryRun = await writer.dryRun({ tenantId, companyId, actorUserId }, payload);
    console.log(JSON.stringify({ status: 'PARSED_DRY_RUN', ...dryRun }, null, 2));
    if (mode === 'DRY_RUN') process.exitCode = 0;
    // V2 is deliberately an enrichment action. It locates the five completed
    // V1 evidence headers and appends only immutable accounting proof; it
    // never routes through the V1 header/line writer.
    else console.log(JSON.stringify(await writer.enrichAccountingEvidence({ tenantId, companyId, actorUserId }, payload), null, 2));
  } finally { await app.close(); }
} finally { await source.end(); }
