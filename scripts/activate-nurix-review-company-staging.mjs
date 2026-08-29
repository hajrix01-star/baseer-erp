/**
 * Activates exactly one source-mapped Noorix staging company for owner review.
 * The transaction proves that no financial document or journal exists, turns
 * on the central read-only migration-review lock, and writes an audit event.
 */
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';

const tenantId = process.env.BASEER_MIGRATION_TENANT_ID;
const databaseUrl = process.env.DATABASE_URL;
const actorLogin = process.env.BASEER_MIGRATION_ACTOR_LOGIN?.trim().toLocaleLowerCase();
if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('BASEER_MIGRATION_TENANT_ID must be a UUID.');
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
if (!actorLogin || !actorLogin.includes('@')) throw new Error('BASEER_MIGRATION_ACTOR_LOGIN must be an owner login.');
const parsed = new URL(databaseUrl);
if (parsed.hostname !== '127.0.0.1' || parsed.port !== '5433' || parsed.pathname !== '/baseer_migration_staging') throw new Error('This script only permits local baseer_migration_staging.');

let standardInput = '';
for await (const chunk of process.stdin) standardInput += chunk;
const request = JSON.parse(standardInput.trim() || '{}');
if (!request || typeof request !== 'object' || typeof request.sourceCompanyId !== 'string' || typeof request.nameAr !== 'string' || typeof request.nameEn !== 'string' || !request.sourceCompanyId || !request.nameAr.trim() || !request.nameEn.trim()) throw new Error('sourceCompanyId, nameAr, and nameEn are required.');

const database = new DatabaseService();
try {
  const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
    const run = await tx.legacyMigrationRun.findFirst({ where: { tenantId, sourceSystem: 'NOORIX_POSTGRES_ARCHIVE', status: { in: ['DISCOVERY', 'DRY_RUN'] } }, orderBy: { startedAt: 'desc' }, select: { id: true, sourceFingerprint: true } });
    if (!run) throw new Error('No open Noorix migration run exists in staging.');
    const [actor, companyMap] = await Promise.all([
      tx.user.findFirst({ where: { tenantId, loginNormalized: actorLogin, status: 'ACTIVE', tenantAdministrationAssignments: { some: { tenantId, isOwner: true } } }, select: { id: true } }),
      tx.legacyMigrationCompanyMap.findFirst({ where: { tenantId, runId: run.id, sourceCompanyId: request.sourceCompanyId, state: 'PLANNED' }, select: { targetCompanyId: true } }),
    ]);
    if (!actor) throw new Error('The selected login is not an active staging owner.');
    if (!companyMap) throw new Error('The selected source company has no approved staging company map.');
    const [company, documents, journals] = await Promise.all([
      tx.company.findFirst({ where: { tenantId, id: companyMap.targetCompanyId }, select: { id: true, nameAr: true, nameEn: true, status: true, migrationReviewLocked: true } }),
      tx.financeOutflowDocument.count({ where: { tenantId, companyId: companyMap.targetCompanyId } }),
      tx.financeJournalEntry.count({ where: { tenantId, companyId: companyMap.targetCompanyId } }),
    ]);
    if (!company) throw new Error('Mapped target company is missing.');
    if (documents !== 0 || journals !== 0) throw new Error('A review company must contain no financial documents or journal entries before activation.');
    const before = { nameAr: company.nameAr, nameEn: company.nameEn, status: company.status, migrationReviewLocked: company.migrationReviewLocked };
    await tx.company.update({ where: { id: company.id }, data: { nameAr: request.nameAr.trim(), nameEn: request.nameEn.trim(), status: 'ACTIVE', migrationReviewLocked: true } });
    const after = { nameAr: request.nameAr.trim(), nameEn: request.nameEn.trim(), status: 'ACTIVE', migrationReviewLocked: true, sourceCompanyId: request.sourceCompanyId, documents, journals };
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId: company.id, actorUserId: actor.id, action: 'nurix_migration.review_company_activated_locked', entityType: 'Company', entityId: company.id, requestId: randomUUID(), beforeJson: before, afterJson: after } });
    return { targetCompanyId: company.id, ...after };
  });
  console.log(JSON.stringify(receipt));
} finally {
  await database.onModuleDestroy();
}
