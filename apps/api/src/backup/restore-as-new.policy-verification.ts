import { strict as assert } from 'node:assert';

import { RestoreAsNewError, RestoreAsNewService, type RestoreAsNewArchiveInspector } from './restore-as-new.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const archiveJobId = '22222222-2222-4222-8222-222222222222';
const context = { tenantId, companyId: '77777777-7777-4777-8777-777777777777', actorUserId: '33333333-3333-4333-8333-333333333333' };

async function expectRestoreError(code: string, work: () => Promise<unknown>): Promise<void> {
  await assert.rejects(work, (error: unknown) => error instanceof RestoreAsNewError && error.code === code);
}

async function verifyPartialArchiveFailsBeforeManifestRead(): Promise<void> {
  let manifestReads = 0;
  const inspector: RestoreAsNewArchiveInspector = {
    inspectArchive: async () => ({ archiveCoverage: 'PARTIAL_CONFIGURATION_ONLY', restoreEligible: false }),
    readVerifiedCompleteManifest: async () => { manifestReads += 1; return {}; },
  };
  const service = new RestoreAsNewService(inspector);
  await expectRestoreError('RESTORE_ARCHIVE_NOT_COMPLETE', () => service.requestRestoreAsNew(context, { archiveJobId, targetCompanyName: 'Recovered company' }));
  assert.equal(manifestReads, 0, 'partial archives must fail before manifest access, upload, or import');
}

async function verifyOnlyCompleteManifestCompaniesCanBeSelected(): Promise<void> {
  const inspector: RestoreAsNewArchiveInspector = {
    inspectArchive: async () => ({ archiveCoverage: 'ARCHIVE_COMPLETE', restoreEligible: true }),
    readVerifiedCompleteManifest: async () => ({
      archiveFormatVersion: 'baseer-company-archive/v1',
      archiveId: '44444444-4444-4444-8444-444444444444',
      createdAt: '2026-08-27T00:00:00.000Z',
      source: { applicationVersion: 'test', schemaVersion: 'test', tenantId },
      companies: [
        { companyId: '66666666-6666-4666-8666-666666666666', nameAr: 'باء', nameEn: 'Beta', modules: [{ module: 'finance', recordCount: 2 }] },
        { companyId: '55555555-5555-4555-8555-555555555555', nameAr: 'ألف', nameEn: 'Alpha', modules: [{ module: 'finance', recordCount: 3 }] },
      ],
      files: [],
    }),
  };
  const receipt = await new RestoreAsNewService(inspector).requestRestoreAsNew(context, { archiveJobId, targetCompanyName: 'New target' });
  assert.equal(receipt.stage, 'AWAITING_SOURCE_COMPANY_SELECTION');
  assert.equal(receipt.recordsTotal, 5);
  assert.deepEqual(receipt.sourceCompanies.map((company) => company.sourceCompanyId), [
    '55555555-5555-4555-8555-555555555555',
    '66666666-6666-4666-8666-666666666666',
  ]);
}

async function main(): Promise<void> {
  await verifyPartialArchiveFailsBeforeManifestRead();
  await verifyOnlyCompleteManifestCompaniesCanBeSelected();
  process.stdout.write('restore-as-new policy verification passed\n');
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
