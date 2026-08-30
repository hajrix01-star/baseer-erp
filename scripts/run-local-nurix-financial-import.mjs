import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const [packageId, tenantId, actorUserId, waveSize = '100'] = process.argv.slice(2);
if (!packageId || !tenantId || !actorUserId || !/^[0-9a-f-]{36}$/i.test(packageId) || !/^[0-9a-f-]{36}$/i.test(tenantId) || !/^[0-9a-f-]{36}$/i.test(actorUserId)) {
  throw new Error('Usage: node scripts/run-local-nurix-financial-import.mjs <package-uuid> <tenant-uuid> <owner-user-uuid> [wave-size]');
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing financial import outside the canonical local Baseer test database.');
}

// Encrypted staging storage is intentionally relative to the API runtime,
// exactly as it is when the local service is running.
process.chdir(resolve('apps/api'));

const { AppModule } = await import('../apps/api/dist/app.module.js');
const { NurixExcelFinancialMigrationService } = await import('../apps/api/dist/nurix-migration/nurix-excel-financial-migration.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const service = app.get(NurixExcelFinancialMigrationService);
  const receipt = await service.execute({ tenantId, actorUserId, isOwner: true }, packageId, {
    reason: 'Owner authorized full ARZ Noorix historical financial import.',
    waveSize: Number(waveSize),
  });
  console.log(JSON.stringify(receipt));
} finally {
  await app.close();
}
