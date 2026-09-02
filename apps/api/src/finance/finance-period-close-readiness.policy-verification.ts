import assert from 'node:assert/strict';

import { HrEmployeeStatus, HrPayrollRunStatus } from '../generated/prisma/client.js';
import { evaluatePayrollPeriodCloseReadiness } from './finance-period-close-readiness.js';

const period = { startDate: date('2026-07-01'), endDate: date('2026-08-31') };
const existingEmployee = employee('employee-existing', '2026-07-15');
const employees = [existingEmployee];

assert.deepEqual(evaluatePayrollPeriodCloseReadiness(period, [], []), {
  ready: true, requiredMonths: [], acceptedMonths: [], missingMonths: [], draftOnlyMonths: [], uncoveredEmployeeMonths: [],
});
assert.deepEqual(evaluatePayrollPeriodCloseReadiness(period, employees, []).missingMonths, ['2026-07', '2026-08']);
assert.deepEqual(evaluatePayrollPeriodCloseReadiness(period, employees, [
  { payrollMonth: date('2026-07-01'), status: HrPayrollRunStatus.DRAFT, employeeIds: ['employee-existing'] },
]).draftOnlyMonths, ['2026-07']);
const approvedUnpaid = evaluatePayrollPeriodCloseReadiness(period, employees, [
  { payrollMonth: date('2026-07-01'), status: HrPayrollRunStatus.APPROVED, employeeIds: ['employee-existing'] },
  { payrollMonth: date('2026-08-01'), status: HrPayrollRunStatus.PARTIALLY_PAID, employeeIds: ['employee-existing'] },
]);
assert.equal(approvedUnpaid.ready, true);
assert.deepEqual(approvedUnpaid.acceptedMonths, ['2026-07', '2026-08']);
assert.equal(evaluatePayrollPeriodCloseReadiness(period, employees, [
  { payrollMonth: date('2026-07-01'), status: HrPayrollRunStatus.REVERSED, employeeIds: ['employee-existing'] },
  { payrollMonth: date('2026-08-01'), status: HrPayrollRunStatus.PAID, employeeIds: ['employee-existing'] },
]).ready, false);

const july = { startDate: date('2026-07-01'), endDate: date('2026-07-31') };
const employeeAddedAfterApproval = employee('employee-added-after-approval', '2026-07-20');
const staleApprovedRun = evaluatePayrollPeriodCloseReadiness(july, [existingEmployee, employeeAddedAfterApproval], [
  { payrollMonth: date('2026-07-01'), status: HrPayrollRunStatus.APPROVED, employeeIds: ['employee-existing'] },
]);
assert.equal(staleApprovedRun.ready, false, 'An approved run must not cover an employee added later in the same month unless it has a payroll line for them.');
assert.deepEqual(staleApprovedRun.acceptedMonths, []);
assert.deepEqual(staleApprovedRun.uncoveredEmployeeMonths, [
  { month: '2026-07', employeeIds: ['employee-added-after-approval'] },
]);

const terminatedMidMonth = employee('employee-terminated-mid-month', '2026-06-01', {
  status: HrEmployeeStatus.TERMINATED,
  terminatedAt: '2026-07-15',
  statusEffectiveAt: '2026-07-15',
});
const omittedTerminatedEmployee = evaluatePayrollPeriodCloseReadiness(july, [terminatedMidMonth], [
  { payrollMonth: date('2026-07-01'), status: HrPayrollRunStatus.PAID, employeeIds: [] },
]);
assert.equal(omittedTerminatedEmployee.ready, false, 'An employee terminated mid-month remains in scope for that month.');
assert.deepEqual(omittedTerminatedEmployee.uncoveredEmployeeMonths, [
  { month: '2026-07', employeeIds: ['employee-terminated-mid-month'] },
]);
assert.equal(evaluatePayrollPeriodCloseReadiness(july, [terminatedMidMonth], [
  { payrollMonth: date('2026-07-01'), status: HrPayrollRunStatus.PAID, employeeIds: ['employee-terminated-mid-month'] },
]).ready, true, 'A payroll line in an eligible run must cover an employee terminated mid-month.');

assert.equal(evaluatePayrollPeriodCloseReadiness(july, [existingEmployee], []).ready, false, 'An absent payroll must block closing.');
assert.equal(evaluatePayrollPeriodCloseReadiness(july, [existingEmployee], [
  { payrollMonth: date('2026-07-01'), status: HrPayrollRunStatus.DRAFT, employeeIds: ['employee-existing'] },
]).ready, false, 'A draft payroll must block closing even when it contains the employee line.');

const archivedAfterMonth = employee('employee-archived-after-month', '2026-06-01', {
  status: HrEmployeeStatus.ARCHIVED,
  statusEffectiveAt: '2026-08-10',
});
const archivedDuringMonth = employee('employee-archived-during-month', '2026-06-01', {
  status: HrEmployeeStatus.ARCHIVED,
  statusEffectiveAt: '2026-07-16',
});
const archivedCoverage = evaluatePayrollPeriodCloseReadiness(july, [archivedAfterMonth, archivedDuringMonth], [
  { payrollMonth: date('2026-07-01'), status: HrPayrollRunStatus.APPROVED, employeeIds: [] },
]);
assert.equal(archivedCoverage.ready, false, 'Archiving during or after a worked month must not erase payroll coverage for that month.');
assert.deepEqual(archivedCoverage.uncoveredEmployeeMonths, [{
  month: '2026-07',
  employeeIds: ['employee-archived-after-month', 'employee-archived-during-month'],
}]);
assert.equal(evaluatePayrollPeriodCloseReadiness(july, [archivedAfterMonth, archivedDuringMonth], [
  {
    payrollMonth: date('2026-07-01'),
    status: HrPayrollRunStatus.APPROVED,
    employeeIds: ['employee-archived-after-month', 'employee-archived-during-month'],
  },
]).ready, true, 'Archived employees are covered normally when their historical payroll lines exist.');

const archivedBeforeMonth = employee('employee-archived-before-month', '2026-05-01', {
  status: HrEmployeeStatus.ARCHIVED,
  statusEffectiveAt: '2026-06-30',
});
assert.equal(evaluatePayrollPeriodCloseReadiness(july, [archivedBeforeMonth], []).ready, true, 'An archive effective before the period must end eligibility before that period.');

console.log('Finance period payroll close-readiness policy verification passed.');
function date(value: string) { return new Date(`${value}T00:00:00.000Z`); }
function employee(
  id: string,
  hireDate: string,
  options: Readonly<{ status?: HrEmployeeStatus; terminatedAt?: string; statusEffectiveAt?: string }> = {},
) {
  return {
    id,
    hireDate: date(hireDate),
    status: options.status ?? HrEmployeeStatus.ACTIVE,
    terminatedAt: options.terminatedAt ? date(options.terminatedAt) : null,
    statusEffectiveAt: options.statusEffectiveAt ? date(options.statusEffectiveAt) : null,
  };
}
