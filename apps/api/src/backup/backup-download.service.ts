import { Injectable } from '@nestjs/common';
import type { ReadStream } from 'node:fs';

import { DatabaseService } from '../database/database.service.js';
import { ArchiveStorageDownloadError, LocalArchiveStagingStorage } from './archive-storage.js';
import type { RestoreAsNewArchiveInspector, RestoreAsNewContext } from './restore-as-new.service.js';

const COMPANY_ARCHIVE_KIND = 'COMPANY_ARCHIVE_EXPORT' as const;
const ENCRYPTED_COMPANY_ARCHIVE_FORMAT = 'baseer-encrypted-company-archive/v1' as const;

export type BackupDownloadContext = Readonly<{
  tenantId: string;
  companyId: string;
  actorUserId?: string;
}>;

export type VerifiedBackupDownload = Readonly<{
  jobId: string;
  artifactId: string;
  filename: string;
  contentType: 'application/octet-stream';
  byteSize: bigint;
  sha256: string;
  openReadStream: () => ReadStream;
  dispose: () => Promise<void>;
}>;

export type CompanyArchiveDownloadMetadata = Readonly<{
  archiveCoverage: 'PARTIAL_CONFIGURATION_ONLY';
  restoreEligible: false;
  artifact: Readonly<{
    filename: string;
    byteSize: bigint;
    sha256: string;
    format: 'baseer-encrypted-company-archive/v1';
    verifiedAt: Date;
    expiresAt: Date | null;
  }> | null;
}>;

/**
 * Trusted download resolution only. HTTP authorization, audit, ranges and
 * tickets are intentionally outside this primitive. It streams encrypted BCA
 * bytes as stored; it never unwraps a key or materializes plaintext.
 */
@Injectable()
export class BackupDownloadService {
  private archiveStorage?: LocalArchiveStagingStorage;

  constructor(private readonly database: DatabaseService) {}

  async resolveVerifiedEncryptedDownload(context: BackupDownloadContext, jobId: string): Promise<VerifiedBackupDownload> {
    const record = await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const job = await tx.backupJob.findFirst({
        where: { id: jobId, tenantId: context.tenantId, companyId: context.companyId, kind: COMPANY_ARCHIVE_KIND },
        select: {
          id: true,
          status: true,
          artifacts: {
            take: 1,
            select: {
              id: true, status: true, formatVersion: true, storageKey: true,
              sha256: true, byteSize: true, expiresAt: true, verifiedAt: true,
            },
          },
        },
      });
      if (!job) throw new BackupDownloadError('DOWNLOAD_JOB_NOT_FOUND', 'The requested company archive job was not found.');
      if (job.status !== 'PUBLISHED') throw new BackupDownloadError('DOWNLOAD_JOB_NOT_PUBLISHED', 'The requested company archive job is not published.');
      const artifact = job.artifacts[0];
      if (!artifact) throw new BackupDownloadError('DOWNLOAD_ARTIFACT_NOT_FOUND', 'The published backup job has no archive artifact.');
      if (artifact.status !== 'VERIFIED' || artifact.formatVersion !== ENCRYPTED_COMPANY_ARCHIVE_FORMAT || !artifact.verifiedAt || !artifact.storageKey || !artifact.sha256 || artifact.byteSize === null) {
        throw new BackupDownloadError('DOWNLOAD_ARTIFACT_NOT_VERIFIED', 'The company archive artifact is not eligible for download.');
      }
      if (artifact.expiresAt && artifact.expiresAt <= new Date()) {
        throw new BackupDownloadError('DOWNLOAD_ARTIFACT_EXPIRED', 'The company archive artifact has expired.');
      }
      return {
        jobId: job.id,
        artifact: {
          id: artifact.id,
          storageKey: artifact.storageKey!,
          sha256: artifact.sha256!,
          byteSize: artifact.byteSize!,
        },
      };
    });

    let encrypted;
    try {
      encrypted = await this.storage.resolveVerifiedEncryptedDownload({
        tenantId: context.tenantId,
        companyId: context.companyId,
        jobId: record.jobId,
        storageKey: record.artifact.storageKey,
        byteSize: record.artifact.byteSize,
        sha256: record.artifact.sha256,
      });
    } catch (error) {
      if (error instanceof ArchiveStorageDownloadError) {
        throw new BackupDownloadError(error.code, error.message);
      }
      throw error;
    }
    return {
      jobId: record.jobId,
      artifactId: record.artifact.id,
      filename: `baseer-company-${record.jobId}.bca`,
      contentType: 'application/octet-stream',
      byteSize: encrypted.byteSize,
      sha256: encrypted.sha256,
      openReadStream: encrypted.openReadStream,
      dispose: encrypted.dispose,
    };
  }

  /**
   * Metadata is intentionally derived from the same tenant/company-scoped
   * record as the stream. It is safe for a download-capable user and exposes
   * neither a storage key nor any encryption material.
   */
  async getCompanyArchiveDownloadMetadata(context: BackupDownloadContext, jobId: string): Promise<CompanyArchiveDownloadMetadata> {
    const record = await this.database.inTenantTransaction(context.tenantId, (tx) => tx.backupJob.findFirst({
      where: { id: jobId, tenantId: context.tenantId, companyId: context.companyId, kind: COMPANY_ARCHIVE_KIND },
      select: {
        id: true,
        artifacts: {
          take: 1,
          select: { status: true, formatVersion: true, filename: true, sha256: true, byteSize: true, verifiedAt: true, expiresAt: true },
        },
      },
    }));
    if (!record) throw new BackupDownloadError('DOWNLOAD_JOB_NOT_FOUND', 'The requested company archive job was not found.');
    const artifact = record.artifacts[0];
    const eligible = artifact
      && artifact.status === 'VERIFIED'
      && artifact.formatVersion === ENCRYPTED_COMPANY_ARCHIVE_FORMAT
      && artifact.filename
      && artifact.sha256
      && artifact.byteSize !== null
      && artifact.verifiedAt
      && (!artifact.expiresAt || artifact.expiresAt > new Date());
    return {
      archiveCoverage: 'PARTIAL_CONFIGURATION_ONLY',
      restoreEligible: false,
      artifact: eligible ? {
        filename: artifact.filename!,
        byteSize: artifact.byteSize!,
        sha256: artifact.sha256!,
        format: ENCRYPTED_COMPANY_ARCHIVE_FORMAT,
        verifiedAt: artifact.verifiedAt!,
        expiresAt: artifact.expiresAt,
      } : null,
    };
  }

  /**
   * Restore discovery uses an explicit, tenant-and-company-scoped inspection
   * boundary.  The current archive format is never elevated to complete: this
   * method keeps the restore path fail-closed until a future full importer is
   * separately reviewed.
   */
  async inspectArchive(context: RestoreAsNewContext, jobId: string): ReturnType<RestoreAsNewArchiveInspector['inspectArchive']> {
    const job = await this.database.inTenantTransaction(context.tenantId, (tx) => tx.backupJob.findFirst({
      where: { id: jobId, tenantId: context.tenantId, companyId: context.companyId, kind: COMPANY_ARCHIVE_KIND },
      select: { id: true },
    }));
    if (!job) throw new BackupDownloadError('DOWNLOAD_JOB_NOT_FOUND', 'The requested company archive job was not found.');
    return { archiveCoverage: 'PARTIAL_CONFIGURATION_ONLY', restoreEligible: false };
  }

  async readVerifiedCompleteManifest(_context: RestoreAsNewContext, _jobId: string): ReturnType<RestoreAsNewArchiveInspector['readVerifiedCompleteManifest']> {
    throw new BackupDownloadError('RESTORE_COMPLETE_ARCHIVE_UNAVAILABLE', 'No complete archive importer is available in this gate.');
  }

  private get storage(): LocalArchiveStagingStorage {
    return this.archiveStorage ??= new LocalArchiveStagingStorage();
  }
}

export class BackupDownloadError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'BackupDownloadError'; }
}
