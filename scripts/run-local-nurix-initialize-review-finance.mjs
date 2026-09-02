import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const [tenantId, companyId, actorUserId] = process.argv.slice(2);
const UUID = /^[0-9a-f-]{36}$/i;
if (![tenantId, companyId, actorUserId].every((value) => UUID.test(value ?? ''))) {
  throw new Error('Usage: node scripts/run-local-nurix-initialize-review-finance.mjs <tenant-uuid> <company-uuid> <owner-user-uuid>');
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing to initialize finance outside the canonical local Baseer test database.');
}

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { CompanyFinanceSetupService } = await import('../apps/api/dist/finance/company-finance-setup.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const receipt = await app.get(CompanyFinanceSetupService).initialize(
    { tenantId, companyId, actorUserId },
    {
      fiscalPeriodNameAr: 'الفترة المالية الحالية 2026',
      fiscalPeriodNameEn: 'Financial period 2026',
      fiscalPeriodStartDate: new Date('2026-01-01T00:00:00.000Z'),
      fiscalPeriodEndDate: new Date('2026-12-31T00:00:00.000Z'),
      selectedVaults: ['CASH', 'BANK'],
    },
    `nurix-review-finance-foundation:${companyId}:2026`,
  );
  console.log(JSON.stringify(receipt));
} finally {
  await app.close();
}
