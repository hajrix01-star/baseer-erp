/**
 * Imports only the previously reviewed, unmapped Doha supplier masters.
 * Source evidence: frozen Noorix snapshot + supplied suppliers CSV.
 * Financial documents, journals, balances, and category tree are never changed.
 *
 * Usage:
 *   node scripts/run-local-doha-missing-suppliers-import.mjs DRY_RUN <suppliers.csv>
 *   node scripts/run-local-doha-missing-suppliers-import.mjs APPLY_APPROVED_DOHA_MISSING_SUPPLIERS_IMPORT_V1 <suppliers.csv> [actor-user-id]
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import pg from 'pg';

const DRY_RUN = 'DRY_RUN';
const APPLY = 'APPLY_APPROVED_DOHA_MISSING_SUPPLIERS_IMPORT_V1';
const VERSION = 'doha-missing-suppliers-import/v1';
const TENANT_ID = '6ffae759-800e-4653-8543-51013f5ef751';
const COMPANY_ID = '3c032ff1-c00d-4784-99ae-a9bf53e09e0d';
const SOURCE_COMPANY_ID = 'cmnf5xrd0001uy8lm8vja50gp';
const PACKAGE_ID = '2147e3de-cf2a-429b-b114-d0ad0fc172b2';
const DEFAULT_ACTOR_ID = 'c89fb913-2f7c-404e-84d7-161146766f77';
const [mode, csvPath, actorUserId = DEFAULT_ACTOR_ID] = process.argv.slice(2);
if (![DRY_RUN, APPLY].includes(mode ?? '') || !csvPath || !/^[0-9a-f-]{36}$/i.test(actorUserId)) throw new Error(`Usage: node scripts/run-local-doha-missing-suppliers-import.mjs ${DRY_RUN}|${APPLY} <suppliers.csv> [actor-user-id]`);

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') throw new Error('This writer only permits the canonical local Baseer test database.');

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const arabicDigits = Object.freeze({ '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' });
const digits = (value) => String(value ?? '').replace(/[٠-٩۰-۹]/g, (digit) => arabicDigits[digit]);
const normalise = (value) => digits(value).normalize('NFKC').trim().toLowerCase().replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
const validVat = (value) => /^3\d{13}3$/.test(digits(value).replace(/[\s-]+/g, ''));
const typeFor = (value) => value === 'purchases' ? 'PURCHASE' : value === 'expenses' ? 'EXPENSE' : null;

function parseCsv(contents) {
  const rows = []; let row = []; let cell = ''; let quoted = false;
  for (let index = 0; index < contents.length; index += 1) {
    const char = contents[index];
    if (quoted) { if (char === '"' && contents[index + 1] === '"') { cell += '"'; index += 1; } else if (char === '"') quoted = false; else cell += char; }
    else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (char !== '\r') cell += char;
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const records = rows.filter((values) => values.some((value) => value.trim()));
  if (records.length < 2) throw new Error('CSV must include a header and data.');
  const headers = records[0].map((value) => normalise(value.replace(/^\uFEFF/, '')));
  const at = (record, names) => record[names.find((name) => record[name] !== undefined)] ?? '';
  return records.slice(1).map((values, index) => {
    const record = Object.fromEntries(headers.map((header, column) => [header, String(values[column] ?? '').trim()]));
    return {
      rowNumber: index + 2,
      nameAr: at(record, ['اسمالعربي', 'اسمالموردبالعربي', 'الاسمبالعربي', 'اسمالمورد']),
      nameEn: at(record, ['اسمالانجليزي', 'اسمالموردبالانجليزي', 'الاسمبالانجليزي']),
      category: at(record, ['نوعالموردpurchasesexpenses', 'suppliertypepurchasesexpenses', 'suppliertype', 'type']).trim().toLowerCase(),
    };
  });
}

const sourceSql = `SELECT COALESCE(json_agg(json_build_object('sourceId',s.id,'nameAr',s.name_ar,'nameEn',coalesce(s.name_en,''),'phone',coalesce(s.phone,''),'taxNumber',coalesce(s.tax_number,''),'isTaxRegistered',s.is_tax_registered,'type',lower(coalesce(s.category_id,'')),'sourceCategoryCode',coalesce(c.code,''),'sourceCategoryNameAr',coalesce(c.name_ar,'')) ORDER BY s.id), '[]'::json)::text FROM suppliers s LEFT JOIN categories c ON c.id=s.supplier_category_id WHERE s.company_id='${SOURCE_COMPANY_ID}' AND NOT s.is_deleted;`;
const sources = JSON.parse(execFileSync('docker', ['exec', 'baseer-noorix-snapshot-20260902', 'psql', '-U', 'nurix_restore', '-d', 'nurix_snapshot', '-t', '-A', '-c', sourceSql], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trim() || '[]');
const csv = parseCsv(readFileSync(resolve(csvPath), 'utf8'));
const sourceByName = new Map();
for (const source of sources) for (const name of [normalise(source.nameAr), normalise(source.nameEn)].filter(Boolean)) sourceByName.set(name, [...(sourceByName.get(name) ?? []), source]);
const csvSources = csv.map((row) => {
  const candidates = [...new Set([normalise(row.nameAr), normalise(row.nameEn)].filter(Boolean).flatMap((name) => sourceByName.get(name) ?? []))];
  return { row, source: candidates.length === 1 ? candidates[0] : null, matchCount: candidates.length };
});

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_ID]);
  const company = await client.query(`SELECT id, "nameAr", "migrationReviewLocked" FROM "Company" WHERE id=$1 AND "tenantId"=$2`, [COMPANY_ID, TENANT_ID]);
  if (company.rowCount !== 1 || company.rows[0].nameAr !== 'دوحة المستهلك') throw new Error('Doha Al-Mustahlek is unavailable.');
  const actor = await client.query(`SELECT id FROM "User" WHERE id=$1 AND "tenantId"=$2`, [actorUserId, TENANT_ID]);
  if (!actor.rowCount) throw new Error('The approved actor is unavailable.');
  const maps = await client.query(`SELECT "sourceId", "targetId" FROM "NurixExcelFinancialSourceMap" WHERE "tenantId"=$1 AND "targetCompanyId"=$2 AND "sourceEntity"='Supplier' AND "targetEntity"='FinanceSupplier' AND state IN ('APPLIED','REUSED')`, [TENANT_ID, COMPANY_ID]);
  const mappedSourceIds = new Set(maps.rows.map((item) => item.sourceId));
  const targetSuppliers = await client.query(`SELECT id,"nameAr","nameEn" FROM "FinanceSupplier" WHERE "tenantId"=$1 AND "companyId"=$2 AND status='ACTIVE'`, [TENANT_ID, COMPANY_ID]);
  const targetByName = new Map();
  for (const supplier of targetSuppliers.rows) for (const name of [normalise(supplier.nameAr), normalise(supplier.nameEn)].filter(Boolean)) targetByName.set(name, [...(targetByName.get(name) ?? []), supplier]);
  const targetCategories = await client.query(`SELECT id,code,"nameAr",kind,status,"isPosting" FROM "FinanceCategory" WHERE "tenantId"=$1 AND "companyId"=$2 AND status='ACTIVE' AND "isPosting"=true`, [TENANT_ID, COMPANY_ID]);
  const categoryByCode = new Map(targetCategories.rows.map((category) => [category.code, category]));
  const considered = csvSources.filter((item) => item.source && item.matchCount === 1 && typeFor(item.row.category) === typeFor(item.source.type) && !mappedSourceIds.has(item.source.sourceId));
  const sourceCounts = new Map();
  for (const item of considered) sourceCounts.set(item.source.sourceId, (sourceCounts.get(item.source.sourceId) ?? 0) + 1);
  const decisions = considered.map((item) => {
    const source = item.source;
    const targetNames = [...new Set([normalise(source.nameAr), normalise(source.nameEn)].filter(Boolean).flatMap((name) => targetByName.get(name) ?? []))];
    const supplierType = typeFor(source.type);
    const targetCategory = source.sourceCategoryCode ? categoryByCode.get(source.sourceCategoryCode) : null;
    const base = { sourceId: source.sourceId, nameAr: source.nameAr, nameEn: source.nameEn || null, supplierType, sourceCategoryCode: source.sourceCategoryCode || null, sourceCategoryNameAr: source.sourceCategoryNameAr || null };
    if (sourceCounts.get(source.sourceId) !== 1) return { ...base, status: 'REVIEW_REQUIRED', reason: 'DUPLICATE_CSV_SOURCE' };
    if (targetNames.length > 1) return { ...base, status: 'REVIEW_REQUIRED', reason: 'AMBIGUOUS_EXISTING_TARGET_NAME' };
    if (targetNames.length === 1) return { ...base, status: 'REUSED', targetId: targetNames[0].id, reason: 'EXISTING_TARGET_NAME' };
    if (!supplierType) return { ...base, status: 'REVIEW_REQUIRED', reason: 'INVALID_SOURCE_TYPE' };
    if (targetCategory && (targetCategory.kind !== supplierType || targetCategory.status !== 'ACTIVE' || !targetCategory.isPosting)) return { ...base, status: 'REVIEW_REQUIRED', reason: 'SOURCE_CATEGORY_TARGET_CONFLICT' };
    if (source.sourceCategoryCode && !targetCategory) return { ...base, status: 'REVIEW_REQUIRED', reason: 'SOURCE_CATEGORY_NOT_AVAILABLE_IN_BASEER' };
    return { ...base, status: 'CREATE', categoryId: targetCategory?.id ?? null, categoryCode: targetCategory?.code ?? null, phone: source.phone?.trim() || null, taxNumber: validVat(source.taxNumber) ? digits(source.taxNumber).replace(/[\s-]+/g, '') : null, isTaxRegistered: validVat(source.taxNumber) && Boolean(source.isTaxRegistered), sourceChecksum: sha(source) };
  });
  const summary = decisions.reduce((result, item) => ({ ...result, [item.status]: (result[item.status] ?? 0) + 1 }), { CREATE: 0, REUSED: 0, REVIEW_REQUIRED: 0 });
  const writes = decisions.filter((item) => item.status === 'CREATE');
  const plan = { version: VERSION, companyId: COMPANY_ID, sourceCompanyId: SOURCE_COMPANY_ID, packageId: PACKAGE_ID, writes: writes.map((item) => [item.sourceId, item.nameAr, item.supplierType, item.categoryCode, item.taxNumber, item.sourceChecksum]) };
  const planFingerprint = sha(plan);
  console.log(JSON.stringify({ status: DRY_RUN, ...plan, migrationReviewLocked: company.rows[0].migrationReviewLocked, csvRows: csv.length, considered: considered.length, summary, review: decisions.filter((item) => item.status === 'REVIEW_REQUIRED'), planFingerprint }, null, 2));
  if (mode === DRY_RUN) process.exitCode = 0;
  else {
    if (summary.REVIEW_REQUIRED) throw new Error(`REVIEW_REQUIRED_SUPPLIERS:${summary.REVIEW_REQUIRED}`);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
    try {
      await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);
      const locked = await client.query(`SELECT "migrationReviewLocked" FROM "Company" WHERE id=$1 AND "tenantId"=$2 FOR UPDATE`, [COMPANY_ID, TENANT_ID]);
      if (!locked.rows[0]?.migrationReviewLocked) throw new Error('MIGRATION_REVIEW_LOCK_REQUIRED');
      const requestId = `nurix-doha-missing-suppliers-import:${planFingerprint}`;
      const prior = await client.query(`SELECT id FROM "AuditEvent" WHERE "tenantId"=$1 AND "companyId"=$2 AND action='supplier.noorix_missing_master_import.completed' AND "requestId"=$3`, [TENANT_ID, COMPANY_ID, requestId]);
      if (prior.rowCount) { await client.query('COMMIT'); console.log(JSON.stringify({ status: 'REPLAYED', planFingerprint })); }
      else {
        const packageRow = await client.query(`SELECT id,status,"sourceCompanyId" FROM "NurixExcelStagingPackage" WHERE id=$1 AND "tenantId"=$2 AND "targetCompanyId"=$3 FOR SHARE`, [PACKAGE_ID, TENANT_ID, COMPANY_ID]);
        if (packageRow.rows[0]?.status !== 'READY_FOR_RECONCILIATION' || packageRow.rows[0]?.sourceCompanyId !== SOURCE_COMPANY_ID) throw new Error('The approved Doha package is unavailable.');
        const executionId = randomUUID();
        await client.query(`INSERT INTO "NurixExcelFinancialExecution" (id,"packageId","tenantId","targetCompanyId","transformVersion","financialPlanSha256",status,reason,"requestedByUserId","approvedByUserId","approvedAt") VALUES ($1,$2,$3,$4,$5,$6,'COMPLETED',$7,$8,$8,now())`, [executionId, PACKAGE_ID, TENANT_ID, COMPANY_ID, VERSION, planFingerprint, 'Owner-approved completion of previously unmapped Doha supplier masters.', actorUserId]);
        const created = [];
        for (const write of writes) {
          const supplierId = randomUUID();
          await client.query(`INSERT INTO "FinanceSupplier" (id,"tenantId","companyId","categoryId","supplierType","nameAr","nameEn",phone,"taxNumber","isTaxRegistered",status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'ACTIVE')`, [supplierId, TENANT_ID, COMPANY_ID, write.categoryId, write.supplierType, write.nameAr, write.nameEn, write.phone, write.taxNumber, write.isTaxRegistered]);
          await client.query(`INSERT INTO "NurixExcelFinancialSourceMap" (id,"executionId","tenantId","targetCompanyId","sourceEntity","sourceId","sourceChecksum","targetEntity","targetId",state) VALUES ($1,$2,$3,$4,'Supplier',$5,$6,'FinanceSupplier',$7,'APPLIED')`, [randomUUID(), executionId, TENANT_ID, COMPANY_ID, write.sourceId, write.sourceChecksum, supplierId]);
          created.push({ sourceId: write.sourceId, supplierId, categoryCode: write.categoryCode });
        }
        await client.query(`INSERT INTO "AuditEvent" (id,"tenantId","companyId","actorUserId",action,"entityType","entityId","requestId","afterJson") VALUES ($1,$2,$3,$4,'supplier.noorix_missing_master_import.completed','NurixExcelFinancialExecution',$5,$6,$7::jsonb)`, [randomUUID(), TENANT_ID, COMPANY_ID, actorUserId, executionId, requestId, JSON.stringify({ version: VERSION, planFingerprint, created, summary, noFinancialDocumentsChanged: true })]);
        await client.query('COMMIT');
        console.log(JSON.stringify({ status: 'COMPLETED', executionId, created: created.length, reused: summary.REUSED, planFingerprint }));
      }
    } catch (error) { await client.query('ROLLBACK'); throw error; }
  }
} finally { await client.end(); }
