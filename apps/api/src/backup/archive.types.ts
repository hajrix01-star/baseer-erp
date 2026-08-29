/**
 * The logical company archive contract.  The exporter is intentionally
 * separate from this contract: only data selected by the ownership registry
 * may be written beneath `data/` by a later Gate 2 worker.
 */
export const COMPANY_ARCHIVE_FORMAT_VERSION = 'baseer-company-archive/v1' as const;
export const ARCHIVE_MANIFEST_FILE = 'manifest.json' as const;
export const ARCHIVE_CHECKSUMS_FILE = 'checksums.sha256' as const;
export const ARCHIVE_PUBLISH_MARKER_FILE = '.baseer-published.json' as const;

export type ArchiveModuleSummary = Readonly<{
  module: string;
  recordCount: number;
}>;

export type ArchiveCompany = Readonly<{
  companyId: string;
  nameAr: string;
  nameEn: string;
  modules: readonly ArchiveModuleSummary[];
}>;

/** Paths are relative to an archive root and never contain manifest files. */
export type ArchiveFileDescriptor = Readonly<{
  path: string;
  byteSize: number;
  sha256: string;
}>;

export type CompanyArchiveManifest = Readonly<{
  archiveFormatVersion: typeof COMPANY_ARCHIVE_FORMAT_VERSION;
  archiveId: string;
  createdAt: string;
  source: Readonly<{
    applicationVersion: string;
    schemaVersion: string;
    tenantId: string;
  }>;
  companies: readonly ArchiveCompany[];
  files: readonly ArchiveFileDescriptor[];
}>;

export type ArchivePublishMarker = Readonly<{
  markerVersion: 1;
  archiveId: string;
  manifestSha256: string;
  publishedAt: string;
}>;

export type ArchiveVerificationIssue = Readonly<{
  code: string;
  path?: string;
  message: string;
}>;

export type ArchiveVerificationResult = Readonly<{
  valid: boolean;
  manifestSha256?: string;
  verifiedFiles: number;
  verifiedBytes: number;
  issues: readonly ArchiveVerificationIssue[];
}>;

/** `BSAE0001` followed by a four-byte big-endian canonical header length. */
export const ENCRYPTED_ARCHIVE_MAGIC = 'BSAE0001' as const;
export const ENCRYPTED_ARCHIVE_FORMAT_VERSION = 1 as const;
export const ENCRYPTED_ARCHIVE_FILE_EXTENSION = '.bca' as const;

export type ArchiveEncryptionScope = Readonly<{
  tenantId: string;
  companyId: string;
  jobId: string;
  workerLeaseFence: bigint;
}>;

export type WrappedArchiveDataKey = Readonly<{
  algorithm: 'AES-256-GCM';
  keyId: string;
  ivBase64: string;
  authTagBase64: string;
  ciphertextBase64: string;
}>;

/** Non-sensitive envelope metadata. It contains no record names or key bytes. */
export type EncryptedArchiveHeader = Readonly<{
  magic: typeof ENCRYPTED_ARCHIVE_MAGIC;
  version: typeof ENCRYPTED_ARCHIVE_FORMAT_VERSION;
  scope: Readonly<{
    tenantId: string;
    companyId: string;
    jobId: string;
    workerLeaseFence: string;
  }>;
  manifestSha256: string;
  compression: 'gzip';
  payloadEncryption: 'AES-256-GCM';
  payloadIvBase64: string;
  wrappedDataKey: WrappedArchiveDataKey;
}>;

export type EncryptedArchiveArtifact = Readonly<{
  storageKey: string;
  artifactPath: string;
  byteSize: bigint;
  sha256: string;
  manifestSha256: string;
  createdAt: string;
}>;
