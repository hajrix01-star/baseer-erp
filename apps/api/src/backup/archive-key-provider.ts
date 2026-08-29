import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

import { canonicalJson } from './archive-canonical-json.js';
import type { ArchiveEncryptionScope, WrappedArchiveDataKey } from './archive.types.js';

const AES_256_KEY_BYTES = 32;
const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;
const KEY_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

type Keyring = Readonly<{ activeKeyId: string; keys: ReadonlyMap<string, Buffer> }>;

/**
 * Process-local KEK keyring. This is deliberately an abstraction, rather than
 * an assertion that environment variables are a KMS: a later KMS provider can
 * implement the same wrapping interface without changing archive bytes.
 */
export class ArchiveKeyProvider {
  private constructor(private readonly keyring: Keyring) {}

  static fromEnvironment(environment: NodeJS.ProcessEnv = process.env): ArchiveKeyProvider {
    const raw = environment.BASEER_ARCHIVE_KEK_KEYRING_V1?.trim();
    if (!raw) throw new ArchiveKeyConfigurationError('BASEER_ARCHIVE_KEK_KEYRING_V1 must be configured before an archive can be encrypted or verified.');
    let parsed: unknown;
    try { parsed = JSON.parse(raw); } catch { throw new ArchiveKeyConfigurationError('BASEER_ARCHIVE_KEK_KEYRING_V1 must contain strict JSON.'); }
    if (!isRecord(parsed) || !hasOnlyKeys(parsed, ['activeKeyId', 'keys']) || typeof parsed.activeKeyId !== 'string' || !KEY_ID.test(parsed.activeKeyId) || !isRecord(parsed.keys)) {
      throw new ArchiveKeyConfigurationError('BASEER_ARCHIVE_KEK_KEYRING_V1 must be {"activeKeyId":"…","keys":{"key-id":"base64-32-byte-key"}}.');
    }
    const keys = new Map<string, Buffer>();
    for (const [keyId, encoded] of Object.entries(parsed.keys)) {
      if (!KEY_ID.test(keyId) || typeof encoded !== 'string') throw new ArchiveKeyConfigurationError('Archive KEK key identifiers and values are invalid.');
      const key = canonicalBase64(encoded, `Archive KEK ${keyId}`);
      if (key.length !== AES_256_KEY_BYTES) throw new ArchiveKeyConfigurationError(`Archive KEK ${keyId} must decode to exactly 32 bytes.`);
      keys.set(keyId, key);
    }
    if (keys.size === 0 || !keys.has(parsed.activeKeyId)) throw new ArchiveKeyConfigurationError('Archive KEK keyring has no active 32-byte key.');
    return new ArchiveKeyProvider({ activeKeyId: parsed.activeKeyId, keys });
  }

  createDataEncryptionKey(): Buffer { return randomBytes(AES_256_KEY_BYTES); }

  wrapDataEncryptionKey(dataEncryptionKey: Buffer, scope: ArchiveEncryptionScope, manifestSha256: string): WrappedArchiveDataKey {
    if (dataEncryptionKey.length !== AES_256_KEY_BYTES) throw new TypeError('Archive data-encryption key must be 32 bytes.');
    const keyId = this.keyring.activeKeyId;
    const keyEncryptionKey = this.keyring.keys.get(keyId);
    if (!keyEncryptionKey) throw new ArchiveKeyConfigurationError('The active archive KEK is unavailable.');
    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', keyEncryptionKey, iv, { authTagLength: GCM_TAG_BYTES });
    cipher.setAAD(Buffer.from(this.wrapAad(scope, manifestSha256, keyId), 'utf8'));
    const ciphertext = Buffer.concat([cipher.update(dataEncryptionKey), cipher.final()]);
    return {
      algorithm: 'AES-256-GCM', keyId, ivBase64: iv.toString('base64'),
      authTagBase64: cipher.getAuthTag().toString('base64'), ciphertextBase64: ciphertext.toString('base64'),
    };
  }

  unwrapDataEncryptionKey(wrapped: WrappedArchiveDataKey, scope: ArchiveEncryptionScope, manifestSha256: string): Buffer {
    if (wrapped.algorithm !== 'AES-256-GCM' || !KEY_ID.test(wrapped.keyId)) throw new ArchiveKeyConfigurationError('The archive wrapped data key is unsupported.');
    const keyEncryptionKey = this.keyring.keys.get(wrapped.keyId);
    if (!keyEncryptionKey) throw new ArchiveKeyConfigurationError(`Archive KEK key id ${wrapped.keyId} is unknown.`);
    const iv = canonicalBase64(wrapped.ivBase64, 'Archive wrapped-key IV');
    const authTag = canonicalBase64(wrapped.authTagBase64, 'Archive wrapped-key auth tag');
    const ciphertext = canonicalBase64(wrapped.ciphertextBase64, 'Archive wrapped-key ciphertext');
    if (iv.length !== GCM_IV_BYTES || authTag.length !== GCM_TAG_BYTES || ciphertext.length !== AES_256_KEY_BYTES) throw new ArchiveKeyConfigurationError('The archive wrapped data key has an invalid length.');
    try {
      const decipher = createDecipheriv('aes-256-gcm', keyEncryptionKey, iv, { authTagLength: GCM_TAG_BYTES });
      decipher.setAAD(Buffer.from(this.wrapAad(scope, manifestSha256, wrapped.keyId), 'utf8'));
      decipher.setAuthTag(authTag);
      const dataEncryptionKey = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
      if (dataEncryptionKey.length !== AES_256_KEY_BYTES) throw new ArchiveKeyConfigurationError('The archive unwrapped data key has an invalid length.');
      return dataEncryptionKey;
    } catch (error) {
      if (error instanceof ArchiveKeyConfigurationError) throw error;
      throw new ArchiveKeyConfigurationError('Archive wrapped data key authentication failed.');
    }
  }

  private wrapAad(scope: ArchiveEncryptionScope, manifestSha256: string, keyId: string): string {
    return canonicalJson({
      purpose: 'baseer-company-archive-key-wrap/v1', keyId, manifestSha256,
      scope: { tenantId: scope.tenantId, companyId: scope.companyId, jobId: scope.jobId, workerLeaseFence: scope.workerLeaseFence.toString() },
    });
  }
}

export class ArchiveKeyConfigurationError extends Error {
  constructor(message: string) { super(message); this.name = 'ArchiveKeyConfigurationError'; }
}

function canonicalBase64(value: string, label: string): Buffer {
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) throw new ArchiveKeyConfigurationError(`${label} must be canonical base64.`);
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) throw new ArchiveKeyConfigurationError(`${label} must be canonical base64.`);
  return decoded;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function hasOnlyKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}
