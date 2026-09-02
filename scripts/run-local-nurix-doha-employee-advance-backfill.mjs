/**
 * Safe, source-backed Noorix employee-advance importer for Doha Consumer.
 *
 * It deliberately refuses to infer a relationship between a deduction and an
 * advance.  An advance is operational only when its active ADV-001 -> vault
 * entry proves the cash issue.  A repayment is operational only when both
 * EmployeeDeduction.reference_id and its active EXP-004 -> ADV-001 ledger
 * prove the exact advance it settles.  All other deductions are retained as
 * evidence-only records: they do not change cash, payroll expense, or an
 * employee balance.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-doha-historical-advances/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_DOHA_ADVANCES_V1';
const SOURCE_COMPANY_ID = 'cmnf5xrd0001uy8lm8vja50gp';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const key = (entity, sourceId) => sha({ version: VERSION, entity, sourceId });
const money = (value, label = 'amount') => {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,4}))?$/.exec(String(value));
  if (!match) throw new Error(`Invalid Noorix ${label}: ${value}`);
  return BigInt(match[1]) * 10000n + BigInt((match[2] ?? '').padEnd(4, '0'));
};
const fixedUnits = (value) => {
  if (value < 0n) throw new Error('A historical advance amount cannot be negative.');
  return `${value / 10000n}.${(value % 10000n).toString().padStart(4, '0')}`;
};
const fixed = (value, label) => fixedUnits(money(value, label));
const date = (value) => new Date(`${value}T00:00:00.000Z`);

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-doha-employee-advance-backfill.mjs <package-uuid> <tenant-uuid> <Doha-company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
}

const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('This writer only permits the canonical local Baseer test database.');
}

const evidencePath = resolve('artifacts/migration/noorix-doha-employee-advances-evidence-v1.json');
const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
if (evidence.schemaVersion !== 'noorix-doha-employee-advances-evidence/v1' || evidence.sourceCompanyId !== SOURCE_COMPANY_ID || evidence.sourceArchiveSha256 !== '25173059779AF2DB845F905CA7FC1CCB1BE367165F6B5A9819A38BB066981261') {
  throw new Error('Doha advance evidence does not match the approved frozen Noorix archive.');
}
const source = { advances: evidence.advances, deductions: evidence.deductions };
const active = source.advances.filter((row) => row.status === 'active');
const cancelled = source.advances.filter((row) => row.status === 'cancelled');
if (active.length !== 8 || cancelled.length !== 0 || active.length + cancelled.length !== source.advances.length || source.deductions.length !== 12) {
  throw new Error('The reviewed Doha advance source set changed (expected 8 active, 0 cancelled advances and 12 deductions).');
}

for (const row of active) {
  if (!row.sourceId || !row.number || !row.employeeSourceId || !row.vaultSourceId || !row.businessDate || money(row.amount, row.sourceId) <= 0n || row.ledgers.length !== 1) {
    throw new Error(`Advance ${row.sourceId} is incomplete.`);
  }
  const ledger = row.ledgers[0];
  if (ledger.status !== 'active' || ledger.referenceType !== 'advance' || ledger.debitCode !== 'ADV-001' || !ledger.creditCode?.startsWith('V-') || ledger.vaultSourceId !== row.vaultSourceId || ledger.businessDate !== row.businessDate || money(ledger.amount, ledger.sourceId) !== money(row.amount, row.sourceId)) {
    throw new Error(`Advance ${row.number} lacks exact active ADV-001 -> vault proof.`);
  }
  row.sourceChecksum = sha(row);
}
for (const row of cancelled) row.sourceChecksum = sha(row);
const activeBySource = new Map(active.map((row) => [row.sourceId, row]));
const linkedSettlements = [];
const unlinkedDeductions = [];
for (const row of source.deductions) {
  const base = !row.sourceId || !row.employeeSourceId || !row.businessDate || money(row.amount, row.sourceId) <= 0n;
  if (base) throw new Error(`Advance deduction ${row.sourceId ?? '<missing>'} is incomplete.`);
  row.sourceChecksum = sha(row);
  const advance = activeBySource.get(row.advanceSourceId);
  const ledger = row.ledgers.length === 1 ? row.ledgers[0] : null;
  const proved = Boolean(
    advance && advance.employeeSourceId === row.employeeSourceId && ledger
      && ledger.status === 'active' && ledger.referenceType === 'advance_settlement'
      && ledger.debitCode === 'EXP-004' && ledger.creditCode === 'ADV-001'
      && ledger.businessDate === row.businessDate
      && money(ledger.amount, ledger.sourceId) === money(row.amount, row.sourceId),
  );
  if (proved) linkedSettlements.push(row);
  else unlinkedDeductions.push(row);
}
if (linkedSettlements.length !== 6 || unlinkedDeductions.length !== 6) {
  throw new Error('The reviewed Doha deduction evidence changed (expected exactly 6 linked and 6 evidence-only deductions).');
}
const settledByAdvance = new Map();
for (const row of linkedSettlements) settledByAdvance.set(row.advanceSourceId, (settledByAdvance.get(row.advanceSourceId) ?? 0n) + money(row.amount, row.sourceId));
for (const [advanceId, settled] of settledByAdvance) if (settled > money(activeBySource.get(advanceId).amount, advanceId)) throw new Error(`Settlements exceed advance ${advanceId}.`);

const issuedAmount = active.reduce((total, row) => total + money(row.amount, row.sourceId), 0n);
const linkedSettlementAmount = linkedSettlements.reduce((total, row) => total + money(row.amount, row.sourceId), 0n);
const evidenceOnlyAmount = unlinkedDeductions.reduce((total, row) => total + money(row.amount, row.sourceId), 0n);
if (linkedSettlementAmount !== 16500000n || evidenceOnlyAmount !== 16500000n) {
  throw new Error('The reviewed Doha deduction totals changed (expected 1,650.0000 linked and 1,650.0000 evidence-only).');
}
const planChecksum = sha({ version: VERSION, active: active.map((row) => [row.sourceId, row.sourceChecksum]), linkedSettlements: linkedSettlements.map((row) => [row.sourceId, row.sourceChecksum]), unlinkedDeductions: unlinkedDeductions.map((row) => [row.sourceId, row.sourceChecksum]) });

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
    if (!packageRow) throw new Error('The selected package is not the approved Doha Consumer reconciliation package.');
    const employeeSourceIds = [...new Set(active.map((row) => row.employeeSourceId))];
    const vaultSourceIds = [...new Set(active.map((row) => row.vaultSourceId))];
    const [employeeMaps, vaultMaps, accounts] = await Promise.all([
      tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: employeeSourceIds }, targetId: { not: null }, status: { in: ['CREATED', 'REUSED'] }, execution: { packageId, targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', sourceId: { in: vaultSourceIds }, targetEntity: 'FinanceVault', state: { in: ['APPLIED', 'REUSED'] } }, select: { sourceId: true, targetId: true } }),
      tx.financeAccount.findMany({ where: { tenantId, companyId, status: 'ACTIVE', systemKey: { in: ['EMPLOYEE_ADVANCES', 'PAYROLL_EXPENSE'] } }, select: { id: true, systemKey: true } }),
    ]);
    const employeeIdBySource = new Map(employeeMaps.map((row) => [row.sourceId, row.targetId]));
    const vaultIdBySource = new Map(vaultMaps.map((row) => [row.sourceId, row.targetId]));
    const accountByKey = new Map(accounts.map((row) => [row.systemKey, row.id]));
    if (employeeIdBySource.size !== employeeSourceIds.length || vaultIdBySource.size !== vaultSourceIds.length || !accountByKey.get('EMPLOYEE_ADVANCES') || !accountByKey.get('PAYROLL_EXPENSE')) throw new Error('Doha employee, vault, or system-account mapping is incomplete.');
    const vaults = await tx.financeVault.findMany({ where: { tenantId, companyId, id: { in: [...vaultIdBySource.values()] }, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, accountId: true, paymentMethod: true } });
    if (vaults.length !== vaultIdBySource.size) throw new Error('A mapped Doha advance vault is inactive or cannot accept payments.');
    return { employeeIdBySource, vaultIdBySource, accountByKey, vaultById: new Map(vaults.map((row) => [row.id, row])) };
  });

  const dryRun = {
    status: 'PARSED_DRY_RUN', version: VERSION, planChecksum,
    source: { activeAdvances: active.length, cancelledAdvances: cancelled.length, deductions: source.deductions.length },
    operational: { issuedAdvances: active.length, linkedSettlements: linkedSettlements.length, issuedAmount: fixedUnits(issuedAmount), linkedSettlementAmount: fixedUnits(linkedSettlementAmount), remainingAmount: fixedUnits(issuedAmount - linkedSettlementAmount) },
    evidenceOnly: { unlinkedDeductions: unlinkedDeductions.length, amountNotApplied: fixedUnits(evidenceOnlyAmount), reason: 'Missing direct advance reference and/or exact active EXP-004 -> ADV-001 proof; no matching is inferred.' },
    maps: { employees: target.employeeIdBySource.size, vaults: target.vaultIdBySource.size }, financialWrites: 0,
  };
  console.log(JSON.stringify(dryRun, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const execution = await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findFirst({ where: { packageId, tenantId, transformVersion: VERSION }, select: { id: true, status: true, financialPlanSha256: true } });
      if (existing) { if (existing.financialPlanSha256 !== planChecksum) throw new Error('Existing Doha advance execution differs from the immutable snapshot.'); return existing; }
      const id = randomUUID(); const waveId = randomUUID();
      await tx.nurixExcelFinancialExecution.create({ data: { id, packageId, tenantId, targetCompanyId: companyId, transformVersion: VERSION, financialPlanSha256: planChecksum, status: 'APPROVED', reason: 'Source-proved Doha advances; unlinked deductions remain evidence-only.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date() } });
      await tx.nurixExcelFinancialWave.create({ data: { id: waveId, executionId: id, tenantId, targetCompanyId: companyId, sequence: 1, plannedItems: active.length + linkedSettlements.length + unlinkedDeductions.length } });
      await tx.nurixExcelFinancialItem.createMany({ data: [
        ...active.map((row) => ({ id: randomUUID(), executionId: id, waveId, tenantId, targetCompanyId: companyId, sourceSheet: 'Invoices', sourceEntity: 'NoorixAdvanceInvoice', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, operationKey: key('issue', row.sourceId), status: 'PENDING' })),
        ...linkedSettlements.map((row) => ({ id: randomUUID(), executionId: id, waveId, tenantId, targetCompanyId: companyId, sourceSheet: 'EmployeeDeductions', sourceEntity: 'NoorixAdvanceSettlement', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, operationKey: key('settlement', row.sourceId), status: 'PENDING' })),
        ...unlinkedDeductions.map((row) => ({ id: randomUUID(), executionId: id, waveId, tenantId, targetCompanyId: companyId, sourceSheet: 'EmployeeDeductions', sourceEntity: 'NoorixUnlinkedAdvanceDeduction', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, operationKey: key('evidence', row.sourceId), status: 'PENDING' })),
      ] });
      return { id, status: 'APPROVED' };
    });
    if (execution.status !== 'COMPLETED') {
      const advanceById = new Map(active.map((row) => [row.sourceId, row]));
      const linkedById = new Map(linkedSettlements.map((row) => [row.sourceId, row]));
      const unlinkedById = new Map(unlinkedDeductions.map((row) => [row.sourceId, row]));
      const pending = await database.inTenantTransaction(tenantId, (tx) => tx.nurixExcelFinancialItem.findMany({ where: { executionId: execution.id, tenantId, status: 'PENDING' }, select: { id: true, sourceEntity: true, sourceId: true }, orderBy: { sourceId: 'asc' } }));
      const ordered = [...pending.filter((item) => item.sourceEntity === 'NoorixAdvanceInvoice'), ...pending.filter((item) => item.sourceEntity === 'NoorixAdvanceSettlement'), ...pending.filter((item) => item.sourceEntity === 'NoorixUnlinkedAdvanceDeduction')];
      for (const item of ordered) await database.inTenantTransaction(tenantId, async (tx) => {
        const existing = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId: execution.id, sourceEntity: item.sourceEntity, sourceId: item.sourceId }, select: { targetId: true, sourceChecksum: true } });
        const sourceRow = advanceById.get(item.sourceId) ?? linkedById.get(item.sourceId) ?? unlinkedById.get(item.sourceId);
        if (!sourceRow) throw new Error(`A planned Doha advance row is absent: ${item.sourceId}.`);
        if (existing) {
          if (existing.sourceChecksum !== sourceRow.sourceChecksum) throw new Error(`Source checksum changed for ${item.sourceId}.`);
          await tx.nurixExcelFinancialItem.update({ where: { id: item.id }, data: { status: 'REUSED', targetEntity: existing.targetEntity, targetId: existing.targetId, resultCode: 'IDEMPOTENT_REUSE' } });
          return;
        }
        if (item.sourceEntity === 'NoorixUnlinkedAdvanceDeduction') {
          await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: item.sourceEntity, sourceId: item.sourceId, sourceChecksum: sourceRow.sourceChecksum, targetEntity: 'NoorixUnlinkedAdvanceDeductionEvidence', targetId: item.sourceId, state: 'APPLIED' } });
          await tx.nurixExcelFinancialItem.update({ where: { id: item.id }, data: { status: 'EXCLUDED', targetEntity: 'NoorixUnlinkedAdvanceDeductionEvidence', targetId: item.sourceId, resultCode: 'EVIDENCE_ONLY_NO_DIRECT_ADVANCE_LINK' } });
          return;
        }
        if (item.sourceEntity === 'NoorixAdvanceInvoice') {
          const vaultId = target.vaultIdBySource.get(sourceRow.vaultSourceId); const vault = target.vaultById.get(vaultId);
          if (!vault) throw new Error(`Mapped vault is missing for ${sourceRow.number}.`);
          const journal = await journals.postInTransaction(tx, { tenantId, companyId, actorUserId, requestId: `nurix-doha-advance-issue:${key('issue', sourceRow.sourceId)}`, sourceType: 'nurix_doha_historical_advance_issue', sourceReference: sourceRow.sourceId, businessDate: date(sourceRow.businessDate), description: `سلفة تاريخية نوركس: ${sourceRow.number}`, lines: [{ accountId: target.accountByKey.get('EMPLOYEE_ADVANCES'), debitAmount: fixed(sourceRow.amount, sourceRow.sourceId), description: sourceRow.number }, { accountId: vault.accountId, creditAmount: fixed(sourceRow.amount, sourceRow.sourceId), description: sourceRow.number }] });
          const advanceId = randomUUID();
          await tx.hrEmployeeAdvance.create({ data: { id: advanceId, tenantId, companyId, employeeId: target.employeeIdBySource.get(sourceRow.employeeSourceId), advanceNumber: sourceRow.number, businessDate: date(sourceRow.businessDate), originalAmount: fixed(sourceRow.amount, sourceRow.sourceId), remainingAmount: fixed(sourceRow.amount, sourceRow.sourceId), notes: `مستورد من لقطة نوركس؛ invoice=${sourceRow.sourceId}; ledger=${sourceRow.ledgers[0].sourceId}. ${sourceRow.notes}`.trim(), issueJournalEntryId: journal.journalEntryId, createdByUserId: actorUserId } });
          await tx.hrEmployeeAdvancePayoutAllocation.create({ data: { id: randomUUID(), tenantId, companyId, advanceId, vaultId, amount: fixed(sourceRow.amount, sourceRow.sourceId), paymentMethod: vault.paymentMethod } });
          await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId, companyId, employeeId: target.employeeIdBySource.get(sourceRow.employeeSourceId), journalEntryId: journal.journalEntryId, movementType: 'ADVANCE_ISSUED', businessDate: date(sourceRow.businessDate), amount: fixed(sourceRow.amount, sourceRow.sourceId), sourceReference: sourceRow.number, description: `Noorix ${sourceRow.number}` } });
          await tx.nurixExcelFinancialSourceMap.createMany({ data: [{ id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixAdvanceInvoice', sourceId: sourceRow.sourceId, sourceChecksum: sourceRow.sourceChecksum, targetEntity: 'HrEmployeeAdvance', targetId: advanceId, state: 'APPLIED' }, { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixAdvanceIssueLedger', sourceId: sourceRow.ledgers[0].sourceId, sourceChecksum: sha(sourceRow.ledgers[0]), targetEntity: 'FinanceJournalEntry', targetId: journal.journalEntryId, state: 'APPLIED' }] });
          await tx.nurixExcelFinancialItem.update({ where: { id: item.id }, data: { status: 'POSTED', targetEntity: 'HrEmployeeAdvance', targetId: advanceId, resultCode: 'POSTED_SOURCE_PROVED_ADVANCE' } });
          return;
        }
        const settlement = sourceRow;
        const advanceMap = await tx.nurixExcelFinancialSourceMap.findFirstOrThrow({ where: { executionId: execution.id, sourceEntity: 'NoorixAdvanceInvoice', sourceId: settlement.advanceSourceId, state: 'APPLIED' }, select: { targetId: true } });
        const advance = await tx.hrEmployeeAdvance.findFirstOrThrow({ where: { id: advanceMap.targetId, tenantId, companyId }, select: { id: true, employeeId: true, settledAmount: true, remainingAmount: true, businessDate: true } });
        if (advance.employeeId !== target.employeeIdBySource.get(settlement.employeeSourceId) || date(settlement.businessDate) < advance.businessDate || money(settlement.amount, settlement.sourceId) > money(advance.remainingAmount.toFixed(4), settlement.sourceId)) throw new Error(`Settlement ${settlement.sourceId} cannot be applied safely.`);
        const journal = await journals.postInTransaction(tx, { tenantId, companyId, actorUserId, requestId: `nurix-doha-advance-settlement:${key('settlement', settlement.sourceId)}`, sourceType: 'nurix_doha_historical_advance_settlement', sourceReference: settlement.sourceId, businessDate: date(settlement.businessDate), description: `تسوية سلفة تاريخية نوركس: ${settlement.sourceId}`, lines: [{ accountId: target.accountByKey.get('PAYROLL_EXPENSE'), debitAmount: fixed(settlement.amount, settlement.sourceId), description: settlement.sourceId }, { accountId: target.accountByKey.get('EMPLOYEE_ADVANCES'), creditAmount: fixed(settlement.amount, settlement.sourceId), description: settlement.sourceId }] });
        const remaining = money(advance.remainingAmount.toFixed(4), settlement.sourceId) - money(settlement.amount, settlement.sourceId);
        const settlementId = randomUUID();
        await tx.hrEmployeeAdvance.update({ where: { id: advance.id }, data: { settledAmount: fixedUnits(money(advance.settledAmount.toFixed(4), settlement.sourceId) + money(settlement.amount, settlement.sourceId)), remainingAmount: fixedUnits(remaining), status: remaining === 0n ? 'SETTLED' : 'PARTIALLY_SETTLED' } });
        await tx.hrEmployeeAdvanceSettlement.create({ data: { id: settlementId, tenantId, companyId, advanceId: advance.id, source: 'PAYROLL', businessDate: date(settlement.businessDate), amount: fixed(settlement.amount, settlement.sourceId), journalEntryId: journal.journalEntryId } });
        await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId, companyId, employeeId: advance.employeeId, journalEntryId: journal.journalEntryId, movementType: 'ADVANCE_SETTLEMENT', businessDate: date(settlement.businessDate), amount: fixed(settlement.amount, settlement.sourceId), sourceReference: settlement.sourceId, description: 'Noorix source-proved advance settlement' } });
        await tx.nurixExcelFinancialSourceMap.createMany({ data: [{ id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixAdvanceSettlement', sourceId: settlement.sourceId, sourceChecksum: settlement.sourceChecksum, targetEntity: 'HrEmployeeAdvanceSettlement', targetId: settlementId, state: 'APPLIED' }, { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixAdvanceSettlementLedger', sourceId: settlement.ledgers[0].sourceId, sourceChecksum: sha(settlement.ledgers[0]), targetEntity: 'FinanceJournalEntry', targetId: journal.journalEntryId, state: 'APPLIED' }] });
        await tx.nurixExcelFinancialItem.update({ where: { id: item.id }, data: { status: 'POSTED', targetEntity: 'HrEmployeeAdvanceSettlement', targetId: settlementId, resultCode: 'POSTED_SOURCE_PROVED_SETTLEMENT' } });
      });
      await database.inTenantTransaction(tenantId, async (tx) => {
        const unresolved = await tx.nurixExcelFinancialItem.count({ where: { executionId: execution.id, status: 'PENDING' } }); if (unresolved) throw new Error('Doha advance execution has unresolved items.');
        const wave = await tx.nurixExcelFinancialWave.findFirstOrThrow({ where: { executionId: execution.id, sequence: 1 }, select: { id: true } });
        const receipt = { version: VERSION, planChecksum, issuedAdvances: active.length, linkedSettlements: linkedSettlements.length, evidenceOnlyDeductions: unlinkedDeductions.length, issuedAmount: fixedUnits(issuedAmount), linkedSettlementAmount: fixedUnits(linkedSettlementAmount), evidenceOnlyAmount: fixedUnits(evidenceOnlyAmount) };
        await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: 'COMMITTED', postedItems: active.length + linkedSettlements.length, reviewItems: unlinkedDeductions.length, committedAt: new Date(), reconciliationHash: sha(receipt) } });
        await tx.nurixExcelFinancialReceipt.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sequence: 1, kind: 'RECONCILIATION', receiptSha256: sha(receipt), summaryJson: receipt, createdByUserId: actorUserId }, update: { receiptSha256: sha(receipt), summaryJson: receipt } });
        await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', waveSequence: 1, reason: null } });
      });
    }
    console.log(JSON.stringify({ status: 'COMPLETED', ...dryRun, financialWrites: active.length + linkedSettlements.length * 2 }, null, 2));
  }
} finally {
  await app.close();
}
