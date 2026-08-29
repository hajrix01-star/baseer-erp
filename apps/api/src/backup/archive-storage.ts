import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, type ReadStream } from 'node:fs';
import { link, lstat, mkdir, open, readFile, rename, rm, writeFile, type FileHandle } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import { canonicalJson, sha256CanonicalJson } from './archive-canonical-json.js';
import { archiveChecksumsText, archivePath, assertSafeArchiveEntryPath, validateCompanyArchiveManifest, verifyArchivePayloadDirectory, verifyPublishedArchiveDirectory } from './archive-verifier.js';
import { ARCHIVE_CHECKSUMS_FILE, ARCHIVE_MANIFEST_FILE, ARCHIVE_PUBLISH_MARKER_FILE, ENCRYPTED_ARCHIVE_FILE_EXTENSION, type ArchivePublishMarker, type CompanyArchiveManifest, type EncryptedArchiveArtifact } from './archive.types.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/;

export type ArchiveStorageScope = Readonly<{ tenantId: string; companyId: string; jobId: string; workerLeaseFence: bigint }>;
export type PublishedArchive = Readonly<{ storageKey: string; rootPath: string; manifestSha256: string; publishedAt: string }>;
export type PrivateFinalizedArchive = Readonly<{ rootPath: string; manifestSha256: string; finalizedAt: string }>;
export type PendingEncryptedArchiveArtifact = Readonly<{ temporaryPath: string; artifactPath: string; storageKey: string }>;
export type ExistingEncryptedArchiveArtifact = Readonly<{ storageKey: string; artifactPath: string; modifiedAt: string }>;
export type VerifiedEncryptedArchiveDownload = Readonly<{
  storageKey: string;
  byteSize: bigint;
  sha256: string;
  /** Opens the already-verified encrypted container exactly once. */
  openReadStream: () => ReadStream;
  /** Closes the pinned descriptor if HTTP setup fails before streaming starts. */
  dispose: () => Promise<void>;
}>;

/**
 * Local-only storage for Gate 2.  Consumers are only handed published keys;
 * a directory becomes visible by an atomic rename after its final marker is
 * written. Staging paths are never valid download/import inputs.
 */
export class LocalArchiveStagingStorage {
  private readonly root: string;

  constructor(root = process.env.BASEER_BACKUP_ARCHIVE_STORAGE_ROOT) {
    if (!root?.trim()) throw new Error('BASEER_BACKUP_ARCHIVE_STORAGE_ROOT must be configured before company archives can be staged.');
    if (!isAbsolute(root)) throw new Error('BASEER_BACKUP_ARCHIVE_STORAGE_ROOT must be an absolute host path outside the application workspace.');
    this.root = resolve(root);
    if (isInside(resolve(process.cwd()), this.root)) throw new Error('BASEER_BACKUP_ARCHIVE_STORAGE_ROOT must be outside the application workspace and web root.');
  }

  async writeStageFile(scope: ArchiveStorageScope, entryPath: string, bytes: Buffer): Promise<{ sha256: string; byteSize: number }> {
    this.assertScope(scope);
    assertSafeArchiveEntryPath(entryPath);
    const target = this.stagePath(scope, entryPath);
    await mkdir(dirname(target), { recursive: true });
    await this.assertNoSymlinkComponents(this.stageRoot(scope), target);
    const digest = createHash('sha256').update(bytes).digest('hex');
    try {
      const existing = await readFile(target);
      if (existing.length === bytes.length && createHash('sha256').update(existing).digest('hex') === digest) return { sha256: digest, byteSize: bytes.length };
      throw new Error(`Staged archive entry already exists with different bytes: ${entryPath}`);
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
    const temporary = `${target}.part-${randomUUID()}`;
    try {
      await writeFile(temporary, bytes, { flag: 'wx' });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return { sha256: digest, byteSize: bytes.length };
  }

  /**
   * Completes controls inside the private staging directory only. This does
   * not rename plaintext into a published namespace; callers must pass the
   * result to ArchivePackager before a final artifact can exist.
   */
  async finalizePrivateStage(scope: ArchiveStorageScope, manifest: CompanyArchiveManifest, finalizedAt = new Date()): Promise<PrivateFinalizedArchive> {
    this.assertScope(scope);
    validateCompanyArchiveManifest(manifest);
    if (manifest.source.tenantId !== scope.tenantId) throw new TypeError('Archive manifest tenant does not match the storage scope.');
    if (!manifest.companies.some((company) => company.companyId === scope.companyId)) throw new TypeError('Archive manifest does not contain the storage-scope company.');
    const stageRoot = this.stageRoot(scope);
    await mkdir(stageRoot, { recursive: true });
    await this.assertNoSymlinkComponents(stageRoot, stageRoot);
    const verification = await verifyArchivePayloadDirectory(stageRoot, manifest);
    if (!verification.valid) throw new Error(`Archive cannot be published: ${verification.issues.map((issue) => issue.code).join(', ')}`);
    const manifestBytes = Buffer.from(canonicalJson(manifest), 'utf8');
    const manifestSha256 = sha256CanonicalJson(manifest);
    const marker: ArchivePublishMarker = { markerVersion: 1, archiveId: manifest.archiveId, manifestSha256, publishedAt: finalizedAt.toISOString() };
    await this.writeNewFile(stageRoot, ARCHIVE_MANIFEST_FILE, manifestBytes);
    await this.writeNewFile(stageRoot, ARCHIVE_CHECKSUMS_FILE, Buffer.from(archiveChecksumsText(manifest.files), 'utf8'));
    await this.writeNewFile(stageRoot, ARCHIVE_PUBLISH_MARKER_FILE, Buffer.from(canonicalJson(marker), 'utf8'));
    const finalVerification = await verifyPublishedArchiveDirectory(stageRoot);
    if (!finalVerification.valid) throw new Error(`Private finalized archive verification failed: ${finalVerification.issues.map((issue) => issue.code).join(', ')}`);
    return { rootPath: stageRoot, manifestSha256, finalizedAt: marker.publishedAt };
  }

  /** Plaintext publication is disabled; only encrypted artifacts may be final. */
  async publish(_scope: ArchiveStorageScope, _manifest: CompanyArchiveManifest, _publishedAt = new Date()): Promise<PublishedArchive> {
    throw new Error('Plaintext archive publication is disabled. Finalize the private stage and package an encrypted artifact instead.');
  }

  async verifyPublished(scope: ArchiveStorageScope) {
    this.assertScope(scope);
    return verifyPublishedArchiveDirectory(this.publishedRoot(scope));
  }

  /**
   * Returns a published artifact only after re-verifying the control marker,
   * manifest and every payload.  It lets a crashed worker finish database
   * bookkeeping without republishing or trusting a path merely because it
   * exists on disk.
   */
  async readPublished(scope: ArchiveStorageScope): Promise<PublishedArchive | undefined> {
    this.assertScope(scope);
    return undefined;
  }

  async readFinalizedPrivateStage(scope: ArchiveStorageScope): Promise<PrivateFinalizedArchive | undefined> {
    this.assertScope(scope);
    const rootPath = this.stageRoot(scope);
    const verification = await verifyPublishedArchiveDirectory(rootPath);
    if (!verification.valid || !verification.manifestSha256) return undefined;
    try {
      const marker: unknown = JSON.parse((await readFile(archivePath(rootPath, ARCHIVE_PUBLISH_MARKER_FILE))).toString('utf8'));
      if (!isPublishedMarker(marker) || marker.manifestSha256 !== verification.manifestSha256) return undefined;
      return { rootPath, manifestSha256: verification.manifestSha256, finalizedAt: marker.publishedAt };
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  async prepareEncryptedArtifact(scope: ArchiveStorageScope): Promise<PendingEncryptedArchiveArtifact> {
    this.assertScope(scope);
    const temporaryPath = resolve(this.root, '.artifact-staging', scope.tenantId, scope.companyId, scope.jobId, scope.workerLeaseFence.toString(), `${randomUUID()}.part`);
    const artifactPath = this.encryptedArtifactPath(scope);
    await mkdir(dirname(temporaryPath), { recursive: true });
    await this.assertNoSymlinkComponents(resolve(this.root, '.artifact-staging'), temporaryPath);
    await mkdir(dirname(artifactPath), { recursive: true });
    await this.assertNoSymlinkComponents(resolve(this.root, 'encrypted'), artifactPath);
    return { temporaryPath, artifactPath, storageKey: this.encryptedStorageKey(scope) };
  }

  async publishEncryptedArtifact(scope: ArchiveStorageScope, pending: PendingEncryptedArchiveArtifact, details: Omit<EncryptedArchiveArtifact, 'storageKey' | 'artifactPath'>): Promise<EncryptedArchiveArtifact> {
    this.assertScope(scope);
    if (pending.storageKey !== this.encryptedStorageKey(scope) || pending.artifactPath !== this.encryptedArtifactPath(scope) || !isInside(resolve(this.root, '.artifact-staging'), pending.temporaryPath)) {
      throw new TypeError('Encrypted artifact publish target is outside its storage scope.');
    }
    const staged = await lstat(pending.temporaryPath);
    if (!staged.isFile() || staged.isSymbolicLink() || BigInt(staged.size) !== details.byteSize) throw new Error('Encrypted artifact staging file is missing, not regular, or changed after verification.');
    // link(2) creates the final name atomically and fails with EEXIST. Unlike
    // rename, it has no replace semantics, so a late competing worker can
    // never overwrite a final artifact after our preflight check.
    await this.assertNoSymlinkComponents(resolve(this.root, 'encrypted'), pending.artifactPath);
    try { await link(pending.temporaryPath, pending.artifactPath); }
    catch (error) {
      if (isAlreadyExists(error)) throw new Error('An encrypted artifact already exists for this job fence.');
      throw error;
    }
    const finalInfo = await lstat(pending.artifactPath);
    if (!finalInfo.isFile() || finalInfo.isSymbolicLink() || BigInt(finalInfo.size) !== details.byteSize) throw new Error('Encrypted artifact changed during its final atomic publication.');
    // A crash here leaves only the caller-owned .part as an orphan; the final
    // hard link is complete and recovery verifies it before durable CAS.
    await rm(pending.temporaryPath, { force: true }).catch(() => undefined);
    return { storageKey: pending.storageKey, artifactPath: pending.artifactPath, ...details, createdAt: finalInfo.mtime.toISOString() };
  }

  /**
   * Recovery lookup for the narrow crash window after final encrypted rename
   * and before the worker's durable compare-and-set. The caller must still
   * cryptographically verify the returned file; existence is never validity.
   */
  async readEncryptedArtifact(scope: ArchiveStorageScope): Promise<ExistingEncryptedArchiveArtifact | undefined> {
    this.assertScope(scope);
    const artifactPath = this.encryptedArtifactPath(scope);
    try {
      await this.assertNoSymlinkComponents(resolve(this.root, 'encrypted'), artifactPath);
      const info = await lstat(artifactPath);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error('Encrypted artifact exists but is not a regular file.');
      return { storageKey: this.encryptedStorageKey(scope), artifactPath, modifiedAt: info.mtime.toISOString() };
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
  }

  /**
   * Download-only resolver.  It accepts a persisted storage key only after
   * proving that its canonical encrypted path belongs to this tenant/company/
   * job; it never accepts a client path or exposes one to its caller.
   */
  async resolveVerifiedEncryptedDownload(input: Readonly<{
    tenantId: string;
    companyId: string;
    jobId: string;
    storageKey: string;
    byteSize: bigint;
    sha256: string;
  }>): Promise<VerifiedEncryptedArchiveDownload> {
    if (!UUID.test(input.tenantId) || !UUID.test(input.companyId) || !UUID.test(input.jobId) || input.byteSize < 0n || !SHA256.test(input.sha256)) {
      throw new ArchiveStorageDownloadError('DOWNLOAD_ARTIFACT_METADATA_INVALID', 'The encrypted archive metadata is invalid.');
    }
    const scope = this.parseEncryptedStorageKey(input.storageKey);
    if (scope.tenantId !== input.tenantId || scope.companyId !== input.companyId || scope.jobId !== input.jobId) {
      throw new ArchiveStorageDownloadError('DOWNLOAD_STORAGE_SCOPE_MISMATCH', 'The encrypted archive storage key is outside the requested backup scope.');
    }
    const canonicalStorageKey = this.encryptedStorageKey(scope);
    if (input.storageKey !== canonicalStorageKey) {
      throw new ArchiveStorageDownloadError('DOWNLOAD_STORAGE_KEY_NONCANONICAL', 'The encrypted archive storage key is not canonical.');
    }
    const artifactPath = this.encryptedArtifactPath(scope);
    let file: FileHandle | undefined;
    try {
      await this.assertNoSymlinkComponents(resolve(this.root, 'encrypted'), artifactPath);
      file = await open(artifactPath, 'r');
      const openedInfo = await this.assertOpenedEncryptedDownloadFile(file, input.byteSize);
      const linkedPathInfo = await this.assertEncryptedDownloadFile(artifactPath, input.byteSize);
      if (!sameFileIdentity(openedInfo, linkedPathInfo)) {
        throw new ArchiveStorageDownloadError('DOWNLOAD_ARTIFACT_CHANGED', 'The encrypted archive changed while its download descriptor was opened.');
      }
      const digest = await digestOpenFile(file);
      const verifiedInfo = await this.assertOpenedEncryptedDownloadFile(file, input.byteSize);
      if (!sameFileIdentity(openedInfo, verifiedInfo)) {
        throw new ArchiveStorageDownloadError('DOWNLOAD_ARTIFACT_CHANGED', 'The encrypted archive changed while its download digest was verified.');
      }
      if (digest.byteSize !== input.byteSize || digest.sha256 !== input.sha256) {
        throw new ArchiveStorageDownloadError('DOWNLOAD_ARTIFACT_INTEGRITY_MISMATCH', 'The encrypted archive bytes do not match the verified artifact record.');
      }
      return pinnedDownload(canonicalStorageKey, input.byteSize, input.sha256, file);
    } catch (error) {
      await file?.close().catch(() => undefined);
      throw error;
    }
  }

  async discardStage(scope: ArchiveStorageScope): Promise<void> {
    this.assertScope(scope);
    await rm(this.stageRoot(scope), { recursive: true, force: true });
  }

  storageKey(scope: ArchiveStorageScope): string { this.assertScope(scope); return `published/${scope.tenantId}/${scope.companyId}/${scope.jobId}/${scope.workerLeaseFence.toString()}`; }
  stageRoot(scope: ArchiveStorageScope): string { this.assertScope(scope); return resolve(this.root, '.staging', scope.tenantId, scope.companyId, scope.jobId, scope.workerLeaseFence.toString()); }
  publishedRoot(scope: ArchiveStorageScope): string { this.assertScope(scope); return resolve(this.root, this.storageKey(scope)); }
  stagePath(scope: ArchiveStorageScope, entryPath: string): string { return archivePath(this.stageRoot(scope), entryPath); }
  encryptedStorageKey(scope: ArchiveStorageScope): string { this.assertScope(scope); return `encrypted/${scope.tenantId}/${scope.companyId}/${scope.jobId}/${scope.workerLeaseFence.toString()}${ENCRYPTED_ARCHIVE_FILE_EXTENSION}`; }
  encryptedArtifactPath(scope: ArchiveStorageScope): string { return resolve(this.root, this.encryptedStorageKey(scope)); }

  private parseEncryptedStorageKey(storageKey: string): ArchiveStorageScope {
    const match = /^encrypted\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/([1-9][0-9]*)\.bca$/.exec(storageKey);
    if (!match || !UUID.test(match[1] ?? '') || !UUID.test(match[2] ?? '') || !UUID.test(match[3] ?? '')) {
      throw new ArchiveStorageDownloadError('DOWNLOAD_STORAGE_KEY_INVALID', 'The encrypted archive storage key has an invalid format.');
    }
    let workerLeaseFence: bigint;
    try { workerLeaseFence = BigInt(match[4] ?? ''); }
    catch { throw new ArchiveStorageDownloadError('DOWNLOAD_STORAGE_KEY_INVALID', 'The encrypted archive storage key has an invalid worker fence.'); }
    return { tenantId: match[1]!, companyId: match[2]!, jobId: match[3]!, workerLeaseFence };
  }

  private async assertEncryptedDownloadFile(artifactPath: string, expectedByteSize: bigint) {
    await this.assertNoSymlinkComponents(resolve(this.root, 'encrypted'), artifactPath);
    let info: Awaited<ReturnType<typeof lstat>>;
    try { info = await lstat(artifactPath); }
    catch (error) {
      if (isMissing(error)) throw new ArchiveStorageDownloadError('DOWNLOAD_ARTIFACT_MISSING', 'The verified encrypted archive is no longer available.');
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink() || BigInt(info.size) !== expectedByteSize) {
      throw new ArchiveStorageDownloadError('DOWNLOAD_ARTIFACT_FILE_INVALID', 'The encrypted archive is not a regular file with its verified size.');
    }
    return info;
  }

  private async assertOpenedEncryptedDownloadFile(file: FileHandle, expectedByteSize: bigint) {
    const info = await file.stat();
    if (!info.isFile() || BigInt(info.size) !== expectedByteSize) {
      throw new ArchiveStorageDownloadError('DOWNLOAD_ARTIFACT_FILE_INVALID', 'The opened encrypted archive is not a regular file with its verified size.');
    }
    return info;
  }

  private async writeNewFile(root: string, entryPath: string, bytes: Buffer): Promise<void> {
    const target = archivePath(root, entryPath);
    await mkdir(dirname(target), { recursive: true });
    await this.assertNoSymlinkComponents(root, target);
    try { await writeFile(target, bytes, { flag: 'wx' }); }
    catch (error) {
      if (!isAlreadyExists(error)) throw error;
      const existing = await readFile(target);
      if (!existing.equals(bytes)) throw new Error(`Archive control file already exists with different bytes: ${entryPath}`);
    }
  }

  private assertScope(scope: ArchiveStorageScope): void {
    if (!UUID.test(scope.tenantId) || !UUID.test(scope.companyId) || !UUID.test(scope.jobId) || scope.workerLeaseFence < 1n) throw new TypeError('Archive storage scope contains an invalid identifier or lease fence.');
  }

  private async assertNoSymlinkComponents(root: string, target: string): Promise<void> {
    const resolvedRoot = resolve(root);
    const resolvedTarget = resolve(target);
    if (resolvedTarget !== resolvedRoot && !resolvedTarget.startsWith(`${resolvedRoot}${sep}`)) throw new TypeError('Archive storage path escapes its root.');
    const relative = resolvedTarget.slice(resolvedRoot.length).split(sep).filter(Boolean);
    let current = resolvedRoot;
    for (const part of relative) {
      current = resolve(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new TypeError('Symbolic links are not permitted in archive storage.'); }
      catch (error) { if (!isMissing(error)) throw error; }
    }
  }
}

function isMissing(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'ENOENT'; }
function isAlreadyExists(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === 'EEXIST'; }
function isInside(parent: string, candidate: string): boolean {
  const value = relative(parent, candidate);
  return value === '' || (!value.startsWith(`..${sep}`) && value !== '..' && !isAbsolute(value));
}
function isPublishedMarker(value: unknown): value is ArchivePublishMarker {
  return typeof value === 'object' && value !== null
    && (value as { markerVersion?: unknown }).markerVersion === 1
    && typeof (value as { archiveId?: unknown }).archiveId === 'string'
    && typeof (value as { manifestSha256?: unknown }).manifestSha256 === 'string'
    && typeof (value as { publishedAt?: unknown }).publishedAt === 'string'
    && !Number.isNaN(Date.parse((value as { publishedAt: string }).publishedAt));
}

async function digestOpenFile(file: FileHandle): Promise<Readonly<{ byteSize: bigint; sha256: string }>> {
  const hash = createHash('sha256');
  let byteSize = 0n;
  for await (const chunk of file.createReadStream({ start: 0, autoClose: false })) {
    const bytes = Buffer.from(chunk);
    hash.update(bytes);
    byteSize += BigInt(bytes.byteLength);
  }
  return { byteSize, sha256: hash.digest('hex') };
}

function sameFileIdentity(
  left: Readonly<{ dev: number; ino: number; size: number; mtimeMs: number }>,
  right: Readonly<{ dev: number; ino: number; size: number; mtimeMs: number }>,
): boolean {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

function pinnedDownload(storageKey: string, byteSize: bigint, sha256: string, file: FileHandle): VerifiedEncryptedArchiveDownload {
  let state: 'ready' | 'streaming' | 'closed' = 'ready';
  const dispose = async () => {
    if (state === 'closed') return;
    state = 'closed';
    await file.close().catch(() => undefined);
  };
  return {
    storageKey,
    byteSize,
    sha256,
    openReadStream: () => {
      if (state !== 'ready') throw new ArchiveStorageDownloadError('DOWNLOAD_STREAM_ALREADY_OPENED', 'An encrypted archive download stream may be opened only once.');
      state = 'streaming';
      try {
        const stream = file.createReadStream({ start: 0, autoClose: true });
        stream.once('close', () => { state = 'closed'; });
        return stream;
      } catch (error) {
        void dispose();
        throw error;
      }
    },
    dispose,
  };
}

export class ArchiveStorageDownloadError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ArchiveStorageDownloadError'; }
}
