/**
 * Records the four versioned, policy-owned Noorix semantic category mappings
 * in local staging. It cannot create categories or modify financial facts.
 * Every source row is verified against an ACTIVE posting category in the same
 * approved target company before its immutable map is written.
 */
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { resolveNoorixCategoryCode } from '../apps/api/dist/finance/noorix-category-mapping.js';

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
if (!rows.length || rows.length > 50) throw new Error('Between one and fifty semantic category rows are required.');
for (const row of rows) {
  if (!row || typeof row !== 'object' || typeof row.sourceCompanyId !== 'string' || typeof row.sourceCategoryId !== 'string' || typeof row.code !== 'string' || typeof row.nameAr !== 'string' || !row.sourceCompanyId || !row.sourceCategoryId || !row.code.trim() || !row.nameAr.trim()) {
    throw new Error('Invalid minimum source category input.');
  }
  const decision = resolveNoorixCategoryCode(row.code);
  if (decision.decision !== 'SEMANTIC' || !decision.targetCode) throw new Error(`Source category ${row.code} is not an approved semantic policy mapping.`);
}

function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
const database = new DatabaseService();
try {
  const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
    const run = await tx.legacyMigrationRun.findFirst({ where: { tenantId, sourceSystem: 'NOORIX_POSTGRES_ARCHIVE', status: { in: ['DISCOVERY', 'DRY_RUN'] } }, orderBy: { startedAt: 'desc' }, select: { id: true, sourceFingerprint: true } });
    if (!run) throw new Error('No open Noorix migration run exists in staging.');
    const [companyMaps, actions, actor] = await Promise.all([
      tx.legacyMigrationCompanyMap.findMany({ where: { tenantId, runId: run.id }, select: { sourceCompanyId: true, targetCompanyId: true, state: true } }),
      tx.legacyMigrationReviewAction.findMany({ where: { tenantId, runId: run.id, action: { in: ['APPROVE_COMPANY_MAPS', 'APPROVE_DIRECT_CANDIDATES'] } }, select: { action: true, actionKey: true } }),
      tx.user.findFirst({ where: { tenantId, loginNormalized: actorLogin, tenantAdministrationAssignments: { some: { tenantId, isOwner: true } } }, select: { id: true } }),
    ]);
    if (!actor) throw new Error('The selected staging login is not an owner for this tenant.');
    if (!actions.some((item) => item.action === 'APPROVE_COMPANY_MAPS' && item.actionKey === 'ALL_PLANNED_COMPANY_MAPS') || !actions.some((item) => item.action === 'APPROVE_DIRECT_CANDIDATES' && item.actionKey === 'CATEGORY_DIRECT') || companyMaps.some((item) => item.state !== 'PLANNED')) {
      throw new Error('Approved company and direct-category maps are required.');
    }
    const targetCompanyBySource = new Map(companyMaps.map((item) => [item.sourceCompanyId, item.targetCompanyId]));
    let created = 0;
    let reused = 0;
    for (const row of rows) {
      const targetCompanyId = targetCompanyBySource.get(row.sourceCompanyId);
      if (!targetCompanyId) throw new Error('A semantic category source row has no approved target company.');
      const decision = resolveNoorixCategoryCode(row.code);
      const sourceChecksum = hash({ version: 'nurix-category-semantic/v1', sourceCompanyId: row.sourceCompanyId, sourceCategoryId: row.sourceCategoryId, sourceCode: decision.sourceCode, targetCode: decision.targetCode, nameAr: row.nameAr.trim(), nameEn: typeof row.nameEn === 'string' ? row.nameEn.trim() : null, reasonAr: decision.reasonAr });
      const existing = await tx.legacyMigrationRecordMap.findFirst({ where: { tenantId, runId: run.id, sourceEntity: 'categories', sourceId: row.sourceCategoryId }, select: { targetCompanyId: true, targetEntity: true, targetId: true, transformVersion: true, sourceChecksum: true } });
      const target = await tx.financeCategory.findFirst({ where: { tenantId, companyId: targetCompanyId, code: decision.targetCode, status: 'ACTIVE', isPosting: true }, select: { id: true, kind: true } });
      if (!target || target.kind !== 'EXPENSE') throw new Error(`The semantic target ${decision.targetCode} is not an active posting expense category in the target company.`);
      if (existing) {
        if (existing.targetCompanyId !== targetCompanyId || existing.targetEntity !== 'FINANCE_CATEGORY' || existing.targetId !== target.id || existing.transformVersion !== 'nurix-category-semantic/v1' || existing.sourceChecksum !== sourceChecksum) {
          throw new Error('Existing semantic category map differs from immutable source evidence.');
        }
        reused += 1;
        continue;
      }
      await tx.legacyMigrationRecordMap.create({ data: { id: randomUUID(), tenantId, runId: run.id, targetCompanyId, sourceCompanyId: row.sourceCompanyId, sourceEntity: 'categories', sourceId: row.sourceCategoryId, targetEntity: 'FINANCE_CATEGORY', targetId: target.id, transformVersion: 'nurix-category-semantic/v1', sourceChecksum } });
      created += 1;
    }
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, actorUserId: actor.id, action: 'nurix_migration.semantic_categories_mapped', entityType: 'LegacyMigrationRun', entityId: run.id, requestId: randomUUID(), afterJson: { created, reused, total: rows.length, transformVersion: 'nurix-category-semantic/v1', sourceFingerprint: run.sourceFingerprint } } });
    return { created, reused, total: rows.length };
  });
  console.log(JSON.stringify(receipt));
} finally {
  await database.onModuleDestroy();
}
