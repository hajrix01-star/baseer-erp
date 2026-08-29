/**
 * Copies the minimum supplier identity evidence into the local staging review
 * queue. It accepts JSONL on stdin and refuses every database except the
 * dedicated local staging database. It never creates FinanceSupplier rows.
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
if (rows.length > 1_000) throw new Error('At most 1,000 source supplier rows may be staged at once.');
for (const row of rows) {
  if (!row || typeof row !== 'object' || !sourceId.test(row.sourceCompanyId) || !sourceId.test(row.sourceSupplierId) || typeof row.nameAr !== 'string' || row.nameAr.length > 160 || (row.nameEn !== undefined && row.nameEn !== null && typeof row.nameEn !== 'string') || row.nameEn?.length > 160) throw new Error('Invalid minimal source supplier identity input.');
}

const candidates = rows.map((row) => {
  const arabic = resolveNurixCounterpartyAlias(row.nameAr, NURIX_COUNTERPARTY_ALIAS_SEED);
  const english = row.nameEn?.trim() ? resolveNurixCounterpartyAlias(row.nameEn, NURIX_COUNTERPARTY_ALIAS_SEED) : null;
  if (arabic.status === 'MATCHED' && english?.status === 'MATCHED' && arabic.canonicalKey !== english.canonicalKey) throw new Error('Conflicting explicit aliases for one source supplier.');
  const matched = arabic.status === 'MATCHED' || english?.status === 'MATCHED';
  return {
    ...row,
    kind: matched ? 'EXPLICIT_ALIAS' : 'REVIEW_REQUIRED',
    sourceChecksum: createHash('sha256').update(JSON.stringify({ version: 'nurix-counterparty-explicit-alias/v1', sourceCompanyId: row.sourceCompanyId, sourceSupplierId: row.sourceSupplierId, canonicalKey: arabic.status === 'MATCHED' ? arabic.canonicalKey : english?.canonicalKey ?? null, name: normalizeNurixCounterpartyAlias(row.nameAr) })).digest('hex'),
  };
});

const database = new DatabaseService();
const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
  const run = await tx.legacyMigrationRun.findFirst({ where: { tenantId, sourceSystem: 'NOORIX_POSTGRES_ARCHIVE', status: 'DISCOVERY' }, orderBy: { startedAt: 'desc' }, select: { id: true } });
  if (!run) throw new Error('No open Noorix discovery run exists in staging.');
  let staged = 0;
  let reviewRequired = 0;
  let explicitAlias = 0;
  for (const candidate of candidates) {
    const existing = await tx.legacyMigrationCounterpartyCandidate.findFirst({ where: { runId: run.id, sourceCompanyId: candidate.sourceCompanyId, sourceSupplierId: candidate.sourceSupplierId } });
    if (existing) {
      const differences = [
        existing.nameAr !== candidate.nameAr ? 'arabic-name' : null,
        existing.nameEn !== (candidate.nameEn ?? null) ? 'english-name' : null,
        existing.kind !== candidate.kind ? 'classification' : null,
        existing.sourceChecksum !== candidate.sourceChecksum ? 'checksum' : null,
      ].filter(Boolean);
      if (differences.length) {
        const existingArabicHash = createHash('sha256').update(existing.nameAr).digest('hex').slice(0, 12);
        const incomingArabicHash = createHash('sha256').update(candidate.nameAr).digest('hex').slice(0, 12);
        throw new Error(`Existing staged supplier candidate differs from the frozen source snapshot (${differences.join(', ')}; existingArabicHash=${existingArabicHash}; incomingArabicHash=${incomingArabicHash}).`);
      }
    } else {
      await tx.legacyMigrationCounterpartyCandidate.create({ data: { id: randomUUID(), tenantId, runId: run.id, sourceCompanyId: candidate.sourceCompanyId, sourceSupplierId: candidate.sourceSupplierId, nameAr: candidate.nameAr, nameEn: candidate.nameEn ?? null, kind: candidate.kind, sourceChecksum: candidate.sourceChecksum } });
    }
    staged += 1;
    if (candidate.kind === 'REVIEW_REQUIRED') reviewRequired += 1;
    else explicitAlias += 1;
  }
  return { staged, explicitAlias, reviewRequired };
});
await database.onModuleDestroy();
console.log(JSON.stringify(receipt));
