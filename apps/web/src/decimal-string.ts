const POWERS_OF_TEN = Array.from({ length: 19 }, (_, index) => 10n ** BigInt(index));

function parseDecimal(value: string, scale: number, maxIntegerDigits: number): bigint {
  const pattern = new RegExp(`^(?:0|[1-9]\\d{0,${maxIntegerDigits - 1}})(?:\\.\\d{1,${scale}})?$`);
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

export function tryMoneyDecimal(operation: () => string): string | null {
  try { return operation(); }
  catch { return null; }
}
