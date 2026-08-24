/**
 * Presentation-only numeric standards for Baseer.
 *
 * Arabic remains the interface language, while every digit rendered by this
 * module is Latin (0-9). API values stay decimal strings; none of these
 * helpers participate in accounting calculations.
 */
export type BaseerLanguage = "ar" | "en";

type NumericValue = string | number | null | undefined;
type NumberOptions = Pick<Intl.NumberFormatOptions, "minimumFractionDigits" | "maximumFractionDigits" | "notation" | "compactDisplay">;

const LATIN_ARABIC_LOCALE = "ar-SA-u-ca-gregory-nu-latn";
const LATIN_ENGLISH_LOCALE = "en-US-u-nu-latn";
const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

function localeFor(language: BaseerLanguage = "en") {
  return language === "ar" ? LATIN_ARABIC_LOCALE : LATIN_ENGLISH_LOCALE;
}

function numericValue(value: NumericValue) {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return Number(value);
  return Number(normalizeBaseerNumericInput(value));
}

function formatNumeric(value: NumericValue, options: NumberOptions, language: BaseerLanguage = "en") {
  const numeric = numericValue(value);
  if (!Number.isFinite(numeric)) return "—";
  return new Intl.NumberFormat(localeFor(language), options).format(numeric);
}

/** Converts Arabic-Indic and Persian digits to the ASCII digits used by the API. */
export function toLatinDigits(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)));
}

/**
 * Canonicalises editable numeric text without parsing or rounding it.
 * It accepts Arabic-Indic/Persian digits and Arabic decimal separators, then
 * returns the ASCII representation that can safely be sent to the API.
 */
export function normalizeBaseerNumericInput(value: string, options: { allowNegative?: boolean } = {}) {
  const allowNegative = options.allowNegative ?? true;
  const translated = toLatinDigits(value)
    .replace(/[٫]/g, ".")
    .replace(/[٬,\s\u200e\u200f\u061c]/g, "")
    .replace(/[−–—]/g, "-");
  const negative = allowNegative && translated.startsWith("-");
  const unsigned = translated.replace(/[^0-9.]/g, "");
  const [integer = "", ...fractionParts] = unsigned.split(".");
  const fraction = fractionParts.join("");
  const decimal = unsigned.includes(".") ? "." : "";
  return `${negative ? "-" : ""}${integer}${decimal}${fraction}`;
}

/** Default numeric display retained for existing operational summaries. */
export function formatNumber(value: NumericValue, language: BaseerLanguage = "en"): string {
  return formatNumeric(value, { minimumFractionDigits: 0, maximumFractionDigits: 1 }, language);
}

/** Counts are whole units and always use Latin digits. */
export function formatCount(value: NumericValue, language: BaseerLanguage = "en") {
  return formatNumeric(value, { minimumFractionDigits: 0, maximumFractionDigits: 0 }, language);
}

/** Quantities preserve more operational precision than monetary summaries. */
export function formatQuantity(value: NumericValue, maximumFractionDigits = 3, language: BaseerLanguage = "en") {
  return formatNumeric(value, { minimumFractionDigits: 0, maximumFractionDigits }, language);
}

/**
 * Monetary totals normally use two decimal places. Unit prices, tax rates and
 * recipe costs may opt into four places without changing the stored Decimal.
 */
export function formatMoney(value: NumericValue, currency = "SAR", language: BaseerLanguage = "en", maximumFractionDigits = 2): string {
  const formatted = formatNumeric(value, { minimumFractionDigits: 0, maximumFractionDigits }, language);
  return formatted === "—" ? formatted : `${formatted} ${currency}`;
}

/** Percentages use their own precision and must never inherit money rounding. */
export function formatPercent(value: NumericValue, maximumFractionDigits = 1, language: BaseerLanguage = "en"): string {
  const formatted = formatNumeric(value, { minimumFractionDigits: 0, maximumFractionDigits }, language);
  return formatted === "—" ? formatted : `${formatted}%`;
}

/** Compact axis labels preserve Arabic words, if selected, while keeping Latin digits. */
export function formatCompactNumber(value: NumericValue, language: BaseerLanguage = "en", maximumFractionDigits = 1) {
  return formatNumeric(value, { notation: "compact", compactDisplay: "short", minimumFractionDigits: 0, maximumFractionDigits }, language);
}

function isoDate(value: string | Date | null | undefined) {
  if (value instanceof Date) return Number.isNaN(value.valueOf()) ? null : value;
  if (!value || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return null;
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(date.valueOf()) ? null : date;
}

/** Gregorian date with Latin digits for both Arabic and English interfaces. */
export function formatDate(value: string | Date | null | undefined, language: BaseerLanguage = "en") {
  const date = isoDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(localeFor(language), { calendar: "gregory", day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

/** Gregorian date and 24-hour time with Latin digits. */
export function formatDateTime(value: string | Date | null | undefined, language: BaseerLanguage = "en", timeZone = "UTC") {
  const date = isoDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(localeFor(language), { calendar: "gregory", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(date);
}

/** Month labels for timelines retain Arabic month names with Latin year digits. */
export function formatMonthYear(value: string, language: BaseerLanguage = "en", month: "long" | "short" = "long", includeYear = true) {
  if (!/^\d{4}-\d{2}$/.test(value)) return "—";
  return new Intl.DateTimeFormat(localeFor(language), { calendar: "gregory", month, ...(includeYear ? { year: "numeric" as const } : {}), timeZone: "UTC" }).format(new Date(`${value}-01T00:00:00Z`));
}

/** Full business-date label for briefs: Arabic names, Gregorian calendar and Latin digits. */
export function formatLongDate(value: string | Date | null | undefined, language: BaseerLanguage = "en", timeZone = "UTC") {
  const date = isoDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(localeFor(language), { calendar: "gregory", weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone }).format(date);
}

/** Time-only label with Latin digits in a stable 24-hour representation. */
export function formatTime(value: string | Date | null | undefined, language: BaseerLanguage = "en", timeZone = "UTC") {
  const date = isoDate(value);
  if (!date) return "—";
  return new Intl.DateTimeFormat(localeFor(language), { calendar: "gregory", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(date);
}

/** Exact fractional precision for non-final animated presentation values. */
export function formatNumberFixed(value: NumericValue, fractionDigits: number, language: BaseerLanguage = "en") {
  return formatNumeric(value, { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits }, language);
}
