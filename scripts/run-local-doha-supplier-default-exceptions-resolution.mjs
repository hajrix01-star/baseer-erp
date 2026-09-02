/**
 * Owner-approved resolution of the three Doha supplier-default exceptions.
 * It updates supplier master defaults only; no document, journal, or amount changes.
 */
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

const DRY_RUN = 'DRY_RUN';
const APPLY = 'APPLY_APPROVED_DOHA_SUPPLIER_DEFAULT_EXCEPTIONS_V1';
const TENANT_ID = '6ffae759-800e-4653-8543-51013f5ef751';
const COMPANY_ID = '3c032ff1-c00d-4784-99ae-a9bf53e09e0d';
const DEFAULT_ACTOR_ID = 'c89fb913-2f7c-404e-84d7-161146766f77';
const RULES = Object.freeze([
  Object.freeze({ supplierId: '93d81735-c278-427c-9686-6cf26ced3e14', nameAr: 'الشركة السعودية لتحويل الورق', supplierType: 'PURCHASE', categoryCode: 'P3-1', reason: 'Owner chose plastics; two mapped purchase documents use P3-1 and one is historical generic food.' }),
  Object.freeze({ supplierId: '414dd6d3-308f-4b58-a815-450bd2a83f1d', nameAr: 'الشركة السعودية للكهرباء', supplierType: 'EXPENSE', categoryCode: 'E3-2', reason: 'Owner chose expense/electricity; all six mapped documents are expense electricity.' }),
  Object.freeze({ supplierId: '42814f14-233c-435a-96bc-8c1febedd99c', nameAr: 'جهة غير مسماة في نوركس — دوحة المستهلك', supplierType: 'EXPENSE', categoryCode: 'E2-4', reason: 'Owner chose residencies and passports as the historical fallback default; source invoices have no registered supplier.' }),
]);
const [mode, actorUserId = DEFAULT_ACTOR_ID] = process.argv.slice(2);
if (![DRY_RUN, APPLY].includes(mode ?? '') || !/^[0-9a-f-]{36}$/i.test(actorUserId)) throw new Error(`Usage: node scripts/run-local-doha-supplier-default-exceptions-resolution.mjs ${DRY_RUN}|${APPLY} [actor-user-id]`);
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') throw new Error('This writer only permits the canonical local Baseer test database.');
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_ID]);
  const company = await client.query(`SELECT id,"nameAr","migrationReviewLocked" FROM "Company" WHERE id=$1 AND "tenantId"=$2`, [COMPANY_ID, TENANT_ID]);
  if (company.rowCount !== 1 || company.rows[0].nameAr !== 'دوحة المستهلك') throw new Error('Doha Al-Mustahlek is unavailable.');
  const actor = await client.query(`SELECT id FROM "User" WHERE id=$1 AND "tenantId"=$2`, [actorUserId, TENANT_ID]);
  if (!actor.rowCount) throw new Error('The approved actor is unavailable.');
  const suppliers = await client.query(`SELECT id,"nameAr","supplierType","categoryId" FROM "FinanceSupplier" WHERE "tenantId"=$1 AND "companyId"=$2 AND id=ANY($3::uuid[]) AND status='ACTIVE'`, [TENANT_ID, COMPANY_ID, RULES.map((rule) => rule.supplierId)]);
  const categories = await client.query(`SELECT id,code,"nameAr",kind,status,"isPosting" FROM "FinanceCategory" WHERE "tenantId"=$1 AND "companyId"=$2 AND code=ANY($3::text[])`, [TENANT_ID, COMPANY_ID, RULES.map((rule) => rule.categoryCode)]);
  const supplierById = new Map(suppliers.rows.map((row) => [row.id, row]));
  const categoryByCode = new Map(categories.rows.map((row) => [row.code, row]));
  const writes = RULES.map((rule) => {
    const supplier = supplierById.get(rule.supplierId); const category = categoryByCode.get(rule.categoryCode);
    if (!supplier || supplier.nameAr !== rule.nameAr) throw new Error(`Supplier evidence changed: ${rule.nameAr}`);
    if (!category || category.kind !== rule.supplierType || category.status !== 'ACTIVE' || !category.isPosting) throw new Error(`Posting category is unavailable or incompatible: ${rule.categoryCode}`);
    return { ...rule, categoryId: category.id, previousSupplierType: supplier.supplierType, previousCategoryId: supplier.categoryId };
  });
  const pending = writes.filter((write) => write.previousSupplierType !== write.supplierType || write.previousCategoryId !== write.categoryId);
  const planFingerprint = sha({ version: 'doha-supplier-default-exceptions/v1', writes: pending.map((write) => [write.supplierId, write.supplierType, write.categoryId]) });
  console.log(JSON.stringify({ status: DRY_RUN, migrationReviewLocked: company.rows[0].migrationReviewLocked, pending: pending.length, reused: writes.length - pending.length, writes: pending, planFingerprint }, null, 2));
  if (mode === DRY_RUN) process.exitCode = 0;
  else {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);
      const locked = await client.query(`SELECT "migrationReviewLocked" FROM "Company" WHERE id=$1 AND "tenantId"=$2 FOR UPDATE`, [COMPANY_ID, TENANT_ID]);
      if (!locked.rows[0]?.migrationReviewLocked) throw new Error('MIGRATION_REVIEW_LOCK_REQUIRED');
      const requestId = `doha-supplier-default-exceptions:${planFingerprint}`;
      const prior = await client.query(`SELECT id FROM "AuditEvent" WHERE "tenantId"=$1 AND "companyId"=$2 AND action='supplier.default_exception_resolution.completed' AND "requestId"=$3`, [TENANT_ID, COMPANY_ID, requestId]);
      if (prior.rowCount) { await client.query('COMMIT'); console.log(JSON.stringify({ status: 'REPLAYED', planFingerprint })); }
      else {
        for (const write of pending) {
          const changed = await client.query(`UPDATE "FinanceSupplier" SET "supplierType"=$1,"categoryId"=$2 WHERE id=$3 AND "tenantId"=$4 AND "companyId"=$5 AND status='ACTIVE' AND "supplierType"=$6 AND "categoryId" IS NOT DISTINCT FROM $7`, [write.supplierType, write.categoryId, write.supplierId, TENANT_ID, COMPANY_ID, write.previousSupplierType, write.previousCategoryId]);
          if (changed.rowCount !== 1) throw new Error(`Supplier changed during resolution: ${write.nameAr}`);
        }
        await client.query(`INSERT INTO "AuditEvent" (id,"tenantId","companyId","actorUserId",action,"entityType","entityId","requestId","afterJson") VALUES ($1,$2,$3,$4,'supplier.default_exception_resolution.completed','FinanceSupplierDefaultResolution',$5,$6,$7::jsonb)`, [randomUUID(), TENANT_ID, COMPANY_ID, actorUserId, COMPANY_ID, requestId, JSON.stringify({ planFingerprint, writes: pending, noFinancialDocumentsChanged: true })]);
        await client.query('COMMIT');
        console.log(JSON.stringify({ status: 'COMPLETED', updated: pending.length, planFingerprint }));
      }
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
} finally { await client.end(); }
