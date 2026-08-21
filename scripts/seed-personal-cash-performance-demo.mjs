import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';

import { AppModule } from '../apps/api/dist/app.module.js';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { DailySalesService } from '../apps/api/dist/finance/daily-sales.service.js';
import { PurchaseExpenseService } from '../apps/api/dist/finance/purchase-expense.service.js';
import { FinanceVatSettlementService } from '../apps/api/dist/finance/finance-vat-settlement.service.js';
import { CashPerformanceCoverageService } from '../apps/api/dist/reports/cash-performance-coverage.service.js';
import { PersonalCashPerformanceReportService } from '../apps/api/dist/reports/personal-cash-performance-report.service.js';
import { FinanceVatSettlementKind } from '../apps/api/dist/generated/prisma/client.js';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const DEMO_CONFIRMATION = 'SEED_PERSONAL_CASH_PERFORMANCE_DEMO';
const DEMO_REQUEST_ID = 'demo:personal-cash-performance:v1';
const companyId = process.env.BASEER_DEMO_COMPANY_ID;
const tenantIdFromEnvironment = process.env.BASEER_DEMO_TENANT_ID;

if (!companyId || !tenantIdFromEnvironment || process.env.BASEER_DEMO_CONFIRM !== DEMO_CONFIRMATION) {
  throw new Error(`Set BASEER_DEMO_TENANT_ID, BASEER_DEMO_COMPANY_ID and BASEER_DEMO_CONFIRM=${DEMO_CONFIRMATION} before running this demo seed.`);
}

let app;
try {
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }));
  await app.init();

  const database = app.get(DatabaseService);
  const [tenantId, actorUserId, cashVault, purchaseCategory, expenseCategory] = await database.inTenantTransaction(
    tenantIdFromEnvironment,
    async (transaction) => {
      const company = await transaction.company.findFirst({ where: { id: companyId }, select: { tenantId: true } });
      if (!company) throw new Error('The requested demo company was not found.');
      const seeded = await transaction.auditEvent.findFirst({
        where: { tenantId: company.tenantId, companyId, requestId: DEMO_REQUEST_ID },
        select: { id: true },
      });
      if (seeded) throw new Error('This personal cash-performance demo was already seeded for the selected company.');
      const membership = await transaction.companyMembership.findFirst({
        where: { tenantId: company.tenantId, companyId, role: { code: 'BASEER_COMPANY_MANAGER' } },
        select: { userId: true },
      });
      const vault = await transaction.financeVault.findFirst({
        where: { tenantId: company.tenantId, companyId, isSalesChannel: true, status: 'ACTIVE', paymentMethod: 'CASH' },
        select: { id: true },
      });
      const purchase = await transaction.financeCategory.findFirst({
        where: { tenantId: company.tenantId, companyId, code: 'P1-1', kind: 'PURCHASE', status: 'ACTIVE', isPosting: true },
        select: { id: true },
      });
      const expense = await transaction.financeCategory.findFirst({
        where: { tenantId: company.tenantId, companyId, code: 'E3-2', kind: 'EXPENSE', status: 'ACTIVE', isPosting: true },
        select: { id: true },
      });
      if (!membership || !vault || !purchase || !expense) throw new Error('The company is missing its manager, cash sales vault, or required posting categories.');
      return [company.tenantId, membership.userId, vault.id, purchase.id, expense.id];
    },
  );
  const context = { tenantId, companyId, actorUserId };

  // This is explicitly test data. The VAT configuration is enabled before any
  // seeded source document so every recorded amount retains its own VAT split.
  await database.inTenantTransaction(tenantId, async (transaction) => {
    await transaction.companyFinanceProfile.update({
      where: { companyId }, data: { vatAccountingEnabled: true, vatRateBasisPoints: 1500 },
    });
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(), tenantId, companyId, actorUserId, requestId: DEMO_REQUEST_ID,
        action: 'demo.personal_cash_performance.vat_enabled', entityType: 'CompanyFinanceProfile', entityId: companyId,
        afterJson: { vatAccountingEnabled: true, vatRateBasisPoints: 1500 },
      },
    });
  });

  const sales = app.get(DailySalesService);
  const outflows = app.get(PurchaseExpenseService);
  const vatSettlements = app.get(FinanceVatSettlementService);
  const coverage = app.get(CashPerformanceCoverageService);
  const reportService = app.get(PersonalCashPerformanceReportService);

  const salesReceipt = await sales.create({
    context, idempotencyKey: randomUUID(),
    request: {
      businessDate: date('2026-08-18'), scope: 'ALL', customerCount: 12,
      allocations: [{ vaultId: cashVault, grossAmount: '230.0000' }],
      notes: 'بيانات تجريبية — مبيعات محصّلة شاملة الضريبة',
    },
  });
  const purchaseReceipt = await outflows.create({
    context, idempotencyKey: randomUUID(),
    request: {
      kind: 'PURCHASE', settlementKind: 'PAID', categoryId: purchaseCategory,
      businessDate: date('2026-08-19'), grossAmount: '115.0000', isTaxable: true,
      supplierInvoiceNumber: 'DEMO-PUR-20260819',
      allocations: [{ vaultId: cashVault, grossAmount: '115.0000', paymentMethod: 'CASH' }],
      notes: 'بيانات تجريبية — مشتريات لحوم مدفوعة',
    },
  });
  const expenseReceipt = await outflows.create({
    context, idempotencyKey: randomUUID(),
    request: {
      kind: 'EXPENSE', settlementKind: 'PAID', categoryId: expenseCategory,
      businessDate: date('2026-08-20'), grossAmount: '57.5000', isTaxable: true,
      supplierInvoiceNumber: 'DEMO-EXP-20260820',
      allocations: [{ vaultId: cashVault, grossAmount: '57.5000', paymentMethod: 'CASH' }],
      notes: 'بيانات تجريبية — كهرباء مدفوعة',
    },
  });
  const vatReceipt = await vatSettlements.record(context, {
    kind: FinanceVatSettlementKind.PAYMENT, vaultId: cashVault, amount: '7.5000',
    businessDate: date('2026-08-20'), referenceNumber: 'DEMO-VAT-20260820',
    notes: 'بيانات تجريبية — سداد صافي VAT',
  });
  const coverageReceipt = await coverage.activate(context, date('2026-08-18'));
  const [inclusive, exclusive] = await Promise.all([
    reportService.run(context, { from: date('2026-08-18'), to: date('2026-08-20'), vatInclusive: true }),
    reportService.run(context, { from: date('2026-08-18'), to: date('2026-08-20'), vatInclusive: false }),
  ]);
  assert.equal(inclusive.state, 'READY');
  assert.equal(exclusive.state, 'READY');
  assert.equal(inclusive.totals.netCashResult.raw, '50.0000');
  assert.equal(exclusive.totals.netCashResult.raw, '50.0000');
  await database.inTenantTransaction(tenantId, (transaction) => transaction.auditEvent.create({
    data: {
      id: randomUUID(), tenantId, companyId, actorUserId, requestId: DEMO_REQUEST_ID,
      action: 'demo.personal_cash_performance.seeded', entityType: 'PersonalCashPerformanceDemo', entityId: companyId,
      afterJson: { salesReceipt, purchaseReceipt, expenseReceipt, vatReceipt, coverageReceipt, inclusiveNet: inclusive.totals.netCashResult.raw, exclusiveNet: exclusive.totals.netCashResult.raw },
    },
  }));
  console.log(JSON.stringify({
    state: 'READY', period: '2026-08-18..2026-08-20',
    inclusiveNet: inclusive.totals.netCashResult.raw,
    exclusiveNet: exclusive.totals.netCashResult.raw,
    salesDocument: salesReceipt.documentNumber,
    purchaseDocument: purchaseReceipt.documentNumber,
    expenseDocument: expenseReceipt.documentNumber,
    vatSettlementId: vatReceipt.settlementId,
  }, null, 2));
} finally {
  await app?.close();
}

function date(value) { return new Date(`${value}T00:00:00.000Z`); }
