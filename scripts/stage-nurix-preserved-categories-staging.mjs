/**
 * Creates company-scoped categories for Noorix rows that have no safe merge
 * target. The original name, category kind, account link, and tree are
 * preserved; `NX-` prevents a collision with a Baseer-owned code. This script
 * writes master data and immutable mapping evidence only—never documents,
 * journals, balances, or payments.
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
if (!rows.length || rows.length > 200) throw new Error('Between one and two hundred source category rows are required.');
const kindBySourceType = Object.freeze({ expense: 'EXPENSE', purchase: 'PURCHASE', sale: 'SALE' });
for (const row of rows) {
  const kind = kindBySourceType[String(row?.type ?? '').trim().toLowerCase()];
  if (!row || typeof row !== 'object' || typeof row.sourceCompanyId !== 'string' || typeof row.sourceCategoryId !== 'string' || typeof row.sourceAccountId !== 'string' || typeof row.code !== 'string' || typeof row.nameAr !== 'string' || !row.sourceCompanyId || !row.sourceCategoryId || !row.sourceAccountId || !row.code.trim() || !row.nameAr.trim() || !kind || (row.sourceParentCategoryId != null && typeof row.sourceParentCategoryId !== 'string')) {
    throw new Error('Invalid minimum source category input.');
  }
  if (`NX-${row.code.trim()}`.length > 80) throw new Error('The preserved target category code would exceed 80 characters.');
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
      tx.legacyMigrationRecordMap.findMany({ where: { tenantId, runId: run.id, sourceEntity: { in: ['accounts', 'categories'] } }, select: { sourceCompanyId: true, sourceEntity: true, sourceId: true, targetCompanyId: true, targetId: true, targetEntity: true, transformVersion: true, sourceChecksum: true } }),
    ]);
    if (!actor) throw new Error('The selected staging login is not an owner for this tenant.');
    if (!actions.some((item) => item.action === 'APPROVE_COMPANY_MAPS' && item.actionKey === 'ALL_PLANNED_COMPANY_MAPS') || !actions.some((item) => item.action === 'APPROVE_DIRECT_CANDIDATES' && item.actionKey === 'CATEGORY_DIRECT') || !actions.some((item) => item.action === 'APPROVE_DIRECT_CANDIDATES' && item.actionKey === 'ACCOUNT_CODE_TYPE') || companyMaps.some((item) => item.state !== 'PLANNED')) {
      throw new Error('Approved company, direct-category, and direct-account maps are required.');
    }
    const targetCompanyBySource = new Map(companyMaps.map((item) => [item.sourceCompanyId, item.targetCompanyId]));
    const accountTargetBySource = new Map(recordMaps.filter((item) => item.sourceEntity === 'accounts' && ['nurix-account-code-type/v1', 'nurix-account-preserve/v1'].includes(item.transformVersion)).map((item) => [sourceKey(item.sourceCompanyId, item.sourceId), item]));
    const categoryTargetBySource = new Map(recordMaps.filter((item) => item.sourceEntity === 'categories').map((item) => [sourceKey(item.sourceCompanyId, item.sourceId), item.targetId]));
    const pending = new Map(rows.map((row) => [sourceKey(row.sourceCompanyId, row.sourceCategoryId), row]));
    let created = 0;
    let reused = 0;
    while (pending.size) {
      let progressed = false;
      for (const [key, row] of [...pending]) {
        const targetCompanyId = targetCompanyBySource.get(row.sourceCompanyId);
        const accountMap = accountTargetBySource.get(sourceKey(row.sourceCompanyId, row.sourceAccountId));
        if (!targetCompanyId || !accountMap || accountMap.targetCompanyId !== targetCompanyId || accountMap.targetEntity !== 'FinanceAccount') {
          throw new Error('Every preserved category requires an approved account map in the same target company.');
        }
        const parentId = row.sourceParentCategoryId ? categoryTargetBySource.get(sourceKey(row.sourceCompanyId, row.sourceParentCategoryId)) : null;
        if (row.sourceParentCategoryId && !parentId) continue;
        const code = `NX-${row.code.trim()}`;
        const kind = kindBySourceType[row.type.trim().toLowerCase()];
        const sourceChecksum = hash({ version: 'nurix-category-preserve/v1', sourceCompanyId: row.sourceCompanyId, sourceCategoryId: row.sourceCategoryId, sourceAccountId: row.sourceAccountId, sourceParentCategoryId: row.sourceParentCategoryId ?? null, sourceCode: row.code.trim(), targetCode: code, nameAr: row.nameAr.trim(), nameEn: typeof row.nameEn === 'string' ? row.nameEn.trim() : null, kind, sortOrder: Number.isInteger(row.sortOrder) ? row.sortOrder : 0 });
        const existing = await tx.legacyMigrationRecordMap.findFirst({ where: { tenantId, runId: run.id, sourceEntity: 'categories', sourceId: row.sourceCategoryId }, select: { targetCompanyId: true, targetEntity: true, targetId: true, transformVersion: true, sourceChecksum: true } });
        if (existing) {
          if (existing.targetCompanyId !== targetCompanyId || existing.targetEntity !== 'FINANCE_CATEGORY' || existing.transformVersion !== 'nurix-category-preserve/v1' || existing.sourceChecksum !== sourceChecksum) throw new Error('Existing preserved category map differs from immutable source evidence.');
          categoryTargetBySource.set(key, existing.targetId);
          pending.delete(key);
          reused += 1;
          progressed = true;
          continue;
        }
        const conflict = await tx.financeCategory.findFirst({ where: { tenantId, companyId: targetCompanyId, code }, select: { id: true } });
        if (conflict) throw new Error('A target category already uses the preserved NX code; explicit reconciliation is required.');
        const category = await tx.financeCategory.create({ data: { id: randomUUID(), tenantId, companyId: targetCompanyId, parentId, accountId: accountMap.targetId, code, nameAr: row.nameAr.trim(), nameEn: typeof row.nameEn === 'string' && row.nameEn.trim() ? row.nameEn.trim() : row.nameAr.trim(), kind, status: 'ACTIVE', isPosting: true, sortOrder: Number.isInteger(row.sortOrder) ? row.sortOrder : 0 } });
        await tx.legacyMigrationRecordMap.create({ data: { id: randomUUID(), tenantId, runId: run.id, targetCompanyId, sourceCompanyId: row.sourceCompanyId, sourceEntity: 'categories', sourceId: row.sourceCategoryId, targetEntity: 'FINANCE_CATEGORY', targetId: category.id, transformVersion: 'nurix-category-preserve/v1', sourceChecksum } });
        categoryTargetBySource.set(key, category.id);
        pending.delete(key);
        created += 1;
        progressed = true;
      }
      if (!progressed) throw new Error('Cannot preserve category tree: a parent source category is absent or unresolved.');
    }
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, actorUserId: actor.id, action: 'nurix_migration.categories_preserved', entityType: 'LegacyMigrationRun', entityId: run.id, requestId: randomUUID(), afterJson: { created, reused, total: rows.length, transformVersion: 'nurix-category-preserve/v1', sourceFingerprint: run.sourceFingerprint } } });
    return { created, reused, total: rows.length };
  });
  console.log(JSON.stringify(receipt));
} finally {
  await database.onModuleDestroy();
}
