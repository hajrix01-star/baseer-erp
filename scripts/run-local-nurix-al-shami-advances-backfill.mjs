/**
 * Auditable historical Noorix employee-advance writer for Al-Shami.
 *
 * It posts only source-proved advance issuances.  Linked source deductions
 * become operational settlement rows; their source text is preserved exactly.
 * A missing direct Noorix ledger never causes this writer to fabricate one.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-al-shami-historical-advances/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_ADVANCES_V1';
const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixed = (value) => Number(value).toFixed(4);
const day = (value) => new Date(`${value}T00:00:00.000Z`);

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-al-shami-advances-backfill.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
}
const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') throw new Error('This writer only permits the canonical local Baseer test database.');

const sourceSql = `
WITH advances AS (
  SELECT json_build_object(
    'sourceId', i.id, 'number', i.invoice_number, 'employeeSourceId', i.employee_id,
    'vaultSourceId', i.vault_id, 'amount', i.total_amount::text,
    'businessDate', to_char(i.transaction_date::date, 'YYYY-MM-DD'), 'status', i.status,
    'notes', coalesce(i.notes, ''),
    'ledgers', coalesce((SELECT json_agg(json_build_object(
      'sourceId', l.id, 'referenceType', l.reference_type, 'status', l.status,
      'businessDate', to_char(l.transaction_date::date, 'YYYY-MM-DD'),
      'amount', l.amount::text, 'vaultSourceId', l.vault_id,
      'debitCode', da.code, 'creditCode', ca.code
    ) ORDER BY l.id) FROM ledger_entries l
      LEFT JOIN accounts da ON da.id=l.debit_account_id
      LEFT JOIN accounts ca ON ca.id=l.credit_account_id
      WHERE l.company_id=i.company_id AND l.reference_id=i.id), '[]'::json)
  ) AS row
  FROM invoices i WHERE i.company_id='${SOURCE_COMPANY_ID}' AND i.kind='advance'
), settlements AS (
  SELECT json_build_object(
    'sourceId', d.id, 'advanceSourceId', d.reference_id, 'employeeSourceId', d.employee_id,
    'amount', d.amount::text, 'businessDate', to_char(d.transaction_date::date, 'YYYY-MM-DD'),
    'notes', coalesce(d.notes, ''),
    'ledgers', coalesce((SELECT json_agg(json_build_object(
      'sourceId', l.id, 'referenceType', l.reference_type, 'status', l.status,
      'businessDate', to_char(l.transaction_date::date, 'YYYY-MM-DD'), 'amount', l.amount::text,
      'debitCode', da.code, 'creditCode', ca.code
    ) ORDER BY l.id) FROM ledger_entries l
      LEFT JOIN accounts da ON da.id=l.debit_account_id
      LEFT JOIN accounts ca ON ca.id=l.credit_account_id
      WHERE l.company_id=d.company_id AND l.reference_id=d.id), '[]'::json)
  ) AS row
  FROM employee_deductions d
  WHERE d.company_id='${SOURCE_COMPANY_ID}' AND d.deduction_type='advance' AND d.reference_id IS NOT NULL
)
SELECT json_build_object(
  'advances', coalesce((SELECT json_agg(row ORDER BY row->>'businessDate', row->>'sourceId') FROM advances), '[]'::json),
  'settlements', coalesce((SELECT json_agg(row ORDER BY row->>'businessDate', row->>'sourceId') FROM settlements), '[]'::json)
)::text;`;
const raw = execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
if (!raw) throw new Error('No Noorix advance source was returned.');
const payload = JSON.parse(raw);
const amount = (value, label) => { const parsed = Number(value); if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid source amount ${label}.`); return fixed(parsed); };
const active = payload.advances.filter((row) => row.status === 'active');
const cancelled = payload.advances.filter((row) => row.status === 'cancelled');
const settlements = payload.settlements;
if (active.length !== 116 || cancelled.length !== 2 || active.length + cancelled.length !== payload.advances.length || settlements.length !== 98) throw new Error('The reviewed Al-Shami advance source set changed.');
for (const row of active) {
  if (!row.sourceId || !row.number || !row.employeeSourceId || !row.vaultSourceId || !row.businessDate || Number(amount(row.amount, row.sourceId)) <= 0 || row.ledgers.length !== 1) throw new Error(`Advance ${row.sourceId} is incomplete.`);
  const ledger = row.ledgers[0];
  if (ledger.status !== 'active' || ledger.referenceType !== 'advance' || ledger.debitCode !== 'ADV-001' || !ledger.creditCode?.startsWith('V-') || ledger.vaultSourceId !== row.vaultSourceId || ledger.businessDate !== row.businessDate || amount(ledger.amount, ledger.sourceId) !== amount(row.amount, row.sourceId)) throw new Error(`Advance ${row.number} lacks exact source issue evidence.`);
  row.sourceChecksum = sha(row);
}
for (const row of cancelled) row.sourceChecksum = sha(row);
for (const row of settlements) {
  if (!row.sourceId || !row.advanceSourceId || !row.employeeSourceId || !row.businessDate || Number(amount(row.amount, row.sourceId)) <= 0) throw new Error(`Advance settlement ${row.sourceId} is incomplete.`);
  row.sourceChecksum = sha(row);
}
const activeBySource = new Map(active.map((row) => [row.sourceId, row]));
const settledByAdvance = new Map();
for (const row of settlements) {
  const advance = activeBySource.get(row.advanceSourceId);
  if (!advance || advance.employeeSourceId !== row.employeeSourceId) throw new Error(`Settlement ${row.sourceId} has no same-employee active advance.`);
  settledByAdvance.set(row.advanceSourceId, Number(settledByAdvance.get(row.advanceSourceId) ?? 0) + Number(amount(row.amount, row.sourceId)));
}
for (const [advanceId, settled] of settledByAdvance) if (settled > Number(amount(activeBySource.get(advanceId).amount, advanceId))) throw new Error(`Settlements exceed advance ${advanceId}.`);
const planChecksum = sha({ version: VERSION, advances: active.map((row) => [row.sourceId, row.sourceChecksum]), settlements: settlements.map((row) => [row.sourceId, row.sourceChecksum]) });

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { JournalPostingService } = await import('../apps/api/dist/finance/journal/journal-posting.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const database = app.get(DatabaseService);
  const journals = app.get(JournalPostingService);
  const target = await database.inTenantTransaction(tenantId, async (tx) => {
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, status: 'READY_FOR_RECONCILIATION' }, select: { id: true } });
    if (!packageRow) throw new Error('The selected package is not the approved Al-Shami package.');
    const sourceEmployeeIds = [...new Set(active.map((row) => row.employeeSourceId))];
    const sourceVaultIds = [...new Set(active.map((row) => row.vaultSourceId))];
    const [maps, vaultMaps, accounts] = await Promise.all([
      tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: sourceEmployeeIds }, targetId: { not: null }, status: { in: ['CREATED', 'REUSED'] }, execution: { packageId, targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', sourceId: { in: sourceVaultIds }, targetEntity: 'FinanceVault', state: { in: ['APPLIED', 'REUSED'] } }, select: { sourceId: true, targetId: true } }),
      tx.financeAccount.findMany({ where: { tenantId, companyId, status: 'ACTIVE', systemKey: 'EMPLOYEE_ADVANCES' }, select: { id: true } }),
    ]);
    if (accounts.length !== 1) throw new Error('The approved employee-advances account is unavailable.');
    const employeeIdBySource = new Map(maps.map((row) => [row.sourceId, row.targetId]));
    const vaultIdBySource = new Map(vaultMaps.map((row) => [row.sourceId, row.targetId]));
    if (employeeIdBySource.size !== sourceEmployeeIds.length || vaultIdBySource.size !== sourceVaultIds.length) throw new Error('Employee or vault mapping is incomplete.');
    const vaults = await tx.financeVault.findMany({ where: { tenantId, companyId, id: { in: [...vaultIdBySource.values()] }, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, accountId: true, paymentMethod: true } });
    if (vaults.length !== vaultIdBySource.size) throw new Error('A mapped advance vault is not active.');
    return { employeeIdBySource, vaultIdBySource, advanceAccountId: accounts[0].id, vaultById: new Map(vaults.map((row) => [row.id, row])) };
  });
  const directSettlementLedgers = settlements.filter((row) => row.ledgers.length === 1 && row.ledgers[0].status === 'active' && row.ledgers[0].referenceType === 'advance_settlement' && row.ledgers[0].debitCode === 'EXP-004' && row.ledgers[0].creditCode === 'ADV-001' && amount(row.ledgers[0].amount, row.ledgers[0].sourceId) === amount(row.amount, row.sourceId)).length;
  const dry = { status: 'PARSED_DRY_RUN', version: VERSION, planChecksum, activeAdvances: active.length, cancelledEvidenceOnly: cancelled.length, linkedSettlements: settlements.length, issuedAmount: fixed(active.reduce((sum, row) => sum + Number(amount(row.amount, row.sourceId)), 0)), settledAmount: fixed(settlements.reduce((sum, row) => sum + Number(amount(row.amount, row.sourceId)), 0)), remainingAmount: fixed(active.reduce((sum, row) => sum + Number(amount(row.amount, row.sourceId)), 0) - settlements.reduce((sum, row) => sum + Number(amount(row.amount, row.sourceId)), 0)), directSettlementLedgers, financialWrites: 0 };
  console.log(JSON.stringify(dry, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const execution = await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: VERSION } }, select: { id: true, financialPlanSha256: true, status: true } });
      if (existing) { if (existing.financialPlanSha256 !== planChecksum) throw new Error('Existing advance execution differs from the frozen source.'); return existing; }
      return tx.nurixExcelFinancialExecution.create({ data: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion: VERSION, financialPlanSha256: planChecksum, status: 'APPROVED', reason: 'Owner-authorized Al-Shami historical advances; source notes preserved exactly.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date() }, select: { id: true, status: true } });
    });
    const advanceTargetIdBySource = new Map();
    for (const row of active) {
      const existing = await database.inTenantTransaction(tenantId, (tx) => tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId: execution.id, sourceEntity: 'NoorixAdvanceInvoice', sourceId: row.sourceId }, select: { targetId: true, sourceChecksum: true } }));
      if (existing) { if (existing.sourceChecksum !== row.sourceChecksum) throw new Error('An existing advance receipt differs from source.'); advanceTargetIdBySource.set(row.sourceId, existing.targetId); continue; }
      const advanceId = randomUUID();
      await database.inTenantTransaction(tenantId, async (tx) => {
        const vaultId = target.vaultIdBySource.get(row.vaultSourceId); const vault = target.vaultById.get(vaultId);
        if (!vault) throw new Error(`Mapped vault missing for ${row.number}.`);
        const journal = await journals.postInTransaction(tx, { tenantId, companyId, actorUserId, requestId: `nurix-al-shami-advance-issue:${row.sourceId}`, sourceType: 'nurix_al_shami_historical_advance_issue', sourceReference: row.sourceId, businessDate: day(row.businessDate), description: `سلفة تاريخية نوركس: ${row.number}`, lines: [{ accountId: target.advanceAccountId, debitAmount: amount(row.amount, row.sourceId), description: row.number }, { accountId: vault.accountId, creditAmount: amount(row.amount, row.sourceId), description: row.number }] });
        await tx.hrEmployeeAdvance.create({ data: { id: advanceId, tenantId, companyId, employeeId: target.employeeIdBySource.get(row.employeeSourceId), advanceNumber: row.number, businessDate: day(row.businessDate), originalAmount: amount(row.amount, row.sourceId), remainingAmount: amount(row.amount, row.sourceId), notes: row.notes, issueJournalEntryId: journal.journalEntryId, createdByUserId: actorUserId } });
        await tx.hrEmployeeAdvancePayoutAllocation.create({ data: { id: randomUUID(), tenantId, companyId, advanceId, vaultId, amount: amount(row.amount, row.sourceId), paymentMethod: vault.paymentMethod } });
        await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId, companyId, employeeId: target.employeeIdBySource.get(row.employeeSourceId), journalEntryId: journal.journalEntryId, movementType: 'ADVANCE_ISSUED', businessDate: day(row.businessDate), amount: amount(row.amount, row.sourceId), sourceReference: row.number, description: row.notes || `Noorix ${row.number}` } });
        await tx.nurixExcelFinancialSourceMap.createMany({ data: [{ id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixAdvanceInvoice', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeAdvance', targetId: advanceId, state: 'APPLIED' }, { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixAdvanceIssueLedger', sourceId: row.ledgers[0].sourceId, sourceChecksum: sha(row.ledgers[0]), targetEntity: 'FinanceJournalEntry', targetId: journal.journalEntryId, state: 'APPLIED' }] });
        if (row.notes) await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', sourceId: row.sourceId, field: 'notes' } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: 'Invoice', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeAdvance', targetId: advanceId, field: 'notes', exactText: row.notes }, update: { sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeAdvance', targetId: advanceId, exactText: row.notes } });
      });
      advanceTargetIdBySource.set(row.sourceId, advanceId);
    }
    for (const row of settlements) await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId: execution.id, sourceEntity: 'NoorixAdvanceSettlement', sourceId: row.sourceId }, select: { targetId: true, sourceChecksum: true } });
      if (existing) { if (existing.sourceChecksum !== row.sourceChecksum) throw new Error('An existing settlement receipt differs from source.'); return; }
      const advanceId = advanceTargetIdBySource.get(row.advanceSourceId); if (!advanceId) throw new Error(`Settlement ${row.sourceId} advance map is unavailable.`);
      const advance = await tx.hrEmployeeAdvance.findFirstOrThrow({ where: { id: advanceId, tenantId, companyId }, select: { employeeId: true, settledAmount: true, remainingAmount: true, originalAmount: true } });
      if (advance.employeeId !== target.employeeIdBySource.get(row.employeeSourceId) || Number(amount(row.amount, row.sourceId)) > Number(advance.remainingAmount.toFixed(4))) throw new Error(`Settlement ${row.sourceId} cannot be applied safely.`);
      const settlementId = randomUUID(); const settled = fixed(Number(advance.settledAmount.toFixed(4)) + Number(amount(row.amount, row.sourceId))); const remaining = fixed(Number(advance.remainingAmount.toFixed(4)) - Number(amount(row.amount, row.sourceId)));
      await tx.hrEmployeeAdvance.update({ where: { id: advanceId }, data: { settledAmount: settled, remainingAmount: remaining, status: Number(remaining) === 0 ? 'SETTLED' : 'PARTIALLY_SETTLED' } });
      await tx.hrEmployeeAdvanceSettlement.create({ data: { id: settlementId, tenantId, companyId, advanceId, source: 'PAYROLL', businessDate: day(row.businessDate), amount: amount(row.amount, row.sourceId) } });
      await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixAdvanceSettlement', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeAdvanceSettlement', targetId: settlementId, state: 'APPLIED' } });
      if (row.notes) await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity: 'EmployeeDeduction', sourceId: row.sourceId, field: 'notes' } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: 'EmployeeDeduction', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeAdvanceSettlement', targetId: settlementId, field: 'notes', exactText: row.notes }, update: { sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeAdvanceSettlement', targetId: settlementId, exactText: row.notes } });
    });
    for (const row of cancelled) if (row.notes) await database.inTenantTransaction(tenantId, (tx) => tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity: 'Invoice', sourceId: row.sourceId, field: 'notes' } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: 'Invoice', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, field: 'notes', exactText: row.notes }, update: { sourceChecksum: row.sourceChecksum, targetEntity: null, targetId: null, exactText: row.notes } }));
    await database.inTenantTransaction(tenantId, async (tx) => {
      await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', reason: null, waveSequence: 1 } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.advances_backfill.completed', entityType: 'NurixExcelFinancialExecution', entityId: execution.id, requestId: `nurix-al-shami-advances:${planChecksum}`, afterJson: { ...dry, cancelledEvidenceOnly: cancelled.map((row) => ({ sourceId: row.sourceId, notesPreserved: Boolean(row.notes) })) } } });
    });
    console.log(JSON.stringify({ status: 'COMPLETED', ...dry, operationalAdvances: active.length, operationalSettlements: settlements.length, cancelledEvidenceOnly: cancelled.length }, null, 2));
  }
} finally { await app.close(); }
