import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';

import { canonicalJson, sha256CanonicalJson } from './archive-canonical-json.js';
import { ArchiveKeyProvider } from './archive-key-provider.js';
import { archiveChecksumsText, archivePath, assertSafeArchiveEntryPath, validateCompanyArchiveManifest } from './archive-verifier.js';
import {
  ARCHIVE_CHECKSUMS_FILE,
  ARCHIVE_MANIFEST_FILE,
  ENCRYPTED_ARCHIVE_FORMAT_VERSION,
  ENCRYPTED_ARCHIVE_MAGIC,
  type ArchiveEncryptionScope,
  type CompanyArchiveManifest,
  type EncryptedArchiveHeader,
  type WrappedArchiveDataKey,
} from './archive.types.js';

const MAGIC = Buffer.from(ENCRYPTED_ARCHIVE_MAGIC, 'ascii');
const RECORD_MAGIC = Buffer.from('BSAR0001', 'ascii');
const PREFIX_BYTES = MAGIC.byteLength + 4;
const GCM_TAG_BYTES = 16;
const MAX_HEADER_BYTES = 32 * 1024;
const MAX_RECORD_HEADER_BYTES = 4 * 1024;
const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024 * 1024;
const SHA256 = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type EncryptedContainerWriteResult = Readonly<{
  header: EncryptedArchiveHeader;
  byteSize: bigint;
  sha256: string;
}>;

export type EncryptedContainerVerification = Readonly<{
  valid: boolean;
  manifestSha256?: string;
  verifiedFiles: number;
  verifiedBytes: number;
  issues: readonly Readonly<{ code: string; message: string }>[];
}>;

/**
 * Writes gzip-compressed record frames straight into AES-GCM ciphertext. No
 * plaintext archive file is ever created: staging remains the only plaintext
 * source and the caller owns its lifecycle.
 */
export async function writeEncryptedArchiveContainer(input: Readonly<{
  sourceRoot: string;
  manifest: CompanyArchiveManifest;
  scope: ArchiveEncryptionScope;
  keyProvider: ArchiveKeyProvider;
  targetPath: string;
}>): Promise<EncryptedContainerWriteResult> {
  validateCompanyArchiveManifest(input.manifest);
  const manifestSha256 = sha256CanonicalJson(input.manifest);
  const dataEncryptionKey = input.keyProvider.createDataEncryptionKey();
  const wrappedDataKey = input.keyProvider.wrapDataEncryptionKey(dataEncryptionKey, input.scope, manifestSha256);
  const header = createHeader(input.scope, manifestSha256, randomBytes(12), wrappedDataKey);
  const headerBytes = Buffer.from(canonicalJson(header), 'utf8');
  if (headerBytes.byteLength > MAX_HEADER_BYTES) throw new ArchiveContainerError('HEADER_TOO_LARGE', 'Encrypted archive header exceeds its bounded size.');

  const file = await open(input.targetPath, 'wx', 0o600);
  const hash = createHash('sha256');
  let byteSize = 0n;
  try {
    const prefix = Buffer.alloc(PREFIX_BYTES);
    MAGIC.copy(prefix, 0);
    prefix.writeUInt32BE(headerBytes.byteLength, MAGIC.byteLength);
    await writeAll(file, prefix); hash.update(prefix); byteSize += BigInt(prefix.byteLength);
    await writeAll(file, headerBytes); hash.update(headerBytes); byteSize += BigInt(headerBytes.byteLength);

    const iv = Buffer.from(header.payloadIvBase64, 'base64');
    const cipher = createCipheriv('aes-256-gcm', dataEncryptionKey, iv, { authTagLength: GCM_TAG_BYTES });
    cipher.setAAD(headerBytes);
    const gzip = createGzip({ level: 9 });
    const source = Readable.from(createArchiveRecordStream(input.sourceRoot, input.manifest));
    const ciphertextSink = new FileHandleSink(file, (bytes) => { hash.update(bytes); byteSize += BigInt(bytes.byteLength); });
    // pipeline owns error propagation and teardown for *every* source,
    // compression, encryption, and file-sink failure. A `for await` loop over
    // cipher alone can miss a source/gzip error and leave an orphaned writer.
    await pipeline(source, gzip, cipher, ciphertextSink);
    const authTag = cipher.getAuthTag();
    await writeAll(file, authTag); hash.update(authTag); byteSize += BigInt(authTag.byteLength);
    await file.sync();
    return { header, byteSize, sha256: hash.digest('hex') };
  } finally {
    dataEncryptionKey.fill(0);
    await file.close();
  }
}

/** Full streaming verification before an encrypted .part can be atomically published. */
export async function verifyEncryptedArchiveContainer(input: Readonly<{
  artifactPath: string;
  expectedScope: ArchiveEncryptionScope;
  expectedManifest: CompanyArchiveManifest;
  keyProvider: ArchiveKeyProvider;
}>): Promise<EncryptedContainerVerification> {
  const issues: Array<Readonly<{ code: string; message: string }>> = [];
  let verifier: RecordVerifier | undefined;
  try {
    validateCompanyArchiveManifest(input.expectedManifest);
    const expectedManifestSha256 = sha256CanonicalJson(input.expectedManifest);
    const { header, headerBytes, ciphertextStart, ciphertextEnd, authTag } = await readEncryptedHeader(input.artifactPath);
    assertHeaderMatches(header, input.expectedScope, expectedManifestSha256);
    const dataEncryptionKey = input.keyProvider.unwrapDataEncryptionKey(header.wrappedDataKey, input.expectedScope, expectedManifestSha256);
    try {
      const decipher = createDecipheriv('aes-256-gcm', dataEncryptionKey, Buffer.from(header.payloadIvBase64, 'base64'), { authTagLength: GCM_TAG_BYTES });
      decipher.setAAD(headerBytes);
      decipher.setAuthTag(authTag);
      const gunzip = createGunzip();
      verifier = new RecordVerifier(input.expectedManifest);
      await pipeline(createReadStream(input.artifactPath, { start: ciphertextStart, end: ciphertextEnd }), decipher, gunzip, verifier);
      verifier.complete();
    } finally {
      dataEncryptionKey.fill(0);
    }
    return { valid: true, manifestSha256: expectedManifestSha256, verifiedFiles: verifier.verifiedFiles, verifiedBytes: verifier.verifiedBytes, issues };
  } catch (error) {
    issues.push({ code: error instanceof ArchiveContainerError ? error.code : 'CONTAINER_VERIFICATION_FAILED', message: error instanceof Error ? error.message : 'Encrypted archive verification failed.' });
    return { valid: false, ...(verifier ? { verifiedFiles: verifier.verifiedFiles, verifiedBytes: verifier.verifiedBytes } : { verifiedFiles: 0, verifiedBytes: 0 }), issues };
  }
}

function createHeader(scope: ArchiveEncryptionScope, manifestSha256: string, payloadIv: Buffer, wrappedDataKey: WrappedArchiveDataKey): EncryptedArchiveHeader {
  if (payloadIv.length !== 12) throw new ArchiveContainerError('PAYLOAD_IV_INVALID', 'Payload IV must be 12 bytes.');
  return {
    magic: ENCRYPTED_ARCHIVE_MAGIC, version: ENCRYPTED_ARCHIVE_FORMAT_VERSION,
    scope: { tenantId: scope.tenantId, companyId: scope.companyId, jobId: scope.jobId, workerLeaseFence: scope.workerLeaseFence.toString() },
    manifestSha256, compression: 'gzip', payloadEncryption: 'AES-256-GCM', payloadIvBase64: payloadIv.toString('base64'), wrappedDataKey,
  };
}

async function readEncryptedHeader(path: string): Promise<Readonly<{ header: EncryptedArchiveHeader; headerBytes: Buffer; ciphertextStart: number; ciphertextEnd: number; authTag: Buffer }>> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_ARTIFACT_BYTES || info.size < PREFIX_BYTES + GCM_TAG_BYTES + 2) throw new ArchiveContainerError('CONTAINER_FILE_INVALID', 'Encrypted archive file is missing, not regular, or outside size limits.');
  const file = await open(path, 'r');
  try {
    const prefix = Buffer.alloc(PREFIX_BYTES);
    await file.read(prefix, 0, PREFIX_BYTES, 0);
    if (!prefix.subarray(0, MAGIC.byteLength).equals(MAGIC)) throw new ArchiveContainerError('CONTAINER_MAGIC_INVALID', 'Encrypted archive magic is invalid.');
    const headerLength = prefix.readUInt32BE(MAGIC.byteLength);
    if (headerLength < 2 || headerLength > MAX_HEADER_BYTES || PREFIX_BYTES + headerLength + GCM_TAG_BYTES >= info.size) throw new ArchiveContainerError('CONTAINER_HEADER_LENGTH_INVALID', 'Encrypted archive header length is invalid.');
    const headerBytes = Buffer.alloc(headerLength);
    await file.read(headerBytes, 0, headerLength, PREFIX_BYTES);
    let decoded: unknown;
    try { decoded = JSON.parse(headerBytes.toString('utf8')); } catch { throw new ArchiveContainerError('CONTAINER_HEADER_INVALID', 'Encrypted archive header is not JSON.'); }
    if (canonicalJson(decoded) !== headerBytes.toString('utf8') || !isHeader(decoded)) throw new ArchiveContainerError('CONTAINER_HEADER_INVALID', 'Encrypted archive header is not a supported canonical envelope.');
    const authTag = Buffer.alloc(GCM_TAG_BYTES);
    await file.read(authTag, 0, GCM_TAG_BYTES, info.size - GCM_TAG_BYTES);
    return { header: decoded, headerBytes, ciphertextStart: PREFIX_BYTES + headerLength, ciphertextEnd: info.size - GCM_TAG_BYTES - 1, authTag };
  } finally { await file.close(); }
}

function createArchiveRecordStream(sourceRoot: string, manifest: CompanyArchiveManifest): AsyncIterable<Buffer> {
  const records = expectedRecords(manifest);
  return (async function* (): AsyncGenerator<Buffer> {
    yield RECORD_MAGIC;
    for (const record of records) {
      const recordHeader = Buffer.from(canonicalJson({ type: 'file', path: record.path, byteSize: record.byteSize, sha256: record.sha256 }), 'utf8');
      if (recordHeader.byteLength > MAX_RECORD_HEADER_BYTES) throw new ArchiveContainerError('RECORD_HEADER_TOO_LARGE', 'Archive record header exceeds its bounded size.');
      const length = Buffer.alloc(4); length.writeUInt32BE(recordHeader.byteLength);
      yield length; yield recordHeader;
      if (record.virtualBytes) { yield record.virtualBytes; continue; }
      assertSafeArchiveEntryPath(record.path);
      for await (const chunk of createReadStream(archivePath(sourceRoot, record.path))) yield Buffer.from(chunk);
    }
    const endHeader = Buffer.from(canonicalJson({ type: 'end' }), 'utf8');
    const endLength = Buffer.alloc(4); endLength.writeUInt32BE(endHeader.byteLength);
    yield endLength; yield endHeader;
  })();
}

type ExpectedRecord = Readonly<{ path: string; byteSize: number; sha256: string; virtualBytes?: Buffer }>;
function expectedRecords(manifest: CompanyArchiveManifest): readonly ExpectedRecord[] {
  const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8');
  const checksumsBytes = Buffer.from(archiveChecksumsText(manifest.files), 'utf8');
  return [
    { path: ARCHIVE_MANIFEST_FILE, byteSize: manifestBytes.byteLength, sha256: createHash('sha256').update(manifestBytes).digest('hex'), virtualBytes: manifestBytes },
    { path: ARCHIVE_CHECKSUMS_FILE, byteSize: checksumsBytes.byteLength, sha256: createHash('sha256').update(checksumsBytes).digest('hex'), virtualBytes: checksumsBytes },
    ...[...manifest.files].sort((left, right) => left.path.localeCompare(right.path)),
  ];
}

class RecordVerifier extends Writable {
  private pending: Buffer = Buffer.alloc(0);
  private recordIndex = -1;
  private remaining = 0;
  private digest: ReturnType<typeof createHash> | undefined;
  private readonly records: readonly ExpectedRecord[];
  private sawMagic = false;
  private sawEnd = false;
  verifiedFiles = 0;
  verifiedBytes = 0;

  constructor(manifest: CompanyArchiveManifest) { super(); this.records = expectedRecords(manifest); }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    try { this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]); this.consume(); callback(); }
    catch (error) { callback(error instanceof Error ? error : new Error('Archive record verification failed.')); }
  }

  complete(): void {
    if (!this.sawMagic || !this.sawEnd || this.pending.length !== 0 || this.remaining !== 0 || this.recordIndex !== this.records.length - 1) throw new ArchiveContainerError('RECORD_STREAM_INCOMPLETE', 'Encrypted archive record stream is incomplete or has trailing bytes.');
  }

  private consume(): void {
    if (!this.sawMagic) {
      if (this.pending.length < RECORD_MAGIC.byteLength) return;
      if (!this.take(RECORD_MAGIC.byteLength).equals(RECORD_MAGIC)) throw new ArchiveContainerError('RECORD_MAGIC_INVALID', 'Encrypted archive payload record magic is invalid.');
      this.sawMagic = true;
    }
    while (true) {
      if (this.remaining > 0) {
        if (this.pending.length === 0) return;
        const bytes = this.take(Math.min(this.remaining, this.pending.length));
        this.digest?.update(bytes); this.remaining -= bytes.byteLength;
        if (this.remaining > 0) return;
        const expected = this.records[this.recordIndex];
        if (!expected || this.digest?.digest('hex') !== expected.sha256) throw new ArchiveContainerError('RECORD_CHECKSUM_INVALID', 'Encrypted archive record checksum does not match the manifest.');
        this.verifiedFiles += 1; this.verifiedBytes += expected.byteSize; this.digest = undefined;
        continue;
      }
      if (this.pending.length < 4) return;
      const headerLength = this.pending.readUInt32BE(0);
      if (headerLength < 2 || headerLength > MAX_RECORD_HEADER_BYTES) throw new ArchiveContainerError('RECORD_HEADER_LENGTH_INVALID', 'Encrypted archive record header length is invalid.');
      if (this.pending.length < 4 + headerLength) return;
      this.take(4);
      const headerBytes = this.take(headerLength);
      let header: unknown;
      try { header = JSON.parse(headerBytes.toString('utf8')); } catch { throw new ArchiveContainerError('RECORD_HEADER_INVALID', 'Encrypted archive record header is not JSON.'); }
      if (canonicalJson(header) !== headerBytes.toString('utf8')) throw new ArchiveContainerError('RECORD_HEADER_INVALID', 'Encrypted archive record header is not canonical.');
      if (isEndHeader(header)) {
        if (this.sawEnd || this.recordIndex !== this.records.length - 1) throw new ArchiveContainerError('RECORD_END_INVALID', 'Encrypted archive record stream ended unexpectedly.');
        this.sawEnd = true;
        if (this.pending.length > 0) throw new ArchiveContainerError('RECORD_TRAILING_BYTES', 'Encrypted archive record stream contains trailing bytes.');
        return;
      }
      const expected = this.records[++this.recordIndex];
      if (!expected || !isFileHeader(header) || canonicalJson(header) !== canonicalJson({ type: 'file', path: expected.path, byteSize: expected.byteSize, sha256: expected.sha256 })) {
        throw new ArchiveContainerError('RECORD_DESCRIPTOR_INVALID', 'Encrypted archive record descriptor does not match the expected manifest.');
      }
      this.remaining = expected.byteSize; this.digest = createHash('sha256');
      if (this.remaining === 0) {
        if (this.digest.digest('hex') !== expected.sha256) throw new ArchiveContainerError('RECORD_CHECKSUM_INVALID', 'Zero-byte encrypted archive record checksum is invalid.');
        this.verifiedFiles += 1; this.recordIndex += 0; this.digest = undefined;
      }
    }
  }

  private take(length: number): Buffer { const value = this.pending.subarray(0, length); this.pending = this.pending.subarray(length); return value; }
}

/** A pipeline sink that deliberately leaves the parent FileHandle open for the final GCM tag. */
class FileHandleSink extends Writable {
  constructor(
    private readonly file: Awaited<ReturnType<typeof open>>,
    private readonly onBytes: (bytes: Buffer) => void,
  ) { super(); }

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    const bytes = Buffer.from(chunk);
    void writeAll(this.file, bytes).then(
      () => { this.onBytes(bytes); callback(); },
      (error: unknown) => callback(error instanceof Error ? error : new Error('Encrypted archive output write failed.')),
    );
  }
}

function assertHeaderMatches(header: EncryptedArchiveHeader, scope: ArchiveEncryptionScope, manifestSha256: string): void {
  if (header.manifestSha256 !== manifestSha256 || header.scope.tenantId !== scope.tenantId || header.scope.companyId !== scope.companyId || header.scope.jobId !== scope.jobId || header.scope.workerLeaseFence !== scope.workerLeaseFence.toString()) {
    throw new ArchiveContainerError('CONTAINER_SCOPE_MISMATCH', 'Encrypted archive envelope does not match its tenant, company, job, lease fence, or manifest.');
  }
}

function isHeader(value: unknown): value is EncryptedArchiveHeader {
  if (!isRecord(value) || value.magic !== ENCRYPTED_ARCHIVE_MAGIC || value.version !== ENCRYPTED_ARCHIVE_FORMAT_VERSION || value.compression !== 'gzip' || value.payloadEncryption !== 'AES-256-GCM' || !SHA256.test(String(value.manifestSha256)) || !isRecord(value.scope) || !UUID.test(String(value.scope.tenantId)) || !UUID.test(String(value.scope.companyId)) || !UUID.test(String(value.scope.jobId)) || !/^\d+$/.test(String(value.scope.workerLeaseFence)) || !isCanonicalBase64(String(value.payloadIvBase64), 12) || !isWrappedKey(value.wrappedDataKey)) return false;
  return Object.keys(value).length === 8 && Object.keys(value.scope).length === 4;
}
function isWrappedKey(value: unknown): value is WrappedArchiveDataKey {
  return isRecord(value) && Object.keys(value).length === 5 && value.algorithm === 'AES-256-GCM' && typeof value.keyId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(value.keyId) && isCanonicalBase64(String(value.ivBase64), 12) && isCanonicalBase64(String(value.authTagBase64), 16) && isCanonicalBase64(String(value.ciphertextBase64), 32);
}
function isFileHeader(value: unknown): value is Readonly<{ type: 'file'; path: string; byteSize: number; sha256: string }> { return isRecord(value) && Object.keys(value).length === 4 && value.type === 'file' && typeof value.path === 'string' && Number.isSafeInteger(value.byteSize) && Number(value.byteSize) >= 0 && typeof value.sha256 === 'string'; }
function isEndHeader(value: unknown): boolean { return isRecord(value) && Object.keys(value).length === 1 && value.type === 'end'; }
function isCanonicalBase64(value: string, length: number): boolean { try { const decoded = Buffer.from(value, 'base64'); return decoded.length === length && decoded.toString('base64') === value; } catch { return false; } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
async function writeAll(file: Awaited<ReturnType<typeof open>>, bytes: Buffer): Promise<void> { let offset = 0; while (offset < bytes.byteLength) { const { bytesWritten } = await file.write(bytes, offset, bytes.byteLength - offset, null); if (bytesWritten <= 0) throw new ArchiveContainerError('CONTAINER_WRITE_FAILED', 'Encrypted archive output stopped accepting bytes.'); offset += bytesWritten; } }
export class ArchiveContainerError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ArchiveContainerError'; }
}
