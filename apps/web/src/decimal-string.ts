const POWERS_OF_TEN = Array.from({ length: 19 }, (_, index) => 10n ** BigInt(index));

function parseDecimal(value: string, scale: number, maxIntegerDigits: number): bigint {
  const pattern = new RegExp(`^\\d{1,${maxIntegerDigits}}(?:\\.\\d{1,${scale}})?$`);
  if (!pattern.test(value)) throw new Error("Invalid decimal string");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * POWERS_OF_TEN[scale] + BigInt(fraction.padEnd(scale, "0") || "0");
}

function formatDecimal(value: bigint, scale: number, maxIntegerDigits: number): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const divisor = POWERS_OF_TEN[scale];
  const whole = absolute / divisor;
  if (whole.toString().length > maxIntegerDigits) throw new Error("Decimal precision exceeded");
  const fraction = (absolute % divisor).toString().padStart(scale, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

/** Exact fixed-scale arithmetic for Decimal(18,4) values crossing ERP commands. */
export function normalizeMoneyDecimal(value: string): string {
  return formatDecimal(parseDecimal(value, 4, 14), 4, 14);
}

export function addMoneyDecimals(left: string, right: string): string {
  return formatDecimal(parseDecimal(left, 4, 14) + parseDecimal(right, 4, 14), 4, 14);
}

export function sumMoneyDecimals(values: Iterable<string>): string {
  let total = 0n;
  for (const value of values) total += parseDecimal(value, 4, 14);
  return formatDecimal(total, 4, 14);
}

export function subtractMoneyDecimals(left: string, right: string): string {
  return formatDecimal(parseDecimal(left, 4, 14) - parseDecimal(right, 4, 14), 4, 14);
}

export function compareMoneyDecimals(left: string, right: string): -1 | 0 | 1 {
  const difference = parseDecimal(left, 4, 14) - parseDecimal(right, 4, 14);
  return difference < 0n ? -1 : difference > 0n ? 1 : 0;
}

export function absoluteMoneyDecimal(value: string): string {
  const parsed = parseDecimal(value.startsWith("-") ? value.slice(1) : value, 4, 14);
  return formatDecimal(parsed, 4, 14);
}

export function isPositiveMoneyDecimal(value: string): boolean {
  try { return parseDecimal(value, 4, 14) > 0n; }
  catch { return false; }
}

/** Exact fixed-scale division for UI-derived averages; the divisor is a non-financial count. */
export function divideMoneyDecimalByInteger(value: string, divisor: number): string {
  if (!Number.isSafeInteger(divisor) || divisor <= 0) throw new Error("Invalid divisor");
  return formatDecimal(parseDecimal(value, 4, 14) / BigInt(divisor), 4, 14);
}

export function tryMoneyDecimal(operation: () => string): string | null {
  try { return operation(); }
  catch { return null; }
}
