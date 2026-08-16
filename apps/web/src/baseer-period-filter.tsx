import { useMemo, useState } from "react";

export type BaseerPeriodPreset = "DAY" | "MONTH" | "MULTI_MONTH" | "QUARTER" | "YEAR" | "RANGE";

export type BaseerPeriodRange = {
  preset: BaseerPeriodPreset;
  from: string;
  to: string;
  months: readonly string[];
};

type Language = "ar" | "en";
type Props = { language: Language; value: BaseerPeriodRange; onChange: (range: BaseerPeriodRange) => void; presets?: readonly BaseerPeriodPreset[]; className?: string };

const labels: Record<Language, Record<BaseerPeriodPreset, string>> = {
  ar: { DAY: "يوم", MONTH: "شهر", MULTI_MONTH: "أشهر متعددة", QUARTER: "ربع سنة", YEAR: "سنة", RANGE: "نطاق" },
  en: { DAY: "Day", MONTH: "Month", MULTI_MONTH: "Multiple months", QUARTER: "Quarter", YEAR: "Year", RANGE: "Range" },
};

function riyadhToday() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}
function iso(year: number, month: number, day: number) { return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function monthEnd(year: number, month: number) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
function dateFromMonth(value: string) { const [year, month] = value.split("-").map(Number); return { year, month }; }
function rangeFromMonth(value: string) { const { year, month } = dateFromMonth(value); return { from: iso(year, month, 1), to: iso(year, month, monthEnd(year, month)) }; }
function envelope(months: readonly string[]) {
  const sorted = [...new Set(months)].sort();
  if (!sorted.length) return null;
  return { months: sorted, from: rangeFromMonth(sorted[0]).from, to: rangeFromMonth(sorted.at(-1)!).to };
}
function monthName(language: Language, value: string) {
  const { year, month } = dateFromMonth(value);
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en", { month: "long", year: "numeric", timeZone: "Asia/Riyadh" }).format(new Date(Date.UTC(year, month - 1, 1)));
}

export function baseerPeriodRange(preset: Exclude<BaseerPeriodPreset, "RANGE">): BaseerPeriodRange {
  const today = riyadhToday();
  if (preset === "DAY") { const date = iso(today.year, today.month, today.day); return { preset, from: date, to: date, months: [] }; }
  if (preset === "MONTH") { const selectedMonth = `${today.year}-${String(today.month).padStart(2, "0")}`; return { preset, ...rangeFromMonth(selectedMonth), months: [selectedMonth] }; }
  if (preset === "MULTI_MONTH") { const selectedMonth = `${today.year}-${String(today.month).padStart(2, "0")}`; return { preset, ...rangeFromMonth(selectedMonth), months: [selectedMonth] }; }
  if (preset === "YEAR") return { preset, from: iso(today.year, 1, 1), to: iso(today.year, 12, 31), months: [] };
  const quarterStart = Math.floor((today.month - 1) / 3) * 3 + 1;
  return { preset, from: iso(today.year, quarterStart, 1), to: iso(today.year, quarterStart + 2, monthEnd(today.year, quarterStart + 2)), months: [] };
}
export function defaultBaseerPeriodRange() { return baseerPeriodRange("MONTH"); }
export function baseerPeriodQuery(range: BaseerPeriodRange) {
  const query = new URLSearchParams({ fromBusinessDate: range.from, toBusinessDate: range.to });
  if (range.preset === "MULTI_MONTH" && range.months.length) query.set("businessMonths", range.months.join(","));
  return query.toString();
}

export function BaseerPeriodFilter({ language, value, onChange, presets = ["DAY", "MONTH", "MULTI_MONTH", "QUARTER", "YEAR", "RANGE"], className }: Props) {
  const [monthDraft, setMonthDraft] = useState(value.months[0] ?? "");
  const years = useMemo(() => { const current = riyadhToday().year; return Array.from({ length: 7 }, (_, index) => current - 4 + index); }, []);
  const setPreset = (preset: BaseerPeriodPreset) => { if (preset === "RANGE") return onChange({ ...value, preset, months: [] }); onChange(baseerPeriodRange(preset)); };
  const setDay = (day: string) => onChange({ preset: "DAY", from: day, to: day, months: [] });
  const setMonth = (month: string) => onChange({ preset: "MONTH", ...rangeFromMonth(month), months: [month] });
  const setQuarter = (quarter: number, year: number) => { const month = (quarter - 1) * 3 + 1; onChange({ preset: "QUARTER", from: iso(year, month, 1), to: iso(year, month + 2, monthEnd(year, month + 2)), months: [] }); };
  const setYear = (year: number) => onChange({ preset: "YEAR", from: iso(year, 1, 1), to: iso(year, 12, 31), months: [] });
  const updateRange = (key: "from" | "to", next: string) => { const otherKey = key === "from" ? "to" : "from"; const nextRange: BaseerPeriodRange = { ...value, preset: "RANGE", months: [], [key]: next }; if (next && nextRange[otherKey] && nextRange.from > nextRange.to) nextRange[otherKey] = next; onChange(nextRange); };
  const addMonth = () => { if (!monthDraft) return; const next = envelope([...value.months, monthDraft]); if (next) onChange({ preset: "MULTI_MONTH", ...next }); };
  const removeMonth = (month: string) => { const next = envelope(value.months.filter((item) => item !== month)); if (next) onChange({ preset: "MULTI_MONTH", ...next }); else onChange(baseerPeriodRange("MULTI_MONTH")); };
  const selectedMonth = value.months[0] ?? value.from.slice(0, 7);
  const selectedYear = Number(value.from.slice(0, 4));
  const selectedQuarter = Math.floor((Number(value.from.slice(5, 7)) - 1) / 3) + 1;
  return <section className={["baseer-period-filter", className].filter(Boolean).join(" ")} aria-label={language === "ar" ? "فلترة الفترة" : "Period filter"}>
    <label className="baseer-period-filter__mode">{language === "ar" ? "الفترة" : "Period"}<select value={value.preset} onChange={(event) => setPreset(event.target.value as BaseerPeriodPreset)}>{presets.map((preset) => <option key={preset} value={preset}>{labels[language][preset]}</option>)}</select></label>
    {value.preset === "DAY" && <label className="baseer-period-filter__control">{language === "ar" ? "التاريخ" : "Date"}<input type="date" value={value.from} onChange={(event) => setDay(event.target.value)} /></label>}
    {value.preset === "MONTH" && <label className="baseer-period-filter__control">{language === "ar" ? "الشهر والسنة" : "Month and year"}<input type="month" value={selectedMonth} onChange={(event) => setMonth(event.target.value)} /></label>}
    {value.preset === "MULTI_MONTH" && <div className="baseer-period-filter__multi"><label className="baseer-period-filter__control">{language === "ar" ? "اختر شهرًا" : "Select month"}<span><input type="month" value={monthDraft} onChange={(event) => setMonthDraft(event.target.value)} /><button type="button" onClick={addMonth}>{language === "ar" ? "إضافة" : "Add"}</button></span></label><div className="baseer-period-filter__chips" aria-label={language === "ar" ? "الأشهر المختارة" : "Selected months"}>{value.months.map((month) => <button key={month} type="button" onClick={() => removeMonth(month)}>{monthName(language, month)} <b aria-hidden="true">×</b></button>)}</div></div>}
    {value.preset === "QUARTER" && <div className="baseer-period-filter__pair"><label className="baseer-period-filter__control">{language === "ar" ? "الربع" : "Quarter"}<select value={selectedQuarter} onChange={(event) => setQuarter(Number(event.target.value), selectedYear)}>{[1,2,3,4].map((quarter) => <option key={quarter} value={quarter}>{language === "ar" ? `الربع ${quarter}` : `Q${quarter}`}</option>)}</select></label><label className="baseer-period-filter__control">{language === "ar" ? "السنة" : "Year"}<select value={selectedYear} onChange={(event) => setQuarter(selectedQuarter, Number(event.target.value))}>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label></div>}
    {value.preset === "YEAR" && <label className="baseer-period-filter__control">{language === "ar" ? "السنة" : "Year"}<select value={selectedYear} onChange={(event) => setYear(Number(event.target.value))}>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select></label>}
    {value.preset === "RANGE" && <div className="baseer-period-filter__pair"><label className="baseer-period-filter__control">{language === "ar" ? "من" : "From"}<input type="date" value={value.from} onChange={(event) => updateRange("from", event.target.value)} /></label><label className="baseer-period-filter__control">{language === "ar" ? "إلى" : "To"}<input type="date" value={value.to} onChange={(event) => updateRange("to", event.target.value)} /></label></div>}
  </section>;
}