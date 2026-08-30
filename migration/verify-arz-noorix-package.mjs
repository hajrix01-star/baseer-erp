import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { NurixExcelImportService } from '../apps/api/dist/nurix-migration/nurix-excel-import.service.js';

const [suppliedPath, requestedSourceCompanyId, requestedTargetCompanyId] = process.argv.slice(2);
const workbookPath = suppliedPath ? new URL(`../${suppliedPath.replace(/\\/g, '/')}`, import.meta.url) : new URL('../outputs/arz-noorix-comprehensive-dry-run-v3/arz-noorix-comprehensive-dry-run-v3.xlsx', import.meta.url);
const sourceCompanyId = requestedSourceCompanyId ?? 'cmnf604ka009ay8lm556wgd9c';
const targetCompanyId = requestedTargetCompanyId ?? '9643b3f9-6f07-40e5-bbb1-937ae28daf4d';

const database = {
  inTenantTransaction: async (_tenantId, callback) => callback({
    company: { findFirst: async () => ({ id: targetCompanyId, migrationReviewLocked: true }) },
  }),
};

const bytes = await fs.readFile(workbookPath);
const service = new NurixExcelImportService(database, { store: async () => { throw new Error('Storage must not run without a staging database client.'); } });
const result = await service.dryRun(
  { tenantId: 'dry-run-tenant', actorUserId: 'dry-run-owner', isOwner: true },
  {
    targetCompanyId,
    sourceCompanyId,
    templateVersion: 'nurix-excel-package/v3',
    workbook: {
      fileName: workbookPath.pathname.split('/').at(-1),
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      byteSize: bytes.length,
      exportedAt: '2026-08-29T00:00:00.000Z',
      contentsBase64: bytes.toString('base64'),
    },
  },
);

console.log(JSON.stringify({ status: result.status, parsedRows: result.parsedRows, acceptedRows: result.acceptedRows, financialWrites: result.financialWrites, rejectedRows: result.rejectedRows, checks: result.checks, rowIssues: result.rowIssues.slice(0, 20) }, null, 2));
assert.equal(result.status, 'PARSED_DRY_RUN');
assert.equal(result.financialWrites, 0);
assert.equal(result.canStage, false);
assert.equal(result.rejectedRows, 0);
assert.equal(result.checks.find((check) => check.code === 'ROW_VALIDATION')?.passed, true);
