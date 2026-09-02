/**
 * Safe, resumable enrichment of existing Baseer suppliers from two reviewed CSV files.
 *
 * Usage:
 *   node scripts/run-local-supplier-tax-enrichment.mjs DRY_RUN <arz.csv> <al-shami.csv>
 *   node scripts/run-local-supplier-tax-enrichment.mjs APPLY_APPROVED_SUPPLIER_TAX_ENRICHMENT_V1 <arz.csv> <al-shami.csv> [actor-user-id]
 *
 * The script is deliberately limited to 127.0.0.1:5433/baseer_erp_test.  It
 * never creates suppliers and never changes their category, type, or VAT
 * registration declaration.  A syntactically valid number is not proof that
 * a supplier is currently VAT-registered. DRY_RUN
 * performs SELECTs only. APPLY requires each company to remain locked for
 * migration review and records one append-only AuditEvent per company.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import pg from 'pg';

const MODE_DRY_RUN = 'DRY_RUN';
const MODE_APPLY = 'APPLY_APPROVED_SUPPLIER_TAX_ENRICHMENT_V1';
const VERSION = 'supplier-tax-enrichment/v1';
const TENANT_ID = '6ffae759-800e-4653-8543-51013f5ef751';
const DEFAULT_ACTOR_ID = 'c89fb913-2f7c-404e-84d7-161146766f77';
const TARGETS = Object.freeze([
  Object.freeze({ key: 'ARZ', companyId: '7e64301f-c87e-4d98-9881-35328ace117b' }),
  Object.freeze({ key: 'AL_SHAMI', companyId: '4af6969a-161f-4e13-8acc-103d8aa26a70' }),
]);

const [mode, arzCsvPath, alShamiCsvPath, actorUserId = DEFAULT_ACTOR_ID] = process.argv.slice(2);
if (!mode || !arzCsvPath || !alShamiCsvPath || ![MODE_DRY_RUN, MODE_APPLY].includes(mode)) {
  throw new Error(`Usage: node scripts/run-local-supplier-tax-enrichment.mjs ${MODE_DRY_RUN}|${MODE_APPLY} <arz.csv> <al-shami.csv> [actor-user-id]`);
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing to run outside the canonical local Baseer test database.');
}

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const noControl = (value) => !/[\u0000-\u001F\u007F]/.test(value);
const arabicDigits = Object.freeze({ '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' });

function asciiDigits(value) {
  return String(value ?? '').replace(/[٠-٩۰-۹]/g, (digit) => arabicDigits[digit]);
}

function normalizedArabicName(value) {
  return asciiDigits(value).normalize('NFKC').trim().toLowerCase()
    .replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
    .replace(/[\u064B-\u065F\u0670\u0640]/g, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizedEnglishName(value) {
  return asciiDigits(value).normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizedTaxNumber(value) {
  return asciiDigits(value).normalize('NFKC').replace(/[\s-]+/g, '').trim();
}

function validSaudiVatNumber(value) {
  return /^3\d{13}3$/.test(value);
}

function canonicalHeader(value) {
  return normalizedEnglishName(value).replace(/[^a-z0-9\p{Script=Arabic}]/gu, '');
}

function parseCsv(text, filePath) {
  const rows = [];
  let row = []; let cell = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') { quoted = true; continue; }
    if (char === ',') { row.push(cell); cell = ''; continue; }
    if (char === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (char === '\r') continue;
    cell += char;
  }
  if (quoted) throw new Error(`CSV has an unclosed quoted field: ${filePath}`);
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  const nonBlank = rows.filter((values) => values.some((value) => value.trim()));
  if (nonBlank.length < 2) throw new Error(`CSV must contain a header and at least one data row: ${filePath}`);
  const headers = nonBlank[0].map((value) => value.replace(/^\uFEFF/, '').trim());
  if (new Set(headers.map(canonicalHeader)).size !== headers.length) throw new Error(`CSV headers are ambiguous after normalization: ${filePath}`);
  return nonBlank.slice(1).map((values, index) => Object.fromEntries(headers.map((header, column) => [canonicalHeader(header), String(values[column] ?? '').trim()])))
    .map((rowValue, index) => ({ rowNumber: index + 2, row: rowValue }));
}

const aliases = Object.freeze({
  supplierId: ['baseersupplierid', 'targetsupplierid', 'baseerid'],
  nameAr: ['namear', 'suppliernamear', 'arabicname', 'اسمالمورد', 'اسمالموردبالعربي', 'الاسمالعربي', 'الاسمبالعربي'],
  nameEn: ['nameen', 'suppliernameen', 'englishname', 'اسمالموردبالانجليزي', 'الاسمالانجليزي', 'الاسمبالانجليزي'],
  taxNumber: ['taxnumber', 'vatnumber', 'vatregistrationnumber', 'taxregistrationnumber', 'الرقمالضريبي', 'رقمالضريبة', 'رقمالتسجيلالضريبي'],
});

function firstColumn(row, candidates) {
  for (const name of candidates) if (row[name] !== undefined) return row[name];
  return '';
}

function sourceRows(filePath) {
  const resolved = resolve(filePath);
  const rows = parseCsv(readFileSync(resolved, 'utf8'), resolved);
  return rows.map(({ rowNumber, row }) => ({
    rowNumber,
    sourceSupplierId: firstColumn(row, aliases.supplierId),
    nameAr: firstColumn(row, aliases.nameAr),
    nameEn: firstColumn(row, aliases.nameEn),
    taxNumber: normalizedTaxNumber(firstColumn(row, aliases.taxNumber)),
  }));
}

function exactCandidates(row, suppliers) {
  const sourceId = row.sourceSupplierId.trim();
  if (sourceId && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(sourceId)) {
    const byId = suppliers.filter((supplier) => supplier.id === sourceId);
    return byId.length === 1 ? { status: 'MATCHED', supplierId: byId[0].id } : { status: 'REVIEW_REQUIRED', reason: 'TARGET_ID_NOT_UNIQUE_OR_MISSING' };
  }
  const sourceNames = new Set([normalizedArabicName(row.nameAr), normalizedArabicName(row.nameEn)].filter(Boolean));
  if (!sourceNames.size) return { status: 'REVIEW_REQUIRED', reason: 'IDENTIFIER_AND_NAME_MISSING' };
  const matches = suppliers.filter((supplier) => {
    const targetNames = [normalizedArabicName(supplier.nameAr), normalizedArabicName(supplier.nameEn ?? '')];
    return targetNames.some((value) => sourceNames.has(value));
  });
  return matches.length === 1 ? { status: 'MATCHED', supplierId: matches[0].id } : { status: 'REVIEW_REQUIRED', reason: matches.length ? 'TARGET_NAME_AMBIGUOUS' : 'TARGET_NAME_NOT_FOUND' };
}

function companyPlan(target, rows, suppliers) {
  const decisions = rows.map((row) => {
    if (!row.taxNumber) return { rowNumber: row.rowNumber, status: 'EXCLUDED', reason: 'VAT_NOT_PRESENT' };
    if (!validSaudiVatNumber(row.taxNumber)) return { rowNumber: row.rowNumber, status: 'REVIEW_REQUIRED', reason: 'VAT_FORMAT_INVALID', taxNumber: row.taxNumber };
    const candidate = exactCandidates(row, suppliers);
    if (candidate.status !== 'MATCHED') return { rowNumber: row.rowNumber, ...candidate, taxNumber: row.taxNumber };
    const supplier = suppliers.find((item) => item.id === candidate.supplierId);
    const priorTax = normalizedTaxNumber(supplier.taxNumber ?? '');
    if (priorTax && priorTax !== row.taxNumber) return { rowNumber: row.rowNumber, status: 'REVIEW_REQUIRED', reason: 'EXISTING_TAX_NUMBER_CONFLICT', supplierId: supplier.id, taxNumber: row.taxNumber, priorTax };
    return { rowNumber: row.rowNumber, status: priorTax === row.taxNumber ? 'REUSED' : 'READY', supplierId: supplier.id, taxNumber: row.taxNumber };
  });
  const readyBySupplier = new Map();
  for (const decision of decisions.filter((item) => item.status === 'READY' || item.status === 'REUSED')) {
    const existing = readyBySupplier.get(decision.supplierId);
    if (existing && existing.taxNumber !== decision.taxNumber) {
      decisions.filter((item) => item.supplierId === decision.supplierId && (item.status === 'READY' || item.status === 'REUSED')).forEach((item) => { item.status = 'REVIEW_REQUIRED'; item.reason = 'CSV_TAX_NUMBER_CONFLICT'; });
    } else readyBySupplier.set(decision.supplierId, decision);
  }
  const writes = [...readyBySupplier.values()].filter((item) => item.status === 'READY').map((item) => ({ supplierId: item.supplierId, taxNumber: item.taxNumber }));
  const summary = decisions.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] ?? 0) + 1 }), { READY: 0, REUSED: 0, REVIEW_REQUIRED: 0, EXCLUDED: 0 });
  return { target, decisions, writes, summary };
}

const sourceByTarget = new Map([[TARGETS[0].key, sourceRows(arzCsvPath)], [TARGETS[1].key, sourceRows(alShamiCsvPath)]]);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_ID]);
  const plans = [];
  for (const target of TARGETS) {
    const company = await client.query(`SELECT id, "nameAr", "migrationReviewLocked" FROM "Company" WHERE id = $1 AND "tenantId" = $2`, [target.companyId, TENANT_ID]);
    if (!company.rows[0]) throw new Error(`Target company is unavailable: ${target.key}`);
    const suppliers = await client.query(`SELECT id, "nameAr", "nameEn", "taxNumber", "isTaxRegistered", status FROM "FinanceSupplier" WHERE "tenantId" = $1 AND "companyId" = $2 ORDER BY id`, [TENANT_ID, target.companyId]);
    plans.push({ ...companyPlan(target, sourceByTarget.get(target.key), suppliers.rows), company: company.rows[0] });
  }
  const planFingerprint = sha({ version: VERSION, files: [resolve(arzCsvPath), resolve(alShamiCsvPath)], plans: plans.map((plan) => ({ key: plan.target.key, writes: plan.writes, decisions: plan.decisions })) });
  const preview = { status: 'DRY_RUN', version: VERSION, planFingerprint, companies: plans.map((plan) => ({ key: plan.target.key, companyId: plan.target.companyId, companyNameAr: plan.company.nameAr, migrationReviewLocked: plan.company.migrationReviewLocked, summary: plan.summary, writeCount: plan.writes.length, review: plan.decisions.filter((item) => item.status === 'REVIEW_REQUIRED').map((item) => ({ rowNumber: item.rowNumber, reason: item.reason })) })) };
  console.log(JSON.stringify(preview, null, 2));
  if (mode === MODE_DRY_RUN) process.exitCode = 0;
  else {
    for (const plan of plans) {
      await client.query('BEGIN');
      try {
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);
        const company = await client.query(`SELECT id, "migrationReviewLocked" FROM "Company" WHERE id = $1 AND "tenantId" = $2 FOR UPDATE`, [plan.target.companyId, TENANT_ID]);
        if (!company.rows[0]?.migrationReviewLocked) {
          await client.query('ROLLBACK');
          console.log(JSON.stringify({ status: 'BLOCKED', key: plan.target.key, reason: 'MIGRATION_REVIEW_LOCK_REQUIRED', planFingerprint }, null, 2));
          continue;
        }
        const requestId = `supplier-tax-enrichment:${planFingerprint}:${plan.target.key}`;
        const prior = await client.query(`SELECT id FROM "AuditEvent" WHERE "tenantId" = $1 AND "companyId" = $2 AND action = 'supplier.tax_enrichment.completed' AND "requestId" = $3`, [TENANT_ID, plan.target.companyId, requestId]);
        if (prior.rowCount) { await client.query('COMMIT'); console.log(JSON.stringify({ status: 'REPLAYED', key: plan.target.key, planFingerprint }, null, 2)); continue; }
        for (const write of plan.writes) {
          const current = await client.query(`SELECT "taxNumber" FROM "FinanceSupplier" WHERE id = $1 AND "tenantId" = $2 AND "companyId" = $3 FOR UPDATE`, [write.supplierId, TENANT_ID, plan.target.companyId]);
          const priorTax = normalizedTaxNumber(current.rows[0]?.taxNumber ?? '');
          if (!current.rows[0] || (priorTax && priorTax !== write.taxNumber)) throw new Error(`Supplier tax state changed during APPLY: ${write.supplierId}`);
          if (!priorTax) {
            const updated = await client.query(`UPDATE "FinanceSupplier" SET "taxNumber" = $1 WHERE id = $2 AND "tenantId" = $3 AND "companyId" = $4 AND "taxNumber" IS NULL`, [write.taxNumber, write.supplierId, TENANT_ID, plan.target.companyId]);
            if (updated.rowCount !== 1) throw new Error(`Supplier update lost its precondition: ${write.supplierId}`);
          }
        }
        await client.query(`INSERT INTO "AuditEvent" (id, "tenantId", "companyId", "actorUserId", action, "entityType", "entityId", "requestId", "afterJson") VALUES ($1,$2,$3,$4,'supplier.tax_enrichment.completed','SupplierTaxEnrichment',$5,$6,$7::jsonb)`, [randomUUID(), TENANT_ID, plan.target.companyId, actorUserId, planFingerprint, requestId, JSON.stringify({ version: VERSION, planFingerprint, sourceRows: sourceByTarget.get(plan.target.key).length, summary: plan.summary, updatedSupplierIds: plan.writes.map((item) => item.supplierId), updatedSupplierCount: plan.writes.length, reviewRequired: plan.summary.REVIEW_REQUIRED, excluded: plan.summary.EXCLUDED })]);
        await client.query('COMMIT');
        console.log(JSON.stringify({ status: 'COMPLETED', key: plan.target.key, planFingerprint, updated: plan.writes.length, reused: plan.summary.REUSED }, null, 2));
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  }
} finally {
  await client.end();
}
