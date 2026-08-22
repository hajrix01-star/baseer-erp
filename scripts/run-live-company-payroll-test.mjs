import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const context = {
  tenantId: '6ffae759-800e-4653-8543-51013f5ef751',
  companyId: '4af6969a-161f-4e13-8acc-103d8aa26a70',
  actorUserId: 'c89fb913-2f7c-404e-84d7-161146766f77',
};
const businessDate = new Date('2026-08-22T00:00:00.000Z');
const monthStart = new Date('2026-08-01T00:00:00.000Z');
const employeeWithoutPayrollId = '519f67e9-811e-4736-8d4f-c4fe21d27b74';
const suffix = randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase();
const marker = 'اختبار تشغيلي فعلي 2026-08-22';
let app;

try {
  const [
    { AppModule }, { DatabaseService }, { BusinessDateService }, { HrPayrollService }, { HrService },
    { DocumentSerialService }, { IdempotencyService }, { FinanceVaultService }, { JournalPostingService }, { FinanceFoundationService }, { FinanceCashPerformanceEventService },
  ] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/business-date/business-date.service.js'),
    import('../apps/api/dist/hr/hr-payroll.service.js'),
    import('../apps/api/dist/hr/hr.service.js'),
    import('../apps/api/dist/core-controls/document-serial.service.js'),
    import('../apps/api/dist/core-controls/idempotency.service.js'),
    import('../apps/api/dist/finance/finance-vault.service.js'),
    import('../apps/api/dist/finance/journal/journal-posting.service.js'),
    import('../apps/api/dist/finance/finance-foundation.service.js'),
    import('../apps/api/dist/finance/finance-cash-performance-event.service.js'),
  ]);
  app = await NestFactory.createApplicationContext(AppModule, { logger: false });
  const database = app.get(DatabaseService);
  const payroll = app.get(HrPayrollService);
  const hr = app.get(HrService);
  const policyClock = new BusinessDateService(database, {}, { now: () => new Date('2026-08-01T12:00:00.000Z') });
  const policyCommands = new HrPayrollService(
    database,
    policyClock,
    app.get(DocumentSerialService),
    app.get(IdempotencyService),
    app.get(FinanceVaultService),
    app.get(JournalPostingService),
    app.get(FinanceFoundationService),
    app.get(FinanceCashPerformanceEventService),
  );

  const policy = await policyCommands.createCompensationPolicy(context, {
    code: `LIVE_PAY_${suffix}`,
    nameAr: `${marker} سياسة تعويض`,
    nameEn: `Live payroll policy ${suffix}`,
    effectiveFrom: monthStart,
  }, randomUUID());
  await policyCommands.approveCompensationPolicyVersion(context, { policyVersionId: policy.policyVersionId }, randomUUID());

  await hr.updateEmployee(context, {
    employeeId: employeeWithoutPayrollId,
    nameAr: `${marker} موظف 218D5DEE`,
    status: 'TERMINATED',
    terminatedAt: businessDate,
    notes: `${marker} إنهاء موظف اختبار بلا اتفاق تعويض حتى لا يدخل مسير الرواتب`,
  }, randomUUID());

  const employee = await payroll.onboardEmployee(context, {
    nameAr: `${marker} موظف رواتب ${suffix}`,
    nameEn: `Live payroll employee ${suffix}`,
    jobTitle: 'موظف اختبار رواتب',
    hireDate: businessDate,
    notes: `${marker} موظف مخصص لمسير الرواتب`,
    initialCompensation: {
      policyVersionId: policy.policyVersionId,
      monthlyGross: '1000.0000',
      compensationMethod: 'FIXED_MONTHLY',
      foodAllowance: '0', housingAllowance: '0', transportAllowance: '0', otherAllowance: '0',
    },
  }, randomUUID());

  const preview = await payroll.preview(context, {
    payrollMonth: monthStart,
    businessDate,
    includeOnLeaveEmployeeIds: [],
    lines: [],
    pageSize: 50,
  });
  assert.ok(preview.employees.some((item) => item.id === employee.id && item.included));
  const run = await payroll.create(context, {
    payrollMonth: monthStart,
    businessDate,
    includeAllEligible: true,
    includeOnLeaveEmployeeIds: [],
    lines: [],
    notes: `${marker} مسير راتب`,
  }, randomUUID());
  const draft = await payroll.detail(context, run.id, { linePageSize: 50, paymentPageSize: 50 });
  assert.equal(draft.payrollRun.status, 'DRAFT');
  assert.equal(draft.lines.length, 1);
  const approval = await payroll.approve(context, { payrollRunId: run.id, businessDate }, randomUUID());
  const approved = await payroll.detail(context, run.id, { linePageSize: 50, paymentPageSize: 50 });
  assert.equal(approved.payrollRun.status, 'APPROVED');
  const cashVault = await database.inTenantTransaction(context.tenantId, (tx) => tx.financeVault.findFirstOrThrow({
    where: { tenantId: context.tenantId, companyId: context.companyId, type: 'CASH', status: 'ACTIVE', isPaymentDestination: true },
    select: { id: true },
  }));
  const payment = await payroll.pay(context, {
    payrollRunId: run.id,
    businessDate,
    allocations: [{ vaultId: cashVault.id, paymentMethod: 'CASH', amount: approved.payrollRun.netPayableAmount }],
  }, randomUUID());
  const paid = await payroll.detail(context, run.id, { linePageSize: 50, paymentPageSize: 50 });
  assert.equal(paid.payrollRun.status, 'PAID');
  assert.equal(paid.payrollRun.paidAmount, paid.payrollRun.netPayableAmount);

  const journalIds = [approved.payrollRun.accrualJournalEntryId, paid.payments[0]?.journalEntryId].filter(Boolean);
  const journals = await database.inTenantTransaction(context.tenantId, (tx) => tx.financeJournalEntry.findMany({
    where: { tenantId: context.tenantId, companyId: context.companyId, id: { in: journalIds } },
    include: { lines: { select: { debitAmount: true, creditAmount: true } } },
  }));
  assert.equal(journals.length, 2);
  for (const journal of journals) {
    const debit = journal.lines.reduce((total, line) => total + Number(line.debitAmount), 0).toFixed(4);
    const credit = journal.lines.reduce((total, line) => total + Number(line.creditAmount), 0).toFixed(4);
    assert.equal(debit, credit);
  }

  console.log(JSON.stringify({
    status: 'passed', marker,
    records: { policyId: policy.id, policyVersionId: policy.policyVersionId, employeeId: employee.id, payrollRunId: run.id, runNumber: run.runNumber, approvalId: approval.id, paymentRunId: payment.id },
    amounts: { gross: paid.payrollRun.grossAmount, net: paid.payrollRun.netPayableAmount, paid: paid.payrollRun.paidAmount },
    checks: ['compensation-policy', 'employee-onboarding', 'payroll-preview', 'payroll-draft', 'payroll-accrual-approval', 'payroll-payment', 'balanced-payroll-journals'],
  }, null, 2));
} finally {
  await app?.close();
}
