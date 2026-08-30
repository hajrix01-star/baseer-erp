import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const [tenantId, companyId, actorUserId] = process.argv.slice(2);
if (![tenantId, companyId, actorUserId].every((value) => /^[0-9a-f-]{36}$/i.test(value ?? ''))) {
  throw new Error('Usage: node scripts/run-local-finance-foundation.mjs <tenant-uuid> <company-uuid> <owner-user-uuid>');
}
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing to initialize finance foundation outside the canonical local Baseer test database.');
}

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { FinanceFoundationService } = await import('../apps/api/dist/finance/finance-foundation.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const receipt = await app.get(FinanceFoundationService).initializeForCompany({
    tenantId, companyId, actorUserId, requestId: `nurix-migration-foundation:${companyId}`,
  });
  console.log(JSON.stringify(receipt));
} finally {
  await app.close();
}
