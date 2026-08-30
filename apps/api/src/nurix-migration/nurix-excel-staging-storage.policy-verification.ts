import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NurixExcelStagingStorageService } from './nurix-excel-staging-storage.service.js';

const root = await mkdtemp(join(tmpdir(), 'baseer-nurix-staging-'));
const tenantId = randomUUID();
const packageId = randomUUID();
const bytes = Buffer.from('verified noorix workbook bytes');
const checksum = createHash('sha256').update(bytes).digest('hex');

try {
  process.env.BASEER_NURIX_MIGRATION_STORAGE_ROOT = root;
  process.env.BASEER_NURIX_MIGRATION_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64');
  const storage = new NurixExcelStagingStorageService();
  const artifact = await storage.store({ tenantId, packageId, workbookSha256: checksum, bytes, existing: { storageReference: null, encryptionIv: null, storedByteSize: null } });
  const encrypted = await readFile(join(root, artifact.storageReference));
  assert.notDeepEqual(encrypted, bytes);
  const replay = await storage.store({ tenantId, packageId, workbookSha256: checksum, bytes, existing: artifact });
  assert.deepEqual(replay, artifact);
  const resumed = await storage.readVerified({ workbookSha256: checksum, artifact });
  assert.deepEqual(resumed, bytes);
  await assert.rejects(() => storage.store({ tenantId, packageId, workbookSha256: checksum, bytes: Buffer.from('different'), existing: artifact }));
  const corrupted = Buffer.from(encrypted);
  assert.ok(corrupted.byteLength > 0);
  corrupted[0] = (corrupted[0] ?? 0) ^ 0xff;
  await writeFile(join(root, artifact.storageReference), corrupted);
  await assert.rejects(() => storage.readVerified({ workbookSha256: checksum, artifact }));
  console.log('Nurix Excel staging storage verification passed: encrypted bytes resume safely and corrupted storage is rejected.');
} finally {
  await rm(root, { recursive: true, force: true });
  delete process.env.BASEER_NURIX_MIGRATION_STORAGE_ROOT;
  delete process.env.BASEER_NURIX_MIGRATION_ENCRYPTION_KEY;
}
