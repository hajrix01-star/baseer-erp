import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';

import type { OutputActor, OutputRequest, ReportDefinition } from './contracts.js';
import { OutputPlatform } from './output-platform.js';

const actor: OutputActor = { tenantId: 'tenant-1', userId: 'user-1', permissions: ['reports.export'] };
const request: OutputRequest = {
  reportCode: 'finance.summary',
  format: 'xlsx',
  locale: 'ar',
  scope: { companyIds: ['company-1'] },
  filters: { month: '2026-08' },
  taxPresentation: 'gross',
  idempotencyKey: 'output-intent-0001',
};

const definition: ReportDefinition = {
  code: 'finance.summary',
  async authorize() { return { allowed: true }; },
  async createSnapshot() {
    return {
      snapshotId: 'snapshot-1', reportCode: 'finance.summary', templateVersion: '1', title: '\u0645\u0644\u062e\u0635 \u0627\u0644\u0645\u0627\u0644\u064a\u0629',
      direction: 'rtl', locale: 'ar', generatedAtRiyadh: '2026-08-14T12:00:00+03:00',
      companies: [{ id: 'company-1', name: '\u0634\u0631\u0643\u0629 \u0628\u0635\u064a\u0631' }], periodLabel: '\u0623\u063a\u0633\u0637\u0633 2026', taxPresentation: 'gross',
      columns: [{ key: 'amount', label: '\u0627\u0644\u0645\u0628\u0644\u063a', kind: 'amount' }, { key: 'note', label: '\u0645\u0644\u0627\u062d\u0638\u0629', kind: 'text' }],
      rows: [{ amount: 115, note: '=unsafe' }], sourceLabel: '\u0627\u0644\u0633\u062c\u0644 \u0627\u0644\u0645\u062d\u0627\u0633\u0628\u064a',
    };
  },
};

test('generates a readable server-side xlsx artifact with formula injection escaped', async () => {
  const platform = new OutputPlatform();
  platform.register(definition);
  const artifact = await platform.createArtifact(actor, request);
  if (typeof artifact === 'string') throw new Error('Expected an output artifact');
  assert.equal(artifact.format, 'xlsx');
  assert.ok(artifact.bytes.length > 1000);
  const workbook = XLSX.read(artifact.bytes, { type: 'array' });
  const worksheet = workbook.Sheets.Report;
  assert.ok(worksheet);
  assert.equal(worksheet.A1?.v, '\u0645\u0644\u062e\u0635 \u0627\u0644\u0645\u0627\u0644\u064a\u0629');
  assert.equal(worksheet.A5?.v, '\u0627\u0644\u0645\u0628\u0644\u063a');
  assert.equal(worksheet.A6?.v, '115');
  assert.equal(worksheet.B6?.v, "'=unsafe");
});

test('refuses reports outside the registered contract', async () => {
  const platform = new OutputPlatform();
  await assert.rejects(platform.createSnapshot(actor, { ...request, reportCode: 'unknown' }), /OUTPUT_REPORT_NOT_FOUND/);
});