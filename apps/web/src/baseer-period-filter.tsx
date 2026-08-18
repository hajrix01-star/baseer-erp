import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BaseerCalendarIcon } from "./baseer-calendar-icon";

export type BaseerPeriodPreset = "DAY" | "MONTH" | "MULTI_MONTH" | "QUARTER" | "YEAR" | "RANGE";
export type BaseerPeriodRange = { preset: BaseerPeriodPreset; from: string; to: string; months: readonly string[] };
type Language = "ar" | "en";
type Props = { language: Language; value: BaseerPeriodRange; onChange: (range: BaseerPeriodRange) => void; presets?: readonly BaseerPeriodPreset[]; className?: string };

const labels: Record<Language, Record<BaseerPeriodPreset, string>> = {
  ar: { DAY: "يوم", MONTH: "شهر", MULTI_MONTH: "أشهر متعددة", QUARTER: "ربع سنة", YEAR: "سنة", RANGE: "نطاق" },
  en: { DAY: "Day", MONTH: "Month", MULTI_MONTH: "Multiple months", QUARTER: "Quarter", YEAR: "Year", RANGE: "Range" },
};
const weekdays: Record<Language, readonly string[]> = { ar: ["ح", "ن", "ث", "ر", "خ", "ج", "س"], en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] };

export function riyadhToday() { const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const get = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value); return { year: get("year"), month: get("month"), day: get("day") }; }
export function iso(year: number, month: number, day: number) { return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`; }
function monthEnd(year: number, month: number) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
function dateFromMonth(value: string) { return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) }; }
function rangeFromMonth(value: string) { const { year, month } = dateFromMonth(value); return { from: iso(year, month, 1), to: iso(year, month, monthEnd(year, month)) }; }
function envelope(months: readonly string[]) { const sorted = [...new Set(months)].sort(); return sorted.length ? { months: sorted, from: rangeFromMonth(sorted[0]!).from, to: rangeFromMonth(sorted.at(-1)!).to } : null; }
export function monthName(language: Language, value: string, format: "long" | "short" = "long") { const { year, month } = dateFromMonth(value); return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en", { month: format, ...(format === "long" ? { year: "numeric" } : {}), timeZone: "Asia/Riyadh" }).format(new Date(Date.UTC(year, month - 1, 1))); }
export function cursorFor(date: string) { if (date) return date.slice(0, 7); const today = riyadhToday(); return `${today.year}-${String(today.month).padStart(2, "0")}`; }
export function shiftCursor(cursor: string, delta: number) { const { year, month } = dateFromMonth(cursor); const next = new Date(Date.UTC(year, month - 1 + delta, 1)); return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`; }
export function daysForCalendar(cursor: string) { const { year, month } = dateFromMonth(cursor); const first = new Date(Date.UTC(year, month - 1, 1)); const leading = first.getUTCDay(); return Array.from({ length: 42 }, (_, index) => { const date = new Date(Date.UTC(year, month - 1, index - leading + 1)); return { iso: iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()), day: date.getUTCDate(), inMonth: date.getUTCMonth() + 1 === month }; }); }
export function baseerPeriodLabel(value: BaseerPeriodRange, language: Language) { if (value.preset === "DAY") return value.from; if (value.preset === "MONTH") return monthName(language, value.from.slice(0, 7)); if (value.preset === "MULTI_MONTH") return value.months.map((month) => monthName(language, month, "short")).join(language === "ar" ? "، " : ", "); if (value.preset === "YEAR") return value.from.slice(0, 4); if (value.preset === "QUARTER") return `${language === "ar" ? "الربع" : "Q"} ${Math.floor((Number(value.from.slice(5, 7)) - 1) / 3) + 1} · ${value.from.slice(0, 4)}`; return `${value.from} — ${value.to}`; }

export function baseerPeriodRange(preset: Exclude<BaseerPeriodPreset, "RANGE">): BaseerPeriodRange { const today = riyadhToday(); const month = `${today.year}-${String(today.month).padStart(2, "0")}`; if (preset === "DAY") { const day = iso(today.year, today.month, today.day); return { preset, from: day, to: day, months: [] }; } if (preset === "MONTH" || preset === "MULTI_MONTH") return { preset, ...rangeFromMonth(month), months: [month] }; if (preset === "YEAR") return { preset, from: iso(today.year, 1, 1), to: iso(today.year, 12, 31), months: [] }; const start = Math.floor((today.month - 1) / 3) * 3 + 1; return { preset, from: iso(today.year, start, 1), to: iso(today.year, start + 2, monthEnd(today.year, start + 2)), months: [] }; }
export function defaultBaseerPeriodRange() { return baseerPeriodRange("MONTH"); }
export function baseerPeriodQuery(range: BaseerPeriodRange) { const query = new URLSearchParams({ fromBusinessDate: range.from, toBusinessDate: range.to }); if (range.preset === "MULTI_MONTH" && range.months.length) query.set("businessMonths", range.months.join(",")); return query.toString(); }

export function BaseerPeriodFilter({ language, value, onChange, presets = ["DAY", "MONTH", "MULTI_MONTH", "QUARTER", "YEAR", "RANGE"], className }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [cursor, setCursor] = useState(cursorFor(value.from));
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const years = useMemo(() => { const current = riyadhToday().year; return Array.from({ length: 9 }, (_, index) => current - 5 + index); }, []);
  useEffect(() => { if (!open) return; const closeWhenOutside = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); }; const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); } }; document.addEventListener("mousedown", closeWhenOutside); document.addEventListener("keydown", closeOnEscape); return () => { document.removeEventListener("mousedown", closeWhenOutside); document.removeEventListener("keydown", closeOnEscape); }; }, [open]);
  const openPicker = () => { setDraft(value); setCursor(cursorFor(value.from)); setRangeStart(null); setOpen(true); };
  const setPreset = (preset: BaseerPeriodPreset) => { const next = preset === "RANGE" ? { ...draft, preset, months: [] } : baseerPeriodRange(preset); setDraft(next); setCursor(cursorFor(next.from)); setRangeStart(null); };
  const selectMonth = (month: number) => { const token = `${cursor.slice(0, 4)}-${String(month).padStart(2, "0")}`; if (draft.preset === "MULTI_MONTH") { const next = draft.months.includes(token) ? envelope(draft.months.filter((item) => item !== token)) : envelope([...draft.months, token]); setDraft(next ? { preset: "MULTI_MONTH", ...next } : { ...baseerPeriodRange("MULTI_MONTH"), months: [] }); return; } setDraft({ preset: "MONTH", ...rangeFromMonth(token), months: [token] }); };
  const selectDay = (day: string) => { if (draft.preset === "DAY") { setDraft({ preset: "DAY", from: day, to: day, months: [] }); return; } if (!rangeStart) { setRangeStart(day); setDraft({ preset: "RANGE", from: day, to: day, months: [] }); return; } const from = rangeStart < day ? rangeStart : day; const to = rangeStart < day ? day : rangeStart; setDraft({ preset: "RANGE", from, to, months: [] }); setRangeStart(null); };
  const selectQuarter = (quarter: number) => { const year = Number(cursor.slice(0, 4)); const month = (quarter - 1) * 3 + 1; setDraft({ preset: "QUARTER", from: iso(year, month, 1), to: iso(year, month + 2, monthEnd(year, month + 2)), months: [] }); };
  const selectYear = (year: number) => { setDraft({ preset: "YEAR", from: iso(year, 1, 1), to: iso(year, 12, 31), months: [] }); setCursor(`${year}-01`); };
  const clearPeriod = () => { const next = defaultBaseerPeriodRange(); onChange(next); setCursor(cursorFor(next.from)); setRangeStart(null); setOpen(false); };
  const applyPeriod = () => { onChange(draft); setRangeStart(null); setOpen(false); };
  const days = draft.preset === "DAY" || draft.preset === "RANGE" ? daysForCalendar(cursor) : [];
  const today = iso(riyadhToday().year, riyadhToday().month, riyadhToday().day);
  const defaultRange = defaultBaseerPeriodRange();
  const hasCustomPeriod = value.preset !== defaultRange.preset || value.from !== defaultRange.from || value.to !== defaultRange.to || value.months.join(",") !== defaultRange.months.join(",");
  return <section ref={rootRef} className={["baseer-period-filter", className].filter(Boolean).join(" ")} aria-label={language === "ar" ? "فلترة الفترة" : "Period filter"}>
    <div className="baseer-period-filter__bar">
      <button ref={triggerRef} className="baseer-period-filter__trigger" type="button" aria-controls={open ? popoverId : undefined} aria-expanded={open} onClick={() => open ? setOpen(false) : openPicker()}><span className="baseer-period-filter__calendar" aria-hidden="true"><BaseerCalendarIcon /></span><span className="baseer-period-filter__label">{language === "ar" ? "الفترة" : "Period"}</span><strong>{baseerPeriodLabel(value, language)}</strong></button>
      {hasCustomPeriod && <button className="baseer-period-filter__clear" type="button" onClick={clearPeriod} aria-label={language === "ar" ? "إلغاء الفلترة" : "Clear filter"} title={language === "ar" ? "إلغاء الفلترة" : "Clear filter"}>×</button>}
    </div>
    {open && <section id={popoverId} className="baseer-period-filter__popover" role="dialog" aria-label={language === "ar" ? "اختيار الفترة" : "Choose period"}>
      <header><select value={draft.preset} onChange={(event) => setPreset(event.target.value as BaseerPeriodPreset)}>{presets.map((preset) => <option key={preset} value={preset}>{labels[language][preset]}</option>)}</select>{(draft.preset === "MONTH" || draft.preset === "MULTI_MONTH" || draft.preset === "QUARTER") && <select value={cursor.slice(0, 4)} aria-label={language === "ar" ? "السنة" : "Year"} onChange={(event) => setCursor(`${event.target.value}-01`)}>{years.map((year) => <option key={year} value={year}>{year}</option>)}</select>}<div className="baseer-period-filter__nav"><button type="button" onClick={() => setCursor(shiftCursor(cursor, -1))} aria-label={language === "ar" ? "السابق" : "Previous"}>‹</button><strong>{monthName(language, cursor)}</strong><button type="button" onClick={() => setCursor(shiftCursor(cursor, 1))} aria-label={language === "ar" ? "التالي" : "Next"}>›</button></div></header>
      {(draft.preset === "DAY" || draft.preset === "RANGE") && <><div className="baseer-period-filter__weekdays">{weekdays[language].map((day) => <span key={day}>{day}</span>)}</div><div className="baseer-period-filter__days">{days.map((day) => <button key={day.iso} className={[!day.inMonth ? "is-outside" : "", day.iso === draft.from || day.iso === draft.to ? "is-selected" : "", day.iso > draft.from && day.iso < draft.to ? "is-between" : "", day.iso === today ? "is-today" : ""].filter(Boolean).join(" ")} type="button" onClick={() => selectDay(day.iso)}>{day.day}</button>)}</div></>}
      {(draft.preset === "MONTH" || draft.preset === "MULTI_MONTH") && <div className="baseer-period-filter__months">{Array.from({ length: 12 }, (_, index) => { const token = `${cursor.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`; const selected = draft.preset === "MULTI_MONTH" ? draft.months.includes(token) : draft.from.slice(0, 7) === token; return <button className={selected ? "is-selected" : ""} key={token} type="button" onClick={() => selectMonth(index + 1)}>{monthName(language, token, "short")}</button>; })}</div>}
      {draft.preset === "QUARTER" && <div className="baseer-period-filter__quarters">{[1, 2, 3, 4].map((quarter) => <button key={quarter} type="button" onClick={() => selectQuarter(quarter)}>{language === "ar" ? `الربع ${quarter}` : `Q${quarter}`}</button>)}</div>}
      {draft.preset === "YEAR" && <div className="baseer-period-filter__years">{years.map((year) => <button className={Number(draft.from.slice(0, 4)) === year ? "is-selected" : ""} key={year} type="button" onClick={() => selectYear(year)}>{year}</button>)}</div>}
      <footer><span>{draft.preset === "RANGE" && rangeStart ? (language === "ar" ? "اختر تاريخ النهاية" : "Choose the end date") : baseerPeriodLabel(draft, language)}</span><div><button type="button" onClick={() => setOpen(false)}>{language === "ar" ? "إلغاء" : "Cancel"}</button><button className="baseer-period-filter__apply" type="button" onClick={applyPeriod}>{language === "ar" ? "تطبيق" : "Apply"}</button></div></footer>
    </section>}
  </section>;
}