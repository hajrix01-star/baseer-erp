import type { HrCompensationMethod } from "./hr-client";

export type SalaryToolInput = {
  monthlyGross: string;
  compensationMethod: HrCompensationMethod;
  foodAllowance: string;
  otherAllowance: string;
  scheduledHoursPerDay: string;
  scheduledWorkDays: string;
};

export type SalaryToolCalculation = {
  valid: boolean;
  error: "ALLOWANCES_EXCEED_GROSS" | "INCLUSIVE_SCHEDULE_REQUIRED" | "INCLUSIVE_TOTAL_TOO_LOW" | null;
  monthlyGross: number;
  fixedAllowances: number;
  basicSalary: number;
  overtimeAmount: number;
  overtimeHours: number;
  scheduledHoursPerDay: number | null;
  scheduledWorkDays: number | null;
};

const STANDARD_MONTHLY_HOURS = 208;
const STANDARD_MONTHLY_DAYS = 26;

const amount = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
};
const whole = (value: string) => {
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : 0;
};
const round4 = (value: number) => Math.round((value + Number.EPSILON) * 10_000) / 10_000;

/**
 * Client-side explanation of the server-owned STANDARD_MONTHLY_V1 formula.
 * It is intentionally read-only: the payroll service is still the only
 * authority that creates snapshots, accruals, payments, or reversals.
 */
export function calculateSalaryTool(input: SalaryToolInput): SalaryToolCalculation {
  const monthlyGross = amount(input.monthlyGross);
  const foodAllowance = amount(input.foodAllowance);
  const otherAllowance = amount(input.otherAllowance);
  const fixedAllowances = round4(foodAllowance + otherAllowance);

  if (input.compensationMethod === "FIXED_MONTHLY") {
    const basicSalary = round4(monthlyGross - fixedAllowances);
    return {
      valid: monthlyGross > 0 && basicSalary > 0,
      error: monthlyGross > 0 && basicSalary <= 0 ? "ALLOWANCES_EXCEED_GROSS" : null,
      monthlyGross,
      fixedAllowances,
      basicSalary: Math.max(0, basicSalary),
      overtimeAmount: 0,
      overtimeHours: 0,
      scheduledHoursPerDay: null,
      scheduledWorkDays: null,
    };
  }

  const scheduledHoursPerDay = whole(input.scheduledHoursPerDay);
  const scheduledWorkDays = whole(input.scheduledWorkDays);
  if (scheduledHoursPerDay <= 8 || scheduledHoursPerDay > 12 || scheduledWorkDays < 1 || scheduledWorkDays > 31) {
    return { valid: false, error: "INCLUSIVE_SCHEDULE_REQUIRED", monthlyGross, fixedAllowances, basicSalary: 0, overtimeAmount: 0, overtimeHours: 0, scheduledHoursPerDay: scheduledHoursPerDay || null, scheduledWorkDays: scheduledWorkDays || null };
  }

  const regularDays = Math.min(scheduledWorkDays, STANDARD_MONTHLY_DAYS);
  const restDays = Math.max(scheduledWorkDays - STANDARD_MONTHLY_DAYS, 0);
  const overtimeHours = round4((scheduledHoursPerDay - 8) * regularDays + restDays * scheduledHoursPerDay);
  const coefficient = overtimeHours / STANDARD_MONTHLY_HOURS;
  const basicSalary = round4((monthlyGross - fixedAllowances * (1 + coefficient)) / (1 + coefficient * 1.5));
  const overtimeAmount = round4(monthlyGross - basicSalary - fixedAllowances);
  const invalidTotal = monthlyGross <= 0 || basicSalary <= 0 || overtimeAmount < 0;
  return {
    valid: !invalidTotal,
    error: invalidTotal ? "INCLUSIVE_TOTAL_TOO_LOW" : null,
    monthlyGross,
    fixedAllowances,
    basicSalary: Math.max(0, basicSalary),
    overtimeAmount: Math.max(0, overtimeAmount),
    overtimeHours,
    scheduledHoursPerDay,
    scheduledWorkDays,
  };
}
