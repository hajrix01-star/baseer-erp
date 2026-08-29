/**
 * Preserves Noorix vaults that are already inactive/archived but are still
 * referenced by historical documents. Target vaults are created ARCHIVED so
 * they cannot become live payment destinations. No payment, balance, document
 * or journal is created here.
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
if (!rows.length || rows.length > 50) throw new Error('Between one and fifty archived source vault rows are required.');
for (const row of rows) {
  if (!row || typeof row !== 'object' || typeof row.sourceCompanyId !== 'string' || typeof row.sourceVaultId !== 'string' || typeof row.sourceAccountId !== 'string' || typeof row.nameAr !== 'string' || !row.sourceCompanyId || !row.sourceVaultId || !row.sourceAccountId || !row.nameAr.trim() || (row.isActive === true && row.isArchived !== true)) throw new Error('Only inactive or archived source vault rows are accepted.');
}

function hash(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sourceEntity(sourceCompanyId) { return `VAULT_${hash({ sourceCompanyId }).slice(0, 24)}`; }
function vaultPolicy(row) {
  const type = String(row.type ?? '').trim().toLowerCase();
  const payment = String(row.paymentMethod ?? '').trim().toLowerCase();
  if (type === 'cash' && payment === 'cash') return { type: 'CASH', paymentMethod: 'CASH', paymentMethods: ['CASH'] };
  // One archived Noorix cash vault omitted payment_method. Its vault type is
  // still unambiguous, and it remains ARCHIVED in Baseer.
  if (type === 'cash' && !payment) return { type: 'CASH', paymentMethod: 'CASH', paymentMethods: ['CASH'] };
  if (type === 'bank' && payment === 'transfer') return { type: 'BANK', paymentMethod: 'BANK_TRANSFER', paymentMethods: ['BANK_TRANSFER'] };
  if (type === 'bank' && payment === 'card') return { type: 'BANK', paymentMethod: 'BANK_CARD', paymentMethods: ['BANK_CARD'] };
  if (type === 'bank' && payment === 'bank') return { type: 'BANK', paymentMethod: 'BANK_PAYMENT', paymentMethods: ['BANK_PAYMENT'] };
  if (type === 'app' && !payment) return { type: 'APP', paymentMethod: 'APP', paymentMethods: ['APP'] };
  if (type === 'app' && payment === 'transfer') return { type: 'APP', paymentMethod: 'APP', paymentMethods: ['APP', 'BANK_TRANSFER'] };
  throw new Error(`Unsupported vault type/payment pair: ${type}/${payment || '<empty>'}.`);
}

const database = new DatabaseService();
try {
  const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
    const run = await tx.legacyMigrationRun.findFirst({ where: { tenantId, sourceSystem: 'NOORIX_POSTGRES_ARCHIVE', status: { in: ['DISCOVERY', 'DRY_RUN'] } }, orderBy: { startedAt: 'desc' }, select: { id: true, sourceFingerprint: true } });
    if (!run) throw new Error('No open Noorix migration run exists in staging.');
    const [companyMaps, actions, actor, accountMaps] = await Promise.all([
      tx.legacyMigrationCompanyMap.findMany({ where: { tenantId, runId: run.id }, select: { sourceCompanyId: true, targetCompanyId: true, state: true } }),
      tx.legacyMigrationReviewAction.findMany({ where: { tenantId, runId: run.id, action: { in: ['APPROVE_COMPANY_MAPS', 'APPROVE_DIRECT_CANDIDATES'] } }, select: { action: true, actionKey: true } }),
      tx.user.findFirst({ where: { tenantId, loginNormalized: actorLogin, tenantAdministrationAssignments: { some: { tenantId, isOwner: true } } }, select: { id: true } }),
      tx.legacyMigrationRecordMap.findMany({ where: { tenantId, runId: run.id, sourceEntity: 'accounts', transformVersion: { in: ['nurix-account-code-type/v1', 'nurix-account-preserve/v1'] } }, select: { sourceCompanyId: true, sourceId: true, targetCompanyId: true, targetId: true } }),
    ]);
    if (!actor) throw new Error('The selected staging login is not an owner for this tenant.');
    if (!actions.some((item) => item.action === 'APPROVE_COMPANY_MAPS' && item.actionKey === 'ALL_PLANNED_COMPANY_MAPS') || !actions.some((item) => item.action === 'APPROVE_DIRECT_CANDIDATES' && item.actionKey === 'ACCOUNT_CODE_TYPE') || companyMaps.some((item) => item.state !== 'PLANNED')) throw new Error('Approved company and account maps are required.');
    const targetCompanyBySource = new Map(companyMaps.map((item) => [item.sourceCompanyId, item.targetCompanyId]));
    const accountTargetBySource = new Map(accountMaps.map((item) => [`${item.sourceCompanyId}:${item.sourceId}`, item]));
    let created = 0;
    let reused = 0;
    for (const row of rows) {
      const targetCompanyId = targetCompanyBySource.get(row.sourceCompanyId);
      const accountMap = accountTargetBySource.get(`${row.sourceCompanyId}:${row.sourceAccountId}`);
      if (!targetCompanyId || !accountMap || accountMap.targetCompanyId !== targetCompanyId) throw new Error('Every archived vault requires a company-scoped account map.');
      const policy = vaultPolicy(row);
      const sourceChecksum = hash({ version: 'nurix-archived-vault/v1', sourceCompanyId: row.sourceCompanyId, sourceVaultId: row.sourceVaultId, sourceAccountId: row.sourceAccountId, nameAr: row.nameAr.trim(), nameEn: typeof row.nameEn === 'string' ? row.nameEn.trim() : null, type: row.type, paymentMethod: row.paymentMethod ?? null, isSalesChannel: Boolean(row.isSalesChannel), isPaymentDestination: Boolean(row.isPaymentDestination), sortOrder: Number(row.sortOrder ?? 0) });
      const existing = await tx.legacyMigrationRecordMap.findFirst({ where: { tenantId, runId: run.id, sourceEntity: sourceEntity(row.sourceCompanyId), sourceId: row.sourceVaultId }, select: { targetCompanyId: true, targetEntity: true, targetId: true, transformVersion: true, sourceChecksum: true } });
      if (existing) {
        if (existing.targetCompanyId !== targetCompanyId || existing.targetEntity !== 'FINANCE_VAULT' || existing.transformVersion !== 'nurix-archived-vault/v1' || existing.sourceChecksum !== sourceChecksum) throw new Error('Existing archived vault map differs from immutable source evidence.');
        reused += 1;
        continue;
      }
      const conflict = await tx.financeVault.findFirst({ where: { tenantId, companyId: targetCompanyId, nameAr: row.nameAr.trim() }, select: { id: true } });
      if (conflict) throw new Error('A target vault with the same company-scoped name already exists; explicit matching is required.');
      const vault = await tx.financeVault.create({ data: { id: randomUUID(), tenantId, companyId: targetCompanyId, accountId: accountMap.targetId, nameAr: row.nameAr.trim(), nameEn: typeof row.nameEn === 'string' && row.nameEn.trim() ? row.nameEn.trim() : row.nameAr.trim(), type: policy.type, paymentMethod: policy.paymentMethod, paymentMethods: policy.paymentMethods, status: 'ARCHIVED', isSalesChannel: false, isPaymentDestination: false, sortOrder: Number.isInteger(row.sortOrder) ? row.sortOrder : 0 } });
      await tx.legacyMigrationRecordMap.create({ data: { id: randomUUID(), tenantId, runId: run.id, targetCompanyId, sourceCompanyId: row.sourceCompanyId, sourceEntity: sourceEntity(row.sourceCompanyId), sourceId: row.sourceVaultId, targetEntity: 'FINANCE_VAULT', targetId: vault.id, transformVersion: 'nurix-archived-vault/v1', sourceChecksum } });
      created += 1;
    }
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, actorUserId: actor.id, action: 'nurix_migration.archived_vaults_preserved', entityType: 'LegacyMigrationRun', entityId: run.id, requestId: randomUUID(), afterJson: { created, reused, total: rows.length, transformVersion: 'nurix-archived-vault/v1', sourceFingerprint: run.sourceFingerprint } } });
    return { created, reused, total: rows.length };
  });
  console.log(JSON.stringify(receipt));
} finally {
  await database.onModuleDestroy();
}
