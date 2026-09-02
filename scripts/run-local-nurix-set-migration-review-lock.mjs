import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const [tenantId, companyId, actorUserId, value, reason] = process.argv.slice(2);
const UUID = /^[0-9a-f-]{36}$/i;
if (![tenantId, companyId, actorUserId].every((item) => UUID.test(item ?? ''))
  || !['LOCK', 'UNLOCK'].includes(value ?? '') || !reason?.trim()) {
  throw new Error('Usage: node scripts/run-local-nurix-set-migration-review-lock.mjs <tenant-uuid> <company-uuid> <owner-user-uuid> LOCK|UNLOCK <reason>');
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('This operation only permits the canonical local Baseer test database.');
}

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { AdministrationService } = await import('../apps/api/dist/administration/administration.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const receipt = await app.get(AdministrationService).updateCompanyMigrationReviewLock(
    { tenantId, actorUserId, isOwner: true },
    companyId,
    { locked: value === 'LOCK', reason: reason.trim() },
  );
  console.log(JSON.stringify({ companyId, requested: value, ...receipt }));
} finally {
  await app.close();
}
