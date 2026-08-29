import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { verifyArchivePayloadDirectory } from './archive-verifier.js';
import { COMPANY_ARCHIVE_FORMAT_VERSION, type CompanyArchiveManifest } from './archive.types.js';

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'baseer-archive-verifier-'));
  try {
    const payload = Buffer.from('{"id":"safe"}\n', 'utf8');
    await mkdir(join(root, 'data'));
    await writeFile(join(root, 'data', 'company-profile.jsonl'), payload, { flag: 'wx' });
    const manifest = fixtureManifest(payload);
    const initial = await verifyArchivePayloadDirectory(root, manifest);
    assert(initial.valid, `Expected declared payload to verify, got ${JSON.stringify(initial.issues)}.`);

    await writeFile(join(root, 'data', 'undeclared.jsonl'), '{}\n', { flag: 'wx' });
    const withExtraPayload = await verifyArchivePayloadDirectory(root, manifest);
    assert(!withExtraPayload.valid && withExtraPayload.issues.some((issue) => issue.code === 'UNDECLARED_PAYLOAD'), 'Verifier must reject undeclared archive payloads.');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function fixtureManifest(payload: Buffer): CompanyArchiveManifest {
  return {
    archiveFormatVersion: COMPANY_ARCHIVE_FORMAT_VERSION,
    archiveId: randomUUID(),
    createdAt: new Date().toISOString(),
    source: { applicationVersion: 'test', schemaVersion: 'test', tenantId: randomUUID() },
    companies: [{ companyId: randomUUID(), nameAr: 'اختبار', nameEn: 'Test', modules: [{ module: 'company', recordCount: 1 }] }],
    files: [{ path: 'data/company-profile.jsonl', byteSize: payload.byteLength, sha256: createHash('sha256').update(payload).digest('hex') }],
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

void main();
