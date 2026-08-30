import { addMoneyDecimals, normalizeMoneyDecimal, subtractMoneyDecimals, sumMoneyDecimals } from "./decimal-string";
import type { HrCompensationProfile } from "./hr-client";

const MONEY_SCALE = 10_000n;
const STANDARD_MONTHLY_HOURS = 208n;

function moneyUnits(value: string): bigint {
  return BigInt(normalizeMoneyDecimal(value).replace(".", ""));
}

function formatMoneyUnits(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  return `${negative ? "-" : ""}${absolute / MONEY_SCALE}.${(absolute % MONEY_SCALE).toString().padStart(4, "0")}`;
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const quotient = absolute / denominator;
  const remainder = absolute % denominator;
  const rounded = remainder * 2n >= denominator ? quotient + 1n : quotient;
  return negative ? -rounded : rounded;
}

/** Payroll-equivalent presentation values; inclusive gross is never mistaken for basic salary. */
export function compensationBreakdown(profile: HrCompensationProfile) {
  try {
    const allowances = sumMoneyDecimals([profile.foodAllowance, profile.housingAllowance, profile.transportAllowance, profile.otherAllowance]);
    if (profile.compensationMethod !== "INCLUSIVE_OVERTIME") return { basicSalary: subtractMoneyDecimals(profile.monthlyGross, allowances), includedOvertime: null as string | null, allowances };
    const dailyHours = profile.scheduledHoursPerDay;
    const workDays = profile.scheduledWorkDays;
    if (!Number.isFinite(dailyHours) || !Number.isFinite(workDays) || dailyHours === null || workDays === null || dailyHours <= 0 || workDays <= 0) return { basicSalary: null, includedOvertime: null, allowances };
    const overtimeHours = BigInt((dailyHours - 8) * Math.min(workDays, 26) + Math.max(workDays - 26, 0) * dailyHours);
    const basicSalary = formatMoneyUnits(divideHalfUp(2n * (moneyUnits(profile.monthlyGross) * STANDARD_MONTHLY_HOURS - moneyUnits(allowances) * (STANDARD_MONTHLY_HOURS + overtimeHours)), 2n * STANDARD_MONTHLY_HOURS + 3n * overtimeHours));
    return { basicSalary, includedOvertime: subtractMoneyDecimals(profile.monthlyGross, addMoneyDecimals(basicSalary, allowances)), allowances };
  } catch {
    return { basicSalary: null, includedOvertime: null, allowances: "0.0000" };
  }
}
