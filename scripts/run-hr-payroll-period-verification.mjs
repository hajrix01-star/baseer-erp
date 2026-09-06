import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HrPayrollService, PayrollDraftRefreshRequiredException } from '../apps/api/dist/hr/hr-payroll.service.js';
import { IdempotencyPayloadMismatchError, hashCanonicalJson } from '../apps/api/dist/core-controls/idempotency.service.js';
import { BusinessDateService } from '../apps/api/dist/business-date/business-date.service.js';
import { Prisma } from '../apps/api/dist/generated/prisma/client.js';
import { createHrPayrollRunRequestSchema, previewHrPayrollRunRequestSchema, approveHrPayrollRunRequestSchema } from '../packages/contracts/dist/index.js';

const date = (value) => new Date(`${value}T00:00:00.000Z`);
const ymd = (value) => value.toISOString().slice(0, 10);
const decimal = (value) => new Prisma.Decimal(value);
const context = { tenantId: randomUUID(), companyId: randomUUID(), actorUserId: randomUUID() };
const empty = { includeAllEligible: true, includeOnLeaveEmployeeIds: [], lines: [] };

// Exercise the real service calculations and contract with a bounded in-memory
// persistence port. Database locks, fiscal posting and HTTP authorization are
// covered independently by the lifecycle and HTTP verification runners.
function fixture(month, current = '2026-09-06') {
  const state = { current, runs: [], lines: [], advances: [], deductions: [], movements: [], settlements: [], deductionActions: [], journals: [], receipts: new Map(), closed: false };
  const start = date(`${month}-01`);
  const monthEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
  const employees = [
    { id: randomUUID(), employeeNumber: 'E-001', nameAr: 'موظف', nameEn: 'Employee', status: 'ACTIVE', hireDate: date('2020-01-01') },
    { id: randomUUID(), employeeNumber: 'E-002', nameAr: 'موظف لاحق', nameEn: 'Later hire', status: 'ACTIVE', hireDate: new Date(monthEnd.getTime() + 86400000) },
  ];
  const profile = { employeeId: employees[0].id, effectiveFrom: date('2020-01-01'), effectiveTo: null, monthlyGross: decimal(3100), compensationMethod: 'FIXED_MONTHLY', foodAllowance: decimal(0), housingAllowance: decimal(0), transportAllowance: decimal(0), otherAllowance: decimal(0), scheduledHoursPerDay: null, scheduledWorkDays: null, policyVersion: null };
  const advance = { id: randomUUID(), employeeId: employees[0].id, advanceNumber: 'ADV-1', businessDate: start, remainingAmount: decimal(500), settledAmount: decimal(0), nextSettlementDate: null, status: 'ISSUED' };
  const deduction = { id: randomUUID(), employeeId: employees[0].id, deductionNumber: 'DED-1', businessDate: start, remainingAmount: decimal(200), appliedAmount: decimal(0), plannedPayrollDate: null, status: 'OPEN' };
  const tx = {
    $executeRaw: async () => 1,
    company: { findFirst: async () => ({ businessTimezone: 'Asia/Riyadh' }) },
    hrEmployee: { findMany: async ({ where }) => employees.filter(e => !where.id?.in || where.id.in.includes(e.id)), count: async () => 0 },
    hrEmployeeCompensationProfile: { findMany: async () => [profile] },
    hrPayrollRun: {
      findFirst: async ({ where }) => {
        const run = state.runs.find(r => where.id ? r.id === where.id : ymd(r.payrollMonth) === ymd(where.payrollMonth));
        return run ? { ...run, lines: state.lines.filter(l => l.payrollRunId === run.id).map(l => ({ ...l, advanceApplications: state.advances.filter(a => a.payrollLineId === l.id), deductionApplications: state.deductions.filter(a => a.payrollLineId === l.id) })), payments: [] } : null;
      },
      create: async ({ data }) => state.runs.push({ ...data, status: 'DRAFT', paidAmount: decimal(0), accrualJournalEntryId: null }),
      update: async ({ where, data }) => Object.assign(state.runs.find(r => r.id === where.id), data),
      updateMany: async ({ where, data }) => { Object.assign(state.runs.find(r => r.id === where.id), data); return { count: 1 }; },
    },
    hrPayrollLine: { createMany: async ({ data }) => state.lines.push(...data), deleteMany: async ({ where }) => { state.lines = state.lines.filter(l => l.payrollRunId !== where.payrollRunId); } },
    hrPayrollAdvanceApplication: { createMany: async ({ data }) => state.advances.push(...data), deleteMany: async () => { state.advances = []; } },
    hrPayrollAdministrativeDeductionApplication: { createMany: async ({ data }) => state.deductions.push(...data), deleteMany: async () => { state.deductions = []; } },
    hrEmployeeAdvance: { findMany: async () => [advance], findFirst: async () => advance, update: async ({ data }) => Object.assign(advance, { remainingAmount: data.remainingAmount, status: data.status }) },
    hrEmployeeAdministrativeDeduction: { findMany: async () => [deduction], findFirst: async () => deduction, update: async ({ data }) => Object.assign(deduction, { remainingAmount: data.remainingAmount, status: data.status }) },
    hrEmployeeAdvanceSettlement: { create: async ({ data }) => state.settlements.push(data) },
    hrEmployeeAdministrativeDeductionAction: { create: async ({ data }) => state.deductionActions.push(data) },
    hrEmployeeFinancialMovement: { create: async ({ data }) => state.movements.push(data) },
    financeAccount: { findMany: async ({ where }) => where.systemKey.in.map(systemKey => ({ systemKey, id: randomUUID() })) },
    auditEvent: { create: async () => {} },
  };
  const database = { inTenantTransaction: async (_tenant, callback) => {
    const receipts = new Map(state.receipts);
    try { return await callback(tx); } catch (error) { state.receipts = receipts; throw error; }
  } };
  const idempotency = {
    beginInTransaction: async (_tx, _ctx, input) => {
      const hash = hashCanonicalJson(input.request), key = `${input.operation}:${input.key}`, existing = state.receipts.get(key);
      if (existing) {
        if (existing.hash !== hash) throw new IdempotencyPayloadMismatchError();
        return existing.response ? { kind: 'replay', response: existing.response } : { kind: 'in-progress' };
      }
      state.receipts.set(key, { hash }); return { kind: 'started', receiptId: key };
    },
    completeInTransaction: async (_tx, _ctx, { receiptId, response }) => { state.receipts.set(receiptId, { ...state.receipts.get(receiptId), response }); },
  };
  const dates = new BusinessDateService(database, {}, { now: () => new Date(`${state.current}T12:00:00.000Z`) });
  const journals = { postInTransaction: async (_tx, input) => {
    if (state.closed) throw new Error('Fiscal period is closed');
    state.journals.push(input); return { journalEntryId: randomUUID() };
  } };
  const service = new HrPayrollService(database, dates, { reserveInTransaction: async () => 1 }, idempotency, {}, journals, { initializeInTransaction: async () => {} }, {});
  service.ensureDefaultCompensationPolicyVersion = async () => ({ id: randomUUID(), policyId: randomUUID(), versionNumber: 1, effectiveFrom: date('2000-01-01'), status: 'APPROVED', formulaCode: 'STANDARD_MONTHLY_V1', policy: { code: 'STANDARD', nameAr: 'قياسي', nameEn: 'Standard' } });
  return { service, state, employees, advance, deduction, start, monthEnd };
}

for (const [month, end, current] of [
  ['2026-08', '2026-08-31', '2026-09-06'],
  ['2026-04', '2026-04-30', '2026-09-06'],
  ['2026-02', '2026-02-28', '2026-09-06'],
  ['2024-02', '2024-02-29', '2026-09-06'],
  ['2025-12', '2025-12-31', '2026-01-06'],
]) {
  const f = fixture(month, current);
  const preview = await f.service.preview(context, previewHrPayrollRunRequestSchema.parse({ payrollMonth: `${month}-01`, businessDate: '2099-01-01' }));
  assert.equal(preview.totals.employeeCount, 1, 'A later hire cannot block the preceding month.');
  assert.equal(preview.counts.exceptions, 0, 'Out-of-period hires are exclusions, not blocking exceptions.');
  assert.equal(preview.employees.find(e => e.id === f.employees[0].id).calculationPeriodEnd, end);
  assert.equal(preview.employees.find(e => e.id === f.employees[1].id).included, false);
  const input = { ...empty, payrollMonth: f.start, businessDate: date('1999-01-01') };
  const created = await f.service.create(context, input, 'create');
  assert.equal(ymd(f.state.runs[0].businessDate), end);
  assert.equal(f.state.runs[0].grossAmount.toFixed(4), '3100.0000');
  assert.equal((await f.service.create(context, { ...input, businessDate: date('2099-01-01') }, 'create')).replayed, true);
  await assert.rejects(() => f.service.create(context, { ...input, notes: 'Changed' }, 'create'), /idempotency key/);
  await assert.rejects(() => f.service.create(context, input, 'duplicate'), /already covers this month/);
  await f.service.approve(context, { payrollRunId: created.id, businessDate: date('2099-01-01') }, 'approve');
  assert.equal(ymd(f.state.journals[0].businessDate), end);
  assert.equal(f.state.journals[0].lines[0].debitAmount, '3100.0000');
  assert.equal((await f.service.approve(context, { payrollRunId: created.id }, 'approve')).replayed, true);
}

const f = fixture('2026-08');
f.employees[0].hireDate = date('2026-08-16');
const choices = [{ employeeId: f.employees[0].id, advances: [{ id: f.advance.id, amount: '100' }], administrativeDeductions: [{ id: f.deduction.id, amount: '50' }] }];
for (const operation of ['preview', 'create']) {
  await assert.rejects(() => f.service[operation](context, { ...empty, pageSize: 50, payrollMonth: f.start, lines: [{ employeeId: f.employees[1].id, advances: [], administrativeDeductions: [] }] }, randomUUID()), /Settlement applications can only target/);
}
const run = await f.service.create(context, { ...empty, payrollMonth: f.start, lines: choices }, 'new-hire');
assert.equal(f.state.lines[0].payrollCalculationSnapshotJson.eligibleDays, 16);
assert.equal(f.state.lines[0].payrollCalculationSnapshotJson.calculationPeriodEnd, '2026-08-31');
assert.equal(f.state.lines[0].grossSalary.toFixed(4), '1599.9100', 'Proration uses the selected month end regardless of client date.');
f.state.runs[0].businessDate = date('2026-08-20');
await assert.rejects(() => f.service.approve(context, { payrollRunId: run.id }, 'stale'), PayrollDraftRefreshRequiredException);
assert.equal(f.state.journals.length, 0);
assert.equal(f.state.lines[0].grossSalary.toFixed(4), '1599.9100', 'Rejected stale approval never recalculates amounts.');
const refresh = { ...empty, payrollRunId: run.id, payrollMonth: f.start, lines: choices };
await f.service.updateDraft(context, refresh, 'refresh');
assert.equal((await f.service.updateDraft(context, { ...refresh, businessDate: date('2099-01-01') }, 'refresh')).replayed, true);
assert.equal(ymd(f.state.runs[0].businessDate), '2026-08-31');
f.state.closed = true;
await assert.rejects(() => f.service.approve(context, { payrollRunId: run.id }, 'closed'), /Fiscal period is closed/);
assert.equal(f.state.journals.length, 0);
f.state.closed = false;
await f.service.approve(context, { payrollRunId: run.id }, 'posted');
for (const record of [...f.state.journals, ...f.state.movements, ...f.state.settlements, ...f.state.deductionActions]) assert.equal(ymd(record.businessDate), '2026-08-31');
const journal = f.state.journals[0];
assert.equal(journal.lines.reduce((total, line) => total.plus(line.debitAmount ?? 0).minus(line.creditAmount ?? 0), decimal(0)).toFixed(4), '0.0000');
assert.equal(f.state.runs[0].netPayableAmount.toFixed(4), '1449.9100');
assert.equal(f.advance.remainingAmount.toFixed(4), '400.0000');
assert.equal(f.deduction.remainingAmount.toFixed(4), '150.0000');

const current = fixture('2026-09');
const currentRun = await current.service.create(context, { ...empty, payrollMonth: current.start }, 'current');
await assert.rejects(() => current.service.approve(context, { payrollRunId: currentRun.id, businessDate: date('2026-09-01') }, 'future-accrual'), /future business date/);
await assert.rejects(() => current.service.preview(context, { ...empty, pageSize: 50, payrollMonth: date('2026-10-01') }), /future business date/);
await assert.rejects(() => current.service.create(context, { ...empty, payrollMonth: date('2026-10-01') }, 'future-month'), /future business date/);

const legacy = fixture('2026-08');
const legacyInput = { payrollRunId: randomUUID(), businessDate: date('2026-08-20') };
legacy.state.receipts.set('hr.payroll.approve:legacy', { hash: hashCanonicalJson(JSON.parse(JSON.stringify(legacyInput))), response: { body: { id: legacyInput.payrollRunId, runNumber: 'LEGACY', replayed: false } } });
assert.equal((await legacy.service.approve(context, legacyInput, 'legacy')).replayed, true, 'Exact successful legacy retries must replay before draft validation.');
await assert.rejects(() => legacy.service.approve(context, { ...legacyInput, payrollRunId: randomUUID() }, 'legacy'), /idempotency key/);
assert.equal(legacy.state.journals.length, 0);

assert.equal(createHrPayrollRunRequestSchema.safeParse({ payrollMonth: '2026-08-01', idempotencyKey: 'create' }).success, true);
assert.equal(approveHrPayrollRunRequestSchema.safeParse({ payrollRunId: randomUUID(), idempotencyKey: 'approve' }).success, true);
assert.equal(previewHrPayrollRunRequestSchema.safeParse({ payrollMonth: '2026-08' }).success, false, 'The API date remains YYYY-MM-DD; only the UI stores a month label.');
console.log('Payroll period verification passed: previous August, all month lengths/year rollover, excluded hires, month-end proration, refresh/localization contract, forged-date immunity, legacy/new replay, balanced accrual/application dates and future/fiscal guards.');
