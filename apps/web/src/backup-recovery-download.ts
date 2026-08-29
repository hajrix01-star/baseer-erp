import type { CompanyArchiveArtifactMetadata, CompanyArchiveMetadataReceipt } from "@baseer-erp/contracts";

type FilePickerAcceptType = Readonly<{
  description?: string;
  accept: Readonly<Record<string, readonly string[]>>;
}>;

type FileSystemWritableFileStreamLike = Readonly<{
  write: (data: Uint8Array) => Promise<void>;
  close: () => Promise<void>;
  abort: (reason?: unknown) => Promise<void>;
}>;

type FileSystemFileHandleLike = Readonly<{
  createWritable: (options?: Readonly<{ keepExistingData?: boolean }>) => Promise<FileSystemWritableFileStreamLike>;
}>;

type FilePickerWindow = Window & Readonly<{
  showSaveFilePicker?: (options: Readonly<{
    suggestedName: string;
    types: readonly FilePickerAcceptType[];
    excludeAcceptAllOption?: boolean;
  }>) => Promise<FileSystemFileHandleLike>;
}>;

export type EncryptedArchiveDownloadProgress = Readonly<{
  receivedBytes: bigint;
  totalBytes: bigint;
}>;

export type EncryptedArchiveDownloadInput = Readonly<{
  apiBaseUrl: string;
  bearerToken: string;
  companyId: string;
  jobId: string;
  /** Parsed trusted response from GET /backups/jobs/:jobId/archive-metadata. */
  metadata: CompanyArchiveMetadataReceipt & Readonly<{ artifact: CompanyArchiveArtifactMetadata }>;
  /** The caller sets this only after showing the partial-coverage warning and receiving confirmation. */
  partialCoverageAcknowledged: true;
  signal?: AbortSignal;
  onProgress?: (progress: EncryptedArchiveDownloadProgress) => void;
}>;

export type EncryptedArchiveDownloadResult = Readonly<{
  filename: string;
  byteSize: bigint;
  sha256: string;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

/**
 * Saves an already encrypted BCA response directly to a user-selected disk
 * file. It intentionally has no Blob/ObjectURL fallback: buffering a backup
 * in browser memory would defeat large-file recovery use cases.
 */
export async function downloadEncryptedCompanyArchive(input: EncryptedArchiveDownloadInput): Promise<EncryptedArchiveDownloadResult> {
  const artifact = validateInput(input);
  const expectedByteSize = parseByteSize(artifact.byteSize);
  const expectedFilename = artifact.filename;
  const expectedSha256 = artifact.sha256;
  const picker = typeof window === 'undefined' ? undefined : (window as FilePickerWindow).showSaveFilePicker;
  if (!picker) throw new BackupRecoveryDownloadError('FILE_SYSTEM_ACCESS_UNAVAILABLE', 'This browser cannot save encrypted backup archives directly to disk.');

  const fileHandle = await picker({
    suggestedName: expectedFilename,
    types: [{ description: 'Baseer encrypted company archive', accept: { 'application/octet-stream': ['.bca'] } }],
    excludeAcceptAllOption: true,
  });
  const writable = await fileHandle.createWritable({ keepExistingData: false });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let completed = false;
  try {
    const response = await fetch(`${input.apiBaseUrl.replace(/\/$/, '')}/backups/jobs/${encodeURIComponent(input.jobId)}/download`, {
      method: 'GET',
      cache: 'no-store',
      signal: input.signal,
      headers: {
        Accept: 'application/octet-stream',
        Authorization: `Bearer ${input.bearerToken}`,
        'X-Baseer-Company-Id': input.companyId,
        // The API rejects this partial archive unless the user explicitly
        // acknowledged the coverage warning in the UI before calling us.
        'X-Baseer-Archive-Coverage-Ack': input.metadata.archiveCoverage,
      },
    });
    validateDownloadResponse(response, expectedFilename, expectedByteSize, expectedSha256);
    if (!response.body) throw new BackupRecoveryDownloadError('DOWNLOAD_BODY_UNAVAILABLE', 'The encrypted archive response has no readable body.');

    const hasher = new StreamingSha256();
    let receivedBytes = 0n;
    reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      receivedBytes += BigInt(value.byteLength);
      if (receivedBytes > expectedByteSize) throw new BackupRecoveryDownloadError('DOWNLOAD_SIZE_EXCEEDED', 'The encrypted archive response exceeded its verified size.');
      hasher.update(value);
      await writable.write(value);
      input.onProgress?.({ receivedBytes, totalBytes: expectedByteSize });
    }
    if (receivedBytes !== expectedByteSize) throw new BackupRecoveryDownloadError('DOWNLOAD_SIZE_MISMATCH', 'The encrypted archive response ended before its verified size.');
    const sha256 = hasher.digestHex();
    if (sha256 !== expectedSha256) throw new BackupRecoveryDownloadError('DOWNLOAD_HASH_MISMATCH', 'The encrypted archive response does not match its verified SHA-256.');
    await writable.close();
    completed = true;
    return { filename: expectedFilename, byteSize: expectedByteSize, sha256 };
  } catch (error) {
    await reader?.cancel().catch(() => undefined);
    // File System Access keeps writes transactional until close; abort discards
    // a partial write where the browser implementation supports it.
    await writable.abort(error).catch(() => undefined);
    if (input.signal?.aborted && !(error instanceof BackupRecoveryDownloadError)) {
      throw new BackupRecoveryDownloadError('DOWNLOAD_ABORTED', 'The encrypted archive download was cancelled.');
    }
    throw error;
  } finally {
    if (!completed) await reader?.releaseLock();
  }
}

function validateInput(input: EncryptedArchiveDownloadInput): CompanyArchiveArtifactMetadata {
  if (!input.apiBaseUrl.trim() || !input.bearerToken.trim() || !UUID.test(input.companyId) || !UUID.test(input.jobId)) {
    throw new BackupRecoveryDownloadError('DOWNLOAD_INPUT_INVALID', 'The encrypted archive download request is invalid.');
  }
  if (input.partialCoverageAcknowledged !== true) {
    throw new BackupRecoveryDownloadError('PARTIAL_ARCHIVE_ACKNOWLEDGEMENT_REQUIRED', 'The partial archive coverage warning must be acknowledged before download.');
  }
  if (input.metadata.archiveCoverage !== 'PARTIAL_CONFIGURATION_ONLY' || input.metadata.restoreEligible !== false || !input.metadata.artifact) {
    throw new BackupRecoveryDownloadError('DOWNLOAD_METADATA_INELIGIBLE', 'The archive metadata is not eligible for partial encrypted download.');
  }
  const artifact = input.metadata.artifact;
  const byteSize = parseByteSize(artifact.byteSize);
  if (!isSafeBcaFilename(artifact.filename) || !SHA256.test(artifact.sha256) || artifact.format !== 'baseer-encrypted-company-archive/v1' || byteSize < 0n) {
    throw new BackupRecoveryDownloadError('DOWNLOAD_EXPECTATION_INVALID', 'The encrypted archive metadata is invalid.');
  }
  return artifact;
}

function validateDownloadResponse(response: Response, filename: string, expectedByteSize: bigint, expectedSha256: string): void {
  if (response.status !== 200) throw new BackupRecoveryDownloadError('DOWNLOAD_HTTP_STATUS', `The encrypted archive download returned HTTP ${response.status}.`);
  if (response.headers.has('content-range') || response.headers.get('accept-ranges')?.toLowerCase() !== 'none') {
    throw new BackupRecoveryDownloadError('DOWNLOAD_RANGE_UNEXPECTED', 'The encrypted archive download must be a complete non-range response.');
  }
  const contentType = response.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/octet-stream') throw new BackupRecoveryDownloadError('DOWNLOAD_CONTENT_TYPE_INVALID', 'The encrypted archive response has an unexpected content type.');
  const contentLength = response.headers.get('content-length');
  if (!contentLength || !/^\d+$/.test(contentLength) || BigInt(contentLength) !== expectedByteSize) {
    throw new BackupRecoveryDownloadError('DOWNLOAD_CONTENT_LENGTH_INVALID', 'The encrypted archive response length does not match its verified metadata.');
  }
  if (response.headers.get('x-archive-sha256') !== expectedSha256) {
    throw new BackupRecoveryDownloadError('DOWNLOAD_HASH_HEADER_INVALID', 'The encrypted archive response hash header does not match its verified metadata.');
  }
  const disposition = response.headers.get('content-disposition');
  if (disposition !== `attachment; filename="${filename}"`) {
    throw new BackupRecoveryDownloadError('DOWNLOAD_FILENAME_INVALID', 'The encrypted archive response filename does not match its verified metadata.');
  }
}

function parseByteSize(value: bigint | string): bigint {
  try {
    const parsed = typeof value === 'bigint' ? value : /^\d+$/.test(value) ? BigInt(value) : -1n;
    if (parsed < 0n) throw new Error();
    return parsed;
  } catch {
    throw new BackupRecoveryDownloadError('DOWNLOAD_EXPECTATION_INVALID', 'The encrypted archive byte size is invalid.');
  }
}

function isSafeBcaFilename(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,200}\.bca$/i.test(value) && !value.includes('..');
}

export class BackupRecoveryDownloadError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'BackupRecoveryDownloadError'; }
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Minimal incremental SHA-256 so a multi-gigabyte download never enters memory at once. */
class StreamingSha256 {
  private readonly state = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  private readonly words = new Uint32Array(64);
  private readonly pending = new Uint8Array(64);
  private pendingLength = 0;
  private byteLength = 0n;
  private finalized = false;

  update(value: Uint8Array): void {
    if (this.finalized) throw new BackupRecoveryDownloadError('DOWNLOAD_HASH_FINALIZED', 'The encrypted archive hash has already been finalized.');
    this.byteLength += BigInt(value.byteLength);
    let offset = 0;
    if (this.pendingLength > 0) {
      const copied = Math.min(64 - this.pendingLength, value.byteLength);
      this.pending.set(value.subarray(0, copied), this.pendingLength);
      this.pendingLength += copied;
      offset += copied;
      if (this.pendingLength === 64) { this.transform(this.pending); this.pendingLength = 0; }
    }
    while (offset + 64 <= value.byteLength) { this.transform(value.subarray(offset, offset + 64)); offset += 64; }
    if (offset < value.byteLength) { this.pending.set(value.subarray(offset), 0); this.pendingLength = value.byteLength - offset; }
  }

  digestHex(): string {
    if (this.finalized) throw new BackupRecoveryDownloadError('DOWNLOAD_HASH_FINALIZED', 'The encrypted archive hash has already been finalized.');
    this.finalized = true;
    const finalBlock = new Uint8Array(this.pendingLength < 56 ? 64 : 128);
    finalBlock.set(this.pending.subarray(0, this.pendingLength));
    finalBlock[this.pendingLength] = 0x80;
    let bitLength = this.byteLength * 8n;
    for (let index = finalBlock.byteLength - 1; index >= finalBlock.byteLength - 8; index -= 1) {
      finalBlock[index] = Number(bitLength & 0xffn);
      bitLength >>= 8n;
    }
    for (let offset = 0; offset < finalBlock.byteLength; offset += 64) this.transform(finalBlock.subarray(offset, offset + 64));
    return Array.from(this.state, (word) => word.toString(16).padStart(8, '0')).join('');
  }

  private transform(block: Uint8Array): void {
    for (let index = 0; index < 16; index += 1) {
      const offset = index * 4;
      this.words[index] = ((block[offset]! << 24) | (block[offset + 1]! << 16) | (block[offset + 2]! << 8) | block[offset + 3]!) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const left = this.words[index - 15]!;
      const right = this.words[index - 2]!;
      const sigma0 = ((left >>> 7) | (left << 25)) ^ ((left >>> 18) | (left << 14)) ^ (left >>> 3);
      const sigma1 = ((right >>> 17) | (right << 15)) ^ ((right >>> 19) | (right << 13)) ^ (right >>> 10);
      this.words[index] = (this.words[index - 16]! + sigma0 + this.words[index - 7]! + sigma1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = this.state;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = ((e! >>> 6) | (e! << 26)) ^ ((e! >>> 11) | (e! << 21)) ^ ((e! >>> 25) | (e! << 7));
      const choose = (e! & f!) ^ (~e! & g!);
      const temporary1 = (h! + sigma1 + choose + SHA256_CONSTANTS[index]! + this.words[index]!) >>> 0;
      const sigma0 = ((a! >>> 2) | (a! << 30)) ^ ((a! >>> 13) | (a! << 19)) ^ ((a! >>> 22) | (a! << 10));
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const temporary2 = (sigma0 + majority) >>> 0;
      h = g; g = f; f = e; e = (d! + temporary1) >>> 0; d = c; c = b; b = a; a = (temporary1 + temporary2) >>> 0;
    }
    this.state[0] = (this.state[0]! + a!) >>> 0; this.state[1] = (this.state[1]! + b!) >>> 0;
    this.state[2] = (this.state[2]! + c!) >>> 0; this.state[3] = (this.state[3]! + d!) >>> 0;
    this.state[4] = (this.state[4]! + e!) >>> 0; this.state[5] = (this.state[5]! + f!) >>> 0;
    this.state[6] = (this.state[6]! + g!) >>> 0; this.state[7] = (this.state[7]! + h!) >>> 0;
  }
}
