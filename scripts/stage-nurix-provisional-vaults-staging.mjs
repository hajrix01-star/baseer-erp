/**
 * Creates only company-scoped Noorix vault foundations in the isolated staging
 * database. It accepts JSONL from a verified archive extract; it never reads
 * an archive path, posts a document, or imports a balance.
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
if (!rows.length || rows.length > 100) throw new Error('Between one and one hundred source vault rows are required.');
const sourceId = /^[A-Za-z0-9_-]{1,160}$/;
for (const row of rows) {
  if (!row || typeof row !== 'object' || !sourceId.test(row.sourceCompanyId) || !sourceId.test(row.sourceVaultId) || !sourceId.test(row.sourceAccountId) || typeof row.nameAr !== 'string' || !row.nameAr.trim() || row.nameAr.length > 160 || (row.nameEn != null && (typeof row.nameEn !== 'string' || row.nameEn.length > 160))) throw new Error('Invalid minimum source vault input.');
}

function vaultPolicy(row) {
  const type = String(row.type ?? '').trim().toLowerCase();
  const payment = String(row.paymentMethod ?? '').trim().toLowerCase();
  if (type === 'cash' && payment === 'cash') return { type: 'CASH', paymentMethod: 'CASH', paymentMethods: ['CASH'] };
  if (type === 'bank' && payment === 'transfer') return { type: 'BANK', paymentMethod: 'BANK_TRANSFER', paymentMethods: ['BANK_TRANSFER'] };
  if (type === 'bank' && payment === 'card') return { type: 'BANK', paymentMethod: 'BANK_CARD', paymentMethods: ['BANK_CARD'] };
  if (type === 'bank' && payment === 'bank') return { type: 'BANK', paymentMethod: 'BANK_PAYMENT', paymentMethods: ['BANK_PAYMENT'] };
  if (type === 'app' && !payment) return { type: 'APP', paymentMethod: 'APP', paymentMethods: ['APP'] };
  // The archive has two APP vaults that also accepted transfers. Preserve both
  // methods rather than treating them as bank vaults or silently discarding it.
  if (type === 'app' && payment === 'transfer') return { type: 'APP', paymentMethod: 'APP', paymentMethods: ['APP', 'BANK_TRANSFER'] };
  throw new Error(`Unsupported vault type/payment pair: ${type}/${payment || '<empty>'}.`);
}
function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sourceEntity(sourceCompanyId) { return `VAULT_${hash({ sourceCompanyId }).slice(0, 24)}`; }

const database = new DatabaseService();
const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
  const run = await tx.legacyMigrationRun.findFirst({ where: { tenantId, sourceSystem: 'NOORIX_POSTGRES_ARCHIVE', status: { in: ['DISCOVERY', 'DRY_RUN'] } }, orderBy: { startedAt: 'desc' }, select: { id: true, sourceFingerprint: true } });
  if (!run) throw new Error('No open Noorix migration run exists in staging.');
  const [maps, approvedActions, actor] = await Promise.all([
    tx.legacyMigrationCompanyMap.findMany({ where: { tenantId, runId: run.id }, select: { sourceCompanyId: true, targetCompanyId: true, state: true } }),
    tx.legacyMigrationReviewAction.findMany({ where: { tenantId, runId: run.id, action: { in: ['APPROVE_COMPANY_MAPS', 'APPROVE_DIRECT_CANDIDATES'] } }, select: { action: true, actionKey: true } }),
    tx.user.findFirst({ where: { tenantId, loginNormalized: actorLogin, tenantAdministrationAssignments: { some: { tenantId, isOwner: true } } }, select: { id: true } }),
  ]);
  const approved = new Set(approvedActions.filter((action) => action.action === 'APPROVE_DIRECT_CANDIDATES').map((action) => action.actionKey));
  if (!approvedActions.some((action) => action.action === 'APPROVE_COMPANY_MAPS' && action.actionKey === 'ALL_PLANNED_COMPANY_MAPS') || !approved.has('ACCOUNT_CODE_TYPE') || maps.some((map) => map.state !== 'PLANNED')) throw new Error('Approved company and direct-account mappings are required.');
  if (!actor) throw new Error('The selected staging login is not an owner for this tenant.');
  const targetCompanyBySource = new Map(maps.map((map) => [map.sourceCompanyId, map.targetCompanyId]));
  const accountMaps = await tx.legacyMigrationRecordMap.findMany({ where: { tenantId, runId: run.id, sourceEntity: 'accounts', transformVersion: 'nurix-account-code-type/v1' }, select: { sourceCompanyId: true, sourceId: true, targetCompanyId: true, targetId: true } });
  const targetAccountBySource = new Map(accountMaps.map((map) => [`${map.sourceCompanyId}:${map.sourceId}`, map]));
  let created = 0;
  let reused = 0;
  for (const row of rows) {
    const targetCompanyId = targetCompanyBySource.get(row.sourceCompanyId);
    const accountMap = targetAccountBySource.get(`${row.sourceCompanyId}:${row.sourceAccountId}`);
    if (!targetCompanyId || !accountMap || accountMap.targetCompanyId !== targetCompanyId) throw new Error('Every vault requires a company-scoped approved account map.');
    const policy = vaultPolicy(row);
    const checksum = hash({ version: 'nurix-provisional-vault/v1', sourceCompanyId: row.sourceCompanyId, sourceVaultId: row.sourceVaultId, sourceAccountId: row.sourceAccountId, nameAr: row.nameAr.trim(), nameEn: row.nameEn?.trim() ?? null, type: row.type, paymentMethod: row.paymentMethod ?? null, isSalesChannel: Boolean(row.isSalesChannel), isPaymentDestination: Boolean(row.isPaymentDestination), sortOrder: Number(row.sortOrder ?? 0) });
    const existingMap = await tx.legacyMigrationRecordMap.findFirst({ where: { tenantId, runId: run.id, sourceEntity: sourceEntity(row.sourceCompanyId), sourceId: row.sourceVaultId }, select: { targetId: true, targetCompanyId: true, targetEntity: true, transformVersion: true, sourceChecksum: true } });
    if (existingMap) {
      if (existingMap.targetCompanyId !== targetCompanyId || existingMap.targetEntity !== 'FINANCE_VAULT' || existingMap.transformVersion !== 'nurix-provisional-vault/v1' || existingMap.sourceChecksum !== checksum) throw new Error('Existing vault map differs from the immutable source evidence.');
      reused += 1;
      continue;
    }
    const nameConflict = await tx.financeVault.findFirst({ where: { tenantId, companyId: targetCompanyId, nameAr: row.nameAr.trim() }, select: { id: true } });
    if (nameConflict) throw new Error('A target vault with the same company-scoped name already exists; explicit matching is required.');
    const vault = await tx.financeVault.create({ data: { id: randomUUID(), tenantId, companyId: targetCompanyId, accountId: accountMap.targetId, nameAr: row.nameAr.trim(), nameEn: row.nameEn?.trim() || row.nameAr.trim(), type: policy.type, paymentMethod: policy.paymentMethod, paymentMethods: policy.paymentMethods, status: 'ACTIVE', isSalesChannel: Boolean(row.isSalesChannel), isPaymentDestination: Boolean(row.isPaymentDestination), sortOrder: Number.isInteger(row.sortOrder) ? row.sortOrder : 0 } });
    await tx.legacyMigrationRecordMap.create({ data: { id: randomUUID(), tenantId, runId: run.id, targetCompanyId, sourceCompanyId: row.sourceCompanyId, sourceEntity: sourceEntity(row.sourceCompanyId), sourceId: row.sourceVaultId, targetEntity: 'FINANCE_VAULT', targetId: vault.id, transformVersion: 'nurix-provisional-vault/v1', sourceChecksum: checksum } });
    created += 1;
  }
  await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, actorUserId: actor.id, action: 'nurix_migration.provisional_vaults_created', entityType: 'LegacyMigrationRun', entityId: run.id, requestId: randomUUID(), afterJson: { created, reused, total: rows.length, sourceFingerprint: run.sourceFingerprint, transformVersion: 'nurix-provisional-vault/v1' } } });
  return { created, reused, total: rows.length };
});
await database.onModuleDestroy();
console.log(JSON.stringify(receipt));
