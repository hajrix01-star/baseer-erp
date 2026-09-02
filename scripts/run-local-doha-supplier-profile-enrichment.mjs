/**
 * Owner-authorized Doha supplier enrichment from the supplied CSV and the
 * frozen Noorix snapshot. The source supplier category is Noorix
 * suppliers.category_id (purchases/expenses); it is never inferred from a
 * document or a display name. Specific financial categories remain untouched
 * because the CSV does not carry a specific category per supplier.
 *
 * Usage:
 *   node scripts/run-local-doha-supplier-profile-enrichment.mjs DRY_RUN <suppliers.csv>
 *   node scripts/run-local-doha-supplier-profile-enrichment.mjs APPLY_APPROVED_DOHA_SUPPLIER_PROFILE_ENRICHMENT_V1 <suppliers.csv> [owner-user-uuid]
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

const DRY_RUN = 'DRY_RUN';
const APPLY = 'APPLY_APPROVED_DOHA_SUPPLIER_PROFILE_ENRICHMENT_V1';
const VERSION = 'doha-supplier-source-profile-enrichment/v1';
const TENANT_ID = '6ffae759-800e-4653-8543-51013f5ef751';
const COMPANY_ID = '3c032ff1-c00d-4784-99ae-a9bf53e09e0d';
const SOURCE_COMPANY_ID = 'cmnf5xrd0001uy8lm8vja50gp';
const DEFAULT_ACTOR_ID = 'c89fb913-2f7c-404e-84d7-161146766f77';
const [mode, csvPath, actorUserId = DEFAULT_ACTOR_ID] = process.argv.slice(2);
if (![DRY_RUN, APPLY].includes(mode ?? '') || !csvPath || !/^[0-9a-f-]{36}$/i.test(actorUserId)) throw new Error(`Usage: node scripts/run-local-doha-supplier-profile-enrichment.mjs ${DRY_RUN}|${APPLY} <suppliers.csv> [owner-user-uuid]`);
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') throw new Error('This writer only permits the canonical local Baseer test database.');

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const arabicDigits = Object.freeze({ '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' });
const digits = (value) => String(value ?? '').replace(/[٠-٩۰-۹]/g, (digit) => arabicDigits[digit]);
const normalizeName = (value) => digits(value).normalize('NFKC').trim().toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
const taxNumber = (value) => digits(value).normalize('NFKC').replace(/[\s-]+/g, '').trim();
const validVat = (value) => /^3\d{13}3$/.test(value);
const header = (value) => normalizeName(value).replace(/[^a-z0-9\p{Script=Arabic}]/gu, '');

function parseCsv(contents) {
  const table = []; let row = []; let cell = ''; let quoted = false;
  for (let index = 0; index < contents.length; index += 1) {
    const char = contents[index];
    if (quoted) {
      if (char === '"' && contents[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); table.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  if (cell.length || row.length) { row.push(cell); table.push(row); }
  const nonBlank = table.filter((values) => values.some((value) => value.trim()));
  if (nonBlank.length < 2) throw new Error('CSV must include a header and at least one row.');
  const keys = nonBlank[0].map((value) => header(value.replace(/^\uFEFF/, '').trim()));
  if (new Set(keys).size !== keys.length) throw new Error('CSV headers are ambiguous after normalization.');
  const pick = (record, aliases) => record[aliases.find((alias) => record[alias] !== undefined)] ?? '';
  return nonBlank.slice(1).map((values, index) => {
    const record = Object.fromEntries(keys.map((key, column) => [key, String(values[column] ?? '').trim()]));
    return { rowNumber: index + 2, nameAr: pick(record, ['اسمالعربي', 'اسمالموردبالعربي', 'الاسمبالعربي', 'اسمالمورد', 'namear']), nameEn: pick(record, ['اسمالانجليزي', 'اسمالموردبالانجليزي', 'الاسمبالانجليزي', 'nameen']), taxNumber: taxNumber(pick(record, ['الرقمالضريبي', 'taxnumber', 'vatnumber'])), category: String(pick(record, ['نوعالموردpurchasesexpenses', 'suppliertypepurchasesexpenses', 'suppliertype', 'type'])).trim().toLowerCase() };
  });
}

const typeFor = (value) => value === 'purchases' || value === 'purchase' ? 'PURCHASE' : value === 'expenses' || value === 'expense' ? 'EXPENSE' : null;
const sourceSql = `SELECT COALESCE(json_agg(json_build_object('sourceId',s.id,'nameAr',s.name_ar,'nameEn',s.name_en,'taxNumber',coalesce(s.tax_number,''),'category',lower(coalesce(s.category_id,''))) ORDER BY s.id), '[]'::json)::text FROM suppliers s WHERE s.company_id='${SOURCE_COMPANY_ID}' AND NOT s.is_deleted;`;
const sourceSuppliers = JSON.parse(execFileSync('docker', ['exec', 'baseer-noorix-snapshot-20260902', 'psql', '-U', 'nurix_restore', '-d', 'nurix_snapshot', '-t', '-A', '-c', sourceSql], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim() || '[]');
if (!Array.isArray(sourceSuppliers) || !sourceSuppliers.length || sourceSuppliers.some((item) => !item.sourceId || !item.nameAr || !typeFor(item.category))) throw new Error('The frozen Noorix Doha supplier evidence is incomplete.');
const csv = parseCsv(readFileSync(resolve(csvPath), 'utf8'));
const uniqueByName = (row, candidates) => {
  const names = new Set([normalizeName(row.nameAr), normalizeName(row.nameEn)].filter(Boolean));
  const matches = candidates.filter((candidate) => names.has(normalizeName(candidate.nameAr)) || names.has(normalizeName(candidate.nameEn)));
  return matches.length === 1 ? matches[0] : null;
};

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_ID]);
  // A pg client processes one statement at a time; keep these reads sequential
  // so the reconciliation run is deterministic and emits no parallel-query warning.
  const company = await client.query(`SELECT id,"nameAr","migrationReviewLocked" FROM "Company" WHERE id=$1 AND "tenantId"=$2`, [COMPANY_ID, TENANT_ID]);
  const supplierRows = await client.query(`SELECT id,"nameAr","nameEn","supplierType","taxNumber",status FROM "FinanceSupplier" WHERE "tenantId"=$1 AND "companyId"=$2 AND status='ACTIVE'`, [TENANT_ID, COMPANY_ID]);
  const sourceMaps = await client.query(`SELECT "sourceId","targetId" FROM "NurixExcelFinancialSourceMap" WHERE "tenantId"=$1 AND "targetCompanyId"=$2 AND "sourceEntity"='Supplier' AND "targetEntity"='FinanceSupplier' AND state IN ('APPLIED','REUSED')`, [TENANT_ID, COMPANY_ID]);
  if (company.rowCount !== 1 || company.rows[0].nameAr !== 'دوحة المستهلك') throw new Error('The current Doha Al-Mustahlek company is unavailable.');
  const targetById = new Map(supplierRows.rows.map((item) => [item.id, item]));
  const targetIdBySource = new Map();
  for (const map of sourceMaps.rows) targetIdBySource.set(map.sourceId, targetIdBySource.has(map.sourceId) && targetIdBySource.get(map.sourceId) !== map.targetId ? null : map.targetId);
  const decisions = csv.map((row) => {
    const csvType = typeFor(row.category);
    if (!csvType) return { rowNumber: row.rowNumber, status: 'REVIEW_REQUIRED', reason: 'CSV_SOURCE_CATEGORY_INVALID' };
    if (row.taxNumber && !validVat(row.taxNumber)) return { rowNumber: row.rowNumber, status: 'REVIEW_REQUIRED', reason: 'CSV_VAT_FORMAT_INVALID' };
    const source = uniqueByName(row, sourceSuppliers);
    if (!source) return { rowNumber: row.rowNumber, status: 'REVIEW_REQUIRED', reason: 'SOURCE_SUPPLIER_NOT_UNIQUE' };
    const sourceType = typeFor(source.category);
    if (sourceType !== csvType) return { rowNumber: row.rowNumber, status: 'REVIEW_REQUIRED', reason: 'CSV_AND_NOORIX_CATEGORY_CONFLICT', sourceId: source.sourceId };
    const target = targetById.get(targetIdBySource.get(source.sourceId));
    if (!target) return { rowNumber: row.rowNumber, status: 'REVIEW_REQUIRED', reason: 'TARGET_SOURCE_MAP_MISSING_OR_AMBIGUOUS', sourceId: source.sourceId };
    const sourceTax = taxNumber(source.taxNumber), desiredTax = row.taxNumber || sourceTax, currentTax = taxNumber(target.taxNumber);
    if (sourceTax && row.taxNumber && sourceTax !== row.taxNumber) return { rowNumber: row.rowNumber, status: 'REVIEW_REQUIRED', reason: 'CSV_AND_NOORIX_VAT_CONFLICT', sourceId: source.sourceId, supplierId: target.id };
    if (currentTax && desiredTax && currentTax !== desiredTax) return { rowNumber: row.rowNumber, status: 'REVIEW_REQUIRED', reason: 'TARGET_VAT_CONFLICT', sourceId: source.sourceId, supplierId: target.id };
    const changes = { supplierType: target.supplierType === sourceType ? null : sourceType, taxNumber: !desiredTax || currentTax === desiredTax ? null : desiredTax };
    return { rowNumber: row.rowNumber, sourceId: source.sourceId, supplierId: target.id, status: Object.values(changes).some(Boolean) ? 'READY' : 'REUSED', changes, sourceChecksum: sha({ sourceId: source.sourceId, category: source.category, taxNumber: sourceTax }) };
  });
  const seen = new Map();
  for (const decision of decisions.filter((item) => item.status === 'READY' || item.status === 'REUSED')) {
    const signature = sha({ changes: decision.changes ?? {}, sourceChecksum: decision.sourceChecksum });
    if (seen.has(decision.supplierId) && seen.get(decision.supplierId) !== signature) decisions.filter((item) => item.supplierId === decision.supplierId).forEach((item) => { item.status = 'REVIEW_REQUIRED'; item.reason = 'CSV_CONFLICT_FOR_TARGET_SUPPLIER'; });
    else seen.set(decision.supplierId, signature);
  }
  const writes = decisions.filter((item) => item.status === 'READY');
  const summary = decisions.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] ?? 0) + 1 }), { READY: 0, REUSED: 0, REVIEW_REQUIRED: 0 });
  const planFingerprint = sha({ version: VERSION, csvSha256: createHash('sha256').update(readFileSync(resolve(csvPath))).digest('hex'), sourceCompanyId: SOURCE_COMPANY_ID, companyId: COMPANY_ID, writes: writes.map((item) => [item.sourceId, item.supplierId, item.changes, item.sourceChecksum]) });
  const preview = { status: DRY_RUN, version: VERSION, companyId: COMPANY_ID, companyNameAr: company.rows[0].nameAr, migrationReviewLocked: company.rows[0].migrationReviewLocked, csvRows: csv.length, sourceSuppliers: sourceSuppliers.length, targetActiveSuppliers: supplierRows.rowCount, sourceMaps: sourceMaps.rowCount, summary, writes: writes.length, review: decisions.filter((item) => item.status === 'REVIEW_REQUIRED').map((item) => ({ rowNumber: item.rowNumber, sourceId: item.sourceId ?? null, supplierId: item.supplierId ?? null, reason: item.reason })), planFingerprint };
  console.log(JSON.stringify(preview, null, 2));
  if (mode === DRY_RUN) process.exitCode = 0;
  else {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);
      const locked = await client.query(`SELECT "migrationReviewLocked" FROM "Company" WHERE id=$1 AND "tenantId"=$2 FOR UPDATE`, [COMPANY_ID, TENANT_ID]);
      if (!locked.rows[0]?.migrationReviewLocked) throw new Error('MIGRATION_REVIEW_LOCK_REQUIRED');
      const requestId = `doha-supplier-source-profile:${planFingerprint}`;
      const previous = await client.query(`SELECT id FROM "AuditEvent" WHERE "tenantId"=$1 AND "companyId"=$2 AND action='supplier.doha_source_profile_enrichment.completed' AND "requestId"=$3`, [TENANT_ID, COMPANY_ID, requestId]);
      if (previous.rowCount) { await client.query('COMMIT'); console.log(JSON.stringify({ status: 'REPLAYED', planFingerprint })); }
      else {
        for (const write of writes) {
          const current = await client.query(`SELECT "supplierType","taxNumber" FROM "FinanceSupplier" WHERE id=$1 AND "tenantId"=$2 AND "companyId"=$3 FOR UPDATE`, [write.supplierId, TENANT_ID, COMPANY_ID]);
          const item = current.rows[0];
          if (!item || (write.changes.supplierType && item.supplierType === write.changes.supplierType) || (write.changes.taxNumber && taxNumber(item.taxNumber) === write.changes.taxNumber)) throw new Error(`Supplier state changed during apply: ${write.supplierId}`);
          await client.query(`UPDATE "FinanceSupplier" SET "supplierType"=COALESCE($1::"FinanceSupplierType","supplierType"), "taxNumber"=COALESCE($2,"taxNumber") WHERE id=$3 AND "tenantId"=$4 AND "companyId"=$5`, [write.changes.supplierType, write.changes.taxNumber, write.supplierId, TENANT_ID, COMPANY_ID]);
        }
        await client.query(`INSERT INTO "AuditEvent" (id,"tenantId","companyId","actorUserId",action,"entityType","entityId","requestId","afterJson") VALUES ($1,$2,$3,$4,'supplier.doha_source_profile_enrichment.completed','DohaSupplierSourceProfileEnrichment',$5,$6,$7::jsonb)`, [randomUUID(), TENANT_ID, COMPANY_ID, actorUserId, planFingerprint, requestId, JSON.stringify({ version: VERSION, sourceCompanyId: SOURCE_COMPANY_ID, csvRows: csv.length, summary, updatedSupplierIds: writes.map((item) => item.supplierId), review: preview.review })]);
        await client.query('COMMIT');
        console.log(JSON.stringify({ status: 'COMPLETED', planFingerprint, updated: writes.length, reviewRequired: summary.REVIEW_REQUIRED }));
      }
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
} finally { await client.end(); }
