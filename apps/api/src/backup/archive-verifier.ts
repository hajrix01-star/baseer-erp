import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, stat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';

import { canonicalJson, sha256CanonicalJson } from './archive-canonical-json.js';
import {
  ARCHIVE_CHECKSUMS_FILE,
  ARCHIVE_MANIFEST_FILE,
  ARCHIVE_PUBLISH_MARKER_FILE,
  COMPANY_ARCHIVE_FORMAT_VERSION,
  type ArchiveFileDescriptor,
  type ArchivePublishMarker,
  type ArchiveVerificationIssue,
  type ArchiveVerificationResult,
  type CompanyArchiveManifest,
} from './archive.types.js';

const SHA256 = /^[a-f0-9]{64}$/;
const SAFE_ENTRY = /^(?:data|attachments)\/[A-Za-z0-9][A-Za-z0-9._/-]{0,480}$/;

export function assertSafeArchiveEntryPath(entryPath: string): void {
  if (!SAFE_ENTRY.test(entryPath) || entryPath.includes('\\') || entryPath.endsWith('/') || entryPath.split('/').some((part) => part === '' || part === '.' || part === '..')) {
    throw new TypeError(`Unsafe archive entry path: ${entryPath}`);
  }
  if (new Set<string>([ARCHIVE_MANIFEST_FILE, ARCHIVE_CHECKSUMS_FILE, ARCHIVE_PUBLISH_MARKER_FILE]).has(entryPath)) {
    throw new TypeError(`Reserved archive entry path: ${entryPath}`);
  }
}

export function validateCompanyArchiveManifest(value: unknown): asserts value is CompanyArchiveManifest {
  if (!isRecord(value) || value.archiveFormatVersion !== COMPANY_ARCHIVE_FORMAT_VERSION || !isUuid(value.archiveId) || !isRecord(value.source) ||
    !isNonEmptyString(value.source.applicationVersion) || !isNonEmptyString(value.source.schemaVersion) || !isUuid(value.source.tenantId) ||
    !isIsoDate(value.createdAt) || !Array.isArray(value.companies) || value.companies.length === 0 || !Array.isArray(value.files)) {
    throw new TypeError('The archive manifest is not a supported company archive manifest.');
  }
  const companyIds = new Set<string>();
  for (const company of value.companies) {
    if (!isRecord(company) || !isUuid(company.companyId) || !isNonEmptyString(company.nameAr) || !isNonEmptyString(company.nameEn) || !Array.isArray(company.modules) || companyIds.has(company.companyId)) throw new TypeError('The archive manifest contains an invalid company.');
    companyIds.add(company.companyId);
    const modules = new Set<string>();
    for (const module of company.modules) {
      if (!isRecord(module) || !isNonEmptyString(module.module) || !isSafeCount(module.recordCount) || modules.has(module.module)) throw new TypeError('The archive manifest contains an invalid module summary.');
      modules.add(module.module);
    }
  }
  const paths = new Set<string>();
  for (const file of value.files) {
    if (!isRecord(file) || !isNonEmptyString(file.path) || !isSafeCount(file.byteSize) || !isNonEmptyString(file.sha256) || !SHA256.test(file.sha256) || paths.has(file.path)) throw new TypeError('The archive manifest contains an invalid file descriptor.');
    assertSafeArchiveEntryPath(file.path);
    paths.add(file.path);
  }
  // Confirm it can be represented without undefined, Date, bigint, or cycles.
  canonicalJson(value);
}

export function archiveChecksumsText(files: readonly ArchiveFileDescriptor[]): string {
  const sorted = [...files].sort((left, right) => left.path.localeCompare(right.path));
  return sorted.map((file) => `${file.sha256}  ${file.path}\n`).join('');
}

export async function verifyArchiveDirectory(root: string, expectedManifest?: CompanyArchiveManifest): Promise<ArchiveVerificationResult> {
  const issues: ArchiveVerificationIssue[] = [];
  let manifest: CompanyArchiveManifest | undefined = expectedManifest;
  let manifestSha256: string | undefined;
  let verifiedFiles = 0;
  let verifiedBytes = 0;
  try {
    if (!manifest) {
      const manifestBytes = await readRegularFile(root, ARCHIVE_MANIFEST_FILE);
      const decoded: unknown = JSON.parse(manifestBytes.toString('utf8'));
      validateCompanyArchiveManifest(decoded);
      manifest = decoded;
      if (manifestBytes.toString('utf8') !== canonicalJson(manifest)) issues.push({ code: 'MANIFEST_NOT_CANONICAL', message: 'The manifest is not encoded in canonical JSON.' });
    } else {
      validateCompanyArchiveManifest(manifest);
    }
    manifestSha256 = sha256CanonicalJson(manifest);
    const expectedChecksums = archiveChecksumsText(manifest.files);
    const actualChecksums = await readRegularFile(root, ARCHIVE_CHECKSUMS_FILE);
    if (actualChecksums.toString('utf8') !== expectedChecksums) issues.push({ code: 'CHECKSUMS_MISMATCH', message: 'The checksum index does not match the manifest.' });
    const payload = await verifyArchivePayloadDirectory(root, manifest);
    issues.push(...payload.issues);
    verifiedFiles = payload.verifiedFiles;
    verifiedBytes = payload.verifiedBytes;
  } catch (error) {
    issues.push({ code: 'MANIFEST_UNREADABLE', message: error instanceof Error ? error.message : 'The archive manifest cannot be verified.' });
  }
  return { valid: issues.length === 0, ...(manifestSha256 ? { manifestSha256 } : {}), verifiedFiles, verifiedBytes, issues };
}

/** Verifies staged payloads before manifest/checksum control files are written. */
export async function verifyArchivePayloadDirectory(root: string, manifest: CompanyArchiveManifest): Promise<ArchiveVerificationResult> {
  const issues: ArchiveVerificationIssue[] = [];
  let verifiedFiles = 0;
  let verifiedBytes = 0;
  let manifestSha256: string | undefined;
  try {
    validateCompanyArchiveManifest(manifest);
    manifestSha256 = sha256CanonicalJson(manifest);
    const expectedPaths = new Set(manifest.files.map((file) => file.path));
    const actualPaths = await listRegularArchiveFiles(root);
    for (const actualPath of actualPaths) {
      if (!expectedPaths.has(actualPath) && !isControlFile(actualPath)) {
        issues.push({ code: 'UNDECLARED_PAYLOAD', path: actualPath, message: 'Archive storage contains a payload not declared by the manifest.' });
      }
    }
    for (const descriptor of manifest.files) {
      try {
        const bytes = await readRegularFile(root, descriptor.path);
        const digest = createHash('sha256').update(bytes).digest('hex');
        if (bytes.length !== descriptor.byteSize || digest !== descriptor.sha256) {
          issues.push({ code: 'PAYLOAD_MISMATCH', path: descriptor.path, message: 'Payload size or checksum does not match the manifest.' });
        } else {
          verifiedFiles += 1;
          verifiedBytes += bytes.length;
        }
      } catch {
        issues.push({ code: 'PAYLOAD_UNREADABLE', path: descriptor.path, message: 'A manifest payload cannot be read as a regular file.' });
      }
    }
  } catch (error) {
    issues.push({ code: 'MANIFEST_INVALID', message: error instanceof Error ? error.message : 'The archive manifest cannot be verified.' });
  }
  return { valid: issues.length === 0, ...(manifestSha256 ? { manifestSha256 } : {}), verifiedFiles, verifiedBytes, issues };
}

export async function verifyPublishedArchiveDirectory(root: string): Promise<ArchiveVerificationResult> {
  const verification = await verifyArchiveDirectory(root);
  if (!verification.valid || !verification.manifestSha256) return verification;
  const issues = [...verification.issues];
  try {
    const rawMarker = await readRegularFile(root, ARCHIVE_PUBLISH_MARKER_FILE);
    const marker: unknown = JSON.parse(rawMarker.toString('utf8'));
    if (!isPublishMarker(marker) || marker.manifestSha256 !== verification.manifestSha256) {
      issues.push({ code: 'PUBLISH_MARKER_INVALID', message: 'The final publish marker is absent, malformed, or points to another manifest.' });
    }
  } catch {
    issues.push({ code: 'PUBLISH_MARKER_MISSING', message: 'The archive has no readable final publish marker.' });
  }
  return { ...verification, valid: issues.length === 0, issues };
}

async function readRegularFile(root: string, relativePath: string): Promise<Buffer> {
  const fullPath = archivePath(root, relativePath);
  const info = await lstat(fullPath);
  if (!info.isFile() || info.isSymbolicLink()) throw new TypeError('Archive path is not a regular file.');
  const stable = await stat(fullPath);
  if (!stable.isFile() || stable.size !== info.size) throw new TypeError('Archive file changed while being read.');
  return readFile(fullPath);
}

/**
 * A checksum list alone is not enough: an attacker or interrupted process
 * could leave an undeclared payload beside valid files. Enumerate every file
 * beneath the archive root and reject any non-control entry absent from the
 * manifest. Directories and file entries must never be symbolic links.
 */
async function listRegularArchiveFiles(root: string, relative = ''): Promise<string[]> {
  const current = relative ? archivePath(root, relative) : resolve(root);
  const info = await lstat(current);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new TypeError('Archive root contains a non-directory or symbolic-link directory.');
  const entries = await readdir(current, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = relative ? `${relative}/${entry.name}` : entry.name;
    const fullPath = archivePath(root, entryPath);
    const entryInfo = await lstat(fullPath);
    if (entryInfo.isSymbolicLink()) throw new TypeError(`Archive contains a symbolic link: ${entryPath}`);
    if (entryInfo.isDirectory()) {
      files.push(...await listRegularArchiveFiles(root, entryPath));
      continue;
    }
    if (!entryInfo.isFile()) throw new TypeError(`Archive contains a non-regular file: ${entryPath}`);
    files.push(entryPath);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function isControlFile(entryPath: string): boolean {
  return entryPath === ARCHIVE_MANIFEST_FILE || entryPath === ARCHIVE_CHECKSUMS_FILE || entryPath === ARCHIVE_PUBLISH_MARKER_FILE;
}

export function archivePath(root: string, relativePath: string): string {
  const resolvedRoot = resolve(root);
  const fullPath = resolve(resolvedRoot, ...relativePath.split('/'));
  if (!fullPath.startsWith(`${resolvedRoot}${sep}`)) throw new TypeError('Archive path escapes its storage root.');
  return fullPath;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isNonEmptyString(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 500; }
function isSafeCount(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0; }
function isUuid(value: unknown): value is string { return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value); }
function isIsoDate(value: unknown): value is string { return typeof value === 'string' && Number.isFinite(Date.parse(value)); }
function isPublishMarker(value: unknown): value is ArchivePublishMarker { return isRecord(value) && value.markerVersion === 1 && isUuid(value.archiveId) && typeof value.manifestSha256 === 'string' && SHA256.test(value.manifestSha256) && isIsoDate(value.publishedAt); }
