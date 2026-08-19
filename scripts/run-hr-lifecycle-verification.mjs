import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import pg from 'pg';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const { Pool } = pg;
const pool = new Pool({ connectionString: requiredEnvironment('DATABASE_URL') });
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const fixture = {
  tenantId: randomUUID(),
  companyId: randomUUID(),
  reversalCompanyId: randomUUID(),
  creatorId: randomUUID(),
  approverId: randomUUID(),
  payerId: randomUUID(),
  tenantCode: `hr-lifecycle-${suffix}`,
};
const todayText = riyadhDate();
const today = date(todayText);
const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
const beforeMonth = addDays(monthStart, -1);
const fiscalStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
const fiscalEnd = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
const creator = actor(fixture.creatorId);
const approver = actor(fixture.approverId);
const payer = actor(fixture.payerId);
const reversalCreator = actorFor(fixture.reversalCompanyId, fixture.creatorId);
const reversalApprover = actorFor(fixture.reversalCompanyId, fixture.approverId);
const reversalPayer = actorFor(fixture.reversalCompanyId, fixture.payerId);
let app;

try {
  if (today.getUTCDate() < 2) throw new Error('The HR lifecycle verification requires at least two elapsed days in the current month.');
  await seedFixture();
  console.log(`HR lifecycle fixture: ${fixture.tenantCode} (${fixture.tenantId})`);
  process.env.BASEER_SYSTEM_TENANT_CODE = fixture.tenantCode;

  const [
    { AppModule },
    { DatabaseService },
    { CompanyFinanceSetupService },
    { HrPayrollService },
    { HrAdvanceService },
    { HrAdministrativeDeductionService },
    { HrFinalSettlementService },
    { HrService },
    { PurchaseExpenseService },
    { hrEmployeeServiceSchema },
  ] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/finance/company-finance-setup.service.js'),
    import('../apps/api/dist/hr/hr-payroll.service.js'),
    import('../apps/api/dist/hr/hr-advance.service.js'),
    import('../apps/api/dist/hr/hr-administrative-deduction.service.js'),
    import('../apps/api/dist/hr/hr-final-settlement.service.js'),
    import('../apps/api/dist/hr/hr.service.js'),
    import('../apps/api/dist/finance/purchase-expense.service.js'),
    import('../packages/contracts/dist/index.js'),
  ]);

  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }), { logger: false });
  await app.init();

  const database = app.get(DatabaseService);
  const setup = app.get(CompanyFinanceSetupService);
  const payroll = app.get(HrPayrollService);
  const advances = app.get(HrAdvanceService);
  const deductions = app.get(HrAdministrativeDeductionService);
  const settlements = app.get(HrFinalSettlementService);
  const hr = app.get(HrService);
  const purchaseExpenses = app.get(PurchaseExpenseService);

  const finance = await setup.initialize(creator, {
    fiscalPeriodNameAr: 'فترة تحقق دورة الموارد البشرية',
    fiscalPeriodNameEn: 'HR lifecycle verification period',
    fiscalPeriodStartDate: fiscalStart,
    fiscalPeriodEndDate: fiscalEnd,
    selectedVaults: ['CASH'],
  }, randomUUID());
  const cashVaultId = finance.vaultIds[0];
  assert.ok(cashVaultId, 'Finance setup must create a cash vault.');
  const reversalFinance = await setup.initialize(reversalCreator, {
    fiscalPeriodNameAr: 'فترة تحقق عكس مسير الموارد البشرية',
    fiscalPeriodNameEn: 'HR payroll reversal verification period',
    fiscalPeriodStartDate: fiscalStart,
    fiscalPeriodEndDate: fiscalEnd,
    selectedVaults: ['CASH'],
  }, randomUUID());
  const reversalCashVaultId = reversalFinance.vaultIds[0];
  assert.ok(reversalCashVaultId, 'Payroll-reversal fixture must create a cash vault.');
  const serviceReferences = await database.inTenantTransaction(fixture.tenantId, async (tx) => {
    const expenseAccount = await tx.financeAccount.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, companyId: fixture.companyId, systemKey: 'PAYROLL_EXPENSE', status: 'ACTIVE' },
      select: { id: true },
    });
    const category = await tx.financeCategory.create({
      data: { id: randomUUID(), tenantId: fixture.tenantId, companyId: fixture.companyId, accountId: expenseAccount.id, code: `HR-SVC-${suffix}`, nameAr: 'تكلفة خدمة موظف للتحقق', nameEn: 'HR service verification cost', kind: 'EXPENSE' },
      select: { id: true },
    });
    const supplier = await tx.financeSupplier.create({
      data: { id: randomUUID(), tenantId: fixture.tenantId, companyId: fixture.companyId, categoryId: category.id, supplierType: 'EXPENSE', nameAr: 'مورد تحقق خدمات الموظفين', nameEn: 'HR service verification supplier' },
      select: { id: true },
    });
    return { categoryId: category.id, supplierId: supplier.id };
  });

  const employeeDefinitions = [
    ['payroll', 'موظف المسير'],
    ['zero', 'موظف مخالصة صفرية'],
    ['reverse', 'موظف مخالصة معكوسة'],
    ['paid', 'موظف مخالصة مدفوعة'],
    ['late-final', 'موظف مخالصة خصم لاحق'],
  ];
  const employees = new Map();
  for (const [key, nameAr] of employeeDefinitions) {
    const idempotencyKey = randomUUID();
    const input = onboardingInput(nameAr);
    const receipt = await payroll.onboardEmployee(creator, input, idempotencyKey);
    assert.equal(receipt.replayed, false);
    if (key === 'payroll') {
      const replay = await payroll.onboardEmployee(creator, input, idempotencyKey);
      assert.equal(replay.id, receipt.id);
      assert.equal(replay.compensationId, receipt.compensationId);
      assert.equal(replay.replayed, true, 'Onboarding replay must be explicit.');
      const detail = await hr.employeeDetail(creator, receipt.id, { pageSize: 50 });
      assert.equal(detail.compensation?.monthlyGross, '5000.0000', 'Onboarding must atomically persist salary.');
    }
    employees.set(key, { id: receipt.id, nameAr });
  }

  const payrollEmployee = employees.get('payroll');
  const advanceIssueKey = randomUUID();
  const advanceInput = {
    employeeId: payrollEmployee.id,
    businessDate: monthStart,
    amount: '300.0000',
    allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: '300.0000' }],
    notes: 'HR lifecycle advance',
  };
  const advance = await advances.issue(creator, advanceInput, advanceIssueKey);
  assert.equal(advance.replayed, false);
  assert.equal((await advances.issue(creator, advanceInput, advanceIssueKey)).replayed, true, 'Advance issue replay must be explicit.');

  const manualSettlementInput = {
    advanceId: advance.id,
    businessDate: monthStart,
    amount: '50.0000',
    allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: '50.0000' }],
    notes: 'HR lifecycle manual settlement',
  };
  await assert.rejects(
    () => advances.settleDirectly(creator, { ...manualSettlementInput, businessDate: beforeMonth }, randomUUID()),
    /cannot be before the employee-advance issue date/,
    'An advance settlement must not predate issuance.',
  );
  const manualSettlementKey = randomUUID();
  const manualSettlement = await advances.settleDirectly(creator, manualSettlementInput, manualSettlementKey);
  assert.equal(manualSettlement.remainingAmount, '250.0000');
  assert.equal((await advances.settleDirectly(creator, manualSettlementInput, manualSettlementKey)).replayed, true, 'Advance-settlement replay must be explicit.');

  const reversibleAdvance = await advances.issue(creator, {
    employeeId: payrollEmployee.id,
    businessDate: monthStart,
    amount: '40.0000',
    allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: '40.0000' }],
    notes: 'Advance issue reversal verification',
  }, randomUUID());
  await assert.rejects(
    () => advances.reverseIssue(approver, { advanceId: reversibleAdvance.id, businessDate: beforeMonth, reason: 'Invalid historical advance reversal' }, randomUUID()),
    /cannot predate its latest financial or collection event/,
    'An advance issue reversal must not predate issuance.',
  );
  const advanceReversalKeys = [randomUUID(), randomUUID()];
  const advanceReversalResults = await Promise.allSettled([
    advances.reverseIssue(approver, { advanceId: reversibleAdvance.id, businessDate: monthStart, reason: 'Concurrent advance issue reversal' }, advanceReversalKeys[0]),
    advances.reverseIssue(payer, { advanceId: reversibleAdvance.id, businessDate: monthStart, reason: 'Concurrent advance issue reversal' }, advanceReversalKeys[1]),
  ]);
  assert.equal(advanceReversalResults.filter((result) => result.status === 'fulfilled').length, 1, 'The advance lock must allow exactly one concurrent issue reversal.');
  const successfulAdvanceReversal = advanceReversalResults.findIndex((result) => result.status === 'fulfilled');
  assert.match(String(advanceReversalResults[1 - successfulAdvanceReversal].reason?.message), /already been reversed/);
  const advanceReversalActor = successfulAdvanceReversal === 0 ? approver : payer;
  assert.equal((await advances.reverseIssue(advanceReversalActor, { advanceId: reversibleAdvance.id, businessDate: monthStart, reason: 'Concurrent advance issue reversal' }, advanceReversalKeys[successfulAdvanceReversal])).replayed, true, 'Advance issue reversal replay must be explicit.');
  const advanceNoteSearch = await advances.list(creator, { search: 'issue reversal verification', pageSize: 1 });
  assert.deepEqual(advanceNoteSearch.advances.map((item) => item.id), [reversibleAdvance.id], 'Advance search must run against notes in the full register.');
  const reversedAdvanceSearch = await advances.list(creator, { search: 'reversed', pageSize: 10 });
  assert.ok(reversedAdvanceSearch.advances.some((item) => item.id === reversibleAdvance.id), 'Advance search must match status text.');

  const uncostedService = await hr.createService(creator, {
    employeeId: payrollEmployee.id,
    serviceType: 'OTHER',
    issueDate: monthStart,
    notes: 'No financial cost yet',
  }, randomUUID());
  const uncostedServiceDetail = (await hr.serviceDetail(creator, uncostedService.id)).service;
  assert.equal(hrEmployeeServiceSchema.parse(uncostedServiceDetail).costStatus, 'NOT_ISSUED', 'A service without an outflow document must expose NOT_ISSUED.');

  const issuedService = await purchaseExpenses.recordEmployeeServiceAndIssueCost({
    context: creator,
    idempotencyKey: randomUUID(),
    request: {
      employeeId: payrollEmployee.id,
      serviceType: 'OTHER',
      issueDate: monthStart,
      supplierId: serviceReferences.supplierId,
      categoryId: serviceReferences.categoryId,
      businessDate: monthStart,
      grossAmount: '75.0000',
      isTaxable: false,
      allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', grossAmount: '75.0000' }],
      supplierInvoiceMissingReason: 'Lifecycle verification fixture',
      notes: 'Employee-service cost reversal verification',
    },
  });
  const postedServiceDetail = (await hr.serviceDetail(creator, issuedService.serviceId)).service;
  assert.equal(hrEmployeeServiceSchema.parse(postedServiceDetail).costStatus, 'POSTED', 'An issued service cost must expose POSTED before reversal.');
  await assert.rejects(
    () => purchaseExpenses.reverseEmployeeServiceCost({ context: approver, idempotencyKey: randomUUID(), request: { serviceId: issuedService.serviceId, businessDate: beforeMonth, reason: 'Invalid historical service-cost reversal' } }),
    /cannot predate the issued cost/,
    'An employee-service cost reversal must not predate its financial issue.',
  );
  const serviceReversalKeys = [randomUUID(), randomUUID()];
  const serviceReversalResults = await Promise.allSettled([
    purchaseExpenses.reverseEmployeeServiceCost({ context: approver, idempotencyKey: serviceReversalKeys[0], request: { serviceId: issuedService.serviceId, businessDate: monthStart, reason: 'Concurrent employee-service cost reversal' } }),
    purchaseExpenses.reverseEmployeeServiceCost({ context: payer, idempotencyKey: serviceReversalKeys[1], request: { serviceId: issuedService.serviceId, businessDate: monthStart, reason: 'Concurrent employee-service cost reversal' } }),
  ]);
  assert.equal(serviceReversalResults.filter((result) => result.status === 'fulfilled').length, 1, 'The service-cost lock must allow exactly one concurrent reversal.');
  const successfulServiceReversal = serviceReversalResults.findIndex((result) => result.status === 'fulfilled');
  assert.match(String(serviceReversalResults[1 - successfulServiceReversal].reason?.message), /already been reversed/);
  const serviceReversalActor = successfulServiceReversal === 0 ? approver : payer;
  assert.equal((await purchaseExpenses.reverseEmployeeServiceCost({ context: serviceReversalActor, idempotencyKey: serviceReversalKeys[successfulServiceReversal], request: { serviceId: issuedService.serviceId, businessDate: monthStart, reason: 'Concurrent employee-service cost reversal' } })).replayed, true, 'Employee-service cost reversal replay must be explicit.');
  const reversedServiceDetail = hrEmployeeServiceSchema.parse((await hr.serviceDetail(creator, issuedService.serviceId)).service);
  assert.equal(reversedServiceDetail.status, 'ISSUED', 'Financial reversal must preserve the operational service status.');
  assert.equal(reversedServiceDetail.costStatus, 'REVERSED', 'Service detail must expose a reversed financial cost.');
  const reversedServiceFromList = (await hr.listServices(creator, { pageSize: 100 })).services.find((service) => service.id === issuedService.serviceId);
  assert.equal(hrEmployeeServiceSchema.parse(reversedServiceFromList).costStatus, 'REVERSED', 'The service register must expose a reversed financial cost.');
  const employeeServiceProjection = (await hr.employeeDetail(creator, payrollEmployee.id, { pageSize: 50 })).services.find((service) => service.id === issuedService.serviceId);
  assert.equal(hrEmployeeServiceSchema.parse(employeeServiceProjection).costStatus, 'REVERSED', 'The employee file must expose a reversed financial cost.');

  const deferredAdvance = await advances.issue(creator, {
    employeeId: payrollEmployee.id,
    businessDate: monthStart,
    amount: '25.0000',
    allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: '25.0000' }],
    notes: 'Deferred payroll collection guard',
  }, randomUUID());
  await advances.defer(creator, { advanceId: deferredAdvance.id, businessDate: monthStart, deferredUntil: today, reason: 'Collect no earlier than the current business date' }, randomUUID());
  const deferredDeduction = await deductions.create(creator, { employeeId: payrollEmployee.id, businessDate: monthStart, amount: '15.0000', description: 'Deferred payroll deduction' }, randomUUID());
  await deductions.defer(creator, { deductionId: deferredDeduction.id, businessDate: monthStart, deferredUntil: today, reason: 'Collect no earlier than the current business date' }, randomUUID());
  const laterDatedDeduction = await deductions.create(creator, { employeeId: payrollEmployee.id, businessDate: today, amount: '10.0000', description: 'Later-dated payroll deduction' }, randomUUID());
  const deductionDescriptionSearch = await deductions.list(creator, { search: 'Later-dated payroll deduction', pageSize: 1 });
  assert.deepEqual(deductionDescriptionSearch.deductions.map((item) => item.id), [laterDatedDeduction.id], 'Administrative-deduction search must run against descriptions in the full register.');
  const unavailablePayrollLine = { employeeId: payrollEmployee.id, advances: [{ id: deferredAdvance.id, amount: '10.0000' }], administrativeDeductions: [{ id: deferredDeduction.id, amount: '5.0000' }, { id: laterDatedDeduction.id, amount: '5.0000' }] };
  await assert.rejects(
    () => payroll.preview(creator, { payrollMonth: monthStart, businessDate: monthStart, includeOnLeaveEmployeeIds: [], lines: [unavailablePayrollLine], pageSize: 50 }),
    /unavailable/,
    'Payroll preview must reject advance/deduction collections before their issue or planned collection dates.',
  );
  const availabilityPreview = await payroll.preview(creator, { payrollMonth: monthStart, businessDate: monthStart, includeOnLeaveEmployeeIds: [], lines: [], pageSize: 50 });
  const payrollEmployeePreview = availabilityPreview.employees.find((employee) => employee.id === payrollEmployee.id);
  assert.ok(payrollEmployeePreview, 'Payroll employee must be visible in the preview page.');
  assert.equal(payrollEmployeePreview.advances.some((item) => item.id === deferredAdvance.id), false, 'Deferred advances must not be offered before their collection date.');
  assert.equal(payrollEmployeePreview.administrativeDeductions.some((item) => item.id === deferredDeduction.id || item.id === laterDatedDeduction.id), false, 'Deferred or later-created deductions must not be offered early.');
  await assert.rejects(
    () => payroll.create(creator, { payrollMonth: monthStart, businessDate: monthStart, includeAllEligible: true, includeOnLeaveEmployeeIds: [], lines: [unavailablePayrollLine], notes: 'Rejected early collections' }, randomUUID()),
    /unavailable/,
    'Payroll creation must revalidate collection dates independently of preview.',
  );

  const lateFinalEmployee = employees.get('late-final');
  const lateFinalDeduction = await deductions.create(creator, { employeeId: lateFinalEmployee.id, businessDate: today, amount: '10.0000', description: 'Final-settlement deduction created after termination' }, randomUUID());

  const payrollLine = { employeeId: payrollEmployee.id, advances: [{ id: advance.id, amount: '100.0000' }], administrativeDeductions: [] };
  const payrollPreviewInput = { payrollMonth: monthStart, businessDate: monthStart, includeOnLeaveEmployeeIds: [], lines: [payrollLine], pageSize: 50 };
  const preview = await payroll.preview(creator, payrollPreviewInput);
  assert.equal(preview.totals.employeeCount, employeeDefinitions.length);
  assert.equal(preview.totals.advanceSettlementAmount, '100.0000');

  const createPayrollInput = { payrollMonth: monthStart, businessDate: monthStart, includeAllEligible: true, includeOnLeaveEmployeeIds: [], lines: [payrollLine], notes: 'HR lifecycle payroll' };
  const payrollCreateKey = randomUUID();
  const run = await payroll.create(creator, createPayrollInput, payrollCreateKey);
  assert.equal(run.replayed, false);
  assert.equal((await payroll.create(creator, createPayrollInput, payrollCreateKey)).replayed, true, 'Payroll-create replay must be explicit.');

  await assert.rejects(
    () => payroll.approve(approver, { payrollRunId: run.id, businessDate: beforeMonth }, randomUUID()),
    /cannot be before the payroll business date/,
    'Payroll approval must not predate its header.',
  );
  const approvePayrollKey = randomUUID();
  const approvedRun = await payroll.approve(approver, { payrollRunId: run.id, businessDate: monthStart }, approvePayrollKey);
  assert.equal(approvedRun.replayed, false);
  assert.equal((await payroll.approve(approver, { payrollRunId: run.id, businessDate: monthStart }, approvePayrollKey)).replayed, true, 'Payroll-approval replay must be explicit.');

  const payrollDetail = await payroll.detail(creator, run.id, { linePageSize: 500, paymentPageSize: 100 });
  assert.equal(payrollDetail.payrollRun.businessDate, day(monthStart), 'Approval must not rewrite the payroll header date.');
  await assert.rejects(
    () => payroll.pay(payer, { payrollRunId: run.id, businessDate: beforeMonth, allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: payrollDetail.payrollRun.netPayableAmount }] }, randomUUID()),
    /cannot be before its approval or latest payment date/,
    'Payroll payment must not predate approval.',
  );
  const payPayrollInput = { payrollRunId: run.id, businessDate: monthStart, allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: payrollDetail.payrollRun.netPayableAmount }] };
  const payPayrollKey = randomUUID();
  assert.equal((await payroll.pay(payer, payPayrollInput, payPayrollKey)).replayed, false);
  assert.equal((await payroll.pay(payer, payPayrollInput, payPayrollKey)).replayed, true, 'Payroll-payment replay must be explicit.');
  await assert.rejects(
    () => payroll.reverse(payer, { payrollRunId: run.id, businessDate: monthStart, reason: 'A paid payroll must reject reversal' }, randomUUID()),
    /must be unpaid/,
    'A paid payroll reversal must be rejected.',
  );
  const postedPayrollDetail = await payroll.detail(creator, run.id, { linePageSize: 500, paymentPageSize: 100 });
  const payrollPayment = postedPayrollDetail.payments[0];
  assert.equal(payrollPayment?.status, 'POSTED');
  await assert.rejects(
    () => payroll.reversePayment(creator, { payrollPaymentId: payrollPayment.id, businessDate: beforeMonth, reason: 'Invalid historical payroll-payment reversal' }, randomUUID()),
    /cannot predate the latest payroll payment event/,
    'A payroll-payment reversal must not predate approval/payment history.',
  );
  const payrollPaymentReversalKeys = [randomUUID(), randomUUID()];
  const payrollPaymentReversalResults = await Promise.allSettled([
    payroll.reversePayment(creator, { payrollPaymentId: payrollPayment.id, businessDate: monthStart, reason: 'Concurrent payroll-payment reversal' }, payrollPaymentReversalKeys[0]),
    payroll.reversePayment(approver, { payrollPaymentId: payrollPayment.id, businessDate: monthStart, reason: 'Concurrent payroll-payment reversal' }, payrollPaymentReversalKeys[1]),
  ]);
  assert.equal(payrollPaymentReversalResults.filter((result) => result.status === 'fulfilled').length, 1, 'The payroll-run lock must allow exactly one concurrent payment reversal.');
  const successfulPayrollPaymentReversal = payrollPaymentReversalResults.findIndex((result) => result.status === 'fulfilled');
  assert.match(String(payrollPaymentReversalResults[1 - successfulPayrollPaymentReversal].reason?.message), /already been reversed/);
  const payrollPaymentReversalActor = successfulPayrollPaymentReversal === 0 ? creator : approver;
  assert.equal((await payroll.reversePayment(payrollPaymentReversalActor, { payrollPaymentId: payrollPayment.id, businessDate: monthStart, reason: 'Concurrent payroll-payment reversal' }, payrollPaymentReversalKeys[successfulPayrollPaymentReversal])).replayed, true, 'Payroll-payment reversal replay must be explicit.');
  const reversedPayrollPaymentDetail = await payroll.detail(creator, run.id, { linePageSize: 500, paymentPageSize: 100 });
  assert.equal(reversedPayrollPaymentDetail.payments[0]?.status, 'REVERSED', 'Payroll payment detail must derive reversal state from the journal link.');
  assert.ok(reversedPayrollPaymentDetail.payments[0]?.reversalJournalEntryId);
  const mainPayrollReversalKey = randomUUID();
  assert.equal((await payroll.reverse(payer, { payrollRunId: run.id, businessDate: monthStart, reason: 'Payroll accrual reversal after payment reversal' }, mainPayrollReversalKey)).replayed, false);
  assert.equal((await payroll.reverse(payer, { payrollRunId: run.id, businessDate: monthStart, reason: 'Payroll accrual reversal after payment reversal' }, mainPayrollReversalKey)).replayed, true, 'Payroll accrual reversal replay must remain explicit after reversing its payment.');

  const reversalEmployee = await payroll.onboardEmployee(reversalCreator, onboardingInput('موظف عكس المسير'), randomUUID());
  const reversalAdvance = await advances.issue(reversalCreator, {
    employeeId: reversalEmployee.id,
    businessDate: monthStart,
    amount: '100.0000',
    allocations: [{ vaultId: reversalCashVaultId, paymentMethod: 'CASH', amount: '100.0000' }],
    notes: 'Payroll reversal employee-ledger verification',
  }, randomUUID());
  const reversalPayroll = await payroll.create(reversalCreator, {
    payrollMonth: monthStart,
    businessDate: monthStart,
    includeAllEligible: true,
    includeOnLeaveEmployeeIds: [],
    lines: [{ employeeId: reversalEmployee.id, advances: [{ id: reversalAdvance.id, amount: '100.0000' }], administrativeDeductions: [] }],
    notes: 'Payroll reversal lifecycle',
  }, randomUUID());
  await payroll.approve(reversalApprover, { payrollRunId: reversalPayroll.id, businessDate: monthStart }, randomUUID());
  const reversalPayrollKey = randomUUID();
  assert.equal((await payroll.reverse(reversalPayer, { payrollRunId: reversalPayroll.id, businessDate: monthStart, reason: 'Payroll reversal lifecycle verification' }, reversalPayrollKey)).replayed, false);
  assert.equal((await payroll.reverse(reversalPayer, { payrollRunId: reversalPayroll.id, businessDate: monthStart, reason: 'Payroll reversal lifecycle verification' }, reversalPayrollKey)).replayed, true, 'Payroll reversal replay must be explicit.');

  const reverseEmployee = employees.get('reverse');
  const recoveryAdvance = await advances.issue(creator, {
    employeeId: reverseEmployee.id,
    businessDate: monthStart,
    amount: '20.0000',
    allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: '20.0000' }],
    notes: 'Final-settlement reversal recovery',
  }, randomUUID());

  for (const key of ['zero', 'reverse', 'paid']) {
    const employee = employees.get(key);
    await hr.updateEmployee(creator, { employeeId: employee.id, nameAr: employee.nameAr, status: 'TERMINATED', terminatedAt: today }, randomUUID());
  }
  const yesterday = addDays(today, -1);
  for (const key of ['late-final']) {
    const employee = employees.get(key);
    await hr.updateEmployee(creator, { employeeId: employee.id, nameAr: employee.nameAr, status: 'TERMINATED', terminatedAt: yesterday }, randomUUID());
  }

  for (const [key, deduction, expectedMessage] of [['late-final', lateFinalDeduction, /cannot predate its creation date/]]) {
    const employee = employees.get(key);
    const request = { ...finalSettlementInput(employee.id, 'EMPLOYER_TERMINATION', [{ recoveryType: 'ADMINISTRATIVE_DEDUCTION', sourceId: deduction.id, amount: '10.0000' }]), terminationDate: yesterday };
    const settlement = await settlements.create(creator, request);
    await settlements.verifyReason(approver, { settlementId: settlement.id, verificationNote: 'Verified chronology guard' }, randomUUID());
    await assert.rejects(
      () => settlements.approve(approver, { settlementId: settlement.id, businessDate: yesterday }, randomUUID()),
      expectedMessage,
      'Final-settlement deductions must not be recovered before their creation date.',
    );
    await settlements.approve(approver, { settlementId: settlement.id, businessDate: today }, randomUUID());
    await settlements.reverse(payer, { settlementId: settlement.id, businessDate: today, reason: 'Chronology guard verification reversal' }, randomUUID());
  }

  const zeroEmployee = employees.get('zero');
  const zeroRequest = finalSettlementInput(zeroEmployee.id, 'ARTICLE_80', []);
  const zeroPreview = await settlements.preview(creator, withoutKey(zeroRequest));
  assert.equal(zeroPreview.netPayableAmount, '0.0000', 'Article 80 fixture must produce a zero settlement.');
  const zeroSettlement = await settlements.create(creator, zeroRequest);
  assert.equal((await settlements.create(creator, zeroRequest)).replayed, true, 'Zero-settlement create replay must be explicit.');
  await assert.rejects(
    () => settlements.approve(approver, { settlementId: zeroSettlement.id, businessDate: addDays(today, -1) }, randomUUID()),
    /cannot be before the termination date/,
    'Final-settlement approval must not predate termination.',
  );
  await settlements.verifyReason(approver, { settlementId: zeroSettlement.id, verificationNote: 'Verified by lifecycle runner' }, randomUUID());
  const zeroApproveKey = randomUUID();
  await settlements.approve(approver, { settlementId: zeroSettlement.id, businessDate: today }, zeroApproveKey);
  assert.equal((await settlements.approve(approver, { settlementId: zeroSettlement.id, businessDate: today }, zeroApproveKey)).replayed, true, 'Zero-settlement approval replay must be explicit.');
  await assert.rejects(
    () => settlements.reverse(payer, { settlementId: zeroSettlement.id, businessDate: addDays(today, -1), reason: 'Invalid historical reversal' }, randomUUID()),
    /cannot be before its termination or approval date/,
    'Zero-settlement reversal must use its audit-backed approval business date.',
  );
  const zeroReverseKey = randomUUID();
  assert.equal((await settlements.reverse(payer, { settlementId: zeroSettlement.id, businessDate: today, reason: 'Zero settlement lifecycle reversal' }, zeroReverseKey)).replayed, false);
  assert.equal((await settlements.reverse(payer, { settlementId: zeroSettlement.id, businessDate: today, reason: 'Zero settlement lifecycle reversal' }, zeroReverseKey)).replayed, true, 'Zero-settlement reversal replay must be explicit.');

  const reverseRequest = finalSettlementInput(reverseEmployee.id, 'EMPLOYER_TERMINATION', [{ recoveryType: 'ADVANCE', sourceId: recoveryAdvance.id, amount: '10.0000' }]);
  const reversePreview = await settlements.preview(creator, withoutKey(reverseRequest));
  assert.ok(Number(reversePreview.netPayableAmount) > 0, 'Nonzero reversal fixture must have a payable amount.');
  const reversingSettlement = await settlements.create(creator, reverseRequest);
  await settlements.approve(approver, { settlementId: reversingSettlement.id, businessDate: today }, randomUUID());
  await assert.rejects(
    () => settlements.reverse(payer, { settlementId: reversingSettlement.id, businessDate: addDays(today, -1), reason: 'Invalid historical reversal' }, randomUUID()),
    /cannot be before its termination or approval date/,
  );
  const reverseFinalKey = randomUUID();
  assert.equal((await settlements.reverse(payer, { settlementId: reversingSettlement.id, businessDate: today, reason: 'Nonzero settlement lifecycle reversal' }, reverseFinalKey)).replayed, false);
  assert.equal((await settlements.reverse(payer, { settlementId: reversingSettlement.id, businessDate: today, reason: 'Nonzero settlement lifecycle reversal' }, reverseFinalKey)).replayed, true, 'Nonzero-settlement reversal replay must be explicit.');

  const paidEmployee = employees.get('paid');
  const paidRequest = finalSettlementInput(paidEmployee.id, 'EMPLOYER_TERMINATION', []);
  const paidPreview = await settlements.preview(creator, withoutKey(paidRequest));
  assert.ok(Number(paidPreview.netPayableAmount) > 0, 'Paid final-settlement fixture must have a payable amount.');
  const paidSettlement = await settlements.create(creator, paidRequest);
  await settlements.approve(approver, { settlementId: paidSettlement.id, businessDate: today }, randomUUID());
  await assert.rejects(
    () => settlements.pay(payer, { settlementId: paidSettlement.id, businessDate: addDays(today, -1), allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: paidPreview.netPayableAmount }] }, randomUUID()),
    /cannot be before its approval or latest payment date/,
    'Final-settlement payment must not predate approval.',
  );
  const finalPayInput = { settlementId: paidSettlement.id, businessDate: today, allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: paidPreview.netPayableAmount }] };
  const finalPayKey = randomUUID();
  assert.equal((await settlements.pay(payer, finalPayInput, finalPayKey)).replayed, false);
  assert.equal((await settlements.pay(payer, finalPayInput, finalPayKey)).replayed, true, 'Final-settlement payment replay must be explicit.');
  await assert.rejects(
    () => settlements.reverse(payer, { settlementId: paidSettlement.id, businessDate: today, reason: 'Paid final settlement must reject reversal' }, randomUUID()),
    /Only an unpaid approved final settlement can be reversed/,
  );
  const postedFinalDetail = await settlements.detail(creator, paidSettlement.id, { pageSize: 100 });
  const finalSettlementPayment = postedFinalDetail.payments[0];
  assert.equal(finalSettlementPayment?.status, 'POSTED');
  await assert.rejects(
    () => settlements.reversePayment(creator, { finalSettlementPaymentId: finalSettlementPayment.id, businessDate: addDays(today, -1), reason: 'Invalid historical final-payment reversal' }, randomUUID()),
    /cannot predate the latest payment event/,
    'A final-settlement payment reversal must not predate payment history.',
  );
  const finalPaymentReversalKeys = [randomUUID(), randomUUID()];
  const finalPaymentReversalResults = await Promise.allSettled([
    settlements.reversePayment(creator, { finalSettlementPaymentId: finalSettlementPayment.id, businessDate: today, reason: 'Concurrent final-settlement payment reversal' }, finalPaymentReversalKeys[0]),
    settlements.reversePayment(approver, { finalSettlementPaymentId: finalSettlementPayment.id, businessDate: today, reason: 'Concurrent final-settlement payment reversal' }, finalPaymentReversalKeys[1]),
  ]);
  assert.equal(finalPaymentReversalResults.filter((result) => result.status === 'fulfilled').length, 1, 'The final-settlement lock must allow exactly one concurrent payment reversal.');
  const successfulFinalPaymentReversal = finalPaymentReversalResults.findIndex((result) => result.status === 'fulfilled');
  assert.match(String(finalPaymentReversalResults[1 - successfulFinalPaymentReversal].reason?.message), /already been reversed/);
  const finalPaymentReversalActor = successfulFinalPaymentReversal === 0 ? creator : approver;
  assert.equal((await settlements.reversePayment(finalPaymentReversalActor, { finalSettlementPaymentId: finalSettlementPayment.id, businessDate: today, reason: 'Concurrent final-settlement payment reversal' }, finalPaymentReversalKeys[successfulFinalPaymentReversal])).replayed, true, 'Final-settlement payment reversal replay must be explicit.');
  const reversedFinalDetail = await settlements.detail(creator, paidSettlement.id, { pageSize: 100 });
  assert.equal(reversedFinalDetail.payments[0]?.status, 'REVERSED', 'Final-settlement payment detail must derive reversal state from the journal link.');
  assert.ok(reversedFinalDetail.payments[0]?.reversalJournalEntryId);
  const paidFinalReversalKey = randomUUID();
  assert.equal((await settlements.reverse(payer, { settlementId: paidSettlement.id, businessDate: today, reason: 'Final accrual reversal after payment reversal' }, paidFinalReversalKey)).replayed, false);
  assert.equal((await settlements.reverse(payer, { settlementId: paidSettlement.id, businessDate: today, reason: 'Final accrual reversal after payment reversal' }, paidFinalReversalKey)).replayed, true, 'Final accrual reversal replay must remain explicit after reversing its payment.');

  const proof = await database.inTenantTransaction(fixture.tenantId, async (tx) => {
    const [payrollRow, payrollAdvance, reversedAdvanceRow, reversedAdvanceMovements, serviceRow, serviceMovements, zeroRow, reversedRow, paidRow, payrollPaymentMovements, finalPaymentMovements, recoveryRows, movements, payrollAdvanceMovements, finalAdvanceMovements, reversedPayrollMovements, reversedPayrollSettlements, journalEntries] = await Promise.all([
      tx.hrPayrollRun.findFirstOrThrow({ where: { id: run.id, tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { status: true, businessDate: true, paidAmount: true, netPayableAmount: true } }),
      tx.hrEmployeeAdvance.findFirstOrThrow({ where: { id: advance.id, tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { remainingAmount: true } }),
      tx.hrEmployeeAdvance.findFirstOrThrow({ where: { id: reversibleAdvance.id, tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { status: true, remainingAmount: true, issueJournalEntry: { select: { reversalEntry: { select: { id: true } } } } } }),
      tx.hrEmployeeFinancialMovement.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, employeeId: payrollEmployee.id, movementType: 'ADVANCE_ISSUED', sourceReference: { in: [reversibleAdvance.advanceNumber, `${reversibleAdvance.advanceNumber}-REV`] } }, orderBy: { createdAt: 'asc' }, select: { amount: true } }),
      tx.hrEmployeeService.findFirstOrThrow({ where: { id: issuedService.serviceId, tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { status: true, outflowDocumentId: true, outflowDocument: { select: { status: true, journalEntry: { select: { reversalEntry: { select: { id: true } } } } } } } }),
      tx.hrEmployeeFinancialMovement.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, employeeId: payrollEmployee.id, movementType: 'SERVICE_COST', sourceReference: { in: [issuedService.documentNumber, `${issuedService.documentNumber}-REV`] } }, orderBy: { createdAt: 'asc' }, select: { amount: true } }),
      tx.hrFinalSettlement.findFirstOrThrow({ where: { id: zeroSettlement.id, tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { status: true, accrualJournalEntryId: true } }),
      tx.hrFinalSettlement.findFirstOrThrow({ where: { id: reversingSettlement.id, tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { status: true } }),
      tx.hrFinalSettlement.findFirstOrThrow({ where: { id: paidSettlement.id, tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { status: true, paidAmount: true, netPayableAmount: true } }),
      tx.hrEmployeeFinancialMovement.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, employeeId: payrollEmployee.id, movementType: 'PAYROLL_PAYMENT' }, orderBy: { createdAt: 'asc' }, select: { amount: true } }),
      tx.hrEmployeeFinancialMovement.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, employeeId: paidEmployee.id, movementType: 'FINAL_SETTLEMENT_PAYMENT' }, orderBy: { createdAt: 'asc' }, select: { amount: true } }),
      tx.hrEmployeeAdvanceSettlement.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, advanceId: recoveryAdvance.id, source: 'FINAL_SETTLEMENT' }, orderBy: { createdAt: 'asc' }, select: { amount: true, journalEntryId: true } }),
      tx.hrEmployeeFinancialMovement.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, employeeId: reverseEmployee.id, movementType: 'FINAL_SETTLEMENT_ACCRUAL' }, select: { amount: true } }),
      tx.hrEmployeeFinancialMovement.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, employeeId: payrollEmployee.id, movementType: 'ADVANCE_SETTLEMENT' }, orderBy: { createdAt: 'asc' }, select: { amount: true } }),
      tx.hrEmployeeFinancialMovement.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId, employeeId: reverseEmployee.id, movementType: 'ADVANCE_SETTLEMENT' }, orderBy: { createdAt: 'asc' }, select: { amount: true } }),
      tx.hrEmployeeFinancialMovement.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.reversalCompanyId, employeeId: reversalEmployee.id, movementType: 'ADVANCE_SETTLEMENT' }, orderBy: { createdAt: 'asc' }, select: { amount: true } }),
      tx.hrEmployeeAdvanceSettlement.findMany({ where: { tenantId: fixture.tenantId, companyId: fixture.reversalCompanyId, advanceId: reversalAdvance.id, source: 'PAYROLL' }, orderBy: { createdAt: 'asc' }, select: { amount: true } }),
      tx.financeJournalEntry.findMany({ where: { tenantId: fixture.tenantId, companyId: { in: [fixture.companyId, fixture.reversalCompanyId] } }, include: { lines: true } }),
    ]);
    return { payrollRow, payrollAdvance, reversedAdvanceRow, reversedAdvanceMovements, serviceRow, serviceMovements, zeroRow, reversedRow, paidRow, payrollPaymentMovements, finalPaymentMovements, recoveryRows, movements, payrollAdvanceMovements, finalAdvanceMovements, reversedPayrollMovements, reversedPayrollSettlements, journalEntries };
  });
  assert.equal(proof.payrollRow.status, 'REVERSED');
  assert.equal(proof.payrollRow.businessDate.toISOString(), monthStart.toISOString());
  assert.equal(proof.payrollRow.paidAmount.toFixed(4), '0.0000');
  assert.equal(proof.payrollAdvance.remainingAmount.toFixed(4), '250.0000');
  assert.equal(proof.reversedAdvanceRow.status, 'REVERSED');
  assert.equal(proof.reversedAdvanceRow.remainingAmount.toFixed(4), '0.0000');
  assert.ok(proof.reversedAdvanceRow.issueJournalEntry.reversalEntry?.id, 'A reversed advance issue must link its immutable reversal journal.');
  assert.deepEqual(proof.reversedAdvanceMovements.map((movement) => movement.amount.toFixed(4)), ['40.0000', '-40.0000'], 'Advance issue/reversal movements must be append-only and net to zero.');
  assert.equal(proof.serviceRow.status, 'ISSUED', 'Reversing service cost must not cancel the operational employee service.');
  assert.equal(proof.serviceRow.outflowDocumentId, issuedService.documentId, 'The service must retain its historical cost-document link.');
  assert.equal(proof.serviceRow.outflowDocument?.status, 'CANCELLED');
  assert.ok(proof.serviceRow.outflowDocument?.journalEntry.reversalEntry?.id, 'A cancelled service-cost document must link its immutable reversal journal.');
  assert.deepEqual(proof.serviceMovements.map((movement) => movement.amount.toFixed(4)), ['75.0000', '-75.0000'], 'Service cost/reversal movements must be append-only and net to zero.');
  assert.equal(proof.zeroRow.status, 'REVERSED');
  assert.equal(proof.zeroRow.accrualJournalEntryId, null, 'A zero settlement must not create an empty journal.');
  assert.equal(proof.reversedRow.status, 'REVERSED');
  assert.equal(proof.paidRow.status, 'REVERSED');
  assert.equal(proof.paidRow.paidAmount.toFixed(4), '0.0000');
  assert.equal(proof.payrollPaymentMovements.length, 2, 'Payroll payment reversal must append exactly one compensating employee movement.');
  assert.equal(proof.payrollPaymentMovements.reduce((total, movement) => total + Number(movement.amount), 0), 0, 'Payroll payment/reversal movements must be append-only and net to zero.');
  assert.deepEqual(proof.finalPaymentMovements.map((movement) => movement.amount.toFixed(4)), [proof.paidRow.netPayableAmount.toFixed(4), proof.paidRow.netPayableAmount.negated().toFixed(4)], 'Final-settlement payment/reversal movements must be append-only and net to zero.');
  assert.deepEqual(proof.recoveryRows.map((row) => row.amount.toFixed(4)), ['10.0000', '-10.0000'], 'Advance recovery reversal must be append-only.');
  assert.equal(proof.recoveryRows.every((row) => row.journalEntryId), true, 'Both recovery events must reference their journal.');
  assert.equal(proof.movements.reduce((sum, movement) => sum + Number(movement.amount), 0), 0, 'Final-settlement accrual and reversal movements must net to zero.');
  assert.deepEqual(proof.payrollAdvanceMovements.map((movement) => movement.amount.toFixed(4)), ['50.0000', '100.0000', '-100.0000'], 'Direct and payroll advance settlement/reversal events must remain append-only in the employee ledger.');
  assert.deepEqual(proof.finalAdvanceMovements.map((movement) => movement.amount.toFixed(4)), ['10.0000', '-10.0000'], 'Final-settlement advance recovery and reversal must be append-only and net to zero in the employee ledger.');
  assert.deepEqual(proof.reversedPayrollMovements.map((movement) => movement.amount.toFixed(4)), ['100.0000', '-100.0000'], 'Payroll advance settlement and reversal must be append-only and net to zero in the employee ledger.');
  assert.deepEqual(proof.reversedPayrollSettlements.map((settlement) => settlement.amount.toFixed(4)), ['100.0000', '-100.0000'], 'Payroll advance balance history must retain both application and reversal rows.');
  for (const journal of proof.journalEntries) {
    assert.equal(journal.isSealed, true, 'Every HR journal must remain sealed.');
    const debit = journal.lines.reduce((sum, line) => sum + Number(line.debitAmount), 0);
    const credit = journal.lines.reduce((sum, line) => sum + Number(line.creditAmount), 0);
    assert.equal(debit, credit, `Journal ${journal.id} must balance.`);
  }

  console.log('HR lifecycle verification passed: onboarding/salary, advance and service-cost issue/reversal, deferred collection guards, payroll and final-settlement payment/accrual reversal, append-only employee-ledger movements, explicit replay, concurrency locks, and monotonic business dates.');
  console.log(`Isolated fixture retained in the test database: ${fixture.tenantCode} (${fixture.tenantId}). Cleanup requires a privileged test-database reset because audit rows are immutable to the application role.`);
} finally {
  if (app) await app.close();
  await pool.end();
}

async function seedFixture() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, fixture.tenantCode, 'HR lifecycle verification']);
    await client.query(
      `INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES
       ($1::uuid, $4::uuid, $5, 'منشئ تحقق الموارد البشرية', 'HR lifecycle creator', 'unused-test-hash'),
       ($2::uuid, $4::uuid, $6, 'معتمد تحقق الموارد البشرية', 'HR lifecycle approver', 'unused-test-hash'),
       ($3::uuid, $4::uuid, $7, 'مسدد تحقق الموارد البشرية', 'HR lifecycle payer', 'unused-test-hash')`,
      [fixture.creatorId, fixture.approverId, fixture.payerId, fixture.tenantId, `hr-creator-${suffix}@baseer.test`, `hr-approver-${suffix}@baseer.test`, `hr-payer-${suffix}@baseer.test`],
    );
    await client.query(
      `INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES
       ($1::uuid, $3::uuid, 'شركة تحقق دورة الموارد البشرية', 'HR lifecycle company'),
       ($2::uuid, $3::uuid, 'شركة تحقق عكس مسير الموارد البشرية', 'HR payroll reversal company')`,
      [fixture.companyId, fixture.reversalCompanyId, fixture.tenantId],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function actor(actorUserId) { return { tenantId: fixture.tenantId, companyId: fixture.companyId, actorUserId }; }
function actorFor(companyId, actorUserId) { return { tenantId: fixture.tenantId, companyId, actorUserId }; }
function onboardingInput(nameAr) { return { nameAr, jobTitle: 'موظف تحقق', hireDate: monthStart, initialCompensation: { monthlyGross: '5000.0000', compensationMethod: 'FIXED_MONTHLY', foodAllowance: '0.0000', housingAllowance: '0.0000', transportAllowance: '0.0000', otherAllowance: '0.0000' } }; }
function finalSettlementInput(employeeId, terminationReason, recoveries) { return { employeeId, terminationDate: today, terminationReason, reasonEvidenceReference: `HR-LIFECYCLE-${suffix}`, reasonEvidenceNote: 'Automated isolated lifecycle verification', recoveries, idempotencyKey: randomUUID() }; }
function withoutKey(value) { const { idempotencyKey: _key, ...request } = value; return request; }
function date(value) { return new Date(`${value}T00:00:00.000Z`); }
function day(value) { return value.toISOString().slice(0, 10); }
function addDays(value, amount) { return new Date(value.getTime() + amount * 86_400_000); }
function riyadhDate() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const fields = new Map(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])); return `${fields.get('year')}-${fields.get('month')}-${fields.get('day')}`; }
function requiredEnvironment(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }
