#!/usr/bin/env node
/**
 * Deliberately narrow BASEER ERP -> BASEER ERP company bridge.
 *
 * It is not a database restore.  It exports only an approved company scope,
 * then imports it under a different tenant with deterministic target IDs and
 * append-only LegacyMigration lineage.  Credentials, sessions, runtime audit,
 * AI/provider state, report jobs, and file/blob payloads never enter a bundle.
 *
 * Usage:
 *   node scripts/run-baseer-company-bridge.mjs export --source-url "$URL" --company-ids "$ID,$ID,$ID" --output artifacts/migration/bridge/companies.json
 *   node scripts/run-baseer-company-bridge.mjs import --target-url "$URL" --owner-login owner@example.com --input artifacts/migration/bridge/companies.json
 */
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Pool } from "pg";

const FORMAT = "baseer-company-bridge/v1";
const SOURCE_SYSTEM = "baseer-erp-local-bridge";
const TRANSFORM_VERSION = "baseer-company-bridge-v1";

// Ordered by foreign-key ownership. This is intentionally an allow-list; a new
// table cannot silently become production migration input just because it has a
// companyId column.
const TABLE_ORDER = [
  "Company",
  "CompanyBranding",
  "CompanyFinanceProfile",
  "DocumentSerialCounter",
  "FinanceAccount",
  "FinanceAccountDailyBalance",
  "FinanceAccountMonthlyBalance",
  "FinanceFiscalPeriod",
  "FinanceLedgerRevision",
  "FinanceVault",
  "FinanceSupplier",
  "FinanceCategory",
  "FinancePnlMappingVersion",
  "FinancePnlStatementLine",
  "FinancePnlAccountMapping",
  "FinanceJournalEntry",
  "FinanceJournalLine",
  "FinanceRecurringExpenseProfile",
  "FinanceOutflowDocument",
  "FinanceOutflowAllocation",
  "FinanceRecurringExpenseCoverage",
  "FinanceDailyFinancialSummary",
  "FinanceDailySalesChannelSummary",
  "FinanceDailySalesClosing",
  "FinanceDailySalesAllocation",
  "FinanceCashPerformanceEvent",
  "FinanceInclusiveLoan",
  "FinanceInclusiveLoanPayment",
  "HrCompensationPolicy",
  "HrCompensationPolicyVersion",
  "HrEmployee",
  "HrEmployeeCompensationProfile",
  "HrEmployeeAdvance",
  "HrEmployeeAdvancePayoutAllocation",
  "HrEmployeeAdvanceSettlement",
  "HrEmployeeFinancialMovement",
  "HrEmployeeService",
  "HrPayrollRun",
  "HrPayrollLine",
  "HrPayrollPayment",
  "HrPayrollPaymentAllocation",
  "OperationsSection",
  "OperationsUnit",
  "OperationsCatalogCategory",
  "OperationsItem",
  "OperationsItemUnit",
  "OperationsItemConversionVersion",
  "OperationsItemConversionEdge",
  "OperationsRecipeVersion",
  "OperationsRecipeLine",
];

const DEFERRED_REFERENCE_COLUMNS = new Set([
  "FinanceSupplier.categoryId",
  "FinanceCategory.parentId",
  "FinanceCategory.suggestedSupplierId",
]);

const SELF_REFERENCE_COLUMNS = new Map([
  ["FinanceJournalEntry", "reversalOfEntryId"],
  ["FinanceCashPerformanceEvent", "reversalOfEventId"],
]);

const UNSUPPORTED_NON_NULL_COLUMNS = new Set([
  "FinanceSupplier.counterpartyIdentityId",
  "FinanceOutflowDocument.batchId",
  "HrPayrollLine.contractWorkTermsId",
]);

const USER_REFERENCE_COLUMNS = new Set([
  "actorUserId",
  "approvedByUserId",
  "createdByUserId",
  "importedByUserId",
  "initiatedByUserId",
  "publishedBy",
  "requestedByUserId",
  "updatedByUserId",
]);

const JSON_COLUMNS = new Set([
  "FinanceCashPerformanceEvent.settlementDestinationsJson",
  "HrPayrollLine.compensationPolicySnapshotJson",
  "HrPayrollLine.payrollCalculationSnapshotJson",
]);

function fail(message) { throw new Error(`BASEER company bridge: ${message}`); }

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

function required(name) {
  const value = option(name);
  if (!value || value.startsWith("--")) fail(`--${name} is required.`);
  return value;
}

function assertUrl(value, name) {
  try { new URL(value); } catch { fail(`--${name} must be a PostgreSQL URL.`); }
  return value;
}

function assertUuid(value, name) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail(`${name} is not a UUID.`);
  return value;
}

function parseCompanyIds(value) {
  const ids = [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
  if (ids.length !== 3) fail("exactly three --company-ids are required for this approved migration scope.");
  ids.forEach((id) => assertUuid(id, "company id"));
  return ids;
}

function quoteIdentifier(value) {
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(value)) fail(`unsafe identifier: ${value}`);
  return `"${value}"`;
}

function canonical(value) {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) { return createHash("sha256").update(value).digest("hex"); }

function deterministicUuid(namespace) {
  const bytes = createHash("sha256").update(namespace).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sourceRowId(table, row) {
  return typeof row.id === "string" ? row.id : `composite:${sha256(canonical(row))}`;
}

function bundleSummary(bundle) {
  return Object.fromEntries(TABLE_ORDER.map((table) => [table, bundle.tables[table]?.length ?? 0]).filter(([, count]) => count > 0));
}

async function exportBundle() {
  const sourceUrl = assertUrl(required("source-url"), "source-url");
  const companyIds = parseCompanyIds(required("company-ids"));
  const output = resolve(required("output"));
  const pool = new Pool({ connectionString: sourceUrl });
  try {
    const tables = {};
    for (const table of TABLE_ORDER) {
      const query = table === "Company"
        ? `SELECT * FROM ${quoteIdentifier(table)} WHERE id = ANY($1::uuid[]) ORDER BY id`
        : `SELECT * FROM ${quoteIdentifier(table)} WHERE "companyId" = ANY($1::uuid[]) ORDER BY 1`;
      const result = await pool.query(query, [companyIds]);
      tables[table] = result.rows;
    }
    if (tables.Company.length !== companyIds.length) fail("one or more approved source companies are missing.");
    const tenantIds = [...new Set(tables.Company.map((company) => company.tenantId))];
    if (tenantIds.length !== 1) fail("approved companies must belong to exactly one source tenant.");
    const bundle = {
      format: FORMAT,
      transformVersion: TRANSFORM_VERSION,
      exportedAt: new Date().toISOString(),
      source: { tenantId: tenantIds[0], companyIds: [...companyIds].sort() },
      exclusions: [
        "authentication credentials and users",
        "sessions and throttling state",
        "idempotency receipts and raw audit records",
        "backup jobs, report output runs, AI/provider state",
        "file and blob metadata/payloads",
      ],
      tables,
    };
    bundle.fingerprint = sha256(canonical({ format: bundle.format, transformVersion: bundle.transformVersion, source: bundle.source, tables: bundle.tables }));
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(bundle)}\n`, { encoding: "utf8", mode: 0o600 });
    console.log(JSON.stringify({ output, fingerprint: bundle.fingerprint, counts: bundleSummary(bundle) }, null, 2));
  } finally { await pool.end(); }
}

function assertBundle(bundle) {
  if (!bundle || bundle.format !== FORMAT || bundle.transformVersion !== TRANSFORM_VERSION) fail("unsupported bundle format or transform version.");
  if (!Array.isArray(bundle.source?.companyIds) || bundle.source.companyIds.length !== 3) fail("bundle company scope is invalid.");
  for (const table of TABLE_ORDER) if (!Array.isArray(bundle.tables?.[table])) fail(`bundle is missing table ${table}.`);
  const expectedFingerprint = sha256(canonical({ format: bundle.format, transformVersion: bundle.transformVersion, source: bundle.source, tables: bundle.tables }));
  if (bundle.fingerprint !== expectedFingerprint) fail("bundle fingerprint does not match its contents.");
}

function buildIdMap(bundle) {
  const map = new Map();
  for (const table of TABLE_ORDER) {
    for (const row of bundle.tables[table]) {
      if (typeof row.id === "string") map.set(row.id, deterministicUuid(`${bundle.fingerprint}:${table}:${row.id}`));
    }
  }
  return map;
}

function targetCompanyId(idMap, sourceCompanyId) {
  const target = idMap.get(sourceCompanyId);
  if (!target) fail(`missing target mapping for source company ${sourceCompanyId}.`);
  return target;
}

function orderRowsForInsert(table, rows) {
  const parentColumn = SELF_REFERENCE_COLUMNS.get(table);
  if (!parentColumn) return rows;
  const remaining = new Map(rows.map((row) => [row.id, row]));
  const ordered = [];
  while (remaining.size) {
    const ready = [...remaining.values()]
      .filter((row) => !row[parentColumn] || !remaining.has(row[parentColumn]))
      .sort((left, right) => String(left.id).localeCompare(String(right.id)));
    if (!ready.length) fail(`${table} has a cyclic or out-of-scope ${parentColumn} reference.`);
    for (const row of ready) {
      remaining.delete(row.id);
      ordered.push(row);
    }
  }
  return ordered;
}

function unsupportedReferences(row, table) {
  return [...UNSUPPORTED_NON_NULL_COLUMNS]
    .filter((entry) => entry.startsWith(`${table}.`))
    .filter((entry) => row[entry.slice(table.length + 1)] !== null && row[entry.slice(table.length + 1)] !== undefined);
}

function transformRow({ bundle, idMap, targetTenantId, targetOwnerUserId, table, row, defer = false }) {
  const unsupported = unsupportedReferences(row, table);
  if (unsupported.length) fail(`${table} contains unsupported non-null reference(s): ${unsupported.join(", ")}.`);
  const sourceCompanyId = table === "Company" ? row.id : row.companyId;
  const transformed = {};
  for (const [column, sourceValue] of Object.entries(row)) {
    const key = `${table}.${column}`;
    if (JSON_COLUMNS.has(key)) {
      if (sourceValue === null || sourceValue === undefined) transformed[column] = null;
      else if (typeof sourceValue === "string") {
        JSON.parse(sourceValue);
        transformed[column] = sourceValue;
      } else transformed[column] = JSON.stringify(sourceValue);
      continue;
    }
    if (DEFERRED_REFERENCE_COLUMNS.has(key) && sourceValue !== null && sourceValue !== undefined) {
      transformed[column] = defer ? null : (typeof sourceValue === "string" && idMap.has(sourceValue) ? idMap.get(sourceValue) : sourceValue);
      continue;
    }
    if (column === "tenantId") { transformed[column] = targetTenantId; continue; }
    if (column === "companyId") { transformed[column] = targetCompanyId(idMap, sourceValue); continue; }
    if (USER_REFERENCE_COLUMNS.has(column)) { transformed[column] = sourceValue === null ? null : targetOwnerUserId; continue; }
    if (column === "id" && typeof sourceValue === "string") { transformed[column] = idMap.get(sourceValue) ?? sourceValue; continue; }
    if (typeof sourceValue === "string" && idMap.has(sourceValue)) { transformed[column] = idMap.get(sourceValue); continue; }
    transformed[column] = sourceValue;
  }
  if (table === "Company") {
    transformed.id = targetCompanyId(idMap, sourceCompanyId);
    transformed.migrationReviewLocked = true;
  }
  // The database correctly rejects lines added to a sealed journal. Historical
  // journals are therefore inserted unsealed, populated with their immutable
  // lines, then sealed again with every original non-sealing field unchanged.
  if (table === "FinanceJournalEntry" && defer && transformed.isSealed) {
    transformed.isSealed = false;
    transformed.sealedAt = null;
  }
  if (table === "CompanyBranding") transformed.logoFileMetadataId = null;
  return transformed;
}

async function insertRows(client, table, rows) {
  if (!rows.length) return;
  const columns = Object.keys(rows[0]);
  for (const row of rows) {
    if (JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(columns.slice().sort())) fail(`${table} has inconsistent column shape.`);
  }
  const columnsSql = columns.map(quoteIdentifier).join(", ");
  const chunkSize = Math.max(1, Math.floor(60000 / columns.length));
  for (let start = 0; start < rows.length; start += chunkSize) {
    const chunk = rows.slice(start, start + chunkSize);
    const values = [];
    const placeholders = chunk.map((row, rowIndex) => `(${columns.map((_, columnIndex) => `$${rowIndex * columns.length + columnIndex + 1}`).join(", ")})`);
    for (const row of chunk) for (const column of columns) values.push(row[column]);
    try {
      await client.query(`INSERT INTO ${quoteIdentifier(table)} (${columnsSql}) VALUES ${placeholders.join(", ")} ON CONFLICT DO NOTHING`, values);
    } catch (error) {
      const sampleIds = chunk.slice(0, 3).map((row) => row.id ?? "composite").join(",");
      error.message = `${table} rows ${start}-${start + chunk.length - 1} (sample target IDs ${sampleIds}): ${error.message}`;
      throw error;
    }
  }
}

async function applyDeferredReferences(client, { bundle, idMap, targetTenantId, targetOwnerUserId }) {
  for (const entry of DEFERRED_REFERENCE_COLUMNS) {
    const [table, column] = entry.split(".");
    for (const row of bundle.tables[table]) {
      if (row[column] === null || row[column] === undefined) continue;
      const transformed = transformRow({ bundle, idMap, targetTenantId, targetOwnerUserId, table, row, defer: false });
      const targetId = transformed.id;
      const targetCompany = transformed.companyId;
      await client.query(
        `UPDATE ${quoteIdentifier(table)} SET ${quoteIdentifier(column)} = $1 WHERE id = $2 AND "tenantId" = $3 AND "companyId" = $4`,
        [transformed[column], targetId, targetTenantId, targetCompany],
      );
    }
  }
}

async function resealJournals(client, { bundle, idMap, targetTenantId, targetOwnerUserId }) {
  for (const row of bundle.tables.FinanceJournalEntry) {
    if (!row.isSealed) continue;
    const transformed = transformRow({ bundle, idMap, targetTenantId, targetOwnerUserId, table: "FinanceJournalEntry", row, defer: false });
    await client.query(
      `UPDATE "FinanceJournalEntry" SET "isSealed" = TRUE, "sealedAt" = $1 WHERE id = $2 AND "tenantId" = $3 AND "companyId" = $4`,
      [transformed.sealedAt, transformed.id, targetTenantId, transformed.companyId],
    );
  }
}

async function insertLineage(client, { bundle, runId, idMap, targetTenantId, targetOwnerUserId }) {
  const rows = [];
  for (const table of TABLE_ORDER) {
    for (const row of bundle.tables[table]) {
      const sourceCompanyId = table === "Company" ? row.id : row.companyId;
      const targetCompanyIdValue = targetCompanyId(idMap, sourceCompanyId);
      const sourceId = sourceRowId(table, row);
      const transformed = transformRow({ bundle, idMap, targetTenantId, targetOwnerUserId, table, row, defer: false });
      const targetId = typeof transformed.id === "string" ? transformed.id : `composite:${sha256(canonical(transformed))}`;
      rows.push({
        id: deterministicUuid(`${runId}:record:${table}:${sourceId}`),
        runId,
        tenantId: targetTenantId,
        targetCompanyId: targetCompanyIdValue,
        sourceCompanyId,
        sourceEntity: table,
        sourceId,
        targetEntity: table,
        targetId,
        transformVersion: TRANSFORM_VERSION,
        sourceChecksum: sha256(canonical(row)),
        state: "STAGED",
      });
    }
  }
  await insertRows(client, "LegacyMigrationRecordMap", rows);
}

async function recordControlledExclusions(client, { bundle, runId, targetTenantId }) {
  const sourceRowsWithLogoMetadata = bundle.tables.CompanyBranding.filter((row) => row.logoFileMetadataId !== null && row.logoFileMetadataId !== undefined);
  for (const row of sourceRowsWithLogoMetadata) {
    await client.query(
      `INSERT INTO "LegacyMigrationException" (id, "runId", "tenantId", "sourceCompanyId", "sourceEntity", severity, code, message)
       VALUES ($1, $2, $3, $4, 'CompanyBranding', 'WARNING', 'FILE_METADATA_EXCLUDED', 'Company logo metadata was excluded because its controlled file payload is not part of this bridge.')
       ON CONFLICT (id) DO NOTHING`,
      [deterministicUuid(`${runId}:exception:CompanyBranding:${row.companyId}:logo`), runId, targetTenantId, row.companyId],
    );
  }
}

async function importBundle() {
  const targetUrl = assertUrl(required("target-url"), "target-url");
  const ownerLogin = required("owner-login").trim().toLowerCase();
  const input = resolve(required("input"));
  const bundle = JSON.parse(await readFile(input, "utf8"));
  assertBundle(bundle);
  const pool = new Pool({ connectionString: targetUrl });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`${SOURCE_SYSTEM}:${bundle.fingerprint}:${TRANSFORM_VERSION}`]);
    const owner = await client.query(
      `SELECT u.id AS "userId", u."tenantId" AS "tenantId"
       FROM "User" u
       JOIN "TenantAdministrationAssignment" a ON a."tenantId" = u."tenantId" AND a."userId" = u.id AND a."isOwner" = TRUE
       WHERE u."loginNormalized" = $1 AND u.status = 'ACTIVE'
       FOR UPDATE`,
      [ownerLogin],
    );
    if (owner.rowCount !== 1) fail("target owner is missing, inactive, or ambiguous.");
    const { userId: targetOwnerUserId, tenantId: targetTenantId } = owner.rows[0];

    let manager = await client.query(`SELECT id FROM "Role" WHERE "tenantId" = $1 AND code = 'BASEER_COMPANY_MANAGER' FOR UPDATE`, [targetTenantId]);
    if (manager.rowCount === 0) {
      const id = randomUUID();
      await client.query(
        `INSERT INTO "Role" (id, "tenantId", code, "nameAr", "nameEn", "isSystem") VALUES ($1, $2, 'BASEER_COMPANY_MANAGER', 'مدير الشركة', 'Company manager', TRUE)`,
        [id, targetTenantId],
      );
      manager = { rows: [{ id }] };
    }
    const managerRoleId = manager.rows[0].id;

    let existingRun = await client.query(
      `SELECT id, status FROM "LegacyMigrationRun" WHERE "tenantId" = $1 AND "sourceSystem" = $2 AND "sourceFingerprint" = $3 AND "transformVersion" = $4 FOR UPDATE`,
      [targetTenantId, SOURCE_SYSTEM, bundle.fingerprint, TRANSFORM_VERSION],
    );
    if (existingRun.rowCount === 1 && existingRun.rows[0].status === "STAGED") {
      await client.query("COMMIT");
      console.log(JSON.stringify({ runId: existingRun.rows[0].id, fingerprint: bundle.fingerprint, replayed: true, reviewLocked: true }, null, 2));
      return;
    }
    const runId = existingRun.rowCount === 1 ? existingRun.rows[0].id : randomUUID();
    if (existingRun.rowCount === 0) {
      await client.query(
        `INSERT INTO "LegacyMigrationRun" (id, "tenantId", "sourceSystem", "sourceFingerprint", "transformVersion", status, "initiatedByUserId") VALUES ($1, $2, $3, $4, $5, 'DRY_RUN', $6)`,
        [runId, targetTenantId, SOURCE_SYSTEM, bundle.fingerprint, TRANSFORM_VERSION, targetOwnerUserId],
      );
    }

    await recordControlledExclusions(client, { bundle, runId, targetTenantId });

    const idMap = buildIdMap(bundle);
    for (const table of TABLE_ORDER) {
      const transformedRows = orderRowsForInsert(table, bundle.tables[table])
        .map((row) => transformRow({ bundle, idMap, targetTenantId, targetOwnerUserId, table, row, defer: true }));
      await insertRows(client, table, transformedRows);
      if (table === "FinanceJournalLine") {
        await resealJournals(client, { bundle, idMap, targetTenantId, targetOwnerUserId });
      }
    }
    await applyDeferredReferences(client, { bundle, idMap, targetTenantId, targetOwnerUserId });

    for (const sourceCompanyId of bundle.source.companyIds) {
      const targetCompanyIdValue = targetCompanyId(idMap, sourceCompanyId);
      await client.query(
        `INSERT INTO "CompanyMembership" ("tenantId", "userId", "companyId", "roleId") VALUES ($1, $2, $3, $4)
         ON CONFLICT ("userId", "companyId") DO UPDATE SET "roleId" = EXCLUDED."roleId"`,
        [targetTenantId, targetOwnerUserId, targetCompanyIdValue, managerRoleId],
      );
      await client.query(
        `INSERT INTO "LegacyMigrationCompanyMap" (id, "runId", "tenantId", "sourceCompanyId", "targetCompanyId", state)
         VALUES ($1, $2, $3, $4, $5, 'PLANNED') ON CONFLICT ("runId", "sourceCompanyId") DO NOTHING`,
        [deterministicUuid(`${runId}:company:${sourceCompanyId}`), runId, targetTenantId, sourceCompanyId, targetCompanyIdValue],
      );
    }
    await insertLineage(client, { bundle, runId, idMap, targetTenantId, targetOwnerUserId });
    await client.query(`UPDATE "LegacyMigrationRun" SET status = 'STAGED' WHERE id = $1`, [runId]);
    await client.query("COMMIT");
    console.log(JSON.stringify({ runId, fingerprint: bundle.fingerprint, targetTenantId, counts: bundleSummary(bundle), reviewLocked: true }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function countScoped(client, table, companyIds) {
  const query = table === "Company"
    ? `SELECT count(*)::int AS count FROM ${quoteIdentifier(table)} WHERE id = ANY($1::uuid[])`
    : `SELECT count(*)::int AS count FROM ${quoteIdentifier(table)} WHERE "companyId" = ANY($1::uuid[])`;
  return (await client.query(query, [companyIds])).rows[0].count;
}

async function financialScope(client, companyIds) {
  const sales = await client.query(
    `SELECT "companyId", count(*)::int AS count, COALESCE(sum("grossAmount"), 0)::text AS gross, COALESCE(sum("netAmount"), 0)::text AS net, COALESCE(sum("vatAmount"), 0)::text AS vat
     FROM "FinanceDailySalesClosing" WHERE "companyId" = ANY($1::uuid[]) GROUP BY "companyId" ORDER BY "companyId"`,
    [companyIds],
  );
  const journals = await client.query(
    `SELECT "companyId", count(*)::int AS count, COALESCE(sum("debitAmount"), 0)::text AS debit, COALESCE(sum("creditAmount"), 0)::text AS credit
     FROM "FinanceJournalLine" WHERE "companyId" = ANY($1::uuid[]) GROUP BY "companyId" ORDER BY "companyId"`,
    [companyIds],
  );
  return { sales: sales.rows, journals: journals.rows };
}

function normaliseFinancial(rows, sourceToTarget) {
  return rows.map((row) => ({ ...row, companyId: sourceToTarget.get(row.companyId) ?? row.companyId })).sort((left, right) => left.companyId.localeCompare(right.companyId));
}

async function verifyBundle() {
  const sourceUrl = assertUrl(required("source-url"), "source-url");
  const targetUrl = assertUrl(required("target-url"), "target-url");
  const ownerLogin = required("owner-login").trim().toLowerCase();
  const bundle = JSON.parse(await readFile(resolve(required("input")), "utf8"));
  assertBundle(bundle);
  const source = new Pool({ connectionString: sourceUrl });
  const target = new Pool({ connectionString: targetUrl });
  try {
    const owner = await target.query(
      `SELECT u.id AS "userId", u."tenantId" AS "tenantId" FROM "User" u
       JOIN "TenantAdministrationAssignment" a ON a."tenantId" = u."tenantId" AND a."userId" = u.id AND a."isOwner" = TRUE
       WHERE u."loginNormalized" = $1 AND u.status = 'ACTIVE'`,
      [ownerLogin],
    );
    if (owner.rowCount !== 1) fail("target owner is missing, inactive, or ambiguous.");
    const { userId, tenantId } = owner.rows[0];
    const run = await target.query(
      `SELECT id, status FROM "LegacyMigrationRun" WHERE "tenantId" = $1 AND "sourceSystem" = $2 AND "sourceFingerprint" = $3 AND "transformVersion" = $4`,
      [tenantId, SOURCE_SYSTEM, bundle.fingerprint, TRANSFORM_VERSION],
    );
    if (run.rowCount !== 1) fail("target migration run was not found.");
    const companyMaps = await target.query(
      `SELECT "sourceCompanyId", "targetCompanyId" FROM "LegacyMigrationCompanyMap" WHERE "runId" = $1 ORDER BY "sourceCompanyId"`,
      [run.rows[0].id],
    );
    if (companyMaps.rowCount !== bundle.source.companyIds.length) fail("target company lineage is incomplete.");
    const sourceToTarget = new Map(companyMaps.rows.map((row) => [row.sourceCompanyId, row.targetCompanyId]));
    const targetIds = companyMaps.rows.map((row) => row.targetCompanyId);
    const countMismatches = [];
    for (const table of TABLE_ORDER) {
      const [sourceCount, targetCount] = await Promise.all([
        countScoped(source, table, bundle.source.companyIds),
        countScoped(target, table, targetIds),
      ]);
      if (sourceCount !== targetCount) countMismatches.push({ table, sourceCount, targetCount });
    }
    const [sourceFinancial, targetFinancial, companyState] = await Promise.all([
      financialScope(source, bundle.source.companyIds),
      financialScope(target, targetIds),
      target.query(
        `SELECT c.id, c."migrationReviewLocked", count(m."userId")::int AS memberships,
                bool_or(m."userId" = $1)::boolean AS owner_member
         FROM "Company" c LEFT JOIN "CompanyMembership" m ON m."companyId" = c.id AND m."tenantId" = c."tenantId"
         WHERE c.id = ANY($2::uuid[]) AND c."tenantId" = $3
         GROUP BY c.id, c."migrationReviewLocked" ORDER BY c.id`,
        [userId, targetIds, tenantId],
      ),
    ]);
    const salesMatch = canonical(normaliseFinancial(sourceFinancial.sales, sourceToTarget)) === canonical(targetFinancial.sales);
    const journalsMatch = canonical(normaliseFinancial(sourceFinancial.journals, sourceToTarget)) === canonical(targetFinancial.journals);
    const journalsBalanced = targetFinancial.journals.every((row) => row.debit === row.credit);
    const companyAccessMatch = companyState.rowCount === 3 && companyState.rows.every((row) => row.migrationReviewLocked && row.memberships === 1 && row.owner_member);
    const receipt = {
      runId: run.rows[0].id,
      runStatus: run.rows[0].status,
      fingerprint: bundle.fingerprint,
      countsMatched: countMismatches.length === 0,
      countMismatches,
      salesMatch,
      journalsMatch,
      journalsBalanced,
      companyAccessMatch,
      ok: countMismatches.length === 0 && salesMatch && journalsMatch && journalsBalanced && companyAccessMatch,
    };
    console.log(JSON.stringify(receipt, null, 2));
    if (!receipt.ok) process.exitCode = 1;
  } finally {
    await source.end();
    await target.end();
  }
}

const command = process.argv[2];
if (command === "export") await exportBundle();
else if (command === "import") await importBundle();
else if (command === "verify") await verifyBundle();
else fail("use either export or import.");
