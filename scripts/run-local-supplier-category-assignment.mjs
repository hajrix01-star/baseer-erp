/**
 * Safe, resumable category assignment for existing imported suppliers.
 *
 * Usage:
 *   node scripts/run-local-supplier-category-assignment.mjs DRY_RUN
 *   node scripts/run-local-supplier-category-assignment.mjs APPLY_APPROVED_SUPPLIER_CATEGORY_ASSIGNMENT_V1 [actor-user-id]
 *
 * The only evidence accepted is a Noorix-mapped financial document. A supplier
 * receives a default category only when every mapped document points to one
 * active posting category and its document kind, category kind, and supplier
 * type agree exactly. The writer never creates or deletes records, never
 * changes a supplier type, never changes documents, and never overwrites an
 * existing supplier category. DRY_RUN performs SELECTs only.
 */
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import pg from 'pg';

const MODE_DRY_RUN = 'DRY_RUN';
const MODE_APPLY = 'APPLY_APPROVED_SUPPLIER_CATEGORY_ASSIGNMENT_V1';
const VERSION = 'supplier-category-assignment/v1';
const TENANT_ID = '6ffae759-800e-4653-8543-51013f5ef751';
const DEFAULT_ACTOR_ID = 'c89fb913-2f7c-404e-84d7-161146766f77';
const TARGETS = Object.freeze([
  Object.freeze({ key: 'ARZ', companyId: '7e64301f-c87e-4d98-9881-35328ace117b' }),
  Object.freeze({ key: 'AL_SHAMI', companyId: '4af6969a-161f-4e13-8acc-103d8aa26a70' }),
]);

const [mode, actorUserId = DEFAULT_ACTOR_ID] = process.argv.slice(2);
if (!mode || ![MODE_DRY_RUN, MODE_APPLY].includes(mode)) {
  throw new Error(`Usage: node scripts/run-local-supplier-category-assignment.mjs ${MODE_DRY_RUN}|${MODE_APPLY} [actor-user-id]`);
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing to run outside the canonical local Baseer test database.');
}

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sameType = (value, expected) => value === expected && (value === 'PURCHASE' || value === 'EXPENSE');
const reasonCounts = (items) => items.reduce((counts, item) => ({ ...counts, [item.reason]: (counts[item.reason] ?? 0) + 1 }), {});

async function supplierEvidence(client, target) {
  const result = await client.query(`
    SELECT
      s.id AS supplier_id, s."categoryId" AS existing_category_id, s."supplierType" AS supplier_type, s.status AS supplier_status,
      d.id AS document_id, d.kind AS document_kind, d."categoryId" AS document_category_id,
      c.kind AS category_kind, c.status AS category_status, c."isPosting" AS category_is_posting
    FROM "FinanceSupplier" s
    LEFT JOIN "FinanceOutflowDocument" d
      ON d."supplierId" = s.id
      AND d."tenantId" = s."tenantId"
      AND d."companyId" = s."companyId"
      AND EXISTS (
        SELECT 1
        FROM "NurixExcelFinancialSourceMap" m
        WHERE m."targetCompanyId" = d."companyId"
          AND m."targetEntity" = 'FinanceOutflowDocument'
          AND m."targetId" = d.id::text
          AND m.state IN ('APPLIED', 'REUSED')
      )
    LEFT JOIN "FinanceCategory" c
      ON c.id = d."categoryId"
      AND c."tenantId" = d."tenantId"
      AND c."companyId" = d."companyId"
    WHERE s."tenantId" = $1 AND s."companyId" = $2
    ORDER BY s.id, d.id
  `, [TENANT_ID, target.companyId]);
  const grouped = new Map();
  for (const row of result.rows) {
    const supplier = grouped.get(row.supplier_id) ?? {
      supplierId: row.supplier_id,
      existingCategoryId: row.existing_category_id,
      supplierType: row.supplier_type,
      supplierStatus: row.supplier_status,
      documents: [],
    };
    if (row.document_id) supplier.documents.push({
      documentId: row.document_id,
      documentKind: row.document_kind,
      categoryId: row.document_category_id,
      categoryKind: row.category_kind,
      categoryStatus: row.category_status,
      categoryIsPosting: row.category_is_posting,
    });
    grouped.set(row.supplier_id, supplier);
  }
  return [...grouped.values()];
}

function evaluateSupplier(supplier) {
  const evidence = supplier.documents;
  const categoryIds = [...new Set(evidence.map((item) => item.categoryId))];
  const evidenceFingerprint = sha(evidence.map((item) => ({
    documentId: item.documentId,
    documentKind: item.documentKind,
    categoryId: item.categoryId,
    categoryKind: item.categoryKind,
    categoryStatus: item.categoryStatus,
    categoryIsPosting: item.categoryIsPosting,
  })));
  const base = { supplierId: supplier.supplierId, supplierType: supplier.supplierType, evidenceFingerprint, mappedDocumentCount: evidence.length };
  if (supplier.supplierStatus !== 'ACTIVE') return { ...base, status: 'REVIEW_REQUIRED', reason: 'SUPPLIER_NOT_ACTIVE' };
  if (!evidence.length) {
    return supplier.existingCategoryId
      ? { ...base, status: 'PRESERVED', reason: 'EXISTING_CATEGORY_WITHOUT_MAPPED_EVIDENCE' }
      : { ...base, status: 'REVIEW_REQUIRED', reason: 'NO_MAPPED_FINANCIAL_EVIDENCE' };
  }
  if (categoryIds.length !== 1) return { ...base, status: 'REVIEW_REQUIRED', reason: 'MULTIPLE_MAPPED_CATEGORIES' };
  const [categoryId] = categoryIds;
  const valid = evidence.every((item) =>
    sameType(item.documentKind, supplier.supplierType)
    && sameType(item.categoryKind, supplier.supplierType)
    && item.categoryStatus === 'ACTIVE'
    && item.categoryIsPosting === true,
  );
  if (!valid) return { ...base, status: 'REVIEW_REQUIRED', reason: 'TYPE_OR_CATEGORY_STATE_CONFLICT' };
  if (supplier.existingCategoryId) {
    return supplier.existingCategoryId === categoryId
      ? { ...base, status: 'REUSED', categoryId }
      : { ...base, status: 'REVIEW_REQUIRED', reason: 'EXISTING_CATEGORY_CONFLICT' };
  }
  return { ...base, status: 'READY', categoryId };
}

function companyPlan(target, suppliers) {
  const decisions = suppliers.map(evaluateSupplier);
  const writes = decisions.filter((item) => item.status === 'READY').map((item) => ({
    supplierId: item.supplierId,
    categoryId: item.categoryId,
    supplierType: item.supplierType,
    evidenceFingerprint: item.evidenceFingerprint,
  }));
  const summary = decisions.reduce((counts, item) => ({ ...counts, [item.status]: (counts[item.status] ?? 0) + 1 }), {
    READY: 0, REUSED: 0, PRESERVED: 0, REVIEW_REQUIRED: 0,
  });
  return { target, decisions, writes, summary };
}

async function refreshedDecisionInTransaction(client, target, supplierId) {
  const supplierResult = await client.query(`
    SELECT id AS supplier_id, "categoryId" AS existing_category_id, "supplierType" AS supplier_type, status AS supplier_status
    FROM "FinanceSupplier"
    WHERE id = $1 AND "tenantId" = $2 AND "companyId" = $3
    FOR UPDATE
  `, [supplierId, TENANT_ID, target.companyId]);
  if (!supplierResult.rows.length) throw new Error(`Supplier vanished during APPLY: ${supplierId}`);
  const first = supplierResult.rows[0];
  const documentResult = await client.query(`
    SELECT
      d.id AS document_id, d.kind AS document_kind, d."categoryId" AS document_category_id,
      c.kind AS category_kind, c.status AS category_status, c."isPosting" AS category_is_posting
    FROM "FinanceOutflowDocument" d
    JOIN "FinanceCategory" c
      ON c.id = d."categoryId" AND c."tenantId" = d."tenantId" AND c."companyId" = d."companyId"
    WHERE d."supplierId" = $1 AND d."tenantId" = $2 AND d."companyId" = $3
      AND EXISTS (
        SELECT 1 FROM "NurixExcelFinancialSourceMap" m
        WHERE m."targetCompanyId" = d."companyId" AND m."targetEntity" = 'FinanceOutflowDocument'
          AND m."targetId" = d.id::text AND m.state IN ('APPLIED', 'REUSED')
      )
    ORDER BY d.id
    FOR SHARE OF d, c
  `, [supplierId, TENANT_ID, target.companyId]);
  const supplier = {
    supplierId: first.supplier_id,
    existingCategoryId: first.existing_category_id,
    supplierType: first.supplier_type,
    supplierStatus: first.supplier_status,
    documents: documentResult.rows.map((row) => ({
      documentId: row.document_id,
      documentKind: row.document_kind,
      categoryId: row.document_category_id,
      categoryKind: row.category_kind,
      categoryStatus: row.category_status,
      categoryIsPosting: row.category_is_posting,
    })),
  };
  return evaluateSupplier(supplier);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query(`SELECT set_config('app.tenant_id', $1, false)`, [TENANT_ID]);
  const actor = await client.query(`SELECT id FROM "User" WHERE id = $1 AND "tenantId" = $2`, [actorUserId, TENANT_ID]);
  if (!actor.rowCount) throw new Error('Actor is unavailable for the approved tenant.');
  const plans = [];
  for (const target of TARGETS) {
    const company = await client.query(`SELECT id, "nameAr", "migrationReviewLocked" FROM "Company" WHERE id = $1 AND "tenantId" = $2`, [target.companyId, TENANT_ID]);
    if (!company.rows[0]) throw new Error(`Target company is unavailable: ${target.key}`);
    plans.push({ ...companyPlan(target, await supplierEvidence(client, target)), company: company.rows[0] });
  }
  const planFingerprint = sha({ version: VERSION, companies: plans.map((plan) => ({ key: plan.target.key, writes: plan.writes })) });
  const preview = {
    status: 'DRY_RUN', version: VERSION, planFingerprint,
    companies: plans.map((plan) => ({
      key: plan.target.key, companyId: plan.target.companyId, companyNameAr: plan.company.nameAr,
      migrationReviewLocked: plan.company.migrationReviewLocked,
      summary: plan.summary, writeCount: plan.writes.length,
      reviewReasons: reasonCounts(plan.decisions.filter((item) => item.status === 'REVIEW_REQUIRED')),
    })),
  };
  console.log(JSON.stringify(preview, null, 2));
  if (mode === MODE_DRY_RUN) process.exitCode = 0;
  else {
    for (const plan of plans) {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      try {
        await client.query(`SELECT set_config('app.tenant_id', $1, true)`, [TENANT_ID]);
        const company = await client.query(`SELECT id, "migrationReviewLocked" FROM "Company" WHERE id = $1 AND "tenantId" = $2 FOR UPDATE`, [plan.target.companyId, TENANT_ID]);
        if (!company.rows[0]?.migrationReviewLocked) throw new Error(`MIGRATION_REVIEW_LOCK_REQUIRED:${plan.target.key}`);
        const requestId = `supplier-category-assignment:v1:${plan.target.key}`;
        const prior = await client.query(`SELECT id FROM "AuditEvent" WHERE "tenantId" = $1 AND "companyId" = $2 AND action = 'supplier.category_assignment.completed' AND "requestId" = $3`, [TENANT_ID, plan.target.companyId, requestId]);
        if (prior.rowCount) { await client.query('COMMIT'); console.log(JSON.stringify({ status: 'REPLAYED', key: plan.target.key }, null, 2)); continue; }
        const updatedSupplierIds = [];
        for (const write of plan.writes) {
          const current = await refreshedDecisionInTransaction(client, plan.target, write.supplierId);
          if (current.status !== 'READY' || current.categoryId !== write.categoryId || current.evidenceFingerprint !== write.evidenceFingerprint) {
            throw new Error(`Evidence changed or is no longer deterministic for supplier: ${write.supplierId}`);
          }
          const updated = await client.query(`
            UPDATE "FinanceSupplier"
            SET "categoryId" = $1
            WHERE id = $2 AND "tenantId" = $3 AND "companyId" = $4
              AND "categoryId" IS NULL AND status = 'ACTIVE' AND "supplierType" = $5
          `, [write.categoryId, write.supplierId, TENANT_ID, plan.target.companyId, write.supplierType]);
          if (updated.rowCount !== 1) throw new Error(`Supplier category update lost its precondition: ${write.supplierId}`);
          updatedSupplierIds.push(write.supplierId);
        }
        if (updatedSupplierIds.length) {
          await client.query(`INSERT INTO "AuditEvent" (id, "tenantId", "companyId", "actorUserId", action, "entityType", "entityId", "requestId", "afterJson") VALUES ($1,$2,$3,$4,'supplier.category_assignment.completed','SupplierCategoryAssignment',$5,$6,$7::jsonb)`, [
            randomUUID(), TENANT_ID, plan.target.companyId, actorUserId, planFingerprint, requestId,
            JSON.stringify({ version: VERSION, planFingerprint, summary: plan.summary, updatedSupplierIds, updatedSupplierCount: updatedSupplierIds.length, reviewRequired: plan.summary.REVIEW_REQUIRED, preserved: plan.summary.PRESERVED }),
          ]);
        }
        await client.query('COMMIT');
        console.log(JSON.stringify({ status: updatedSupplierIds.length ? 'COMPLETED' : 'NO_OP', key: plan.target.key, planFingerprint, updated: updatedSupplierIds.length, reused: plan.summary.REUSED }, null, 2));
      } catch (error) { await client.query('ROLLBACK'); throw error; }
    }
  }
} finally {
  await client.end();
}
