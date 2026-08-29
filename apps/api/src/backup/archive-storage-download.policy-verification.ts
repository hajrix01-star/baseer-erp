/**
 * Run after `npm run build --workspace @baseer-erp/api` with
 * `node apps/api/dist/backup/archive-storage-download.policy-verification.js`.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LocalArchiveStagingStorage, type ArchiveStorageScope } from './archive-storage.js';

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'baseer-download-fd-'));
  const scope: ArchiveStorageScope = {
    tenantId: '10000000-0000-4000-8000-000000000001',
    companyId: '20000000-0000-4000-8000-000000000001',
    jobId: '30000000-0000-4000-8000-000000000001',
    workerLeaseFence: 1n,
  };
  const storage = new LocalArchiveStagingStorage(root);
  const original = Buffer.from('verified-encrypted-archive-bytes');
  try {
    const pending = await storage.prepareEncryptedArtifact(scope);
    await writeFile(pending.artifactPath, original, { flag: 'wx' });
    const resolved = await storage.resolveVerifiedEncryptedDownload({
      tenantId: scope.tenantId, companyId: scope.companyId, jobId: scope.jobId,
      storageKey: pending.storageKey, byteSize: BigInt(original.byteLength),
      sha256: createHash('sha256').update(original).digest('hex'),
    });
    await rename(pending.artifactPath, `${pending.artifactPath}.replaced`);
    await writeFile(pending.artifactPath, Buffer.from('replacement-bytes'), { flag: 'wx' });
    const streamed = await readAll(resolved.openReadStream());
    assert.deepEqual(streamed, original, 'A resolved download must stream the verified opened descriptor, never a replacement path.');
    await resolved.dispose();
    console.log('Archive storage download policy verification passed: a replaced path cannot alter pinned download bytes.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function readAll(stream: AsyncIterable<Buffer>): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

void main();
