import { resolve } from 'node:path';
import fs from 'node:fs/promises';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const [workbookPath, sourceCompanyId, targetCompanyId, tenantId, actorUserId] = process.argv.slice(2);
if (!workbookPath || !sourceCompanyId || !targetCompanyId || !tenantId || !actorUserId
  || !/^[0-9a-f-]{36}$/i.test(targetCompanyId)
  || !/^[0-9a-f-]{36}$/i.test(tenantId)
  || !/^[0-9a-f-]{36}$/i.test(actorUserId)) {
  throw new Error('Usage: node scripts/run-local-nurix-stage-package.mjs <xlsx-path> <source-company-id> <target-company-uuid> <tenant-uuid> <owner-user-uuid>');
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '5433' || databaseUrl.pathname !== '/baseer_erp_test') {
  throw new Error('Refusing to stage a Noorix package outside the canonical local Baseer test database.');
}

const bytes = await fs.readFile(resolve(workbookPath));
process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { NurixExcelImportService } = await import('../apps/api/dist/nurix-migration/nurix-excel-import.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const receipt = await app.get(NurixExcelImportService).dryRun(
    { tenantId, actorUserId, isOwner: true },
    {
      targetCompanyId,
      sourceCompanyId,
      templateVersion: 'nurix-excel-package/v3',
      workbook: {
        fileName: workbookPath.split(/[\\/]/).at(-1),
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        byteSize: bytes.length,
        exportedAt: new Date().toISOString(),
        contentsBase64: bytes.toString('base64'),
      },
    },
  );
  if (receipt.status !== 'PARSED_DRY_RUN' || !receipt.stagingPackageId) throw new Error(`Package staging failed: ${receipt.status}`);
  console.log(JSON.stringify(receipt));
} finally {
  await app.close();
}
