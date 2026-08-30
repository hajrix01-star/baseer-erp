import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

import dotenv from "dotenv";
import pg from "pg";

const APPROVAL = "APPLY_APPROVED_NOORIX_ARZ_OPERATIONS_CATALOG_V1";
const VERSION = "nurix-arz-operations-catalog/v1";
const SOURCE_COMPANY_ID = "cmnf604ka009ay8lm556wgd9c";
const TENANT_ID = "6ffae759-800e-4653-8543-51013f5ef751";
const COMPANY_ID = "7e64301f-c87e-4d98-9881-35328ace117b";
const ACTOR_ID = "c89fb913-2f7c-404e-84d7-161146766f77";

const mode = process.argv[2];
if (!['DRY_RUN', APPROVAL].includes(mode)) {
  throw new Error(`Usage: node scripts/run-local-nurix-arz-operations-catalog-import.mjs DRY_RUN|${APPROVAL}`);
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
  if (!stdout) return [];
  return JSON.parse(stdout);
};
const jsonArray = (sql) => sourceJson(`SELECT COALESCE(json_agg(row_data), '[]'::json) FROM (${sql}) row_data;`);
const sourceSql = (table, fields, order = 'id') => `SELECT ${fields} FROM ${table} WHERE company_id = '${SOURCE_COMPANY_ID}' ORDER BY ${order}`;

const units = jsonArray(sourceSql('orders_v4_units', `
  id, code, name_ar AS "nameAr", name_en AS "nameEn", upper(dimension) AS dimension,
  is_active AS "isActive", sort_order AS "sortOrder"
`, 'sort_order, code'));
const sections = jsonArray(sourceSql('orders_v4_sections', `
  id, code, name_ar AS "nameAr", name_en AS "nameEn", is_active AS "isActive", sort_order AS "sortOrder"
`, 'sort_order, code'));
const categories = jsonArray(sourceSql('orders_v4_categories', `
  id, name_ar AS "nameAr", name_en AS "nameEn", is_active AS "isActive", sort_order AS "sortOrder"
`, 'sort_order, name_ar, id'));
const items = jsonArray(sourceSql('orders_v4_items', `
  id, sku, name_ar AS "nameAr", name_en AS "nameEn", item_type AS "itemType", category_id AS "categoryId",
  inventory_unit_id AS "inventoryUnitId", kernel_unit_id AS "kernelUnitId", track_inventory AS "trackInventory",
  is_active AS "isActive", sort_order AS "sortOrder"
`, 'item_type, sort_order, name_ar, id'));
const itemUnits = jsonArray(sourceSql('orders_v4_item_units', `
  id, item_id AS "itemId", unit_id AS "unitId", is_order_enabled AS "isOrderEnabled", is_active AS "isActive",
  last_price AS "lastPrice", last_price_at AS "lastPriceAt", sale_price AS "salePrice", sort_order AS "sortOrder"
`, 'item_id, sort_order, id'));
const conversionVersions = jsonArray(sourceSql('orders_v4_conversion_versions', `
  id, item_id AS "itemId", version, status, published_at AS "publishedAt"
`, 'item_id, version'));
const conversionEdges = jsonArray(sourceSql('orders_v4_conversion_edges', `
  id, version_id AS "versionId", from_unit_id AS "fromUnitId", to_unit_id AS "toUnitId", factor, sort_order AS "sortOrder"
`, 'version_id, sort_order, id'));
const recipeVersions = jsonArray(sourceSql('orders_v4_recipe_versions', `
  id, output_item_id AS "outputItemId", output_quantity AS "outputQuantity", output_unit_id AS "outputUnitId",
  version, status, published_at AS "publishedAt"
`, 'output_item_id, version'));
const recipeLines = jsonArray(sourceSql('orders_v4_recipe_lines', `
  id, recipe_version_id AS "recipeVersionId", component_item_id AS "componentItemId", quantity,
  unit_id AS "unitId", sort_order AS "sortOrder"
`, 'recipe_version_id, sort_order, id'));
const categorySectionEvidence = jsonArray(`
  SELECT i.category_id AS "categoryId", min(d.section_id) AS "sectionId"
  FROM orders_v4_items i
  JOIN orders_v4_document_lines l ON l.item_id = i.id AND l.company_id = i.company_id
  JOIN orders_v4_documents d ON d.id = l.document_id AND d.company_id = l.company_id
  WHERE i.company_id = '${SOURCE_COMPANY_ID}'
    AND i.item_type = 'sale'
    AND d.document_type = 'registration'
    AND d.section_id IS NOT NULL
  GROUP BY i.category_id
  HAVING count(DISTINCT d.section_id) = 1
`);
const directItemSectionEvidence = jsonArray(`
  SELECT item_id AS "itemId", min(section_id) AS "sectionId"
  FROM orders_v4_item_sections
  WHERE company_id = '${SOURCE_COMPANY_ID}'
  GROUP BY item_id
  HAVING count(DISTINCT section_id) = 1
`);

const unitBySourceId = new Map(units.map((row) => [row.id, row]));
const categoryBySourceId = new Map(categories.map((row) => [row.id, row]));
const itemBySourceId = new Map(items.map((row) => [row.id, row]));
const sectionEvidenceByCategory = new Map(categorySectionEvidence.map((row) => [row.categoryId, row.sectionId]));
const directSectionByItem = new Map(directItemSectionEvidence.map((row) => [row.itemId, row.sectionId]));
const safeItems = [];
const withheldItems = [];
for (const item of items) {
  if (!unitBySourceId.has(item.kernelUnitId) || item.kernelUnitId !== item.inventoryUnitId) {
    throw new Error(`Source item ${item.id} lacks one coherent inventory/kernel base unit.`);
  }
  if (item.itemType === 'purchased') {
    safeItems.push(item);
    continue;
  }
  if (item.itemType !== 'sale') throw new Error(`Unsupported Noorix catalog kind: ${item.itemType}.`);
  const directSectionId = directSectionByItem.get(item.id);
  const categorySectionId = sectionEvidenceByCategory.get(item.categoryId);
  if (directSectionId && categorySectionId && directSectionId !== categorySectionId) {
    throw new Error(`Direct and category-level section evidence conflict for ${item.id}.`);
  }
  const sectionId = directSectionId ?? categorySectionId;
  if (sectionId) safeItems.push({ ...item, inferredSectionId: sectionId });
  // An archived menu item is retained as historical catalogue data, but is
  // intentionally not assigned to a guessed producing section.  Only an
  // active item with no evidence is held back because it could be used today.
  else if (!item.isActive) safeItems.push({ ...item, inferredSectionId: null, archivedWithoutSection: true });
  else withheldItems.push(item);
}
if (safeItems.some((item) => item.itemType === 'sale' && !categoryBySourceId.has(item.categoryId))) {
  throw new Error('A sale item has no valid Noorix category.');
}

const safeItemIds = new Set(safeItems.map((item) => item.id));
const itemUnitRows = itemUnits.filter((row) => safeItemIds.has(row.itemId));
if (itemUnitRows.length !== itemUnits.length - itemUnits.filter((row) => !safeItemIds.has(row.itemId)).length) throw new Error('Unexpected item-unit filtering result.');
for (const row of itemUnitRows) if (!unitBySourceId.has(row.unitId)) throw new Error(`Item unit ${row.id} refers to an unknown unit.`);

const conversionEdgesByVersion = new Map();
for (const edge of conversionEdges) {
  const list = conversionEdgesByVersion.get(edge.versionId) ?? [];
  list.push(edge); conversionEdgesByVersion.set(edge.versionId, list);
}
const conversionVersionsToImport = conversionVersions.filter((version) => safeItemIds.has(version.itemId) && (conversionEdgesByVersion.get(version.id) ?? []).length > 0);
for (const version of conversionVersionsToImport) {
  if (version.status !== 'published') throw new Error(`Only published conversion versions may be imported (${version.id}).`);
}
const recipeVersionsToImport = recipeVersions.filter((version) => safeItemIds.has(version.outputItemId));
for (const version of recipeVersionsToImport) {
  if (version.status !== 'published') throw new Error(`Only published recipe versions may be imported (${version.id}).`);
  for (const line of recipeLines.filter((entry) => entry.recipeVersionId === version.id)) {
    const component = itemBySourceId.get(line.componentItemId);
    if (!component || component.itemType !== 'purchased' || !safeItemIds.has(component.id)) {
      throw new Error(`Recipe ${version.id} has an unavailable raw-material component.`);
    }
  }
}

const sourceSnapshot = {
  sourceCompanyId: SOURCE_COMPANY_ID,
  counts: {
    units: units.length, sections: sections.length, categories: categories.length, items: items.length,
    importedItems: safeItems.length, withheldItems: withheldItems.length, itemUnits: itemUnitRows.length,
    conversionVersions: conversionVersionsToImport.length, conversionEdges: conversionVersionsToImport.reduce((sum, row) => sum + (conversionEdgesByVersion.get(row.id) ?? []).length, 0),
    recipeVersions: recipeVersionsToImport.length, recipeLines: recipeLines.filter((line) => recipeVersionsToImport.some((version) => version.id === line.recipeVersionId)).length,
  },
  withheldItems: withheldItems.map((item) => ({ sourceId: item.id, nameAr: item.nameAr, categoryId: item.categoryId, active: item.isActive })),
};
const planSha = sha(sourceSnapshot);

function asPositiveNumeric(value) {
  if (value === null || value === undefined || Number(value) <= 0) return null;
  return String(value);
}

function resolvedBaseQuantity(line, component, sourceVersionByItem) {
  if (line.unitId === component.kernelUnitId) return String(line.quantity);
  const version = sourceVersionByItem.get(component.id);
  if (!version) throw new Error(`Recipe component ${component.id} needs a conversion version to reach its base unit.`);
  const adjacency = new Map();
  for (const edge of conversionEdgesByVersion.get(version.id) ?? []) {
    const add = (from, to, factor) => adjacency.set(from, [...(adjacency.get(from) ?? []), { to, factor }]);
    add(edge.fromUnitId, edge.toUnitId, Number(edge.factor));
    add(edge.toUnitId, edge.fromUnitId, 1 / Number(edge.factor));
  }
  const factors = new Map([[line.unitId, 1]]); const queue = [line.unitId];
  while (queue.length) {
    const cursor = queue.shift();
    if (cursor === component.kernelUnitId) break;
    for (const step of adjacency.get(cursor) ?? []) if (!factors.has(step.to)) {
      factors.set(step.to, factors.get(cursor) * step.factor); queue.push(step.to);
    }
  }
  const factor = factors.get(component.kernelUnitId);
  if (!factor || !Number.isFinite(factor)) throw new Error(`No conversion path from recipe unit to base for ${component.id}.`);
  return String(Number(line.quantity) * factor);
}

const financeBaselineSql = `
  SELECT json_build_object(
    'journalEntries', (SELECT count(*) FROM "FinanceJournalEntry" WHERE "tenantId" = $1 AND "companyId" = $2),
    'journalDebit', (SELECT coalesce(sum("debitAmount"), 0)::text FROM "FinanceJournalLine" WHERE "tenantId" = $1 AND "companyId" = $2),
    'outflowDocuments', (SELECT count(*) FROM "FinanceOutflowDocument" WHERE "tenantId" = $1 AND "companyId" = $2),
    'outflowGross', (SELECT coalesce(sum("grossAmount"), 0)::text FROM "FinanceOutflowDocument" WHERE "tenantId" = $1 AND "companyId" = $2),
    'cashPerformanceEvents', (SELECT count(*) FROM "FinanceCashPerformanceEvent" WHERE "tenantId" = $1 AND "companyId" = $2),
    'cashPerformanceGross', (SELECT coalesce(sum("grossAmount"), 0)::text FROM "FinanceCashPerformanceEvent" WHERE "tenantId" = $1 AND "companyId" = $2)
  ) AS snapshot;
`;
const sameFinanceSnapshot = (left, right) => Object.keys(left).every((key) => String(left[key]) === String(right[key]));

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  // Finance rows are tenant-isolated.  The preflight snapshot must use the
  // same tenant context as the in-transaction postflight snapshot.
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_ID]);
  const financeBefore = (await client.query(financeBaselineSql, [TENANT_ID, COMPANY_ID])).rows[0].snapshot;
  const preview = { status: 'PARSED_DRY_RUN', version: VERSION, planSha, source: sourceSnapshot, financeBefore };
  console.log(JSON.stringify(preview, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    await client.query('BEGIN');
    try {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);
      // pg.Client is one database connection: do not send preflight requests
      // concurrently while a transaction is open.
      const company = await client.query(`SELECT id, "migrationReviewLocked" FROM "Company" WHERE id = $1 AND "tenantId" = $2`, [COMPANY_ID, TENANT_ID]);
      const packageRow = await client.query(`SELECT id, status FROM "NurixExcelStagingPackage" WHERE id = $1 AND "tenantId" = $2 AND "sourceCompanyId" = $3`, ['27dbb3d7-e0b2-4b52-ab61-bd2c61450350', TENANT_ID, SOURCE_COMPANY_ID]);
      const existingCatalog = await client.query(`SELECT json_build_object(
          'sections', (SELECT count(*) FROM "OperationsSection" WHERE "tenantId" = $1 AND "companyId" = $2),
          'units', (SELECT count(*) FROM "OperationsUnit" WHERE "tenantId" = $1 AND "companyId" = $2),
          'categories', (SELECT count(*) FROM "OperationsCatalogCategory" WHERE "tenantId" = $1 AND "companyId" = $2),
          'items', (SELECT count(*) FROM "OperationsItem" WHERE "tenantId" = $1 AND "companyId" = $2)
        ) AS counts`, [TENANT_ID, COMPANY_ID]);
      const priorAudit = await client.query(`SELECT id FROM "AuditEvent" WHERE "tenantId" = $1 AND "companyId" = $2 AND action = 'nurix.operations_catalog.import.completed' AND "requestId" = $3`, [TENANT_ID, COMPANY_ID, `nurix-operations-catalog:${planSha}`]);
      if (!company.rows[0]?.migrationReviewLocked) throw new Error('ARZ must stay migration-review locked during catalogue migration.');
      if (!packageRow.rows[0] || packageRow.rows[0].status !== 'READY_FOR_RECONCILIATION') throw new Error('The approved Noorix package is not READY_FOR_RECONCILIATION.');
      if (priorAudit.rowCount) throw new Error('This exact catalogue plan was already committed.');
      if (Object.values(existingCatalog.rows[0].counts).some((count) => Number(count) !== 0)) throw new Error('Target operations catalogue is not empty; reconciliation is required instead of a second import.');

      const sectionTarget = new Map(); const unitTarget = new Map(); const categoryTarget = new Map(); const itemTarget = new Map(); const conversionTarget = new Map();
      for (const row of sections) {
        const id = randomUUID(); sectionTarget.set(row.id, id);
        await client.query(`INSERT INTO "OperationsSection" (id, "tenantId", "companyId", code, "nameAr", "nameEn", "isActive", "sortOrder") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, TENANT_ID, COMPANY_ID, row.code, row.nameAr, row.nameEn, row.isActive, row.sortOrder]);
      }
      for (const row of units) {
        const id = randomUUID(); unitTarget.set(row.id, id);
        await client.query(`INSERT INTO "OperationsUnit" (id, "tenantId", "companyId", code, "nameAr", "nameEn", dimension, "isActive") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, TENANT_ID, COMPANY_ID, row.code, row.nameAr, row.nameEn, row.dimension, row.isActive]);
      }
      for (const row of categories) {
        const id = randomUUID(); categoryTarget.set(row.id, id);
        await client.query(`INSERT INTO "OperationsCatalogCategory" (id, "tenantId", "companyId", code, "nameAr", "nameEn", "isActive", "sortOrder") VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [id, TENANT_ID, COMPANY_ID, `NXR-CAT-${row.id}`, row.nameAr, row.nameEn, row.isActive, row.sortOrder]);
      }
      for (const row of safeItems) {
        const id = randomUUID(); itemTarget.set(row.id, id);
        const kind = row.itemType === 'purchased' ? 'RAW_MATERIAL' : 'MENU_PRODUCT';
        const sectionId = row.itemType === 'sale' && row.inferredSectionId ? sectionTarget.get(row.inferredSectionId) : null;
        const categoryId = row.categoryId ? categoryTarget.get(row.categoryId) ?? null : null;
        if (kind === 'MENU_PRODUCT' && !sectionId && row.isActive) throw new Error(`Active menu item ${row.id} lacks a mapped section.`);
        await client.query(`INSERT INTO "OperationsItem" (id, "tenantId", "companyId", "sectionId", "categoryId", "baseUnitId", code, "nameAr", "nameEn", kind, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [id, TENANT_ID, COMPANY_ID, sectionId, categoryId, unitTarget.get(row.kernelUnitId), `NXR-${row.id}`, row.nameAr, row.nameEn, kind, row.isActive ? 'ACTIVE' : 'ARCHIVED']);
      }
      for (const row of itemUnitRows) {
        const item = itemBySourceId.get(row.itemId); if (!item) throw new Error(`Missing source item for unit ${row.id}.`);
        const isRaw = item.itemType === 'purchased';
        await client.query(`INSERT INTO "OperationsItemUnit" (id, "tenantId", "companyId", "itemId", "unitId", "isBase", "isOrderEnabled", "isActive", "lastPurchaseUnitPrice", "lastPurchasePriceAt", "menuSaleUnitPrice") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
          randomUUID(), TENANT_ID, COMPANY_ID, itemTarget.get(row.itemId), unitTarget.get(row.unitId), item.kernelUnitId === row.unitId,
          row.isOrderEnabled, row.isActive, isRaw ? asPositiveNumeric(row.lastPrice) : null,
          isRaw && asPositiveNumeric(row.lastPrice) ? row.lastPriceAt : null, !isRaw ? asPositiveNumeric(row.salePrice) : null,
        ]);
      }
      const sourceVersionByItem = new Map(conversionVersionsToImport.map((row) => [row.itemId, row]));
      for (const row of conversionVersionsToImport) {
        const id = randomUUID(); conversionTarget.set(row.id, id);
        await client.query(`INSERT INTO "OperationsItemConversionVersion" (id, "tenantId", "companyId", "itemId", version, status, "publishedBy", "publishedAt") VALUES ($1,$2,$3,$4,$5,'PUBLISHED',$6,coalesce($7::timestamptz, now()))`, [id, TENANT_ID, COMPANY_ID, itemTarget.get(row.itemId), row.version, ACTOR_ID, row.publishedAt]);
        for (const edge of conversionEdgesByVersion.get(row.id) ?? []) {
          await client.query(`INSERT INTO "OperationsItemConversionEdge" (id, "tenantId", "companyId", "versionId", "fromUnitId", "toUnitId", factor) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [randomUUID(), TENANT_ID, COMPANY_ID, id, unitTarget.get(edge.fromUnitId), unitTarget.get(edge.toUnitId), String(edge.factor)]);
        }
      }
      for (const row of recipeVersionsToImport) {
        const id = randomUUID();
        await client.query(`INSERT INTO "OperationsRecipeVersion" (id, "tenantId", "companyId", "outputItemId", "outputUnitId", version, "outputQuantity", status, "publishedBy", "publishedAt") VALUES ($1,$2,$3,$4,$5,$6,$7,'PUBLISHED',$8,coalesce($9::timestamptz, now()))`, [id, TENANT_ID, COMPANY_ID, itemTarget.get(row.outputItemId), unitTarget.get(row.outputUnitId), row.version, String(row.outputQuantity), ACTOR_ID, row.publishedAt]);
        for (const line of recipeLines.filter((entry) => entry.recipeVersionId === row.id)) {
          const component = itemBySourceId.get(line.componentItemId);
          const sourceConversion = sourceVersionByItem.get(component.id);
          await client.query(`INSERT INTO "OperationsRecipeLine" (id, "tenantId", "companyId", "recipeVersionId", "rawMaterialItemId", "unitId", "baseUnitId", "conversionVersionId", quantity, "resolvedBaseQuantity", "sortOrder") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [randomUUID(), TENANT_ID, COMPANY_ID, id, itemTarget.get(line.componentItemId), unitTarget.get(line.unitId), unitTarget.get(component.kernelUnitId), sourceConversion ? conversionTarget.get(sourceConversion.id) : null, String(line.quantity), resolvedBaseQuantity(line, component, sourceVersionByItem), line.sortOrder]);
        }
      }
      const financeAfter = (await client.query(financeBaselineSql, [TENANT_ID, COMPANY_ID])).rows[0].snapshot;
      if (!sameFinanceSnapshot(financeAfter, financeBefore)) throw new Error(`Finance protection gate failed: ${JSON.stringify({ financeBefore, financeAfter })}`);
      const created = { sections: sections.length, units: units.length, categories: categories.length, items: safeItems.length, itemUnits: itemUnitRows.length, conversionVersions: conversionVersionsToImport.length, conversionEdges: sourceSnapshot.counts.conversionEdges, recipeVersions: recipeVersionsToImport.length, recipeLines: sourceSnapshot.counts.recipeLines };
      await client.query(`INSERT INTO "AuditEvent" (id, "tenantId", "companyId", "actorUserId", action, "entityType", "entityId", "requestId", "afterJson") VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`, [randomUUID(), TENANT_ID, COMPANY_ID, ACTOR_ID, 'nurix.operations_catalog.import.completed', 'OperationsCatalogMigration', planSha, `nurix-operations-catalog:${planSha}`, JSON.stringify({ version: VERSION, planSha, source: sourceSnapshot, created, financeBefore, financeAfter, excludedScope: ['orders', 'receipts', 'reversals', 'internal registrations', 'custody', 'inventory movements', 'financial postings'] })]);
      await client.query('COMMIT');
      console.log(JSON.stringify({ status: 'COMPLETED', version: VERSION, planSha, created, withheldItems: sourceSnapshot.withheldItems, financeBefore, financeAfter }, null, 2));
    } catch (error) {
      await client.query('ROLLBACK'); throw error;
    }
  }
} finally {
  await client.end();
}
