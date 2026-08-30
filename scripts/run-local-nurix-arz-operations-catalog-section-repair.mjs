import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import pg from 'pg';

const APPROVAL = 'APPLY_APPROVED_NOORIX_ARZ_OPERATIONS_CATALOG_SECTION_REPAIR_V1';
const TENANT_ID = '6ffae759-800e-4653-8543-51013f5ef751';
const COMPANY_ID = '7e64301f-c87e-4d98-9881-35328ace117b';
const ACTOR_ID = 'c89fb913-2f7c-404e-84d7-161146766f77';
const SOURCE_COMPANY_ID = 'cmnf604ka009ay8lm556wgd9c';
const SOURCE_IDS = ['v4m_c2e1495c1c77d8a49625', 'v4m_da75fc5ad33d79b3d8e5', 'v4m_d2174e5fe578ae515560'];

const mode = process.argv[2];
if (!['DRY_RUN', APPROVAL].includes(mode)) throw new Error(`Usage: node scripts/run-local-nurix-arz-operations-catalog-section-repair.mjs DRY_RUN|${APPROVAL}`);
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') throw new Error('Refusing to run outside the canonical local Baseer test database.');

const sourceJson = (sql) => JSON.parse(execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim());
const sourceRows = sourceJson(`
  SELECT coalesce(json_agg(row_data ORDER BY row_data->>'nameAr'), '[]'::json)
  FROM (
    SELECT json_build_object(
      'id', i.id, 'nameAr', i.name_ar, 'nameEn', i.name_en, 'itemType', i.item_type,
      'categoryId', i.category_id, 'isActive', i.is_active, 'baseUnitId', i.kernel_unit_id,
      'sectionId', link.section_id, 'sectionCode', s.code, 'sectionName', s.name_ar, 'unitId', iu.unit_id,
      'isOrderEnabled', iu.is_order_enabled, 'isUnitActive', iu.is_active, 'salePrice', iu.sale_price
    ) AS row_data
    FROM orders_v4_items i
    JOIN orders_v4_item_sections link ON link.item_id = i.id AND link.company_id = i.company_id
    JOIN orders_v4_sections s ON s.id = link.section_id AND s.company_id = link.company_id
    JOIN orders_v4_item_units iu ON iu.item_id = i.id AND iu.company_id = i.company_id AND iu.unit_id = i.kernel_unit_id
    WHERE i.company_id = '${SOURCE_COMPANY_ID}'
      AND i.id IN (${SOURCE_IDS.map((id) => `'${id}'`).join(', ')})
  ) source_rows;
`);
if (sourceRows.length !== SOURCE_IDS.length) throw new Error('The Noorix direct section evidence is incomplete.');
for (const row of sourceRows) {
  if (row.itemType !== 'sale' || !row.isActive || row.baseUnitId !== row.unitId || !row.sectionId || Number(row.salePrice) <= 0) {
    throw new Error(`Source row ${row.id} is no longer safe to repair.`);
  }
}
const planSha = createHash('sha256').update(JSON.stringify(sourceRows)).digest('hex');
const financeSql = `SELECT json_build_object(
  'journalEntries', (SELECT count(*) FROM "FinanceJournalEntry" WHERE "tenantId"=$1 AND "companyId"=$2),
  'journalDebit', (SELECT coalesce(sum("debitAmount"),0)::text FROM "FinanceJournalLine" WHERE "tenantId"=$1 AND "companyId"=$2),
  'outflowDocuments', (SELECT count(*) FROM "FinanceOutflowDocument" WHERE "tenantId"=$1 AND "companyId"=$2),
  'outflowGross', (SELECT coalesce(sum("grossAmount"),0)::text FROM "FinanceOutflowDocument" WHERE "tenantId"=$1 AND "companyId"=$2)
) AS snapshot;`;
const same = (left, right) => Object.keys(left).every((key) => String(left[key]) === String(right[key]));

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_ID]);
  const financeBefore = (await client.query(financeSql, [TENANT_ID, COMPANY_ID])).rows[0].snapshot;
  console.log(JSON.stringify({ status: 'PARSED_DRY_RUN', planSha, sourceRows, financeBefore }, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);
      const company = await client.query(`SELECT id FROM "Company" WHERE id=$1 AND "tenantId"=$2 AND "migrationReviewLocked"=true`, [COMPANY_ID, TENANT_ID]);
      if (!company.rowCount) throw new Error('ARZ must remain migration-review locked.');
      const created = [];
      for (const row of sourceRows) {
        const section = await client.query(`SELECT id FROM "OperationsSection" WHERE "tenantId"=$1 AND "companyId"=$2 AND code=$3`, [TENANT_ID, COMPANY_ID, row.sectionCode]);
        const category = await client.query(`SELECT id FROM "OperationsCatalogCategory" WHERE "tenantId"=$1 AND "companyId"=$2 AND code=$3`, [TENANT_ID, COMPANY_ID, `NXR-CAT-${row.categoryId}`]);
        const unit = await client.query(`SELECT id FROM "OperationsUnit" WHERE "tenantId"=$1 AND "companyId"=$2 AND code='piece'`, [TENANT_ID, COMPANY_ID]);
        const existing = await client.query(`SELECT id FROM "OperationsItem" WHERE "tenantId"=$1 AND "companyId"=$2 AND code=$3`, [TENANT_ID, COMPANY_ID, `NXR-${row.id}`]);
        if (!section.rowCount || !category.rowCount || !unit.rowCount || existing.rowCount) throw new Error(`Target precondition failed for ${row.nameAr}.`);
        const itemId = randomUUID();
        await client.query(`INSERT INTO "OperationsItem" (id,"tenantId","companyId","sectionId","categoryId","baseUnitId",code,"nameAr","nameEn",kind,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'MENU_PRODUCT','ACTIVE')`, [itemId, TENANT_ID, COMPANY_ID, section.rows[0].id, category.rows[0].id, unit.rows[0].id, `NXR-${row.id}`, row.nameAr, row.nameEn]);
        await client.query(`INSERT INTO "OperationsItemUnit" (id,"tenantId","companyId","itemId","unitId","isBase","isOrderEnabled","isActive","menuSaleUnitPrice") VALUES ($1,$2,$3,$4,$5,true,$6,$7,$8)`, [randomUUID(), TENANT_ID, COMPANY_ID, itemId, unit.rows[0].id, row.isOrderEnabled, row.isUnitActive, String(row.salePrice)]);
        created.push({ sourceId: row.id, targetId: itemId, nameAr: row.nameAr, sectionName: row.sectionName });
      }
      const financeAfter = (await client.query(financeSql, [TENANT_ID, COMPANY_ID])).rows[0].snapshot;
      if (!same(financeBefore, financeAfter)) throw new Error('Finance protection gate failed.');
      await client.query(`INSERT INTO "AuditEvent" (id,"tenantId","companyId","actorUserId",action,"entityType","entityId","requestId","afterJson") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [randomUUID(), TENANT_ID, COMPANY_ID, ACTOR_ID, 'nurix.operations_catalog.section_repair.completed', 'OperationsCatalogMigration', planSha, `nurix-operations-catalog-section-repair:${planSha}`, JSON.stringify({ planSha, created, financeBefore, financeAfter })]);
      await client.query('COMMIT');
      console.log(JSON.stringify({ status: 'COMPLETED', planSha, created, financeBefore, financeAfter }, null, 2));
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
} finally { await client.end(); }
