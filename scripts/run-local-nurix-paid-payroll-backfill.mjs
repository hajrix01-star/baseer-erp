/**
 * Creates auditable, paid Baseer payroll runs from verified live Noorix salary
 * evidence. It is deliberately separate from the evidence-only payroll import:
 * source advance settlements are already posted in Baseer, so this writer
 * records their historical deduction on the payroll line without applying an
 * advance a second time.
 *
 * Usage:
 * node scripts/run-local-nurix-paid-payroll-backfill.mjs <package-id> <tenant-id> <company-id> <owner-user-id> APPLY_APPROVED_NOORIX_ARZ_PAID_PAYROLL_V1
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const APPROVAL = 'APPLY_APPROVED_NOORIX_ARZ_PAID_PAYROLL_V1';
const SOURCE_COMPANY_ID = 'cmnf604ka009ay8lm556wgd9c';
const [packageId, tenantId, companyId, actorUserId, approval] = process.argv.slice(2);
const uuid = /^[0-9a-f-]{36}$/i;
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || approval !== APPROVAL) {
  throw new Error(`Usage: node scripts/run-local-nurix-paid-payroll-backfill.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> ${APPROVAL}`);
}

const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('This writer only permits the canonical local Baseer test database.');
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

// The source is intentionally read through the frozen local Docker snapshot.
// The JSON shape keeps all payroll invoice, item, ledger, and vault evidence
// together so fail-closed validation happens before the target app starts.
const sourceSql = `
WITH monthly AS (
  SELECT json_build_object(
    'sourceId', r.id, 'runNumber', r.run_number,
    'payrollMonth', to_char(r.payroll_month, 'YYYY-MM-DD'),
    'sourceAccruedDate', to_char(r.payroll_accrued_at::date, 'YYYY-MM-DD'),
    'employeeCount', r.employee_count, 'totalAmount', r.total_amount::text,
    'items', COALESCE((SELECT json_agg(json_build_object(
      'sourceId', ri.id, 'employeeSourceId', ri.employee_id,
      'basicSalary', ri.gross_salary::text, 'allowances', ri.allowances_add::text,
      'deductions', ri.deductions::text, 'sourceAdvance', ri.advances_deduct::text,
      'net', ri.net_salary::text
    ) ORDER BY ri.id) FROM payroll_run_items ri WHERE ri.payroll_run_id=r.id), '[]'::json),
    'invoice', (SELECT json_build_object('sourceId', i.id, 'number', i.invoice_number,
       'businessDate', to_char(i.transaction_date::date, 'YYYY-MM-DD'),
       'amount', i.total_amount::text, 'status', i.status)
       FROM invoices i WHERE i.company_id=r.company_id AND i.invoice_number='SAL-' || r.run_number),
    'ledgers', COALESCE((SELECT json_agg(json_build_object(
       'sourceId', l.id, 'vaultSourceId', l.vault_id, 'businessDate', to_char(l.transaction_date::date, 'YYYY-MM-DD'),
       'amount', l.amount::text, 'status', l.status, 'referenceType', l.reference_type
    ) ORDER BY l.id) FROM ledger_entries l
      WHERE l.company_id=r.company_id AND l.reference_id=(SELECT i.id FROM invoices i WHERE i.company_id=r.company_id AND i.invoice_number='SAL-' || r.run_number)
    ), '[]'::json)
  ) AS row
  FROM payroll_runs r
  WHERE r.company_id='${SOURCE_COMPANY_ID}' AND r.status='completed'
), standalone AS (
  SELECT json_build_object(
    'sourceId', i.id, 'runNumber', i.invoice_number, 'payrollMonth', to_char(i.transaction_date::date, 'YYYY-MM-DD'),
    'sourceAccruedDate', to_char(i.transaction_date::date, 'YYYY-MM-DD'), 'employeeCount', 1, 'totalAmount', i.total_amount::text,
    'items', json_build_array(json_build_object('sourceId', i.id || ':line', 'employeeSourceId', i.employee_id,
      'basicSalary', i.total_amount::text, 'allowances', '0', 'deductions', '0', 'sourceAdvance', '0', 'net', i.total_amount::text)),
    'invoice', json_build_object('sourceId', i.id, 'number', i.invoice_number, 'businessDate', to_char(i.transaction_date::date, 'YYYY-MM-DD'), 'amount', i.total_amount::text, 'status', i.status),
    'ledgers', COALESCE((SELECT json_agg(json_build_object('sourceId', l.id, 'vaultSourceId', l.vault_id, 'businessDate', to_char(l.transaction_date::date, 'YYYY-MM-DD'), 'amount', l.amount::text, 'status', l.status, 'referenceType', l.reference_type) ORDER BY l.id)
      FROM ledger_entries l WHERE l.company_id=i.company_id AND l.reference_id=i.id), '[]'::json)
  ) AS row
  FROM invoices i
  WHERE i.company_id='${SOURCE_COMPANY_ID}' AND i.kind='salary' AND i.status='active' AND i.invoice_number NOT LIKE 'SAL-PR-%'
)
SELECT json_build_object('monthly', COALESCE((SELECT json_agg(row ORDER BY (row->>'payrollMonth')) FROM monthly), '[]'::json), 'standalone', COALESCE((SELECT json_agg(row ORDER BY (row->'invoice'->>'businessDate')) FROM standalone), '[]'::json))::text;`;
const raw = execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
if (!raw) throw new Error('No Noorix salary source was returned.');
const sourcePayload = JSON.parse(raw);

function normaliseRun(source, kind) {
  if (!source?.sourceId || !source?.runNumber || !Array.isArray(source.items) || !source.invoice || !Array.isArray(source.ledgers)) throw new Error('Noorix payroll source is incomplete.');
  if (source.invoice.status !== 'active' || !source.invoice.sourceId || !source.invoice.number || !source.invoice.businessDate) throw new Error(`Noorix ${source.runNumber} lacks one active salary invoice.`);
  const items = source.items.map((item) => {
    if (!item.sourceId || !item.employeeSourceId) throw new Error(`Noorix ${source.runNumber} has a line without employee lineage.`);
    const basic = money(item.basicSalary, 'basicSalary'); const allowances = money(item.allowances, 'allowances');
    const deductions = money(item.deductions, 'deductions'); const sourceAdvance = money(item.sourceAdvance, 'sourceAdvance'); const net = money(item.net, 'net');
    const gross = Number(basic) + Number(allowances);
    const beforeAdvance = gross - Number(deductions);
    if (beforeAdvance < -0.00001) throw new Error(`Noorix ${source.runNumber} has deductions above salary.`);
    const appliedAdvance = Math.min(Number(sourceAdvance), beforeAdvance);
    if (fixed(beforeAdvance - appliedAdvance) !== net) throw new Error(`Noorix ${source.runNumber} item ${item.sourceId} does not reconcile.`);
    return { ...item, basic, allowances, deductions, sourceAdvance, appliedAdvance: fixed(appliedAdvance), gross: fixed(gross), net };
  });
  const gross = fixed(items.reduce((sum, item) => sum + Number(item.gross), 0));
  const deductions = fixed(items.reduce((sum, item) => sum + Number(item.deductions), 0));
  const appliedAdvances = fixed(items.reduce((sum, item) => sum + Number(item.appliedAdvance), 0));
  const net = fixed(items.reduce((sum, item) => sum + Number(item.net), 0));
  if (net !== money(source.totalAmount, 'totalAmount') || net !== money(source.invoice.amount, 'invoice.amount')) throw new Error(`Noorix ${source.runNumber} invoice and payroll amounts disagree.`);
  if (!source.ledgers.length || source.ledgers.some((ledger) => ledger.status !== 'active' || ledger.referenceType !== 'salary' || !ledger.sourceId || !ledger.vaultSourceId || !ledger.businessDate)) throw new Error(`Noorix ${source.runNumber} has incomplete active salary ledger evidence.`);
  const ledgers = source.ledgers.map((ledger) => ({ ...ledger, amount: money(ledger.amount, 'ledger.amount') }));
  if (fixed(ledgers.reduce((sum, ledger) => sum + Number(ledger.amount), 0)) !== net) throw new Error(`Noorix ${source.runNumber} ledger allocations do not equal the salary invoice.`);
  const businessDate = source.invoice.businessDate;
  if (ledgers.some((ledger) => ledger.businessDate !== businessDate)) throw new Error(`Noorix ${source.runNumber} has a payment date differing from its salary invoice; manual handling is required.`);
  return {
    kind, sourceId: source.sourceId, runNumber: source.runNumber, payrollMonth: kind === 'MONTHLY' ? firstOfMonth(source.payrollMonth) : businessDate,
    businessDate, sourceAccruedDate: source.sourceAccruedDate, employeeCount: Number(source.employeeCount), invoice: source.invoice,
    items, ledgers, gross, deductions, appliedAdvances, net,
    checksum: sha({ source, kind }),
  };
}

const runs = [
  ...(sourcePayload.monthly ?? []).map((row) => normaliseRun(row, 'MONTHLY')),
  ...(sourcePayload.standalone ?? []).map((row) => normaliseRun(row, 'STANDALONE')),
];
if (runs.length !== 7 || runs.filter((run) => run.kind === 'MONTHLY').length !== 5 || runs.filter((run) => run.kind === 'STANDALONE').length !== 2) throw new Error('The reviewed ARZ source must contain five monthly runs and two active standalone salary invoices.');
const sourceNet = fixed(runs.reduce((sum, run) => sum + Number(run.net), 0));
if (sourceNet !== '166534.7600') throw new Error(`Noorix paid payroll total changed from the reviewed 166534.7600 to ${sourceNet}.`);
const planChecksum = sha({ version: 'nurix-paid-payroll/v1', sourceCompanyId: SOURCE_COMPANY_ID, runs: runs.map((run) => ({ id: run.sourceId, checksum: run.checksum })) });

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { JournalPostingService } = await import('../apps/api/dist/finance/journal/journal-posting.service.js');
const { FinanceCashPerformanceEventService } = await import('../apps/api/dist/finance/finance-cash-performance-event.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const database = app.get(DatabaseService);
  const journals = app.get(JournalPostingService);
  const cashEvents = app.get(FinanceCashPerformanceEventService);
  const transformVersion = 'nurix-paid-payroll/v1';
  const outcome = await database.inTenantTransaction(tenantId, async (tx) => {
    const existingExecution = await tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion } }, select: { id: true, status: true, financialPlanSha256: true } });
    if (existingExecution?.financialPlanSha256 !== undefined && existingExecution.financialPlanSha256 !== planChecksum) throw new Error('The payroll source changed after this execution was prepared; create a new package revision.');
    if (existingExecution?.status === 'COMPLETED') {
      const existingRuns = await tx.hrPayrollRun.count({ where: { tenantId, companyId, runNumber: { in: runs.map((run) => run.runNumber) }, status: 'PAID' } });
      if (existingRuns !== runs.length) throw new Error('Completed payroll execution has missing target runs; manual recovery is required.');
      return { executionId: existingExecution.id, replayed: true, runs: existingRuns, total: sourceNet };
    }
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId }, select: { id: true } });
    if (!packageRow) throw new Error('The selected migration package is not scoped to ARZ.');
    const accounts = await tx.financeAccount.findMany({ where: { tenantId, companyId, status: 'ACTIVE', systemKey: { in: ['PAYROLL_EXPENSE', 'PAYROLL_PAYABLE', 'EMPLOYEE_ADMIN_DEDUCTION_RECOVERY'] } }, select: { id: true, systemKey: true } });
    const accountByKey = new Map(accounts.map((row) => [row.systemKey, row.id]));
    for (const key of ['PAYROLL_EXPENSE', 'PAYROLL_PAYABLE', 'EMPLOYEE_ADMIN_DEDUCTION_RECOVERY']) if (!accountByKey.get(key)) throw new Error(`Baseer payroll account ${key} is not active.`);
    const sourceEmployeeIds = [...new Set(runs.flatMap((run) => run.items.map((item) => item.employeeSourceId)))];
    const sourceVaultIds = [...new Set(runs.flatMap((run) => run.ledgers.map((ledger) => ledger.vaultSourceId)))];
    const [employees, employeeMaps, vaultMaps] = await Promise.all([
      tx.hrEmployee.findMany({ where: { tenantId, companyId }, select: { id: true, employeeNumber: true, nameAr: true, nameEn: true } }),
      tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: sourceEmployeeIds }, status: { in: ['CREATED', 'REUSED'] }, execution: { targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', sourceId: { in: sourceVaultIds }, state: { in: ['APPLIED', 'REUSED'] }, targetEntity: 'FinanceVault' }, select: { sourceId: true, targetId: true } }),
    ]);
    const employeesById = new Map(employees.map((row) => [row.id, row]));
    const employeeBySource = new Map();
    for (const row of employeeMaps) {
      if (!row.targetId || employeeBySource.has(row.sourceId)) throw new Error(`Noorix employee ${row.sourceId} has ambiguous Baseer lineage.`);
      const employee = employeesById.get(row.targetId); if (!employee) throw new Error(`Noorix employee ${row.sourceId} maps outside ARZ.`);
      employeeBySource.set(row.sourceId, employee);
    }
    if (employeeBySource.size !== sourceEmployeeIds.length) throw new Error('One or more salary employees have no Baseer ARZ lineage.');
    const vaultBySource = new Map();
    for (const map of vaultMaps) {
      if (vaultBySource.has(map.sourceId) && vaultBySource.get(map.sourceId) !== map.targetId) throw new Error(`Noorix vault ${map.sourceId} maps ambiguously.`);
      vaultBySource.set(map.sourceId, map.targetId);
    }
    if (vaultBySource.size !== sourceVaultIds.length) throw new Error('One or more salary payment vaults have no Baseer map.');
    const vaults = await tx.financeVault.findMany({ where: { tenantId, companyId, id: { in: [...vaultBySource.values()] }, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, accountId: true, paymentMethod: true } });
    const vaultById = new Map(vaults.map((row) => [row.id, row]));
    if (vaultById.size !== vaultBySource.size) throw new Error('A mapped payroll vault is not an active payment destination.');
    const execution = existingExecution ?? await tx.nurixExcelFinancialExecution.create({ data: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion, financialPlanSha256: planChecksum, status: 'APPROVED', reason: 'Owner-approved historical Noorix salary payroll, paid from verified source vault allocations.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date() }, select: { id: true, status: true, financialPlanSha256: true } });
    const wave = await tx.nurixExcelFinancialWave.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sequence: 1, status: 'RUNNING', plannedItems: runs.length }, update: { status: 'RUNNING', plannedItems: runs.length, failedItems: 0 }, select: { id: true } });
    const receipts = [];
    for (const run of runs) {
      const existingRun = await tx.hrPayrollRun.findFirst({ where: { tenantId, companyId, runNumber: run.runNumber }, include: { payments: { include: { allocations: true } }, lines: true } });
      if (existingRun) {
        if (existingRun.status !== 'PAID' || fixed(existingRun.grossAmount) !== run.gross || fixed(existingRun.advanceSettlementAmount) !== run.appliedAdvances || fixed(existingRun.administrativeDeductionAmount) !== run.deductions || fixed(existingRun.netPayableAmount) !== run.net || fixed(existingRun.paidAmount) !== run.net || existingRun.lines.length !== run.items.length || existingRun.payments.length !== 1) throw new Error(`Existing Baseer payroll ${run.runNumber} differs from the immutable Noorix source.`);
        receipts.push({ run, payrollRunId: existingRun.id, paymentId: existingRun.payments[0].id, replayed: true });
        continue;
      }
      const payrollRunId = randomUUID();
      // Advances already have source-backed settlement journals in Baseer.
      // Therefore the accrual expense excludes the *applied* advance amount,
      // while the payroll run itself retains the original deduction detail.
      const accrualExpense = fixed(Number(run.gross) - Number(run.appliedAdvances));
      const accrualLines = [{ accountId: accountByKey.get('PAYROLL_EXPENSE'), debitAmount: accrualExpense, description: run.runNumber }];
      if (Number(run.deductions) > 0) accrualLines.push({ accountId: accountByKey.get('EMPLOYEE_ADMIN_DEDUCTION_RECOVERY'), creditAmount: run.deductions, description: `${run.runNumber} administrative deductions` });
      accrualLines.push({ accountId: accountByKey.get('PAYROLL_PAYABLE'), creditAmount: run.net, description: `${run.runNumber} net payable` });
      const accrual = await journals.postInTransaction(tx, { tenantId, companyId, actorUserId, requestId: `nurix-paid-payroll-accrual:${run.sourceId}`, sourceType: 'nurix_historical_paid_payroll_accrual', sourceReference: run.sourceId, businessDate: date(run.businessDate, 'invoice.businessDate'), description: `ترحيل مسير رواتب نوركس: ${run.runNumber}`, lines: accrualLines });
      await tx.hrPayrollRun.create({ data: { id: payrollRunId, tenantId, companyId, runNumber: run.runNumber, payrollMonth: date(run.payrollMonth, 'payrollMonth'), businessDate: date(run.businessDate, 'businessDate'), status: 'PAID', employeeCount: run.items.length, grossAmount: run.gross, advanceSettlementAmount: run.appliedAdvances, administrativeDeductionAmount: run.deductions, netPayableAmount: run.net, paidAmount: run.net, notes: `${run.kind === 'MONTHLY' ? 'مسير شهري' : 'صرف راتب مستقل'} مُرحّل من نوركس. فاتورة المصدر: ${run.invoice.number}. سلف الرواتب كانت مسددة مسبقاً بقيود مصدر مستقلة؛ حُفظت كاستقطاع دون إعادة تسويتها.`.slice(0, 1900), accrualJournalEntryId: accrual.journalEntryId, approvedAt: new Date(), createdByUserId: actorUserId } });
      const lineRows = run.items.map((item) => {
        const employee = employeeBySource.get(item.employeeSourceId);
        return { id: randomUUID(), sourceId: item.sourceId, employeeId: employee.id, employeeNumberSnapshot: employee.employeeNumber, employeeNameArSnapshot: employee.nameAr, employeeNameEnSnapshot: employee.nameEn, grossSalary: item.gross, basicSalary: item.basic, foodAllowance: '0.0000', housingAllowance: '0.0000', transportAllowance: '0.0000', otherAllowance: item.allowances, overtimeAmount: '0.0000', overtimeHours: '0.0000', advanceSettlementAmount: item.appliedAdvance, administrativeDeductionAmount: item.deductions, netPayableAmount: item.net, paidAmount: item.net };
      });
      await tx.hrPayrollLine.createMany({ data: lineRows.map((row) => ({ id: row.id, tenantId, companyId, payrollRunId, employeeId: row.employeeId, employeeNumberSnapshot: row.employeeNumberSnapshot, employeeNameArSnapshot: row.employeeNameArSnapshot, employeeNameEnSnapshot: row.employeeNameEnSnapshot, grossSalary: row.grossSalary, basicSalary: row.basicSalary, foodAllowance: row.foodAllowance, housingAllowance: row.housingAllowance, transportAllowance: row.transportAllowance, otherAllowance: row.otherAllowance, overtimeAmount: row.overtimeAmount, overtimeHours: row.overtimeHours, advanceSettlementAmount: row.advanceSettlementAmount, administrativeDeductionAmount: row.administrativeDeductionAmount, netPayableAmount: row.netPayableAmount, paidAmount: row.paidAmount })) });
      const allocations = run.ledgers.map((ledger) => {
        const vault = vaultById.get(vaultBySource.get(ledger.vaultSourceId));
        if (!vault) throw new Error(`Mapped vault missing for ${run.runNumber}.`);
        return { ...ledger, vault };
      });
      const paymentNumber = `NXR-${run.invoice.number}`.slice(0, 80);
      const payment = await journals.postInTransaction(tx, { tenantId, companyId, actorUserId, requestId: `nurix-paid-payroll-payment:${run.invoice.sourceId}`, sourceType: 'nurix_historical_paid_payroll_payment', sourceReference: run.invoice.sourceId, businessDate: date(run.businessDate, 'payment.businessDate'), description: `سداد مسير رواتب نوركس: ${run.invoice.number}`, lines: [{ accountId: accountByKey.get('PAYROLL_PAYABLE'), debitAmount: run.net, description: paymentNumber }, ...allocations.map((allocation) => ({ accountId: allocation.vault.accountId, creditAmount: allocation.amount, description: paymentNumber }))] });
      const paymentId = randomUUID();
      await tx.hrPayrollPayment.create({ data: { id: paymentId, tenantId, companyId, payrollRunId, paymentNumber, businessDate: date(run.businessDate, 'payment.businessDate'), amount: run.net, journalEntryId: payment.journalEntryId, createdByUserId: actorUserId } });
      const allocationRows = allocations.map((allocation) => ({ id: randomUUID(), ledger: allocation, vaultId: allocation.vault.id, paymentMethod: allocation.vault.paymentMethod, amount: allocation.amount }));
      await tx.hrPayrollPaymentAllocation.createMany({ data: allocationRows.map((row) => ({ id: row.id, tenantId, companyId, payrollPaymentId: paymentId, vaultId: row.vaultId, paymentMethod: row.paymentMethod, amount: row.amount })) });
      await Promise.all(lineRows.map((line) => tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId, companyId, employeeId: line.employeeId, journalEntryId: payment.journalEntryId, movementType: 'PAYROLL_PAYMENT', businessDate: date(run.businessDate, 'payment.businessDate'), amount: line.netPayableAmount, sourceReference: paymentNumber, description: `سداد راتب نوركس ${run.runNumber}` } })));
      await cashEvents.recordInTransaction(tx, { tenantId, companyId, actorUserId }, { kind: 'OPERATING_EXPENSE_PAYMENT', direction: 'OUTFLOW', businessDate: date(run.businessDate, 'payment.businessDate'), grossAmount: run.net, netAmount: run.net, vatAmount: '0.0000', sourceType: 'nurix_historical_paid_payroll_payment', sourceId: paymentId, sourceJournalEntryId: payment.journalEntryId, ledgerRevision: payment.ledgerRevision, category: { code: 'PAYROLL', nameAr: 'الرواتب المدفوعة', nameEn: 'Paid payroll', kind: 'EXPENSE' }, destinations: allocationRows.map((row) => ({ vaultId: row.vaultId, amount: row.amount, paymentMethod: row.paymentMethod })) });
      const maps = [
        { sourceEntity: 'PayrollFinancialRun', sourceId: run.sourceId, checksum: run.checksum, targetEntity: 'HrPayrollRun', targetId: payrollRunId },
        { sourceEntity: 'PayrollInvoiceFinancial', sourceId: run.invoice.sourceId, checksum: sha(run.invoice), targetEntity: 'HrPayrollPayment', targetId: paymentId },
        ...lineRows.map((row) => ({ sourceEntity: 'PayrollFinancialItem', sourceId: row.sourceId, checksum: sha(run.items.find((item) => item.sourceId === row.sourceId)), targetEntity: 'HrPayrollLine', targetId: row.id })),
        ...allocationRows.map((row) => ({ sourceEntity: 'PayrollFinancialLedger', sourceId: row.ledger.sourceId, checksum: sha(row.ledger), targetEntity: 'HrPayrollPaymentAllocation', targetId: row.id })),
      ];
      for (const map of maps) await tx.nurixExcelFinancialSourceMap.upsert({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: map.sourceEntity, sourceId: map.sourceId } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: map.sourceEntity, sourceId: map.sourceId, sourceChecksum: map.checksum, targetEntity: map.targetEntity, targetId: map.targetId, state: 'APPLIED' }, update: { sourceChecksum: map.checksum, targetEntity: map.targetEntity, targetId: map.targetId, state: 'APPLIED' } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.historical_paid_payroll.posted', entityType: 'HrPayrollRun', entityId: payrollRunId, requestId: `nurix-paid-payroll:${run.sourceId}`, afterJson: { sourceRunId: run.sourceId, sourceInvoiceId: run.invoice.sourceId, sourceInvoiceNumber: run.invoice.number, sourceChecksum: run.checksum, gross: run.gross, deductions: run.deductions, appliedAdvances: run.appliedAdvances, net: run.net, paymentAllocations: allocations.map((row) => ({ sourceLedgerId: row.sourceId, sourceVaultId: row.vaultSourceId, amount: row.amount })) } } });
      receipts.push({ run, payrollRunId, paymentId, replayed: false });
    }
    await tx.nurixExcelFinancialItem.createMany({ skipDuplicates: true, data: receipts.map(({ run, payrollRunId }) => ({ id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sourceSheet: 'NoorixPaidPayroll', sourceEntity: 'PayrollFinancialRun', sourceId: run.sourceId, sourceChecksum: run.checksum, operationKey: sha({ transformVersion, sourceId: run.sourceId, checksum: run.checksum }), status: 'POSTED', targetEntity: 'HrPayrollRun', targetId: payrollRunId, resultCode: 'POSTED_PAID_WITH_SOURCE_VAULT_ALLOCATION' })) });
    const totals = { runs: receipts.length, monthlyRuns: receipts.filter(({ run }) => run.kind === 'MONTHLY').length, standaloneSalaryPayments: receipts.filter(({ run }) => run.kind === 'STANDALONE').length, payrollLines: runs.reduce((sum, run) => sum + run.items.length, 0), gross: fixed(runs.reduce((sum, run) => sum + Number(run.gross), 0)), appliedAdvances: fixed(runs.reduce((sum, run) => sum + Number(run.appliedAdvances), 0)), deductions: fixed(runs.reduce((sum, run) => sum + Number(run.deductions), 0)), paid: sourceNet, sourceLedgers: runs.reduce((sum, run) => sum + run.ledgers.length, 0) };
    await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: 'COMMITTED', postedItems: receipts.length, failedItems: 0, committedAt: new Date(), reconciliationHash: sha(totals) } });
    await tx.nurixExcelFinancialReceipt.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sequence: 1, kind: 'RECONCILIATION', receiptSha256: sha(totals), summaryJson: totals, createdByUserId: actorUserId }, update: { waveId: wave.id, receiptSha256: sha(totals), summaryJson: totals } });
    await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', waveSequence: 1, leaseToken: null, leaseExpiresAt: null, reason: null } });
    return { executionId: execution.id, replayed: false, ...totals };
  });
  console.log(JSON.stringify({ status: 'COMPLETED', ...outcome }, null, 2));
} finally {
  await app.close();
}
