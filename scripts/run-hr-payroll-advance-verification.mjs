import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

import dotenv from 'dotenv';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter } from './api-workspace-dependencies.mjs';
import pg from 'pg';

dotenv.config({ path: 'apps/api/.env.baseer-test' });

const { Pool } = pg;
const pool = new Pool({ connectionString: requiredEnvironment('DATABASE_URL') });
const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
const fixture = {
  tenantId: randomUUID(),
  companyId: randomUUID(),
  creatorId: randomUUID(),
  approverId: randomUUID(),
  payerId: randomUUID(),
  tenantCode: `hr-payroll-advance-${suffix}`,
};
const today = date(riyadhDate());
const monthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
const fiscalStart = new Date(Date.UTC(today.getUTCFullYear(), 0, 1));
const fiscalEnd = new Date(Date.UTC(today.getUTCFullYear(), 11, 31));
const creator = actor(fixture.creatorId);
const approver = actor(fixture.approverId);
const payer = actor(fixture.payerId);
let app;

try {
  await seedFixture();
  process.env.BASEER_SYSTEM_TENANT_CODE = fixture.tenantCode;
  console.log(`HR payroll/advance fixture: ${fixture.tenantCode} (${fixture.tenantId})`);

  const [
    { AppModule },
    { DatabaseService },
    { CompanyFinanceSetupService },
    { HrPayrollService },
    { HrAdvanceService },
  ] = await Promise.all([
    import('../apps/api/dist/app.module.js'),
    import('../apps/api/dist/database/database.service.js'),
    import('../apps/api/dist/finance/company-finance-setup.service.js'),
    import('../apps/api/dist/hr/hr-payroll.service.js'),
    import('../apps/api/dist/hr/hr-advance.service.js'),
  ]);

  app = await NestFactory.create(AppModule, new FastifyAdapter({ logger: false }), { logger: false });
  await app.init();

  const database = app.get(DatabaseService);
  const setup = app.get(CompanyFinanceSetupService);
  const payroll = app.get(HrPayrollService);
  const advances = app.get(HrAdvanceService);

  const finance = await setup.initialize(creator, {
    fiscalPeriodNameAr: 'فترة تحقق راتب وتسوية سلفة',
    fiscalPeriodNameEn: 'Payroll and advance verification period',
    fiscalPeriodStartDate: fiscalStart,
    fiscalPeriodEndDate: fiscalEnd,
    selectedVaults: ['CASH'],
  }, randomUUID());
  const cashVaultId = finance.vaultIds[0];
  assert.ok(cashVaultId, 'Finance setup must create a cash vault.');

  const employee = await payroll.onboardEmployee(creator, {
    nameAr: 'موظف تحقق راتب خمسة وثلاثين ألفًا',
    nameEn: 'Payroll 35k verification employee',
    jobTitle: 'موظف تحقق',
    hireDate: monthStart,
    initialCompensation: {
      monthlyGross: '35000.0000',
      compensationMethod: 'FIXED_MONTHLY',
      foodAllowance: '0.0000',
      housingAllowance: '0.0000',
      transportAllowance: '0.0000',
      otherAllowance: '0.0000',
    },
  }, randomUUID());

  const beforeCreation = await payrollState(database, null);
  assert.equal(beforeCreation.runCount, 0, 'The scenario must begin without a payroll run.');
  assert.equal(beforeCreation.payrollJournalCount, 0, 'An uncreated payroll must have no payroll journals.');

  const advanceInput = {
    employeeId: employee.id,
    businessDate: monthStart,
    amount: '5000.0000',
    allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: '5000.0000' }],
    notes: 'Explicit 35k/5k/30k payroll verification advance',
  };
  const advanceKey = randomUUID();
  const advance = await advances.issue(creator, advanceInput, advanceKey);
  assert.equal(advance.replayed, false);
  assert.equal((await advances.issue(creator, advanceInput, advanceKey)).replayed, true, 'Advance issue replay must not duplicate its journal.');

  const advanceJournal = await journalById(database, advance.journalEntryId);
  assertJournal(advanceJournal, [
    { code: 'ADV-001', debit: '5000.0000', credit: '0.0000' },
    { code: advanceJournal.vaultAccountCode, debit: '0.0000', credit: '5000.0000' },
  ], 'Advance issue');

  const createInput = {
    payrollMonth: monthStart,
    businessDate: monthStart,
    includeAllEligible: true,
    includeOnLeaveEmployeeIds: [],
    lines: [{ employeeId: employee.id, advances: [{ id: advance.id, amount: '5000.0000' }], administrativeDeductions: [] }],
    notes: 'Explicit gross 35000 / advance settlement 5000 / net payable 30000',
  };
  const createKey = randomUUID();
  const run = await payroll.create(creator, createInput, createKey);
  assert.equal(run.replayed, false);
  assert.equal((await payroll.create(creator, createInput, createKey)).replayed, true, 'Payroll create replay must not duplicate the draft.');

  const draft = await payroll.detail(creator, run.id, { linePageSize: 10, paymentPageSize: 10 });
  assertRun(draft, { status: 'DRAFT', gross: '35000.0000', advance: '5000.0000', net: '30000.0000', paid: '0.0000' });
  assert.equal(draft.payrollRun.accrualJournalEntryId, null, 'A draft payroll must have no accrual journal.');
  assert.equal(draft.lines.length, 1);
  assert.equal(draft.lines[0].grossSalary, '35000.0000');
  assert.equal(draft.lines[0].advanceSettlementAmount, '5000.0000');
  assert.equal(draft.lines[0].netPayableAmount, '30000.0000');
  assert.equal(draft.lines[0].paidAmount, '0.0000');
  const draftState = await payrollState(database, run.id);
  assert.equal(draftState.payrollJournalCount, 0, 'A draft payroll must not post a financial journal.');
  assert.equal(draftState.advance.status, 'ISSUED', 'Selecting an advance in a draft must not settle it.');
  assert.equal(draftState.advance.remainingAmount.toFixed(4), '5000.0000');
  assert.equal(draftState.advanceSettlements.length, 0);
  await assert.rejects(
    () => payroll.pay(payer, { payrollRunId: run.id, businessDate: monthStart, allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: '10000.0000' }] }, randomUUID()),
    /Only an approved unpaid payroll can be paid/,
    'A draft payroll must not be payable.',
  );

  const approveKey = randomUUID();
  assert.equal((await payroll.approve(approver, { payrollRunId: run.id, businessDate: monthStart }, approveKey)).replayed, false);
  assert.equal((await payroll.approve(approver, { payrollRunId: run.id, businessDate: monthStart }, approveKey)).replayed, true, 'Payroll approval replay must not duplicate accrual or advance settlement.');

  const approved = await payroll.detail(creator, run.id, { linePageSize: 10, paymentPageSize: 10 });
  assertRun(approved, { status: 'APPROVED', gross: '35000.0000', advance: '5000.0000', net: '30000.0000', paid: '0.0000' });
  assert.ok(approved.payrollRun.accrualJournalEntryId, 'Approval must link its accrual journal.');
  const accrualJournal = await journalById(database, approved.payrollRun.accrualJournalEntryId);
  assertJournal(accrualJournal, [
    { code: 'EXP-004', debit: '35000.0000', credit: '0.0000' },
    { code: 'ADV-001', debit: '0.0000', credit: '5000.0000' },
    { code: 'PAY-001', debit: '0.0000', credit: '30000.0000' },
  ], 'Payroll accrual');
  const approvedState = await payrollState(database, run.id);
  assert.equal(approvedState.advance.status, 'SETTLED');
  assert.equal(approvedState.advance.settledAmount.toFixed(4), '5000.0000');
  assert.equal(approvedState.advance.remainingAmount.toFixed(4), '0.0000');
  assert.equal(approvedState.advanceSettlements.length, 1, 'Approval must create exactly one payroll advance settlement.');
  assert.equal(approvedState.advanceSettlements[0].source, 'PAYROLL');
  assert.equal(approvedState.advanceSettlements[0].amount.toFixed(4), '5000.0000');
  assert.equal(approvedState.advanceSettlements[0].journalEntryId, approved.payrollRun.accrualJournalEntryId);
  assert.equal(approvedState.payrollAccrualMovements.length, 1);
  assert.equal(approvedState.payrollAccrualMovements[0].amount.toFixed(4), '35000.0000');
  assert.equal(approvedState.advanceSettlementMovements.length, 1);
  assert.equal(approvedState.advanceSettlementMovements[0].amount.toFixed(4), '5000.0000');
  assert.equal(approvedState.paymentCount, 0, 'An approved unpaid payroll must have no payment.');
  await assert.rejects(
    () => payroll.approve(approver, { payrollRunId: run.id, businessDate: monthStart }, randomUUID()),
    /Only a draft payroll run can be approved/,
    'A second approval with a new key must not duplicate the accrual.',
  );

  const partialPayment = { payrollRunId: run.id, businessDate: monthStart, allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: '10000.0000' }] };
  const partialKey = randomUUID();
  assert.equal((await payroll.pay(payer, partialPayment, partialKey)).replayed, false);
  assert.equal((await payroll.pay(payer, partialPayment, partialKey)).replayed, true, 'Partial-payment replay must not duplicate cash or payroll movements.');
  const partial = await payroll.detail(creator, run.id, { linePageSize: 10, paymentPageSize: 10 });
  assertRun(partial, { status: 'PARTIALLY_PAID', gross: '35000.0000', advance: '5000.0000', net: '30000.0000', paid: '10000.0000' });
  assert.equal(partial.lines[0].paidAmount, '10000.0000');
  assert.equal(partial.payments.length, 1);
  const firstPaymentJournal = await journalById(database, partial.payments[0].journalEntryId);
  assertJournal(firstPaymentJournal, [
    { code: 'PAY-001', debit: '10000.0000', credit: '0.0000' },
    { code: firstPaymentJournal.vaultAccountCode, debit: '0.0000', credit: '10000.0000' },
  ], 'Partial payroll payment');
  await assert.rejects(
    () => payroll.pay(payer, { payrollRunId: run.id, businessDate: monthStart, allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: '20000.0001' }] }, randomUUID()),
    /cannot exceed the unpaid net amount/,
    'A partial payroll must reject an overpayment without posting a journal.',
  );

  const finalPayment = { payrollRunId: run.id, businessDate: monthStart, allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: '20000.0000' }] };
  const finalKey = randomUUID();
  assert.equal((await payroll.pay(payer, finalPayment, finalKey)).replayed, false);
  assert.equal((await payroll.pay(payer, finalPayment, finalKey)).replayed, true, 'Final-payment replay must not duplicate cash or payroll movements.');
  const paid = await payroll.detail(creator, run.id, { linePageSize: 10, paymentPageSize: 10 });
  assertRun(paid, { status: 'PAID', gross: '35000.0000', advance: '5000.0000', net: '30000.0000', paid: '30000.0000' });
  assert.equal(paid.lines[0].paidAmount, '30000.0000');
  assert.equal(paid.payments.length, 2, 'A fully paid payroll must retain both partial payment records.');
  await assert.rejects(
    () => payroll.pay(payer, { payrollRunId: run.id, businessDate: monthStart, allocations: [{ vaultId: cashVaultId, paymentMethod: 'CASH', amount: '1.0000' }] }, randomUUID()),
    /Only an approved unpaid payroll can be paid/,
    'A paid payroll must reject further payments.',
  );

  const finalState = await payrollState(database, run.id);
  assert.equal(finalState.runCount, 1, 'Idempotent calls must leave exactly one payroll run.');
  assert.equal(finalState.accrualJournalCount, 1, 'Exactly one payroll accrual journal is permitted.');
  assert.equal(finalState.paymentCount, 2, 'Exactly two intentional partial-payment records are permitted.');
  assert.equal(finalState.paymentJournalCount, 2, 'Each intentional payment must have exactly one journal.');
  assert.equal(finalState.cashEvents.length, 2, 'Each intentional cash payment must have exactly one cash event.');
  assert.equal(sumDecimals(finalState.cashEvents.map((event) => event.grossAmount)), '30000.0000');
  assert.equal(finalState.cashEvents.every((event) => event.direction === 'OUTFLOW' && event.categoryCodeSnapshot === 'PAYROLL'), true);
  assert.equal(sumDecimals(finalState.paymentMovements.map((movement) => movement.amount)), '30000.0000');
  assert.equal(finalState.paymentMovements.length, 2, 'Payment replays and rejected overpayments must not add employee movements.');
  assert.equal(finalState.advanceSettlements.length, 1, 'The 5,000 advance must be settled once, during approval only.');
  assert.equal(finalState.advanceSettlementMovements.length, 1, 'The employee ledger must contain one advance-settlement movement.');

  const paymentJournals = await Promise.all(paid.payments.map((payment) => journalById(database, payment.journalEntryId)));
  assert.equal(sumDecimals(paymentJournals.flatMap((journal) => journal.lines.filter((line) => line.account.code === 'PAY-001').map((line) => line.debitAmount))), '30000.0000');
  assert.equal(sumDecimals(paymentJournals.flatMap((journal) => journal.lines.filter((line) => line.account.code === journal.vaultAccountCode).map((line) => line.creditAmount))), '30000.0000');
  for (const journal of [advanceJournal, accrualJournal, ...paymentJournals]) assertBalancedAndSealed(journal, journal.sourceType);

  console.log('HR payroll/advance verification passed: no run -> DRAFT -> APPROVED -> PARTIALLY_PAID -> PAID; gross 35,000, advance settlement 5,000, net cash payments 30,000; exact account codes, sealed balanced journals, and idempotent writes verified.');
  console.log(`Isolated fixture retained in the test database: ${fixture.tenantCode} (${fixture.tenantId}).`);
} finally {
  if (app) await app.close();
  await pool.end();
}

async function payrollState(database, payrollRunId) {
  return database.inTenantTransaction(fixture.tenantId, async (tx) => {
    const runScope = { tenantId: fixture.tenantId, companyId: fixture.companyId };
    const [runCount, payrollJournalCount, accrualJournalCount, paymentJournalCount, paymentCount, advance, advanceSettlements, payrollAccrualMovements, advanceSettlementMovements, paymentMovements, cashEvents] = await Promise.all([
      tx.hrPayrollRun.count({ where: runScope }),
      tx.financeJournalEntry.count({ where: { ...runScope, sourceType: { in: ['hr_payroll_accrual', 'hr_payroll_payment'] } } }),
      tx.financeJournalEntry.count({ where: { ...runScope, sourceType: 'hr_payroll_accrual', ...(payrollRunId ? { sourceReference: payrollRunId } : {}) } }),
      tx.financeJournalEntry.count({ where: { ...runScope, sourceType: 'hr_payroll_payment' } }),
      tx.hrPayrollPayment.count({ where: { ...runScope, ...(payrollRunId ? { payrollRunId } : {}) } }),
      tx.hrEmployeeAdvance.findFirst({ where: runScope, orderBy: { createdAt: 'desc' }, select: { id: true, status: true, settledAmount: true, remainingAmount: true } }),
      tx.hrEmployeeAdvanceSettlement.findMany({ where: { ...runScope, source: 'PAYROLL' }, orderBy: { createdAt: 'asc' }, select: { source: true, amount: true, journalEntryId: true } }),
      tx.hrEmployeeFinancialMovement.findMany({ where: { ...runScope, movementType: 'PAYROLL_ACCRUAL' }, orderBy: { createdAt: 'asc' }, select: { amount: true, journalEntryId: true } }),
      tx.hrEmployeeFinancialMovement.findMany({ where: { ...runScope, movementType: 'ADVANCE_SETTLEMENT' }, orderBy: { createdAt: 'asc' }, select: { amount: true, journalEntryId: true } }),
      tx.hrEmployeeFinancialMovement.findMany({ where: { ...runScope, movementType: 'PAYROLL_PAYMENT' }, orderBy: { createdAt: 'asc' }, select: { amount: true, journalEntryId: true } }),
      tx.financeCashPerformanceEvent.findMany({ where: { ...runScope, sourceType: 'hr_payroll_payment' }, orderBy: { createdAt: 'asc' }, select: { direction: true, grossAmount: true, categoryCodeSnapshot: true, sourceJournalEntryId: true } }),
    ]);
    return { runCount, payrollJournalCount, accrualJournalCount, paymentJournalCount, paymentCount, advance, advanceSettlements, payrollAccrualMovements, advanceSettlementMovements, paymentMovements, cashEvents };
  });
}

async function journalById(database, journalEntryId) {
  return database.inTenantTransaction(fixture.tenantId, async (tx) => {
    const journal = await tx.financeJournalEntry.findFirstOrThrow({
      where: { id: journalEntryId, tenantId: fixture.tenantId, companyId: fixture.companyId },
      select: {
        id: true,
        sourceType: true,
        sourceReference: true,
        isSealed: true,
        status: true,
        ledgerRevision: true,
        lines: { orderBy: { lineNumber: 'asc' }, select: { debitAmount: true, creditAmount: true, account: { select: { code: true, systemKey: true } } } },
      },
    });
    const vault = await tx.financeVault.findFirstOrThrow({ where: { tenantId: fixture.tenantId, companyId: fixture.companyId }, select: { account: { select: { code: true } } } });
    return { ...journal, vaultAccountCode: vault.account.code };
  });
}

function assertRun(detail, expected) {
  assert.equal(detail.payrollRun.status, expected.status);
  assert.equal(detail.payrollRun.grossAmount, expected.gross);
  assert.equal(detail.payrollRun.advanceSettlementAmount, expected.advance);
  assert.equal(detail.payrollRun.administrativeDeductionAmount, '0.0000');
  assert.equal(detail.payrollRun.netPayableAmount, expected.net);
  assert.equal(detail.payrollRun.paidAmount, expected.paid);
}

function assertJournal(journal, expectedLines, label) {
  assertBalancedAndSealed(journal, label);
  assert.deepEqual(
    journal.lines.map((line) => ({ code: line.account.code, debit: line.debitAmount.toFixed(4), credit: line.creditAmount.toFixed(4) })),
    expectedLines,
    `${label} must use the exact expected account codes and amounts.`,
  );
}

function assertBalancedAndSealed(journal, label) {
  assert.equal(journal.isSealed, true, `${label} journal must be sealed.`);
  assert.equal(journal.status, 'POSTED', `${label} journal must remain posted.`);
  assert.ok(journal.ledgerRevision > 0n, `${label} journal must have a positive ledger revision.`);
  assert.equal(sumDecimals(journal.lines.map((line) => line.debitAmount)), sumDecimals(journal.lines.map((line) => line.creditAmount)), `${label} journal must balance.`);
}

function sumDecimals(values) {
  const units = values.reduce((total, value) => total + BigInt(value.toFixed(4).replace('.', '')), 0n);
  const sign = units < 0n ? '-' : '';
  const absolute = units < 0n ? -units : units;
  const text = absolute.toString().padStart(5, '0');
  return `${sign}${text.slice(0, -4)}.${text.slice(-4)}`;
}

async function seedFixture() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [fixture.tenantId]);
    await client.query('INSERT INTO "Tenant" ("id", "code", "name") VALUES ($1::uuid, $2, $3)', [fixture.tenantId, fixture.tenantCode, 'HR payroll advance verification']);
    await client.query(
      `INSERT INTO "User" ("id", "tenantId", "loginNormalized", "nameAr", "nameEn", "passwordHash") VALUES
       ($1::uuid, $4::uuid, $5, 'منشئ تحقق الراتب والسلفة', 'Payroll advance creator', 'unused-test-hash'),
       ($2::uuid, $4::uuid, $6, 'معتمد تحقق الراتب والسلفة', 'Payroll advance approver', 'unused-test-hash'),
       ($3::uuid, $4::uuid, $7, 'مسدد تحقق الراتب والسلفة', 'Payroll advance payer', 'unused-test-hash')`,
      [fixture.creatorId, fixture.approverId, fixture.payerId, fixture.tenantId, `payroll-creator-${suffix}@baseer.test`, `payroll-approver-${suffix}@baseer.test`, `payroll-payer-${suffix}@baseer.test`],
    );
    await client.query('INSERT INTO "Company" ("id", "tenantId", "nameAr", "nameEn") VALUES ($1::uuid, $2::uuid, $3, $4)', [fixture.companyId, fixture.tenantId, 'شركة تحقق الراتب والسلفة', 'Payroll advance verification company']);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function actor(actorUserId) { return { tenantId: fixture.tenantId, companyId: fixture.companyId, actorUserId }; }
function date(value) { return new Date(`${value}T00:00:00.000Z`); }
function riyadhDate() { const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()); const fields = new Map(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value])); return `${fields.get('year')}-${fields.get('month')}-${fields.get('day')}`; }
function requiredEnvironment(name) { const value = process.env[name]; if (!value) throw new Error(`${name} is required.`); return value; }
