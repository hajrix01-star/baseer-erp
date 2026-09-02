/**
 * ARZ-only repair for two Noorix employee-service invoices whose financial
 * documents were posted before source lineage was captured.  It never creates
 * a document, service, supplier, or journal: it may only attach invoice and
 * ledger lineage after exact source/target financial proof.
 *
 * The historical target services say IQAMA_ISSUANCE while Noorix says
 * iqama_renewal.  That is deliberately retained as an HR review annotation;
 * this writer does not map or rewrite the service type.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-arz-historical-hr-service-financial-lineage/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_ARZ_HR_SERVICE_FINANCIAL_LINEAGE_V1';
const SOURCE_COMPANY_ID = 'cmnf604ka009ay8lm556wgd9c';
const SOURCE_CONTAINER = 'baseer-noorix-snapshot-20260902';
const SOURCE_DATABASE = 'nurix_snapshot';
const UUID = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const money = (value, label = 'amount') => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid ${label}.`);
  return parsed.toFixed(4);
};

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => UUID.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-arz-hr-service-financial-lineage-backfill.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') throw new Error('This writer only permits the canonical local Baseer test database.');

const sourceSql = `
SELECT coalesce(json_agg(row ORDER BY row->'invoice'->>'number'), '[]'::json)::text
FROM (
  SELECT json_build_object(
    'service', json_build_object('sourceId', r.id, 'employeeSourceId', r.employee_id, 'serviceCategory', r.service_category, 'referenceNumber', coalesce(nullif(r.iqama_number, ''), nullif(r.reference_label, '')), 'notes', coalesce(r.notes, '')),
    'invoice', json_build_object(
      'sourceId', i.id, 'number', i.invoice_number, 'businessDate', to_char(i.transaction_date::date, 'YYYY-MM-DD'), 'amount', i.total_amount::text, 'status', i.status,
      'vaultSourceId', i.vault_id, 'supplierSourceId', i.supplier_id, 'notes', coalesce(i.notes, ''),
      'ledgers', coalesce((SELECT json_agg(json_build_object('sourceId', l.id, 'status', l.status, 'referenceType', l.reference_type, 'businessDate', to_char(l.transaction_date::date, 'YYYY-MM-DD'), 'amount', l.amount::text, 'vaultSourceId', l.vault_id, 'debitCode', da.code, 'creditCode', ca.code) ORDER BY l.id)
        FROM ledger_entries l LEFT JOIN accounts da ON da.id=l.debit_account_id LEFT JOIN accounts ca ON ca.id=l.credit_account_id WHERE l.company_id=i.company_id AND l.reference_id=i.id), '[]'::json)
    )
  ) AS row
  FROM employee_residencies r JOIN invoices i ON i.id=r.invoice_id AND i.company_id=r.company_id
  WHERE r.company_id='${SOURCE_COMPANY_ID}' AND i.id IN ('cmq5pj1yi002c11srxhubhene', 'cmt7qqna203pos10i70vq03lm')
) source_rows;`;
const raw = execFileSync('docker', ['exec', SOURCE_CONTAINER, 'psql', '-U', 'nurix_restore', '-d', SOURCE_DATABASE, '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
if (!raw) throw new Error('No Noorix source was returned.');
const rows = JSON.parse(raw);
if (!Array.isArray(rows) || rows.length !== 2) throw new Error('The reviewed ARZ HR-service source set changed.');
for (const row of rows) {
  const { service, invoice } = row;
  if (!service?.sourceId || !service.employeeSourceId || service.serviceCategory !== 'iqama_renewal' || !service.referenceNumber || !invoice?.sourceId || !invoice.number || invoice.status !== 'active' || !invoice.vaultSourceId || !Array.isArray(invoice.ledgers) || invoice.ledgers.length !== 1) throw new Error('An ARZ repair source row is incomplete.');
  const ledger = invoice.ledgers[0];
  if (ledger.status !== 'active' || ledger.referenceType !== 'invoice' || ledger.businessDate !== invoice.businessDate || ledger.vaultSourceId !== invoice.vaultSourceId || money(ledger.amount, ledger.sourceId) !== money(invoice.amount, invoice.number) || ledger.debitCode !== 'EXP-002' || ledger.creditCode !== 'V-002') throw new Error(`Invoice ${invoice.number} lacks exact active EXP-002/V-002 evidence.`);
  row.sourceChecksum = sha(row);
}
if (money(rows.reduce((sum, row) => sum + Number(row.invoice.amount), 0), 'total') !== '4238.0000') throw new Error('The approved ARZ financial total changed.');
const planSha = sha({ version: VERSION, rows: rows.map((row) => ({ serviceId: row.service.sourceId, invoiceId: row.invoice.sourceId, ledgerId: row.invoice.ledgers[0].sourceId, checksum: row.sourceChecksum })) });

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');

let app;
try {
  app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const database = app.get(DatabaseService);
  const preflight = await database.inTenantTransaction(tenantId, async (tx) => {
    const [packageRow, company, employeeMaps, vaultMaps, documents, sourceMaps] = await Promise.all([
      tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, status: 'READY_FOR_RECONCILIATION' }, select: { id: true } }),
      tx.company.findFirst({ where: { id: companyId, tenantId }, select: { migrationReviewLocked: true } }),
      tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: rows.map((row) => row.service.employeeSourceId) }, targetId: { not: null }, status: { in: ['CREATED', 'REUSED'] }, execution: { packageId, targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', sourceId: { in: rows.map((row) => row.invoice.vaultSourceId) }, targetEntity: 'FinanceVault', state: { in: ['APPLIED', 'REUSED'] } }, select: { sourceId: true, targetId: true } }),
      tx.financeOutflowDocument.findMany({ where: { tenantId, companyId, supplierInvoiceNumber: { in: rows.map((row) => row.invoice.number) } }, include: { allocations: { select: { vaultId: true, grossAmount: true } }, journalEntry: { include: { lines: { include: { account: { select: { code: true } } }, orderBy: { lineNumber: 'asc' } } }, }, category: { select: { code: true } }, hrEmployeeService: { select: { id: true, employeeId: true, serviceType: true, referenceNumber: true, status: true } } } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceId: { in: rows.flatMap((row) => [row.invoice.sourceId, row.invoice.ledgers[0].sourceId]) } }, select: { sourceEntity: true, sourceId: true, targetEntity: true, targetId: true, state: true } }),
    ]);
    if (!packageRow || !company?.migrationReviewLocked) throw new Error('ARZ package/company is not eligible for a controlled historical repair.');
    const mapExact = (items, expected, label) => {
      const mapped = new Map(items.map((item) => [item.sourceId, item.targetId]));
      if (mapped.size !== new Set(expected).size || expected.some((id) => !mapped.get(id))) throw new Error(`${label} mapping is incomplete.`);
      return mapped;
    };
    const employeeIdBySource = mapExact(employeeMaps, rows.map((row) => row.service.employeeSourceId), 'Employee');
    const vaultIdBySource = mapExact(vaultMaps, rows.map((row) => row.invoice.vaultSourceId), 'Vault');
    const documentByInvoice = new Map(documents.map((document) => [document.supplierInvoiceNumber, document]));
    const existingMapKeys = new Set(sourceMaps.map((entry) => `${entry.sourceEntity}:${entry.sourceId}`));
    const hrTypeReviews = [];
    for (const row of rows) {
      const document = documentByInvoice.get(row.invoice.number);
      const targetVaultId = vaultIdBySource.get(row.invoice.vaultSourceId);
      if (!document || document.status !== 'POSTED' || money(document.grossAmount) !== money(row.invoice.amount) || document.businessDate.toISOString().slice(0, 10) !== row.invoice.businessDate || document.category.code !== 'E2-4' || document.allocations.length !== 1 || document.allocations[0].vaultId !== targetVaultId || money(document.allocations[0].grossAmount) !== money(row.invoice.amount)) throw new Error(`Target document ${row.invoice.number} is not an exact financial match.`);
      const lines = document.journalEntry.lines;
      if (lines.length !== 2 || money(lines[0].debitAmount) !== money(row.invoice.amount) || lines[0].creditAmount.toFixed(4) !== '0.0000' || lines[0].account.code !== 'EXP-002' || money(lines[1].creditAmount) !== money(row.invoice.amount) || lines[1].debitAmount.toFixed(4) !== '0.0000' || lines[1].account.code !== 'V-002') throw new Error(`Target journal ${document.journalEntryId} does not match ${row.invoice.number}.`);
      const service = document.hrEmployeeService && document.hrEmployeeService.employeeId === employeeIdBySource.get(row.service.employeeSourceId) && document.hrEmployeeService.referenceNumber === row.service.referenceNumber && document.hrEmployeeService.status === 'ISSUED' ? document.hrEmployeeService : null;
      if (!service) throw new Error(`Target document ${row.invoice.number} is not linked to the expected employee/reference.`);
      if (service.serviceType !== 'IQAMA_RENEWAL') hrTypeReviews.push({ sourceServiceId: row.service.sourceId, sourceServiceType: 'iqama_renewal', targetServiceId: service.id, targetServiceType: service.serviceType, reason: 'Existing target service type differs; financial linkage is safe but HR semantic mapping remains under review.' });
      for (const key of [`NoorixEmployeeServiceInvoice:${row.invoice.sourceId}`, `NoorixEmployeeServiceLedger:${row.invoice.ledgers[0].sourceId}`]) if (existingMapKeys.has(key)) throw new Error(`Existing financial lineage map ${key} requires manual reconciliation.`);
    }
    return { hrTypeReviews };
  });
  const dryRun = { status: 'PARSED_DRY_RUN', version: VERSION, planSha, financialLineageRows: rows.length, financialLineageAmount: money(rows.reduce((sum, row) => sum + Number(row.invoice.amount), 0)), sourceInvoices: rows.map((row) => row.invoice.number), financialWrites: 0, hrServiceMapsWritten: 0, retainedHrTypeReviews: preflight.hrTypeReviews };
  console.log(JSON.stringify(dryRun, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const execution = await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: VERSION } }, select: { id: true, financialPlanSha256: true } });
      if (existing) { if (existing.financialPlanSha256 !== planSha) throw new Error('Existing ARZ financial-lineage execution differs from the frozen source.'); return existing; }
      return tx.nurixExcelFinancialExecution.create({ data: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion: VERSION, financialPlanSha256: planSha, status: 'RUNNING', reason: 'Owner-authorized ARZ invoice/ledger lineage repair only; existing HR service type is not rewritten.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date(), waveSequence: 1 }, select: { id: true } });
    });
    const wave = await database.inTenantTransaction(tenantId, async (tx) => tx.nurixExcelFinancialWave.create({ data: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sequence: 1, status: 'RUNNING', plannedItems: rows.length }, select: { id: true } }));
    for (const row of rows) await database.inTenantTransaction(tenantId, async (tx) => {
      const document = await tx.financeOutflowDocument.findFirst({ where: { tenantId, companyId, supplierInvoiceNumber: row.invoice.number, status: 'POSTED' }, select: { id: true, documentNumber: true, journalEntryId: true } });
      if (!document) throw new Error(`Target document ${row.invoice.number} disappeared after preflight.`);
      await tx.nurixExcelFinancialItem.create({ data: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sourceSheet: 'EmployeeServices', sourceEntity: 'NoorixEmployeeServiceInvoice', sourceId: row.invoice.sourceId, sourceChecksum: row.sourceChecksum, operationKey: sha({ version: VERSION, sourceInvoiceId: row.invoice.sourceId }), status: 'REUSED', targetEntity: 'FinanceOutflowDocument', targetId: document.id, resultCode: 'REUSED_EXISTING_HR_SERVICE_FINANCIAL_COST_WITH_HR_TYPE_REVIEW' } });
      for (const entry of [{ sourceEntity: 'NoorixEmployeeServiceInvoice', sourceId: row.invoice.sourceId, targetEntity: 'FinanceOutflowDocument', targetId: document.id }, { sourceEntity: 'NoorixEmployeeServiceLedger', sourceId: row.invoice.ledgers[0].sourceId, targetEntity: 'FinanceJournalEntry', targetId: document.journalEntryId }]) {
        await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: entry.sourceEntity, sourceId: entry.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: entry.targetEntity, targetId: entry.targetId, state: 'REUSED' } });
      }
      await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixEmployeeService', sourceId: row.service.sourceId, field: 'historicalServiceTypeReview' } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: 'NoorixEmployeeService', sourceId: row.service.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: document.id, field: 'historicalServiceTypeReview', exactText: `Noorix نوع الخدمة iqama_renewal؛ المستند والقيد الماليان متطابقان، لكن ربط نوع خدمة الموارد البشرية يحتاج مراجعة مستقلة ولا يُنشأ له source map هنا.` }, update: { sourceChecksum: row.sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: document.id, exactText: `Noorix نوع الخدمة iqama_renewal؛ المستند والقيد الماليان متطابقان، لكن ربط نوع خدمة الموارد البشرية يحتاج مراجعة مستقلة ولا يُنشأ له source map هنا.` } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.arz.hr_service_financial_lineage.reused', entityType: 'FinanceOutflowDocument', entityId: document.id, requestId: `nurix-arz-hr-service-lineage:${row.invoice.sourceId}`, afterJson: { sourceServiceId: row.service.sourceId, sourceInvoiceId: row.invoice.sourceId, sourceLedgerId: row.invoice.ledgers[0].sourceId, sourceChecksum: row.sourceChecksum, preservedHrTypeReview: true } } });
    });
    await database.inTenantTransaction(tenantId, async (tx) => {
      const items = await tx.nurixExcelFinancialItem.count({ where: { executionId: execution.id, status: 'REUSED' } });
      if (items !== rows.length) throw new Error('ARZ financial lineage did not reconcile every reviewed source invoice.');
      await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: 'COMMITTED', postedItems: 0, reusedItems: items, reviewItems: preflight.hrTypeReviews.length, failedItems: 0, committedAt: new Date(), reconciliationHash: planSha } });
      await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', reason: `Reused ${items} exact financial documents; retained ${preflight.hrTypeReviews.length} HR service-type reviews.`, waveSequence: 1 } });
    });
    console.log(JSON.stringify({ status: 'COMPLETED', version: VERSION, planSha, financialLineageRows: rows.length, retainedHrTypeReviews: preflight.hrTypeReviews }, null, 2));
  }
} finally { await app?.close(); }
