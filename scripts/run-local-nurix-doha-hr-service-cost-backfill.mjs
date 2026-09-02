/**
 * Owner-gated, source-proven historical employee-service cost writer for Doha.
 *
 * This is deliberately narrower than the general Noorix financial importer:
 * it handles only Noorix `hr_expense` invoices that are joined to an employee
 * residency/service row.  The writer refuses to infer a supplier, but a
 * missing supplier is valid historical evidence when the source had none.
 * Classification is instead derived from the recorded service type through
 * Baseer's central service-category policy (Iqama -> E2-4, medical -> E4-2).
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-doha-historical-hr-service-cost/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_DOHA_HR_SERVICE_COST_BACKFILL_V1';
const SOURCE_COMPANY_ID = 'cmnf5xrd0001uy8lm8vja50gp';
const SOURCE_CONTAINER = 'baseer-noorix-snapshot-20260902';
const SOURCE_DATABASE = 'nurix_snapshot';
const FALLBACK_SUPPLIER_NAME_AR = 'جهة غير مسماة في نوركس — دوحة المستهلك';
const FALLBACK_SUPPLIER_NAME_EN = 'Unnamed Noorix source counterparty — Doha Consumer';
const UUID = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const date = (value) => new Date(`${value}T00:00:00.000Z`);
const amount = (value, label = 'amount') => {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`Invalid ${label}.`);
  return number.toFixed(4);
};

const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => UUID.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) {
  throw new Error(`Usage: node scripts/run-local-nurix-doha-hr-service-cost-backfill.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
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

const raw = execFileSync('docker', ['exec', SOURCE_CONTAINER, 'psql', '-U', 'nurix_restore', '-d', SOURCE_DATABASE, '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
if (!raw) throw new Error('No Noorix employee-service source was returned.');
const rows = JSON.parse(raw);
if (!Array.isArray(rows) || rows.length !== 3) throw new Error('The frozen Doha HR-service source set changed; manual review is required.');

// These are Baseer's central categories for the corresponding HR service
// types.  The source records corroborate them with explicit service type,
// Arabic invoice text, and the active EXP-002/V-002 ledger pair.
const policy = {
  iqama_renewal: { serviceType: 'IQAMA_RENEWAL', categoryCode: 'E2-4' },
  medical_insurance: { serviceType: 'MEDICAL_INSURANCE', categoryCode: 'E4-2' },
};
for (const row of rows) {
  const service = row.service;
  const invoice = row.invoice;
  const servicePolicy = policy[service?.serviceCategory];
  if (!service?.sourceId || !service.employeeSourceId || !servicePolicy || !invoice?.sourceId || !invoice.number || !invoice.businessDate || invoice.status !== 'active') {
    throw new Error('A Doha employee-service row is incomplete or not supported by the central service policy.');
  }
  if (!invoice.vaultSourceId || !Array.isArray(invoice.ledgers) || invoice.ledgers.length !== 1) throw new Error(`Service invoice ${invoice.number} lacks exactly one source ledger.`);
  const ledger = invoice.ledgers[0];
  if (ledger.status !== 'active' || ledger.referenceType !== 'invoice' || ledger.businessDate !== invoice.businessDate || ledger.vaultSourceId !== invoice.vaultSourceId || amount(ledger.amount, ledger.sourceId) !== amount(invoice.amount, invoice.number) || ledger.debitCode !== 'EXP-002' || ledger.creditCode !== 'V-002') {
    throw new Error(`Service invoice ${invoice.number} lacks complete active EXP-002/V-002 source evidence.`);
  }
  if (servicePolicy.serviceType === 'IQAMA_RENEWAL' && !service.referenceNumber) throw new Error(`Iqama renewal ${invoice.number} has no historical reference number.`);
  row.targetPolicy = servicePolicy;
  row.sourceChecksum = sha(row);
}
if (amount(rows.reduce((sum, row) => sum + Number(row.invoice.amount), 0), 'total') !== '4490.0000') throw new Error('The reviewed Doha HR-service financial total changed.');
const planSha = sha({ version: VERSION, rows: rows.map((row) => ({ serviceId: row.service.sourceId, invoiceId: row.invoice.sourceId, ledgerId: row.invoice.ledgers[0].sourceId, sourceChecksum: row.sourceChecksum, categoryCode: row.targetPolicy.categoryCode })) });

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { PurchaseExpenseService } = await import('../apps/api/dist/finance/purchase-expense.service.js');
const { FinanceVaultPaymentMethod, FinanceSupplierType, HrEmployeeFinancialMovementType, HrEmployeeServiceStatus } = await import('../apps/api/dist/generated/prisma/client.js');

const context = { tenantId, companyId, actorUserId };
let app;
try {
  app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const database = app.get(DatabaseService);
  const documents = app.get(PurchaseExpenseService);

  const preflight = await database.inTenantTransaction(tenantId, async (tx) => {
    const packageRow = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, status: 'READY_FOR_RECONCILIATION' }, select: { id: true } });
    const company = await tx.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true, migrationReviewLocked: true } });
    if (!packageRow) throw new Error('The selected package is not the approved Doha reconciliation package.');
    if (!company?.migrationReviewLocked) throw new Error('Doha must remain migration-review locked during historical migration.');

    const employeeSourceIds = rows.map((row) => row.service.employeeSourceId);
    const vaultSourceIds = rows.map((row) => row.invoice.vaultSourceId);
    const [employeeMaps, vaultMaps, categories, sourceMaps, existingDocuments, fallbackSuppliers] = await Promise.all([
      tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: employeeSourceIds }, targetId: { not: null }, status: { in: ['CREATED', 'REUSED'] }, execution: { packageId, targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', sourceId: { in: vaultSourceIds }, targetEntity: 'FinanceVault', state: { in: ['APPLIED', 'REUSED'] } }, select: { sourceId: true, targetId: true } }),
      tx.financeCategory.findMany({ where: { tenantId, companyId, code: { in: [...new Set(rows.map((row) => row.targetPolicy.categoryCode))] }, kind: 'EXPENSE', status: 'ACTIVE', isPosting: true }, select: { id: true, code: true, account: { select: { id: true, status: true } } } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceId: { in: rows.flatMap((row) => [row.service.sourceId, row.invoice.sourceId, row.invoice.ledgers[0].sourceId]) } }, select: { sourceEntity: true, sourceId: true, targetEntity: true, targetId: true, sourceChecksum: true, state: true } }),
      tx.financeOutflowDocument.findMany({ where: { tenantId, companyId, supplierInvoiceNumber: { in: rows.map((row) => row.invoice.number) } }, select: { id: true, documentNumber: true, journalEntryId: true, supplierInvoiceNumber: true, grossAmount: true, businessDate: true, categoryId: true, supplierId: true, status: true } }),
      tx.financeSupplier.findMany({ where: { tenantId, companyId, nameAr: FALLBACK_SUPPLIER_NAME_AR }, select: { id: true, nameAr: true, nameEn: true, categoryId: true, supplierType: true, status: true, taxNumber: true, isTaxRegistered: true } }),
    ]);
    const exactMap = (records, sourceIds, label) => {
      const mapped = new Map(records.map((record) => [record.sourceId, record.targetId]));
      if (mapped.size !== new Set(sourceIds).size || [...new Set(sourceIds)].some((id) => !mapped.get(id))) throw new Error(`${label} mapping is incomplete.`);
      return mapped;
    };
    const employeeIdBySource = exactMap(employeeMaps, employeeSourceIds, 'Employee');
    const vaultIdBySource = exactMap(vaultMaps, vaultSourceIds, 'Vault');
    const [employees, vaults] = await Promise.all([
      tx.hrEmployee.findMany({ where: { tenantId, companyId, id: { in: [...employeeIdBySource.values()] }, status: { in: ['ACTIVE', 'ON_LEAVE'] } }, select: { id: true } }),
      tx.financeVault.findMany({ where: { tenantId, companyId, id: { in: [...vaultIdBySource.values()] }, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, paymentMethod: true, paymentMethods: true } }),
    ]);
    if (employees.length !== employeeIdBySource.size || vaults.length !== vaultIdBySource.size) throw new Error('A mapped Doha employee or vault is not operational.');
    const vaultById = new Map(vaults.map((vault) => [vault.id, vault]));
    for (const vault of vaults) if (!vault.paymentMethods.includes(vault.paymentMethod)) throw new Error('A mapped Doha vault has no enabled default payment method.');
    const categoryIdByCode = new Map(categories.map((category) => [category.code, category.id]));
    for (const category of categories) if (!category.account || category.account.status !== 'ACTIVE') throw new Error(`Category ${category.code} does not have an active posting account.`);
    if (categoryIdByCode.size !== new Set(rows.map((row) => row.targetPolicy.categoryCode)).size) throw new Error('A central HR service category is missing or is not postable.');

    if (fallbackSuppliers.length > 1) throw new Error('More than one Doha historical missing-supplier fallback exists.');
    const fallbackSupplier = fallbackSuppliers[0] ?? null;
    if (fallbackSupplier && (fallbackSupplier.nameEn !== FALLBACK_SUPPLIER_NAME_EN || fallbackSupplier.categoryId !== null || fallbackSupplier.supplierType !== FinanceSupplierType.EXPENSE || fallbackSupplier.status !== 'ACTIVE' || fallbackSupplier.taxNumber !== null || fallbackSupplier.isTaxRegistered)) {
      throw new Error('The Doha historical missing-supplier fallback has been altered and cannot be reused safely.');
    }
    const documentsByInvoice = new Map(existingDocuments.map((document) => [document.supplierInvoiceNumber, document]));
    const sourceMapsById = new Map(sourceMaps.map((entry) => [entry.sourceId, entry]));
    const writeRows = [];
    const reuseRows = [];
    for (const row of rows) {
      const sourceIds = [row.service.sourceId, row.invoice.sourceId, row.invoice.ledgers[0].sourceId];
      const presentMaps = sourceIds.map((id) => sourceMapsById.get(id)).filter(Boolean);
      if (presentMaps.length && presentMaps.length !== 3) throw new Error(`Partial source maps found for ${row.invoice.number}; manual reconciliation is required.`);
      const expectedCategoryId = categoryIdByCode.get(row.targetPolicy.categoryCode);
      const existing = documentsByInvoice.get(row.invoice.number);
      if (existing) {
        if (!fallbackSupplier || existing.status !== 'POSTED' || amount(existing.grossAmount, existing.documentNumber) !== amount(row.invoice.amount) || existing.businessDate.toISOString().slice(0, 10) !== row.invoice.businessDate || existing.categoryId !== expectedCategoryId || existing.supplierId !== fallbackSupplier.id) throw new Error(`Existing document ${row.invoice.number} conflicts with source-proven employee-service evidence.`);
        reuseRows.push(row);
      } else {
        if (presentMaps.length) throw new Error(`Source maps for ${row.invoice.number} exist without its target document.`);
        writeRows.push(row);
      }
    }
    return { employeeIdBySource, vaultIdBySource, vaultById, categoryIdByCode, fallbackSupplier, writeRows, reuseRows };
  });

  const dryRun = {
    status: 'PARSED_DRY_RUN', version: VERSION, planSha,
    sourceServices: rows.length, sourceAmount: amount(rows.reduce((sum, row) => sum + Number(row.invoice.amount), 0)),
    writeReadyServices: preflight.writeRows.length, writeReadyAmount: amount(preflight.writeRows.reduce((sum, row) => sum + Number(row.invoice.amount), 0)),
    reusableExistingServices: preflight.reuseRows.map((row) => row.invoice.number),
    historicalFallbackSupplier: { action: preflight.fallbackSupplier ? 'REUSE' : 'CREATE_ON_APPLY', nameAr: FALLBACK_SUPPLIER_NAME_AR, sourceFact: 'Noorix supplier_id is empty for all three verified invoices; this is not a mapped Noorix supplier.' },
    classifications: rows.map((row) => ({ sourceInvoiceNumber: row.invoice.number, sourceServiceType: row.service.serviceCategory, targetServiceType: row.targetPolicy.serviceType, targetCategoryCode: row.targetPolicy.categoryCode, supplier: row.invoice.supplierSourceId ? 'MAPPED_REQUIRED' : 'HISTORICAL_SOURCE_MISSING_FALLBACK', vaultLedger: `${row.invoice.ledgers[0].debitCode}/${row.invoice.ledgers[0].creditCode}`, amount: amount(row.invoice.amount) })),
    financialWrites: 0,
  };
  console.log(JSON.stringify(dryRun, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    // The HR writer requires an active supplier even for an historical source
    // that contains no supplier_id.  This controlled fallback is transparent:
    // it is neither a Noorix Supplier map nor a claim about the real payee.
    const fallbackSupplier = await database.inTenantTransaction(tenantId, async (tx) => {
      const matches = await tx.financeSupplier.findMany({ where: { tenantId, companyId, nameAr: FALLBACK_SUPPLIER_NAME_AR }, select: { id: true, nameEn: true, categoryId: true, supplierType: true, status: true, taxNumber: true, isTaxRegistered: true } });
      if (matches.length > 1) throw new Error('More than one Doha historical missing-supplier fallback exists.');
      const existing = matches[0] ?? null;
      if (existing) {
        if (existing.nameEn !== FALLBACK_SUPPLIER_NAME_EN || existing.categoryId !== null || existing.supplierType !== FinanceSupplierType.EXPENSE || existing.status !== 'ACTIVE' || existing.taxNumber !== null || existing.isTaxRegistered) throw new Error('The Doha historical missing-supplier fallback has been altered and cannot be reused safely.');
        return { id: existing.id, action: 'REUSED' };
      }
      const created = await tx.financeSupplier.create({ data: { id: randomUUID(), tenantId, companyId, supplierType: FinanceSupplierType.EXPENSE, nameAr: FALLBACK_SUPPLIER_NAME_AR, nameEn: FALLBACK_SUPPLIER_NAME_EN, categoryId: null, taxNumber: null, isTaxRegistered: false, isFavorite: false, status: 'ACTIVE' }, select: { id: true } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.doha.historical_missing_supplier.created', entityType: 'FinanceSupplier', entityId: created.id, requestId: `nurix-doha-historical-missing-supplier:${SOURCE_COMPANY_ID}`, afterJson: { nameAr: FALLBACK_SUPPLIER_NAME_AR, nameEn: FALLBACK_SUPPLIER_NAME_EN, sourceCompanyId: SOURCE_COMPANY_ID, sourceSupplierIds: [], scopeInvoiceIds: rows.map((row) => row.invoice.sourceId), reason: 'Noorix hr_expense records have no supplier_id; created solely because the HR service writer requires an active supplier.' } } });
      return { id: created.id, action: 'CREATED' };
    });
    const execution = await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: VERSION } }, select: { id: true, financialPlanSha256: true } });
      if (existing) {
        if (existing.financialPlanSha256 !== planSha) throw new Error('Existing Doha HR-service execution differs from the frozen source.');
        return existing;
      }
      return tx.nurixExcelFinancialExecution.create({ data: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion: VERSION, financialPlanSha256: planSha, status: 'RUNNING', reason: 'Owner-authorized Doha historical employee-service costs with complete employee/category/vault/journal evidence.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date(), waveSequence: 1 }, select: { id: true, financialPlanSha256: true } });
    });
    const wave = await database.inTenantTransaction(tenantId, async (tx) => {
      const existing = await tx.nurixExcelFinancialWave.findUnique({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, select: { id: true } });
      return existing ?? tx.nurixExcelFinancialWave.create({ data: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sequence: 1, status: 'RUNNING', plannedItems: rows.length }, select: { id: true } });
    });

    const receipts = [];
    for (const row of rows) {
      const receipt = await database.inTenantTransaction(tenantId, async (tx) => {
        const expectedCategoryId = preflight.categoryIdByCode.get(row.targetPolicy.categoryCode);
        const currentDocument = await tx.financeOutflowDocument.findFirst({ where: { tenantId, companyId, supplierInvoiceNumber: row.invoice.number }, select: { id: true, documentNumber: true, journalEntryId: true, grossAmount: true, businessDate: true, categoryId: true, supplierId: true, status: true } });
        let serviceId;
        let document;
        let reused = false;
        if (currentDocument) {
          if (currentDocument.status !== 'POSTED' || amount(currentDocument.grossAmount) !== amount(row.invoice.amount) || currentDocument.businessDate.toISOString().slice(0, 10) !== row.invoice.businessDate || currentDocument.categoryId !== expectedCategoryId || currentDocument.supplierId !== fallbackSupplier.id) throw new Error(`Existing document ${row.invoice.number} conflicts during resume.`);
          const currentService = await tx.hrEmployeeService.findFirst({ where: { tenantId, companyId, employeeId: preflight.employeeIdBySource.get(row.service.employeeSourceId), serviceType: row.targetPolicy.serviceType, referenceNumber: row.service.referenceNumber ?? null, categoryId: expectedCategoryId, supplierId: fallbackSupplier.id, outflowDocumentId: currentDocument.id, status: HrEmployeeServiceStatus.ISSUED }, select: { id: true } });
          if (!currentService) throw new Error(`Existing document ${row.invoice.number} is not linked to the expected issued employee service.`);
          serviceId = currentService.id;
          document = currentDocument;
          reused = true;
        } else {
          const vaultId = preflight.vaultIdBySource.get(row.invoice.vaultSourceId);
          const vault = preflight.vaultById.get(vaultId);
          const request = documents.normaliseRecordedEmployeeService({
            employeeId: preflight.employeeIdBySource.get(row.service.employeeSourceId), serviceType: row.targetPolicy.serviceType,
            ...(row.service.referenceNumber ? { referenceNumber: row.service.referenceNumber } : {}), supplierId: fallbackSupplier.id, categoryId: expectedCategoryId,
            businessDate: date(row.invoice.businessDate), grossAmount: amount(row.invoice.amount), isTaxable: false,
            allocations: [{ vaultId, grossAmount: amount(row.invoice.amount), paymentMethod: vault.paymentMethod }],
            supplierInvoiceNumber: row.invoice.number, supplierInvoiceDate: date(row.invoice.businessDate),
            notes: `Noorix ${row.invoice.sourceId}: ${row.invoice.notes || row.service.notes || 'خدمة موظف تاريخية'}. دليل المصدر: ${row.invoice.ledgers[0].debitCode} إلى ${row.invoice.ledgers[0].creditCode}; تاريخ العملية ${row.invoice.businessDate}.`,
          });
          const idempotencyKey = `nurix-doha-historical-hr-service:${row.invoice.sourceId}`;
          const begun = await documents.idem.beginInTransaction(tx, context, { operation: 'hr.employee_service.historical_record_and_issue', key: idempotencyKey, request: documents.recordedEmployeeServicePayload(request), expiresAt: new Date(Date.now() + 86_400_000) });
          if (begun.kind !== 'started') throw new Error(`Unexpected idempotency state for ${row.invoice.number}.`);
          const service = await documents.hr.createHistoricalServiceForFinancialIssueInTransaction(tx, context, documents.employeeServiceCreateInput(request));
          const posted = await documents.postDocument(tx, context, { kind: 'EXPENSE', settlementKind: 'PAID', categoryId: request.categoryId, supplierId: fallbackSupplier.id, businessDate: request.businessDate, grossAmount: request.grossAmount, isTaxable: false, allocations: request.allocations, supplierInvoiceNumber: request.supplierInvoiceNumber, supplierInvoiceDate: request.supplierInvoiceDate, notes: request.notes }, `hr-employee-service-historical-record:${idempotencyKey}`);
          await tx.hrEmployeeService.update({ where: { id: service.id }, data: { status: HrEmployeeServiceStatus.ISSUED, outflowDocumentId: posted.documentId } });
          await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId, companyId, employeeId: service.employeeId, journalEntryId: posted.journalEntryId, movementType: HrEmployeeFinancialMovementType.SERVICE_COST, businessDate: request.businessDate, amount: request.grossAmount, sourceReference: posted.documentNumber, description: request.notes ?? null } });
          await documents.idem.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: { serviceId: service.id, documentId: posted.documentId, documentNumber: posted.documentNumber, journalEntryId: posted.journalEntryId } } });
          serviceId = service.id;
          document = posted;
        }

        const item = await tx.nurixExcelFinancialItem.findFirst({ where: { executionId: execution.id, sourceId: row.invoice.sourceId }, select: { id: true } });
        if (!item) await tx.nurixExcelFinancialItem.create({ data: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sourceSheet: 'EmployeeServices', sourceEntity: 'NoorixEmployeeServiceInvoice', sourceId: row.invoice.sourceId, sourceChecksum: row.sourceChecksum, operationKey: sha({ version: VERSION, sourceInvoiceId: row.invoice.sourceId }), status: reused ? 'REUSED' : 'POSTED', targetEntity: 'FinanceOutflowDocument', targetId: document.documentId ?? document.id, resultCode: reused ? 'REUSED_MATCHING_HISTORICAL_EMPLOYEE_SERVICE_COST' : 'POSTED_HISTORICAL_EMPLOYEE_SERVICE_COST' } });
        for (const map of [
          { sourceEntity: 'NoorixEmployeeService', sourceId: row.service.sourceId, targetEntity: 'HrEmployeeService', targetId: serviceId },
          { sourceEntity: 'NoorixEmployeeServiceInvoice', sourceId: row.invoice.sourceId, targetEntity: 'FinanceOutflowDocument', targetId: document.documentId ?? document.id },
          { sourceEntity: 'NoorixEmployeeServiceLedger', sourceId: row.invoice.ledgers[0].sourceId, targetEntity: 'FinanceJournalEntry', targetId: document.journalEntryId },
        ]) {
          await tx.nurixExcelFinancialSourceMap.upsert({ where: { executionId_sourceEntity_sourceId: { executionId: execution.id, sourceEntity: map.sourceEntity, sourceId: map.sourceId } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: map.sourceEntity, sourceId: map.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: map.targetEntity, targetId: map.targetId, state: reused ? 'REUSED' : 'APPLIED' }, update: { sourceChecksum: row.sourceChecksum, targetEntity: map.targetEntity, targetId: map.targetId, state: reused ? 'REUSED' : 'APPLIED' } });
        }
        for (const annotation of [['EmployeeResidency', row.service.sourceId, row.service.notes], ['Invoice', row.invoice.sourceId, row.invoice.notes]]) {
          const [sourceEntity, sourceId, exactText] = annotation;
          if (!exactText) continue;
          await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity, sourceId, field: 'notes' } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity, sourceId, sourceChecksum: row.sourceChecksum, targetEntity: sourceEntity === 'Invoice' ? 'FinanceOutflowDocument' : 'HrEmployeeService', targetId: sourceEntity === 'Invoice' ? (document.documentId ?? document.id) : serviceId, field: 'notes', exactText }, update: { sourceChecksum: row.sourceChecksum, targetEntity: sourceEntity === 'Invoice' ? 'FinanceOutflowDocument' : 'HrEmployeeService', targetId: sourceEntity === 'Invoice' ? (document.documentId ?? document.id) : serviceId, exactText } });
        }
        // This is an annotation, intentionally not a Supplier source map:
        // Noorix did not provide a supplier identifier for this invoice.
        await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixHistoricalMissingSupplier', sourceId: row.invoice.sourceId, field: 'historicalSupplierFallback' } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity: 'NoorixHistoricalMissingSupplier', sourceId: row.invoice.sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'FinanceSupplier', targetId: fallbackSupplier.id, field: 'historicalSupplierFallback', exactText: `${FALLBACK_SUPPLIER_NAME_AR}: لم يرد supplier_id في فاتورة نوركس ${row.invoice.number}; مورد تقني تاريخي مطلوب فقط لربط تكلفة خدمة الموظف.` }, update: { sourceChecksum: row.sourceChecksum, targetEntity: 'FinanceSupplier', targetId: fallbackSupplier.id, exactText: `${FALLBACK_SUPPLIER_NAME_AR}: لم يرد supplier_id في فاتورة نوركس ${row.invoice.number}; مورد تقني تاريخي مطلوب فقط لربط تكلفة خدمة الموظف.` } });
        const receipt = { serviceId, documentId: document.documentId ?? document.id, documentNumber: document.documentNumber, journalEntryId: document.journalEntryId, sourceInvoiceNumber: row.invoice.number, reused };
        await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.doha.hr_employee_service_cost_backfill.applied', entityType: 'HrEmployeeService', entityId: serviceId, requestId: `nurix-doha-hr-service:${row.invoice.sourceId}`, afterJson: { sourceServiceId: row.service.sourceId, sourceInvoiceId: row.invoice.sourceId, sourceLedgerId: row.invoice.ledgers[0].sourceId, categoryCode: row.targetPolicy.categoryCode, historicalFallbackSupplierId: fallbackSupplier.id, historicalFallbackSupplierAction: fallbackSupplier.action, sourceChecksum: row.sourceChecksum, receipt } } });
        return receipt;
      });
      receipts.push(receipt);
    }
    await database.inTenantTransaction(tenantId, async (tx) => {
      const [postedItems, reusedItems, fallbackDocuments, fallbackServices] = await Promise.all([
        tx.nurixExcelFinancialItem.count({ where: { executionId: execution.id, status: 'POSTED' } }),
        tx.nurixExcelFinancialItem.count({ where: { executionId: execution.id, status: 'REUSED' } }),
        tx.financeOutflowDocument.findMany({ where: { tenantId, companyId, supplierId: fallbackSupplier.id }, select: { supplierInvoiceNumber: true, status: true } }),
        tx.hrEmployeeService.findMany({ where: { tenantId, companyId, supplierId: fallbackSupplier.id }, select: { outflowDocument: { select: { supplierInvoiceNumber: true } } } }),
      ]);
      if (postedItems + reusedItems !== rows.length) throw new Error('The Doha HR-service wave did not reconcile every reviewed source invoice.');
      const allowedInvoiceNumbers = new Set(rows.map((row) => row.invoice.number));
      if (fallbackDocuments.length !== rows.length || fallbackDocuments.some((document) => document.status !== 'POSTED' || !allowedInvoiceNumbers.has(document.supplierInvoiceNumber ?? '')) || fallbackServices.length !== rows.length || fallbackServices.some((service) => !allowedInvoiceNumbers.has(service.outflowDocument?.supplierInvoiceNumber ?? ''))) {
        throw new Error('The historical missing-supplier fallback is used outside the three verified Doha employee-service invoices.');
      }
      await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: 'COMMITTED', postedItems, reusedItems, reviewItems: 0, failedItems: 0, committedAt: new Date(), reconciliationHash: planSha } });
      await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', reason: 'Every source-proven Doha employee-service invoice was reconciled through its employee service, expense document, vault allocation, and journal.', waveSequence: 1 } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.doha.hr_employee_service_cost_backfill.completed', entityType: 'NurixExcelFinancialExecution', entityId: execution.id, requestId: `nurix-doha-hr-service-complete:${planSha}`, afterJson: { ...dryRun, receipts } } });
    });
    console.log(JSON.stringify({ status: 'COMPLETED', version: VERSION, planSha, receipts }, null, 2));
  }
} finally {
  await app?.close();
}
