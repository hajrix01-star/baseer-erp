/**
 * Operational-only Noorix HR service evidence writer for Al-Shami.
 *
 * These rows have a source service, employee and paid invoice evidence, but
 * no source financial supplier/category.  They are intentionally recorded in
 * employee files without a supplier, category, outflow document or journal.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-al-shami-operational-hr-service-evidence/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_HR_SERVICE_EVIDENCE_V1';
const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixed = (value, label = 'amount') => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Invalid ${label}.`);
  return number.toFixed(4);
};
const day = (value) => value ? new Date(`${value}T00:00:00.000Z`) : null;

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-al-shami-hr-service-evidence-backfill.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
}
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') throw new Error('This writer only permits the canonical local Baseer test database.');

const sourceSql = `
SELECT coalesce(json_agg(row ORDER BY row->>'operationDate', row->>'invoiceNumber'), '[]'::json)::text
FROM (
  SELECT json_build_object(
    'sourceServiceId', r.id, 'sourceInvoiceId', i.id, 'invoiceNumber', i.invoice_number,
    'employeeSourceId', r.employee_id, 'serviceCategory', r.service_category,
    'referenceNumber', coalesce(nullif(r.iqama_number, ''), nullif(r.reference_label, '')),
    'issueDate', CASE WHEN r.issue_date IS NULL THEN NULL ELSE to_char(r.issue_date::date, 'YYYY-MM-DD') END,
    'expiryDate', CASE WHEN r.expiry_date IS NULL THEN NULL ELSE to_char(r.expiry_date::date, 'YYYY-MM-DD') END,
    'operationDate', to_char(r.transaction_date::date, 'YYYY-MM-DD'),
    'visaDurationMonths', nullif(r.metadata->>'visaDurationMonths', '')::int,
    'serviceNotes', coalesce(r.notes, ''), 'invoiceNotes', coalesce(i.notes, ''),
    'serviceProviderName', coalesce(s.name_ar, ''), 'invoiceSupplierId', i.supplier_id,
    'invoiceCategoryId', i.category_id, 'amount', i.total_amount::text, 'invoiceStatus', i.status
  ) AS row
  FROM employee_residencies r
  JOIN invoices i ON i.id=r.invoice_id AND i.company_id=r.company_id
  LEFT JOIN suppliers s ON s.id=r.supplier_id
  WHERE r.company_id='${SOURCE_COMPANY_ID}' AND i.kind='hr_expense' AND i.status='active'
    AND (i.supplier_id IS NULL OR i.category_id IS NULL)
) source_rows;`;

const raw = execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
if (!raw) throw new Error('No Noorix evidence-only employee services were returned.');
const rows = JSON.parse(raw);
const serviceType = (value) => ({ iqama_renewal: 'IQAMA_RENEWAL', sponsorship_transfer: 'SPONSORSHIP_TRANSFER', health_certificate: 'HEALTH_CERTIFICATE' }[value] ?? null);
if (!Array.isArray(rows) || rows.length !== 4 || fixed(rows.reduce((sum, row) => sum + Number(row.amount), 0), 'evidence total') !== '3337.0000') throw new Error('The reviewed Al-Shami evidence-only service set changed.');
for (const row of rows) {
  if (!row.sourceServiceId || !row.sourceInvoiceId || !row.invoiceNumber || !row.employeeSourceId || !row.operationDate || row.invoiceStatus !== 'active' || !serviceType(row.serviceCategory)) throw new Error('An evidence-only source service is incomplete.');
  if ((row.serviceCategory === 'iqama_renewal') && !row.referenceNumber) throw new Error(`Iqama evidence ${row.invoiceNumber} lacks its source reference.`);
  row.sourceChecksum = sha(row);
}
const planSha = sha({ version: VERSION, rows: rows.map((row) => [row.sourceServiceId, row.sourceChecksum]) });

// Historical service dates in Noorix are not consistently maintained.  The
// owner-approved migration rule is to preserve the proven operation date only
// and never turn a source expiry date into a current compliance assertion.
const datesForOperationalRecord = (row) => ({ issueDate: day(row.operationDate), expiryDate: null, datesOmitted: true });
const serviceProviderNote = (row) => {
  if (row.invoiceNumber === 'HR-20260528-001') return 'توضيح وصفي: نوع الخدمة «نقل كفالة» والنص المصدر «نقل كفالة — مكرم — 2565656565 — المعلم الشامي». لا يُنشئ هذا التوضيح مورداً مالياً.';
  if (row.invoiceNumber === 'HR-20260708-001') return 'توضيح وصفي: النص المصدر يذكر رسوم الجوازات وتجديد اشتراك أبشر أعمال. لا يُنشئ هذا التوضيح مورداً مالياً.';
  if (row.invoiceNumber === 'HR-20260708-002') return 'توضيح وصفي: النص المصدر يذكر «تجديد رخصة مكتب العمل». لا يُنشئ هذا التوضيح مورداً مالياً.';
  if (row.invoiceNumber === 'HR-20260724-001') return 'توضيح وصفي: شهادة صحية؛ تُحفظ الجهة كما وردت في سجل خدمات نوركس ولا يُنشأ مورد مالي.';
  throw new Error(`No approved descriptive-provider rule exists for ${row.invoiceNumber}.`);
};
const operationalNote = (row) => {
  const sourceNotes = [row.serviceNotes, row.invoiceNotes].filter(Boolean).join(' | ');
  const dates = ` حُفظ تاريخ العملية المصدر فقط: ${row.operationDate}؛ وتُرك تاريخا الإصدار والانتهاء دون اعتماد تاريخي.`;
  const provider = row.serviceProviderName ? `جهة الخدمة في سجل خدمات نوركس: ${row.serviceProviderName}.` : 'جهة الخدمة غير مسجلة في سجل خدمات نوركس.';
  return `${provider} ${serviceProviderNote(row)}${dates}${sourceNotes ? ` ملاحظة المصدر: ${sourceNotes}` : ''}`;
};

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');

let app;
try {
  app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const database = app.get(DatabaseService);
  const preflight = await database.inTenantTransaction(tenantId, async (tx) => {
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, status: 'READY_FOR_RECONCILIATION' }, select: { id: true } });
    if (!packageRow) throw new Error('The selected package is not the approved Al-Shami package.');
    const employeeMaps = await tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: rows.map((row) => row.employeeSourceId) }, targetId: { not: null }, status: { in: ['CREATED', 'REUSED'] }, execution: { packageId, targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } });
    const employeeIdBySource = new Map(employeeMaps.map((row) => [row.sourceId, row.targetId]));
    if (employeeIdBySource.size !== new Set(rows.map((row) => row.employeeSourceId)).size) throw new Error('Employee mapping is incomplete.');
    const employees = await tx.hrEmployee.findMany({ where: { tenantId, companyId, id: { in: [...employeeIdBySource.values()] }, status: { in: ['ACTIVE', 'ON_LEAVE'] } }, select: { id: true } });
    if (employees.length !== employeeIdBySource.size) throw new Error('A mapped employee is not operationally active.');
    return { employeeIdBySource };
  });
  const dryRun = { status: 'PARSED_DRY_RUN', version: VERSION, planSha, sourceRows: rows.length, operationalServiceRows: rows.map((row) => ({ sourceServiceId: row.sourceServiceId, invoiceNumber: row.invoiceNumber, type: serviceType(row.serviceCategory), operationDate: row.operationDate, amountEvidenceOnly: fixed(row.amount), serviceProviderFromNoorix: row.serviceProviderName, notePreview: operationalNote(row), datesOmittedForInconsistency: datesForOperationalRecord(row).datesOmitted })), financialWrites: 0, supplierLinksCreated: 0, categoryLinksCreated: 0, outflowDocumentsCreated: 0 };
  console.log(JSON.stringify(dryRun, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const execution = await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: VERSION } }, select: { id: true, financialPlanSha256: true } });
      if (existing) { if (existing.financialPlanSha256 !== planSha) throw new Error('Existing HR-service evidence execution differs from the frozen source.'); return existing; }
      return tx.nurixExcelFinancialExecution.create({ data: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion: VERSION, financialPlanSha256: planSha, status: 'RUNNING', reason: 'Owner-approved operational HR-service evidence only; no supplier, category, invoice, allocation, or journal is created.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date(), waveSequence: 1 }, select: { id: true, financialPlanSha256: true } });
    });
    const wave = await database.inTenantTransaction(tenantId, (tx) => tx.nurixExcelFinancialWave.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sequence: 1, status: 'RUNNING', plannedItems: rows.length }, update: {}, select: { id: true } }));
    const receipts = [];
    for (const row of rows) receipts.push(await database.inTenantTransaction(tenantId, async (tx) => {
      const maps = await tx.nurixExcelFinancialSourceMap.findMany({ where: { executionId: execution.id, sourceId: row.sourceServiceId }, select: { sourceChecksum: true, targetId: true, targetEntity: true } });
      if (maps.length) {
        if (maps.length !== 1 || maps[0].sourceChecksum !== row.sourceChecksum || maps[0].targetEntity !== 'HrEmployeeService') throw new Error(`Conflicting evidence map for ${row.invoiceNumber}.`);
        const service = await tx.hrEmployeeService.findFirst({ where: { id: maps[0].targetId, tenantId, companyId, supplierId: null, categoryId: null, outflowDocumentId: null }, select: { id: true } });
        if (!service) throw new Error(`Existing evidence service ${row.invoiceNumber} does not retain its non-financial boundary.`);
        const dates = datesForOperationalRecord(row);
        await tx.hrEmployeeService.update({ where: { id: service.id }, data: { issueDate: dates.issueDate, expiryDate: null, notes: operationalNote(row), status: 'ISSUED', complianceStatus: 'ACTIVE' } });
        await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.hr_employee_service_evidence.operation_date_normalized', entityType: 'HrEmployeeService', entityId: service.id, requestId: `nurix-al-shami-hr-service-evidence-date:${row.sourceServiceId}`, afterJson: { sourceServiceId: row.sourceServiceId, operationDate: row.operationDate, expiryDate: null, financialBoundary: 'No supplier/category/outflow/journal created.' } } });
        return { serviceId: service.id, sourceInvoiceNumber: row.invoiceNumber, reused: true };
      }
      const dates = datesForOperationalRecord(row);
      const serviceId = randomUUID();
      // ISSUED means the historical service itself is complete/visible.  The
      // null outflow document deliberately keeps costStatus as NOT_ISSUED and
      // proves this is not a financial supplier cost.
      await tx.hrEmployeeService.create({ data: { id: serviceId, tenantId, companyId, employeeId: preflight.employeeIdBySource.get(row.employeeSourceId), serviceType: serviceType(row.serviceCategory), referenceNumber: row.referenceNumber || null, issueDate: dates.issueDate, expiryDate: dates.expiryDate, visaDurationMonths: null, supplierId: null, categoryId: null, outflowDocumentId: null, status: 'ISSUED', complianceStatus: 'ACTIVE', notes: operationalNote(row) } });
      await tx.nurixExcelFinancialItem.create({ data: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sourceSheet: 'EmployeeServices', sourceEntity: 'NoorixEmployeeServiceEvidence', sourceId: row.sourceServiceId, sourceChecksum: row.sourceChecksum, operationKey: sha({ version: VERSION, sourceServiceId: row.sourceServiceId }), status: 'POSTED', targetEntity: 'HrEmployeeService', targetId: serviceId, resultCode: 'RECORDED_OPERATIONAL_EVIDENCE_NO_FINANCIAL_WRITE' } });
      await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixEmployeeService', sourceId: row.sourceServiceId, sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeService', targetId: serviceId, state: 'APPLIED' } });
      for (const [sourceEntity, sourceId, exactText] of [['EmployeeResidency', row.sourceServiceId, row.serviceNotes], ['Invoice', row.sourceInvoiceId, row.invoiceNotes]]) {
        if (!exactText) continue;
        await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity, sourceId, field: 'notes' } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity, sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeService', targetId: serviceId, field: 'notes', exactText }, update: { sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeService', targetId: serviceId, exactText } });
      }
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.hr_employee_service_evidence.recorded', entityType: 'HrEmployeeService', entityId: serviceId, requestId: `nurix-al-shami-hr-service-evidence:${row.sourceServiceId}`, afterJson: { sourceServiceId: row.sourceServiceId, sourceInvoiceId: row.sourceInvoiceId, sourceChecksum: row.sourceChecksum, operationalNote: operationalNote(row), financialBoundary: 'No supplier/category/outflow/journal created.' } } });
      return { serviceId, sourceInvoiceNumber: row.invoiceNumber, reused: false };
    }));
    await database.inTenantTransaction(tenantId, async (tx) => {
      const count = await tx.nurixExcelFinancialItem.count({ where: { executionId: execution.id, status: 'POSTED' } });
      if (count !== rows.length) throw new Error('The operational evidence wave did not reach every approved source service.');
      await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: 'COMMITTED', postedItems: count, reusedItems: 0, reviewItems: 0, failedItems: 0, committedAt: new Date(), reconciliationHash: planSha } });
      await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', reason: 'Recorded four operational employee services with explicit non-financial boundary.', waveSequence: 1 } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.hr_employee_service_evidence.completed', entityType: 'NurixExcelFinancialExecution', entityId: execution.id, requestId: `nurix-al-shami-hr-service-evidence-complete:${planSha}`, afterJson: { ...dryRun, receipts } } });
    });
    console.log(JSON.stringify({ status: 'COMPLETED', version: VERSION, planSha, receipts }, null, 2));
  }
} finally {
  await app?.close();
}
