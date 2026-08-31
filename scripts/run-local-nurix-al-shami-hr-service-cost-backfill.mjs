/**
 * Owner-gated historical Noorix employee-service cost writer for Al-Shami.
 *
 * Only services that have an active source invoice + exact active ledger +
 * employee/vault/supplier/category maps are posted.  Rows missing a source
 * supplier or category are deliberately returned as evidence-only: a service
 * type/name must never invent an expense classification.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-al-shami-historical-hr-service-cost/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_HR_SERVICE_COST_BACKFILL_V1';
const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fixed = (value, label = 'amount') => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Invalid ${label}.`);
  return number.toFixed(4);
};
const day = (value) => new Date(`${value}T00:00:00.000Z`);

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-al-shami-hr-service-cost-backfill.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
}

const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') {
  throw new Error('This writer only permits the canonical local Baseer test database.');
}

const sourceSql = `
SELECT coalesce(json_agg(row ORDER BY row->'invoice'->>'businessDate', row->'invoice'->>'number'), '[]'::json)::text
FROM (
  SELECT json_build_object(
    'service', json_build_object(
      'sourceId', r.id,
      'employeeSourceId', r.employee_id,
      'serviceCategory', r.service_category,
      'referenceNumber', coalesce(nullif(r.iqama_number, ''), nullif(r.reference_label, '')),
      'visaDurationMonths', nullif(r.metadata->>'visaDurationMonths', '')::int,
      'notes', coalesce(r.notes, '')
    ),
    'invoice', json_build_object(
      'sourceId', i.id,
      'number', i.invoice_number,
      'businessDate', to_char(i.transaction_date::date, 'YYYY-MM-DD'),
      'amount', i.total_amount::text,
      'status', i.status,
      'vaultSourceId', i.vault_id,
      'supplierSourceId', i.supplier_id,
      'categorySourceId', i.category_id,
      'notes', coalesce(i.notes, ''),
      'ledgers', coalesce((
        SELECT json_agg(json_build_object(
          'sourceId', l.id, 'status', l.status, 'referenceType', l.reference_type,
          'businessDate', to_char(l.transaction_date::date, 'YYYY-MM-DD'),
          'amount', l.amount::text, 'vaultSourceId', l.vault_id,
          'debitCode', da.code, 'creditCode', ca.code
        ) ORDER BY l.id)
        FROM ledger_entries l
        LEFT JOIN accounts da ON da.id=l.debit_account_id
        LEFT JOIN accounts ca ON ca.id=l.credit_account_id
        WHERE l.company_id=i.company_id AND l.reference_id=i.id
      ), '[]'::json)
    )
  ) AS row
  FROM employee_residencies r
  JOIN invoices i ON i.id=r.invoice_id AND i.company_id=r.company_id
  WHERE r.company_id='${SOURCE_COMPANY_ID}' AND i.kind='hr_expense' AND i.status='active'
) source_rows;`;

const raw = execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
if (!raw) throw new Error('No Noorix employee-service source was returned.');
const rows = JSON.parse(raw);
if (!Array.isArray(rows) || rows.length !== 8) throw new Error('The reviewed Al-Shami HR-service source set changed.');

const serviceType = (value) => ({
  iqama_renewal: 'IQAMA_RENEWAL',
  sponsorship_transfer: 'SPONSORSHIP_TRANSFER',
  exit_reentry_visa: 'EXIT_REENTRY_VISA',
  flight_ticket: 'FLIGHT_TICKET',
  health_certificate: 'HEALTH_CERTIFICATE',
}[value] ?? null);

for (const row of rows) {
  const service = row.service;
  const invoice = row.invoice;
  if (!service?.sourceId || !service.employeeSourceId || !serviceType(service.serviceCategory) || !invoice?.sourceId || !invoice.number || !invoice.businessDate || invoice.status !== 'active') {
    throw new Error('A source employee-service row is incomplete or has an unsupported type.');
  }
  const amount = fixed(invoice.amount, invoice.number);
  if (!invoice.vaultSourceId || !Array.isArray(invoice.ledgers) || invoice.ledgers.length !== 1) throw new Error(`Service invoice ${invoice.number} lacks one exact source ledger.`);
  const ledger = invoice.ledgers[0];
  if (ledger.status !== 'active' || ledger.referenceType !== 'invoice' || ledger.businessDate !== invoice.businessDate || ledger.vaultSourceId !== invoice.vaultSourceId || fixed(ledger.amount, ledger.sourceId) !== amount || !ledger.debitCode?.startsWith('EXP-') || !ledger.creditCode?.startsWith('V-')) {
    throw new Error(`Service invoice ${invoice.number} lacks active expense/vault source evidence.`);
  }
  row.sourceChecksum = sha(row);
}

const eligible = rows.filter((row) => row.invoice.supplierSourceId && row.invoice.categorySourceId);
const evidenceOnly = rows.filter((row) => !row.invoice.supplierSourceId || !row.invoice.categorySourceId);
if (eligible.length !== 4 || fixed(eligible.reduce((sum, row) => sum + Number(row.invoice.amount), 0), 'eligible total') !== '5150.0000') throw new Error('The approved financial employee-service subset changed.');
if (evidenceOnly.length !== 4 || fixed(evidenceOnly.reduce((sum, row) => sum + Number(row.invoice.amount), 0), 'evidence total') !== '3337.0000') throw new Error('The evidence-only employee-service subset changed.');
const planSha = sha({ version: VERSION, eligible: eligible.map((row) => [row.service.sourceId, row.invoice.sourceId, row.sourceChecksum]) });

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { PurchaseExpenseService } = await import('../apps/api/dist/finance/purchase-expense.service.js');
const { FinanceVaultPaymentMethod, HrEmployeeFinancialMovementType, HrEmployeeServiceStatus } = await import('../apps/api/dist/generated/prisma/client.js');

const context = { tenantId, companyId, actorUserId };
let app;
try {
  app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const database = app.get(DatabaseService);
  const documents = app.get(PurchaseExpenseService);

  const preflight = await database.inTenantTransaction(tenantId, async (tx) => {
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, status: 'READY_FOR_RECONCILIATION' }, select: { id: true } });
    if (!packageRow) throw new Error('The selected package is not the approved Al-Shami package.');
    const employeeSourceIds = eligible.map((row) => row.service.employeeSourceId);
    const vaultSourceIds = eligible.map((row) => row.invoice.vaultSourceId);
    const supplierSourceIds = eligible.map((row) => row.invoice.supplierSourceId);
    const categorySourceIds = eligible.map((row) => row.invoice.categorySourceId);
    const [employeeMaps, vaultMaps, supplierMaps, categoryMaps] = await Promise.all([
      tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: employeeSourceIds }, targetId: { not: null }, status: { in: ['CREATED', 'REUSED'] }, execution: { packageId, targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', sourceId: { in: vaultSourceIds }, targetEntity: 'FinanceVault', state: { in: ['APPLIED', 'REUSED'] } }, select: { sourceId: true, targetId: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Supplier', sourceId: { in: supplierSourceIds }, targetEntity: 'FinanceSupplier', state: { in: ['APPLIED', 'REUSED'] } }, select: { sourceId: true, targetId: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'CategoryAudit', sourceId: { in: categorySourceIds }, targetEntity: 'FinanceCategory', state: 'APPLIED' }, select: { sourceId: true, targetId: true } }),
    ]);
    const map = (records, sourceIds, label) => {
      const values = new Map(records.map((record) => [record.sourceId, record.targetId]));
      if (new Set(sourceIds).size !== values.size || [...new Set(sourceIds)].some((sourceId) => !values.get(sourceId))) throw new Error(`${label} mapping is incomplete.`);
      return values;
    };
    const employeeIdBySource = map(employeeMaps, employeeSourceIds, 'Employee');
    const vaultIdBySource = map(vaultMaps, vaultSourceIds, 'Vault');
    const supplierIdBySource = map(supplierMaps, supplierSourceIds, 'Supplier');
    // A mapped category can still be a parent/heading without a posting
    // account.  That is a review condition, not a reason to let APPLY begin
    // and discover the problem after another source row has committed.
    const categoryIdBySource = new Map(categoryMaps.map((record) => [record.sourceId, record.targetId]));
    const [employees, vaults, suppliers, categories] = await Promise.all([
      tx.hrEmployee.findMany({ where: { tenantId, companyId, id: { in: [...employeeIdBySource.values()] }, status: { in: ['ACTIVE', 'ON_LEAVE'] } }, select: { id: true } }),
      tx.financeVault.findMany({ where: { tenantId, companyId, id: { in: [...vaultIdBySource.values()] }, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, paymentMethod: true, paymentMethods: true } }),
      tx.financeSupplier.findMany({ where: { tenantId, companyId, id: { in: [...supplierIdBySource.values()] }, status: 'ACTIVE' }, select: { id: true } }),
      tx.financeCategory.findMany({ where: { tenantId, companyId, id: { in: [...categoryIdBySource.values()] } }, select: { id: true, status: true, isPosting: true, kind: true, account: { select: { id: true, status: true, type: true } } } }),
    ]);
    if (employees.length !== employeeIdBySource.size || vaults.length !== vaultIdBySource.size || suppliers.length !== supplierIdBySource.size) throw new Error('A mapped employee, vault, or supplier is not currently operational.');
    const vaultById = new Map(vaults.map((vault) => [vault.id, vault]));
    const categoryById = new Map(categories.map((category) => [category.id, category]));
    for (const targetVault of vaults) if (!targetVault.paymentMethods.includes(targetVault.paymentMethod)) throw new Error('A mapped vault has no enabled default payment method.');
    const categoryFailure = (row) => {
      const categoryId = categoryIdBySource.get(row.invoice.categorySourceId);
      const category = categoryId ? categoryById.get(categoryId) : null;
      if (!category) return 'CATEGORY_MAP_MISSING';
      if (category.status !== 'ACTIVE' || !category.isPosting || category.kind !== 'EXPENSE') return 'CATEGORY_NOT_POSTABLE';
      if (!category.account || category.account.status !== 'ACTIVE' || !['EXPENSE', 'ASSET'].includes(category.account.type)) return 'CATEGORY_ACCOUNT_NOT_READY';
      return null;
    };
    const reviewRequired = eligible.filter((row) => categoryFailure(row)).map((row) => ({ sourceServiceId: row.service.sourceId, sourceInvoiceNumber: row.invoice.number, amount: fixed(row.invoice.amount), reason: categoryFailure(row) }));
    const writeRows = eligible.filter((row) => !categoryFailure(row));
    return { employeeIdBySource, vaultIdBySource, supplierIdBySource, categoryIdBySource, vaultById, writeRows, reviewRequired };
  });

  const dryRun = {
    status: 'PARSED_DRY_RUN', version: VERSION, planSha,
    sourceServices: rows.length, sourceProvenFinancialCandidates: eligible.length,
    sourceProvenCandidateAmount: fixed(eligible.reduce((sum, row) => sum + Number(row.invoice.amount), 0)),
    writeReadyServices: preflight.writeRows.length,
    writeReadyAmount: fixed(preflight.writeRows.reduce((sum, row) => sum + Number(row.invoice.amount), 0)),
    reviewRequiredServices: preflight.reviewRequired,
    evidenceOnlyServices: evidenceOnly.map((row) => ({ sourceServiceId: row.service.sourceId, sourceInvoiceNumber: row.invoice.number, amount: fixed(row.invoice.amount), missingSupplier: !row.invoice.supplierSourceId, missingCategory: !row.invoice.categorySourceId })),
    evidenceOnlyAmount: fixed(evidenceOnly.reduce((sum, row) => sum + Number(row.invoice.amount), 0)), financialWrites: 0,
  };
  console.log(JSON.stringify(dryRun, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    const execution = await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: VERSION } }, select: { id: true, financialPlanSha256: true, status: true } });
      if (existing) {
        if (existing.financialPlanSha256 !== planSha) throw new Error('Existing HR-service execution differs from the frozen source.');
        return existing;
      }
      return tx.nurixExcelFinancialExecution.create({ data: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion: VERSION, financialPlanSha256: planSha, status: 'RUNNING', reason: 'Owner-authorized Al-Shami historical HR-service costs with complete source financial evidence only.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date(), waveSequence: 1 }, select: { id: true, financialPlanSha256: true, status: true } });
    });
    const wave = await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialWave.findUnique({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, select: { id: true, status: true } });
      return existing ?? tx.nurixExcelFinancialWave.create({ data: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sequence: 1, status: 'RUNNING', plannedItems: preflight.writeRows.length }, select: { id: true, status: true } });
    });

    const receipts = [];
    // APPLY receives only the complete prevalidated set.  A target category
    // without an active posting account is reported in dry-run as review and
    // cannot cause a later per-row transaction to fail after a prior commit.
    for (const row of preflight.writeRows) {
      const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
        const existingMaps = await tx.nurixExcelFinancialSourceMap.findMany({ where: { executionId: execution.id, sourceId: { in: [row.service.sourceId, row.invoice.sourceId, row.invoice.ledgers[0].sourceId] } }, select: { sourceEntity: true, sourceId: true, targetEntity: true, targetId: true, sourceChecksum: true } });
        if (existingMaps.length) {
          if (existingMaps.length !== 3 || existingMaps.some((item) => item.sourceChecksum !== row.sourceChecksum)) throw new Error(`Incomplete or conflicting resume map for ${row.invoice.number}.`);
          const serviceMap = existingMaps.find((item) => item.sourceEntity === 'NoorixEmployeeService');
          const documentMap = existingMaps.find((item) => item.sourceEntity === 'NoorixEmployeeServiceInvoice');
          if (!serviceMap || !documentMap) throw new Error(`Resume maps have invalid entity types for ${row.invoice.number}.`);
          const service = await tx.hrEmployeeService.findFirst({ where: { id: serviceMap.targetId, tenantId, companyId, status: HrEmployeeServiceStatus.ISSUED, outflowDocumentId: documentMap.targetId }, select: { id: true } });
          const document = await tx.financeOutflowDocument.findFirst({ where: { id: documentMap.targetId, tenantId, companyId, status: 'POSTED', supplierInvoiceNumber: row.invoice.number, grossAmount: fixed(row.invoice.amount), businessDate: day(row.invoice.businessDate) }, select: { id: true, documentNumber: true, journalEntryId: true } });
          if (!service || !document) throw new Error(`Resumed service document ${row.invoice.number} does not match the source.`);
          return { ...document, serviceId: service.id, sourceInvoiceNumber: row.invoice.number, reused: true };
        }

        // The application method intentionally keeps service + outflow + vault allocation
        // in one transaction.  The following calls are its migration-only equivalent,
        // with the source maps and annotations appended before that transaction commits.
        const request = documents.normaliseRecordedEmployeeService({
          employeeId: preflight.employeeIdBySource.get(row.service.employeeSourceId),
          serviceType: serviceType(row.service.serviceCategory),
          referenceNumber: row.service.referenceNumber ?? undefined,
          visaDurationMonths: row.service.visaDurationMonths ?? undefined,
          supplierId: preflight.supplierIdBySource.get(row.invoice.supplierSourceId),
          categoryId: preflight.categoryIdBySource.get(row.invoice.categorySourceId),
          businessDate: day(row.invoice.businessDate), grossAmount: fixed(row.invoice.amount), isTaxable: false,
          allocations: [{ vaultId: preflight.vaultIdBySource.get(row.invoice.vaultSourceId), grossAmount: fixed(row.invoice.amount), paymentMethod: preflight.vaultById.get(preflight.vaultIdBySource.get(row.invoice.vaultSourceId)).paymentMethod }],
          supplierInvoiceNumber: row.invoice.number, supplierInvoiceDate: day(row.invoice.businessDate),
          notes: row.service.notes || row.invoice.notes || `Noorix ${row.invoice.number}`,
        });
        const idempotencyKey = `nurix-al-shami-historical-hr-service:${row.invoice.sourceId}`;
        const begun = await documents.idem.beginInTransaction(tx, context, { operation: 'hr.employee_service.historical_record_and_issue', key: idempotencyKey, request: documents.recordedEmployeeServicePayload(request), expiresAt: new Date(Date.now() + 86_400_000) });
        if (begun.kind !== 'started') throw new Error(`Unexpected idempotency state for unmapped ${row.invoice.number}.`);
        const service = await documents.hr.createHistoricalServiceForFinancialIssueInTransaction(tx, context, documents.employeeServiceCreateInput(request));
        const document = await documents.postDocument(tx, context, {
          kind: 'EXPENSE', settlementKind: 'PAID', categoryId: request.categoryId, supplierId: request.supplierId,
          businessDate: request.businessDate, grossAmount: request.grossAmount, isTaxable: request.isTaxable, allocations: request.allocations,
          supplierInvoiceNumber: request.supplierInvoiceNumber, supplierInvoiceDate: request.supplierInvoiceDate, notes: request.notes,
        }, `hr-employee-service-historical-record:${idempotencyKey}`);
        await tx.hrEmployeeService.update({ where: { id: service.id }, data: { status: HrEmployeeServiceStatus.ISSUED, outflowDocumentId: document.documentId } });
        await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId, companyId, employeeId: service.employeeId, journalEntryId: document.journalEntryId, movementType: HrEmployeeFinancialMovementType.SERVICE_COST, businessDate: request.businessDate, amount: request.grossAmount, sourceReference: document.documentNumber, description: request.notes ?? null } });
        await tx.nurixExcelFinancialItem.create({ data: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sourceSheet: 'EmployeeServices', sourceEntity: 'NoorixEmployeeServiceInvoice', sourceId: row.invoice.sourceId, sourceChecksum: row.sourceChecksum, operationKey: sha({ version: VERSION, sourceInvoiceId: row.invoice.sourceId }), status: 'POSTED', targetEntity: 'FinanceOutflowDocument', targetId: document.documentId, resultCode: 'POSTED_HISTORICAL_EMPLOYEE_SERVICE_COST' } });
        await tx.nurixExcelFinancialSourceMap.createMany({ data: [
          { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixEmployeeService', sourceId: row.service.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeService', targetId: service.id, state: 'APPLIED' },
          { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixEmployeeServiceInvoice', sourceId: row.invoice.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: document.documentId, state: 'APPLIED' },
          { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixEmployeeServiceLedger', sourceId: row.invoice.ledgers[0].sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'FinanceJournalEntry', targetId: document.journalEntryId, state: 'APPLIED' },
        ] });
        for (const [sourceEntity, sourceId, text] of [['EmployeeResidency', row.service.sourceId, row.service.notes], ['Invoice', row.invoice.sourceId, row.invoice.notes]]) {
          if (!text) continue;
          await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity, sourceId, field: 'notes' } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity, sourceId, sourceChecksum: row.sourceChecksum, targetEntity: sourceEntity === 'Invoice' ? 'FinanceOutflowDocument' : 'HrEmployeeService', targetId: sourceEntity === 'Invoice' ? document.documentId : service.id, field: 'notes', exactText: text }, update: { sourceChecksum: row.sourceChecksum, targetEntity: sourceEntity === 'Invoice' ? 'FinanceOutflowDocument' : 'HrEmployeeService', targetId: sourceEntity === 'Invoice' ? document.documentId : service.id, exactText: text } });
        }
        const receipt = { serviceId: service.id, documentId: document.documentId, documentNumber: document.documentNumber, journalEntryId: document.journalEntryId, replayed: false };
        await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.hr_employee_service_cost_backfill.posted', entityType: 'HrEmployeeService', entityId: service.id, requestId: `nurix-al-shami-hr-service:${row.invoice.sourceId}`, afterJson: { sourceServiceId: row.service.sourceId, sourceInvoiceId: row.invoice.sourceId, sourceLedgerId: row.invoice.ledgers[0].sourceId, sourceChecksum: row.sourceChecksum, receipt } } });
        await documents.idem.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
        return { ...receipt, sourceInvoiceNumber: row.invoice.number, reused: false };
      });
      receipts.push(receipt);
    }
    await database.inTenantTransaction(tenantId, async (tx) => {
      const postedItems = await tx.nurixExcelFinancialItem.count({ where: { executionId: execution.id, status: 'POSTED' } });
      const reusedItems = await tx.nurixExcelFinancialItem.count({ where: { executionId: execution.id, status: 'REUSED' } });
      if (postedItems + reusedItems !== preflight.writeRows.length) throw new Error('The HR-service wave did not reach every prevalidated source invoice.');
      await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: 'COMMITTED', postedItems, reusedItems, reviewItems: evidenceOnly.length + preflight.reviewRequired.length, failedItems: 0, committedAt: new Date(), reconciliationHash: planSha } });
      await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', reason: `Posted ${preflight.writeRows.length} prevalidated employee-service costs; retained ${evidenceOnly.length + preflight.reviewRequired.length} source rows as evidence/review only.`, waveSequence: 1 } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.hr_employee_service_cost_backfill.completed', entityType: 'NurixExcelFinancialExecution', entityId: execution.id, requestId: `nurix-al-shami-hr-service-complete:${planSha}`, afterJson: { ...dryRun, receipts } } });
    });
    console.log(JSON.stringify({ status: 'COMPLETED', version: VERSION, planSha, receipts, evidenceOnly: dryRun.evidenceOnlyServices }, null, 2));
  }
} finally {
  await app?.close();
}
