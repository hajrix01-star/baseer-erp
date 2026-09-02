import { ConflictException } from '@nestjs/common';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { HrEmployeeStatus, HrPayrollRunStatus, Prisma } from '../generated/prisma/client.js';

type Period = Readonly<{ startDate: Date; endDate: Date }>;
type EmployeeWindow = Readonly<{
  id: string;
  hireDate: Date;
  status: HrEmployeeStatus;
  terminatedAt: Date | null;
  statusEffectiveAt: Date | null;
}>;
type PayrollRunWindow = Readonly<{
  payrollMonth: Date;
  status: HrPayrollRunStatus;
  employeeIds: readonly string[];
}>;

export type PayrollPeriodCloseReadiness = Readonly<{
  ready: boolean;
  requiredMonths: readonly string[];
  acceptedMonths: readonly string[];
  missingMonths: readonly string[];
  draftOnlyMonths: readonly string[];
  uncoveredEmployeeMonths: readonly Readonly<{ month: string; employeeIds: readonly string[] }>[];
}>;

/**
 * A month creates an accrual obligation when at least one employee overlaps
 * it. An archived employee remains historically eligible through the archive
 * effective date; a later archive must never erase an earlier payroll duty.
 * Every eligible employee must have a line in an APPROVED
 * or later run for that month. This prevents a run approved before a later
 * employee was onboarded from falsely satisfying the close gate. APPROVED and
 * later states are accepted even when unpaid; DRAFT and absent runs have no
 * accounting effect.
 */
export function evaluatePayrollPeriodCloseReadiness(
  period: Period,
  employees: readonly EmployeeWindow[],
  payrollRuns: readonly PayrollRunWindow[],
): PayrollPeriodCloseReadiness {
  const months = calendarMonths(period.startDate, period.endDate);
  const requiredMonths = months.filter(({ start, end }) => employees.some((employee) => employeeOverlaps(employee, start, end)));
  const acceptedStatuses = new Set<HrPayrollRunStatus>([
    HrPayrollRunStatus.APPROVED,
    HrPayrollRunStatus.PARTIALLY_PAID,
    HrPayrollRunStatus.PAID,
  ]);
  const acceptedMonths: string[] = [];
  const missingMonths: string[] = [];
  const draftOnlyMonths: string[] = [];
  const uncoveredEmployeeMonths: Array<{ month: string; employeeIds: string[] }> = [];
  for (const month of requiredMonths) {
    const runs = payrollRuns.filter((run) => monthKey(run.payrollMonth) === month.key);
    const acceptedRuns = runs.filter((run) => acceptedStatuses.has(run.status));
    if (acceptedRuns.length === 0) {
      if (runs.some((run) => run.status === HrPayrollRunStatus.DRAFT)) draftOnlyMonths.push(month.key);
      else missingMonths.push(month.key);
      continue;
    }
    const eligibleEmployeeIds = employees
      .filter((employee) => employeeOverlaps(employee, month.start, month.end))
      .map((employee) => employee.id);
    const coveredEmployeeIds = new Set(acceptedRuns.flatMap((run) => run.employeeIds));
    const uncoveredEmployeeIds = eligibleEmployeeIds.filter((employeeId) => !coveredEmployeeIds.has(employeeId)).sort();
    if (uncoveredEmployeeIds.length > 0) uncoveredEmployeeMonths.push({ month: month.key, employeeIds: uncoveredEmployeeIds });
    else acceptedMonths.push(month.key);
  }
  return {
    ready: missingMonths.length === 0 && draftOnlyMonths.length === 0 && uncoveredEmployeeMonths.length === 0,
    requiredMonths: requiredMonths.map((month) => month.key),
    acceptedMonths,
    missingMonths,
    draftOnlyMonths,
    uncoveredEmployeeMonths,
  };
}

export async function assertPayrollReadyForPeriodClose(
  transaction: Prisma.TransactionClient,
  context: TrustedCompanyActorContext,
  period: Period,
): Promise<void> {
  const [employees, payrollRuns] = await Promise.all([
    transaction.hrEmployee.findMany({
      where: {
        tenantId: context.tenantId,
        companyId: context.companyId,
        hireDate: { lte: period.endDate },
        AND: [
          { OR: [{ terminatedAt: null }, { terminatedAt: { gte: period.startDate } }] },
          {
            OR: [
              { status: { not: HrEmployeeStatus.ARCHIVED } },
              { status: HrEmployeeStatus.ARCHIVED, statusEffectiveAt: null },
              { status: HrEmployeeStatus.ARCHIVED, statusEffectiveAt: { gte: period.startDate } },
            ],
          },
        ],
      },
      select: { id: true, hireDate: true, status: true, terminatedAt: true, statusEffectiveAt: true },
    }),
    transaction.hrPayrollRun.findMany({
      where: {
        tenantId: context.tenantId,
        companyId: context.companyId,
        payrollMonth: { gte: firstMonth(period.startDate), lte: lastMonth(period.endDate) },
        status: { not: HrPayrollRunStatus.REVERSED },
      },
      select: {
        payrollMonth: true,
        status: true,
        lines: { select: { employeeId: true } },
      },
    }),
  ]);
  const readiness = evaluatePayrollPeriodCloseReadiness(period, employees, payrollRuns.map((run) => ({
    payrollMonth: run.payrollMonth,
    status: run.status,
    employeeIds: run.lines.map((line) => line.employeeId),
  })));
  if (readiness.ready) return;
  const details = [
    readiness.missingMonths.length ? `missing payroll: ${readiness.missingMonths.join(', ')}` : null,
    readiness.draftOnlyMonths.length ? `draft payroll: ${readiness.draftOnlyMonths.join(', ')}` : null,
    readiness.uncoveredEmployeeMonths.length
      ? `employees missing from approved payroll: ${readiness.uncoveredEmployeeMonths.map((item) => `${item.month} (${item.employeeIds.join(', ')})`).join('; ')}`
      : null,
  ].filter(Boolean).join('; ');
  throw new ConflictException(`The fiscal period cannot close until payroll is approved for every employee month (${details}). Approved unpaid payroll is sufficient.`);
}

function calendarMonths(from: Date, to: Date) {
  const result: Array<{ key: string; start: Date; end: Date }> = [];
  let cursor = firstMonth(from);
  const final = firstMonth(to);
  while (cursor <= final) {
    const start = new Date(Math.max(cursor.valueOf(), from.valueOf()));
    const endOfMonth = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    const end = new Date(Math.min(endOfMonth.valueOf(), to.valueOf()));
    result.push({ key: monthKey(cursor), start, end });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return result;
}
function firstMonth(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)); }
function lastMonth(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0)); }
function monthKey(value: Date) { return value.toISOString().slice(0, 7); }
function employeeOverlaps(employee: EmployeeWindow, start: Date, end: Date) {
  if (employee.hireDate > end) return false;
  if (employee.terminatedAt !== null && employee.terminatedAt < start) return false;
  if (employee.status === HrEmployeeStatus.ARCHIVED && employee.statusEffectiveAt !== null && employee.statusEffectiveAt < start) return false;
  return true;
}
