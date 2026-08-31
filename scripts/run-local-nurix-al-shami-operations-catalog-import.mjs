import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import pg from 'pg';

// This migration intentionally carries the operations catalogue only.  It is
// not an order, stock, receipt, custody, or financial migration.
const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_OPERATIONS_CATALOG_V1';
const VERSION = 'nurix-al-shami-operations-catalog/v1';
const SOURCE_SYSTEM = 'NOORIX_POSTGRES_ARCHIVE';
const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const TENANT_ID = '6ffae759-800e-4653-8543-51013f5ef751';
const COMPANY_ID = '4af6969a-161f-4e13-8acc-103d8aa26a70';
const ACTOR_ID = 'c89fb913-2f7c-404e-84d7-161146766f77';

const mode = process.argv[2];
if (!['DRY_RUN', APPROVAL].includes(mode)) {
  throw new Error(`Usage: node scripts/run-local-nurix-al-shami-operations-catalog-import.mjs DRY_RUN|${APPROVAL}`);
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing to run outside the canonical local Baseer test database.');
}

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourceJson = (sql) => {
  const stdout = execFileSync('docker', [
    'exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sql,
  ], { encoding: 'utf8' }).trim();
  return stdout ? JSON.parse(stdout) : [];
};
const jsonArray = (sql) => sourceJson(`SELECT COALESCE(json_agg(row_data), '[]'::json) FROM (${sql}) row_data;`);
const sourceSql = (table, fields, order = 'id') => `SELECT ${fields} FROM ${table} WHERE company_id = '${SOURCE_COMPANY_ID}' ORDER BY ${order}`;

const sections = jsonArray(sourceSql('orders_v4_sections', `id, code, name_ar AS "nameAr", name_en AS "nameEn"`, 'sort_order, code'));
const units = jsonArray(sourceSql('orders_v4_units', `
  id, code, name_ar AS "nameAr", name_en AS "nameEn", upper(dimension) AS dimension, is_active AS "isActive"
`, 'sort_order, code'));
const categories = jsonArray(sourceSql('orders_v4_categories', `
  id, name_ar AS "nameAr", name_en AS "nameEn", is_active AS "isActive", sort_order AS "sortOrder"
`, 'sort_order, name_ar, id'));
const items = jsonArray(sourceSql('orders_v4_items', `
  id, sku, name_ar AS "nameAr", name_en AS "nameEn", item_type AS "itemType", category_id AS "categoryId",
  inventory_unit_id AS "inventoryUnitId", kernel_unit_id AS "kernelUnitId", is_active AS "isActive", sort_order AS "sortOrder"
`, 'item_type, sort_order, name_ar, id'));
const itemUnits = jsonArray(sourceSql('orders_v4_item_units', `
  id, item_id AS "itemId", unit_id AS "unitId", is_order_enabled AS "isOrderEnabled", is_active AS "isActive",
  last_price AS "lastPrice", last_price_at AS "lastPriceAt", sort_order AS "sortOrder"
`, 'item_id, sort_order, id'));
const conversionVersions = jsonArray(sourceSql('orders_v4_conversion_versions', `id, item_id AS "itemId", version, status`, 'item_id, version'));
const conversionEdges = jsonArray(sourceSql('orders_v4_conversion_edges', `id, version_id AS "versionId"`, 'version_id, sort_order, id'));
const recipeVersions = jsonArray(sourceSql('orders_v4_recipe_versions', `id`, 'id'));
const recipeLines = jsonArray(sourceSql('orders_v4_recipe_lines', `id`, 'id'));
const excludedSourceCounts = sourceJson(`SELECT json_build_object(
  'purchaseRequests', (SELECT count(*) FROM orders_v4_documents WHERE company_id = '${SOURCE_COMPANY_ID}' AND document_type = 'purchase'),
  'documentLines', (SELECT count(*) FROM orders_v4_document_lines WHERE company_id = '${SOURCE_COMPANY_ID}'),
  'inventoryLedger', (SELECT count(*) FROM orders_v4_inventory_ledger WHERE company_id = '${SOURCE_COMPANY_ID}'),
  'custodyLedger', (SELECT count(*) FROM orders_v4_custody_ledger WHERE company_id = '${SOURCE_COMPANY_ID}')
)`) ?? {};

const unitBySourceId = new Map(units.map((row) => [row.id, row]));
const categoryBySourceId = new Map(categories.map((row) => [row.id, row]));
if (sections.length !== 0) throw new Error('This contract is raw-material catalogue only; unexpected source sections require review.');
if (items.some((row) => row.itemType !== 'purchased')) throw new Error('Unexpected non-purchased item requires a section-assignment review.');
for (const row of items) {
  if (!row.isActive || !unitBySourceId.has(row.kernelUnitId) || row.kernelUnitId !== row.inventoryUnitId || !categoryBySourceId.has(row.categoryId)) {
    throw new Error(`Source item ${row.id} is not a coherent active raw material.`);
  }
}
if (itemUnits.length !== items.length || itemUnits.some((row) => !unitBySourceId.has(row.unitId))) {
  throw new Error('Each raw material must have exactly one valid source item unit for this v1 contract.');
}
if (conversionEdges.length !== 0 || recipeVersions.length !== 0 || recipeLines.length !== 0) {
  throw new Error('Unexpected conversion or recipe content requires a reviewed v2 contract.');
}

const sourceSnapshot = {
  sourceCompanyId: SOURCE_COMPANY_ID,
  counts: {
    sections: sections.length, units: units.length, categories: categories.length, items: items.length, itemUnits: itemUnits.length,
    conversionVersionMetadata: conversionVersions.length, transferableConversionVersions: 0, conversionEdges: conversionEdges.length,
    recipeVersions: recipeVersions.length, recipeLines: recipeLines.length,
  },
  excludedSourceCounts,
  exclusions: ['orders', 'document lines', 'purchase receipts', 'internal registrations', 'custody', 'inventory balances', 'inventory movements', 'financial postings'],
};
const planSha = sha(sourceSnapshot);

const businessSnapshotSql = `SELECT json_build_object(
  'financeJournalEntries', (SELECT count(*) FROM "FinanceJournalEntry" WHERE "tenantId"=$1 AND "companyId"=$2),
  'financeOutflows', (SELECT count(*) FROM "FinanceOutflowDocument" WHERE "tenantId"=$1 AND "companyId"=$2),
  'cashPerformanceEvents', (SELECT count(*) FROM "FinanceCashPerformanceEvent" WHERE "tenantId"=$1 AND "companyId"=$2),
  'internalRegistrations', (SELECT count(*) FROM "OperationsInternalRegistration" WHERE "tenantId"=$1 AND "companyId"=$2),
  'purchaseRequests', (SELECT count(*) FROM "OperationsPurchaseRequest" WHERE "tenantId"=$1 AND "companyId"=$2),
  'purchaseReceipts', (SELECT count(*) FROM "OperationsPurchaseReceipt" WHERE "tenantId"=$1 AND "companyId"=$2),
  'custodyProfiles', (SELECT count(*) FROM "OperationsCustodyProfile" WHERE "tenantId"=$1 AND "companyId"=$2),
  'custodyEvents', (SELECT count(*) FROM "OperationsCustodyEvent" WHERE "tenantId"=$1 AND "companyId"=$2),
  'inventoryBalances', (SELECT count(*) FROM "OperationsInventoryBalance" WHERE "tenantId"=$1 AND "companyId"=$2),
  'inventoryMovements', (SELECT count(*) FROM "OperationsInventoryMovement" WHERE "tenantId"=$1 AND "companyId"=$2)
) AS snapshot;`;
const catalogSnapshotSql = `SELECT json_build_object(
  'sections', (SELECT count(*) FROM "OperationsSection" WHERE "tenantId"=$1 AND "companyId"=$2),
  'units', (SELECT count(*) FROM "OperationsUnit" WHERE "tenantId"=$1 AND "companyId"=$2),
  'categories', (SELECT count(*) FROM "OperationsCatalogCategory" WHERE "tenantId"=$1 AND "companyId"=$2),
  'items', (SELECT count(*) FROM "OperationsItem" WHERE "tenantId"=$1 AND "companyId"=$2),
  'itemUnits', (SELECT count(*) FROM "OperationsItemUnit" WHERE "tenantId"=$1 AND "companyId"=$2),
  'conversionVersions', (SELECT count(*) FROM "OperationsItemConversionVersion" WHERE "tenantId"=$1 AND "companyId"=$2),
  'conversionEdges', (SELECT count(*) FROM "OperationsItemConversionEdge" WHERE "tenantId"=$1 AND "companyId"=$2),
  'recipeVersions', (SELECT count(*) FROM "OperationsRecipeVersion" WHERE "tenantId"=$1 AND "companyId"=$2),
  'recipeLines', (SELECT count(*) FROM "OperationsRecipeLine" WHERE "tenantId"=$1 AND "companyId"=$2)
) AS snapshot;`;
const same = (left, right) => Object.keys(left).every((key) => String(left[key]) === String(right[key]));
const mapChecksum = (entity, row) => sha({ entity, row });

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_ID]);
  const businessBefore = (await client.query(businessSnapshotSql, [TENANT_ID, COMPANY_ID])).rows[0].snapshot;
  const catalogBefore = (await client.query(catalogSnapshotSql, [TENANT_ID, COMPANY_ID])).rows[0].snapshot;
  console.log(JSON.stringify({ status: 'PARSED_DRY_RUN', version: VERSION, planSha, source: sourceSnapshot, catalogBefore, businessBefore }, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);
      const company = await client.query(`SELECT id, "migrationReviewLocked" FROM "Company" WHERE id=$1 AND "tenantId"=$2`, [COMPANY_ID, TENANT_ID]);
      if (!company.rows[0]?.migrationReviewLocked) throw new Error('Target must stay migration-review locked during catalog import.');
      const prior = await client.query(`SELECT id, "afterJson" FROM "AuditEvent" WHERE "tenantId"=$1 AND "companyId"=$2 AND action='nurix.operations_catalog.import.completed' AND "requestId"=$3`, [TENANT_ID, COMPANY_ID, `nurix-operations-catalog:${planSha}`]);
      if (prior.rowCount) {
        await client.query('COMMIT');
        console.log(JSON.stringify({ status: 'ALREADY_COMPLETED', version: VERSION, planSha, receipt: prior.rows[0].afterJson }, null, 2));
      }
      if (!prior.rowCount) {
      if (Object.values(catalogBefore).some((count) => Number(count) !== 0)) throw new Error('Target catalogue is not empty; no blind second import is permitted.');
      const existingRun = await client.query(`SELECT id FROM "LegacyMigrationRun" WHERE "tenantId"=$1 AND "sourceSystem"=$2 AND "sourceFingerprint"=$3 AND "transformVersion"=$4`, [TENANT_ID, SOURCE_SYSTEM, planSha, VERSION]);
      if (existingRun.rowCount) throw new Error('An unfinished run with this source fingerprint exists and requires audit before retry.');
      const runId = randomUUID();
      await client.query(`INSERT INTO "LegacyMigrationRun" (id,"tenantId","sourceSystem","sourceFingerprint","transformVersion",status,"initiatedByUserId") VALUES ($1,$2,$3,$4,$5,'STAGED',$6)`, [runId, TENANT_ID, SOURCE_SYSTEM, planSha, VERSION, ACTOR_ID]);
      await client.query(`INSERT INTO "LegacyMigrationCompanyMap" (id,"runId","tenantId","sourceCompanyId","targetCompanyId",state) VALUES ($1,$2,$3,$4,$5,'APPROVED')`, [randomUUID(), runId, TENANT_ID, SOURCE_COMPANY_ID, COMPANY_ID]);
      const writeMap = async (sourceEntity, sourceId, targetEntity, targetId, row) => client.query(`INSERT INTO "LegacyMigrationRecordMap" (id,"runId","tenantId","targetCompanyId","sourceCompanyId","sourceEntity","sourceId","targetEntity","targetId","transformVersion","sourceChecksum",state) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'RECONCILED')`, [randomUUID(), runId, TENANT_ID, COMPANY_ID, SOURCE_COMPANY_ID, sourceEntity, sourceId, targetEntity, targetId, VERSION, mapChecksum(sourceEntity, row)]);
      const unitTarget = new Map(); const categoryTarget = new Map(); const itemTarget = new Map();
      for (const row of units) {
        const id = randomUUID(); unitTarget.set(row.id, id);
        await client.query(`INSERT INTO "OperationsUnit" (id,"tenantId","companyId",code,"nameAr","nameEn",dimension,"isActive") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, TENANT_ID, COMPANY_ID, row.code, row.nameAr, row.nameEn, row.dimension, row.isActive]);
        await writeMap('orders_v4_units', row.id, 'OperationsUnit', id, row);
      }
      for (const row of categories) {
        const id = randomUUID(); categoryTarget.set(row.id, id);
        await client.query(`INSERT INTO "OperationsCatalogCategory" (id,"tenantId","companyId",code,"nameAr","nameEn","isActive","sortOrder") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, TENANT_ID, COMPANY_ID, `NXR-CAT-${row.id}`, row.nameAr, row.nameEn, row.isActive, row.sortOrder]);
        await writeMap('orders_v4_categories', row.id, 'OperationsCatalogCategory', id, row);
      }
      for (const row of items) {
        const id = randomUUID(); itemTarget.set(row.id, id);
        await client.query(`INSERT INTO "OperationsItem" (id,"tenantId","companyId","sectionId","categoryId","baseUnitId",code,"nameAr","nameEn",kind,status) VALUES ($1,$2,$3,NULL,$4,$5,$6,$7,$8,'RAW_MATERIAL','ACTIVE')`, [id, TENANT_ID, COMPANY_ID, categoryTarget.get(row.categoryId), unitTarget.get(row.kernelUnitId), `NXR-${row.id}`, row.nameAr, row.nameEn]);
        await writeMap('orders_v4_items', row.id, 'OperationsItem', id, row);
      }
      for (const row of itemUnits) {
        const id = randomUUID();
        await client.query(`INSERT INTO "OperationsItemUnit" (id,"tenantId","companyId","itemId","unitId","isBase","isOrderEnabled","isActive","lastPurchaseUnitPrice","lastPurchasePriceAt") VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8,$9)`, [id, TENANT_ID, COMPANY_ID, itemTarget.get(row.itemId), unitTarget.get(row.unitId), row.isOrderEnabled, row.isActive, Number(row.lastPrice) > 0 ? String(row.lastPrice) : null, Number(row.lastPrice) > 0 ? row.lastPriceAt : null]);
        await writeMap('orders_v4_item_units', row.id, 'OperationsItemUnit', id, row);
      }
      const businessAfter = (await client.query(businessSnapshotSql, [TENANT_ID, COMPANY_ID])).rows[0].snapshot;
      if (!same(businessBefore, businessAfter)) throw new Error(`Scope protection failed: ${JSON.stringify({ businessBefore, businessAfter })}`);
      const catalogAfter = (await client.query(catalogSnapshotSql, [TENANT_ID, COMPANY_ID])).rows[0].snapshot;
      const expected = { sections: 0, units: units.length, categories: categories.length, items: items.length, itemUnits: itemUnits.length, conversionVersions: 0, conversionEdges: 0, recipeVersions: 0, recipeLines: 0 };
      if (!same(expected, catalogAfter)) throw new Error(`Catalogue count check failed: ${JSON.stringify({ expected, catalogAfter })}`);
      const mapCount = await client.query(`SELECT count(*)::int AS count FROM "LegacyMigrationRecordMap" WHERE "runId"=$1 AND "tenantId"=$2`, [runId, TENANT_ID]);
      if (mapCount.rows[0].count !== units.length + categories.length + items.length + itemUnits.length) throw new Error('Lineage map count check failed.');
      const receipt = { version: VERSION, planSha, source: sourceSnapshot, created: expected, businessBefore, businessAfter, catalogBefore, catalogAfter, mapCount: mapCount.rows[0].count };
      await client.query(`UPDATE "LegacyMigrationRun" SET status='RECONCILED', "completedAt"=now() WHERE id=$1 AND "tenantId"=$2`, [runId, TENANT_ID]);
      await client.query(`INSERT INTO "AuditEvent" (id,"tenantId","companyId","actorUserId",action,"entityType","entityId","requestId","afterJson") VALUES ($1,$2,$3,$4,'nurix.operations_catalog.import.completed','OperationsCatalogMigration',$5,$6,$7::jsonb)`, [randomUUID(), TENANT_ID, COMPANY_ID, ACTOR_ID, planSha, `nurix-operations-catalog:${planSha}`, JSON.stringify(receipt)]);
      await client.query('COMMIT');
      console.log(JSON.stringify({ status: 'COMPLETED', ...receipt }, null, 2));
      }
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    }
  }
} finally {
  await client.end();
}
