import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const [packageId, tenantId, actorUserId] = process.argv.slice(2);
if (!packageId || !tenantId || !actorUserId
  || !/^[0-9a-f-]{36}$/i.test(packageId)
  || !/^[0-9a-f-]{36}$/i.test(tenantId)
  || !/^[0-9a-f-]{36}$/i.test(actorUserId)) {
  throw new Error('Usage: node scripts/run-local-nurix-closure-audit.mjs <package-uuid> <tenant-uuid> <owner-user-uuid>');
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test')
  throw new Error('Refusing the Noorix closure audit outside the canonical local Baseer test database.');

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { NurixExcelPackageClosureAuditService } = await import('../apps/api/dist/nurix-migration/nurix-excel-package-closure-audit.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  console.log(JSON.stringify(await app.get(NurixExcelPackageClosureAuditService).audit({ tenantId, actorUserId, isOwner: true }, packageId)));
} finally {
  await app.close();
}
