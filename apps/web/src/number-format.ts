/** UI-only numeric presentation. Business values remain Decimal strings on the API. */
export function formatNumber(
  value: string | number | null | undefined,
): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 1,
  }).format(numeric);
}

export function formatMoney(
  value: string | number | null | undefined,
  currency = "SAR",
): string {
  const formatted = formatNumber(value);
  return formatted === "—" ? formatted : `${formatted} ${currency}`;
}

/** Percentages use their own precision and must never inherit money rounding. */
export function formatPercent(
  value: string | number | null | undefined,
  maximumFractionDigits = 1,
): string {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return "—";
  return `${new Intl.NumberFormat("en-US", { minimumFractionDigits: 0, maximumFractionDigits }).format(numeric)}%`;
}
