import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const APPROVAL = 'APPLY_APPROVED_NOORIX_RENT_OVERLAP_V1';
const [packageId, tenantId, actorUserId, approval] = process.argv.slice(2);
if (!packageId || !tenantId || !actorUserId || approval !== APPROVAL
  || !/^[0-9a-f-]{36}$/i.test(packageId)
  || !/^[0-9a-f-]{36}$/i.test(tenantId)
  || !/^[0-9a-f-]{36}$/i.test(actorUserId)) {
  throw new Error(`Usage: node scripts/run-local-nurix-concurrent-rent-override.mjs <package-uuid> <tenant-uuid> <owner-user-uuid> ${APPROVAL}`);
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test')
  throw new Error('Refusing the Noorix rent-overlap override outside the canonical local Baseer test database.');

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { NurixExcelRecurringMigrationService } = await import('../apps/api/dist/nurix-migration/nurix-excel-recurring-migration.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const receipt = await app.get(NurixExcelRecurringMigrationService).executeApprovedConcurrentCoverageOverride(
    { tenantId, actorUserId, isOwner: true },
    packageId,
    { reason: 'Owner approved importing four Noorix showroom-rent invoices exactly as recorded despite source coverage-date overlap.', waveSize: 10 },
  );
  console.log(JSON.stringify(receipt));
} finally {
  await app.close();
}
