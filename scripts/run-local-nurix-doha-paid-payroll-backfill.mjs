/**
 * Controlled historical paid-payroll writer for Noorix → Baseer (Doha Consumer).
 *
 * This is intentionally a cash-basis historical projection.  It mirrors only
 * verified Noorix payroll-payment journals (EXP-004 → mapped vault), and keeps
 * employee, source-invoice and source-ledger lineage.  It never invents an
 * accrual, a salary correction, or an advance-settlement journal: a payroll
 * advance remains a balance-sheet fact, never an expense.
 *
 * Usage:
 *   node scripts/run-local-nurix-doha-paid-payroll-backfill.mjs \
 *     <package-id> <tenant-id> <company-id> <owner-user-id> DRY_RUN
 *
 *   node scripts/run-local-nurix-doha-paid-payroll-backfill.mjs \
 *     <package-id> <tenant-id> <company-id> <owner-user-id> \
 *     APPLY_APPROVED_NOORIX_DOHA_PAID_PAYROLL_V1
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const SOURCE_COMPANY_ID = 'cmnf5xrd0001uy8lm8vja50gp';
const SNAPSHOT_CONTAINER = 'baseer-noorix-snapshot-20260902';
const SNAPSHOT_DATABASE = 'nurix_snapshot';
const APPLY_TOKEN = 'APPLY_APPROVED_NOORIX_DOHA_PAID_PAYROLL_V1';
const TRANSFORM_VERSION = 'nurix-doha-paid-payroll/v1';
const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
const uuid = /^[0-9a-f-]{36}$/i;

if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPLY_TOKEN].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-doha-paid-payroll-backfill.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPLY_TOKEN}`);
}

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixed = (value) => Number(value).toFixed(4);
const money = (value, name) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid source money ${name}.`);
  return fixed(parsed);
};
const date = (value, name) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) throw new Error(`Invalid source date ${name}.`);
  return new Date(`${value}T00:00:00.000Z`);
};
const firstOfMonth = (value) => `${value.slice(0, 7)}-01`;
const note = (value) => typeof value === 'string' ? value : '';

const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('This writer only permits the canonical local Baseer test database.');
}

// The query is deliberately constrained to completed Noorix payrolls whose
// active SAL invoice and active EXP-004 payment ledger exist.  Raw notes stay
// evidence only; they do not drive accounting instructions.
const sourceSql = `
SELECT COALESCE(json_agg(row ORDER BY row->>'payrollMonth', row->>'runNumber'), '[]'::json)::text
FROM (
  SELECT json_build_object(
    'sourceId', r.id,
    'runNumber', r.run_number,
    'payrollMonth', to_char(r.payroll_month::date, 'YYYY-MM-DD'),
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
  JOIN invoices i ON i.company_id=r.company_id AND i.invoice_number='SAL-' || r.run_number AND i.status='active'
  WHERE r.company_id='${SOURCE_COMPANY_ID}' AND r.status='completed'
) source;`;

const raw = execFileSync('docker', ['exec', SNAPSHOT_CONTAINER, 'psql', '-U', 'nurix_restore', '-d', SNAPSHOT_DATABASE, '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
if (!raw) throw new Error('No Noorix salary source was returned.');
const sourceRuns = JSON.parse(raw);

function normaliseRun(source) {
  if (!source?.sourceId || !source?.runNumber || !source?.invoice?.sourceId || !Array.isArray(source.items) || !Array.isArray(source.ledgers)) {
    throw new Error('Noorix payroll source is incomplete.');
  }
  const invoice = {
    sourceId: source.invoice.sourceId,
    number: source.invoice.number,
    amount: money(source.invoice.amount, 'invoice.amount'),
    businessDate: source.invoice.businessDate,
    notes: note(source.invoice.notes),
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
      notes: note(item.notes),
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
      notes: note(ledger.notes),
    };
  });
  if (items.length === 0 || ledgers.length === 0) throw new Error(`Noorix ${source.runNumber} lacks payroll lines or payment ledgers.`);
  const totalAmount = money(source.totalAmount, `${source.runNumber} totalAmount`);
  const linesNet = fixed(items.reduce((sum, item) => sum + Number(item.netAmount), 0));
  const ledgerTotal = fixed(ledgers.reduce((sum, ledger) => sum + Number(ledger.amount), 0));
  if (totalAmount !== invoice.amount || totalAmount !== linesNet || totalAmount !== ledgerTotal) {
    throw new Error(`Noorix ${source.runNumber} does not reconcile between payroll header, salary invoice, lines, and payment ledger.`);
  }
  if (Number(source.employeeCount) !== items.length) throw new Error(`Noorix ${source.runNumber} employee count differs from its lines.`);
  const lineArithmeticExceptions = items.filter((item) => fixed(Number(item.grossSalary) + Number(item.allowances) - Number(item.deductions) - Number(item.advanceDeduction) - Number(item.netAmount)) !== '0.0000');
  if (lineArithmeticExceptions.length) throw new Error(`Noorix ${source.runNumber} has payroll-line arithmetic exceptions; no settlement journal will be manufactured.`);
  return {
    sourceId: source.sourceId,
    runNumber: source.runNumber,
    payrollMonth: firstOfMonth(source.payrollMonth),
    businessDate: invoice.businessDate,
    employeeCount: items.length,
    totalAmount,
    notes: note(source.notes),
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
const runCount = runs.length;
const lineCount = runs.reduce((sum, run) => sum + run.items.length, 0);
const paymentCount = runs.reduce((sum, run) => sum + run.ledgers.length, 0);
const paidTotal = fixed(runs.reduce((sum, run) => sum + Number(run.totalAmount), 0));
if (runCount !== 3 || lineCount !== 15 || paymentCount !== 3 || paidTotal !== '52700.1000') {
  throw new Error(`The frozen Doha payroll contract changed: ${runCount} runs / ${lineCount} lines / ${paymentCount} ledgers / ${paidTotal} paid.`);
}
const duplicateRunNumber = runs.find((run, index) => runs.findIndex((candidate) => candidate.runNumber === run.runNumber) !== index);
if (duplicateRunNumber) throw new Error(`Noorix payroll run ${duplicateRunNumber.runNumber} is duplicated.`);
const planChecksum = sha({ transformVersion: TRANSFORM_VERSION, sourceCompanyId: SOURCE_COMPANY_ID, runs: runs.map((run) => ({ sourceId: run.sourceId, checksum: run.checksum })) });

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { JournalPostingService } = await import('../apps/api/dist/finance/journal/journal-posting.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });

function sourceMappingsFor(run, payrollRunId, lineIdBySourceId, paymentIdByLedgerId) {
  return [
    { sourceEntity: 'NoorixPaidPayrollRun', sourceId: run.sourceId, sourceChecksum: run.checksum, targetEntity: 'HrPayrollRun', targetId: payrollRunId },
    { sourceEntity: 'NoorixPayrollInvoice', sourceId: run.invoice.sourceId, sourceChecksum: sha({ sourceId: run.invoice.sourceId, invoice: run.invoice }), targetEntity: 'HrPayrollRun', targetId: payrollRunId },
    ...run.items.map((item) => ({ sourceEntity: 'NoorixPaidPayrollLine', sourceId: item.sourceId, sourceChecksum: sha(item), targetEntity: 'HrPayrollLine', targetId: lineIdBySourceId.get(item.sourceId) })),
    ...run.ledgers.map((ledger) => ({ sourceEntity: 'NoorixPaidPayrollLedger', sourceId: ledger.sourceId, sourceChecksum: sha(ledger), targetEntity: 'HrPayrollPayment', targetId: paymentIdByLedgerId.get(ledger.sourceId) })),
  ];
}

async function preflight(database) {
  return database.inTenantTransaction(tenantId, async (tx) => {
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID }, select: { id: true } });
    if (!packageRow) throw new Error('The selected migration package is not scoped to Doha Consumer / the frozen Noorix company.');
    const sourceEmployeeIds = [...new Set(runs.flatMap((run) => run.items.map((item) => item.employeeSourceId)))];
    const sourceVaultIds = [...new Set(runs.flatMap((run) => run.ledgers.map((ledger) => ledger.vaultSourceId)))];
    const [employees, employeeMaps, vaultMaps, accounts, execution, existingRuns] = await Promise.all([
      tx.hrEmployee.findMany({ where: { tenantId, companyId }, select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } }),
      tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: sourceEmployeeIds }, status: { in: ['CREATED', 'REUSED'] }, execution: { targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', sourceId: { in: sourceVaultIds }, targetEntity: 'FinanceVault', state: { in: ['APPLIED', 'REUSED'] } }, select: { sourceId: true, targetId: true } }),
      tx.financeAccount.findMany({ where: { tenantId, companyId, status: 'ACTIVE', systemKey: 'PAYROLL_EXPENSE' }, select: { id: true, code: true } }),
      tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: TRANSFORM_VERSION } }, select: { id: true, status: true, financialPlanSha256: true } }),
      tx.hrPayrollRun.findMany({ where: { tenantId, companyId, runNumber: { in: runs.map((run) => run.runNumber) } }, include: { lines: true, payments: { include: { allocations: true } } } }),
    ]);
    if (accounts.length !== 1 || accounts[0].code !== 'EXP-004') throw new Error('Baseer requires exactly one active PAYROLL_EXPENSE account with code EXP-004.');
    if (execution && execution.financialPlanSha256 !== planChecksum) throw new Error('The Noorix Doha payroll source changed after its execution plan was prepared; create a package revision.');
    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    const employeeBySource = new Map();
    for (const map of employeeMaps) {
      const employee = map.targetId ? employeeById.get(map.targetId) : undefined;
      const prior = employeeBySource.get(map.sourceId);
      // A subsequent migration package may record the exact same established
      // source-to-target employee link as REUSED.  That is idempotent lineage,
      // not ambiguity; reject only a genuinely different target.
      if (!employee || (prior && prior.id !== employee.id)) throw new Error(`Noorix employee ${map.sourceId} has missing or ambiguous Baseer lineage.`);
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
    for (const ledger of runs.flatMap((run) => run.ledgers)) if (!vaultById.get(vaultBySource.get(ledger.vaultSourceId))) throw new Error(`Noorix payroll ledger ${ledger.sourceId} lacks an active payable target vault.`);
    const existingByNumber = new Map(existingRuns.map((run) => [run.runNumber, run]));
    for (const run of runs) {
      const existing = existingByNumber.get(run.runNumber);
      if (!existing) continue;
      if (existing.status !== 'PAID' || fixed(existing.grossAmount) !== run.grossAmount || fixed(existing.advanceSettlementAmount) !== run.advanceSettlementAmount || fixed(existing.administrativeDeductionAmount) !== run.administrativeDeductionAmount || fixed(existing.netPayableAmount) !== run.totalAmount || fixed(existing.paidAmount) !== run.totalAmount || existing.lines.length !== run.items.length || existing.payments.length !== run.ledgers.length || existing.accrualJournalEntryId !== null) {
        throw new Error(`Existing Baseer payroll ${run.runNumber} does not match this historical cash-basis source contract.`);
      }
    }
    return { employeeBySource, vaultBySource, vaultById, payrollExpenseAccountId: accounts[0].id, existingByNumber };
  });
}

try {
  const database = app.get(DatabaseService);
  const journals = app.get(JournalPostingService);
  const checked = await preflight(database);
  const drySummary = {
    status: mode === 'DRY_RUN' ? 'DRY_RUN_OK' : 'READY_TO_APPLY',
    transformVersion: TRANSFORM_VERSION,
    sourceCompanyId: SOURCE_COMPANY_ID,
    targetRuns: runCount,
    payrollLines: lineCount,
    payments: paymentCount,
    paidTotal,
    grossSalaryAndAllowances: fixed(runs.reduce((sum, run) => sum + Number(run.grossAmount), 0)),
    advanceDeductionsRecordedOnPayrollLines: fixed(runs.reduce((sum, run) => sum + Number(run.advanceSettlementAmount), 0)),
    noAccrualJournalCreated: true,
    noAdvanceSettlementJournalCreated: true,
    noDifferenceCorrectionJournalCreated: true,
  };
  if (mode === 'DRY_RUN') {
    console.log(JSON.stringify(drySummary, null, 2));
    process.exitCode = 0;
  } else {
    const outcome = await database.inTenantTransaction(tenantId, async (tx) => {
      const existingExecution = await tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: TRANSFORM_VERSION } }, select: { id: true, financialPlanSha256: true } });
      if (existingExecution?.financialPlanSha256 && existingExecution.financialPlanSha256 !== planChecksum) throw new Error('The payroll plan changed after preflight.');
      const execution = existingExecution ?? await tx.nurixExcelFinancialExecution.create({ data: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion: TRANSFORM_VERSION, financialPlanSha256: planChecksum, status: 'APPROVED', reason: 'Owner-approved Doha historical paid payroll. Mirrors verified Noorix cash-basis EXP-004-to-vault payment journals only; no accrual, advance settlement, or correction is manufactured.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date() }, select: { id: true } });
      const wave = await tx.nurixExcelFinancialWave.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sequence: 1, status: 'RUNNING', plannedItems: runCount }, update: { status: 'RUNNING', plannedItems: runCount, failedItems: 0 }, select: { id: true } });
      const now = new Date();
      const receipts = [];
      for (const run of runs) {
        const existing = await tx.hrPayrollRun.findFirst({ where: { tenantId, companyId, runNumber: run.runNumber }, include: { lines: true, payments: true } });
        if (existing) {
          if (existing.status !== 'PAID' || fixed(existing.netPayableAmount) !== run.totalAmount || fixed(existing.paidAmount) !== run.totalAmount || existing.lines.length !== run.items.length || existing.payments.length !== run.ledgers.length || existing.accrualJournalEntryId !== null) throw new Error(`Existing payroll ${run.runNumber} cannot be safely replayed.`);
          receipts.push({ run, payrollRunId: existing.id, replayed: true });
          continue;
        }
        const payrollRunId = randomUUID();
        const lineRows = run.items.map((item) => ({ id: randomUUID(), item, employee: checked.employeeBySource.get(item.employeeSourceId) }));
        if (lineRows.some((row) => !row.employee)) throw new Error(`Employee lineage changed while writing ${run.runNumber}.`);
        await tx.hrPayrollRun.create({ data: { id: payrollRunId, tenantId, companyId, runNumber: run.runNumber, payrollMonth: date(run.payrollMonth, 'payrollMonth'), businessDate: date(run.businessDate, 'businessDate'), status: 'PAID', employeeCount: run.employeeCount, grossAmount: run.grossAmount, advanceSettlementAmount: run.advanceSettlementAmount, administrativeDeductionAmount: run.administrativeDeductionAmount, netPayableAmount: run.totalAmount, paidAmount: run.totalAmount, notes: run.notes || null, accrualJournalEntryId: null, approvedAt: now, createdByUserId: actorUserId } });
        await tx.hrPayrollLine.createMany({ data: lineRows.map(({ id, item, employee }) => ({ id, tenantId, companyId, payrollRunId, employeeId: employee.id, employeeNumberSnapshot: employee.employeeNumber, employeeNameArSnapshot: employee.nameAr, employeeNameEnSnapshot: employee.nameEn, grossSalary: fixed(Number(item.grossSalary) + Number(item.allowances)), basicSalary: item.grossSalary, foodAllowance: '0.0000', housingAllowance: '0.0000', transportAllowance: '0.0000', otherAllowance: item.allowances, overtimeAmount: '0.0000', overtimeHours: '0.0000', advanceSettlementAmount: item.advanceDeduction, administrativeDeductionAmount: item.deductions, netPayableAmount: item.netAmount, paidAmount: item.netAmount, payrollCalculationSnapshotJson: { sourceContract: 'NOORIX_HISTORICAL_PAID_PAYROLL_V1', sourceRunId: run.sourceId, sourceRunNumber: run.runNumber, sourceGrossSalary: item.grossSalary, sourceAllowancesAdd: item.allowances, sourceDeductions: item.deductions, sourceAdvancesDeduct: item.advanceDeduction, sourceNetSalary: item.netAmount } })) });
        const payments = [];
        for (let index = 0; index < run.ledgers.length; index += 1) {
          const ledger = run.ledgers[index];
          const vault = checked.vaultById.get(checked.vaultBySource.get(ledger.vaultSourceId));
          if (!vault) throw new Error(`Vault lineage changed for Noorix ledger ${ledger.sourceId}.`);
          const journal = await journals.postInTransaction(tx, { tenantId, companyId, actorUserId, requestId: `nurix-doha-paid-payroll:${ledger.sourceId}`, sourceType: 'nurix_doha_historical_paid_payroll', sourceReference: ledger.sourceId, businessDate: date(ledger.businessDate, 'ledger.businessDate'), description: `ترحيل سداد مسير رواتب نوركس: ${run.invoice.number}`, lines: [{ accountId: checked.payrollExpenseAccountId, debitAmount: ledger.amount, description: run.invoice.number }, { accountId: vault.accountId, creditAmount: ledger.amount, description: run.invoice.number }] });
          const paymentId = randomUUID();
          await tx.hrPayrollPayment.create({ data: { id: paymentId, tenantId, companyId, payrollRunId, paymentNumber: `NXR-${run.invoice.number}-${String(index + 1).padStart(2, '0')}`.slice(0, 80), businessDate: date(ledger.businessDate, 'ledger.businessDate'), amount: ledger.amount, journalEntryId: journal.journalEntryId, createdByUserId: actorUserId } });
          await tx.hrPayrollPaymentAllocation.create({ data: { id: randomUUID(), tenantId, companyId, payrollPaymentId: paymentId, vaultId: vault.id, paymentMethod: vault.paymentMethod, amount: ledger.amount } });
          payments.push({ paymentId, ledger, journalEntryId: journal.journalEntryId });
        }
        const paymentIdByLedgerId = new Map(payments.map((payment) => [payment.ledger.sourceId, payment.paymentId]));
        const lineIdBySourceId = new Map(lineRows.map((row) => [row.item.sourceId, row.id]));
        for (const mapping of sourceMappingsFor(run, payrollRunId, lineIdBySourceId, paymentIdByLedgerId)) {
          await tx.nurixExcelFinancialSourceMap.upsert({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: mapping.sourceEntity, sourceId: mapping.sourceId } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: mapping.sourceEntity, sourceId: mapping.sourceId, sourceChecksum: mapping.sourceChecksum, targetEntity: mapping.targetEntity, targetId: mapping.targetId, state: 'APPLIED' }, update: { sourceChecksum: mapping.sourceChecksum, targetEntity: mapping.targetEntity, targetId: mapping.targetId, state: 'APPLIED' } });
        }
        for (const annotation of [
          { sourceEntity: 'NoorixPayrollRun', sourceId: run.sourceId, sourceChecksum: sha({ id: run.sourceId, notes: run.notes }), targetEntity: 'HrPayrollRun', targetId: payrollRunId, field: 'notes', exactText: run.notes },
          { sourceEntity: 'NoorixPayrollInvoice', sourceId: run.invoice.sourceId, sourceChecksum: sha({ id: run.invoice.sourceId, notes: run.invoice.notes }), targetEntity: 'HrPayrollRun', targetId: payrollRunId, field: 'invoice.notes', exactText: run.invoice.notes },
          ...run.items.map((item) => ({ sourceEntity: 'NoorixPayrollRunItem', sourceId: item.sourceId, sourceChecksum: sha({ id: item.sourceId, notes: item.notes }), targetEntity: 'HrPayrollLine', targetId: lineIdBySourceId.get(item.sourceId), field: 'notes', exactText: item.notes })),
          ...payments.map((payment) => ({ sourceEntity: 'NoorixPayrollLedger', sourceId: payment.ledger.sourceId, sourceChecksum: sha({ id: payment.ledger.sourceId, notes: payment.ledger.notes }), targetEntity: 'HrPayrollPayment', targetId: payment.paymentId, field: 'notes', exactText: payment.ledger.notes })),
        ]) {
          await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity: annotation.sourceEntity, sourceId: annotation.sourceId, field: annotation.field } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: annotation.sourceEntity, sourceId: annotation.sourceId, sourceChecksum: annotation.sourceChecksum, targetEntity: annotation.targetEntity, targetId: annotation.targetId, field: annotation.field, exactText: annotation.exactText }, update: { sourceChecksum: annotation.sourceChecksum, targetEntity: annotation.targetEntity, targetId: annotation.targetId, exactText: annotation.exactText } });
        }
        await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.doha.historical_paid_payroll.posted', entityType: 'HrPayrollRun', entityId: payrollRunId, requestId: `nurix-doha-payroll:${run.payrollMonth}`, afterJson: { sourceRunId: run.sourceId, sourceInvoiceId: run.invoice.sourceId, sourcePaymentLedgerIds: payments.map((payment) => payment.ledger.sourceId), paidAmount: run.totalAmount, advanceDeductionAmount: run.advanceSettlementAmount, noAccrualJournalCreated: true, noAdvanceSettlementJournalCreated: true } } });
        receipts.push({ run, payrollRunId, replayed: false });
      }
      await tx.nurixExcelFinancialItem.createMany({ skipDuplicates: true, data: receipts.map(({ run, payrollRunId, replayed }) => ({ id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sourceSheet: 'NoorixPaidPayroll', sourceEntity: 'NoorixPaidPayrollRun', sourceId: run.sourceId, sourceChecksum: run.checksum, operationKey: sha({ transformVersion: TRANSFORM_VERSION, sourceId: run.sourceId, checksum: run.checksum }), status: replayed ? 'REUSED' : 'POSTED', targetEntity: 'HrPayrollRun', targetId: payrollRunId, resultCode: replayed ? 'REPLAYED_VERIFIED' : 'POSTED_CASH_BASIS_SOURCE_JOURNAL_ONLY' })) });
      const totals = { targetRuns: receipts.length, sourceRuns: runCount, payrollLines: lineCount, payments: paymentCount, paid: paidTotal, grossSalaryAndAllowances: drySummary.grossSalaryAndAllowances, advanceDeductionsRecordedOnPayrollLines: drySummary.advanceDeductionsRecordedOnPayrollLines, reusedTargetRuns: receipts.filter((receipt) => receipt.replayed).length, accrualJournalsCreated: 0, advanceSettlementJournalsCreated: 0 };
      await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: 'COMMITTED', postedItems: receipts.filter((receipt) => !receipt.replayed).length, reusedItems: receipts.filter((receipt) => receipt.replayed).length, failedItems: 0, committedAt: new Date(), reconciliationHash: sha(totals) } });
      await tx.nurixExcelFinancialReceipt.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sequence: 1, kind: 'RECONCILIATION', receiptSha256: sha(totals), summaryJson: totals, createdByUserId: actorUserId }, update: { waveId: wave.id, receiptSha256: sha(totals), summaryJson: totals } });
      await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', waveSequence: 1, leaseToken: null, leaseExpiresAt: null, reason: null } });
      return totals;
    });
    console.log(JSON.stringify({ status: 'COMPLETED', ...outcome }, null, 2));
  }
} finally {
  await app.close();
}
