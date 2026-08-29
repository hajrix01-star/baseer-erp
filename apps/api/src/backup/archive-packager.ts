import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, rm } from 'node:fs/promises';

import { ArchiveKeyProvider } from './archive-key-provider.js';
import { verifyEncryptedArchiveContainer, writeEncryptedArchiveContainer } from './archive-container.js';
import { LocalArchiveStagingStorage, type ArchiveStorageScope } from './archive-storage.js';
import { sha256CanonicalJson } from './archive-canonical-json.js';
import { verifyPublishedArchiveDirectory } from './archive-verifier.js';
import type { CompanyArchiveManifest, EncryptedArchiveArtifact } from './archive.types.js';

/**
 * Encryption-only primitive. It has no HTTP or database dependency and does
 * not delete either private plaintext staging or an existing final artifact.
 * Worker integration must fence its call and persist the returned artifact via
 * its own compare-and-set transaction.
 */
export class ArchivePackager {
  constructor(
    private readonly storage: LocalArchiveStagingStorage,
    private readonly keyProviderFactory: () => ArchiveKeyProvider = () => ArchiveKeyProvider.fromEnvironment(),
  ) {}

  async packageFinalizedPrivateStage(scope: ArchiveStorageScope, manifest: CompanyArchiveManifest): Promise<EncryptedArchiveArtifact> {
    const expectedManifestSha256 = sha256CanonicalJson(manifest);
    const keyProvider = this.keyProviderFactory();
    const existing = await this.storage.readEncryptedArtifact(scope);
    if (existing) {
      const verified = await verifyEncryptedArchiveContainer({ artifactPath: existing.artifactPath, expectedScope: scope, expectedManifest: manifest, keyProvider });
      if (!verified.valid || verified.manifestSha256 !== expectedManifestSha256) {
        throw new ArchivePackagingError('EXISTING_ENCRYPTED_ARTIFACT_INVALID', `Existing encrypted artifact failed recovery verification: ${verified.issues.map((issue) => issue.code).join(', ')}.`);
      }
      const digest = await fileDigest(existing.artifactPath);
      return {
        storageKey: existing.storageKey, artifactPath: existing.artifactPath,
        byteSize: digest.byteSize, sha256: digest.sha256,
        manifestSha256: expectedManifestSha256, createdAt: existing.modifiedAt,
      };
    }

    const finalized = await this.storage.readFinalizedPrivateStage(scope);
    if (!finalized || finalized.manifestSha256 !== expectedManifestSha256) {
      throw new ArchivePackagingError('PRIVATE_STAGE_NOT_FINALIZED', 'The plaintext archive staging directory is not finalized or does not match the expected manifest.');
    }
    const sourceVerification = await verifyPublishedArchiveDirectory(finalized.rootPath);
    if (!sourceVerification.valid || sourceVerification.manifestSha256 !== expectedManifestSha256) {
      throw new ArchivePackagingError('PRIVATE_STAGE_VERIFICATION_FAILED', 'The private plaintext staging directory failed verification before encryption.');
    }

    const pending = await this.storage.prepareEncryptedArtifact(scope);
    try {
      const written = await writeEncryptedArchiveContainer({ sourceRoot: finalized.rootPath, manifest, scope, keyProvider, targetPath: pending.temporaryPath });
      const verified = await verifyEncryptedArchiveContainer({ artifactPath: pending.temporaryPath, expectedScope: scope, expectedManifest: manifest, keyProvider });
      if (!verified.valid || verified.manifestSha256 !== expectedManifestSha256) {
        throw new ArchivePackagingError('ENCRYPTED_ARTIFACT_VERIFICATION_FAILED', `Encrypted artifact verification failed: ${verified.issues.map((issue) => issue.code).join(', ')}.`);
      }
      const afterVerification = await fileDigest(pending.temporaryPath);
      if (afterVerification.byteSize !== written.byteSize || afterVerification.sha256 !== written.sha256) {
        throw new ArchivePackagingError('ENCRYPTED_ARTIFACT_CHANGED', 'Encrypted artifact changed after encryption or verification.');
      }
      return this.storage.publishEncryptedArtifact(scope, pending, {
        byteSize: written.byteSize,
        sha256: written.sha256,
        manifestSha256: expectedManifestSha256,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      // This primitive owns only its unique .part. A failed package never
      // removes private plaintext staging or an existing final artifact.
      await rm(pending.temporaryPath, { force: true }).catch(() => undefined);
      if (error instanceof ArchivePackagingError) throw error;
      throw new ArchivePackagingError('ARCHIVE_PACKAGING_FAILED', error instanceof Error ? error.message : 'Archive packaging failed.');
    }
  }
}

async function fileDigest(path: string): Promise<Readonly<{ byteSize: bigint; sha256: string }>> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new ArchivePackagingError('ENCRYPTED_ARTIFACT_INVALID', 'Encrypted artifact is not a regular file.');
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  const stable = await lstat(path);
  if (!stable.isFile() || stable.isSymbolicLink() || stable.size !== info.size) throw new ArchivePackagingError('ENCRYPTED_ARTIFACT_CHANGED', 'Encrypted artifact changed while its digest was read.');
  return { byteSize: BigInt(info.size), sha256: hash.digest('hex') };
}

export class ArchivePackagingError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'ArchivePackagingError'; }
}
