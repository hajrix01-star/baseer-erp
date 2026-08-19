import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';

import type { OutputActor, OutputRequest, ReportDefinition } from './contracts.js';
import { formatDisplayNumber } from './formatting.js';
import { OutputPlatform } from './output-platform.js';
import { renderPrintPreviewDocument } from './print-preview.js';

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
      companies: [{ id: 'company-1', name: '\u0634\u0631\u0643\u0629 \u0628\u0635\u064a\u0631' }], companyLogoDataUri: 'data:image/png;base64,iVBORw0KGgo=', periodLabel: '\u0623\u063a\u0633\u0637\u0633 2026', taxPresentation: 'gross',
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
  assert.equal(worksheet.A6?.v, '\u0627\u0644\u0645\u0628\u0644\u063a');
  assert.equal(worksheet.A7?.v, '115');
  assert.equal(worksheet.B7?.v, "'=unsafe");
});

test('refuses reports outside the registered contract', async () => {
  const platform = new OutputPlatform();
  await assert.rejects(platform.createSnapshot(actor, { ...request, reportCode: 'unknown' }), /OUTPUT_REPORT_NOT_FOUND/);
});

test('formats display numbers with no unnecessary decimals and at most one decimal place', () => {
  assert.equal(formatDisplayNumber('2500'), '2,500');
  assert.equal(formatDisplayNumber('2500.5'), '2,500.5');
  assert.equal(formatDisplayNumber('2500.56'), '2,500.6');
});

test('renders a content-only branded print document with company identity and period', async () => {
  const snapshot = await definition.createSnapshot(actor, request);
  const html = renderPrintPreviewDocument(snapshot);
  assert.match(html, /class="report-header"/);
  assert.match(html, /data:image\/png;base64/);
  assert.match(html, /شركة بصير/);
  assert.match(html, /أغسطس 2026/);
  assert.match(html, /مستند مُنشأ من بيانات خادمية موثقة/);
  assert.doesNotMatch(html, /daily-sales-workspace|sidebar|launcher/);
});

test('renders a centered A4 portrait payroll document with totals and approval lines', () => {
  const html = renderPrintPreviewDocument({
    snapshotId: 'payroll-snapshot-1', reportCode: 'hr.payroll-run', templateVersion: '1', template: 'payroll-run', title: 'كشف مسير الرواتب PR-001', direction: 'rtl', locale: 'ar', generatedAtRiyadh: '2026-08-19T12:00:00+03:00',
    companies: [{ id: 'company-1', name: 'شركة بصير' }], periodLabel: 'PR-001 · 2026-08-01', taxPresentation: 'gross', sourceLabel: 'مسيرات الرواتب المعتمدة في بصير',
    columns: [{ key: 'employeeNumber', label: 'رقم الموظف', kind: 'text' }, { key: 'employee', label: 'الموظف', kind: 'text' }, { key: 'gross', label: 'إجمالي الراتب', kind: 'amount' }, { key: 'advances', label: 'تسوية السلف', kind: 'amount' }, { key: 'deductions', label: 'الخصم الإداري', kind: 'amount' }, { key: 'net', label: 'صافي المستحق', kind: 'amount' }, { key: 'paid', label: 'المدفوع', kind: 'amount' }],
    rows: [{ employeeNumber: 'EMP-001', employee: 'محمد', gross: '2500', advances: '100', deductions: '50', net: '2350', paid: '0' }],
  });
  assert.match(html, /@page \{ size: A4 portrait/);
  assert.match(html, /إجمالي الراتب/);
  assert.match(html, /2,500/);
  assert.match(html, /اعتماد الإدارة/);
  assert.doesNotMatch(html, /daily-sales-workspace|sidebar|launcher/);
});

test('renders bilingual A4 payroll signature slips with a clear acknowledgment and signatures', () => {
  const html = renderPrintPreviewDocument({
    snapshotId: 'signature-snapshot-1', reportCode: 'hr.payroll-signature-slips', templateVersion: '1', template: 'payroll-signature-slips', title: 'كشوف توقيع مسير الرواتب', direction: 'rtl', locale: 'ar', generatedAtRiyadh: '2026-08-19T12:00:00+03:00',
    companies: [{ id: 'company-1', name: 'شركة بصير' }], periodLabel: 'PAY-202608-0001 · 2026-08-01', taxPresentation: 'gross', sourceLabel: 'مسيرات الرواتب المعتمدة في بصير', columns: [], rows: [],
    payrollSignatureSlips: [{ employeeNumber: 'EMP-001', employeeName: 'محمد أحمد', gross: '2500', advances: '100', deductions: '50', net: '2350', paid: '0' }],
  });
  assert.match(html, /A4 portrait/);
  assert.match(html, /Payroll Signature Slip/);
  assert.match(html, /إقرار الاستلام/);
  assert.match(html, /Receipt Acknowledgment/);
  assert.match(html, /توقيع الموظف/);
  assert.match(html, /Employee signature/);
  assert.match(html, /2,350 <small>SAR<\/small>/);
});
