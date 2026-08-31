/**
 * Creates only the two owner-approved posting leaves required by the reviewed
 * Al-Shami backfill.  DRY_RUN is read-only; APPLY requires an exact token.
 */
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_REVIEWED_OUTFLOW_CATEGORIES_V1';
const UUID = /^[0-9a-f-]{36}$/i;
const SPECS = Object.freeze([
  { parentCode: 'EXP-005', code: 'E5-4', nameAr: 'صيانة محل', nameEn: 'Shop maintenance', kind: 'EXPENSE' },
  { parentCode: 'PUR-003', code: 'P3-4', nameAr: 'مواد تعبئة وتغليف', nameEn: 'General packaging materials', kind: 'PURCHASE' },
]);

const [tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![tenantId, companyId, actorUserId].every((value) => UUID.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) throw new Error(`Usage: node scripts/run-local-nurix-al-shami-reviewed-outflow-categories-repair.mjs <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/baseer_erp_test') throw new Error('This repair only permits the canonical local Baseer test database.');

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const database = app.get(DatabaseService);
  const plan = await database.inTenantTransaction(tenantId, async (tx) => {
    const categories = await tx.financeCategory.findMany({ where: { tenantId, companyId, code: { in: [...SPECS.map((item) => item.parentCode), ...SPECS.map((item) => item.code)] } }, select: { id: true, code: true, parentId: true, accountId: true, nameAr: true, nameEn: true, kind: true, status: true, isPosting: true, sortOrder: true } });
    const byCode = new Map(categories.map((row) => [row.code, row]));
    return SPECS.map((spec) => {
      const parent = byCode.get(spec.parentCode); const existing = byCode.get(spec.code);
      if (!parent || parent.status !== 'ACTIVE' || parent.isPosting || parent.kind !== spec.kind || !parent.accountId) throw new Error(`Expected active non-posting parent ${spec.parentCode} is unavailable.`);
      if (existing && (existing.parentId !== parent.id || existing.accountId !== parent.accountId || existing.kind !== spec.kind || existing.status !== 'ACTIVE' || !existing.isPosting || existing.nameAr !== spec.nameAr || existing.nameEn !== spec.nameEn)) throw new Error(`Existing category ${spec.code} conflicts with the approved repair.`);
      return { spec, parent, existing, action: existing ? 'REUSE' : 'CREATE' };
    });
  });
  const dryRun = { status: 'PARSED_DRY_RUN', categories: plan.map((row) => ({ parentCode: row.spec.parentCode, code: row.spec.code, nameAr: row.spec.nameAr, action: row.action })), categoryWrites: 0, financialWrites: 0 };
  console.log(JSON.stringify(dryRun, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const result = await database.inTenantTransaction(tenantId, async (tx) => {
      const output = [];
      for (const row of plan) {
        if (row.existing) { output.push({ code: row.spec.code, action: 'REUSED', id: row.existing.id }); continue; }
        const sibling = await tx.financeCategory.aggregate({ where: { tenantId, companyId, parentId: row.parent.id }, _max: { sortOrder: true } });
        const nextSortOrder = Math.max(sibling._max.sortOrder ?? 0, row.parent.sortOrder ?? 0) + 1;
        const created = await tx.financeCategory.create({ data: { id: randomUUID(), tenantId, companyId, parentId: row.parent.id, accountId: row.parent.accountId, code: row.spec.code, nameAr: row.spec.nameAr, nameEn: row.spec.nameEn, kind: row.spec.kind, status: 'ACTIVE', isPosting: true, sortOrder: nextSortOrder } });
        await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.reviewed_outflow_category.created', entityType: 'FinanceCategory', entityId: created.id, requestId: `nurix-al-shami-reviewed-category:${row.spec.code}`, afterJson: { parentCode: row.spec.parentCode, code: row.spec.code, reason: 'Owner-approved exact leaf for historical Noorix reviewed outflows.' } } });
        output.push({ code: row.spec.code, action: 'CREATED', id: created.id });
      }
      return output;
    });
    console.log(JSON.stringify({ status: 'COMPLETED', categories: result, categoryWrites: result.filter((row) => row.action === 'CREATED').length, financialWrites: 0 }, null, 2));
  }
} finally { await app.close(); }
