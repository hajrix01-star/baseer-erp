import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const [tenantId, companyId, actorUserId, startIso, endIso, nameAr, nameEn] = process.argv.slice(2);
const UUID = /^[0-9a-f-]{36}$/i;
if (![tenantId, companyId, actorUserId].every((value) => UUID.test(value ?? ''))
  || !/^\d{4}-\d{2}-\d{2}$/.test(startIso ?? '')
  || !/^\d{4}-\d{2}-\d{2}$/.test(endIso ?? '')
  || !nameAr?.trim() || !nameEn?.trim()) {
  throw new Error('Usage: node scripts/run-local-nurix-create-open-period.mjs <tenant-uuid> <company-uuid> <owner-user-uuid> <start-date> <end-date> <name-ar> <name-en>');
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing to create a fiscal period outside the canonical local Baseer test database.');
}

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { FinancePeriodLifecycleService } = await import('../apps/api/dist/finance/finance-period-lifecycle.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const receipt = await app.get(FinancePeriodLifecycleService).createOpenPeriod(
    { tenantId, companyId, actorUserId },
    {
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim(),
      startDate: new Date(`${startIso}T00:00:00.000Z`),
      endDate: new Date(`${endIso}T00:00:00.000Z`),
    },
  );
  console.log(JSON.stringify({ periodId: receipt, startIso, endIso }));
} finally {
  await app.close();
}
