/**
 * Seeds the reviewed Noorix counterparty identity catalogue into the only
 * allowed local staging database. It never reads the source archive, creates
 * FinanceSupplier rows, resolves source suppliers, or changes an existing row.
 *
 * Required: DATABASE_URL, BASEER_MIGRATION_TENANT_ID
 */
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { NURIX_COUNTERPARTY_ALIAS_SEED, assertNurixCounterpartyAliasSeedIsSafe, normalizeNurixCounterpartyAlias } from '../apps/api/dist/nurix-migration/nurix-counterparty-alias-resolution.js';

const tenantId = process.env.BASEER_MIGRATION_TENANT_ID;
const databaseUrl = process.env.DATABASE_URL;
if (!tenantId || !/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('BASEER_MIGRATION_TENANT_ID must be a UUID.');
if (!databaseUrl) throw new Error('DATABASE_URL is required.');
const parsed = new URL(databaseUrl);
if (parsed.hostname !== '127.0.0.1' || parsed.port !== '5433' || parsed.pathname !== '/baseer_migration_staging') throw new Error('This script only permits the local baseer_migration_staging database on 127.0.0.1:5433.');

assertNurixCounterpartyAliasSeedIsSafe();
const database = new DatabaseService();
await database.inTenantTransaction(tenantId, async (tx) => {
  const identities = new Map();
  for (const item of NURIX_COUNTERPARTY_ALIAS_SEED) {
    const existing = identities.get(item.canonicalKey);
    if (existing && (existing.canonicalNameAr !== item.canonicalNameAr || existing.canonicalNameEn !== (item.canonicalNameEn ?? null) || existing.kind !== item.kind)) throw new Error(`Inconsistent identity seed: ${item.canonicalKey}`);
    identities.set(item.canonicalKey, { canonicalNameAr: item.canonicalNameAr, canonicalNameEn: item.canonicalNameEn ?? null, kind: item.kind });
  }
  const ids = new Map();
  for (const [canonicalKey, identity] of identities) {
    const existing = await tx.financeCounterpartyIdentity.findFirst({ where: { tenantId, canonicalKey } });
    if (existing) {
      if (existing.canonicalNameAr !== identity.canonicalNameAr || existing.canonicalNameEn !== identity.canonicalNameEn || existing.kind !== identity.kind) throw new Error(`Existing identity differs from reviewed seed: ${canonicalKey}`);
      ids.set(canonicalKey, existing.id);
    } else {
      const created = await tx.financeCounterpartyIdentity.create({ data: { id: randomUUID(), tenantId, canonicalKey, ...identity } });
      ids.set(canonicalKey, created.id);
    }
  }
  for (const item of NURIX_COUNTERPARTY_ALIAS_SEED) {
    const normalizedAlias = normalizeNurixCounterpartyAlias(item.alias);
    const existing = await tx.financeCounterpartyAlias.findFirst({ where: { tenantId, normalizedAlias } });
    const identityId = ids.get(item.canonicalKey);
    if (!identityId) throw new Error(`Missing seeded identity: ${item.canonicalKey}`);
    if (existing) {
      if (existing.identityId !== identityId || existing.kind !== item.aliasKind) throw new Error(`Existing alias differs from reviewed seed: ${normalizedAlias}`);
      continue;
    }
    await tx.financeCounterpartyAlias.create({ data: { id: randomUUID(), tenantId, identityId, normalizedAlias, nameAr: /[\u0600-\u06FF]/.test(item.alias) ? item.alias : null, nameEn: /[A-Za-z]/.test(item.alias) ? item.alias : null, kind: item.aliasKind } });
  }
});
await database.onModuleDestroy();
console.log(createHash('sha256').update(JSON.stringify(NURIX_COUNTERPARTY_ALIAS_SEED.map(({ canonicalKey, alias, aliasKind }) => ({ canonicalKey, alias, aliasKind })))).digest('hex'));
