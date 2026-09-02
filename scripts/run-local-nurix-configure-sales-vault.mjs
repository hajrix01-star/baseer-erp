import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const [tenantId, companyId, actorUserId, vaultId, nameAr, nameEn, type, paymentMethod] = process.argv.slice(2);
const UUID = /^[0-9a-f-]{36}$/i;
const allowedTypes = new Set(['CASH', 'BANK', 'APP']);
const allowedPaymentMethods = new Set(['CASH', 'BANK_TRANSFER', 'CARD', 'APP']);
if (![tenantId, companyId, actorUserId, vaultId].every((value) => UUID.test(value ?? ''))
  || !nameAr?.trim() || !nameEn?.trim()
  || !allowedTypes.has(type ?? '') || !allowedPaymentMethods.has(paymentMethod ?? '')) {
  throw new Error('Usage: node scripts/run-local-nurix-configure-sales-vault.mjs <tenant-uuid> <company-uuid> <owner-user-uuid> <vault-uuid> <name-ar> <name-en> <CASH|BANK|APP> <payment-method>');
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing to configure a sales vault outside the canonical local Baseer test database.');
}

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { VaultManagementService } = await import('../apps/api/dist/finance/vault-management.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const receipt = await app.get(VaultManagementService).update(
    { tenantId, companyId, actorUserId },
    {
      vaultId,
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim(),
      type,
      paymentMethod,
      paymentMethods: [paymentMethod],
      isSalesChannel: true,
      isPaymentDestination: true,
      idempotencyKey: `nurix-historical-sales-channel:${companyId}:${vaultId}`,
    },
  );
  console.log(JSON.stringify({ vaultId: receipt, isSalesChannel: true, isPaymentDestination: true }));
} finally {
  await app.close();
}
