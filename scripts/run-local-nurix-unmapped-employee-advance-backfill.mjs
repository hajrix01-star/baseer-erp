/**
 * Narrow, auditable backfill for the employee advances which were still
 * absent after the historical ARZ and Al-Shami waves.  It deliberately has a
 * fixed source scope: one ARZ advance and three Al-Shami advances.  The two
 * cancelled Al-Shami invoices are verified only: their evidence is owned by
 * the shared cancellation writer and must never be duplicated here.
 *
 * No deduction is imported by this writer.  A settlement is never inferred
 * from a payroll run, a net payment, or a missing reference.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-unmapped-employee-advances/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_UNMAPPED_EMPLOYEE_ADVANCES_V1';
const SOURCE_CONTAINER = 'baseer-noorix-snapshot-20260902';
const SOURCE_DATABASE = 'nurix_snapshot';
const uuid = /^[0-9a-f-]{36}$/i;
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const day = (value) => new Date(`${value}T00:00:00.000Z`);
const fixedAmount = (value, label) => {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,4}))?$/.exec(String(value));
  if (!match) throw new Error(`Invalid Noorix amount for ${label}.`);
  return `${match[1]}.${(match[2] ?? '').padEnd(4, '0')}`;
};
const total = (rows) => fixedAmount(rows.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(4), 'total');
const decodeBase64 = (value) => Buffer.from(value || '', 'base64').toString('utf8');

const SCOPES = {
  ARZ: {
    sourceCompanyId: 'cmnf604ka009ay8lm556wgd9c',
    expectedActiveIds: ['cmthw5muy01kxgvsw2ghpflqx'],
    expectedCancelledIds: [],
    sourceType: 'nurix_arz_unmapped_advance_issue',
  },
  AL_SHAMI: {
    sourceCompanyId: 'cmnaivif80001wavxxfgriptm',
    expectedActiveIds: ['cmtecwsrt00kegvswwo69yno2', 'cmtev6f8n00orgvsweaj7hbtb', 'cmthaerp701d6gvswtoy8hvdi'],
    expectedCancelledIds: ['cmpxwgwjq0089dogt7z774020', 'cmq8lohyg005u13u5oh4qvf1e'],
    sourceType: 'nurix_al_shami_unmapped_advance_issue',
  },
};

const [scopeName, packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
const scope = SCOPES[scopeName];
if (!scope || ![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-unmapped-employee-advance-backfill.mjs <ARZ|AL_SHAMI> <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
}

const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('This writer only permits the canonical local Baseer test database.');
}

const psql = (sql) => execFileSync('docker', [
  'exec', SOURCE_CONTAINER, 'psql', '-U', 'nurix_restore', '-d', SOURCE_DATABASE,
  '-A', '-F', '|', '-t', '-c', sql,
], { encoding: 'utf8' }).trim();
const quotedIds = [...scope.expectedActiveIds, ...scope.expectedCancelledIds].map((id) => `'${id}'`).join(',');
const sourceRows = psql(`
  SELECT i.id, i.invoice_number, i.employee_id, i.vault_id, i.total_amount::text,
    i.transaction_date::date::text, i.status,
    encode(convert_to(coalesce(i.notes, ''), 'UTF8'), 'base64'),
    l.id, l.reference_type, l.status, l.amount::text, l.transaction_date::date::text,
    l.vault_id, da.code, ca.code
  FROM invoices i
  LEFT JOIN ledger_entries l ON l.company_id = i.company_id AND l.reference_id = i.id
  LEFT JOIN accounts da ON da.id = l.debit_account_id AND da.company_id = i.company_id
  LEFT JOIN accounts ca ON ca.id = l.credit_account_id AND ca.company_id = i.company_id
  WHERE i.company_id = '${scope.sourceCompanyId}' AND i.kind = 'advance' AND i.id IN (${quotedIds})
  ORDER BY i.id, l.id
`).split(/\r?\n/).filter(Boolean);

const bySourceId = new Map();
for (const line of sourceRows) {
  const [id, number, employeeSourceId, vaultSourceId, amount, businessDate, status, notesBase64, ledgerId, referenceType, ledgerStatus, ledgerAmount, ledgerBusinessDate, ledgerVaultSourceId, debitCode, creditCode] = line.split('|');
  const row = bySourceId.get(id) ?? {
    id, number, employeeSourceId, vaultSourceId, amount: fixedAmount(amount, id), businessDate, status,
    notes: decodeBase64(notesBase64), ledgers: [],
  };
  if (ledgerId) row.ledgers.push({ id: ledgerId, referenceType, status: ledgerStatus, amount: fixedAmount(ledgerAmount, ledgerId), businessDate: ledgerBusinessDate, vaultSourceId: ledgerVaultSourceId, debitCode, creditCode });
  bySourceId.set(id, row);
}
const expectedSourceIds = new Set([...scope.expectedActiveIds, ...scope.expectedCancelledIds]);
if (bySourceId.size !== expectedSourceIds.size || [...expectedSourceIds].some((id) => !bySourceId.has(id))) {
  throw new Error('The fixed unmatched-advance source set is incomplete or has changed.');
}
const active = scope.expectedActiveIds.map((id) => bySourceId.get(id));
const cancelled = scope.expectedCancelledIds.map((id) => bySourceId.get(id));
for (const row of active) {
  if (!row.number || !row.employeeSourceId || !row.vaultSourceId || !row.businessDate || row.status !== 'active' || Number(row.amount) <= 0 || row.ledgers.length !== 1) {
    throw new Error(`Active advance ${row.id} is incomplete.`);
  }
  const ledger = row.ledgers[0];
  if (ledger.status !== 'active' || ledger.referenceType !== 'advance' || ledger.debitCode !== 'ADV-001' || !ledger.creditCode?.startsWith('V-') || ledger.vaultSourceId !== row.vaultSourceId || ledger.businessDate !== row.businessDate || ledger.amount !== row.amount) {
    throw new Error(`Active advance ${row.number} lacks exact active ADV-001 -> vault evidence.`);
  }
  row.sourceChecksum = hash(row);
}
for (const row of cancelled) {
  if (!row.number || row.status !== 'cancelled') throw new Error(`Cancelled advance ${row.id} is not a cancelled Noorix invoice.`);
  row.sourceChecksum = hash(row);
}

// A fixed advance may only be issued here when Noorix has no directly linked
// deduction at all.  This keeps settlements out of scope instead of guessing.
const deductionCount = Number(psql(`
  SELECT count(*) FROM employee_deductions
  WHERE company_id = '${scope.sourceCompanyId}' AND deduction_type = 'advance'
    AND reference_id IN (${scope.expectedActiveIds.map((id) => `'${id}'`).join(',')})
`) || '0');
if (deductionCount !== 0) throw new Error('A fixed active advance now has a linked deduction; this no-settlement writer must be reviewed before use.');

const planChecksum = hash({
  version: VERSION,
  scope: scopeName,
  active: active.map((row) => [row.id, row.sourceChecksum]),
  cancelled: cancelled.map((row) => [row.id, row.sourceChecksum]),
});

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { JournalPostingService } = await import('../apps/api/dist/finance/journal/journal-posting.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const database = app.get(DatabaseService);
  const journals = app.get(JournalPostingService);
  const target = await database.inTenantTransaction(tenantId, async (tx) => {
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({
      where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: scope.sourceCompanyId, status: 'READY_FOR_RECONCILIATION' },
      select: { id: true },
    });
    if (!packageRow) throw new Error('The package does not match this company and source snapshot.');
    const employeeSourceIds = [...new Set(active.map((row) => row.employeeSourceId))];
    const sourceVaultIds = [...new Set(active.map((row) => row.vaultSourceId))];
    const [employeeRows, vaultRows, accountRows] = await Promise.all([
      tx.nurixExcelMasterDataItem.findMany({
        where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: employeeSourceIds }, targetId: { not: null }, status: { in: ['CREATED', 'REUSED'] }, execution: { packageId, targetCompanyId: companyId, status: 'COMPLETED' } },
        select: { sourceId: true, targetId: true },
      }),
      tx.nurixExcelFinancialSourceMap.findMany({
        where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', sourceId: { in: sourceVaultIds }, targetEntity: 'FinanceVault', state: { in: ['APPLIED', 'REUSED'] } },
        select: { sourceId: true, targetId: true },
      }),
      tx.financeAccount.findMany({ where: { tenantId, companyId, systemKey: 'EMPLOYEE_ADVANCES', status: 'ACTIVE' }, select: { id: true } }),
    ]);
    const cancelledEvidenceRows = cancelled.length === 0 ? [] : await tx.nurixExcelFinancialSourceMap.findMany({
      where: { tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixCancelledInvoiceEvidence', sourceId: { in: cancelled.map((row) => row.id) }, targetEntity: 'NoorixCancelledSourceEvidence', state: { in: ['APPLIED', 'REUSED'] } },
      select: { sourceId: true },
    });
    if (new Set(cancelledEvidenceRows.map((row) => row.sourceId)).size !== cancelled.length) {
      throw new Error('Cancelled advance evidence is not yet available from the shared cancellation writer.');
    }
    const employeeIdBySource = new Map(employeeRows.map((row) => [row.sourceId, row.targetId]));
    const vaultIdBySource = new Map();
    for (const row of vaultRows) {
      if (!row.targetId) continue;
      const previous = vaultIdBySource.get(row.sourceId);
      if (previous && previous !== row.targetId) throw new Error(`Source vault ${row.sourceId} is ambiguously mapped.`);
      vaultIdBySource.set(row.sourceId, row.targetId);
    }
    if (employeeIdBySource.size !== employeeSourceIds.length || vaultIdBySource.size !== sourceVaultIds.length || accountRows.length !== 1) {
      throw new Error('Required employee, vault, or employee-advance account mapping is incomplete.');
    }
    const [employees, vaults] = await Promise.all([
      tx.hrEmployee.findMany({ where: { tenantId, companyId, id: { in: [...employeeIdBySource.values()] } }, select: { id: true } }),
      tx.financeVault.findMany({ where: { tenantId, companyId, id: { in: [...vaultIdBySource.values()] }, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, accountId: true, paymentMethod: true } }),
    ]);
    if (employees.length !== employeeIdBySource.size || vaults.length !== vaultIdBySource.size) throw new Error('A mapped employee or vault is unavailable in the target company.');
    return { employeeIdBySource, vaultIdBySource, advanceAccountId: accountRows[0].id, vaultById: new Map(vaults.map((row) => [row.id, row])) };
  });

  const dryRun = {
    status: 'PARSED_DRY_RUN', version: VERSION, scope: scopeName, planChecksum,
    activeAdvances: active.length, cancelledEvidenceAlreadyCovered: cancelled.length, linkedSettlements: 0,
    issuedAmount: total(active), settledAmount: '0.0000', remainingAmount: total(active),
    financialWrites: 0,
  };
  console.log(JSON.stringify(dryRun, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const execution = await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findFirst({ where: { packageId, tenantId, targetCompanyId: companyId, transformVersion: `${VERSION}/${scopeName}` }, select: { id: true, financialPlanSha256: true, status: true } });
      if (existing) {
        if (existing.financialPlanSha256 !== planChecksum) throw new Error('The immutable unmatched-advance plan differs from the stored execution.');
        return existing;
      }
      return tx.nurixExcelFinancialExecution.create({ data: {
        id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion: `${VERSION}/${scopeName}`, financialPlanSha256: planChecksum,
        status: 'APPROVED', reason: 'Owner-authorized unmatched Noorix advance issuances; cancelled invoices retained only as evidence.',
        requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date(),
      }, select: { id: true, financialPlanSha256: true, status: true } });
    });
    for (const row of active) await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixAdvanceInvoice', sourceId: row.id }, select: { executionId: true, sourceChecksum: true, targetId: true } });
      if (existing) {
        if (existing.executionId !== execution.id || existing.sourceChecksum !== row.sourceChecksum) throw new Error(`Advance ${row.id} already has an incompatible target map.`);
        return;
      }
      const vaultId = target.vaultIdBySource.get(row.vaultSourceId);
      const vault = target.vaultById.get(vaultId);
      if (!vault) throw new Error(`Mapped vault is unavailable for ${row.number}.`);
      const journal = await journals.postInTransaction(tx, {
        tenantId, companyId, actorUserId, requestId: `nurix-unmapped-advance:${scopeName}:${row.id}`,
        sourceType: scope.sourceType, sourceReference: row.id, businessDate: day(row.businessDate), description: `سلفة تاريخية نوركس: ${row.number}`,
        lines: [{ accountId: target.advanceAccountId, debitAmount: row.amount, description: row.number }, { accountId: vault.accountId, creditAmount: row.amount, description: row.number }],
      });
      const advanceId = randomUUID();
      await tx.hrEmployeeAdvance.create({ data: { id: advanceId, tenantId, companyId, employeeId: target.employeeIdBySource.get(row.employeeSourceId), advanceNumber: row.number, businessDate: day(row.businessDate), originalAmount: row.amount, remainingAmount: row.amount, notes: row.notes || null, issueJournalEntryId: journal.journalEntryId, createdByUserId: actorUserId } });
      await tx.hrEmployeeAdvancePayoutAllocation.create({ data: { id: randomUUID(), tenantId, companyId, advanceId, vaultId, amount: row.amount, paymentMethod: vault.paymentMethod } });
      await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId, companyId, employeeId: target.employeeIdBySource.get(row.employeeSourceId), journalEntryId: journal.journalEntryId, movementType: 'ADVANCE_ISSUED', businessDate: day(row.businessDate), amount: row.amount, sourceReference: row.number, description: row.notes || `Noorix ${row.number}` } });
      await tx.nurixExcelFinancialSourceMap.createMany({ data: [
        { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixAdvanceInvoice', sourceId: row.id, sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeAdvance', targetId: advanceId, state: 'APPLIED' },
        { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixAdvanceIssueLedger', sourceId: row.ledgers[0].id, sourceChecksum: hash(row.ledgers[0]), targetEntity: 'FinanceJournalEntry', targetId: journal.journalEntryId, state: 'APPLIED' },
      ] });
    });
    await database.inTenantTransaction(tenantId, (tx) => tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', reason: null, waveSequence: 1 } }));
    console.log(JSON.stringify({ status: 'COMPLETED', ...dryRun, operationalAdvances: active.length }, null, 2));
  }
} finally {
  await app.close();
}
