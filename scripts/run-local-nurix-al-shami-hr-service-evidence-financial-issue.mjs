/**
 * Owner-gated promotion of four Noorix employee-service records to their
 * already-proven historical expense invoices.  The service records were
 * imported first without financial effects; this writer attaches each to one
 * posted outflow document only after proving invoice, service supplier,
 * category, ledger, allocation, vault and employee maps.
 */
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const VERSION = 'nurix-al-shami-operational-hr-service-financial-issue/v1';
const APPROVAL = 'APPLY_APPROVED_NOORIX_AL_SHAMI_HR_SERVICE_FINANCIAL_ISSUE_V1';
const SOURCE_COMPANY_ID = 'cmnaivif80001wavxxfgriptm';
const uuid = /^[0-9a-f-]{36}$/i;
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const money = (value, label = 'amount') => { const n = Number(value); if (!Number.isFinite(n) || n <= 0) throw new Error(`Invalid ${label}.`); return n.toFixed(4); };
const day = (value) => new Date(`${value}T00:00:00.000Z`);
const [packageId, tenantId, companyId, actorUserId, mode] = process.argv.slice(2);
if (![packageId, tenantId, companyId, actorUserId].every((value) => uuid.test(value ?? '')) || !['DRY_RUN', APPROVAL].includes(mode ?? '')) throw new Error(`Usage: node scripts/run-local-nurix-al-shami-hr-service-evidence-financial-issue.mjs <package-uuid> <tenant-uuid> <company-uuid> <owner-user-uuid> DRY_RUN|${APPROVAL}`);
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') throw new Error('This writer only permits the canonical local Baseer test database.');

const sourceSql = `
SELECT coalesce(json_agg(row ORDER BY row->>'invoiceNumber'), '[]'::json)::text
FROM (
 SELECT json_build_object(
  'serviceId', r.id, 'employeeSourceId', r.employee_id, 'serviceSupplierSourceId', r.supplier_id,
  'serviceCategory', r.service_category, 'invoiceId', i.id, 'invoiceNumber', i.invoice_number,
  'businessDate', to_char(i.transaction_date::date, 'YYYY-MM-DD'), 'amount', i.total_amount::text,
  'vaultSourceId', i.vault_id, 'notes', concat_ws(' | ', nullif(r.notes, ''), nullif(i.notes, '')),
  'ledger', (SELECT json_build_object('id', l.id, 'amount', l.amount::text, 'status', l.status, 'referenceType', l.reference_type, 'businessDate', to_char(l.transaction_date::date, 'YYYY-MM-DD'), 'vaultSourceId', l.vault_id, 'debitCode', da.code, 'creditCode', ca.code) FROM ledger_entries l LEFT JOIN accounts da ON da.id=l.debit_account_id LEFT JOIN accounts ca ON ca.id=l.credit_account_id WHERE l.company_id=i.company_id AND l.reference_id=i.id ORDER BY l.id LIMIT 1),
  'ledgerCount', (SELECT count(*) FROM ledger_entries l WHERE l.company_id=i.company_id AND l.reference_id=i.id),
  'allocation', (SELECT json_build_object('vaultSourceId', a.vault_id, 'amount', a.amount::text) FROM invoice_vault_allocations a WHERE a.invoice_id=i.id ORDER BY a.id LIMIT 1),
  'allocationCount', (SELECT count(*) FROM invoice_vault_allocations a WHERE a.invoice_id=i.id)
 ) AS row
 FROM employee_residencies r JOIN invoices i ON i.id=r.invoice_id AND i.company_id=r.company_id
 WHERE r.company_id='${SOURCE_COMPANY_ID}' AND i.kind='hr_expense' AND i.status='active'
   AND r.id IN ('cmps5r9l60001t4smkwdr97wl','cmrcf6ah500wmtmqpv9nbmk2c','cmrcf8yci00x2tmqprdk3ki70','cms4z31hf0001mvgv8wgdio4o')
) source;`;
const raw = execFileSync('docker', ['exec', 'nurix-rehearsal-20260827', 'psql', '-U', 'nurix_restore', '-d', 'nurix_rehearsal', '-t', '-A', '-c', sourceSql], { encoding: 'utf8' }).trim();
const rows = JSON.parse(raw || '[]');
const categoryCode = (value) => ({ sponsorship_transfer: 'E2-8', iqama_renewal: 'E2-4', health_certificate: 'E2-9' }[value] ?? null);
if (rows.length !== 4 || money(rows.reduce((sum, row) => sum + Number(row.amount), 0), 'approved total') !== '3337.0000') throw new Error('The approved Noorix HR service invoice set changed.');
for (const row of rows) {
  const code = categoryCode(row.serviceCategory);
  if (!code || !row.serviceSupplierSourceId || !row.employeeSourceId || !row.invoiceId || !row.invoiceNumber || !row.businessDate || !row.vaultSourceId || row.ledgerCount !== 1 || row.allocationCount !== 1 || !row.ledger || !row.allocation) throw new Error(`Incomplete source evidence for ${row.invoiceNumber}.`);
  if (row.ledger.status !== 'active' || row.ledger.referenceType !== 'invoice' || row.ledger.businessDate !== row.businessDate || row.ledger.vaultSourceId !== row.vaultSourceId || row.allocation.vaultSourceId !== row.vaultSourceId || money(row.ledger.amount) !== money(row.amount) || money(row.allocation.amount) !== money(row.amount) || row.ledger.debitCode !== 'EXP-002' || !row.ledger.creditCode?.startsWith('V-')) throw new Error(`Ledger or allocation proof differs for ${row.invoiceNumber}.`);
  row.categoryCode = code; row.sourceChecksum = sha(row);
}
const planSha = sha({ version: VERSION, rows: rows.map((row) => [row.serviceId, row.invoiceId, row.sourceChecksum]) });

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { PurchaseExpenseService } = await import('../apps/api/dist/finance/purchase-expense.service.js');
const { FinanceVaultPaymentMethod, HrEmployeeFinancialMovementType } = await import('../apps/api/dist/generated/prisma/client.js');
const context = { tenantId, companyId, actorUserId };
let app;
try {
 app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
 const database = app.get(DatabaseService); const documents = app.get(PurchaseExpenseService);
 const preflight = await database.inTenantTransaction(tenantId, async (tx) => {
  const pkg = await tx.nurixExcelStagingPackage.findFirst({ where: { id: packageId, tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, status: 'READY_FOR_RECONCILIATION' }, select: { id: true } });
  if (!pkg) throw new Error('The approved Al-Shami package is unavailable.');
  const [serviceMaps, employeeMaps, supplierMaps, vaultMaps, categories] = await Promise.all([
   tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixEmployeeService', sourceId: { in: rows.map((r) => r.serviceId) }, targetEntity: 'HrEmployeeService', state: 'APPLIED' }, select: { sourceId: true, targetId: true } }),
   tx.nurixExcelMasterDataItem.findMany({ where: { tenantId, entity: 'EMPLOYEE', sourceId: { in: rows.map((r) => r.employeeSourceId) }, targetId: { not: null }, status: { in: ['CREATED', 'REUSED'] }, execution: { packageId, targetCompanyId: companyId, status: 'COMPLETED' } }, select: { sourceId: true, targetId: true } }),
   tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Supplier', sourceId: { in: rows.map((r) => r.serviceSupplierSourceId) }, targetEntity: 'FinanceSupplier', state: { in: ['APPLIED', 'REUSED'] } }, select: { sourceId: true, targetId: true } }),
   tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId, targetCompanyId: companyId, sourceEntity: 'Vault', sourceId: { in: rows.map((r) => r.vaultSourceId) }, targetEntity: 'FinanceVault', state: { in: ['APPLIED', 'REUSED'] } }, select: { sourceId: true, targetId: true } }),
   tx.financeCategory.findMany({ where: { tenantId, companyId, code: { in: [...new Set(rows.map((r) => r.categoryCode))] }, status: 'ACTIVE', isPosting: true, kind: 'EXPENSE' }, select: { id: true, code: true, account: { select: { id: true, status: true, type: true } } } }),
  ]);
  const map = (list, ids, label) => { const result = new Map(list.map((item) => [item.sourceId, item.targetId])); if (result.size !== new Set(ids).size || [...new Set(ids)].some((id) => !result.get(id))) throw new Error(`${label} mapping is incomplete.`); return result; };
  const serviceIdBySource = map(serviceMaps, rows.map((r) => r.serviceId), 'Operational service');
  const employeeIdBySource = map(employeeMaps, rows.map((r) => r.employeeSourceId), 'Employee');
  const supplierIdBySource = map(supplierMaps, rows.map((r) => r.serviceSupplierSourceId), 'Service supplier');
  const vaultIdBySource = map(vaultMaps, rows.map((r) => r.vaultSourceId), 'Vault');
  const categoryIdByCode = new Map(categories.map((item) => [item.code, item.id]));
  if (categoryIdByCode.size !== new Set(rows.map((r) => r.categoryCode)).size || categories.some((item) => !item.account || item.account.status !== 'ACTIVE' || !['EXPENSE','ASSET'].includes(item.account.type))) throw new Error('A required service category is not financially ready.');
  const [services, employees, suppliers, vaults] = await Promise.all([
   tx.hrEmployeeService.findMany({ where: { tenantId, companyId, id: { in: [...serviceIdBySource.values()] }, status: 'ISSUED', supplierId: null, categoryId: null, outflowDocumentId: null }, select: { id: true, employeeId: true } }),
   tx.hrEmployee.findMany({ where: { tenantId, companyId, id: { in: [...employeeIdBySource.values()] }, status: { in: ['ACTIVE','ON_LEAVE'] } }, select: { id: true } }),
   tx.financeSupplier.findMany({ where: { tenantId, companyId, id: { in: [...supplierIdBySource.values()] }, status: 'ACTIVE' }, select: { id: true } }),
   tx.financeVault.findMany({ where: { tenantId, companyId, id: { in: [...vaultIdBySource.values()] }, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, paymentMethod: true, paymentMethods: true } }),
  ]);
  if (services.length !== serviceIdBySource.size || employees.length !== employeeIdBySource.size || suppliers.length !== supplierIdBySource.size || vaults.length !== vaultIdBySource.size) throw new Error('A service reference is no longer ready for financial issuance.');
  const serviceById = new Map(services.map((item) => [item.id, item])); const vaultById = new Map(vaults.map((item) => [item.id, item]));
  for (const row of rows) { const service = serviceById.get(serviceIdBySource.get(row.serviceId)); if (!service || service.employeeId !== employeeIdBySource.get(row.employeeSourceId)) throw new Error(`Employee/service source map differs for ${row.invoiceNumber}.`); const vault = vaultById.get(vaultIdBySource.get(row.vaultSourceId)); if (!vault || !vault.paymentMethods.includes(vault.paymentMethod)) throw new Error(`Vault payment method is unavailable for ${row.invoiceNumber}.`); }
  return { serviceIdBySource, supplierIdBySource, vaultIdBySource, categoryIdByCode, vaultById };
 });
 const dryRun = { status: 'PARSED_DRY_RUN', version: VERSION, planSha, services: rows.map((r) => ({ invoice: r.invoiceNumber, amount: money(r.amount), category: r.categoryCode, sourceSupplier: r.serviceSupplierSourceId, sourceLedger: r.ledger.id, sourceVault: r.vaultSourceId })), financialWrites: 0 };
 console.log(JSON.stringify(dryRun, null, 2));
 if (mode === 'DRY_RUN') process.exitCode = 0;
 else {
  const execution = await database.inTenantTransaction(tenantId, async (tx) => {
   const existing = await tx.nurixExcelFinancialExecution.findUnique({ where: { packageId_tenantId_transformVersion: { packageId, tenantId, transformVersion: VERSION } }, select: { id: true, financialPlanSha256: true } });
   if (existing) { if (existing.financialPlanSha256 !== planSha) throw new Error('The prior financial-service plan differs from frozen source.'); return existing; }
   return tx.nurixExcelFinancialExecution.create({ data: { id: randomUUID(), packageId, tenantId, targetCompanyId: companyId, transformVersion: VERSION, financialPlanSha256: planSha, status: 'RUNNING', reason: 'Owner-approved financial issue for four Noorix employee services using service supplier and service-type category evidence.', requestedByUserId: actorUserId, approvedByUserId: actorUserId, approvedAt: new Date(), waveSequence: 1 }, select: { id: true } });
  });
  const wave = await database.inTenantTransaction(tenantId, async (tx) => tx.nurixExcelFinancialWave.upsert({ where: { executionId_sequence: { executionId: execution.id, sequence: 1 } }, create: { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sequence: 1, status: 'RUNNING', plannedItems: rows.length }, update: {}, select: { id: true } }));
  const receipts = [];
  for (const row of rows) receipts.push(await database.inTenantTransaction(tenantId, async (tx) => {
   const prior = await tx.nurixExcelFinancialSourceMap.findFirst({ where: { executionId: execution.id, sourceEntity: 'NoorixEmployeeServiceInvoice', sourceId: row.invoiceId, targetEntity: 'FinanceOutflowDocument', state: 'APPLIED' }, select: { targetId: true, sourceChecksum: true } });
   const serviceId = preflight.serviceIdBySource.get(row.serviceId);
   if (prior) {
    if (prior.sourceChecksum !== row.sourceChecksum) throw new Error(`Resume checksum differs for ${row.invoiceNumber}.`);
    const document = await tx.financeOutflowDocument.findFirst({ where: { id: prior.targetId, tenantId, companyId, status: 'POSTED', grossAmount: money(row.amount), supplierInvoiceNumber: row.invoiceNumber }, select: { id: true, documentNumber: true, journalEntryId: true } });
    const service = await tx.hrEmployeeService.findFirst({ where: { id: serviceId, tenantId, companyId, outflowDocumentId: prior.targetId, status: 'ISSUED' }, select: { id: true } });
    if (!document || !service) throw new Error(`The resumed financial issue differs for ${row.invoiceNumber}.`);
    return { ...document, serviceId, sourceInvoiceNumber: row.invoiceNumber, reused: true };
   }
   const vaultId = preflight.vaultIdBySource.get(row.vaultSourceId); const vault = preflight.vaultById.get(vaultId);
   const request = { kind: 'EXPENSE', settlementKind: 'PAID', categoryId: preflight.categoryIdByCode.get(row.categoryCode), supplierId: preflight.supplierIdBySource.get(row.serviceSupplierSourceId), businessDate: day(row.businessDate), grossAmount: money(row.amount), isTaxable: false, allocations: [{ vaultId, grossAmount: money(row.amount), paymentMethod: vault.paymentMethod ?? FinanceVaultPaymentMethod.CASH }], supplierInvoiceNumber: row.invoiceNumber, supplierInvoiceDate: day(row.businessDate), notes: `خدمة موظف تاريخية من نوركس — ${row.notes || row.invoiceNumber}` };
   const document = await documents.postDocument(tx, context, request, `nurix-al-shami-hr-evidence-financial:${row.invoiceId}`);
   await tx.hrEmployeeService.update({ where: { id: serviceId }, data: { supplierId: request.supplierId, categoryId: request.categoryId, outflowDocumentId: document.documentId, status: 'ISSUED' } });
   await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId, companyId, employeeId: (await tx.hrEmployeeService.findUniqueOrThrow({ where: { id: serviceId }, select: { employeeId: true } })).employeeId, journalEntryId: document.journalEntryId, movementType: HrEmployeeFinancialMovementType.SERVICE_COST, businessDate: request.businessDate, amount: request.grossAmount, sourceReference: document.documentNumber, description: request.notes } });
   await tx.nurixExcelFinancialItem.create({ data: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId, targetCompanyId: companyId, sourceSheet: 'EmployeeServices', sourceEntity: 'NoorixEmployeeServiceInvoice', sourceId: row.invoiceId, sourceChecksum: row.sourceChecksum, operationKey: sha({ version: VERSION, sourceInvoiceId: row.invoiceId }), status: 'POSTED', targetEntity: 'FinanceOutflowDocument', targetId: document.documentId, resultCode: 'POSTED_EXISTING_HR_SERVICE_COST' } });
   await tx.nurixExcelFinancialSourceMap.createMany({ data: [
    { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixEmployeeServiceInvoice', sourceId: row.invoiceId, sourceChecksum: row.sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: document.documentId, state: 'APPLIED' },
    { id: randomUUID(), executionId: execution.id, tenantId, targetCompanyId: companyId, sourceEntity: 'NoorixEmployeeServiceLedger', sourceId: row.ledger.id, sourceChecksum: row.sourceChecksum, targetEntity: 'FinanceJournalEntry', targetId: document.journalEntryId, state: 'APPLIED' },
   ] });
   for (const [sourceEntity, sourceId, text] of [['EmployeeResidency', row.serviceId, row.notes]]) if (text) await tx.noorixSourceAnnotation.upsert({ where: { tenantId_targetCompanyId_sourceEntity_sourceId_field: { tenantId, targetCompanyId: companyId, sourceEntity, sourceId, field: 'notes' } }, create: { id: randomUUID(), tenantId, targetCompanyId: companyId, sourceCompanyId: SOURCE_COMPANY_ID, sourceEntity, sourceId, sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeService', targetId: serviceId, field: 'notes', exactText: text }, update: { sourceChecksum: row.sourceChecksum, targetEntity: 'HrEmployeeService', targetId: serviceId, exactText: text } });
   return { serviceId, documentId: document.documentId, documentNumber: document.documentNumber, journalEntryId: document.journalEntryId, sourceInvoiceNumber: row.invoiceNumber, reused: false };
  }));
  await database.inTenantTransaction(tenantId, async (tx) => {
   const posted = await tx.nurixExcelFinancialItem.count({ where: { executionId: execution.id, status: 'POSTED' } }); if (posted !== rows.length) throw new Error('The financial service wave is incomplete.');
   await tx.nurixExcelFinancialWave.update({ where: { id: wave.id }, data: { status: 'COMMITTED', postedItems: posted, reusedItems: 0, reviewItems: 0, failedItems: 0, committedAt: new Date(), reconciliationHash: planSha } });
   await tx.nurixExcelFinancialExecution.update({ where: { id: execution.id }, data: { status: 'COMPLETED', reason: 'Posted four source-proven employee-service invoices and linked their existing operational services.', waveSequence: 1 } });
   await tx.auditEvent.create({ data: { id: randomUUID(), tenantId, companyId, actorUserId, action: 'nurix.al_shami.hr_employee_service_evidence_financial_issue.completed', entityType: 'NurixExcelFinancialExecution', entityId: execution.id, requestId: `nurix-al-shami-hr-service-financial-complete:${planSha}`, afterJson: { dryRun, receipts } } });
  });
  console.log(JSON.stringify({ status: 'COMPLETED', version: VERSION, planSha, receipts }, null, 2));
 }
} finally { await app?.close(); }
