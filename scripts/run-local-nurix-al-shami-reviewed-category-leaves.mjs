/** Owner-approved posting leaves required by the nine reviewed Noorix invoices. */
import { randomUUID, createHash } from 'node:crypto';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-al-shami-reviewed-category-leaves/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_REVIEWED_CATEGORY_LEAVES_V1';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) throw new Error(`Usage: node scripts/run-local-nurix-al-shami-reviewed-category-leaves.mjs <package> <tenant> <company> <owner> DRY_RUN|${APPROVAL}`);
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const url = new URL(process.env.DATABASE_URL ?? '');
if (url.hostname !== '127.0.0.1' || url.port !== '5433' || url.pathname !== '/baseer_erp_test') throw new Error('This writer only permits the canonical local Baseer test database.');
const leaves = [
  { code: 'E5-4', nameAr: 'صيانة محل', nameEn: 'Shop maintenance', kind: 'EXPENSE', parentCode: 'EXP-005', accountCode: 'EXP-005', sortOrder: 4 },
  { code: 'P3-4', nameAr: 'مواد تعبئة وتغليف', nameEn: 'General packaging materials', kind: 'PURCHASE', parentCode: 'PUR-003', accountCode: 'PUR-003', sortOrder: 4 },
];
const planSha = sha({ version: VERSION, leaves });
process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
let app;
try {
  app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const database = app.get(DatabaseService);
  const inspect = async (tx) => {
    const [pkg, categories, accounts] = await Promise.all([
      tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, status: 'READY_FOR_RECONCILIATION' }, select: { id: true } }),
      tx.financeCategory.findMany({ where: { tenantId, companyId, code: { in: leaves.flatMap((leaf) => [leaf.code, leaf.parentCode]) } }, select: { id: true, code: true, nameAr: true, nameEn: true, kind: true, status: true, isPosting: true, accountId: true, parentId: true } }),
      tx.financeAccount.findMany({ where: { tenantId, companyId, code: { in: leaves.map((leaf) => leaf.accountCode) }, status: 'ACTIVE' }, select: { id: true, code: true, type: true } }),
    ]);
    if (!pkg) throw new Error('The approved Al-Shami package is unavailable.');
    const categoryByCode = new Map(categories.map((item) => [item.code, item])); const accountByCode = new Map(accounts.map((item) => [item.code, item]));
    const actions = leaves.map((leaf) => {
      const parent = categoryByCode.get(leaf.parentCode); const account = accountByCode.get(leaf.accountCode); const existing = categoryByCode.get(leaf.code);
      if (!parent || parent.status !== 'ACTIVE' || parent.isPosting || parent.kind !== leaf.kind || !account || account.type !== 'EXPENSE') throw new Error(`Parent/account evidence is invalid for ${leaf.code}.`);
      if (existing && (existing.nameAr !== leaf.nameAr || existing.nameEn !== leaf.nameEn || existing.kind !== leaf.kind || !existing.isPosting || existing.parentId !== parent.id || existing.accountId !== account.id || existing.status !== 'ACTIVE')) throw new Error(`Existing category ${leaf.code} differs from owner-approved definition.`);
      return { leaf, parent, account, existing, action: existing ? 'REUSED' : 'CREATE' };
    });
    return { actions };
  };
  const preview = await database.inTenantTransaction(tenantId, inspect);
  const dryRun = { status: 'PARSED_DRY_RUN', version: VERSION, planSha, categories: preview.actions.map(({ leaf, parent, account, action }) => ({ code: leaf.code, nameAr: leaf.nameAr, parent: parent.code, account: account.code, action })), financialWrites: 0 };
  console.log(JSON.stringify(dryRun, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
      const { actions } = await inspect(tx); const written = [];
      for (const { leaf, parent, account, existing } of actions) {
        const category = existing ?? await tx.financeCategory.create({ data: { id: randomUUID(), tenantId, companyId, parentId: parent.id, accountId: account.id, code: leaf.code, nameAr: leaf.nameAr, nameEn: leaf.nameEn, kind: leaf.kind, status: 'ACTIVE', isPosting: true, sortOrder: leaf.sortOrder } });
        await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.reviewed_category_leaf.applied', entityType: 'FinanceCategory', entityId: category.id, requestId: `nurix-al-shami-reviewed-category:${leaf.code}:${planSha}`, afterJson: { planSha, code: leaf.code, parentCode: leaf.parentCode, accountCode: leaf.accountCode, ownerDecision: leaf.nameAr } } });
        written.push({ id: category.id, code: leaf.code, reused: Boolean(existing) });
      }
      return written;
    });
    console.log(JSON.stringify({ status: 'COMPLETED', version: VERSION, planSha, receipt }, null, 2));
  }
} finally { await app?.close(); }
