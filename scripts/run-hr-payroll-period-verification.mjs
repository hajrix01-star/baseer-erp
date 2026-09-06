import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HrPayrollService, PayrollDraftRefreshRequiredException, PayrollDeductionsExceedGrossException, PayrollDraftIntegrityException } from '../apps/api/dist/hr/hr-payroll.service.js';
import { IdempotencyPayloadMismatchError, hashCanonicalJson } from '../apps/api/dist/core-controls/idempotency.service.js';
import { ApiExceptionFilter } from '../apps/api/dist/common/api-exception.filter.js';
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
  const profiles = [profile];
  const matchEmployee = (employee, where) => (!where.id || (typeof where.id === 'string' ? employee.id === where.id : where.id.in.includes(employee.id))) && (!where.status || (typeof where.status === 'string' ? employee.status === where.status : where.status.in.includes(employee.status)));
  const advance = { tenantId: context.tenantId, companyId: context.companyId, id: randomUUID(), employeeId: employees[0].id, advanceNumber: 'ADV-1', businessDate: start, remainingAmount: decimal(500), settledAmount: decimal(0), nextSettlementDate: null, status: 'ISSUED' };
  const deduction = { tenantId: context.tenantId, companyId: context.companyId, id: randomUUID(), employeeId: employees[0].id, deductionNumber: 'DED-1', businessDate: start, remainingAmount: decimal(200), appliedAmount: decimal(0), plannedPayrollDate: null, status: 'OPEN' };
  const sourceAdvances = [advance], sourceDeductions = [deduction];
  const sourcePort = (rows) => ({
    findMany: async ({ where }) => rows.filter(row => (!where.id || where.id.in.includes(row.id)) && (!where.employeeId || row.employeeId === where.employeeId) && (!where.status || where.status.in.includes(row.status)) && (!where.businessDate || row.businessDate <= where.businessDate.lte)),
    findFirst: async ({ where }) => rows.find(row => row.id === where.id) ?? null,
    update: async ({ where, data }) => Object.assign(rows.find(row => row.id === where.id), data),
  });
  const tx = {
    $executeRaw: async () => 1,
    company: { findFirst: async () => ({ businessTimezone: 'Asia/Riyadh' }) },
    hrEmployee: {
      findMany: async ({ where, cursor, skip = 0, take }) => {
        let rows = employees.filter(e => matchEmployee(e, where)).sort((a, b) => a.id.localeCompare(b.id));
        if (cursor) rows = rows.slice(rows.findIndex(e => e.id === cursor.id) + skip);
        return take ? rows.slice(0, take) : rows;
      },
      count: async ({ where }) => employees.filter(e => matchEmployee(e, where)).length,
      findFirst: async ({ where }) => employees.find(e => matchEmployee(e, where)) ?? null,
    },
    hrEmployeeCompensationProfile: { findMany: async ({ where }) => profiles.filter(p => where.employeeId.in.includes(p.employeeId)) },
    hrPayrollRun: {
      findFirst: async ({ where }) => {
        const run = state.runs.find(r => where.id ? r.id === where.id : ymd(r.payrollMonth) === ymd(where.payrollMonth));
        return run ? { ...run, lines: state.lines.filter(l => l.payrollRunId === run.id).map(l => ({ ...l, advanceApplications: state.advances.filter(a => a.payrollLineId === l.id).map(a => ({ ...a, advance: sourceAdvances.find(source => source.id === a.advanceId) })), deductionApplications: state.deductions.filter(a => a.payrollLineId === l.id).map(a => ({ ...a, deduction: sourceDeductions.find(source => source.id === a.deductionId) })) })), payments: [] } : null;
      },
      create: async ({ data }) => state.runs.push({ ...data, status: 'DRAFT', paidAmount: decimal(0), accrualJournalEntryId: null }),
      update: async ({ where, data }) => Object.assign(state.runs.find(r => r.id === where.id), data),
      updateMany: async ({ where, data }) => { Object.assign(state.runs.find(r => r.id === where.id), data); return { count: 1 }; },
    },
    hrPayrollLine: { createMany: async ({ data }) => state.lines.push(...data.map(line => ({ paidAmount: decimal(0), ...line }))), deleteMany: async ({ where }) => { state.lines = state.lines.filter(l => l.payrollRunId !== where.payrollRunId); } },
    hrPayrollAdvanceApplication: { createMany: async ({ data }) => state.advances.push(...data), deleteMany: async () => { state.advances = []; } },
    hrPayrollAdministrativeDeductionApplication: { createMany: async ({ data }) => state.deductions.push(...data), deleteMany: async () => { state.deductions = []; } },
    hrEmployeeAdvance: sourcePort(sourceAdvances),
    hrEmployeeAdministrativeDeduction: sourcePort(sourceDeductions),
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
  return { service, state, employees, profiles, advance, deduction, sourceAdvances, sourceDeductions, start, monthEnd };
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
// Employee selection is independent of page size and eligibility. Absent
// selection fields preserve the original default and canonical receipt hash.
const selection = fixture('2026-08');
const extra = { ...selection.employees[0], id: randomUUID(), employeeNumber: 'E-003' };
const missing = { ...extra, id: randomUUID(), employeeNumber: 'E-004' };
const onLeave = { ...extra, id: randomUUID(), employeeNumber: 'E-005', status: 'ON_LEAVE' };
const terminated = { ...extra, id: randomUUID(), employeeNumber: 'E-006', status: 'TERMINATED' };
selection.employees.push(extra, missing, onLeave, terminated);
selection.profiles.push({ ...selection.profiles[0], employeeId: extra.id, monthlyGross: decimal('4200.1234') }, { ...selection.profiles[0], employeeId: onLeave.id });
const selectionPreview = { ...empty, payrollMonth: selection.start, pageSize: 1 };
const selected = [selection.employees[0].id, extra.id];
const full = await selection.service.preview(context, selectionPreview);
assert.equal(full.totals.grossAmount, '7300.1234');
assert.equal(full.counts.exceptions, 1, 'The default still discloses the active employee missing compensation.');
for (const fields of [{ selectedEmployeeIds: selected }, { excludedEmployeeIds: [missing.id] }]) {
  const page = await selection.service.preview(context, { ...selectionPreview, ...fields });
  assert.equal(page.totals.grossAmount, '7300.1234');
  assert.equal(page.counts.exceptions, 0, 'Unselected missing profiles cannot block valid selected employees.');
  assert.equal(page.employees.length, 1);
  assert.equal(page.hasMore, true);
  const secondPage = await selection.service.preview(context, { ...selectionPreview, ...fields, cursor: page.nextCursor });
  assert.deepEqual(secondPage.totals, page.totals, 'Global totals include unloaded selected employees and never change by page.');
}
const none = await selection.service.preview(context, { ...selectionPreview, pageSize: 100, selectedEmployeeIds: [] });
assert.deepEqual(none.totals, { employeeCount: 0, grossAmount: '0.0000', advanceSettlementAmount: '0.0000', administrativeDeductionAmount: '0.0000', netPayableAmount: '0.0000' });
assert.equal(none.counts.exceptions, 0);
assert.equal(none.employees.every(e => !e.selected && !e.included && e.estimatedNetAmount === '0.0000'), true);
for (const operation of ['preview', 'create']) {
  for (const invalid of [{ selectedEmployeeIds: [], excludedEmployeeIds: [] }, { selectedEmployeeIds: [selected[0], selected[0]] }, { excludedEmployeeIds: [selected[0], selected[0]] }, { selectedEmployeeIds: [randomUUID()] }, { excludedEmployeeIds: [terminated.id] }]) {
    await assert.rejects(() => selection.service[operation](context, { ...selectionPreview, ...invalid }, randomUUID()), /either selectedEmployeeIds|appear once|only current ACTIVE or ON_LEAVE/);
  }
}
await assert.rejects(() => selection.service.create(context, { ...empty, payrollMonth: selection.start, selectedEmployeeIds: [] }, 'none'), /No active employees/);
const leaveInput = { ...selectionPreview, pageSize: 100, selectedEmployeeIds: [onLeave.id] };
const leaveWithoutException = await selection.service.preview(context, leaveInput);
assert.equal(leaveWithoutException.employees.find(e => e.id === onLeave.id).selected, true);
assert.equal(leaveWithoutException.employees.find(e => e.id === onLeave.id).included, false);
assert.equal(leaveWithoutException.totals.grossAmount, '0.0000');
assert.equal((await selection.service.preview(context, { ...leaveInput, includeOnLeaveEmployeeIds: [onLeave.id] })).totals.grossAmount, '3100.0000');
const applications = [{ employeeId: selected[0], advances: [{ id: selection.advance.id, amount: '100.0123' }], administrativeDeductions: [{ id: selection.deduction.id, amount: '50.0001' }] }];
await assert.rejects(() => selection.service.preview(context, { ...selectionPreview, selectedEmployeeIds: [extra.id], lines: applications }), /Settlement applications can only target/);
await assert.rejects(() => selection.service.create(context, { ...selectionPreview, selectedEmployeeIds: [extra.id], lines: applications }, 'unselected-app'), /Settlement applications can only target/);
const selectedInput = { ...empty, payrollMonth: selection.start, selectedEmployeeIds: selected, lines: applications };
const selectedPreview = await selection.service.preview(context, { ...selectedInput, pageSize: 100 });
assert.equal(selectedPreview.totals.netPayableAmount, '7150.1110');
assert.equal(selectedPreview.employees.find(e => e.id === selected[0]).estimatedNetAmount, '2949.9876');
assert.equal(selectedPreview.employees.find(e => e.id === extra.id).estimatedNetAmount, '4200.1234');
const subset = await selection.service.create(context, selectedInput, 'subset');
assert.deepEqual(selection.state.lines.map(l => l.employeeId).sort(), [...selected].sort());
assert.equal(selection.state.runs[0].netPayableAmount.toFixed(4), selectedPreview.totals.netPayableAmount);
assert.equal((await selection.service.create(context, { ...selectedInput, selectedEmployeeIds: [...selected].reverse() }, 'subset')).replayed, true, 'Explicit selected IDs are canonical regardless of order.');
await assert.rejects(() => selection.service.create(context, { ...selectedInput, selectedEmployeeIds: [extra.id] }, 'subset'), /idempotency key/);
await assert.rejects(() => selection.service.updateDraft(context, { ...selectedInput, payrollRunId: subset.id, selectedEmployeeIds: [], lines: [] }, 'empty-update'), /No active employees/);
await selection.service.updateDraft(context, { ...selectedInput, payrollRunId: subset.id, selectedEmployeeIds: [extra.id], lines: [] }, 'subset-update');
assert.deepEqual(selection.state.lines.map(l => l.employeeId), [extra.id]);
assert.equal(selection.state.runs[0].grossAmount.toFixed(4), '4200.1234');
assert.equal(selection.state.advances.length, 0);
assert.equal(selection.state.deductions.length, 0);
selection.profiles.push({ ...selection.profiles[1] });
assert.equal((await selection.service.preview(context, { ...selectionPreview, selectedEmployeeIds: [selected[0]] })).totals.grossAmount, '3100.0000', 'An excluded overlapping agreement cannot block the selected valid employee.');
await assert.rejects(() => selection.service.preview(context, { ...selectionPreview, selectedEmployeeIds: [extra.id] }), /agreements overlap/, 'Overlap protection remains active for selected employees.');
selection.profiles.pop();
const withoutSelection = createHrPayrollRunRequestSchema.parse({ payrollMonth: '2026-08-01', idempotencyKey: 'compatibility' });
assert.equal(Object.hasOwn(withoutSelection, 'selectedEmployeeIds'), false);
assert.equal(Object.hasOwn(withoutSelection, 'excludedEmployeeIds'), false);
assert.equal(previewHrPayrollRunRequestSchema.safeParse({ payrollMonth: '2026-08-01', selectedEmployeeIds: [], excludedEmployeeIds: [] }).success, false);
assert.equal(createHrPayrollRunRequestSchema.safeParse({ payrollMonth: '2026-08-01', idempotencyKey: 'duplicate', selectedEmployeeIds: [selected[0], selected[0]] }).success, false);
console.log('Payroll employee selection verified: default/subset/none, missing profile and leave rules, UUID validation, global paged totals, Decimal row nets, persisted subset/update and canonical selection replay.');

// A zero net is valid only when actual applications equal the salary exactly.
function salary1800Fixture() {
  const f = fixture('2026-08');
  f.profiles[0].monthlyGross = decimal(1800);
  f.advance.remainingAmount = decimal(1000);
  f.sourceAdvances.push({ ...f.advance, id: randomUUID(), advanceNumber: 'ADV-2' });
  const input = (secondAmount) => ({ ...empty, payrollMonth: f.start, lines: [{ employeeId: f.employees[0].id, advances: [{ id: f.advance.id, amount: '1000' }, { id: f.sourceAdvances[1].id, amount: secondAmount }], administrativeDeductions: [] }] });
  return { ...f, input };
}
const overgross = salary1800Fixture();
const originalBalances = overgross.sourceAdvances.map(a => a.remainingAmount.toFixed(4));
for (const operation of ['preview', 'create']) {
  await assert.rejects(() => overgross.service[operation](context, { ...overgross.input('1000'), pageSize: 100 }, 'overgross'), PayrollDeductionsExceedGrossException, operation + ' must reject 1000 + 1000 against 1800.');
}
assert.equal(overgross.state.runs.length, 0);
const zeroPreview = await overgross.service.preview(context, { ...overgross.input('800'), pageSize: 100 });
assert.equal(zeroPreview.totals.netPayableAmount, '0.0000');
assert.equal(zeroPreview.employees.find(e => e.id === overgross.employees[0].id).estimatedNetAmount, '0.0000');
const zeroDraft = await overgross.service.create(context, overgross.input('800'), 'valid-zero');
const beforeInvalidUpdate = JSON.stringify({ runs: overgross.state.runs, lines: overgross.state.lines, apps: overgross.state.advances });
await assert.rejects(() => overgross.service.updateDraft(context, { ...overgross.input('1000'), payrollRunId: zeroDraft.id }, 'overgross-update'), PayrollDeductionsExceedGrossException);
assert.equal(JSON.stringify({ runs: overgross.state.runs, lines: overgross.state.lines, apps: overgross.state.advances }), beforeInvalidUpdate);
assert.deepEqual(overgross.sourceAdvances.map(a => a.remainingAmount.toFixed(4)), originalBalances, 'Preview/create/update never settle issued advances.');
await overgross.service.approve(context, { payrollRunId: zeroDraft.id }, 'approve-zero');
assert.deepEqual(overgross.sourceAdvances.map(a => a.remainingAmount.toFixed(4)), ['0.0000', '200.0000']);
assert.deepEqual(overgross.state.settlements.map(a => a.amount.toFixed(4)), ['1000.0000', '800.0000']);
assert.equal(overgross.state.journals[0].lines[0].debitAmount, '1800.0000');
assert.equal(overgross.state.journals[0].lines[1].creditAmount, '1800.0000');
assert.equal(overgross.state.journals[0].lines.length, 2, 'A zero net creates no payable credit.');

const corruptions = [
  ['header gross', f => { f.state.runs[0].grossAmount = decimal(2000); }],
  ['header advances', f => { f.state.runs[0].advanceSettlementAmount = decimal(1799); }],
  ['header deductions', f => { f.state.runs[0].administrativeDeductionAmount = decimal(1); }],
  ['header net', f => { f.state.runs[0].netPayableAmount = decimal(1); }],
  ['employee count', f => { f.state.runs[0].employeeCount = 2; }],
  ['empty draft', f => { f.state.lines = []; f.state.runs[0].employeeCount = 0; }],
  ['duplicate employee', f => { f.state.lines.push({ ...f.state.lines[0], id: randomUUID() }); f.state.runs[0].employeeCount = 2; }],
  ['line gross', f => { f.state.lines[0].grossSalary = decimal(1799); }],
  ['line advance summary', f => { f.state.lines[0].advanceSettlementAmount = decimal(1799); }],
  ['line deduction summary', f => { f.state.lines[0].administrativeDeductionAmount = decimal(1); }],
  ['line net', f => { f.state.lines[0].netPayableAmount = decimal(1); }],
  ['application exceeds gross despite balanced header', f => { f.state.advances[1].amount = decimal(1000); f.state.lines[0].advanceSettlementAmount = decimal(2000); f.state.runs[0].grossAmount = decimal(2000); f.state.runs[0].advanceSettlementAmount = decimal(2000); }],
  ['zero advance application', f => { f.state.advances[0].amount = decimal(0); }],
  ['duplicate advance source', f => { f.state.advances[1].advanceId = f.state.advances[0].advanceId; }],
  ['foreign source tenant', f => { f.advance.tenantId = randomUUID(); }],
  ['foreign source company', f => { f.advance.companyId = randomUUID(); }],
  ['foreign source employee', f => { f.advance.employeeId = randomUUID(); }],
  ['foreign line company', f => { f.state.lines[0].companyId = randomUUID(); }],
  ['foreign application company', f => { f.state.advances[0].companyId = randomUUID(); }],
];
for (const bad of ['-1', 'NaN', 'Infinity', '0.00001']) {
  corruptions.push(['invalid header decimal ' + bad, f => { f.state.runs[0].netPayableAmount = decimal(bad); }]);
  corruptions.push(['invalid line decimal ' + bad, f => { f.state.lines[0].foodAllowance = decimal(bad); }]);
  corruptions.push(['invalid app decimal ' + bad, f => { f.state.advances[0].amount = decimal(bad); }]);
}
for (const [label, corrupt] of corruptions) {
  const f = salary1800Fixture();
  const created = await f.service.create(context, f.input('800'), 'draft');
  corrupt(f);
  const snapshot = () => JSON.stringify({ ...f.state, receipts: [...f.state.receipts], sourceAdvances: f.sourceAdvances });
  const before = snapshot();
  await assert.rejects(() => f.service.approve(context, { payrollRunId: created.id }, 'integrity'), PayrollDraftIntegrityException, label);
  assert.equal(snapshot(), before, label + ' must fail before journal, settlement, movement or receipt writes.');
}
// Administrative applications use the same strict reconciliation and scoping.
for (const corrupt of [
  f => { f.state.deductions[0].amount = decimal(0); },
  f => { f.state.deductions[0].amount = decimal(101); },
  f => { f.state.deductions.push({ ...f.state.deductions[0], id: randomUUID() }); },
  f => { f.deduction.employeeId = randomUUID(); },
  f => { f.deduction.companyId = randomUUID(); },
]) {
  const f = salary1800Fixture(), input = f.input('700');
  input.lines[0].administrativeDeductions.push({ id: f.deduction.id, amount: '100' });
  const created = await f.service.create(context, input, 'draft');
  corrupt(f);
  await assert.rejects(() => f.service.approve(context, { payrollRunId: created.id }, 'integrity'), PayrollDraftIntegrityException);
  assert.equal(f.state.journals.length + f.state.settlements.length + f.state.deductionActions.length + f.state.movements.length, 0);
}
const repaired = salary1800Fixture();
const damagedDraft = await repaired.service.create(context, repaired.input('800'), 'draft');
repaired.state.runs[0].advanceSettlementAmount = decimal(2000);
await assert.rejects(() => repaired.service.approve(context, { payrollRunId: damagedDraft.id }, 'retry-after-repair'), PayrollDraftIntegrityException);
await repaired.service.updateDraft(context, { ...repaired.input('800'), payrollRunId: damagedDraft.id }, 'repair');
assert.equal((await repaired.service.approve(context, { payrollRunId: damagedDraft.id }, 'retry-after-repair')).replayed, false);
assert.equal((await repaired.service.approve(context, { payrollRunId: damagedDraft.id }, 'retry-after-repair')).replayed, true);

for (const [exception, status, code, arabic] of [
  [new PayrollDeductionsExceedGrossException(), 400, 'VALIDATION_FAILED', 'يتجاوز راتب الموظف'],
  [new PayrollDraftIntegrityException(), 409, 'CONFLICT', 'راجع المسودة واحفظها من جديد'],
]) {
  let receipt, receivedStatus;
  const response = { header() { return this; }, status(value) { receivedStatus = value; return this; }, send(value) { receipt = value; } };
  new ApiExceptionFilter().catch(exception, { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ method: 'POST', url: '/hr/payroll', headers: { 'x-request-id': randomUUID() } }) }) });
  assert.equal(receivedStatus, status);
  assert.equal(receipt.error.code, code);
  assert.ok(receipt.error.message.ar.includes(arabic));
  assert.equal(receipt.error.message.en, exception.message);
}
console.log('Payroll approval integrity verified: exact zero net, overgross rejection across preview/create/update, malformed persisted totals/applications/sources rejected before writes, typed Arabic errors and repaired-key replay.');

console.log('Payroll period verification passed: previous August, all month lengths/year rollover, excluded hires, month-end proration, refresh/localization contract, forged-date immunity, legacy/new replay, balanced accrual/application dates and future/fiscal guards.');
