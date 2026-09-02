/**
 * Retains only verified cancelled Noorix invoices as migration evidence.
 *
 * This writer never creates a supplier document, cash event, payroll, advance,
 * journal, or report amount.  It exists because a cancelled source invoice is
 * still a source fact that must be auditable before a company migration lock
 * can be lifted.  Active lifecycle rows are deliberately refused here.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-cancelled-invoice-evidence/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_CANCELLED_INVOICE_EVIDENCE_V1';
const SOURCE_ARCHIVE_SHA256 = '25173059779AF2DB845F905CA7FC1CCB1BE367165F6B5A9819A38BB066981261';
const SOURCE_CONTAINER = 'baseer-noorix-snapshot-20260902';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scopes = new Map([
  ['7e64301f-c87e-4d98-9881-35328ace117b', { sourceCompanyId: 'cmnf604ka009ay8lm556wgd9c', expectedCount: 27, label: 'ARZ' }],
  ['4af6969a-161f-4e13-8acc-103d8aa26a70', { sourceCompanyId: 'cmnaivif80001wavxxfgriptm', expectedCount: 49, label: 'المعلم الشامي' }],
]);

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-cancelled-invoice-evidence-backfill.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
}
const scope = scopes.get(companyId);
if (!scope) throw new Error('This evidence writer is explicitly limited to ARZ or المعلم الشامي.');

const env = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (env.error) throw env.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('This writer only permits the canonical local Baseer test database.');
}

const querySource = (ids) => {
  if (!ids.length) return [];
  if (ids.some((id) => !/^[a-z0-9]+$/i.test(id))) throw new Error('Unsafe source identifier.');
  const sql = `SELECT id,kind,status,coalesce(invoice_number,''),to_char(transaction_date::date,'YYYY-MM-DD'),total_amount::text FROM invoices WHERE company_id='${scope.sourceCompanyId}' AND id IN (${ids.map((id) => `'${id}'`).join(',')}) ORDER BY id`;
  const output = execFileSync('docker', ['exec', SOURCE_CONTAINER, 'psql', '-U', 'nurix_restore', '-d', 'nurix_snapshot', '-t', '-A', '-F', '\t', '-c', sql], { encoding: 'utf8' }).trim();
  return output ? output.split(/\r?\n/).map((line) => {
    const [sourceId, kind, status, documentNumber, businessDate, grossAmount] = line.split('\t');
    return { sourceId, kind, status, documentNumber, businessDate, grossAmount };
  }) : [];
};

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
try {
  const database = app.get(DatabaseService);
  const input = await database.inTenantTransaction(tenantId, async (tx) => {
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({
      where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: scope.sourceCompanyId, status: 'READY_FOR_RECONCILIATION' },
      select: { id: true },
    });
    if (!packageRow) throw new Error('The verified package does not match the approved source and target company scope.');
    const exceptionRows = await tx.nurixExcelStagingRow.findMany({
      where: { packageId, tenantId, sheet: 'Exceptions', status: 'ACCEPTED' },
      select: { sourceId: true },
    });
    const maps = await tx.nurixExcelFinancialSourceMap.findMany({
      where: { tenantId, targetCompanyId: companyId, state: { in: ['APPLIED', 'REUSED', 'REVERSED'] }, execution: { status: 'COMPLETED' } },
      select: { sourceId: true },
    });
    const mapped = new Set(maps.map((row) => row.sourceId));
    return { candidateIds: [...new Set(exceptionRows.map((row) => row.sourceId).filter((id) => !mapped.has(id)))].sort() };
  });

  const sources = querySource(input.candidateIds);
  const sourceById = new Map(sources.map((row) => [row.sourceId, row]));
  if (sources.length !== input.candidateIds.length || input.candidateIds.some((id) => !sourceById.has(id))) throw new Error('One or more unclosed exception IDs is absent from the frozen Noorix archive.');
  const cancelled = sources.filter((row) => row.status === 'cancelled');
  const active = sources.filter((row) => row.status === 'active');
  if (cancelled.length !== scope.expectedCount || cancelled.some((row) => !['purchase', 'expense', 'fixed_expense', 'salary', 'advance'].includes(row.kind))) {
    throw new Error(`The reviewed cancelled-evidence set changed for ${scope.label}.`);
  }
  const plan = cancelled.map((row) => ({ ...row, sourceChecksum: sha({ sourceArchiveSha256: SOURCE_ARCHIVE_SHA256, invoice: row }) }));
  const planChecksum = sha({ version: VERSION, sourceArchiveSha256: SOURCE_ARCHIVE_SHA256, packageId, companyId, rows: plan.map((row) => [row.sourceId, row.sourceChecksum]) });
  const dryRun = {
    status: 'PARSED_DRY_RUN', version: VERSION, planChecksum, company: scope.label,
    cancelledEvidenceOnly: plan.length,
    byKind: Object.fromEntries([...new Set(plan.map((row) => row.kind))].sort().map((kind) => [kind, plan.filter((row) => row.kind === kind).length])),
    activeRowsLeftForSpecialist: active.length,
    financialWrites: 0,
  };
  console.log(JSON.stringify(dryRun, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findFirst({ where: { packageId, tenantId, transformVersion: VERSION }, select: { id: true, status: true, financialPlanSha256: true } });
      if (existing) {
        if (existing.status !== 'COMPLETED' || existing.financialPlanSha256 !== planChecksum) throw new Error('The cancelled-source evidence execution is not safely resumable.');
        return { status: 'REUSED_COMPLETED', executionId: existing.id, evidenceRows: plan.length, financialWrites: 0 };
      }
      const executionId = randomUUID(); const waveId = randomUUID();
      const reconciliation = { version: VERSION, sourceArchiveSha256: SOURCE_ARCHIVE_SHA256, evidenceRows: plan.length, financialWrites: 0, targetDocuments: 0, journals: 0, activeRowsLeftForSpecialist: active.length };
      const reconciliationHash = sha(reconciliation);
      await tx.nurixExcelFinancialExecution.create({ data: { id: executionId, packageId, tenantId, targetCompanyId: companyId, transformVersion: VERSION, financialPlanSha256: planChecksum, status: 'APPROVED', reason: 'Verified cancelled Noorix invoices retained as evidence only; no document, cash, payroll, advance, or journal is created.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date() } });
      await tx.nurixExcelFinancialWave.create({ data: { id: waveId, executionId, tenantId, targetCompanyId: companyId, sequence: 1, status: 'COMMITTED', plannedItems: plan.length, postedItems: 0, reusedItems: 0, reviewItems: plan.length, failedItems: 0, committedAt: new Date(), reconciliationHash } });
      await tx.nurixExcelFinancialItem.createMany({ data: plan.map((row) => ({ id: randomUUID(), executionId, waveId, tenantId, targetCompanyId: companyId, sourceSheet: 'Exceptions', sourceEntity: 'NoorixCancelledInvoiceEvidence', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, operationKey: sha({ version: VERSION, sourceId: row.sourceId }), status: 'EXCLUDED', targetEntity: 'NoorixCancelledSourceEvidence', targetId: row.sourceId, resultCode: 'SOURCE_CANCELLED_EVIDENCE_ONLY' })) });
      for (const row of plan) await tx.nurixExcelFinancialSourceMap.create({ data: { id: randomUUID(), executionId, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixCancelledInvoiceEvidence', sourceId: row.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'NoorixCancelledSourceEvidence', targetId: row.sourceId, state: 'APPLIED' } });
      await tx.nurixExcelFinancialReceipt.create({ data: { id: randomUUID(), executionId, waveId, tenantId, targetCompanyId: companyId, sequence: 1, kind: 'RECONCILIATION', receiptSha256: reconciliationHash, summaryJson: reconciliation, createdByUserId: actorUserId } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.cancelled_invoice_evidence.completed', entityType: 'NurixExcelFinancialExecution', entityId: executionId, requestId: `nurix-cancelled-invoice-evidence:${planChecksum}`, afterJson: reconciliation } });
      await tx.nurixExcelFinancialExecution.update({ where: { id: executionId }, data: { status: 'COMPLETED', waveSequence: 1, reason: null } });
      return { status: 'COMPLETED', executionId, evidenceRows: plan.length, financialWrites: 0 };
    });
    console.log(JSON.stringify(receipt, null, 2));
  }
} finally {
  await app.close();
}
