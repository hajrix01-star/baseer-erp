/**
 * Controlled historical paid-payroll writer for Noorix → Baseer (Al Shami).
 *
 * This writer deliberately mirrors only the verified Noorix salary-payment
 * journals: debit EXP-004 / credit the source vault, on the source date and
 * for the source amount.  It does not manufacture an accrual, an advance
 * settlement journal, or a correction for source-only payroll inconsistencies.
 *
 * Usage:
 *   node scripts/run-local-nurix-al-shami-paid-payroll-backfill.mjs \
 *     <package-id> <tenant-id> <company-id> <owner-user-id> DRY_RUN
 *
 *   node scripts/run-local-nurix-al-shami-paid-payroll-backfill.mjs \
 *     <package-id> <tenant-id> <company-id> <owner-user-id> \
 *     APPLY_APPROVED_NOORIX_AL_SHAMI_PAID_PAYROLL_V1
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const SNAPSHOT_CONTAINER = 'baseer-noorix-snapshot-20260902';
const SNAPSHOT_DATABASE = 'nurix_snapshot';
const APPLY_TOKEN = 'APPLY_APPROVED_NOORIX_AL_SHAMI_PAID_PAYROLL_V1';
const TRANSFORM_VERSION = 'nurix-al-shami-paid-payroll/v1';
const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
const uuid = /^[0-9a-f-]{36}$/i;
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPLY_TOKEN].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-al-shami-paid-payroll-backfill.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPLY_TOKEN}`);
}

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixed = (value) => Number(value).toFixed(4);
const money = (value, name) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid source money ${name}.`);
  return fixed(parsed);
};
const sourceDate = (value, name) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new Error(`Invalid source date ${name}.`);
  return new Date(`${value}T00:00:00.000Z`);
};
const firstOfMonth = (value) => `${value.slice(0, 7)}-01`;
const sourceNote = (value) => (typeof value === 'string' ? value : '');

const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('This writer only permits the canonical local Baseer test database.');
}

// Read the frozen source snapshot. The JSON contains the minimal lineage and
// financial evidence needed by this writer; raw notes are carried separately
// to NoorixSourceAnnotation and never used as journal instructions.
const sourceSql = `
SELECT COALESCE(json_agg(row ORDER BY row->>'payrollMonth', row->>'runNumber'), '[]'::json)::text
FROM (
  SELECT json_build_object(
    'sourceId', r.id,
    'runNumber', r.run_number,
    'payrollMonth', to_char(r.payroll_month::date, 'YYYY-MM-DD'),
    'businessDate', to_char(i.transaction_date::date, 'YYYY-MM-DD'),
    'employeeCount', r.employee_count,
    'totalAmount', r.total_amount::text,
    'notes', COALESCE(r.notes, ''),
    'invoice', json_build_object(
      'sourceId', i.id,
      'number', i.invoice_number,
      'amount', i.total_amount::text,
      'businessDate', to_char(i.transaction_date::date, 'YYYY-MM-DD'),
      'notes', COALESCE(i.notes, '')
    ),
    'items', COALESCE((
      SELECT json_agg(json_build_object(
        'sourceId', ri.id,
        'employeeSourceId', ri.employee_id,
        'grossSalary', ri.gross_salary::text,
        'allowances', ri.allowances_add::text,
        'deductions', ri.deductions::text,
        'advanceDeduction', ri.advances_deduct::text,
        'netAmount', ri.net_salary::text,
        'notes', COALESCE(ri.notes, '')
      ) ORDER BY ri.id)
      FROM payroll_run_items ri WHERE ri.payroll_run_id=r.id
    ), '[]'::json),
    'ledgers', COALESCE((
      SELECT json_agg(json_build_object(
        'sourceId', l.id,
        'amount', l.amount::text,
        'businessDate', to_char(l.transaction_date::date, 'YYYY-MM-DD'),
        'vaultSourceId', l.vault_id,
        'debitAccountCode', debit.code,
        'creditAccountCode', credit.code
      ) ORDER BY l.id)
      FROM ledger_entries l
      JOIN accounts debit ON debit.id=l.debit_account_id
      JOIN accounts credit ON credit.id=l.credit_account_id
      WHERE l.company_id=r.company_id AND l.reference_id=i.id AND l.status='active'
    ), '[]'::json)
  ) AS row
  FROM payroll_runs r
  JOIN invoices i
    ON i.company_id=r.company_id
   AND i.invoice_number='SAL-' || r.run_number
   AND i.status='active'
  WHERE r.company_id='${SOURCE_COMPANY_ID}' AND r.status='completed'
) source;`;
const raw = execFileSync('docker', ['exec', SNAPSHOT_CONTAINER, 'psql', '-U', 'nurix_restore', '-d', SNAPSHOT_DATABASE, '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
if (!raw) throw new Error('No Noorix salary source was returned.');
const sourceRuns = JSON.parse(raw);

// A cancelled salary source is retained as immutable evidence only. It never
// becomes a payroll run, payment, expense, accrual, or advance settlement.
const cancelledSalarySql = `
SELECT COALESCE(json_agg(json_build_object(
  'sourceId', i.id,
  'number', i.invoice_number,
  'amount', i.total_amount::text,
  'businessDate', to_char(i.transaction_date::date, 'YYYY-MM-DD'),
  'status', i.status,
  'notes', COALESCE(i.notes, '')
) ORDER BY i.id), '[]'::json)::text
FROM invoices i
WHERE i.company_id='${SOURCE_COMPANY_ID}' AND i.kind='salary' AND i.status='cancelled';`;
const cancelledRaw = execFileSync('docker', ['exec', SNAPSHOT_CONTAINER, 'psql', '-U', 'nurix_restore', '-d', SNAPSHOT_DATABASE, '-t', '-A', '-c', cancelledSalarySql], { encoding: 'utf8' }).trim();
if (!cancelledRaw) throw new Error('No Noorix cancelled-salary evidence was returned.');
const cancelledSalaryInvoices = JSON.parse(cancelledRaw).map((item) => {
  if (!item?.sourceId || !item?.number || item.status !== 'cancelled' || !/^\d{4}-\d{2}-\d{2}$/.test(item.businessDate ?? '')) throw new Error('Noorix cancelled salary evidence is incomplete.');
  return { sourceId: item.sourceId, number: item.number, amount: money(item.amount, `cancelled salary ${item.sourceId}`), businessDate: item.businessDate, notes: sourceNote(item.notes), checksum: sha(item) };
});
if (cancelledSalaryInvoices.length !== 1 || cancelledSalaryInvoices[0].amount !== '900.0000') throw new Error('The reviewed Al-Shami cancelled-salary evidence changed.');

function normaliseRun(source) {
  if (!source?.sourceId || !source?.runNumber || !source?.invoice?.sourceId || !Array.isArray(source?.items) || !Array.isArray(source?.ledgers)) {
    throw new Error('Noorix payroll source is incomplete.');
  }
  const invoice = {
    sourceId: source.invoice.sourceId,
    number: source.invoice.number,
    amount: money(source.invoice.amount, 'invoice.amount'),
    businessDate: source.invoice.businessDate,
    notes: sourceNote(source.invoice.notes),
  };
  if (!invoice.number || !/^\d{4}-\d{2}-\d{2}$/.test(invoice.businessDate)) throw new Error(`Noorix ${source.runNumber} has an incomplete salary invoice.`);
  const items = source.items.map((item) => {
    if (!item?.sourceId || !item?.employeeSourceId) throw new Error(`Noorix ${source.runNumber} has a line without employee lineage.`);
    return {
      sourceId: item.sourceId,
      employeeSourceId: item.employeeSourceId,
      grossSalary: money(item.grossSalary, `item ${item.sourceId} grossSalary`),
      allowances: money(item.allowances, `item ${item.sourceId} allowances`),
      deductions: money(item.deductions, `item ${item.sourceId} deductions`),
      advanceDeduction: money(item.advanceDeduction, `item ${item.sourceId} advanceDeduction`),
      netAmount: money(item.netAmount, `item ${item.sourceId} netAmount`),
      notes: sourceNote(item.notes),
    };
  });
  const ledgers = source.ledgers.map((ledger) => {
    if (!ledger?.sourceId || !ledger?.vaultSourceId || ledger.debitAccountCode !== 'EXP-004' || !ledger.creditAccountCode || !/^\d{4}-\d{2}-\d{2}$/.test(ledger.businessDate ?? '')) {
      throw new Error(`Noorix ${source.runNumber} has a salary ledger outside the approved EXP-004 → vault contract.`);
    }
    return {
      sourceId: ledger.sourceId,
      amount: money(ledger.amount, `ledger ${ledger.sourceId} amount`),
      businessDate: ledger.businessDate,
      vaultSourceId: ledger.vaultSourceId,
      creditAccountCode: ledger.creditAccountCode,
      invoiceSourceId: invoice.sourceId,
      invoiceNumber: invoice.number,
      invoiceNotes: invoice.notes,
    };
  });
  if (!ledgers.length) throw new Error(`Noorix ${source.runNumber} has no active salary payment ledger.`);
  const totalAmount = money(source.totalAmount, `${source.runNumber} totalAmount`);
  const linesNet = fixed(items.reduce((sum, item) => sum + Number(item.netAmount), 0));
  const ledgerTotal = fixed(ledgers.reduce((sum, ledger) => sum + Number(ledger.amount), 0));
  if (totalAmount !== invoice.amount || totalAmount !== linesNet || totalAmount !== ledgerTotal) {
    throw new Error(`Noorix ${source.runNumber} does not reconcile between header, invoice, lines, and payment ledger.`);
  }
  if (Number(source.employeeCount) !== items.length) throw new Error(`Noorix ${source.runNumber} employee count differs from its lines.`);
  return {
    sourceId: source.sourceId,
    runNumber: source.runNumber,
    payrollMonth: firstOfMonth(source.payrollMonth),
    businessDate: invoice.businessDate,
    employeeCount: items.length,
    totalAmount,
    notes: sourceNote(source.notes),
    invoice,
    items,
    ledgers,
    grossAmount: fixed(items.reduce((sum, item) => sum + Number(item.grossSalary) + Number(item.allowances), 0)),
    advanceSettlementAmount: fixed(items.reduce((sum, item) => sum + Number(item.advanceDeduction), 0)),
    administrativeDeductionAmount: fixed(items.reduce((sum, item) => sum + Number(item.deductions), 0)),
    checksum: sha(source),
  };
}

const runs = sourceRuns.map(normaliseRun);
if (runs.length !== 7 || runs.reduce((sum, run) => sum + run.items.length, 0) !== 67) {
  throw new Error(`Expected 7 Noorix runs / 67 lines; received ${runs.length} / ${runs.reduce((sum, run) => sum + run.items.length, 0)}.`);
}
const paidTotal = fixed(runs.reduce((sum, run) => sum + Number(run.totalAmount), 0));
if (paidTotal !== '137326.9383') throw new Error(`Noorix paid-payroll total changed to ${paidTotal}.`);
const paymentCount = runs.reduce((sum, run) => sum + run.ledgers.length, 0);
if (paymentCount !== 8) throw new Error(`Expected 8 source salary payment ledgers; received ${paymentCount}.`);
// Baseer allows a single active payroll run per company/month, while Noorix has
// two supplemental source components in June and July.  Preserve every source
// component, line, invoice, and payment ledger, but normalize their operational
// projection into one Baseer run for each month.
const targetRuns = [...runs.reduce((groups, component) => {
  const group = groups.get(component.payrollMonth) ?? [];
  group.push(component);
  groups.set(component.payrollMonth, group);
  return groups;
}, new Map()).entries()].map(([payrollMonth, components]) => {
  const primary = components.find((component) => component.runNumber.startsWith('PR-')) ?? components[0];
  const businessDate = primary.businessDate;
  if (components.some((component) => component.businessDate !== businessDate)) throw new Error(`Noorix payroll month ${payrollMonth} has source components with different payment dates.`);
  const items = components.flatMap((component) => component.items.map((item) => ({ ...item, component })));
  const duplicateEmployee = items.find((item, index) => items.findIndex((candidate) => candidate.employeeSourceId === item.employeeSourceId) !== index);
  if (duplicateEmployee) throw new Error(`Noorix payroll month ${payrollMonth} repeats employee ${duplicateEmployee.employeeSourceId} across source components; safe normalization is impossible.`);
  const ledgers = components.flatMap((component) => component.ledgers.map((ledger) => ({ ...ledger, component })));
  return {
    payrollMonth,
    runNumber: primary.runNumber,
    businessDate,
    primary,
    components,
    items,
    ledgers,
    employeeCount: items.length,
    totalAmount: fixed(components.reduce((sum, component) => sum + Number(component.totalAmount), 0)),
    grossAmount: fixed(components.reduce((sum, component) => sum + Number(component.grossAmount), 0)),
    advanceSettlementAmount: fixed(components.reduce((sum, component) => sum + Number(component.advanceSettlementAmount), 0)),
    administrativeDeductionAmount: fixed(components.reduce((sum, component) => sum + Number(component.administrativeDeductionAmount), 0)),
    // Do not concatenate or rewrite business notes.  The primary note is kept
    // on the target header exactly; each component note is preserved verbatim
    // through NoorixSourceAnnotation below.
    notes: primary.notes,
    checksum: sha({ payrollMonth, components: components.map((component) => ({ sourceId: component.sourceId, checksum: component.checksum })) }),
  };
}).sort((left, right) => left.payrollMonth.localeCompare(right.payrollMonth));
if (targetRuns.length !== 5 || targetRuns.reduce((sum, run) => sum + run.items.length, 0) !== 67 || targetRuns.reduce((sum, run) => sum + run.ledgers.length, 0) !== 8) {
  throw new Error('Noorix monthly normalization does not produce the reviewed 5 target runs / 67 lines / 8 payments contract.');
}
const planChecksum = sha({ transformVersion: TRANSFORM_VERSION, sourceCompanyId: SOURCE_COMPANY_ID, sourceComponents: runs.map((run) => ({ sourceId: run.sourceId, checksum: run.checksum })), targetRuns: targetRuns.map((run) => ({ payrollMonth: run.payrollMonth, runNumber: run.runNumber, checksum: run.checksum })), cancelledSalaryInvoices: cancelledSalaryInvoices.map((invoice) => ({ sourceId: invoice.sourceId, checksum: invoice.checksum })) });

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { JournalPostingService } = await import('../apps/api/dist/finance/journal/journal-posting.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

const annotationRows = (targetRun, payrollRunId, paymentsByLedgerId, lineIdBySourceId) => [
  ...targetRun.components.flatMap((component) => [
    { sourceEntity: 'NoorixPayrollRun', sourceId: component.sourceId, sourceChecksum: sha({ id: component.sourceId, notes: component.notes }), targetEntity: 'HrPayrollRun', targetId: payrollRunId, field: 'notes', exactText: component.notes },
    { sourceEntity: 'NoorixPayrollInvoice', sourceId: component.invoice.sourceId, sourceChecksum: sha({ id: component.invoice.sourceId, notes: component.invoice.notes }), targetEntity: 'HrPayrollRun', targetId: payrollRunId, field: 'notes', exactText: component.invoice.notes },
  ]),
  ...targetRun.items.map(({ component, ...item }) => ({ sourceEntity: 'NoorixPayrollRunItem', sourceId: item.sourceId, sourceChecksum: sha({ id: item.sourceId, notes: item.notes }), targetEntity: 'HrPayrollLine', targetId: lineIdBySourceId.get(item.sourceId), field: 'notes', exactText: item.notes })),
  ...targetRun.ledgers.map(({ component, ...ledger }) => ({ sourceEntity: 'NoorixPayrollLedger', sourceId: ledger.sourceId, sourceChecksum: sha({ id: ledger.sourceId, invoiceNotes: ledger.invoiceNotes }), targetEntity: 'HrPayrollPayment', targetId: paymentsByLedgerId.get(ledger.sourceId), field: 'invoice.notes', exactText: ledger.invoiceNotes })),
];

try {
  const database = app.get(DatabaseService);
  const journals = app.get(JournalPostingService);
  const preflight = await database.inTenantTransaction(tenantId, async (tx) => {
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID }, select: { id: true } });
    if (!packageRow) throw new Error('The selected migration package is not scoped to Al Shami / the frozen Noorix company.');
    const sourceEmployeeIds = [...new Set(runs.flatMap((run) => run.items.map((item) => item.employeeSourceId)))];
    const sourceVaultIds = [...new Set(runs.flatMap((run) => run.ledgers.map((ledger) => ledger.vaultSourceId)))];
    const [employees, employeeMaps, vaultMaps, accounts, existingExecution, existingRuns] = await Promise.all([
      tx.hrEmployee.findMany({ where: { tenantId, companyId }, select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } }),
      tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: sourceEmployeeIds }, status: { in: ['CREATED', 'REUSED'] }, execution: { targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', sourceId: { in: sourceVaultIds }, targetEntity: 'FinanceVault', state: { in: ['APPLIED', 'REUSED'] } }, select: { sourceId: true, targetId: true } }),
      tx.financeAccount.findMany({ where: { tenantId, companyId, status: 'ACTIVE', systemKey: 'PAYROLL_EXPENSE' }, select: { id: true, code: true } }),
      tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: TRANSFORM_VERSION } }, select: { id: true, status: true, financialPlanSha256: true } }),
      tx.hrPayrollRun.findMany({ where: { tenantId, companyId, runNumber: { in: targetRuns.map((run) => run.runNumber) } }, include: { lines: true, payments: { include: { allocations: true } } } }),
    ]);
    if (accounts.length !== 1 || accounts[0].code !== 'EXP-004') throw new Error('Baseer requires exactly one active PAYROLL_EXPENSE account with code EXP-004.');
    if (existingExecution && existingExecution.financialPlanSha256 !== planChecksum) throw new Error('The Noorix payroll source changed after its execution plan was prepared; make a new package revision.');
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const employeeBySource = new Map();
    for (const map of employeeMaps) {
      if (!map.targetId) throw new Error(`Noorix employee ${map.sourceId} has ambiguous Baseer lineage.`);
      const employee = employeeById.get(map.targetId);
      if (!employee) throw new Error(`Noorix employee ${map.sourceId} maps outside this company.`);
      const prior = employeeBySource.get(map.sourceId);
      // Reused master-data receipts from later package revisions are valid
      // only when they retain this exact employee target; a different target
      // remains a hard stop.
      if (prior && prior.id !== employee.id) throw new Error(`Noorix employee ${map.sourceId} has ambiguous Baseer lineage.`);
      employeeBySource.set(map.sourceId, employee);
    }
    if (employeeBySource.size !== sourceEmployeeIds.length) throw new Error('One or more Noorix payroll employees have no Baseer lineage.');
    const vaultBySource = new Map();
    for (const map of vaultMaps) {
      if (!map.targetId || (vaultBySource.has(map.sourceId) && vaultBySource.get(map.sourceId) !== map.targetId)) throw new Error(`Noorix vault ${map.sourceId} has ambiguous Baseer lineage.`);
      vaultBySource.set(map.sourceId, map.targetId);
    }
    if (vaultBySource.size !== sourceVaultIds.length) throw new Error('One or more Noorix salary-payment vaults have no Baseer map.');
    const vaults = await tx.financeVault.findMany({ where: { tenantId, companyId, id: { in: [...vaultBySource.values()] }, status: 'ACTIVE', isPaymentDestination: true }, include: { account: { select: { id: true, code: true } } } });
    const vaultById = new Map(vaults.map((vault) => [vault.id, vault]));
    if (vaultById.size !== vaultBySource.size) throw new Error('A mapped Noorix salary-payment vault is not active and payable in Baseer.');
    for (const run of runs) for (const ledger of run.ledgers) {
      const vault = vaultById.get(vaultBySource.get(ledger.vaultSourceId));
      // Source-to-target vault lineage is authoritative.  A target account may
      // retain a namespaced historical code (for example NURIX-V-003) while
      // representing the exact Noorix V-003 vault.  Do not reject that valid
      // mapping merely because the display code differs; the active, payable
      // mapped vault is still mandatory and every journal retains source IDs.
      if (!vault) throw new Error(`Noorix salary ledger ${ledger.sourceId} does not map to an active payable Baseer vault.`);
    }
    const existingByNumber = new Map(existingRuns.map((run) => [run.runNumber, run]));
    for (const run of targetRuns) {
      const existing = existingByNumber.get(run.runNumber);
      if (!existing) continue;
      if (existing.status !== 'PAID' || fixed(existing.grossAmount) !== run.grossAmount || fixed(existing.advanceSettlementAmount) !== run.advanceSettlementAmount || fixed(existing.administrativeDeductionAmount) !== run.administrativeDeductionAmount || fixed(existing.netPayableAmount) !== run.totalAmount || fixed(existing.paidAmount) !== run.totalAmount || existing.lines.length !== run.items.length || existing.payments.length !== run.ledgers.length || existing.accrualJournalEntryId !== null) {
        throw new Error(`Existing Baseer payroll ${run.runNumber} does not match this historical cash-basis source contract.`);
      }
    }
    return { employeeBySource, vaultBySource, vaultById, payrollExpenseAccountId: accounts[0].id, existingExecution, existingByNumber };
  });

  const drySummary = {
    status: mode === 'DRY_RUN' ? 'DRY_RUN_OK' : 'READY_TO_APPLY',
    transformVersion: TRANSFORM_VERSION,
    sourceCompanyId: SOURCE_COMPANY_ID,
    targetRuns: targetRuns.length,
    sourceComponents: runs.length,
    payrollLines: targetRuns.reduce((sum, run) => sum + run.items.length, 0),
    payments: paymentCount,
    paidTotal,
    cancelledSalaryEvidenceOnly: cancelledSalaryInvoices.length,
    sourceLineArithmeticExceptions: runs.flatMap((run) => run.items.filter((item) => fixed(Number(item.grossSalary) + Number(item.allowances) - Number(item.deductions) - Number(item.advanceDeduction) - Number(item.netAmount)) !== '0.0000').map((item) => ({ runNumber: run.runNumber, sourceItemId: item.sourceId }))),
    noAccrualJournalCreated: true,
    noAdvanceSettlementJournalCreated: true,
    noDifferenceCorrectionJournalCreated: true,
  };
  if (mode === 'DRY_RUN') {
    console.log(JSON.stringify(drySummary, null, 2));
    process.exitCode = 0;
  } else {
    const outcome = await database.inTenantTransaction(tenantId, async (tx) => {
      const existingExecution = await tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: TRANSFORM_VERSION } }, select: { id: true, status: true, financialPlanSha256: true } });
      if (existingExecution?.financialPlanSha256 && existingExecution.financialPlanSha256 !== planChecksum) throw new Error('The payroll plan changed after preflight.');
      const execution = existingExecution ?? await tx.nurixExcelFinancialExecution.create({ data: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion: TRANSFORM_VERSION, financialPlanSha256: planChecksum, status: 'APPROVED', reason: 'Owner-approved Al Shami historical paid payroll. Mirrors verified Noorix cash-basis salary journals only; no accrual or source-error correction.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date() }, select: { id: true, status: true } });
      const wave = await tx.nurixExcelFinancialWave.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sequence: 1, status: 'RUNNING', plannedItems: runs.length + cancelledSalaryInvoices.length }, update: { status: 'RUNNING', plannedItems: runs.length + cancelledSalaryInvoices.length, failedItems: 0 }, select: { id: true } });
      const accounts = await tx.financeAccount.findMany({ where: { tenantId, companyId, status: 'ACTIVE', systemKey: 'PAYROLL_EXPENSE' }, select: { id: true, code: true } });
      if (accounts.length !== 1 || accounts[0].code !== 'EXP-004') throw new Error('PAYROLL_EXPENSE account changed after preflight.');
      const employeeSourceIds = [...new Set(runs.flatMap((run) => run.items.map((item) => item.employeeSourceId)))];
      const employeeMaps = await tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: employeeSourceIds }, status: { in: ['CREATED', 'REUSED'] }, execution: { targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } });
      const employees = await tx.hrEmployee.findMany({ where: { tenantId, companyId }, select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } });
      const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
      const employeeBySource = new Map(employeeMaps.map((map) => [map.sourceId, employeeById.get(map.targetId)]));
      if (employeeBySource.size !== employeeSourceIds.length || [...employeeBySource.values()].some((employee) => !employee)) throw new Error('Employee lineage changed after preflight.');
      const vaultSourceIds = [...new Set(runs.flatMap((run) => run.ledgers.map((ledger) => ledger.vaultSourceId)))];
      const vaultMaps = await tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', sourceId: { in: vaultSourceIds }, targetEntity: 'FinanceVault', state: { in: ['APPLIED', 'REUSED'] } }, select: { sourceId: true, targetId: true } });
      const vaultBySource = new Map(vaultMaps.map((map) => [map.sourceId, map.targetId]));
      const vaults = await tx.financeVault.findMany({ where: { tenantId, companyId, id: { in: [...vaultBySource.values()] }, status: 'ACTIVE', isPaymentDestination: true }, include: { account: { select: { code: true } } } });
      const vaultById = new Map(vaults.map((vault) => [vault.id, vault]));
      if (vaultBySource.size !== vaultSourceIds.length || vaultById.size !== vaultBySource.size) throw new Error('Vault lineage changed after preflight.');
      const receipts = [];
      for (const run of targetRuns) {
        const existing = await tx.hrPayrollRun.findFirst({ where: { tenantId, companyId, runNumber: run.runNumber }, include: { lines: true, payments: true } });
        if (existing) {
          if (existing.status !== 'PAID' || fixed(existing.netPayableAmount) !== run.totalAmount || fixed(existing.paidAmount) !== run.totalAmount || existing.lines.length !== run.items.length || existing.payments.length !== run.ledgers.length || existing.accrualJournalEntryId !== null) throw new Error(`Existing payroll ${run.runNumber} cannot be safely replayed.`);
          receipts.push({ run, payrollRunId: existing.id, replayed: true });
          continue;
        }
        const payrollRunId = randomUUID();
        const lineRows = run.items.map((item) => {
          const employee = employeeBySource.get(item.employeeSourceId);
          return { id: randomUUID(), item, employee };
        });
        if (lineRows.some((row) => !row.employee)) throw new Error(`A mapped employee disappeared while writing ${run.runNumber}.`);
        await tx.hrPayrollRun.create({ data: { id: payrollRunId, tenantId, companyId, runNumber: run.runNumber, payrollMonth: sourceDate(run.payrollMonth, 'payrollMonth'), businessDate: sourceDate(run.businessDate, 'businessDate'), status: 'PAID', employeeCount: run.employeeCount, grossAmount: run.grossAmount, advanceSettlementAmount: run.advanceSettlementAmount, administrativeDeductionAmount: run.administrativeDeductionAmount, netPayableAmount: run.totalAmount, paidAmount: run.totalAmount, notes: run.notes || null, accrualJournalEntryId: null, approvedAt: new Date(), createdByUserId: actorUserId } });
        await tx.hrPayrollLine.createMany({ data: lineRows.map(({ id, item, employee }) => ({ id, tenantId, companyId, payrollRunId, employeeId: employee.id, employeeNumberSnapshot: employee.employeeNumber, employeeNameArSnapshot: employee.nameAr, employeeNameEnSnapshot: employee.nameEn, grossSalary: fixed(Number(item.grossSalary) + Number(item.allowances)), basicSalary: item.grossSalary, foodAllowance: '0.0000', housingAllowance: '0.0000', transportAllowance: '0.0000', otherAllowance: item.allowances, overtimeAmount: '0.0000', overtimeHours: '0.0000', advanceSettlementAmount: item.advanceDeduction, administrativeDeductionAmount: item.deductions, netPayableAmount: item.netAmount, paidAmount: item.netAmount, payrollCalculationSnapshotJson: { sourceContract: 'NOORIX_HISTORICAL_PAID_PAYROLL_V1', sourceRunId: item.component.sourceId, sourceRunNumber: item.component.runNumber, sourceGrossSalary: item.grossSalary, sourceAllowancesAdd: item.allowances, sourceDeductions: item.deductions, sourceAdvancesDeduct: item.advanceDeduction, sourceNetSalary: item.netAmount } })) });
        const payments = [];
        for (let index = 0; index < run.ledgers.length; index += 1) {
          const ledger = run.ledgers[index];
          const vault = vaultById.get(vaultBySource.get(ledger.vaultSourceId));
          if (!vault) throw new Error(`Vault lineage changed for Noorix ledger ${ledger.sourceId}.`);
          const paymentNumber = `NXR-${ledger.invoiceNumber}-${String(index + 1).padStart(2, '0')}`.slice(0, 80);
          const journal = await journals.postInTransaction(tx, { tenantId, companyId, actorUserId, requestId: `nurix-al-shami-paid-payroll:${ledger.sourceId}`, sourceType: 'nurix_al_shami_historical_paid_payroll', sourceReference: ledger.sourceId, businessDate: sourceDate(ledger.businessDate, 'ledger.businessDate'), description: `ترحيل سداد مسير رواتب نوركس: ${ledger.invoiceNumber}`, lines: [{ accountId: accounts[0].id, debitAmount: ledger.amount, description: ledger.invoiceNumber }, { accountId: vault.accountId, creditAmount: ledger.amount, description: ledger.invoiceNumber }] });
          const paymentId = randomUUID();
          await tx.hrPayrollPayment.create({ data: { id: paymentId, tenantId, companyId, payrollRunId, paymentNumber, businessDate: sourceDate(ledger.businessDate, 'ledger.businessDate'), amount: ledger.amount, journalEntryId: journal.journalEntryId, createdByUserId: actorUserId } });
          await tx.hrPayrollPaymentAllocation.create({ data: { id: randomUUID(), tenantId, companyId, payrollPaymentId: paymentId, vaultId: vault.id, paymentMethod: vault.paymentMethod, amount: ledger.amount } });
          payments.push({ paymentId, ledger, journalEntryId: journal.journalEntryId });
        }
        const paymentIdByLedgerId = new Map(payments.map((payment) => [payment.ledger.sourceId, payment.paymentId]));
        const lineIdBySourceId = new Map(lineRows.map((row) => [row.item.sourceId, row.id]));
        for (const annotation of annotationRows(run, payrollRunId, paymentIdByLedgerId, lineIdBySourceId)) {
          await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity: annotation.sourceEntity, sourceId: annotation.sourceId, field: annotation.field } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: annotation.sourceEntity, sourceId: annotation.sourceId, sourceChecksum: annotation.sourceChecksum, targetEntity: annotation.targetEntity, targetId: annotation.targetId, field: annotation.field, exactText: annotation.exactText }, update: { sourceChecksum: annotation.sourceChecksum, targetEntity: annotation.targetEntity, targetId: annotation.targetId, exactText: annotation.exactText } });
        }
        const mappings = [
          ...run.components.map((component) => ({ sourceEntity: 'NoorixPaidPayrollRun', sourceId: component.sourceId, sourceChecksum: component.checksum, targetEntity: 'HrPayrollRun', targetId: payrollRunId })),
          ...lineRows.map((row) => ({ sourceEntity: 'NoorixPaidPayrollLine', sourceId: row.item.sourceId, sourceChecksum: sha(row.item), targetEntity: 'HrPayrollLine', targetId: row.id })),
          ...payments.map((payment) => ({ sourceEntity: 'NoorixPaidPayrollLedger', sourceId: payment.ledger.sourceId, sourceChecksum: sha(payment.ledger), targetEntity: 'HrPayrollPayment', targetId: payment.paymentId })),
        ];
        for (const map of mappings) await tx.nurixExcelFinancialSourceMap.upsert({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: map.sourceEntity, sourceId: map.sourceId } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: map.sourceEntity, sourceId: map.sourceId, sourceChecksum: map.sourceChecksum, targetEntity: map.targetEntity, targetId: map.targetId, state: 'APPLIED' }, update: { sourceChecksum: map.sourceChecksum, targetEntity: map.targetEntity, targetId: map.targetId, state: 'APPLIED' } });
        await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.historical_paid_payroll.posted', entityType: 'HrPayrollRun', entityId: payrollRunId, requestId: `nurix-al-shami-payroll:${run.payrollMonth}`, afterJson: { sourceComponentIds: run.components.map((component) => component.sourceId), sourceComponentRunNumbers: run.components.map((component) => component.runNumber), sourceChecksum: run.checksum, sourcePaymentLedgerIds: payments.map((payment) => payment.ledger.sourceId), paidAmount: run.totalAmount, sourceLineArithmeticExceptionCount: run.items.filter(({ component, ...item }) => fixed(Number(item.grossSalary) + Number(item.allowances) - Number(item.deductions) - Number(item.advanceDeduction) - Number(item.netAmount)) !== '0.0000').length, noAccrualJournalCreated: true } } });
        receipts.push({ run, payrollRunId, replayed: false });
      }
      // Every active SAL invoice gets an invoice-level receipt on this package.
      // This is essential when a prior writer already created the normalized
      // monthly payroll run: replaying it must restore package-bound invoice
      // lineage without posting a second journal or payment.
      for (const { run, payrollRunId } of receipts) for (const component of run.components) {
        const invoiceChecksum = sha({ sourceId: component.invoice.sourceId, invoice: component.invoice });
        await tx.nurixExcelFinancialSourceMap.upsert({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: 'NoorixPayrollInvoice', sourceId: component.invoice.sourceId } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixPayrollInvoice', sourceId: component.invoice.sourceId, sourceChecksum: invoiceChecksum, targetEntity: 'HrPayrollRun', targetId: payrollRunId, state: 'APPLIED' }, update: { sourceChecksum: invoiceChecksum, targetEntity: 'HrPayrollRun', targetId: payrollRunId, state: 'APPLIED' } });
      }
      for (const invoice of cancelledSalaryInvoices) {
        await tx.nurixExcelFinancialSourceMap.upsert({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: 'NoorixCancelledPayrollInvoice', sourceId: invoice.sourceId } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixCancelledPayrollInvoice', sourceId: invoice.sourceId, sourceChecksum: invoice.checksum, targetEntity: 'NoorixCancelledPayrollEvidence', targetId: invoice.sourceId, state: 'APPLIED' }, update: { sourceChecksum: invoice.checksum, targetEntity: 'NoorixCancelledPayrollEvidence', targetId: invoice.sourceId, state: 'APPLIED' } });
        await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', sourceId: invoice.sourceId, field: 'notes' } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: 'Invoice', sourceId: invoice.sourceId, sourceChecksum: invoice.checksum, targetEntity: null, targetId: null, field: 'notes', exactText: invoice.notes }, update: { sourceChecksum: invoice.checksum, targetEntity: null, targetId: null, exactText: invoice.notes } });
      }
      await tx.nurixExcelFinancialItem.createMany({ skipDuplicates: true, data: [
        ...receipts.flatMap(({ run, payrollRunId, replayed }) => run.components.map((component) => ({ id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sourceSheet: 'NoorixPaidPayroll', sourceEntity: 'NoorixPaidPayrollRun', sourceId: component.sourceId, sourceChecksum: component.checksum, operationKey: sha({ transformVersion: TRANSFORM_VERSION, sourceId: component.sourceId, checksum: component.checksum }), status: replayed ? 'REUSED' : 'POSTED', targetEntity: 'HrPayrollRun', targetId: payrollRunId, resultCode: replayed ? 'REPLAYED_VERIFIED' : 'POSTED_MONTH_NORMALIZED_CASH_BASIS_SOURCE_JOURNALS_ONLY' }))),
        ...receipts.flatMap(({ run, payrollRunId, replayed }) => run.components.map((component) => ({ id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sourceSheet: 'Exceptions', sourceEntity: 'NoorixPayrollInvoice', sourceId: component.invoice.sourceId, sourceChecksum: sha({ sourceId: component.invoice.sourceId, invoice: component.invoice }), operationKey: sha({ transformVersion: TRANSFORM_VERSION, sourceId: component.invoice.sourceId, kind: 'salary-invoice' }), status: replayed ? 'REUSED' : 'POSTED', targetEntity: 'HrPayrollRun', targetId: payrollRunId, resultCode: replayed ? 'REPLAYED_VERIFIED_INVOICE_LINEAGE' : 'POSTED_CASH_BASIS_SOURCE_JOURNALS_ONLY' }))),
        ...cancelledSalaryInvoices.map((invoice) => ({ id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sourceSheet: 'Exceptions', sourceEntity: 'NoorixCancelledPayrollInvoice', sourceId: invoice.sourceId, sourceChecksum: invoice.checksum, operationKey: sha({ transformVersion: TRANSFORM_VERSION, sourceId: invoice.sourceId, kind: 'cancelled-salary' }), status: 'EXCLUDED', targetEntity: 'NoorixCancelledPayrollEvidence', targetId: invoice.sourceId, resultCode: 'SOURCE_CANCELLED_EVIDENCE_ONLY' })),
      ] });
      const postedSourceComponents = receipts.filter((receipt) => !receipt.replayed).reduce((sum, receipt) => sum + receipt.run.components.length, 0);
      const reusedSourceComponents = receipts.filter((receipt) => receipt.replayed).reduce((sum, receipt) => sum + receipt.run.components.length, 0);
      const totals = { targetRuns: receipts.length, sourceComponents: runs.length, reusedTargetRuns: receipts.filter((receipt) => receipt.replayed).length, payrollLines: targetRuns.reduce((sum, run) => sum + run.items.length, 0), payments: paymentCount, paid: paidTotal, cancelledSalaryEvidenceOnly: cancelledSalaryInvoices.length, accrualJournalsCreated: 0, advanceSettlementJournalsCreated: 0, sourceLineArithmeticExceptions: drySummary.sourceLineArithmeticExceptions.length };
      await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: 'COMMITTED', postedItems: postedSourceComponents, reusedItems: reusedSourceComponents, reviewItems: cancelledSalaryInvoices.length, failedItems: 0, committedAt: new Date(), reconciliationHash: sha(totals) } });
      await tx.nurixExcelFinancialReceipt.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sequence: 1, kind: 'RECONCILIATION', receiptSha256: sha(totals), summaryJson: totals, createdByUserId: actorUserId }, update: { waveId: wave.id, receiptSha256: sha(totals), summaryJson: totals } });
      await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', waveSequence: 1, leaseToken: null, leaseExpiresAt: null, reason: null } });
      return totals;
    });
    console.log(JSON.stringify({ status: 'COMPLETED', ...outcome }, null, 2));
  }
} finally {
  await app.close();
}
