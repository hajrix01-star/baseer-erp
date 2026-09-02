import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

/**
 * Creates the owner-requested August 2026 demonstration cycle in the actual
 * "Test" company through Baseer's domain services.  It does not use direct
 * database writes for commercial or HR records.
 *
 * The payroll kernel deliberately permits a payroll only in the current
 * business month.  This local demo therefore pins only the in-process
 * business clock to 31 August while it writes the requested August records;
 * the persisted company configuration and the host clock are never changed.
 */
const fixture = Object.freeze({
  tenantId: '6ffae759-800e-4653-8543-51013f5ef751',
  companyId: '35091ad3-7a91-4f78-a97e-d9d6781e13df',
  actorUserId: 'c89fb913-2f7c-404e-84d7-161146766f77',
  monthStart: date('2026-08-01'),
  monthEnd: date('2026-08-31'),
  advanceDate: date('2026-08-15'),
  purchaseDate: date('2026-08-20'),
  marker: 'تهيئة تجريبية معتمدة — أغسطس 2026',
});

const context = Object.freeze({
  tenantId: fixture.tenantId,
  companyId: fixture.companyId,
  actorUserId: fixture.actorUserId,
});

let app;
let clock;
let originalNow;

try {
  const [
    { AppModule },
    { DatabaseService },
    { BUSINESS_DATE_CLOCK },
    { HrPayrollService },
    { HrAdvanceService },
    { PurchaseExpenseService },
    { DailySalesService },
    { PersonalCashPerformanceReportService },
    { AccrualProfitLossReportService },
  ] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/business-date/business-date.service.js'),
    import('../apps/api/dist/hr/hr-payroll.service.js'),
    import('../apps/api/dist/hr/hr-advance.service.js'),
    import('../apps/api/dist/finance/purchase-expense.service.js'),
    import('../apps/api/dist/finance/daily-sales.service.js'),
    import('../apps/api/dist/reports/personal-cash-performance-report.service.js'),
    import('../apps/api/dist/reports/accrual-profit-loss-report.service.js'),
  ]);

  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const database = app.get(DatabaseService);
  const payroll = app.get(HrPayrollService);
  const advances = app.get(HrAdvanceService);
  const purchases = app.get(PurchaseExpenseService);
  const sales = app.get(DailySalesService);
  const cashReport = app.get(PersonalCashPerformanceReportService);
  const profitLoss = app.get(AccrualProfitLossReportService);

  const preflight = await database.inTenantTransaction(fixture.tenantId, async (tx) => {
    const [company, profile, cashVault, purchaseCategories, employeeCount, payrollCount, advanceCount, salesCount, outflowCount] = await Promise.all([
      tx.company.findFirst({ where: { id: fixture.companyId, tenantId: fixture.tenantId }, select: { nameAr: true, migrationReviewLocked: true } }),
      tx.companyFinanceProfile.findFirst({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { id: true } }),
      tx.financeVault.findFirst({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, type: 'CASH', status: 'ACTIVE', isPaymentDestination: true }, select: { id: true, paymentMethod: true } }),
      tx.financeCategory.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, kind: 'PURCHASE', status: 'ACTIVE', isPosting: true }, orderBy: { code: 'asc' }, select: { id: true, code: true, nameAr: true } }),
      tx.hrEmployee.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId } }),
      tx.hrPayrollRun.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId } }),
      tx.hrEmployeeAdvance.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId } }),
      tx.financeDailySalesClosing.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId } }),
      tx.financeOutflowDocument.count({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId } }),
    ]);
    return { company, profile, cashVault, purchaseCategories, employeeCount, payrollCount, advanceCount, salesCount, outflowCount };
  });

  assert.equal(preflight.company?.nameAr, 'Test', 'The target must be the user-created Test company.');
  assert.equal(preflight.company?.migrationReviewLocked, false, 'The Test company is locked for review.');
  assert.ok(preflight.profile, 'The Test company financial profile is missing.');
  assert.ok(preflight.cashVault, 'The Test company cash vault is missing.');
  assert.equal(preflight.purchaseCategories.length, 16, 'The Test company must expose its 16 posting purchase categories.');
  const resumeAfterHr = preflight.employeeCount === 3
    && preflight.payrollCount === 1
    && preflight.advanceCount === 1
    && preflight.salesCount === 0
    && preflight.outflowCount === 0;
  assert.ok(
    (preflight.employeeCount === 0 && preflight.payrollCount === 0 && preflight.advanceCount === 0 && preflight.salesCount === 0 && preflight.outflowCount === 0) || resumeAfterHr,
    'The Test company contains an unrelated or incomplete demo cycle. Stop rather than append ambiguous financial records.',
  );

  clock = app.get(BUSINESS_DATE_CLOCK);
  originalNow = clock.now;
  clock.now = () => new Date('2026-08-31T12:00:00.000Z');

  let employees;
  let advance;
  let payrollRun;
  if (resumeAfterHr) {
    const resumed = await database.inTenantTransaction(fixture.tenantId, async (tx) => ({
      employees: await tx.hrEmployee.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId }, orderBy: { employeeNumber: 'asc' }, select: { id: true } }),
      advance: await tx.hrEmployeeAdvance.findFirstOrThrow({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { id: true } }),
      payrollRun: await tx.hrPayrollRun.findFirstOrThrow({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { id: true } }),
    }));
    employees = resumed.employees.map((employee) => employee.id);
    advance = resumed.advance;
    payrollRun = resumed.payrollRun;
  } else {
    employees = [];
    for (const [nameAr, nameEn, monthlyGross] of [
      ['موظف تجربة أول', 'Test employee one', '1000.0000'],
      ['موظف تجربة ثانٍ', 'Test employee two', '2000.0000'],
      ['موظف تجربة ثالث', 'Test employee three', '3000.0000'],
    ]) {
      const employee = await payroll.onboardEmployee(context, {
        nameAr,
        nameEn,
        jobTitle: 'موظف تجريبي',
        hireDate: fixture.monthStart,
        notes: fixture.marker,
        initialCompensation: {
          monthlyGross,
          compensationMethod: 'FIXED_MONTHLY',
          foodAllowance: '0.0000',
          housingAllowance: '0.0000',
          transportAllowance: '0.0000',
          otherAllowance: '0.0000',
          notes: fixture.marker,
        },
      }, randomUUID());
      employees.push(employee.id);
    }

    advance = await advances.issue(context, {
      employeeId: employees[0],
      businessDate: fixture.advanceDate,
      amount: '200.0000',
      allocations: [{ vaultId: preflight.cashVault.id, paymentMethod: preflight.cashVault.paymentMethod, amount: '200.0000' }],
      notes: `${fixture.marker} — سلفة تُخصم من مسير أغسطس`,
    }, randomUUID());

    payrollRun = await payroll.create(context, {
      payrollMonth: fixture.monthStart,
      businessDate: fixture.monthEnd,
      includeAllEligible: true,
      includeOnLeaveEmployeeIds: [],
      lines: [{ employeeId: employees[0], advances: [{ id: advance.id, amount: '200.0000' }], administrativeDeductions: [] }],
      notes: `${fixture.marker} — إجمالي الرواتب 6000، سلفة 200، صافي الدفع 5800`,
    }, randomUUID());
    await payroll.approve(context, { payrollRunId: payrollRun.id, businessDate: fixture.monthEnd }, randomUUID());
    await payroll.pay(context, {
      payrollRunId: payrollRun.id,
      businessDate: fixture.monthEnd,
      allocations: [{ vaultId: preflight.cashVault.id, paymentMethod: preflight.cashVault.paymentMethod, amount: '5800.0000' }],
    }, randomUUID());
  }

  const purchaseAmounts = ['100.0000', '200.0000', '300.0000', '400.0000', '500.0000', '600.0000', '700.0000', '800.0000', '900.0000', '1000.0000', '1100.0000', '1200.0000', '1300.0000', '1400.0000', '1500.0000', '2000.0000'];
  const purchaseBatch = await purchases.createBatch({
    context,
    idempotencyKey: randomUUID(),
    request: {
      businessDate: fixture.purchaseDate,
      notes: `${fixture.marker} — مشتريات تغطي جميع الفئات الفرعية`,
      items: preflight.purchaseCategories.map((category, index) => ({
        kind: 'PURCHASE',
        settlementKind: 'PAID',
        categoryId: category.id,
        grossAmount: purchaseAmounts[index],
        isTaxable: false,
        supplierInvoiceMissingReason: 'عملية تجريبية منشأة داخل شركة Test بدون فاتورة مورد خارجية.',
        allocations: [{ vaultId: preflight.cashVault.id, paymentMethod: preflight.cashVault.paymentMethod, grossAmount: purchaseAmounts[index] }],
        notes: `${fixture.marker} — شراء ${category.nameAr} (${category.code})`,
      })),
    },
  });
  assert.equal(purchaseBatch.documentCount, preflight.purchaseCategories.length, 'Every posting purchase category must receive exactly one purchase.');

  const salesFixtures = [
    ['2026-08-01', 'a86e769e-27b5-425e-b6e7-899483825463', '100.0000', 1],
    ['2026-08-08', 'e666d8ec-3f31-4bed-9237-40f985b1650f', '200.0000', 2],
    ['2026-08-15', '120d7260-5cbb-41ad-9beb-5ffb26e7e2dc', '300.0000', 3],
    ['2026-08-22', '74ddf4de-d9c0-4d13-b6fe-1ac3b996c4d7', '400.0000', 4],
    ['2026-08-29', 'a86e769e-27b5-425e-b6e7-899483825463', '1000.0000', 10],
  ];
  for (const [businessDate, vaultId, grossAmount, customerCount] of salesFixtures) {
    await sales.create({
      context,
      idempotencyKey: randomUUID(),
      request: { businessDate: date(businessDate), scope: 'ALL', customerCount, allocations: [{ vaultId, grossAmount }], notes: fixture.marker },
    });
  }

  const verification = await database.inTenantTransaction(fixture.tenantId, async (tx) => {
    const [employeeRows, run, advanceRow, documents, closings, journals] = await Promise.all([
      tx.hrEmployee.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId }, orderBy: { employeeNumber: 'asc' }, select: { id: true, nameAr: true, employeeNumber: true } }),
      tx.hrPayrollRun.findFirstOrThrow({ where: { id: payrollRun.id, tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { status: true, grossAmount: true, advanceSettlementAmount: true, netPayableAmount: true, paidAmount: true, employeeCount: true, accrualJournalEntryId: true } }),
      tx.hrEmployeeAdvance.findFirstOrThrow({ where: { id: advance.id, tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { status: true, originalAmount: true, settledAmount: true, remainingAmount: true } }),
      tx.financeOutflowDocument.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, kind: 'PURCHASE', businessDate: fixture.purchaseDate, status: 'POSTED' }, select: { categoryId: true, grossAmount: true } }),
      tx.financeDailySalesClosing.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, status: 'POSTED', businessDate: { gte: fixture.monthStart, lte: fixture.monthEnd } }, select: { grossAmount: true } }),
      tx.financeJournalEntry.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, status: 'POSTED' }, include: { lines: { select: { debitAmount: true, creditAmount: true } } } }),
    ]);
    return { employeeRows, run, advanceRow, documents, closings, journals };
  });

  assert.equal(verification.employeeRows.length, 3, 'Exactly three employees must be present.');
  assert.equal(verification.run.status, 'PAID');
  assert.equal(verification.run.grossAmount.toFixed(4), '6000.0000');
  assert.equal(verification.run.advanceSettlementAmount.toFixed(4), '200.0000');
  assert.equal(verification.run.netPayableAmount.toFixed(4), '5800.0000');
  assert.equal(verification.run.paidAmount.toFixed(4), '5800.0000');
  assert.equal(verification.run.employeeCount, 3);
  assert.equal(verification.advanceRow.status, 'SETTLED');
  assert.equal(verification.advanceRow.originalAmount.toFixed(4), '200.0000');
  assert.equal(verification.advanceRow.settledAmount.toFixed(4), '200.0000');
  assert.equal(verification.advanceRow.remainingAmount.toFixed(4), '0.0000');
  assert.equal(verification.documents.length, 16, 'All purchase categories must be represented once.');
  assert.equal(new Set(verification.documents.map((document) => document.categoryId)).size, 16, 'Purchase categories must not repeat.');
  assert.equal(sum(verification.documents.map((document) => document.grossAmount.toFixed(4))), '14000.0000');
  assert.equal(verification.closings.length, 5, 'Five August sales closings must be present.');
  assert.equal(sum(verification.closings.map((closing) => closing.grossAmount.toFixed(4))), '2000.0000');
  for (const journal of verification.journals) assert.equal(sum(journal.lines.map((line) => line.debitAmount.toFixed(4))), sum(journal.lines.map((line) => line.creditAmount.toFixed(4))), 'Every posted journal must balance.');

  const [cash, pnl] = await Promise.all([
    cashReport.run(context, { from: fixture.monthStart, to: fixture.monthEnd, vatInclusive: true }),
    profitLoss.run(context, { from: fixture.monthStart, to: fixture.monthEnd, vatInclusive: true }),
  ]);
  assert.notEqual(cash.state, 'NOT_READY', 'The August cash report must be available after seeding.');
  assert.notEqual(pnl.state, 'NOT_READY', 'The August profit-and-loss report must be available after seeding.');

  console.log(JSON.stringify({
    company: 'Test',
    period: '2026-08',
    employees: verification.employeeRows.map((employee) => ({ number: employee.employeeNumber, nameAr: employee.nameAr })),
    purchases: { categories: verification.documents.length, grossAmount: '14000.0000' },
    sales: { closings: verification.closings.length, grossAmount: '2000.0000' },
    payroll: { grossAmount: '6000.0000', advanceSettlementAmount: '200.0000', netPaidAmount: '5800.0000', status: verification.run.status },
    advance: { issuedAmount: '200.0000', remainingAmount: '0.0000', status: verification.advanceRow.status },
    journalCount: verification.journals.length,
    cashReportState: cash.state,
    profitLossState: pnl.state,
    verified: true,
  }, null, 2));
} finally {
  if (clock && originalNow) clock.now = originalNow;
  await app?.close();
}

function date(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function sum(values) {
  const units = values.reduce((total, value) => total + BigInt(value.replace('.', '')), 0n);
  const sign = units < 0n ? '-' : '';
  const text = (units < 0n ? -units : units).toString().padStart(5, '0');
  return `${sign}${text.slice(0, -4)}.${text.slice(-4)}`;
}
