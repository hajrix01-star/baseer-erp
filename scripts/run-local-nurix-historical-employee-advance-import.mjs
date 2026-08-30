import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { Client } from 'pg';
import { NestFactory } from '@nestjs/core';

// Historical advance writer. It is intentionally separate from the operating
// payroll writer: every settlement below is backed by Noorix's own posted
// advance_settlement ledger entry (EXP-004 -> ADV-001), not a fabricated
// payroll run or a cash receipt.
const VERSION = 'nurix-historical-employee-advance/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_ARZ_HISTORICAL_ADVANCES_V1';
const SOURCE_COMPANY_ID = 'cmnf604ka009ay8lm556wgd9c';
const ACTIVE_ADVANCE_COUNT = 34;
const CANCELLED_ADVANCE_COUNT = 1;
const SETTLEMENT_COUNT = 25;
const VAULTS = new Map([
  ['cmnf604kz00a4y8lm5gvqxsho', { accountCode: 'V-001', paymentMethod: 'CASH' }],
  ['cmnf604l100a6y8lm6h3y6ocx', { accountCode: 'V-002', paymentMethod: 'BANK_TRANSFER' }],
  ['cmnw3fmrg000410l28jrx8z6n', { accountCode: 'NURIX-V-003', paymentMethod: 'CASH' }],
]);
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const day = (value) => `${value}T00:00:00.000Z`;
const key = (entity, sourceId) => sha({ version: VERSION, entity, sourceId });
const money = (value) => {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,4}))?$/.exec(String(value));
  if (!match) throw new Error(`Invalid Noorix amount: ${value}`);
  return BigInt(match[1]) * 10000n + BigInt((match[2] ?? '').padEnd(4, '0'));
};
const fixedUnits = (unit) => {
  if (unit < 0n) throw new Error('Noorix historical advance amount cannot be negative.');
  const whole = unit / 10000n; const fraction = (unit % 10000n).toString().padStart(4, '0');
  return `${whole}.${fraction}`;
};
const fixed = (value) => fixedUnits(money(value));

const [packageId, tenantId, companyId, actorUserId, sourceDatabaseUrl, mode] = process.argv.slice(2);
if (!packageId || !tenantId || !companyId || !actorUserId || !sourceDatabaseUrl || !['DRY_RUN', APPROVAL].includes(mode) || ![packageId, tenantId, companyId, actorUserId].every((value) => /^[0-9a-f-]{36}$/i.test(value))) {
  throw new Error(`Usage: node scripts/run-local-nurix-historical-employee-advance-import.mjs <package-uuid> <tenant-uuid> <ARZ-company-uuid> <owner-user-uuid> <noorix-readonly-db-url> DRY_RUN|${APPROVAL}`);
}
const sourceUrl = new URL(sourceDatabaseUrl);
if (sourceUrl.hostname !== '127.0.0.1' || sourceUrl.port !== '5433' || sourceUrl.pathname !== '/noorix_inspect') throw new Error('Refusing a Noorix source other than the local read-only noorix_inspect snapshot.');
const sourceTenantId = process.env.NURIX_SOURCE_TENANT_ID?.trim();
if (!sourceTenantId || !/^[A-Za-z0-9_-]{8,160}$/.test(sourceTenantId)) throw new Error('NURIX_SOURCE_TENANT_ID must identify the scoped Noorix tenant before reading the snapshot.');
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') throw new Error('Refusing historical-advance import outside the canonical local Baseer test database.');

const source = new Client({
  connectionString: sourceDatabaseUrl,
  // The reader has SELECT-only permissions and is explicitly constrained to
  // the Noorix tenant. This avoids broad source access or any RLS bypass.
  options: `-c default_transaction_read_only=on -c app.tenant_id=${sourceTenantId}`,
});
await source.connect();
try {
  const invoicesQuery = await source.query(`
    SELECT i.id, i.invoice_number, i.employee_id, i.vault_id, i.total_amount::text AS total_amount,
      i.transaction_date::date::text AS transaction_date, i.status,
      l.id AS issue_ledger_id, l.reference_type AS issue_reference_type, l.debit_account_id AS issue_debit_account_id,
      l.credit_account_id AS issue_credit_account_id, l.amount::text AS issue_amount, l.vault_id AS issue_vault_id,
      l.status AS issue_status, l.transaction_date::date::text AS issue_transaction_date,
      debit.code AS issue_debit_code, credit.code AS issue_credit_code
    FROM invoices i
    LEFT JOIN ledger_entries l ON l.company_id = i.company_id AND l.reference_id = i.id
    LEFT JOIN accounts debit ON debit.id = l.debit_account_id AND debit.company_id = i.company_id
    LEFT JOIN accounts credit ON credit.id = l.credit_account_id AND credit.company_id = i.company_id
    WHERE i.company_id = $1 AND i.kind = 'advance'
    ORDER BY i.transaction_date, i.id, l.id`, [SOURCE_COMPANY_ID]);
  const byInvoice = new Map();
  for (const row of invoicesQuery.rows) {
    const item = byInvoice.get(row.id) ?? { id: row.id, number: row.invoice_number, employeeSourceId: row.employee_id, vaultSourceId: row.vault_id, amount: row.total_amount, businessDate: row.transaction_date, status: row.status, issueLedgers: [] };
    if (row.issue_ledger_id) item.issueLedgers.push({ id: row.issue_ledger_id, referenceType: row.issue_reference_type, debitCode: row.issue_debit_code, creditCode: row.issue_credit_code, amount: row.issue_amount, vaultSourceId: row.issue_vault_id, status: row.issue_status, businessDate: row.issue_transaction_date });
    byInvoice.set(row.id, item);
  }
  const active = [...byInvoice.values()].filter((item) => item.status === 'active');
  const cancelled = [...byInvoice.values()].filter((item) => item.status === 'cancelled');
  if (active.length !== ACTIVE_ADVANCE_COUNT || cancelled.length !== CANCELLED_ADVANCE_COUNT || active.length + cancelled.length !== byInvoice.size) throw new Error('The frozen Noorix advance source set is not exactly 34 active and one cancelled invoice.');
  for (const item of active) {
    if (!item.number || !item.employeeSourceId || !item.vaultSourceId || !VAULTS.has(item.vaultSourceId) || !item.businessDate || money(item.amount) <= 0n || item.issueLedgers.length !== 1) throw new Error(`Advance ${item.id} has incomplete issue evidence.`);
    const ledger = item.issueLedgers[0];
    if (ledger.status !== 'active' || ledger.referenceType !== 'advance' || ledger.debitCode !== 'ADV-001' || !['V-001', 'V-002', 'V-003'].includes(ledger.creditCode) || ledger.vaultSourceId !== item.vaultSourceId || ledger.businessDate !== item.businessDate || money(ledger.amount) !== money(item.amount)) throw new Error(`Advance ${item.number} issue ledger is not the exact active ADV-001 -> vault proof.`);
  }

  const activeIds = active.map((item) => item.id);
  const settlementsQuery = await source.query(`
    SELECT d.id, d.reference_id AS advance_invoice_id, d.employee_id, d.amount::text AS amount,
      d.transaction_date::date::text AS business_date,
      l.id AS ledger_id, l.reference_type, l.debit_account_id, l.credit_account_id,
      l.amount::text AS ledger_amount, l.status AS ledger_status, l.transaction_date::date::text AS ledger_business_date,
      debit.code AS debit_code, credit.code AS credit_code
    FROM employee_deductions d
    LEFT JOIN ledger_entries l ON l.company_id = d.company_id AND l.reference_id = d.id
    LEFT JOIN accounts debit ON debit.id = l.debit_account_id AND debit.company_id = d.company_id
    LEFT JOIN accounts credit ON credit.id = l.credit_account_id AND credit.company_id = d.company_id
    WHERE d.company_id = $1 AND d.deduction_type = 'advance' AND d.reference_id = ANY($2::text[])
    ORDER BY d.transaction_date, d.id, l.id`, [SOURCE_COMPANY_ID, activeIds]);
  const settlementsById = new Map();
  for (const row of settlementsQuery.rows) {
    const item = settlementsById.get(row.id) ?? { id: row.id, advanceSourceId: row.advance_invoice_id, employeeSourceId: row.employee_id, amount: row.amount, businessDate: row.business_date, ledgers: [] };
    if (row.ledger_id) item.ledgers.push({ id: row.ledger_id, referenceType: row.reference_type, debitCode: row.debit_code, creditCode: row.credit_code, amount: row.ledger_amount, status: row.ledger_status, businessDate: row.ledger_business_date });
    settlementsById.set(row.id, item);
  }
  const settlements = [...settlementsById.values()];
  if (settlements.length !== SETTLEMENT_COUNT) throw new Error(`The frozen Noorix source must contain exactly ${SETTLEMENT_COUNT} invoice-linked advance deductions.`);
  const activeById = new Map(active.map((item) => [item.id, item]));
  for (const item of settlements) {
    const advance = activeById.get(item.advanceSourceId);
    if (!advance || item.employeeSourceId !== advance.employeeSourceId || !item.businessDate || money(item.amount) <= 0n || item.ledgers.length !== 1) throw new Error(`Advance settlement ${item.id} is incomplete or belongs to a different employee.`);
    const ledger = item.ledgers[0];
    if (ledger.status !== 'active' || ledger.referenceType !== 'advance_settlement' || ledger.debitCode !== 'EXP-004' || ledger.creditCode !== 'ADV-001' || ledger.businessDate !== item.businessDate || money(ledger.amount) !== money(item.amount)) throw new Error(`Advance settlement ${item.id} lacks an exact active EXP-004 -> ADV-001 source ledger.`);
  }
  const settledByAdvance = new Map();
  for (const item of settlements) settledByAdvance.set(item.advanceSourceId, (settledByAdvance.get(item.advanceSourceId) ?? 0n) + money(item.amount));
  for (const invoice of active) if ((settledByAdvance.get(invoice.id) ?? 0n) > money(invoice.amount)) throw new Error(`Advance ${invoice.number} settlements exceed its issued amount.`);

  process.chdir(resolve('apps/api'));
  const { AppModule } = await import('../apps/api/dist/app.module.js');
  const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
  const { JournalPostingService } = await import('../apps/api/dist/finance/journal/journal-posting.service.js');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const database = app.get(DatabaseService);
    const journals = app.get(JournalPostingService);
    const employeeSourceIds = [...new Set(active.map((item) => item.employeeSourceId))];
    const target = await database.inTenantTransaction(tenantId, async (tx) => {
      const packageRow = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, status: 'READY_FOR_RECONCILIATION' }, select: { id: true } });
      if (!packageRow) throw new Error('The approved package does not match ARZ and the Noorix source company.');
      const maps = await tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: employeeSourceIds }, targetId: { not: null }, status: { in: ['CREATED', 'REUSED'] }, execution: { packageId, targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } });
      const employeeIdBySource = new Map();
      for (const map of maps) {
        if (!map.targetId || employeeIdBySource.has(map.sourceId)) throw new Error(`Employee source map ${map.sourceId} is missing or ambiguous.`);
        employeeIdBySource.set(map.sourceId, map.targetId);
      }
      if (employeeIdBySource.size !== employeeSourceIds.length) throw new Error('Every active Noorix advance employee must have one completed Baseer employee map.');
      const employees = await tx.hrEmployee.findMany({ where: { tenantId, companyId, id: { in: [...employeeIdBySource.values()] } }, select: { id: true } });
      if (employees.length !== employeeIdBySource.size) throw new Error('An employee source map points outside ARZ.');
      const accounts = await tx.financeAccount.findMany({ where: { tenantId, companyId, systemKey: { in: ['EMPLOYEE_ADVANCES', 'PAYROLL_EXPENSE'] }, status: 'ACTIVE' }, select: { id: true, systemKey: true } });
      const accountByKey = new Map(accounts.map((account) => [account.systemKey, account.id]));
      if (!accountByKey.get('EMPLOYEE_ADVANCES') || !accountByKey.get('PAYROLL_EXPENSE')) throw new Error('ARZ lacks the approved EMPLOYEE_ADVANCES or PAYROLL_EXPENSE account map.');
      const vaults = await tx.financeVault.findMany({ where: { tenantId, companyId, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, paymentMethod: true, paymentMethods: true, account: { select: { code: true } } } });
      const vaultIdBySource = new Map();
      for (const [sourceId, expected] of VAULTS) {
        const vault = vaults.find((candidate) => candidate.account.code === expected.accountCode && candidate.paymentMethods.includes(expected.paymentMethod));
        if (!vault) throw new Error(`ARZ vault map ${sourceId} -> ${expected.accountCode} is unavailable or unsafe.`);
        vaultIdBySource.set(sourceId, { id: vault.id, paymentMethod: expected.paymentMethod });
      }
      return { employeeIdBySource, accountByKey, vaultIdBySource };
    });

    const plan = {
      version: VERSION, packageId, sourceCompanyId: SOURCE_COMPANY_ID,
      active: active.map((item) => ({ ...item, sourceChecksum: sha({ invoice: item, settlements: settlements.filter((settlement) => settlement.advanceSourceId === item.id) }) })),
      cancelled: cancelled.map((item) => ({ sourceId: item.id, sourceChecksum: sha({ invoice: item }), number: item.number })),
      settlements: settlements.map((item) => ({ ...item, sourceChecksum: sha(item) })),
    };
    const planChecksum = sha({ version: VERSION, active: plan.active.map((item) => [item.id, item.sourceChecksum]), cancelled: plan.cancelled.map((item) => [item.sourceId, item.sourceChecksum]), settlements: plan.settlements.map((item) => [item.id, item.sourceChecksum]) });
    const totalIssued = plan.active.reduce((total, item) => total + money(item.amount), 0n);
    const totalSettled = plan.settlements.reduce((total, item) => total + money(item.amount), 0n);
    const dryRun = {
      status: 'PARSED_DRY_RUN', version: VERSION, planChecksum, activeAdvances: plan.active.length, cancelledEvidenceOnly: plan.cancelled.length, linkedSettlements: plan.settlements.length,
      issueLedgers: plan.active.length, settlementLedgers: plan.settlements.length, employeeMaps: target.employeeIdBySource.size, vaultMaps: target.vaultIdBySource.size,
      totalIssued: fixedUnits(totalIssued), totalSettled: fixedUnits(totalSettled), remaining: fixedUnits(totalIssued - totalSettled),
      financialWrites: 0,
    };
    console.log(JSON.stringify(dryRun, null, 2));
    if (mode === 'DRY_RUN') {
      // Dry run ends here. It has read only the source and ARZ mappings.
    } else {

    // APPLY is intentionally present but never invoked by this task. Each
    // record has its own immutable source checksum, journal source reference,
    // and source-map row so an interruption resumes without duplicate facts.
    const context = { tenantId, companyId, actorUserId };
    const execution = await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findFirst({ where: { packageId, tenantId, transformVersion: VERSION }, select: { id: true, financialPlanSha256: true, status: true } });
      if (existing) { if (existing.financialPlanSha256 !== planChecksum) throw new Error('The stored historical-advance source plan differs from this immutable snapshot.'); return existing; }
      const id = randomUUID(), waveId = randomUUID();
      await tx.nurixExcelFinancialExecution.create({ data: { id, packageId, tenantId, targetCompanyId: companyId, transformVersion: VERSION, financialPlanSha256: planChecksum, status: 'APPROVED', reason: 'Owner-authorized Noorix historical employee advances with source-backed settlement journals.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date() } });
      await tx.nurixExcelFinancialWave.create({ data: { id: waveId, executionId: id, tenantId, targetCompanyId: companyId, sequence: 1, plannedItems: plan.active.length + plan.cancelled.length + plan.settlements.length } });
      await tx.nurixExcelFinancialItem.createMany({ data: [
        ...plan.active.map((item) => ({ id: randomUUID(), executionId: id, waveId, tenantId, targetCompanyId: companyId, sourceSheet: 'Invoices', sourceEntity: 'NoorixAdvanceInvoice', sourceId: item.id, sourceChecksum: item.sourceChecksum, operationKey: key('advance-issue', item.id), status: 'PENDING' })),
        ...plan.cancelled.map((item) => ({ id: randomUUID(), executionId: id, waveId, tenantId, targetCompanyId: companyId, sourceSheet: 'Invoices', sourceEntity: 'NoorixAdvanceInvoice', sourceId: item.sourceId, sourceChecksum: item.sourceChecksum, operationKey: key('advance-cancelled', item.sourceId), status: 'PENDING' })),
        ...plan.settlements.map((item) => ({ id: randomUUID(), executionId: id, waveId, tenantId, targetCompanyId: companyId, sourceSheet: 'EmployeeDeductions', sourceEntity: 'NoorixAdvanceSettlement', sourceId: item.id, sourceChecksum: item.sourceChecksum, operationKey: key('advance-settlement', item.id), status: 'PENDING' })),
      ] });
      return { id, financialPlanSha256: planChecksum, status: 'APPROVED' };
    });
    if (execution.status === 'COMPLETED') process.exitCode = 0;
    else {
      const issueBySource = new Map(plan.active.map((item) => [item.id, item]));
      const settlementBySource = new Map(plan.settlements.map((item) => [item.id, item]));
      const pending = await database.inTenantTransaction(tenantId, (tx) => tx.nurixExcelFinancialItem.findMany({ where: { executionId: execution.id, tenantId, status: 'PENDING' }, orderBy: { sourceId: 'asc' }, select: { id: true, sourceEntity: true, sourceId: true } }));
      // Issuance must be committed before any source deduction can settle it;
      // never rely on lexical source IDs for this dependency.
      const ordered = [...pending.filter((item) => item.sourceEntity === 'NoorixAdvanceInvoice'), ...pending.filter((item) => item.sourceEntity === 'NoorixAdvanceSettlement')];
      for (const item of ordered) {
        if (item.sourceEntity === 'NoorixAdvanceInvoice') {
          const invoice = issueBySource.get(item.sourceId);
          if (!invoice) {
            const cancelledItem = plan.cancelled.find((value) => value.sourceId === item.sourceId); if (!cancelledItem) throw new Error('A planned advance invoice source is unavailable.');
            await database.inTenantTransaction(tenantId, (tx) => Promise.all([
              tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: item.sourceEntity, sourceId: item.sourceId, sourceChecksum: cancelledItem.sourceChecksum, targetEntity: 'NoorixCancelledAdvanceEvidence', targetId: item.sourceId, state: 'APPLIED' } }),
              tx.nurixExcelFinancialItem.update({ where: { id: item.id }, data: { status: 'EXCLUDED', targetEntity: 'NoorixCancelledAdvanceEvidence', targetId: item.sourceId, resultCode: 'SOURCE_CANCELLED_EVIDENCE_ONLY' } }),
            ]));
            continue;
          }
          await database.inTenantTransaction(tenantId, async (tx) => {
            const existing = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId: execution.id, sourceEntity: item.sourceEntity, sourceId: invoice.id }, select: { targetId: true, sourceChecksum: true } });
            if (existing) { if (existing.sourceChecksum !== invoice.sourceChecksum) throw new Error('Existing advance source map checksum differs.'); await tx.nurixExcelFinancialItem.update({ where: { id: item.id }, data: { status: 'REUSED', targetEntity: 'HrEmployeeAdvance', targetId: existing.targetId, resultCode: 'IDEMPOTENT_REUSE' } }); return; }
            const vault = target.vaultIdBySource.get(invoice.vaultSourceId); if (!vault) throw new Error('Mapped source vault is unavailable.');
            const issueJournal = await journals.postInTransaction(tx, { ...context, requestId: `nurix-adv-issue:${key('advance-issue', invoice.id)}`, sourceType: 'nurix_historical_employee_advance_issue', sourceReference: invoice.id, businessDate: new Date(day(invoice.businessDate)), description: `Noorix historical employee advance ${invoice.number}`, lines: [{ accountId: target.accountByKey.get('EMPLOYEE_ADVANCES'), debitAmount: fixed(invoice.amount), description: invoice.number }, { accountId: (await tx.financeVault.findFirstOrThrow({ where: { id: vault.id, tenantId, companyId }, select: { accountId: true } })).accountId, creditAmount: fixed(invoice.amount), description: invoice.number }] });
            const advanceId = randomUUID();
            await tx.hrEmployeeAdvance.create({ data: { id: advanceId, tenantId, companyId, employeeId: target.employeeIdBySource.get(invoice.employeeSourceId), advanceNumber: invoice.number, businessDate: new Date(day(invoice.businessDate)), originalAmount: fixed(invoice.amount), remainingAmount: fixed(invoice.amount), notes: `مستورد تاريخياً من نوركس؛ invoice=${invoice.id}; issueLedger=${invoice.issueLedgers[0].id}.`, issueJournalEntryId: issueJournal.journalEntryId, createdByUserId: actorUserId } });
            await tx.hrEmployeeAdvancePayoutAllocation.create({ data: { id: randomUUID(), tenantId, companyId, advanceId, vaultId: vault.id, amount: fixed(invoice.amount), paymentMethod: vault.paymentMethod } });
            await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId, companyId, employeeId: target.employeeIdBySource.get(invoice.employeeSourceId), journalEntryId: issueJournal.journalEntryId, movementType: 'ADVANCE_ISSUED', businessDate: new Date(day(invoice.businessDate)), amount: fixed(invoice.amount), sourceReference: invoice.number, description: `Noorix historical advance ${invoice.id}` } });
            await tx.nurixExcelFinancialSourceMap.createMany({ data: [
              { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixAdvanceInvoice', sourceId: invoice.id, sourceChecksum: invoice.sourceChecksum, targetEntity: 'HrEmployeeAdvance', targetId: advanceId, state: 'APPLIED' },
              { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixAdvanceIssueLedger', sourceId: invoice.issueLedgers[0].id, sourceChecksum: sha(invoice.issueLedgers[0]), targetEntity: 'FinanceJournalEntry', targetId: issueJournal.journalEntryId, state: 'APPLIED' },
            ] });
            await tx.nurixExcelFinancialItem.update({ where: { id: item.id }, data: { status: 'POSTED', targetEntity: 'HrEmployeeAdvance', targetId: advanceId, resultCode: 'POSTED_HISTORICAL_ADVANCE' } });
          });
        } else if (item.sourceEntity === 'NoorixAdvanceSettlement') {
          const settlement = settlementBySource.get(item.sourceId); if (!settlement) throw new Error('A planned advance settlement source is unavailable.');
          await database.inTenantTransaction(tenantId, async (tx) => {
            const existing = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId: execution.id, sourceEntity: item.sourceEntity, sourceId: settlement.id }, select: { targetId: true, sourceChecksum: true } });
            if (existing) { if (existing.sourceChecksum !== settlement.sourceChecksum) throw new Error('Existing settlement source map checksum differs.'); await tx.nurixExcelFinancialItem.update({ where: { id: item.id }, data: { status: 'REUSED', targetEntity: 'HrEmployeeAdvanceSettlement', targetId: existing.targetId, resultCode: 'IDEMPOTENT_REUSE' } }); return; }
            const advanceMap = await tx.nurixExcelFinancialSourceMap.findFirstOrThrow({ where: { executionId: execution.id, sourceEntity: 'NoorixAdvanceInvoice', sourceId: settlement.advanceSourceId, state: 'APPLIED' }, select: { targetId: true } });
            const advance = await tx.hrEmployeeAdvance.findFirstOrThrow({ where: { id: advanceMap.targetId, tenantId, companyId }, select: { id: true, employeeId: true, settledAmount: true, remainingAmount: true, businessDate: true } });
            if (advance.employeeId !== target.employeeIdBySource.get(settlement.employeeSourceId) || new Date(day(settlement.businessDate)) < advance.businessDate || money(settlement.amount) > money(advance.remainingAmount.toFixed(4))) throw new Error(`Settlement ${settlement.id} cannot be applied to the mapped advance safely.`);
            const settlementJournal = await journals.postInTransaction(tx, { ...context, requestId: `nurix-adv-settle:${key('advance-settlement', settlement.id)}`, sourceType: 'nurix_historical_employee_advance_settlement', sourceReference: settlement.id, businessDate: new Date(day(settlement.businessDate)), description: `Noorix historical advance settlement ${settlement.id}`, lines: [{ accountId: target.accountByKey.get('PAYROLL_EXPENSE'), debitAmount: fixed(settlement.amount), description: settlement.id }, { accountId: target.accountByKey.get('EMPLOYEE_ADVANCES'), creditAmount: fixed(settlement.amount), description: settlement.id }] });
            const settled = fixedUnits(money(advance.settledAmount.toFixed(4)) + money(settlement.amount));
            const remaining = fixedUnits(money(advance.remainingAmount.toFixed(4)) - money(settlement.amount));
            const settlementId = randomUUID();
            await tx.hrEmployeeAdvance.update({ where: { id: advance.id }, data: { settledAmount: settled, remainingAmount: remaining, status: money(remaining) === 0n ? 'SETTLED' : 'PARTIALLY_SETTLED' } });
            await tx.hrEmployeeAdvanceSettlement.create({ data: { id: settlementId, tenantId, companyId, advanceId: advance.id, source: 'PAYROLL', businessDate: new Date(day(settlement.businessDate)), amount: fixed(settlement.amount), journalEntryId: settlementJournal.journalEntryId } });
            await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId, companyId, employeeId: advance.employeeId, journalEntryId: settlementJournal.journalEntryId, movementType: 'ADVANCE_SETTLEMENT', businessDate: new Date(day(settlement.businessDate)), amount: fixed(settlement.amount), sourceReference: settlement.id, description: 'Noorix historical advance settlement backed by source ledger' } });
            await tx.nurixExcelFinancialSourceMap.createMany({ data: [
              { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixAdvanceSettlement', sourceId: settlement.id, sourceChecksum: settlement.sourceChecksum, targetEntity: 'HrEmployeeAdvanceSettlement', targetId: settlementId, state: 'APPLIED' },
              { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixAdvanceSettlementLedger', sourceId: settlement.ledgers[0].id, sourceChecksum: sha(settlement.ledgers[0]), targetEntity: 'FinanceJournalEntry', targetId: settlementJournal.journalEntryId, state: 'APPLIED' },
            ] });
            await tx.nurixExcelFinancialItem.update({ where: { id: item.id }, data: { status: 'POSTED', targetEntity: 'HrEmployeeAdvanceSettlement', targetId: settlementId, resultCode: 'POSTED_HISTORICAL_ADVANCE_SETTLEMENT' } });
          });
        }
      }
      await database.inTenantTransaction(tenantId, async (tx) => {
        const wave = await tx.nurixExcelFinancialWave.findFirstOrThrow({ where: { executionId: execution.id, sequence: 1 }, select: { id: true } });
        const unresolved = await tx.nurixExcelFinancialItem.count({ where: { executionId: execution.id, status: 'PENDING' } }); if (unresolved) throw new Error('Historical advance wave did not reconcile fully.');
        const receipt = { version: VERSION, planChecksum, advances: plan.active.length, cancelledEvidenceOnly: plan.cancelled.length, settlements: plan.settlements.length, issued: fixedUnits(totalIssued), settled: fixedUnits(totalSettled) };
        await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: 'COMMITTED', postedItems: plan.active.length + plan.settlements.length, reviewItems: plan.cancelled.length, committedAt: new Date(), reconciliationHash: sha(receipt) } });
        await tx.nurixExcelFinancialReceipt.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sequence: 1, kind: 'RECONCILIATION', receiptSha256: sha(receipt), summaryJson: receipt, createdByUserId: actorUserId }, update: { receiptSha256: sha(receipt), summaryJson: receipt } });
        await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', waveSequence: 1, reason: null } });
      });
      console.log(JSON.stringify({ status: 'COMPLETED', executionId: execution.id, ...dryRun, financialWrites: plan.active.length + plan.settlements.length * 2 }, null, 2));
    }
    }
  } finally { await app.close(); }
} finally { await source.end(); }
