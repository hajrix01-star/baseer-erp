/** Run after API build: `node apps/api/dist/nurix-migration/nurix-migration-intake.policy-verification.js`. */
import assert from 'node:assert/strict';

import { NURIX_MIGRATION_INTAKE_FORMAT, NurixMigrationIntakeError, validateNurixMigrationIntakeManifest } from './nurix-migration-intake.js';

const fingerprint = 'a'.repeat(64);
const checksum = 'b'.repeat(64);
const now = new Date('2026-08-27T12:00:00.000Z');

function manifest(): Record<string, unknown> {
  return {
    format: NURIX_MIGRATION_INTAKE_FORMAT,
    sourceFingerprint: fingerprint,
    exportedAt: '2026-08-27T11:59:00.000Z',
    declaredFileCount: 2,
    declaredRecordCount: 3,
    files: [
      { path: 'company.jsonl', sha256: checksum, byteSize: 12, recordCount: 1 },
      { path: 'finance/accounts.jsonl', sha256: 'c'.repeat(64), byteSize: 24, recordCount: 2 },
    ],
  };
}

function expectCode(input: unknown, code: string): void {
  assert.throws(
    () => validateNurixMigrationIntakeManifest(input, now),
    (error: unknown) => error instanceof NurixMigrationIntakeError && error.code === code && !error.message.includes('secret'),
  );
}

function main(): void {
  const receipt = validateNurixMigrationIntakeManifest(manifest(), now);
  assert.equal(receipt.declaredByteSize, 36);
  assert.equal(receipt.manifest.files.length, 2);
  assert.equal(Object.isFrozen(receipt.manifest), true);
  expectCode({ ...manifest(), format: 'unknown-export/v1' }, 'MANIFEST_FORMAT_UNSUPPORTED');
  expectCode({ ...manifest(), apiToken: 'do-not-accept-secrets' }, 'MANIFEST_SHAPE_INVALID');
  const missingTimestamp = manifest();
  delete missingTimestamp.exportedAt;
  expectCode(missingTimestamp, 'MANIFEST_SHAPE_INVALID');
  expectCode({ ...manifest(), declaredRecordCount: 4 }, 'MANIFEST_RECORD_COUNT_MISMATCH');
  expectCode({ ...manifest(), files: [{ path: '../outside.jsonl', sha256: checksum, byteSize: 1, recordCount: 1 }], declaredFileCount: 1, declaredRecordCount: 1 }, 'MANIFEST_FILE_INVALID');
  expectCode({ ...manifest(), exportedAt: '2026-08-27T12:06:00.000Z' }, 'EXPORT_TIMESTAMP_INVALID');
  expectCode(new Proxy({}, { getPrototypeOf() { throw new Error('do-not-echo-a-secret'); } }), 'MANIFEST_UNREADABLE');
  console.log('Nurix migration intake policy verification passed: manifest-only, source-agnostic, strict format/count/checksum/path validation and secret-field rejection.');
}

main();
