import { useMemo, useState } from "react";

export type BaseerPeriodPreset = "DAY" | "MONTH" | "MULTI_MONTH" | "QUARTER" | "YEAR" | "RANGE";
export type BaseerPeriodRange = { preset: BaseerPeriodPreset; from: string; to: string; months: readonly string[] };
type Language = "ar" | "en";
type Props = { language: Language; value: BaseerPeriodRange; onChange: (range: BaseerPeriodRange) => void; presets?: readonly BaseerPeriodPreset[]; className?: string };

const labels: Record<Language, Record<BaseerPeriodPreset, string>> = {
  ar: { DAY: "يوم", MONTH: "شهر", MULTI_MONTH: "أشهر متعددة", QUARTER: "ربع سنة", YEAR: "سنة", RANGE: "نطاق" },
  en: { DAY: "Day", MONTH: "Month", MULTI_MONTH: "Multiple months", QUARTER: "Quarter", YEAR: "Year", RANGE: "Range" },
};
const weekdays: Record<Language, readonly string[]> = { ar: ["ح", "ن", "ث", "ر", "خ", "ج", "س"], en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] };

function riyadhToday() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value); return { year: get("year"), month: get("month"), day: get("day") }; }
function iso(year: number, month: number, day: number) { return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function monthEnd(year: number, month: number) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
function dateFromMonth(value: string) { return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) }; }
function rangeFromMonth(value: string) { const { year, month } = dateFromMonth(value); return { from: iso(year, month, 1), to: iso(year, month, monthEnd(year, month)) }; }
function envelope(months: readonly string[]) { const sorted = [...new Set(months)].sort(); return sorted.length ? { months: sorted, from: rangeFromMonth(sorted[0]!).from, to: rangeFromMonth(sorted.at(-1)!).to } : null; }
function monthName(language: Language, value: string, format: "long" | "short" = "long") { const { year, month } = dateFromMonth(value); return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en", { month: format, ...(format === "long" ? { year: "numeric" } : {}), timeZone: "Asia/Riyadh" }).format(new Date(Date.UTC(year, month - 1, 1))); }
function cursorFor(date: string) { return date.slice(0, 7); }
function shiftCursor(cursor: string, delta: number) { const { year, month } = dateFromMonth(cursor); const next = new Date(Date.UTC(year, month - 1 + delta, 1)); return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`; }
function daysForCalendar(cursor: string) { const { year, month } = dateFromMonth(cursor); const first = new Date(Date.UTC(year, month - 1, 1)); const leading = first.getUTCDay(); return Array.from({ length: 42 }, (_, index) => { const date = new Date(Date.UTC(year, month - 1, index - leading + 1)); return { iso: iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()), day: date.getUTCDate(), inMonth: date.getUTCMonth() + 1 === month }; }); }
function display(value: BaseerPeriodRange, language: Language) { if (value.preset === "DAY") return value.from; if (value.preset === "MONTH") return monthName(language, value.from.slice(0, 7)); if (value.preset === "MULTI_MONTH") return language === "ar" ? `${value.months.length} أشهر` : `${value.months.length} months`; if (value.preset === "YEAR") return value.from.slice(0, 4); if (value.preset === "QUARTER") return `${language === "ar" ? "الربع" : "Q"} ${Math.floor((Number(value.from.slice(5, 7)) - 1) / 3) + 1} · ${value.from.slice(0, 4)}`; return `${value.from} — ${value.to}`; }

export function baseerPeriodRange(preset: Exclude<BaseerPeriodPreset, "RANGE">): BaseerPeriodRange { const today = riyadhToday(); const month = `${today.year}-${String(today.month).padStart(2, "0")}`; if (preset === "DAY") { const day = iso(today.year, today.month, today.day); return { preset, from: day, to: day, months: [] }; } if (preset === "MONTH" || preset === "MULTI_MONTH") return { preset, ...rangeFromMonth(month), months: [month] }; if (preset === "YEAR") return { preset, from: iso(today.year, 1, 1), to: iso(today.year, 12, 31), months: [] }; const start = Math.floor((today.month - 1) / 3) * 3 + 1; return { preset, from: iso(today.year, start, 1), to: iso(today.year, start + 2, monthEnd(today.year, start + 2)), months: [] }; }
export function defaultBaseerPeriodRange() { return baseerPeriodRange("MONTH"); }
export function baseerPeriodQuery(range: BaseerPeriodRange) { const query = new URLSearchParams({ fromBusinessDate: range.from, toBusinessDate: range.to }); if (range.preset === "MULTI_MONTH" && range.months.length) query.set("businessMonths", range.months.join(",")); return query.toString(); }

export function BaseerPeriodFilter({ language, value, onChange, presets = ["DAY", "MONTH", "MULTI_MONTH", "QUARTER", "YEAR", "RANGE"], className }: Props) {
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(cursorFor(value.from));
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const years = useMemo(() => { const current = riyadhToday().year; return Array.from({ length: 9 }, (_, index) => current - 5 + index); }, []);
  const setPreset = (preset: BaseerPeriodPreset) => { const next = preset === "RANGE" ? { ...value, preset, months: [] } : baseerPeriodRange(preset); onChange(next); setCursor(cursorFor(next.from)); setRangeStart(null); };
  const selectMonth = (month: number) => { const token = `${cursor.slice(0, 4)}-${String(month).padStart(2, "0")}`; if (value.preset === "MULTI_MONTH") { const next = value.months.includes(token) ? envelope(value.months.filter((item) => item !== token)) : envelope([...value.months, token]); onChange(next ? { preset: "MULTI_MONTH", ...next } : { ...baseerPeriodRange("MULTI_MONTH"), months: [] }); return; } const next = { preset: "MONTH" as const, ...rangeFromMonth(token), months: [token] }; onChange(next); setOpen(false); };
  const selectDay = (day: string) => { if (value.preset === "DAY") { onChange({ preset: "DAY", from: day, to: day, months: [] }); setOpen(false); return; } if (!rangeStart) { setRangeStart(day); onChange({ preset: "RANGE", from: day, to: day, months: [] }); return; } const from = rangeStart < day ? rangeStart : day; const to = rangeStart < day ? day : rangeStart; onChange({ preset: "RANGE", from, to, months: [] }); setRangeStart(null); setOpen(false); };
  const selectQuarter = (quarter: number) => { const year = Number(cursor.slice(0, 4)); const month = (quarter - 1) * 3 + 1; const next = { preset: "QUARTER" as const, from: iso(year, month, 1), to: iso(year, month + 2, monthEnd(year, month + 2)), months: [] }; onChange(next); setOpen(false); };
  const selectYear = (year: number) => { const next = { preset: "YEAR" as const, from: iso(year, 1, 1), to: iso(year, 12, 31), months: [] }; onChange(next); setCursor(`${year}-01`); setOpen(false); };
  const days = value.preset === "DAY" || value.preset === "RANGE" ? daysForCalendar(cursor) : [];
  const today = iso(riyadhToday().year, riyadhToday().month, riyadhToday().day);
  const defaultRange = defaultBaseerPeriodRange();
  const hasCustomPeriod = value.preset !== defaultRange.preset || value.from !== defaultRange.from || value.to !== defaultRange.to || value.months.join(",") !== defaultRange.months.join(",");
  const clearPeriod = () => { const next = defaultBaseerPeriodRange(); onChange(next); setCursor(cursorFor(next.from)); setRangeStart(null); setOpen(false); };
  return <section className={["baseer-period-filter", className].filter(Boolean).join(" ")} aria-label={language === "ar" ? "فلترة الفترة" : "Period filter"}>
    <div className="baseer-period-filter__bar">
      <button className="baseer-period-filter__trigger" type="button" aria-expanded={open} onClick={() => setOpen((current) => !current)}><span>{language === "ar" ? "الفترة" : "Period"}</span><strong>{display(value, language)}</strong></button>
      {hasCustomPeriod && <button className="baseer-period-filter__clear" type="button" onClick={clearPeriod} aria-label={language === "ar" ? "إلغاء الفلترة" : "Clear filter"} title={language === "ar" ? "إلغاء الفلترة" : "Clear filter"}>×</button>}
    </div>
    {open && <section className="baseer-period-filter__popover" role="dialog" aria-label={language === "ar" ? "اختيار الفترة" : "Choose period"}>
      <header><select value={value.preset} onChange={(event) => setPreset(event.target.value as BaseerPeriodPreset)}>{presets.map((preset) => <option key={preset} value={preset}>{labels[language][preset]}</option>)}</select><div className="baseer-period-filter__nav"><button type="button" onClick={() => setCursor(shiftCursor(cursor, -1))} aria-label={language === "ar" ? "السابق" : "Previous"}>‹</button><strong>{monthName(language, cursor)}</strong><button type="button" onClick={() => setCursor(shiftCursor(cursor, 1))} aria-label={language === "ar" ? "التالي" : "Next"}>›</button></div></header>
      {(value.preset === "DAY" || value.preset === "RANGE") && <><div className="baseer-period-filter__weekdays">{weekdays[language].map((day) => <span key={day}>{day}</span>)}</div><div className="baseer-period-filter__days">{days.map((day) => <button key={day.iso} className={[!day.inMonth ? "is-outside" : "", day.iso === value.from || day.iso === value.to ? "is-selected" : "", day.iso > value.from && day.iso < value.to ? "is-between" : "", day.iso === today ? "is-today" : ""].filter(Boolean).join(" ")} type="button" onClick={() => selectDay(day.iso)}>{day.day}</button>)}</div></>}
      {(value.preset === "MONTH" || value.preset === "MULTI_MONTH") && <div className="baseer-period-filter__months">{Array.from({ length: 12 }, (_, index) => { const token = `${cursor.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`; const selected = value.preset === "MULTI_MONTH" ? value.months.includes(token) : value.from.slice(0, 7) === token; return <button className={selected ? "is-selected" : ""} key={token} type="button" onClick={() => selectMonth(index + 1)}>{monthName(language, token, "short")}</button>; })}</div>}
      {value.preset === "QUARTER" && <div className="baseer-period-filter__quarters">{[1, 2, 3, 4].map((quarter) => <button key={quarter} type="button" onClick={() => selectQuarter(quarter)}>{language === "ar" ? `الربع ${quarter}` : `Q${quarter}`}</button>)}</div>}
      {value.preset === "YEAR" && <div className="baseer-period-filter__years">{years.map((year) => <button className={Number(value.from.slice(0, 4)) === year ? "is-selected" : ""} key={year} type="button" onClick={() => selectYear(year)}>{year}</button>)}</div>}
      {value.preset === "MULTI_MONTH" && <footer><span>{language === "ar" ? `${value.months.length} أشهر مختارة` : `${value.months.length} months selected`}</span><button type="button" onClick={() => setOpen(false)}>{language === "ar" ? "تم" : "Done"}</button></footer>}
      {value.preset === "RANGE" && <footer><span>{rangeStart ? (language === "ar" ? "اختر تاريخ النهاية" : "Choose the end date") : (language === "ar" ? "اختر تاريخ البداية" : "Choose the start date")}</span><button type="button" onClick={() => { setRangeStart(null); setOpen(false); }}>{language === "ar" ? "إغلاق" : "Close"}</button></footer>}
    </section>}
  </section>;
}