import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const APPROVAL = 'APPLY_APPROVED_ZERO_EXPECTED_REMEDIATION_V1';
const [packageId, tenantId, actorUserId, approval, waveSize = '10'] = process.argv.slice(2);
if (!packageId || !tenantId || !actorUserId || approval !== APPROVAL
  || !/^[0-9a-f-]{36}$/i.test(packageId)
  || !/^[0-9a-f-]{36}$/i.test(tenantId)
  || !/^[0-9a-f-]{36}$/i.test(actorUserId)) {
  throw new Error(`Usage: node scripts/run-local-nurix-zero-expected-recurring-remediation.mjs <package-uuid> <tenant-uuid> <owner-user-uuid> ${APPROVAL} [wave-size]`);
}

const parsedWaveSize = Number(waveSize);
if (!Number.isInteger(parsedWaveSize) || parsedWaveSize < 5 || parsedWaveSize > 25)
  throw new Error('Wave size must be an integer between 5 and 25.');

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test')
  throw new Error('Refusing the zero-expected recurring remediation outside the canonical local Baseer test database.');

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { NurixExcelRecurringMigrationService } = await import('../apps/api/dist/nurix-migration/nurix-excel-recurring-migration.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const receipt = await app.get(NurixExcelRecurringMigrationService).executeZeroExpectedProfileRemediation(
    { tenantId, actorUserId, isOwner: true },
    packageId,
    { reason: 'Owner approved the fixed zero-expected recurring-profile remediation v1.', waveSize: parsedWaveSize },
  );
  console.log(JSON.stringify(receipt));
} finally {
  await app.close();
}
