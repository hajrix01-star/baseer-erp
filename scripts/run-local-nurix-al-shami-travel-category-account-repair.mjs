/**
 * Narrow, idempotent master-data repair for Al-Shami's imported travel category.
 *
 * E4-TRAVEL was mapped from Noorix as an expense posting category but arrived
 * without its account.  This writer refuses to infer an account from a name:
 * it proceeds only when all three verified E4 sibling categories are active,
 * posting EXPENSE categories using the same active EXP-004 expense account.
 */
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-al-shami-travel-category-account-repair/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_TRAVEL_CATEGORY_ACCOUNT_REPAIR_V1';
const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const SOURCE_CATEGORY_ID = 'seed_e4_1_863ad91d66dc43c649700170f64492b5';
const TRAVEL_CODE = 'E4-TRAVEL';
const SIBLING_CODES = ['E4-1', 'E4-2', 'E4-3'];
const ACCOUNT_CODE = 'EXP-004';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-al-shami-travel-category-account-repair.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
}
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') throw new Error('This repair only permits the canonical local Baseer test database.');

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');

let app;
try {
  app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const database = app.get(DatabaseService);
  const preflight = await database.inTenantTransaction(tenantId, async (tx) => {
    const [packageRow, categoryMap, travel, siblings, account] = await Promise.all([
      tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, status: 'READY_FOR_RECONCILIATION' }, select: { id: true } }),
      tx.nurixExcelFinancialSourceMap.findFirst({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'CategoryAudit', sourceId: SOURCE_CATEGORY_ID, targetEntity: 'FinanceCategory', state: 'APPLIED' }, select: { targetId: true } }),
      tx.financeCategory.findFirst({ where: { tenantId, companyId, code: TRAVEL_CODE }, select: { id: true, code: true, nameAr: true, status: true, isPosting: true, kind: true, accountId: true } }),
      tx.financeCategory.findMany({ where: { tenantId, companyId, code: { in: SIBLING_CODES } }, select: { id: true, code: true, status: true, isPosting: true, kind: true, accountId: true } }),
      tx.financeAccount.findFirst({ where: { tenantId, companyId, code: ACCOUNT_CODE }, select: { id: true, code: true, status: true, type: true } }),
    ]);
    if (!packageRow) throw new Error('The selected package is not the approved Al-Shami package.');
    if (!travel || !categoryMap || categoryMap.targetId !== travel.id) throw new Error('The Noorix CategoryAudit map does not point exactly to E4-TRAVEL.');
    if (travel.status !== 'ACTIVE' || !travel.isPosting || travel.kind !== 'EXPENSE') throw new Error('E4-TRAVEL is not an active posting expense category.');
    if (!account || account.status !== 'ACTIVE' || account.type !== 'EXPENSE') throw new Error('EXP-004 is not an active expense account.');
    if (siblings.length !== SIBLING_CODES.length || siblings.some((sibling) => sibling.status !== 'ACTIVE' || !sibling.isPosting || sibling.kind !== 'EXPENSE' || sibling.accountId !== account.id)) throw new Error('The E4 sibling account evidence is incomplete or inconsistent.');
    if (travel.accountId && travel.accountId !== account.id) throw new Error('E4-TRAVEL already has a different account; a manual accounting decision is required.');
    const documentCount = await tx.financeOutflowDocument.count({ where: { tenantId, companyId, categoryId: travel.id } });
    if (documentCount) throw new Error('E4-TRAVEL already has financial documents; do not repair a posted history through this narrow migration script.');
    return { travelId: travel.id, travelNameAr: travel.nameAr, accountId: account.id, alreadyRepaired: travel.accountId === account.id, documentCount };
  });
  const planSha = sha({ version: VERSION, packageId, sourceCategoryId: SOURCE_CATEGORY_ID, travelId: preflight.travelId, travelCode: TRAVEL_CODE, accountId: preflight.accountId, accountCode: ACCOUNT_CODE, siblings: SIBLING_CODES });
  const dryRun = { status: 'PARSED_DRY_RUN', version: VERSION, planSha, sourceCategoryId: SOURCE_CATEGORY_ID, targetCategory: { id: preflight.travelId, code: TRAVEL_CODE, nameAr: preflight.travelNameAr }, targetAccount: ACCOUNT_CODE, siblingEvidence: SIBLING_CODES, existingFinancialDocuments: preflight.documentCount, action: preflight.alreadyRepaired ? 'REUSE_EXISTING_ACCOUNT_LINK' : 'LINK_E4_TRAVEL_TO_EXP_004', financialWrites: 0 };
  console.log(JSON.stringify(dryRun, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else if (preflight.alreadyRepaired) {
    console.log(JSON.stringify({ status: 'COMPLETED_REUSED', ...dryRun }, null, 2));
  } else {
    const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
      const category = await tx.financeCategory.findFirst({ where: { id: preflight.travelId, tenantId, companyId, status: 'ACTIVE', isPosting: true, kind: 'EXPENSE', accountId: null }, select: { id: true } });
      const account = await tx.financeAccount.findFirst({ where: { id: preflight.accountId, tenantId, companyId, code: ACCOUNT_CODE, status: 'ACTIVE', type: 'EXPENSE' }, select: { id: true } });
      if (!category || !account) throw new Error('The category or account changed after dry-run; no repair was applied.');
      await tx.financeCategory.update({ where: { id: category.id }, data: { accountId: account.id } });
      const result = { categoryId: category.id, categoryCode: TRAVEL_CODE, accountId: account.id, accountCode: ACCOUNT_CODE, planSha };
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.travel_category_account_repaired', entityType: 'FinanceCategory', entityId: category.id, requestId: `nurix-al-shami-travel-category-account:${planSha}`, afterJson: { ...result, sourceCategoryId: SOURCE_CATEGORY_ID, evidence: { siblingCodes: SIBLING_CODES, rule: 'All active posting E4 siblings use the same active EXP-004 expense account; no financial document existed on E4-TRAVEL.' } } } });
      return result;
    });
    console.log(JSON.stringify({ status: 'COMPLETED', ...dryRun, receipt }, null, 2));
  }
} finally {
  await app?.close();
}
