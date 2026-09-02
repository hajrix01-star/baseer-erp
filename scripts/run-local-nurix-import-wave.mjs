import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const [scope, packageId, tenantId, actorUserId, waveSize = '50'] = process.argv.slice(2);
const permittedScopes = new Set(['master-data', 'reference-provision', 'references', 'recurring', 'hr-history', 'evidence']);
if (!permittedScopes.has(scope) || !packageId || !tenantId || !actorUserId
  || !/^[0-9a-f-]{36}$/i.test(packageId)
  || !/^[0-9a-f-]{36}$/i.test(tenantId)
  || !/^[0-9a-f-]{36}$/i.test(actorUserId)) {
  throw new Error('Usage: node scripts/run-local-nurix-import-wave.mjs <master-data|reference-provision|references|recurring|hr-history|evidence> <package-uuid> <tenant-uuid> <owner-user-uuid> [wave-size]');
}

const parsedWaveSize = Number(waveSize);
if (!Number.isInteger(parsedWaveSize)) throw new Error('Wave size must be an integer.');
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing a Noorix import outside the canonical local Baseer test database.');
}

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
const context = { tenantId, actorUserId, isOwner: true };
try {
  let receipt;
  if (scope === 'master-data') {
    const { NurixExcelImportService } = await import('../apps/api/dist/nurix-migration/nurix-excel-import.service.js');
    receipt = await app.get(NurixExcelImportService).executeMasterData(context, packageId, {
      reason: 'Owner authorized Noorix accounts, categories, and employees master-data import.', waveSize: parsedWaveSize,
    });
  } else if (scope === 'reference-provision') {
    const { NurixExcelReferenceAllocationMigrationService } = await import('../apps/api/dist/nurix-migration/nurix-excel-reference-allocation-migration.service.js');
    receipt = await app.get(NurixExcelReferenceAllocationMigrationService).preprovision(context, packageId, {
      reason: 'Owner authorized Noorix supplier and vault source-lineage provisioning before financial import.', waveSize: parsedWaveSize,
    });
  } else if (scope === 'references') {
    const { NurixExcelReferenceAllocationMigrationService } = await import('../apps/api/dist/nurix-migration/nurix-excel-reference-allocation-migration.service.js');
    receipt = await app.get(NurixExcelReferenceAllocationMigrationService).execute(context, packageId, {
      reason: 'Owner authorized Noorix reference and allocation lineage import.', waveSize: parsedWaveSize,
    });
  } else if (scope === 'recurring') {
    const { NurixExcelRecurringMigrationService } = await import('../apps/api/dist/nurix-migration/nurix-excel-recurring-migration.service.js');
    receipt = await app.get(NurixExcelRecurringMigrationService).execute(context, packageId, {
      reason: 'Owner authorized Noorix historical recurring-expense import.', waveSize: parsedWaveSize,
    });
  } else if (scope === 'evidence') {
    const { NurixExcelEvidenceArchiveService } = await import('../apps/api/dist/nurix-migration/nurix-excel-evidence-archive.service.js');
    receipt = await app.get(NurixExcelEvidenceArchiveService).execute(context, packageId, {
      reason: 'Owner authorized Noorix historical evidence archive for controlled follow-up.', waveSize: parsedWaveSize,
    });
  } else {
    const { NurixExcelHrHistoryImportService } = await import('../apps/api/dist/nurix-migration/nurix-excel-hr-history-import.service.js');
    receipt = await app.get(NurixExcelHrHistoryImportService).executeVerifiedPackage(context, packageId, parsedWaveSize);
  }
  console.log(JSON.stringify(receipt));
} finally {
  await app.close();
}
