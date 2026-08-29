/**
 * Repairs a source-only Noorix integrity defect: an invoice can reference a
 * supplier owned by another source company. Each such supplier is copied into
 * the invoice company as a separate, company-scoped shell. It never maps a
 * financial document across companies and never imports a document or balance.
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
if (parsed.hostname !== '127.0.0.1' || parsed.port !== '5433' || parsed.pathname !== '/baseer_migration_staging') throw new Error('This script only permits the local baseer_migration_staging database on 127.0.0.1:5433.');

let standardInput = '';
for await (const chunk of process.stdin) standardInput += chunk;
const rows = standardInput.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
if (!rows.length || rows.length > 50) throw new Error('Between one and fifty cross-company source supplier rows are required.');
for (const row of rows) {
  if (!row || typeof row !== 'object' || typeof row.invoiceCompanyId !== 'string' || typeof row.originCompanyId !== 'string' || typeof row.sourceSupplierId !== 'string' || typeof row.nameAr !== 'string' || !row.invoiceCompanyId || !row.originCompanyId || !row.sourceSupplierId || !row.nameAr.trim() || row.invoiceCompanyId === row.originCompanyId) throw new Error('Invalid cross-company supplier source evidence.');
}

function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function supplierSourceEntity(sourceCompanyId) { return `SUPPLIER_${hash({ sourceCompanyId }).slice(0, 24)}`; }
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
    if (!actions.some((item) => item.action === 'APPROVE_COMPANY_MAPS' && item.actionKey === 'ALL_PLANNED_COMPANY_MAPS') || !actions.some((item) => item.action === 'APPROVE_DIRECT_CANDIDATES' && item.actionKey === 'CATEGORY_DIRECT') || companyMaps.some((item) => item.state !== 'PLANNED')) throw new Error('Approved company and category maps are required.');
    const targetCompanyBySource = new Map(companyMaps.map((item) => [item.sourceCompanyId, item.targetCompanyId]));
    let created = 0;
    let reused = 0;
    for (const row of rows) {
      const targetCompanyId = targetCompanyBySource.get(row.invoiceCompanyId);
      if (!targetCompanyId) throw new Error('The source invoice company has no approved target company.');
      const originMap = await tx.legacyMigrationRecordMap.findFirst({ where: { tenantId, runId: run.id, sourceCompanyId: row.originCompanyId, sourceEntity: supplierSourceEntity(row.originCompanyId), sourceId: row.sourceSupplierId, targetEntity: 'FINANCE_SUPPLIER', transformVersion: 'nurix-provisional-supplier/v1' }, select: { targetId: true } });
      if (!originMap) throw new Error('The origin supplier must already have a preserved company-scoped target shell.');
      const originSupplier = await tx.financeSupplier.findFirst({ where: { tenantId, id: originMap.targetId }, select: { counterpartyIdentityId: true } });
      if (!originSupplier) throw new Error('The mapped origin supplier no longer exists in staging.');
      const sourceChecksum = hash({ version: 'nurix-cross-company-supplier-preserve/v1', invoiceCompanyId: row.invoiceCompanyId, originCompanyId: row.originCompanyId, sourceSupplierId: row.sourceSupplierId, nameAr: row.nameAr.trim(), nameEn: typeof row.nameEn === 'string' ? row.nameEn.trim() : null });
      const existing = await tx.legacyMigrationRecordMap.findFirst({ where: { tenantId, runId: run.id, sourceCompanyId: row.invoiceCompanyId, sourceEntity: supplierSourceEntity(row.invoiceCompanyId), sourceId: row.sourceSupplierId }, select: { targetCompanyId: true, targetEntity: true, targetId: true, transformVersion: true, sourceChecksum: true } });
      if (existing) {
        if (existing.targetCompanyId !== targetCompanyId || existing.targetEntity !== 'FINANCE_SUPPLIER' || existing.transformVersion !== 'nurix-cross-company-supplier-preserve/v1' || existing.sourceChecksum !== sourceChecksum) throw new Error('Existing cross-company supplier map differs from immutable source evidence.');
        reused += 1;
        continue;
      }
      const supplier = await tx.financeSupplier.create({ data: { id: randomUUID(), tenantId, companyId: targetCompanyId, counterpartyIdentityId: originSupplier.counterpartyIdentityId, categoryId: null, supplierType: 'EXPENSE', nameAr: row.nameAr.trim(), nameEn: typeof row.nameEn === 'string' && row.nameEn.trim() ? row.nameEn.trim() : null, status: 'ACTIVE' } });
      await tx.legacyMigrationRecordMap.create({ data: { id: randomUUID(), tenantId, runId: run.id, targetCompanyId, sourceCompanyId: row.invoiceCompanyId, sourceEntity: supplierSourceEntity(row.invoiceCompanyId), sourceId: row.sourceSupplierId, targetEntity: 'FINANCE_SUPPLIER', targetId: supplier.id, transformVersion: 'nurix-cross-company-supplier-preserve/v1', sourceChecksum } });
      created += 1;
    }
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, actorUserId: actor.id, action: 'nurix_migration.cross_company_suppliers_preserved', entityType: 'LegacyMigrationRun', entityId: run.id, requestId: randomUUID(), afterJson: { created, reused, total: rows.length, transformVersion: 'nurix-cross-company-supplier-preserve/v1', sourceFingerprint: run.sourceFingerprint } } });
    return { created, reused, total: rows.length };
  });
  console.log(JSON.stringify(receipt));
} finally {
  await database.onModuleDestroy();
}
