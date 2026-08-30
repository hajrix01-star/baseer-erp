import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

// This writer is intentionally not a financial importer. It records one
// owner-approved exclusion for a verified Noorix row that has no positive
// expected amount and no active historical payment. It must never create a
// recurring profile, outflow document, journal or source-to-target map.
const VERSION = 'nurix-excel-recurring-zero-payment-exclusion/v1';
const APPROVAL = 'APPLY_APPROVED_ARZ_ZERO_PAYMENT_RECURRING_EXCLUSION_V1';
const SOURCE_PROFILE_ID = 'cms1r4wo0006elqrkphm2agdj';
const SOURCE_COMPANY_ID = 'cmnf604ka009ay8lm556wgd9c';
const RESULT_CODE = 'NO_ACTIVE_HISTORICAL_PAYMENT_OWNER_APPROVED_DELETE';

const [packageId, tenantId, companyId, actorUserId, approval] = process.argv.slice(2);
if (!packageId || !tenantId || !companyId || !actorUserId || approval !== APPROVAL
  || ![packageId, tenantId, companyId, actorUserId].every((value) => /^[0-9a-f-]{36}$/i.test(value))) {
  throw new Error(`Usage: node scripts/run-local-nurix-zero-payment-recurring-profile-exclusion.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> ${APPROVAL}`);
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing the recurring exclusion outside the canonical local Baseer test database.');
}

const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const database = app.get(DatabaseService);
  const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({
      where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, status: 'READY_FOR_RECONCILIATION' },
      select: { id: true },
    });
    if (!packageRow) throw new Error('The verified package does not match the ARZ Noorix source scope.');

    const source = await tx.nurixExcelStagingRow.findFirst({
      where: { packageId, tenantId, sheet: 'RecurringExpenseProfiles', sourceId: SOURCE_PROFILE_ID, status: 'ACCEPTED' },
      select: { sourceChecksum: true },
    });
    if (!source) throw new Error('The approved zero-payment recurring source row is absent from the verified package.');

    const reviewEvidence = await tx.nurixExcelFinancialItem.findFirst({
      where: {
        tenantId,
        targetCompanyId: companyId,
        sourceEntity: 'RecurringExpenseProfile',
        sourceId: SOURCE_PROFILE_ID,
        status: 'REVIEW_REQUIRED',
        resultCode: 'PROFILE_EXPECTED_AMOUNT_NONPOSITIVE',
        execution: { packageId, transformVersion: 'nurix-excel-historical-recurring-expense/v1', status: 'COMPLETED' },
      },
      select: { id: true },
    });
    if (!reviewEvidence) throw new Error('The source row does not have the required nonpositive-profile review evidence.');

    const existingProfileMap = await tx.nurixExcelFinancialSourceMap.findFirst({
      where: { tenantId, targetCompanyId: companyId, sourceEntity: 'RecurringExpenseProfile', sourceId: SOURCE_PROFILE_ID, state: { in: ['APPLIED', 'REUSED', 'REVERSED'] } },
      select: { id: true },
    });
    if (existingProfileMap) throw new Error('Refusing exclusion because the zero-payment source already has a durable target map.');

    const plan = { version: VERSION, packageId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: 'RecurringExpenseProfile', sourceId: SOURCE_PROFILE_ID, sourceChecksum: source.sourceChecksum, resultCode: RESULT_CODE };
    const planChecksum = sha(plan);
    const existing = await tx.nurixExcelFinancialExecution.findFirst({ where: { packageId, tenantId, transformVersion: VERSION }, select: { id: true, status: true, financialPlanSha256: true } });
    if (existing) {
      if (existing.financialPlanSha256 !== planChecksum || existing.status !== 'COMPLETED') throw new Error('The recurring exclusion execution is not safely resumable.');
      return { status: 'REUSED_COMPLETED_AUDIT_EVIDENCE', executionId: existing.id, sourceId: SOURCE_PROFILE_ID, financialWrites: 0, sourceMapsCreated: 0 };
    }

    const executionId = randomUUID();
    const waveId = randomUUID();
    const itemId = randomUUID();
    const reconciliation = { version: VERSION, sourceId: SOURCE_PROFILE_ID, resultCode: RESULT_CODE, financialWrites: 0, sourceMapsCreated: 0, targetProfileCreated: false, targetDocumentCreated: false, journalCreated: false };
    const reconciliationHash = sha(reconciliation);
    await tx.nurixExcelFinancialExecution.create({
      data: {
        id: executionId, packageId, tenantId, targetCompanyId: companyId, transformVersion: VERSION,
        financialPlanSha256: planChecksum, status: 'APPROVED',
        reason: 'Owner-approved evidence-only exclusion: zero expected amount and no historical recurring payment; no financial target is created.',
        requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date(),
      },
    });
    await tx.nurixExcelFinancialWave.create({
      data: { id: waveId, executionId, tenantId, targetCompanyId: companyId, sequence: 1, status: 'COMMITTED', plannedItems: 1, postedItems: 0, reusedItems: 0, reviewItems: 1, failedItems: 0, committedAt: new Date(), reconciliationHash },
    });
    await tx.nurixExcelFinancialItem.create({
      data: {
        id: itemId, executionId, waveId, tenantId, targetCompanyId: companyId,
        sourceSheet: 'RecurringExpenseProfiles', sourceEntity: 'RecurringExpenseProfile', sourceId: SOURCE_PROFILE_ID,
        sourceChecksum: source.sourceChecksum, operationKey: sha({ version: VERSION, sourceId: SOURCE_PROFILE_ID }),
        status: 'EXCLUDED', targetEntity: 'NoorixRecurringProfileExclusionEvidence', targetId: SOURCE_PROFILE_ID, resultCode: RESULT_CODE,
      },
    });
    await tx.nurixExcelFinancialReceipt.create({
      data: { id: randomUUID(), executionId, waveId, tenantId, targetCompanyId: companyId, sequence: 1, kind: 'RECONCILIATION', receiptSha256: reconciliationHash, summaryJson: reconciliation, createdByUserId: actorUserId },
    });
    await tx.nurixExcelFinancialExecution.update({ where: { id: executionId }, data: { status: 'COMPLETED', waveSequence: 1, reason: null } });
    return { status: 'COMPLETED_AUDIT_EVIDENCE', executionId, sourceId: SOURCE_PROFILE_ID, financialWrites: 0, sourceMapsCreated: 0 };
  });
  console.log(JSON.stringify(receipt));
} finally {
  await app.close();
}
