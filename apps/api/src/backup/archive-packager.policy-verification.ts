/**
 * Focused no-secret smoke verification. Run after `npm run build --workspace
 * @baseer-erp/api` with `node apps/api/dist/backup/archive-packager.policy-verification.js`.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ArchiveKeyProvider } from './archive-key-provider.js';
import { verifyEncryptedArchiveContainer } from './archive-container.js';
import { ArchivePackager } from './archive-packager.js';
import { LocalArchiveStagingStorage, type ArchiveStorageScope, type PendingEncryptedArchiveArtifact } from './archive-storage.js';
import { sha256CanonicalJson } from './archive-canonical-json.js';
import type { CompanyArchiveManifest } from './archive.types.js';

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'baseer-archive-package-'));
  const scope: ArchiveStorageScope = {
    tenantId: '10000000-0000-4000-8000-000000000001', companyId: '20000000-0000-4000-8000-000000000001',
    jobId: '30000000-0000-4000-8000-000000000001', workerLeaseFence: 1n,
  };
  const keyBase64 = Buffer.alloc(32, 7).toString('base64');
  const rotatedKeyBase64 = Buffer.alloc(32, 8).toString('base64');
  const keyring = JSON.stringify({ activeKeyId: 'test-v1', keys: { 'test-v1': keyBase64 } });
  const rotatedKeyring = JSON.stringify({ activeKeyId: 'test-v2', keys: { 'test-v1': keyBase64, 'test-v2': rotatedKeyBase64 } });
  const storage = new LocalArchiveStagingStorage(root);
  try {
    assert.throws(() => ArchiveKeyProvider.fromEnvironment({}), /KEYRING/);
    assert.throws(() => ArchiveKeyProvider.fromEnvironment({ BASEER_ARCHIVE_KEK_KEYRING_V1: '{malformed' }), /strict JSON/);
    const manifest = await writeFinalizedStage(storage, scope);
    const packager = new ArchivePackager(storage, () => ArchiveKeyProvider.fromEnvironment({ BASEER_ARCHIVE_KEK_KEYRING_V1: keyring }));
    const artifact = await packager.packageFinalizedPrivateStage(scope, manifest);
    const recovered = await packager.packageFinalizedPrivateStage(scope, manifest);
    assert.equal(artifact.manifestSha256, sha256CanonicalJson(manifest));
    assert.deepEqual(recovered, artifact, 'A post-rename/pre-CAS retry must recover the verified final ciphertext, not encrypt a replacement.');
    assert.equal((await stat(artifact.artifactPath)).isFile(), true);
    const artifactBytes = await readFile(artifact.artifactPath);
    assert.equal(artifactBytes.includes(Buffer.from(keyBase64, 'utf8')), false, 'Artifact metadata must not contain the KEK text.');
    await assertTamperRejections(artifact.artifactPath, scope, manifest, keyring, root);
    const rotatedProvider = ArchiveKeyProvider.fromEnvironment({ BASEER_ARCHIVE_KEK_KEYRING_V1: rotatedKeyring });
    assert.equal((await verifyEncryptedArchiveContainer({ artifactPath: artifact.artifactPath, expectedScope: scope, expectedManifest: manifest, keyProvider: rotatedProvider })).valid, true, 'A rotated active v2 keyring must still read v1 artifacts when v1 is retained.');
    const unknownProvider = ArchiveKeyProvider.fromEnvironment({ BASEER_ARCHIVE_KEK_KEYRING_V1: JSON.stringify({ activeKeyId: 'test-v2', keys: { 'test-v2': rotatedKeyBase64 } }) });
    assert.equal((await verifyEncryptedArchiveContainer({ artifactPath: artifact.artifactPath, expectedScope: scope, expectedManifest: manifest, keyProvider: unknownProvider })).valid, false, 'An artifact with an unknown key id must fail closed.');
    assert.deepEqual(await new ArchivePackager(storage, () => rotatedProvider).packageFinalizedPrivateStage(scope, manifest), artifact, 'A rotated keyring must recover the existing v1 artifact without replacement.');
    await verifyTamperedFinalRecovery(storage, packager);
    await verifyAtomicNoReplace(storage);
    await verifySourceFailureCleanup(root, keyring);
    await assert.rejects(() => storage.publish(scope, manifest), /Plaintext archive publication is disabled/);
    console.log('Archive packager policy verification passed: encrypted artifact only, no-replace publication, AAD-bound keywrap, rotation, and tamper recovery protections.');
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function writeFinalizedStage(storage: LocalArchiveStagingStorage, scope: ArchiveStorageScope): Promise<CompanyArchiveManifest> {
  const payload = Buffer.from('{"id":"safe-record"}\n', 'utf8');
  const descriptor = await storage.writeStageFile(scope, 'data/company-profile.jsonl', payload);
  const manifest: CompanyArchiveManifest = {
    archiveFormatVersion: 'baseer-company-archive/v1', archiveId: scope.jobId, createdAt: '2026-08-27T00:00:00.000Z',
    source: { applicationVersion: 'test', schemaVersion: 'test', tenantId: scope.tenantId },
    companies: [{ companyId: scope.companyId, nameAr: 'اختبار', nameEn: 'Test', modules: [{ module: 'company', recordCount: 1 }] }],
    files: [{ path: 'data/company-profile.jsonl', ...descriptor }],
  };
  await storage.finalizePrivateStage(scope, manifest);
  return manifest;
}

async function assertTamperRejections(artifactPath: string, scope: ArchiveStorageScope, manifest: CompanyArchiveManifest, keyring: string, root: string): Promise<void> {
  const original = await readFile(artifactPath);
  const provider = ArchiveKeyProvider.fromEnvironment({ BASEER_ARCHIVE_KEK_KEYRING_V1: keyring });
  const cipherOffset = 12 + original.readUInt32BE(8);
  const variants: ReadonlyArray<Readonly<{ name: string; mutate: (bytes: Buffer) => void }>> = [
    { name: 'header', mutate: (bytes) => { bytes[0] = bytes[0]! ^ 1; } },
    { name: 'ciphertext', mutate: (bytes) => { bytes[cipherOffset] = bytes[cipherOffset]! ^ 1; } },
    { name: 'auth-tag', mutate: (bytes) => { bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1; } },
  ];
  for (const variant of variants) {
    const copyPath = join(root, `tamper-${variant.name}.bca`);
    const tampered = Buffer.from(original); variant.mutate(tampered); await writeFile(copyPath, tampered, { flag: 'wx' });
    assert.equal((await verifyEncryptedArchiveContainer({ artifactPath: copyPath, expectedScope: scope, expectedManifest: manifest, keyProvider: provider })).valid, false, `${variant.name} tampering must fail closed.`);
  }
  const wrongScope: ArchiveStorageScope = { ...scope, companyId: '20000000-0000-4000-8000-000000000099' };
  assert.equal((await verifyEncryptedArchiveContainer({ artifactPath, expectedScope: wrongScope, expectedManifest: manifest, keyProvider: provider })).valid, false, 'A wrong expected scope/AAD must fail closed.');
}

async function verifyTamperedFinalRecovery(storage: LocalArchiveStagingStorage, packager: ArchivePackager): Promise<void> {
  const scope: ArchiveStorageScope = { tenantId: '10000000-0000-4000-8000-000000000001', companyId: '20000000-0000-4000-8000-000000000001', jobId: '30000000-0000-4000-8000-000000000002', workerLeaseFence: 1n };
  const manifest = await writeFinalizedStage(storage, scope);
  const artifact = await packager.packageFinalizedPrivateStage(scope, manifest);
  const tampered = Buffer.from(await readFile(artifact.artifactPath)); tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1; await writeFile(artifact.artifactPath, tampered);
  await assert.rejects(
    () => packager.packageFinalizedPrivateStage(scope, manifest),
    (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'EXISTING_ENCRYPTED_ARTIFACT_INVALID',
  );
  assert.deepEqual(await readFile(artifact.artifactPath), tampered, 'Invalid existing final ciphertext must not be replaced during recovery.');
  assert.equal((await stat(artifact.artifactPath)).isFile(), true);
  assert.equal((await readFile(artifact.artifactPath)).equals(Buffer.from(tampered)), true);
}

async function verifyAtomicNoReplace(storage: LocalArchiveStagingStorage): Promise<void> {
  const scope: ArchiveStorageScope = { tenantId: '10000000-0000-4000-8000-000000000001', companyId: '20000000-0000-4000-8000-000000000001', jobId: '30000000-0000-4000-8000-000000000003', workerLeaseFence: 1n };
  const first = await storage.prepareEncryptedArtifact(scope);
  const second = await storage.prepareEncryptedArtifact(scope);
  const left = Buffer.from('first-candidate'); const right = Buffer.from('second-candidate');
  await writeFile(first.temporaryPath, left, { flag: 'wx' }); await writeFile(second.temporaryPath, right, { flag: 'wx' });
  const details = (bytes: Buffer) => ({ byteSize: BigInt(bytes.byteLength), sha256: createHash('sha256').update(bytes).digest('hex'), manifestSha256: 'a'.repeat(64), createdAt: '2026-08-27T00:00:00.000Z' });
  const results = await Promise.allSettled([storage.publishEncryptedArtifact(scope, first, details(left)), storage.publishEncryptedArtifact(scope, second, details(right))]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1, 'Concurrent final publication must have exactly one winner.');
  const finalBytes = await readFile(storage.encryptedArtifactPath(scope));
  assert.equal(finalBytes.equals(left) || finalBytes.equals(right), true, 'The final artifact must be byte-identical to one candidate.');
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected && /already exists/.test(String(rejected.reason)), 'The losing no-replace publication must reject.');
}

/**
 * Deterministic source-error seam: the test storage removes an already
 * verified source only after package preflight and immediately before record
 * streaming. It proves pipeline rejection reaches packager cleanup.
 */
async function verifySourceFailureCleanup(root: string, keyring: string): Promise<void> {
  const scope: ArchiveStorageScope = { tenantId: '10000000-0000-4000-8000-000000000001', companyId: '20000000-0000-4000-8000-000000000001', jobId: '30000000-0000-4000-8000-000000000004', workerLeaseFence: 1n };
  const storage = new SourceFailureStorage(root);
  const manifest = await writeFinalizedStage(storage, scope);
  const packager = new ArchivePackager(storage, () => ArchiveKeyProvider.fromEnvironment({ BASEER_ARCHIVE_KEK_KEYRING_V1: keyring }));
  await assert.rejects(
    () => packager.packageFinalizedPrivateStage(scope, manifest),
    (error: unknown) => typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'ARCHIVE_PACKAGING_FAILED',
  );
  assert.ok(storage.lastPending, 'The test seam must reach encrypted .part allocation before the injected source error.');
  await assert.rejects(() => stat(storage.lastPending!.temporaryPath), { code: 'ENOENT' }, 'A source read failure must remove its owned .part.');
  assert.equal(await storage.readEncryptedArtifact(scope), undefined, 'A source read failure must not publish a final artifact.');
}

class SourceFailureStorage extends LocalArchiveStagingStorage {
  lastPending: PendingEncryptedArchiveArtifact | undefined;

  override async prepareEncryptedArtifact(scope: ArchiveStorageScope): Promise<PendingEncryptedArchiveArtifact> {
    const pending = await super.prepareEncryptedArtifact(scope);
    this.lastPending = pending;
    await rm(this.stagePath(scope, 'data/company-profile.jsonl'));
    return pending;
  }
}

void main();
