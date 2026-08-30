import { ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { link, mkdir, open, readFile, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';

type ExistingArtifact = Readonly<{ storageReference: string | null; encryptionIv: string | null; storedByteSize: bigint | null }>;
export type NurixExcelStagingArtifact = Readonly<{ storageReference: string; encryptionIv: string; storedByteSize: bigint }>;

/**
 * Stores only the source workbook required to resume a verified migration.
 * The file is AES-256-GCM encrypted before it reaches disk; its plaintext
 * checksum remains the server-computed package checksum held in the database.
 */
@Injectable()
export class NurixExcelStagingStorageService {
  private readonly root = resolve(process.env.BASEER_NURIX_MIGRATION_STORAGE_ROOT ?? 'storage/nurix-migration');

  async store(input: Readonly<{ tenantId: string; packageId: string; workbookSha256: string; bytes: Buffer; existing: ExistingArtifact }>): Promise<NurixExcelStagingArtifact> {
    const reference = input.existing.storageReference ?? `packages/${input.tenantId}/${input.packageId}.bin`;
    if (input.existing.storageReference || input.existing.encryptionIv || input.existing.storedByteSize !== null) {
      if (!input.existing.storageReference || !input.existing.encryptionIv || input.existing.storedByteSize === null) throw new ConflictException('The staged workbook artifact metadata is incomplete.');
      const restored = this.decrypt(await readFile(this.path(reference)), input.existing.encryptionIv);
      this.assertMatch(restored, input.bytes, input.workbookSha256);
      return { storageReference: reference, encryptionIv: input.existing.encryptionIv, storedByteSize: input.existing.storedByteSize };
    }
    this.assertMatch(input.bytes, input.bytes, input.workbookSha256);
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key(), iv);
    const ciphertext = Buffer.concat([cipher.update(input.bytes), cipher.final(), cipher.getAuthTag()]);
    const target = this.path(reference);
    await mkdir(dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try {
        await handle.writeFile(ciphertext);
        await handle.sync();
      } finally {
        await handle.close();
      }
      // `link` is an atomic no-overwrite publish step: an interrupted write can
      // only leave a disposable .tmp file, never a partial trusted artifact.
      await link(temporary, target);
    } catch (error: unknown) {
      if (!isAlreadyExists(error)) throw error;
      throw new ConflictException('A staged workbook artifact already exists without matching database metadata.');
    } finally {
      await rm(temporary, { force: true });
    }
    return { storageReference: reference, encryptionIv: iv.toString('base64'), storedByteSize: BigInt(input.bytes.byteLength) };
  }

  /**
   * Restores an already-verified workbook for a resumable preflight/import run.
   * The stored bytes are never trusted merely because they decrypt: their
   * plaintext length and SHA-256 must still equal the package record.
   */
  async readVerified(input: Readonly<{ workbookSha256: string; artifact: NurixExcelStagingArtifact }>): Promise<Buffer> {
    if (input.artifact.storedByteSize < 0n) throw new ConflictException('The staged workbook artifact metadata is invalid.');
    const restored = this.decrypt(await readFile(this.path(input.artifact.storageReference)), input.artifact.encryptionIv);
    this.assertChecksum(restored, input.workbookSha256);
    if (BigInt(restored.byteLength) !== input.artifact.storedByteSize) {
      throw new ConflictException('The staged workbook artifact size does not match its verified package.');
    }
    return restored;
  }

  private key(): Buffer {
    const raw = process.env.BASEER_NURIX_MIGRATION_ENCRYPTION_KEY;
    const key = raw ? Buffer.from(raw, 'base64') : null;
    if (!key || key.length !== 32 || key.toString('base64') !== raw) throw new ServiceUnavailableException('Noorix migration encrypted storage is not configured.');
    return key;
  }

  private decrypt(ciphertextWithTag: Buffer, ivValue: string): Buffer {
    const iv = Buffer.from(ivValue, 'base64');
    if (iv.length !== 12 || ciphertextWithTag.length < 17) throw new ConflictException('The staged workbook artifact is invalid.');
    const decipher = createDecipheriv('aes-256-gcm', this.key(), iv);
    decipher.setAuthTag(ciphertextWithTag.subarray(-16));
    try { return Buffer.concat([decipher.update(ciphertextWithTag.subarray(0, -16)), decipher.final()]); }
    catch { throw new ConflictException('The staged workbook artifact cannot be decrypted.'); }
  }

  private assertMatch(actual: Buffer, expected: Buffer, expectedSha256: string): void {
    this.assertChecksum(actual, expectedSha256);
    if (actual.byteLength !== expected.byteLength) throw new ConflictException('The staged workbook artifact checksum does not match its verified package.');
  }

  private assertChecksum(bytes: Buffer, expectedSha256: string): void {
    const actualHash = createHash('sha256').update(bytes).digest();
    const expectedHash = Buffer.from(expectedSha256, 'hex');
    if (expectedHash.length !== actualHash.length || !timingSafeEqual(actualHash, expectedHash)) throw new ConflictException('The staged workbook artifact checksum does not match its verified package.');
  }

  private path(reference: string): string {
    if (!/^packages\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.bin$/.test(reference)) throw new ConflictException('The staged workbook storage reference is invalid.');
    const target = resolve(this.root, ...reference.split('/'));
    if (!target.startsWith(`${this.root}${sep}`)) throw new ConflictException('The staged workbook storage reference is unsafe.');
    return target;
  }
}

function isAlreadyExists(error: unknown): boolean { return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: unknown }).code === 'EEXIST'; }
