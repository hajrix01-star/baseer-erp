/**
 * Corrects historical operational HR-service dates to Noorix operation dates.
 *
 * This is deliberately a non-financial repair: it refuses any service with a
 * supplier, category or outflow document, preserves all source annotations,
 * and sets issueDate to the source invoice operation date while clearing
 * expiryDate under the owner-approved historical-date policy.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-al-shami-operational-hr-service-evidence/v1';
const REPAIR_VERSION = 'nurix-al-shami-operational-hr-service-operation-date-repair/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_HR_SERVICE_OPERATION_DATE_REPAIR_V1';
const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const day = (value) => new Date(`${value}T00:00:00.000Z`);

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-al-shami-hr-service-evidence-operation-date-repair.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
}
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') throw new Error('This repair only permits the canonical local Baseer test database.');

const sourceSql = `
SELECT coalesce(json_agg(row ORDER BY row->>'operationDate'), '[]'::json)::text
FROM (
  SELECT json_build_object('sourceServiceId', r.id, 'sourceInvoiceId', i.id, 'invoiceNumber', i.invoice_number, 'operationDate', to_char(i.transaction_date::date, 'YYYY-MM-DD')) AS row
  FROM employee_residencies r JOIN invoices i ON i.id=r.invoice_id AND i.company_id=r.company_id
  WHERE r.company_id='${SOURCE_COMPANY_ID}' AND i.kind='hr_expense' AND i.status='active' AND (i.supplier_id IS NULL OR i.category_id IS NULL)
) source_rows;`;
const raw = execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
const rows = raw ? JSON.parse(raw) : null;
if (!Array.isArray(rows) || rows.length !== 4 || rows.some((row) => !row.sourceServiceId || !row.sourceInvoiceId || !row.invoiceNumber || !row.operationDate)) throw new Error('The reviewed Noorix evidence-only service set changed.');
const planSha = sha({ version: REPAIR_VERSION, rows });

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');

let app;
try {
  app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const database = app.get(DatabaseService);
  const preflight = await database.inTenantTransaction(tenantId, async (tx) => {
    const [packageRow, execution, maps] = await Promise.all([
      tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID }, select: { id: true } }),
      tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: VERSION } }, select: { id: true, status: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixEmployeeService', sourceId: { in: rows.map((row) => row.sourceServiceId) } }, select: { sourceId: true, targetId: true, execution: { select: { transformVersion: true } } } }),
    ]);
    if (!packageRow || !execution || execution.status !== 'COMPLETED') throw new Error('The completed operational-service evidence execution is unavailable.');
    const mapsBySource = new Map(maps.filter((map) => map.execution.transformVersion === VERSION).map((map) => [map.sourceId, map.targetId]));
    if (mapsBySource.size !== rows.length) throw new Error('The four historical evidence services are not fully mapped.');
    const services = await tx.hrEmployeeService.findMany({ where: { tenantId, companyId, id: { in: [...mapsBySource.values()] } }, select: { id: true, issueDate: true, expiryDate: true, supplierId: true, categoryId: true, outflowDocumentId: true, notes: true } });
    if (services.length !== rows.length || services.some((service) => service.supplierId || service.categoryId || service.outflowDocumentId)) throw new Error('A target evidence service crossed the non-financial boundary.');
    const serviceById = new Map(services.map((service) => [service.id, service]));
    return rows.map((row) => {
      const targetId = mapsBySource.get(row.sourceServiceId);
      const service = serviceById.get(targetId);
      if (!service) throw new Error('Mapped service is unavailable.');
      const expectedDate = row.operationDate;
      const currentIssueDate = service.issueDate?.toISOString().slice(0, 10) ?? null;
      const currentExpiryDate = service.expiryDate?.toISOString().slice(0, 10) ?? null;
      return { ...row, targetId, currentIssueDate, currentExpiryDate, needsRepair: currentIssueDate !== expectedDate || currentExpiryDate !== null, priorNotes: service.notes ?? '' };
    });
  });
  const dryRun = { status: 'PARSED_DRY_RUN', version: REPAIR_VERSION, planSha, services: preflight.map((row) => ({ sourceServiceId: row.sourceServiceId, invoiceNumber: row.invoiceNumber, targetServiceId: row.targetId, priorIssueDate: row.currentIssueDate, priorExpiryDate: row.currentExpiryDate, targetIssueDate: row.operationDate, targetExpiryDate: null, needsRepair: row.needsRepair })), repairCount: preflight.filter((row) => row.needsRepair).length, financialWrites: 0 };
  console.log(JSON.stringify(dryRun, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
      const repaired = [];
      for (const row of preflight) {
        const service = await tx.hrEmployeeService.findFirst({ where: { id: row.targetId, tenantId, companyId, supplierId: null, categoryId: null, outflowDocumentId: null }, select: { id: true, issueDate: true, expiryDate: true, notes: true } });
        if (!service) throw new Error(`Service ${row.targetId} changed after dry-run; no repair was applied.`);
        const note = `تم ضبط تاريخ الخدمة التاريخية على تاريخ العملية المصدر: ${row.operationDate}؛ تم تجاهل تاريخي البدء/الانتهاء وفق قرار الترحيل.`;
        const notes = service.notes?.includes(note) ? service.notes : [service.notes, note].filter(Boolean).join('\n');
        await tx.hrEmployeeService.update({ where: { id: service.id }, data: { issueDate: day(row.operationDate), expiryDate: null, notes } });
        repaired.push({ serviceId: service.id, sourceServiceId: row.sourceServiceId, issueDate: row.operationDate, expiryDate: null });
      }
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.hr_service_operation_date_repaired', entityType: 'HrEmployeeService', entityId: repaired[0]?.serviceId ?? companyId, requestId: `nurix-al-shami-hr-service-operation-date-repair:${planSha}`, afterJson: { planSha, repaired, policy: 'Operational evidence uses Noorix invoice operation date only; issue/expiry source dates are retained in source evidence but not operational fields.' } } });
      return repaired;
    });
    console.log(JSON.stringify({ status: 'COMPLETED', ...dryRun, repaired: receipt }, null, 2));
  }
} finally {
  await app?.close();
}
