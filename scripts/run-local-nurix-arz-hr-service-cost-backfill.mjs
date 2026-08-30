import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

const APPROVAL = 'APPLY_APPROVED_NOORIX_ARZ_HR_SERVICE_COST_BACKFILL_V1';
const VERSION = 'nurix-historical-hr-service-invoice-backfill/v1';
const PACKAGE_ID = '27dbb3d7-e0b2-4b52-ab61-bd2c61450350';
const TENANT_ID = '6ffae759-800e-4653-8543-51013f5ef751';
const COMPANY_ID = '7e64301f-c87e-4d98-9881-35328ace117b';
const ACTOR_ID = 'c89fb913-2f7c-404e-84d7-161146766f77';
const BANK_VAULT_ID = '838e50b9-ae7e-4413-9eb4-09db2890d222';
const IQAMA_CATEGORY_ID = '66a7d59a-5582-405c-8c34-15b0dad38bef';

// Every row was read from the frozen Noorix source immediately before this
// writer was introduced.  The source invoice, posted ledger, date, amount,
// supplier/category and V-002 payment evidence all matched exactly.
const ROWS = [
  {
    sourceServiceId: 'cms55eror000813ce95n84jz5', sourceInvoiceId: 'cms55err4000f13ce5sg6j3o3', sourceInvoiceNumber: 'HR-20260724-002',
    serviceId: '68f33fa4-7e25-455a-97cc-cb101ba87e26', employeeNumber: 'AR-ST-016', businessDate: '2026-07-24', amount: '300.0000',
    sourceChecksum: 'noorix-hr-service:cms55eror000813ce95n84jz5:cms55err4000f13ce5sg6j3o3:2026-07-24:300.0000:EXP-002:V-002',
  },
  {
    sourceServiceId: 'cmsagk1i6002414o768sfudoc', sourceInvoiceId: 'cmsagk1ju002b14o77kaho9eo', sourceInvoiceNumber: 'HR-20260731-001',
    serviceId: '2952d514-ceea-4775-872a-e38ce868e1c3', employeeNumber: 'AR-ST-020', businessDate: '2026-07-31', amount: '2162.0000',
    sourceChecksum: 'noorix-hr-service:cmsagk1i6002414o768sfudoc:cmsagk1ju002b14o77kaho9eo:2026-07-31:2162.0000:EXP-002:V-002',
  },
  {
    sourceServiceId: 'cms55e4fk0008ju75t1w2p9em', sourceInvoiceId: 'cms55e4gv000fju750bycvg8x', sourceInvoiceNumber: 'HR-20260724-001',
    serviceId: 'c7382a6b-2956-4bc2-a7ae-fc6fafc65d3a', employeeNumber: 'AR-ST-021', businessDate: '2026-07-24', amount: '300.0000',
    sourceChecksum: 'noorix-hr-service:cms55e4fk0008ju75t1w2p9em:cms55e4gv000fju750bycvg8x:2026-07-24:300.0000:EXP-002:V-002',
  },
  {
    sourceServiceId: 'cmq6l7u6m008n11srvgsgk6rg', sourceInvoiceId: 'cmq6l7u8u008s11srx407d299', sourceInvoiceNumber: 'HR-20260609-002',
    serviceId: 'b962c83b-757a-4f9e-af7b-e428f0fc98e0', employeeNumber: 'AR-ST-028', businessDate: '2026-06-09', amount: '413.0000',
    sourceChecksum: 'noorix-hr-service:cmq6l7u6m008n11srvgsgk6rg:cmq6l7u8u008s11srx407d299:2026-06-09:413.0000:EXP-002:V-002',
    requiredCategoryId: IQAMA_CATEGORY_ID,
  },
];

const mode = process.argv[2];
if (!['DRY_RUN', APPROVAL].includes(mode)) throw new Error(`Usage: node scripts/run-local-nurix-arz-hr-service-cost-backfill.mjs DRY_RUN|${APPROVAL}`);
const loaded = dotenv.config({ path: resolve('apps/api/.env.baseer-test'), override: true, quiet: true });
if (loaded.error) throw loaded.error;
const targetUrl = new URL(process.env.DATABASE_URL ?? '');
if (targetUrl.hostname !== '127.0.0.1' || targetUrl.port !== '5433' || targetUrl.pathname !== '/baseer_erp_test') throw new Error('Refusing to run outside the canonical local Baseer test database.');

process.chdir(resolve('apps/api'));
const { AppModule } = await import('../apps/api/dist/app.module.js');
const { DatabaseService } = await import('../apps/api/dist/database/database.service.js');
const { PurchaseExpenseService } = await import('../apps/api/dist/finance/purchase-expense.service.js');
const { FinanceVaultPaymentMethod } = await import('../apps/api/dist/generated/prisma/client.js');

const planSha = createHash('sha256').update(JSON.stringify(ROWS.map(({ sourceChecksum, sourceInvoiceId, serviceId }) => ({ sourceChecksum, sourceInvoiceId, serviceId })))).digest('hex');
const context = { tenantId: TENANT_ID, companyId: COMPANY_ID, actorUserId: ACTOR_ID };
let app;
try {
  app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  const database = app.get(DatabaseService);
  const preflight = await database.inTenantTransaction(TENANT_ID, async (tx) => {
    const [company, packageRow, vault, services, existingDocuments, existingMaps] = await Promise.all([
      tx.company.findFirst({ where: { id: COMPANY_ID, tenantId: TENANT_ID }, select: { id: true, migrationReviewLocked: true } }),
      tx.nurixExcelStagingPackage.findFirst({ where: { id: PACKAGE_ID, tenantId: TENANT_ID, sourceCompanyId: 'cmnf604ka009ay8lm556wgd9c', status: 'READY_FOR_RECONCILIATION' }, select: { id: true } }),
      tx.financeVault.findFirst({ where: { id: BANK_VAULT_ID, tenantId: TENANT_ID, companyId: COMPANY_ID, status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, account: { select: { code: true, status: true } } } }),
      tx.hrEmployeeService.findMany({ where: { id: { in: ROWS.map((row) => row.serviceId) }, tenantId: TENANT_ID, companyId: COMPANY_ID }, include: { employee: { select: { employeeNumber: true } }, outflowDocument: { select: { id: true, documentNumber: true, journalEntryId: true, status: true, grossAmount: true, businessDate: true, supplierInvoiceNumber: true } } } }),
      tx.financeOutflowDocument.findMany({ where: { tenantId: TENANT_ID, companyId: COMPANY_ID, supplierInvoiceNumber: { in: ROWS.map((row) => row.sourceInvoiceNumber) } }, select: { id: true, documentNumber: true, journalEntryId: true, supplierInvoiceNumber: true, grossAmount: true, businessDate: true, status: true } }),
      tx.nurixExcelFinancialSourceMap.findMany({ where: { tenantId: TENANT_ID, targetCompanyId: COMPANY_ID, sourceId: { in: ROWS.flatMap((row) => [row.sourceServiceId, row.sourceInvoiceId]) } }, select: { sourceEntity: true, sourceId: true, targetEntity: true, targetId: true, sourceChecksum: true } }),
    ]);
    if (!company?.migrationReviewLocked) throw new Error('ARZ must remain migration-review locked during this historical repair.');
    if (!packageRow) throw new Error('The approved ARZ Noorix package is not READY_FOR_RECONCILIATION.');
    if (!vault || vault.account.code !== 'V-002' || vault.account.status !== 'ACTIVE') throw new Error('The required active V-002 bank payment destination is unavailable.');
    if (services.length !== ROWS.length) throw new Error('One or more approved target HR services is missing.');
    if (existingMaps.length) throw new Error('Existing Noorix source mapping found for a service invoice repair row; manual reconciliation is required.');
    const byId = new Map(services.map((service) => [service.id, service]));
    const documentsByInvoice = new Map(existingDocuments.map((document) => [document.supplierInvoiceNumber, document]));
    const resumedDocuments = new Map();
    for (const row of ROWS) {
      const service = byId.get(row.serviceId);
      if (!service || service.employee.employeeNumber !== row.employeeNumber) throw new Error(`Service ${row.serviceId} does not belong to ${row.employeeNumber}.`);
      const existing = documentsByInvoice.get(row.sourceInvoiceNumber);
      if (existing) {
        if (existing.status !== 'POSTED' || existing.grossAmount.toFixed(4) !== row.amount || existing.businessDate.toISOString().slice(0, 10) !== row.businessDate || service.status !== 'ISSUED' || service.outflowDocument?.id !== existing.id) throw new Error(`Existing target document ${row.sourceInvoiceNumber} conflicts with the reviewed service invoice evidence.`);
        resumedDocuments.set(row.sourceInvoiceId, existing);
        continue;
      }
      if (service.status !== 'DRAFT' || service.outflowDocument) throw new Error(`Service ${row.serviceId} is not an unissued DRAFT service.`);
      if (!service.supplierId || (!service.categoryId && !row.requiredCategoryId)) throw new Error(`Service ${row.serviceId} is missing an approved supplier or category.`);
    }
    return { resumedDocuments };
  });
  const dryRun = { status: 'PARSED_DRY_RUN', plannedRows: ROWS.length, plannedAmount: ROWS.reduce((sum, row) => sum + Number(row.amount), 0).toFixed(4), bankAccount: 'V-002', debitAccount: 'EXP-002', sourceInvoices: ROWS.map((row) => row.sourceInvoiceNumber), planSha };
  console.log(JSON.stringify(dryRun, null, 2));
  if (mode === 'DRY_RUN') process.exitCode = 0;
  else {
    // The single missing category is source-proven as "Iqamas and passports".
    for (const row of ROWS.filter((item) => item.requiredCategoryId)) {
      await database.inTenantTransaction(TENANT_ID, async (tx) => {
        await tx.hrEmployeeService.update({ where: { id: row.serviceId }, data: { categoryId: row.requiredCategoryId } });
        await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: TENANT_ID, companyId: COMPANY_ID, actorUserId: ACTOR_ID, action: 'hr.employee_service.historical_category_repaired', entityType: 'HrEmployeeService', entityId: row.serviceId, requestId: `nurix-hr-service-category:${row.sourceServiceId}`, afterJson: { sourceServiceId: row.sourceServiceId, sourceInvoiceId: row.sourceInvoiceId, categoryId: row.requiredCategoryId, reason: 'Noorix source ledger EXP-002 and service category prove Iqamas and passports.' } } });
      });
    }
    const writer = app.get(PurchaseExpenseService);
    const receipts = [];
    for (const row of ROWS) {
      const resumed = preflight.resumedDocuments.get(row.sourceInvoiceId);
      if (resumed) {
        receipts.push({ documentId: resumed.id, documentNumber: resumed.documentNumber, journalEntryId: resumed.journalEntryId, sourceServiceId: row.sourceServiceId, sourceInvoiceId: row.sourceInvoiceId });
        continue;
      }
      const receipt = await writer.issueEmployeeServiceCost({
        context,
        idempotencyKey: `nurix-historical-hr-service-cost-repair:${row.sourceInvoiceId}`,
        request: {
          serviceId: row.serviceId, businessDate: new Date(`${row.businessDate}T00:00:00.000Z`), grossAmount: row.amount, isTaxable: false,
          allocations: [{ vaultId: BANK_VAULT_ID, grossAmount: row.amount, paymentMethod: FinanceVaultPaymentMethod.BANK_TRANSFER }],
          supplierInvoiceNumber: row.sourceInvoiceNumber, supplierInvoiceDate: new Date(`${row.businessDate}T00:00:00.000Z`),
          notes: `Noorix ${row.sourceInvoiceId}: فاتورة خدمة موظف تاريخية. دليل المصدر: EXP-002 إلى V-002؛ تاريخ العملية ${row.businessDate}.`,
        },
      });
      receipts.push({ ...receipt, sourceServiceId: row.sourceServiceId, sourceInvoiceId: row.sourceInvoiceId });
    }
    await database.inTenantTransaction(TENANT_ID, async (tx) => {
      const execution = await tx.nurixExcelFinancialExecution.create({ data: { id: randomUUID(), packageId: PACKAGE_ID, tenantId: TENANT_ID, targetCompanyId: COMPANY_ID, transformVersion: VERSION, financialPlanSha256: planSha, status: 'COMPLETED', reason: 'Owner-approved completion of four Noorix employee-service invoices after duplicate preflight.', requestedByUserId: ACTOR_ID, approvedByUserId: ACTOR_ID, approvedAt: new Date(), waveSequence: 1 } });
      const wave = await tx.nurixExcelFinancialWave.create({ data: { id: randomUUID(), executionId: execution.id, tenantId: TENANT_ID, targetCompanyId: COMPANY_ID, sequence: 1, status: 'COMMITTED', plannedItems: ROWS.length, postedItems: ROWS.length, reusedItems: 0, reviewItems: 0, failedItems: 0, committedAt: new Date(), reconciliationHash: planSha } });
      for (const receipt of receipts) {
        const row = ROWS.find((item) => item.sourceInvoiceId === receipt.sourceInvoiceId);
        if (!row) throw new Error('Unexpected receipt source id.');
        const sourceChecksum = createHash('sha256').update(row.sourceChecksum).digest('hex');
        await tx.nurixExcelFinancialItem.create({ data: { id: randomUUID(), executionId: execution.id, waveId: wave.id, tenantId: TENANT_ID, targetCompanyId: COMPANY_ID, sourceSheet: 'EmployeeServices', sourceEntity: 'NoorixEmployeeServiceInvoice', sourceId: row.sourceInvoiceId, sourceChecksum, operationKey: `nurix-hr-service-invoice:${row.sourceInvoiceId}`, status: 'POSTED', targetEntity: 'FinanceOutflowDocument', targetId: receipt.documentId, resultCode: 'POSTED_HISTORICAL_EMPLOYEE_SERVICE_COST' } });
        await tx.nurixExcelFinancialSourceMap.createMany({ data: [
          { id: randomUUID(), executionId: execution.id, tenantId: TENANT_ID, targetCompanyId: COMPANY_ID, sourceEntity: 'NoorixEmployeeService', sourceId: row.sourceServiceId, sourceChecksum, targetEntity: 'HrEmployeeService', targetId: row.serviceId, state: 'APPLIED' },
          { id: randomUUID(), executionId: execution.id, tenantId: TENANT_ID, targetCompanyId: COMPANY_ID, sourceEntity: 'NoorixEmployeeServiceInvoice', sourceId: row.sourceInvoiceId, sourceChecksum, targetEntity: 'FinanceOutflowDocument', targetId: receipt.documentId, state: 'APPLIED' },
        ] });
      }
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: TENANT_ID, companyId: COMPANY_ID, actorUserId: ACTOR_ID, action: 'nurix.hr_employee_service_cost_backfill.completed', entityType: 'NurixExcelFinancialExecution', entityId: execution.id, requestId: `nurix-hr-service-cost-backfill:${planSha}`, afterJson: { executionId: execution.id, waveId: wave.id, planSha, receipts } } });
    });
    console.log(JSON.stringify({ status: 'COMPLETED', executionVersion: VERSION, planSha, receipts }, null, 2));
  }
} finally {
  await app?.close();
}
