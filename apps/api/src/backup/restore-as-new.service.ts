import {
  createRestoreAsNewRequestSchema,
  restoreAsNewDiscoveryReceiptSchema,
  type CreateRestoreAsNewRequest,
  type RestoreAsNewDiscoveryReceipt,
} from '@baseer-erp/contracts';

import { validateCompanyArchiveManifest } from './archive-verifier.js';

const MAX_DISCOVERABLE_COMPANIES = 100;

export type RestoreAsNewContext = Readonly<{
  tenantId: string;
  companyId: string;
  actorUserId: string;
}>;

/**
 * This boundary supplies only eligibility metadata until the archive is
 * complete. It must scope every lookup to the trusted tenant/context and must
 * not upload, decrypt, create a company, or invoke an importer.
 */
export interface RestoreAsNewArchiveInspector {
  inspectArchive(context: RestoreAsNewContext, archiveJobId: string): Promise<Readonly<{
    archiveCoverage: 'PARTIAL_CONFIGURATION_ONLY' | 'ARCHIVE_COMPLETE';
    restoreEligible: boolean;
  }>>;
  readVerifiedCompleteManifest(context: RestoreAsNewContext, archiveJobId: string): Promise<unknown>;
}

/**
 * Restore-as-new discovery boundary. It is deliberately not registered as a
 * provider yet: this gate has no database job, upload, decryption, target
 * company creation, or importer. Current archives always fail closed before
 * the manifest can be read because their coverage is partial.
 */
export class RestoreAsNewService {
  constructor(private readonly archives: RestoreAsNewArchiveInspector) {}

  async requestRestoreAsNew(context: RestoreAsNewContext, request: unknown): Promise<RestoreAsNewDiscoveryReceipt> {
    const parsed = createRestoreAsNewRequestSchema.safeParse(request);
    if (!parsed.success) {
      throw new RestoreAsNewError('RESTORE_REQUEST_INVALID', 'The restore-as-new request is invalid.');
    }
    return this.discoverSourceCompanies(context, parsed.data);
  }

  private async discoverSourceCompanies(context: RestoreAsNewContext, request: CreateRestoreAsNewRequest): Promise<RestoreAsNewDiscoveryReceipt> {
    const inspection = await this.archives.inspectArchive(context, request.archiveJobId);
    if (inspection.archiveCoverage !== 'ARCHIVE_COMPLETE') {
      throw new RestoreAsNewError('RESTORE_ARCHIVE_NOT_COMPLETE', 'This archive has partial coverage and cannot be restored as a new company.');
    }
    if (inspection.restoreEligible !== true) {
      throw new RestoreAsNewError('RESTORE_ARCHIVE_NOT_ELIGIBLE', 'This archive is not eligible for restore-as-new.');
    }

    let manifest: unknown;
    try {
      manifest = await this.archives.readVerifiedCompleteManifest(context, request.archiveJobId);
      validateCompanyArchiveManifest(manifest);
    } catch (error) {
      if (error instanceof RestoreAsNewError) throw error;
      throw new RestoreAsNewError('RESTORE_MANIFEST_INVALID', 'The complete archive manifest cannot be used for restore discovery.');
    }
    if (manifest.source.tenantId !== context.tenantId) {
      throw new RestoreAsNewError('RESTORE_MANIFEST_TENANT_MISMATCH', 'The archive manifest belongs to a different tenant.');
    }
    if (manifest.companies.length > MAX_DISCOVERABLE_COMPANIES) {
      throw new RestoreAsNewError('RESTORE_MANIFEST_COMPANY_LIMIT', 'The archive manifest contains too many companies for safe selection.');
    }

    const sourceCompanies = manifest.companies
      .map((company) => ({
        sourceCompanyId: company.companyId,
        nameAr: company.nameAr,
        nameEn: company.nameEn,
        recordCount: company.modules.reduce((total, module) => {
          const next = total + module.recordCount;
          if (!Number.isSafeInteger(next)) throw new RestoreAsNewError('RESTORE_MANIFEST_COUNT_INVALID', 'The archive manifest record count is unsafe.');
          return next;
        }, 0),
      }))
      .sort((left, right) => left.sourceCompanyId.localeCompare(right.sourceCompanyId));
    const recordsTotal = sumSafeRecordCounts(sourceCompanies.map((company) => company.recordCount));

    return restoreAsNewDiscoveryReceiptSchema.parse({
      archiveJobId: request.archiveJobId,
      targetCompanyName: request.targetCompanyName,
      archiveCoverage: 'ARCHIVE_COMPLETE',
      restoreEligible: true,
      stage: 'AWAITING_SOURCE_COMPANY_SELECTION',
      progressPercent: 15,
      recordsProcessed: 0,
      recordsTotal,
      bytesProcessed: '0',
      bytesTotal: null,
      sourceCompanies,
    });
  }
}

function sumSafeRecordCounts(counts: readonly number[]): number {
  let total = 0;
  for (const count of counts) {
    const next = total + count;
    if (!Number.isSafeInteger(next)) throw new RestoreAsNewError('RESTORE_MANIFEST_COUNT_INVALID', 'The archive manifest record count is unsafe.');
    total = next;
  }
  return total;
}

export class RestoreAsNewError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'RestoreAsNewError';
  }
}
