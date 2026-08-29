/**
 * Gate-zero migration boundary: validates declared metadata only. It does not
 * open exports, resolve paths, access a database, or retain credentials.
 */
export const NURIX_MIGRATION_INTAKE_FORMAT = 'baseer-migration-intake/v1' as const;

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_RELATIVE_PATH = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))(?!\/)(?!.*\/\/)[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;
const MAX_DECLARED_FILES = 10_000;
const MAX_FUTURE_SKEW_MS = 5 * 60 * 1_000;

export type NurixMigrationIntakeFile = Readonly<{
  path: string;
  sha256: string;
  byteSize: number;
  recordCount: number;
}>;

export type NurixMigrationIntakeManifest = Readonly<{
  format: typeof NURIX_MIGRATION_INTAKE_FORMAT;
  sourceFingerprint: string;
  exportedAt: string;
  declaredFileCount: number;
  declaredRecordCount: number;
  files: readonly NurixMigrationIntakeFile[];
}>;

export type NurixMigrationIntakeReceipt = Readonly<{
  manifest: NurixMigrationIntakeManifest;
  declaredByteSize: number;
}>;

export class NurixMigrationIntakeError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'NurixMigrationIntakeError';
  }
}

/**
 * Validates a source-agnostic declaration before any file is parsed. The
 * supplied value stays opaque: callers must perform file access only after
 * this receipt is accepted by a separately reviewed orchestration layer.
 */
export function validateNurixMigrationIntakeManifest(value: unknown, now: Date = new Date()): NurixMigrationIntakeReceipt {
  try {
    return validateManifest(value, now);
  } catch (error) {
    if (error instanceof NurixMigrationIntakeError) throw error;
    // Proxies/accessors must not turn an intake error into an unreviewed
    // exception that leaks caller-provided text or bypasses the fail-closed API.
    throw fail('MANIFEST_UNREADABLE');
  }
}

function validateManifest(value: unknown, now: Date): NurixMigrationIntakeReceipt {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, ['format', 'sourceFingerprint', 'exportedAt', 'declaredFileCount', 'declaredRecordCount', 'files'])) {
    throw fail('MANIFEST_SHAPE_INVALID');
  }
  if (value.format !== NURIX_MIGRATION_INTAKE_FORMAT) throw fail('MANIFEST_FORMAT_UNSUPPORTED');
  if (typeof value.sourceFingerprint !== 'string' || !SHA256.test(value.sourceFingerprint)) throw fail('SOURCE_FINGERPRINT_INVALID');
  const exportedAt = parseCanonicalTimestamp(value.exportedAt, now);
  if (!isSafeCount(value.declaredFileCount) || !isSafeCount(value.declaredRecordCount) || !Array.isArray(value.files) || value.files.length === 0 || value.files.length > MAX_DECLARED_FILES || value.declaredFileCount !== value.files.length) {
    throw fail('MANIFEST_COUNT_INVALID');
  }

  const paths = new Set<string>();
  let totalRecords = 0;
  let totalBytes = 0;
  const files: NurixMigrationIntakeFile[] = [];
  for (const candidate of value.files) {
    if (!isPlainRecord(candidate) || !hasOnlyKeys(candidate, ['path', 'sha256', 'byteSize', 'recordCount']) || typeof candidate.path !== 'string' || !SAFE_RELATIVE_PATH.test(candidate.path) || typeof candidate.sha256 !== 'string' || !SHA256.test(candidate.sha256) || !isSafeCount(candidate.byteSize) || !isSafeCount(candidate.recordCount) || paths.has(candidate.path)) {
      throw fail('MANIFEST_FILE_INVALID');
    }
    paths.add(candidate.path);
    totalRecords = safeSum(totalRecords, candidate.recordCount, 'MANIFEST_RECORD_COUNT_OVERFLOW');
    totalBytes = safeSum(totalBytes, candidate.byteSize, 'MANIFEST_BYTE_COUNT_OVERFLOW');
    files.push(Object.freeze({ path: candidate.path, sha256: candidate.sha256, byteSize: candidate.byteSize, recordCount: candidate.recordCount }));
  }
  if (totalRecords !== value.declaredRecordCount) throw fail('MANIFEST_RECORD_COUNT_MISMATCH');
  return Object.freeze({
    manifest: Object.freeze({
      format: NURIX_MIGRATION_INTAKE_FORMAT,
      sourceFingerprint: value.sourceFingerprint,
      exportedAt,
      declaredFileCount: value.declaredFileCount,
      declaredRecordCount: value.declaredRecordCount,
      files: Object.freeze(files),
    }),
    declaredByteSize: totalBytes,
  });
}

function parseCanonicalTimestamp(value: unknown, now: Date): string {
  if (typeof value !== 'string') throw fail('EXPORT_TIMESTAMP_INVALID');
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.valueOf()) || timestamp.toISOString() !== value || timestamp.valueOf() > now.valueOf() + MAX_FUTURE_SKEW_MS) throw fail('EXPORT_TIMESTAMP_INVALID');
  return value;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
}

function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function safeSum(left: number, right: number, code: string): number {
  const sum = left + right;
  if (!Number.isSafeInteger(sum)) throw fail(code);
  return sum;
}

function fail(code: string): NurixMigrationIntakeError {
  // Static messages avoid echoing a potentially credential-bearing manifest.
  return new NurixMigrationIntakeError(code, 'Migration intake manifest was rejected safely.');
}
