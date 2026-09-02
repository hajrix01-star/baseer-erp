/** Lift one company review lock only through the package closure gate. */
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const [packageId, tenantId, actorUserId, approval] = process.argv.slice(2);
const APPROVAL = 'APPLY_APPROVED_NOORIX_VERIFIED_CLOSURE_UNLOCK_V1';
if (![packageId, tenantId, actorUserId].every((value) => /^[0-9a-f-]{36}$/i.test(value ?? '')) || approval !== APPROVAL) {
  throw new Error(`Usage: node scripts/run-local-nurix-verified-closure-unlock.mjs <package-uuid> <tenant-uuid> <owner-user-uuid> ${APPROVAL}`);
}
const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('This closure writer only permits the canonical local Baseer test database.');
}

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { NurixExcelPackageClosureAuditService } = await import('../apps/api/dist/nurix-migration/nurix-excel-package-closure-audit.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const result = await app.get(NurixExcelPackageClosureAuditService)
    .unlockCompanyAfterVerifiedClosure({ tenantId, actorUserId, isOwner: true }, packageId);
  console.log(JSON.stringify({ unlocked: result.unlocked, packageId: result.audit.packageId, targetCompanyId: result.audit.targetCompanyId, readyToUnlock: result.audit.readyToUnlock, blockingSheets: result.audit.blockingSheets, dailySalesReconciliation: result.audit.dailySalesReconciliation }, null, 2));
} finally {
  await app.close();
}
