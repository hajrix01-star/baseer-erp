/**
 * Owner-approved correction of Doha supplier defaults only.
 * It never changes documents, journals, amounts, or the FinanceCategory tree.
 *
 * Usage:
 *   node scripts/run-local-doha-legacy-food-defaults-to-plastics.mjs DRY_RUN
 *   node scripts/run-local-doha-legacy-food-defaults-to-plastics.mjs APPLY_APPROVED_DOHA_LEGACY_FOOD_DEFAULTS_TO_PLASTICS_V1 [actor-user-id]
 */
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

const DRY_RUN = 'DRY_RUN';
const APPLY = 'APPLY_APPROVED_DOHA_LEGACY_FOOD_DEFAULTS_TO_PLASTICS_V1';
const VERSION = 'doha-legacy-food-defaults-to-plastics/v1';
const TENANT_ID = '6ffae759-800e-4653-8543-51013f5ef751';
const COMPANY_ID = '3c032ff1-c00d-4784-99ae-a9bf53e09e0d';
const DEFAULT_ACTOR_ID = 'c89fb913-2f7c-404e-84d7-161146766f77';
const SOURCE_CATEGORY = Object.freeze({ code: 'PUR-001-LEGACY', nameAr: 'مواد غذائية — غير مفصل في نوركس' });
const TARGET_CATEGORY = Object.freeze({ code: 'P3-1', nameAr: 'بلاستيكات' });
const [mode, actorUserId = DEFAULT_ACTOR_ID] = process.argv.slice(2);
if (![DRY_RUN, APPLY].includes(mode ?? '') || !/^[0-9a-f-]{36}$/i.test(actorUserId)) throw new Error(`Usage: node scripts/run-local-doha-legacy-food-defaults-to-plastics.mjs ${DRY_RUN}|${APPLY} [actor-user-id]`);

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') throw new Error('This writer only permits the canonical local Baseer test database.');
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

async function categories(client) {
  const result = await client.query(`
    SELECT id, code, "nameAr", kind, status, "isPosting"
    FROM "FinanceCategory"
    WHERE "tenantId" = $1 AND "companyId" = $2
      AND code IN ($3, $4)
    ORDER BY code
  `, [TENANT_ID, COMPANY_ID, SOURCE_CATEGORY.code, TARGET_CATEGORY.code]);
  const byCode = new Map(result.rows.map((row) => [row.code, row]));
  const source = byCode.get(SOURCE_CATEGORY.code);
  const target = byCode.get(TARGET_CATEGORY.code);
  if (!source || source.nameAr !== SOURCE_CATEGORY.nameAr || source.kind !== 'PURCHASE' || source.status !== 'ACTIVE' || !source.isPosting) throw new Error('The expected legacy food posting category is unavailable or changed.');
  if (!target || target.nameAr !== TARGET_CATEGORY.nameAr || target.kind !== 'PURCHASE' || target.status !== 'ACTIVE' || !target.isPosting) throw new Error('The expected plastics posting category is unavailable or changed.');
  return { source, target };
}

async function candidates(client, sourceCategoryId) {
  const result = await client.query(`
    SELECT id, "nameAr", "categoryId", "supplierType"
    FROM "FinanceSupplier"
    WHERE "tenantId" = $1 AND "companyId" = $2
      AND status = 'ACTIVE' AND "supplierType" = 'PURCHASE'
      AND "categoryId" = $3
    ORDER BY id
  `, [TENANT_ID, COMPANY_ID, sourceCategoryId]);
  return result.rows;
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_ID]);
  const company = await client.query(`SELECT id, "nameAr", "migrationReviewLocked" FROM "Company" WHERE id = $1 AND "tenantId" = $2`, [COMPANY_ID, TENANT_ID]);
  if (company.rowCount !== 1 || company.rows[0].nameAr !== 'دوحة المستهلك') throw new Error('Doha Al-Mustahlek is unavailable.');
  const actor = await client.query(`SELECT id FROM "User" WHERE id = $1 AND "tenantId" = $2`, [actorUserId, TENANT_ID]);
  if (!actor.rowCount) throw new Error('The approved actor is unavailable.');
  const { source, target } = await categories(client);
  const rows = await candidates(client, source.id);
  const plan = {
    version: VERSION, companyId: COMPANY_ID,
    sourceCategory: { id: source.id, code: source.code, nameAr: source.nameAr },
    targetCategory: { id: target.id, code: target.code, nameAr: target.nameAr },
    supplierIds: rows.map((row) => row.id),
  };
  const planFingerprint = hash(plan);
  console.log(JSON.stringify({ status: DRY_RUN, ...plan, supplierCount: rows.length, suppliers: rows.map((row) => ({ id: row.id, nameAr: row.nameAr })), migrationReviewLocked: company.rows[0].migrationReviewLocked, planFingerprint }, null, 2));
  if (mode === DRY_RUN) process.exitCode = 0;
  else {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);
      const locked = await client.query(`SELECT "migrationReviewLocked" FROM "Company" WHERE id = $1 AND "tenantId" = $2 FOR UPDATE`, [COMPANY_ID, TENANT_ID]);
      if (!locked.rows[0]?.migrationReviewLocked) throw new Error('MIGRATION_REVIEW_LOCK_REQUIRED');
      const requestId = 'doha-supplier-default-category:legacy-food-to-plastics/v1';
      const previous = await client.query(`SELECT id FROM "AuditEvent" WHERE "tenantId" = $1 AND "companyId" = $2 AND action = 'supplier.default_category.reassigned' AND "requestId" = $3`, [TENANT_ID, COMPANY_ID, requestId]);
      if (previous.rowCount) {
        await client.query('COMMIT');
        console.log(JSON.stringify({ status: 'REPLAYED', requestId }));
      } else {
        const refreshed = await candidates(client, source.id);
        if (hash({ ...plan, supplierIds: refreshed.map((row) => row.id) }) !== planFingerprint) throw new Error('Candidate set changed during the run.');
        const updated = await client.query(`
          UPDATE "FinanceSupplier"
          SET "categoryId" = $1
          WHERE "tenantId" = $2 AND "companyId" = $3
            AND status = 'ACTIVE' AND "supplierType" = 'PURCHASE'
            AND "categoryId" = $4
        `, [target.id, TENANT_ID, COMPANY_ID, source.id]);
        if (updated.rowCount !== rows.length) throw new Error('Supplier default update lost its precondition.');
        await client.query(`
          INSERT INTO "AuditEvent" (id, "tenantId", "companyId", "actorUserId", action, "entityType", "entityId", "requestId", "beforeJson", "afterJson")
          VALUES ($1,$2,$3,$4,'supplier.default_category.reassigned','FinanceSupplierDefaultCategory',$5,$6,$7::jsonb,$8::jsonb)
        `, [randomUUID(), TENANT_ID, COMPANY_ID, actorUserId, source.id, requestId, JSON.stringify({ sourceCategory: plan.sourceCategory, supplierIds: plan.supplierIds }), JSON.stringify({ targetCategory: plan.targetCategory, supplierIds: plan.supplierIds, planFingerprint })]);
        await client.query('COMMIT');
        console.log(JSON.stringify({ status: 'COMPLETED', updated: updated.rowCount, planFingerprint }));
      }
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
} finally {
  await client.end();
}
