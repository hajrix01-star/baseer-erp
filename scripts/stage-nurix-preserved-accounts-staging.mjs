/**
 * Preserves every Noorix account that lacks a safe exact code-and-type target.
 * A company-local `NX-` code avoids overwriting Baseer accounts with a
 * conflicting type. It writes accounts and immutable maps only; financial
 * facts are deliberately outside this script.
 */
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';

const tenantId = process.env.BASEER_MIGRATION_TENANT_ID;
const databaseUrl = process.env.DATABASE_URL;
const actorLogin = process.env.BASEER_MIGRATION_ACTOR_LOGIN?.trim().toLocaleLowerCase();
if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('BASEER_MIGRATION_TENANT_ID must be a UUID.');
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
if (!actorLogin || !actorLogin.includes('@')) throw new Error('BASEER_MIGRATION_ACTOR_LOGIN must be the active staging owner login.');
const parsed = new URL(databaseUrl);
if (parsed.hostname !== '127.0.0.1' || parsed.port !== '5433' || parsed.pathname !== '/baseer_migration_staging') {
  throw new Error('This script only permits the local baseer_migration_staging database on 127.0.0.1:5433.');
}

let standardInput = '';
for await (const chunk of process.stdin) standardInput += chunk;
const rows = standardInput.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
if (!rows.length || rows.length > 300) throw new Error('Between one and three hundred source account rows are required.');
const typeBySource = Object.freeze({ asset: 'ASSET', liability: 'LIABILITY', equity: 'EQUITY', revenue: 'REVENUE', expense: 'EXPENSE' });
for (const row of rows) {
  if (!row || typeof row !== 'object' || typeof row.sourceCompanyId !== 'string' || typeof row.sourceAccountId !== 'string' || typeof row.code !== 'string' || typeof row.nameAr !== 'string' || !row.sourceCompanyId || !row.sourceAccountId || !row.code.trim() || !row.nameAr.trim() || !typeBySource[String(row.type ?? '').trim().toLowerCase()]) {
    throw new Error('Invalid minimum source account input.');
  }
  if (`NX-${row.code.trim()}`.length > 80) throw new Error('The preserved target account code would exceed 80 characters.');
}

function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sourceKey(sourceCompanyId, sourceId) { return `${sourceCompanyId}:${sourceId}`; }
const database = new DatabaseService();
try {
  const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
    const run = await tx.legacyMigrationRun.findFirst({ where: { tenantId, sourceSystem: 'NOORIX_POSTGRES_ARCHIVE', status: { in: ['DISCOVERY', 'DRY_RUN'] } }, orderBy: { startedAt: 'desc' }, select: { id: true, sourceFingerprint: true } });
    if (!run) throw new Error('No open Noorix migration run exists in staging.');
    const [companyMaps, actions, actor, recordMaps] = await Promise.all([
      tx.legacyMigrationCompanyMap.findMany({ where: { tenantId, runId: run.id }, select: { sourceCompanyId: true, targetCompanyId: true, state: true } }),
      tx.legacyMigrationReviewAction.findMany({ where: { tenantId, runId: run.id, action: { in: ['APPROVE_COMPANY_MAPS', 'APPROVE_DIRECT_CANDIDATES'] } }, select: { action: true, actionKey: true } }),
      tx.user.findFirst({ where: { tenantId, loginNormalized: actorLogin, tenantAdministrationAssignments: { some: { tenantId, isOwner: true } } }, select: { id: true } }),
      tx.legacyMigrationRecordMap.findMany({ where: { tenantId, runId: run.id, sourceEntity: 'accounts' }, select: { sourceCompanyId: true, sourceId: true, targetCompanyId: true, targetEntity: true, targetId: true, transformVersion: true, sourceChecksum: true } }),
    ]);
    if (!actor) throw new Error('The selected staging login is not an owner for this tenant.');
    if (!actions.some((item) => item.action === 'APPROVE_COMPANY_MAPS' && item.actionKey === 'ALL_PLANNED_COMPANY_MAPS') || !actions.some((item) => item.action === 'APPROVE_DIRECT_CANDIDATES' && item.actionKey === 'ACCOUNT_CODE_TYPE') || companyMaps.some((item) => item.state !== 'PLANNED')) {
      throw new Error('Approved company and direct-account maps are required.');
    }
    const targetCompanyBySource = new Map(companyMaps.map((item) => [item.sourceCompanyId, item.targetCompanyId]));
    const mapped = new Map(recordMaps.map((item) => [sourceKey(item.sourceCompanyId, item.sourceId), item]));
    let created = 0;
    let reused = 0;
    let alreadyDirect = 0;
    for (const row of rows) {
      const targetCompanyId = targetCompanyBySource.get(row.sourceCompanyId);
      if (!targetCompanyId) throw new Error('A source account has no approved target company map.');
      const existing = mapped.get(sourceKey(row.sourceCompanyId, row.sourceAccountId));
      if (existing?.transformVersion === 'nurix-account-code-type/v1') {
        if (existing.targetCompanyId !== targetCompanyId || existing.targetEntity !== 'FinanceAccount') throw new Error('Existing direct account map is outside its approved company scope.');
        alreadyDirect += 1;
        continue;
      }
      const code = `NX-${row.code.trim()}`;
      const type = typeBySource[row.type.trim().toLowerCase()];
      const sourceChecksum = hash({ version: 'nurix-account-preserve/v1', sourceCompanyId: row.sourceCompanyId, sourceAccountId: row.sourceAccountId, sourceCode: row.code.trim(), targetCode: code, nameAr: row.nameAr.trim(), nameEn: typeof row.nameEn === 'string' ? row.nameEn.trim() : null, type });
      if (existing) {
        if (existing.targetCompanyId !== targetCompanyId || existing.targetEntity !== 'FinanceAccount' || existing.transformVersion !== 'nurix-account-preserve/v1' || existing.sourceChecksum !== sourceChecksum) throw new Error('Existing preserved account map differs from immutable source evidence.');
        reused += 1;
        continue;
      }
      const conflict = await tx.financeAccount.findFirst({ where: { tenantId, companyId: targetCompanyId, code }, select: { id: true } });
      if (conflict) throw new Error('A target account already uses the preserved NX code; explicit reconciliation is required.');
      const account = await tx.financeAccount.create({ data: { id: randomUUID(), tenantId, companyId: targetCompanyId, code, nameAr: row.nameAr.trim(), nameEn: typeof row.nameEn === 'string' && row.nameEn.trim() ? row.nameEn.trim() : row.nameAr.trim(), type, status: 'ACTIVE' } });
      await tx.legacyMigrationRecordMap.create({ data: { id: randomUUID(), tenantId, runId: run.id, targetCompanyId, sourceCompanyId: row.sourceCompanyId, sourceEntity: 'accounts', sourceId: row.sourceAccountId, targetEntity: 'FinanceAccount', targetId: account.id, transformVersion: 'nurix-account-preserve/v1', sourceChecksum } });
      created += 1;
    }
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, actorUserId: actor.id, action: 'nurix_migration.accounts_preserved', entityType: 'LegacyMigrationRun', entityId: run.id, requestId: randomUUID(), afterJson: { created, reused, alreadyDirect, total: rows.length, transformVersion: 'nurix-account-preserve/v1', sourceFingerprint: run.sourceFingerprint } } });
    return { created, reused, alreadyDirect, total: rows.length };
  });
  console.log(JSON.stringify(receipt));
} finally {
  await database.onModuleDestroy();
}
