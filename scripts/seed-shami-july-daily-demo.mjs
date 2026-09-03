import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from './api-workspace-dependencies.mjs';

import { AppModule } from '../apps/api/dist/app.module.js';
import { DatabaseService } from '../apps/api/dist/database/database.service.js';
import { DailySalesService } from '../apps/api/dist/finance/daily-sales.service.js';
import { PurchaseExpenseService } from '../apps/api/dist/finance/purchase-expense.service.js';
import { RecurringExpenseService } from '../apps/api/dist/finance/recurring-expense.service.js';
import { FinanceVatSettlementService } from '../apps/api/dist/finance/finance-vat-settlement.service.js';
import { HrPayrollService } from '../apps/api/dist/hr/hr-payroll.service.js';
import { FinanceVatSettlementKind } from '../apps/api/dist/generated/prisma/client.js';
import { CashPerformanceCoverageService } from '../apps/api/dist/reports/cash-performance-coverage.service.js';
import { PersonalCashPerformanceReportService } from '../apps/api/dist/reports/personal-cash-performance-report.service.js';
import { LedgerTrialBalanceReportService } from '../apps/api/dist/reports/ledger-trial-balance-report.service.js';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const CONFIRMATION = 'SEED_SHAMI_AUGUST_TO_DATE_DEMO';
const PERIOD = Object.freeze({ from: '2026-08-01', to: '2026-08-23' });
const DAYS_IN_SCOPE = 23;
const EXPECTED_COMPANY_NAME = 'مشويات المعلم الشامي';
const companyId = process.env.BASEER_DEMO_COMPANY_ID;
const tenantId = process.env.BASEER_DEMO_TENANT_ID;

if (!companyId || !tenantId || process.env.BASEER_DEMO_CONFIRM !== CONFIRMATION) {
  throw new Error(`Set BASEER_DEMO_TENANT_ID, BASEER_DEMO_COMPANY_ID and BASEER_DEMO_CONFIRM=${CONFIRMATION}.`);
}

let app;
try {
  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }));
  await app.init();

  const database = app.get(DatabaseService);
  const source = await database.inTenantTransaction(tenantId, async (tx) => {
    const company = await tx.company.findFirst({ where: { id: companyId, tenantId }, select: { id: true, nameAr: true } });
    if (!company || company.nameAr !== EXPECTED_COMPANY_NAME) throw new Error('The requested company is not the approved daily-demo company.');
    const entryCount = await tx.financeJournalEntry.count({ where: { tenantId, companyId } });
    if (entryCount !== 0) throw new Error('The company must be reset before this daily demo is seeded.');
    const membership = await tx.companyMembership.findFirst({
      where: { tenantId, companyId, role: { code: 'BASEER_COMPANY_MANAGER' } }, select: { userId: true },
    });
    const profile = await tx.companyFinanceProfile.findFirst({ where: { tenantId, companyId }, select: { vatAccountingEnabled: true, vatRateBasisPoints: true } });
    const vaults = await tx.financeVault.findMany({
      where: { tenantId, companyId, status: 'ACTIVE', isSalesChannel: true },
      select: { id: true, nameAr: true, paymentMethod: true, isPaymentDestination: true }, orderBy: { sortOrder: 'asc' },
    });
    const categories = await tx.financeCategory.findMany({
      where: { tenantId, companyId, status: 'ACTIVE', isPosting: true, kind: { in: ['PURCHASE', 'EXPENSE'] } },
      select: { id: true, code: true, nameAr: true, kind: true }, orderBy: { code: 'asc' },
    });
    if (!membership || !profile?.vatAccountingEnabled || profile.vatRateBasisPoints !== 1500 || vaults.length < 4) {
      throw new Error('The company needs an active manager, VAT at 15%, and at least four active sales channels.');
    }
    return { actorUserId: membership.userId, vaults, categories };
  });
  const context = { tenantId, companyId, actorUserId: source.actorUserId };
  const vault = byName(source.vaults);
  const purchaseCategories = source.categories.filter((item) => item.kind === 'PURCHASE');
  const expenseCategories = source.categories.filter((item) => item.kind === 'EXPENSE');
  assert.ok(purchaseCategories.length > 0, 'The current chart needs at least one active purchase leaf.');

  const sales = app.get(DailySalesService);
  const outflows = app.get(PurchaseExpenseService);
  const recurring = app.get(RecurringExpenseService);
  const vat = app.get(FinanceVatSettlementService);
  const payroll = app.get(HrPayrollService);
  const coverage = app.get(CashPerformanceCoverageService);
  const personalReport = app.get(PersonalCashPerformanceReportService);
  const trialBalance = app.get(LedgerTrialBalanceReportService);

  // Daily collections make the day/month charts useful and exercise all sales channels.
  let salesGross = 0;
  for (let day = 1; day <= DAYS_IN_SCOPE; day += 1) {
    const gross = 920 + ((day * 73) % 420);
    salesGross += gross;
    const cash = Math.floor(gross * 0.42);
    const bank = Math.floor(gross * 0.27);
    const hunger = Math.floor(gross * 0.19);
    const keeta = Math.floor(gross * 0.07);
    const jahez = gross - cash - bank - hunger - keeta;
    await sales.create({
      context,
      idempotencyKey: key('sales', day),
      request: {
        businessDate: date(day), scope: 'ALL', customerCount: 22 + (day % 19),
        allocations: [
          { vaultId: vault.نقد.id, grossAmount: money(cash) },
          { vaultId: vault.بنك.id, grossAmount: money(bank) },
          { vaultId: vault.هنقرستيشن.id, grossAmount: money(hunger) },
          { vaultId: vault.كيتا.id, grossAmount: money(keeta) },
          { vaultId: vault.جاهز.id, grossAmount: money(jahez) },
        ],
        notes: `بيانات شهرية تجريبية — تحصيل يوم ${day} من أغسطس 2026`,
      },
    });
  }

  // Every posting purchase leaf is represented by a real paid purchase document.
  for (const [index, category] of purchaseCategories.entries()) {
    const day = ((index * 2) % DAYS_IN_SCOPE) + 1;
    const gross = 180 + (index * 37);
    await outflows.create({
      context,
      idempotencyKey: key('purchase', index + 1),
      request: paidDocument({ categoryId: category.id, businessDate: date(day), grossAmount: gross, vault: paymentVault(source.vaults, index), taxable: true, invoice: `AUG26-PUR-${String(index + 1).padStart(2, '0')}`, note: `بيانات شهرية تجريبية — مشتريات ${category.nameAr}` }),
    });
  }

  const recurringCodes = new Set(['E3-1', 'E3-2', 'E3-3', 'E3-4']);
  const recurringDefinitions = [
    ['E3-1', 'إيجار المحل', 3500, false, 3],
    ['E3-2', 'فاتورة كهرباء دورية', 760, true, 12],
    ['E3-3', 'اتصال وإنترنت دوري', 420, true, 18],
    ['E3-4', 'مياه وصرف دوري', 260, true, 22],
  ];
  for (const [code, nameAr, amount, taxable, day] of recurringDefinitions) {
    const category = expenseCategories.find((item) => item.code === code);
    if (!category) throw new Error(`Missing recurring category ${code}.`);
    const profile = await recurring.createProfile(context, {
      nameAr, nameEn: nameAr, categoryId: category.id, expectedAmount: money(amount), intervalMonths: 1,
      nextReminderDate: date(1), defaultVaultId: vault.نقد.id, allowAmountOverride: false,
      notes: 'ملف دوري أنشئ لبيانات شهرية تجريبية.',
    }, key('recurring-profile', code));
    await outflows.createRecurringPayment({
      context,
      idempotencyKey: key('recurring-payment', code),
      request: {
        profileId: profile.id, coverageYear: 2026, coverageStartMonth: 8, businessDate: date(day), grossAmount: money(amount),
        isTaxable: taxable, supplierInvoiceNumber: `AUG26-REC-${code}`, allocations: [{ vaultId: vault.نقد.id, grossAmount: money(amount), paymentMethod: vault.نقد.paymentMethod }],
        notes: `بيانات شهرية تجريبية — ${nameAr}`,
      },
    });
  }

  // The remaining expense leaves are one-off operating payments. Salaries are created below through the HR payroll lifecycle.
  const nonRecurringExpenses = expenseCategories.filter((item) => !recurringCodes.has(item.code) && item.code !== 'E4-1');
  for (const [index, category] of nonRecurringExpenses.entries()) {
    const day = ((index * 3 + 4) % DAYS_IN_SCOPE) + 1;
    const gross = 95 + ((index * 41) % 560);
    const taxable = !category.code.startsWith('E2-') && !category.code.startsWith('E4-');
    await outflows.create({
      context,
      idempotencyKey: key('expense', index + 1),
      request: paidDocument({ categoryId: category.id, businessDate: date(day), grossAmount: gross, vault: paymentVault(source.vaults, index + 3), taxable, invoice: `AUG26-EXP-${String(index + 1).padStart(2, '0')}`, note: `بيانات شهرية تجريبية — مصروف ${category.nameAr}` }),
    });
  }

  // Payroll is a genuine HR lifecycle: employee onboarding, payroll run approval, then payment.
  const employee = await payroll.onboardEmployee(context, {
    nameAr: 'موظف تجريبي — مسير أغسطس', jobTitle: 'موظف تشغيل', hireDate: date(1),
    initialCompensation: { monthlyGross: '8200.0000', compensationMethod: 'FIXED_MONTHLY', foodAllowance: '0.0000', housingAllowance: '0.0000', transportAllowance: '0.0000', otherAllowance: '0.0000' },
  }, key('payroll-employee', 1));
  const payrollRun = await payroll.create(context, {
    payrollMonth: date(1), businessDate: date(DAYS_IN_SCOPE), includeAllEligible: true, includeOnLeaveEmployeeIds: [], lines: [],
    notes: 'بيانات شهرية تجريبية — مسير رواتب أغسطس 2026',
  }, key('payroll-run', 1));
  await payroll.approve(context, { payrollRunId: payrollRun.id, businessDate: date(DAYS_IN_SCOPE) }, key('payroll-approve', 1));
  const payrollDetail = await payroll.detail(context, payrollRun.id, { linePageSize: 100, paymentPageSize: 100 });
  await payroll.pay(context, {
    payrollRunId: payrollRun.id, businessDate: date(DAYS_IN_SCOPE),
    allocations: [{ vaultId: vault.نقد.id, paymentMethod: vault.نقد.paymentMethod, amount: payrollDetail.payrollRun.netPayableAmount }],
  }, key('payroll-pay', 1));

  // Pay the VAT net position from the ledger itself, not from a hard-coded report number.
  const vatPosition = await database.inTenantTransaction(tenantId, async (tx) => {
    const [output, input] = await Promise.all([
      tx.financeAccount.findFirst({ where: { tenantId, companyId, systemKey: 'VAT_OUTPUT' }, select: { id: true } }),
      tx.financeAccount.findFirst({ where: { tenantId, companyId, systemKey: 'VAT_INPUT' }, select: { id: true } }),
    ]);
    if (!output || !input) throw new Error('VAT control accounts are missing.');
    const [outflow, inflow] = await Promise.all([
      tx.financeJournalLine.aggregate({ where: { tenantId, companyId, accountId: output.id }, _sum: { debitAmount: true, creditAmount: true } }),
      tx.financeJournalLine.aggregate({ where: { tenantId, companyId, accountId: input.id }, _sum: { debitAmount: true, creditAmount: true } }),
    ]);
    const outputBalance = number(outflow._sum.creditAmount) - number(outflow._sum.debitAmount);
    const inputBalance = number(inflow._sum.debitAmount) - number(inflow._sum.creditAmount);
    return outputBalance - inputBalance;
  });
  assert.ok(Math.abs(vatPosition) > 0.0001, 'The generated month must have a VAT position to settle.');
  await vat.record(context, {
    kind: vatPosition > 0 ? FinanceVatSettlementKind.PAYMENT : FinanceVatSettlementKind.REFUND,
    vaultId: vault.نقد.id, amount: money(Math.abs(vatPosition)), businessDate: date(DAYS_IN_SCOPE), referenceNumber: 'AUG26-VAT-SETTLEMENT',
    notes: 'بيانات شهرية تجريبية — تسوية ضريبة محسوبة من قيود أغسطس حتى اليوم.',
  });

  await coverage.activate(context, date(1));
  const [financial, trial] = await Promise.all([
    personalReport.run(context, { from: date(1), to: date(DAYS_IN_SCOPE), vatInclusive: true }),
    trialBalance.run(context, { from: date(1), to: date(DAYS_IN_SCOPE), includeZeroRows: false }),
  ]);
  assert.equal(financial.state, 'READY', 'The financial movement report must be ready after source coverage is activated.');
  assert.ok(financial.rows.some((row) => row.code === 'recurring_expenses'), 'Recurring payments must have their own reporting section.');
  assert.ok(financial.rows.some((row) => row.code === 'employee_payments'), 'The paid payroll must appear in the employee-payments section.');
  assert.equal(trial.state, 'READY', 'The trial balance must be ready for the generated month.');
  assert.equal(trial.totals.periodDebit.raw, trial.totals.periodCredit.raw, 'The period debit and credit totals must reconcile.');

  const journal = await database.inTenantTransaction(tenantId, async (tx) => tx.financeJournalLine.aggregate({
    where: { tenantId, companyId, journalEntry: { is: { businessDate: { gte: date(1), lte: date(DAYS_IN_SCOPE) }, isSealed: true } } },
    _count: { id: true }, _sum: { debitAmount: true, creditAmount: true },
  }));
  assert.equal(money(number(journal._sum.debitAmount)), money(number(journal._sum.creditAmount)), 'Direct ledger totals must reconcile.');
  console.log(JSON.stringify({
    company: EXPECTED_COMPANY_NAME,
    period: PERIOD,
    dailySalesClosings: DAYS_IN_SCOPE,
    purchaseLeaves: purchaseCategories.length,
    ordinaryExpenseLeaves: nonRecurringExpenses.length,
    recurringProfiles: recurringDefinitions.length,
    payrollRunId: payrollRun.id,
    salesGross: money(salesGross),
    vatSettlement: money(Math.abs(vatPosition)),
    journalLines: journal._count.id,
    journalDebit: money(number(journal._sum.debitAmount)),
    financialNet: financial.totals.netCashResult.raw,
    trialPeriodDebit: trial.totals.periodDebit.raw,
    trialPeriodCredit: trial.totals.periodCredit.raw,
  }, null, 2));
} finally {
  await app?.close();
}

function date(day) { return new Date(`2026-08-${String(day).padStart(2, '0')}T00:00:00.000Z`); }
function money(value) { return Number(value).toFixed(4); }
function number(value) { return value == null ? 0 : Number(value); }
function key(scope, value) { return `shami-august-to-date-demo:${scope}:${value}:${randomUUID()}`; }
function byName(vaults) {
  const map = Object.fromEntries(vaults.map((item) => [item.nameAr, item]));
  for (const name of ['نقد', 'بنك', 'هنقرستيشن', 'كيتا', 'جاهز']) if (!map[name]) throw new Error(`Missing ${name} sales channel.`);
  return map;
}
function paymentVault(vaults, index) {
  const eligible = vaults.filter((item) => item.isPaymentDestination);
  return eligible[index % eligible.length];
}
function paidDocument({ categoryId, businessDate, grossAmount, vault, taxable, invoice, note }) {
  return {
    kind: invoice.includes('-PUR-') ? 'PURCHASE' : 'EXPENSE', settlementKind: 'PAID', categoryId, businessDate,
    grossAmount: money(grossAmount), isTaxable: taxable, supplierInvoiceNumber: invoice,
    allocations: [{ vaultId: vault.id, grossAmount: money(grossAmount), paymentMethod: vault.paymentMethod }], notes: note,
  };
}
