import assert from 'node:assert/strict';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const context = Object.freeze({
  tenantId: '6ffae759-800e-4653-8543-51013f5ef751',
  companyId: '35091ad3-7a91-4f78-a97e-d9d6781e13df',
  actorUserId: 'c89fb913-2f7c-404e-84d7-161146766f77',
});
const from = new Date('2026-08-01T00:00:00.000Z');
const to = new Date('2026-08-31T00:00:00.000Z');

let app;
try {
  const [
    { AppModule },
    { DatabaseService },
    { FinancePnlMappingService },
    { PersonalCashPerformanceReportService },
    { AccrualProfitLossReportService },
  ] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/finance/finance-pnl-mapping.service.js'),
    import('../apps/api/dist/reports/personal-cash-performance-report.service.js'),
    import('../apps/api/dist/reports/accrual-profit-loss-report.service.js'),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const database = app.get(DatabaseService);
  const mappings = app.get(FinancePnlMappingService);

  const source = await database.inTenantTransaction(context.tenantId, async (tx) => ({
    approvedMappings: await tx.financePnlMappingVersion.count({ where: { tenantId: context.tenantId, companyId: context.companyId, status: 'APPROVED' } }),
    accounts: await tx.financeAccount.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: 'ACTIVE', type: { in: ['REVENUE', 'EXPENSE'] } }, select: { id: true, code: true, type: true } }),
    totals: {
      employees: await tx.hrEmployee.count({ where: { tenantId: context.tenantId, companyId: context.companyId } }),
      purchases: await tx.financeOutflowDocument.count({ where: { tenantId: context.tenantId, companyId: context.companyId, kind: 'PURCHASE', status: 'POSTED' } }),
      sales: await tx.financeDailySalesClosing.count({ where: { tenantId: context.tenantId, companyId: context.companyId, status: 'POSTED' } }),
      payroll: await tx.hrPayrollRun.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId }, select: { status: true, grossAmount: true, advanceSettlementAmount: true, netPayableAmount: true, paidAmount: true } }),
      advance: await tx.hrEmployeeAdvance.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId }, select: { status: true, originalAmount: true, settledAmount: true, remainingAmount: true } }),
    },
  }));
  assert.deepEqual([source.totals.employees, source.totals.purchases, source.totals.sales], [3, 16, 5], 'The requested Test-company cycle is incomplete.');
  assert.equal(source.totals.payroll?.status, 'PAID');
  assert.equal(source.totals.payroll?.grossAmount.toFixed(4), '6000.0000');
  assert.equal(source.totals.payroll?.advanceSettlementAmount.toFixed(4), '200.0000');
  assert.equal(source.totals.payroll?.netPayableAmount.toFixed(4), '5800.0000');
  assert.equal(source.totals.payroll?.paidAmount.toFixed(4), '5800.0000');
  assert.equal(source.totals.advance?.status, 'SETTLED');
  assert.equal(source.totals.advance?.remainingAmount.toFixed(4), '0.0000');

  if (source.approvedMappings === 0) {
    const revenue = source.accounts.filter((account) => account.type === 'REVENUE');
    const costOfSales = source.accounts.filter((account) => ['PUR-001', 'PUR-002', 'PUR-003', 'PUR-004'].includes(account.code));
    const operatingExpense = source.accounts.filter((account) => account.type === 'EXPENSE' && !costOfSales.some((cost) => cost.id === account.id));
    const draft = await mappings.createDraft(context, {
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      lines: [
        { code: 'REVENUE', nameAr: 'الإيرادات', nameEn: 'Revenue', presentationNature: 'REVENUE', sortOrder: 10 },
        { code: 'COST_OF_SALES', nameAr: 'المشتريات وتكلفة المبيعات', nameEn: 'Purchases and cost of sales', presentationNature: 'COST_OF_SALES', sortOrder: 20 },
        { code: 'OPERATING_EXPENSES', nameAr: 'المصروفات التشغيلية', nameEn: 'Operating expenses', presentationNature: 'OPERATING_EXPENSE', sortOrder: 30 },
      ],
      accountMappings: [
        ...revenue.map((account) => ({ accountId: account.id, statementLineCode: 'REVENUE', presentationSign: 'CREDIT_NATURE' })),
        ...costOfSales.map((account) => ({ accountId: account.id, statementLineCode: 'COST_OF_SALES', presentationSign: 'DEBIT_NATURE' })),
        ...operatingExpense.map((account) => ({ accountId: account.id, statementLineCode: 'OPERATING_EXPENSES', presentationSign: 'DEBIT_NATURE' })),
      ],
    });
    await mappings.approveDraft(context, draft.id);
  }

  const [cash, pnl] = await Promise.all([
    app.get(PersonalCashPerformanceReportService).run(context, { from, to, vatInclusive: true }),
    app.get(AccrualProfitLossReportService).run(context, { from, to, vatInclusive: true }),
  ]);
  assert.equal(cash.state, 'READY', cash.messageAr ?? 'The August cash report is unavailable.');
  assert.equal(pnl.state, 'READY', pnl.messageAr ?? 'The August profit-and-loss report is unavailable.');

  console.log(JSON.stringify({
    company: 'Test',
    period: '2026-08',
    employees: source.totals.employees,
    purchaseCategories: source.totals.purchases,
    salesClosings: source.totals.sales,
    payroll: { gross: '6000.0000', advanceSettlement: '200.0000', netPaid: '5800.0000', status: 'PAID' },
    advance: { issued: '200.0000', settled: '200.0000', remaining: '0.0000', status: 'SETTLED' },
    reports: { cash: cash.state, profitLoss: pnl.state },
    verified: true,
  }, null, 2));
} finally {
  await app?.close();
}
