/**
 * Reads line-delimited, minimal supplier identity facts from stdin and records
 * only explicit-alias identity resolutions in local staging. It intentionally
 * stores no supplier name or source payload: the name participates only in a
 * checksum. Unknown names are counted for review and never inserted.
 *
 * Required: DATABASE_URL, BASEER_MIGRATION_TENANT_ID
 * stdin JSONL: { sourceCompanyId, sourceSupplierId, nameAr, nameEn? }
 */
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { NURIX_COUNTERPARTY_ALIAS_SEED, assertNurixCounterpartyAliasSeedIsSafe, normalizeNurixCounterpartyAlias, resolveNurixCounterpartyAlias } from '../apps/api/dist/nurix-migration/nurix-counterparty-alias-resolution.js';

const tenantId = process.env.BASEER_MIGRATION_TENANT_ID;
const databaseUrl = process.env.DATABASE_URL;
if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('BASEER_MIGRATION_TENANT_ID must be a UUID.');
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const parsed = new URL(databaseUrl);
if (parsed.hostname !== '127.0.0.1' || parsed.port !== '5433' || parsed.pathname !== '/baseer_migration_staging') throw new Error('This script only permits the local baseer_migration_staging database on 127.0.0.1:5433.');
assertNurixCounterpartyAliasSeedIsSafe();

const sourceId = /^[A-Za-z0-9_-]{1,160}$/;
let standardInput = '';
for await (const chunk of process.stdin) standardInput += chunk;
const rows = standardInput.trim().split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
if (rows.length > 1_000) throw new Error('At most 1,000 source supplier rows may be planned at once.');
for (const row of rows) {
  if (!row || typeof row !== 'object' || !sourceId.test(row.sourceCompanyId) || !sourceId.test(row.sourceSupplierId) || typeof row.nameAr !== 'string' || row.nameAr.length > 160 || (row.nameEn !== undefined && row.nameEn !== null && typeof row.nameEn !== 'string')) throw new Error('Invalid minimal source supplier identity input.');
}

const candidates = rows.map((row) => {
  const arabic = resolveNurixCounterpartyAlias(row.nameAr, NURIX_COUNTERPARTY_ALIAS_SEED);
  const english = row.nameEn?.trim() ? resolveNurixCounterpartyAlias(row.nameEn, NURIX_COUNTERPARTY_ALIAS_SEED) : null;
  if (arabic.status === 'MATCHED' && english?.status === 'MATCHED' && arabic.canonicalKey !== english.canonicalKey) throw new Error('Conflicting explicit aliases for one source supplier.');
  const match = arabic.status === 'MATCHED' ? arabic : english?.status === 'MATCHED' ? english : null;
  return { ...row, match };
});

const database = new DatabaseService();
const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
  const run = await tx.legacyMigrationRun.findFirst({ where: { tenantId, sourceSystem: 'NOORIX_POSTGRES_ARCHIVE', status: 'DISCOVERY' }, orderBy: { startedAt: 'desc' }, select: { id: true, sourceFingerprint: true } });
  if (!run) throw new Error('No open Noorix discovery run exists in staging.');
  const identities = await tx.financeCounterpartyIdentity.findMany({ where: { tenantId, canonicalKey: { in: [...new Set(candidates.flatMap((candidate) => candidate.match?.status === 'MATCHED' ? [candidate.match.canonicalKey] : []))] } }, select: { id: true, canonicalKey: true } });
  const identityIdByKey = new Map(identities.map((identity) => [identity.canonicalKey, identity.id]));
  let planned = 0;
  let reviewRequired = 0;
  for (const candidate of candidates) {
    if (!candidate.match || candidate.match.status !== 'MATCHED') { reviewRequired += 1; continue; }
    const identityId = identityIdByKey.get(candidate.match.canonicalKey);
    if (!identityId) throw new Error(`Reviewed counterparty identity is missing: ${candidate.match.canonicalKey}`);
    const sourceChecksum = createHash('sha256').update(JSON.stringify({ version: 'nurix-counterparty-explicit-alias/v1', sourceCompanyId: candidate.sourceCompanyId, sourceSupplierId: candidate.sourceSupplierId, canonicalKey: candidate.match.canonicalKey, name: normalizeNurixCounterpartyAlias(candidate.nameAr) })).digest('hex');
    const existing = await tx.legacyMigrationCounterpartyResolution.findFirst({ where: { runId: run.id, sourceCompanyId: candidate.sourceCompanyId, sourceSupplierId: candidate.sourceSupplierId } });
    if (existing) {
      if (existing.identityId !== identityId || existing.kind !== 'EXPLICIT_ALIAS' || existing.transformVersion !== 'nurix-counterparty-explicit-alias/v1' || existing.sourceChecksum !== sourceChecksum) throw new Error('Existing source supplier identity resolution differs from this reviewed plan.');
      planned += 1;
      continue;
    }
    await tx.legacyMigrationCounterpartyResolution.create({ data: { id: randomUUID(), tenantId, runId: run.id, sourceCompanyId: candidate.sourceCompanyId, sourceSupplierId: candidate.sourceSupplierId, identityId, kind: 'EXPLICIT_ALIAS', transformVersion: 'nurix-counterparty-explicit-alias/v1', sourceChecksum } });
    planned += 1;
  }
  return { planned, reviewRequired, sourceRows: candidates.length };
});
await database.onModuleDestroy();
console.log(JSON.stringify(receipt));
