import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const [tenantId, actorUserId, sourceCompanyId, nameAr, nameEn = ''] = process.argv.slice(2);
const UUID = /^[0-9a-f-]{36}$/i;
if (![tenantId, actorUserId].every((value) => UUID.test(value ?? '')) || !sourceCompanyId || !nameAr) {
  throw new Error('Usage: node scripts/run-local-nurix-create-review-company.mjs <tenant-uuid> <owner-user-uuid> <source-company-id> <name-ar> [name-en]');
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing to create a Noorix review company outside the canonical local Baseer test database.');
}

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { AdministrationService } = await import('../apps/api/dist/administration/administration.service.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const context = { tenantId, actorUserId, isOwner: true };
  const database = app.get(DatabaseService);
  const existing = await database.inTenantTransaction(tenantId, (tx) => tx.company.findFirst({
    where: { tenantId, nameAr: nameAr.trim() },
    select: { id: true, migrationReviewLocked: true },
  }));
  if (existing) {
    if (!existing.migrationReviewLocked) throw new Error(`Existing target company is not review-locked: ${existing.id}`);
    console.log(JSON.stringify({ status: 'REUSED_LOCKED', sourceCompanyId, companyId: existing.id }));
  } else {
    const administration = app.get(AdministrationService);
    const created = await administration.createCompany(context, {
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim() || undefined,
      businessTimezone: 'Asia/Riyadh',
    });
    await administration.updateCompanyMigrationReviewLock(context, created.id, {
      locked: true,
      reason: `تهيئة شركة مراجعة لترحيل نوركس: ${sourceCompanyId}`,
    });
    console.log(JSON.stringify({ status: 'CREATED_LOCKED', sourceCompanyId, companyId: created.id }));
  }
} finally {
  await app.close();
}
