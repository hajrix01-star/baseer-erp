import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import "./baseer-calendar.css";
import { BaseerCalendarIcon } from "./baseer-calendar-icon";
import { baseerPeriodRange, defaultBaseerPeriodRange, iso, riyadhToday, type BaseerPeriodPreset, type BaseerPeriodRange } from "./baseer-period-values";
import { formatCount, formatMonthYear, normalizeBaseerNumericInput } from "./number-format";

export { baseerPeriodRange, defaultBaseerPeriodRange, iso, riyadhToday, type BaseerPeriodPreset, type BaseerPeriodRange } from "./baseer-period-values";

/** "Month" deliberately covers one or more discrete months.  Keeping that
 * choice in one control prevents every workspace from inventing its own
 * multi-month mode (and, importantly, preserves non-contiguous selections). */
type Language = "ar" | "en";
type Props = { language: Language; value: BaseerPeriodRange; onChange: (range: BaseerPeriodRange) => void; presets?: readonly BaseerPeriodPreset[]; /** Some accounting statements require a continuous [from, to] period. */ allowNonContiguousMonths?: boolean; className?: string };

const labels: Record<Language, Record<BaseerPeriodPreset, string>> = {
  ar: { DAY: "يوم", MONTH: "شهر", QUARTER: "ربع سنة", YEAR: "سنة", RANGE: "نطاق" },
  en: { DAY: "Day", MONTH: "Month", QUARTER: "Quarter", YEAR: "Year", RANGE: "Range" },
};
const weekdays: Record<Language, readonly string[]> = { ar: ["ح", "ن", "ث", "ر", "خ", "ج", "س"], en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] };

function monthEnd(year: number, month: number) { return new Date(Date.UTC(year, month, 0)).getUTCDate(); }
function shiftDay(value: string, delta: number) { const date = new Date(`${value}T00:00:00.000Z`); date.setUTCDate(date.getUTCDate() + delta); return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()); }
function notAfterToday(date: string) {
  const today = riyadhToday();
  const todayIso = iso(today.year, today.month, today.day);
  return date > todayIso ? todayIso : date;
}
function dateFromMonth(value: string) { return { year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)) }; }
function rangeFromMonth(value: string) { const { year, month } = dateFromMonth(value); return { from: iso(year, month, 1), to: iso(year, month, monthEnd(year, month)) }; }
function envelope(months: readonly string[]) { const sorted = [...new Set(months)].sort(); return sorted.length ? { months: sorted, from: rangeFromMonth(sorted[0]!).from, to: rangeFromMonth(sorted.at(-1)!).to } : null; }
export function monthName(language: Language, value: string, format: "long" | "short" = "long") { return formatMonthYear(value, language, format, format === "long"); }
export function cursorFor(date: string) { if (date) return date.slice(0, 7); const today = riyadhToday(); return `${today.year}-${String(today.month).padStart(2, "0")}`; }
export function shiftCursor(cursor: string, delta: number) { const { year, month } = dateFromMonth(cursor); const next = new Date(Date.UTC(year, month - 1 + delta, 1)); return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`; }
export function daysForCalendar(cursor: string) { const { year, month } = dateFromMonth(cursor); const first = new Date(Date.UTC(year, month - 1, 1)); const leading = first.getUTCDay(); return Array.from({ length: 42 }, (_, index) => { const date = new Date(Date.UTC(year, month - 1, index - leading + 1)); return { iso: iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()), day: date.getUTCDate(), inMonth: date.getUTCMonth() + 1 === month }; }); }
/** Dates stay in the compact English calendar format across both Arabic and English UI. */
export function baseerPeriodLabel(value: BaseerPeriodRange, _language: Language) {
  if (value.preset === "DAY") return value.from;
  if (value.preset === "MONTH") {
    const showYear = value.months.length > 1 && new Set(value.months.map((month) => month.slice(0, 4))).size > 1;
    return value.months.map((month) => monthName("en", month, showYear ? "long" : "short")).join(", ");
  }
  if (value.preset === "YEAR") return value.from.slice(0, 4);
  if (value.preset === "QUARTER") return `Q${Math.floor((Number(value.from.slice(5, 7)) - 1) / 3) + 1} · ${value.from.slice(0, 4)}`;
  return `${value.from} — ${value.to}`;
}

export function baseerPeriodQuery(range: BaseerPeriodRange) { const query = new URLSearchParams({ fromBusinessDate: range.from, toBusinessDate: range.to }); if (range.preset === "MONTH" && range.months.length > 1) query.set("businessMonths", range.months.join(",")); return query.toString(); }

export function BaseerPeriodFilter({ language, value, onChange, presets = ["DAY", "MONTH", "QUARTER", "YEAR", "RANGE"], allowNonContiguousMonths = true, className }: Props) {
  const rootRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const presetRef = useRef<HTMLSelectElement>(null);
  const popoverId = useId();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [cursor, setCursor] = useState(cursorFor(value.from));
  const [rangeStart, setRangeStart] = useState<string | null>(null);
  const years = useMemo(() => { const current = riyadhToday().year; return Array.from({ length: 9 }, (_, index) => current - 5 + index); }, []);
  const closePicker = (restoreFocus = false) => { setOpen(false); if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus()); };
  useEffect(() => { if (!open) return; const closeWhenOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) closePicker(false); }; const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); closePicker(true); } }; document.addEventListener("pointerdown", closeWhenOutside); document.addEventListener("keydown", closeOnEscape); return () => { document.removeEventListener("pointerdown", closeWhenOutside); document.removeEventListener("keydown", closeOnEscape); }; }, [open]);
  useLayoutEffect(() => { if (open) presetRef.current?.focus(); }, [open]);
  const openPicker = () => { setDraft(value); setCursor(cursorFor(value.from)); setRangeStart(null); setOpen(true); };
  const setPreset = (preset: BaseerPeriodPreset) => { const next = preset === "RANGE" ? { ...draft, preset, months: [] } : baseerPeriodRange(preset); setDraft(next); setCursor(cursorFor(next.from)); setRangeStart(null); };
  const selectMonth = (month: number) => { const token = `${cursor.slice(0, 4)}-${String(month).padStart(2, "0")}`; const today = riyadhToday(); const currentToken = `${today.year}-${String(today.month).padStart(2, "0")}`; if (token > currentToken) return; if (!allowNonContiguousMonths) { const range = rangeFromMonth(token); setDraft({ preset: "MONTH", from: range.from, to: notAfterToday(range.to), months: [token] }); return; } const months = draft.preset === "MONTH" ? draft.months : []; const next = envelope(months.includes(token) ? months.filter((item) => item !== token) : [...months, token]); if (next) setDraft({ preset: "MONTH", from: next.from, to: notAfterToday(next.to), months: next.months }); };
  const selectDay = (day: string) => { if (draft.preset === "DAY") { setDraft({ preset: "DAY", from: day, to: day, months: [] }); return; } if (!rangeStart) { setRangeStart(day); setDraft({ preset: "RANGE", from: day, to: day, months: [] }); return; } const from = rangeStart < day ? rangeStart : day; const to = rangeStart < day ? day : rangeStart; setDraft({ preset: "RANGE", from, to, months: [] }); setRangeStart(null); };
  const selectQuarter = (quarter: number) => { const year = Number(cursor.slice(0, 4)); const month = (quarter - 1) * 3 + 1; const from = iso(year, month, 1); if (from > iso(riyadhToday().year, riyadhToday().month, riyadhToday().day)) return; setDraft({ preset: "QUARTER", from, to: notAfterToday(iso(year, month + 2, monthEnd(year, month + 2))), months: [] }); };
  const selectYear = (year: number) => { if (year > riyadhToday().year) return; setDraft({ preset: "YEAR", from: iso(year, 1, 1), to: notAfterToday(iso(year, 12, 31)), months: [] }); setCursor(`${year}-01`); };
  const clearPeriod = () => { const next = defaultBaseerPeriodRange(); onChange(next); setCursor(cursorFor(next.from)); setRangeStart(null); closePicker(false); };
  const applyPeriod = () => { onChange(draft); setRangeStart(null); closePicker(true); };
  const days = draft.preset === "DAY" || draft.preset === "RANGE" ? daysForCalendar(cursor) : [];
  const today = iso(riyadhToday().year, riyadhToday().month, riyadhToday().day);
  const focusDay = (candidate: string) => {
    if (candidate > today) return;
    setCursor(cursorFor(candidate));
    requestAnimationFrame(() => document.getElementById(`${popoverId}-day-${candidate}`)?.focus());
  };
  const onDayKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, day: string) => {
    const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
    const horizontal = language === "ar" ? -1 : 1;
    const movement = event.key === "ArrowRight" ? horizontal : event.key === "ArrowLeft" ? -horizontal : event.key === "ArrowDown" ? 7 : event.key === "ArrowUp" ? -7 : event.key === "Home" ? -weekday : event.key === "End" ? 6 - weekday : null;
    if (movement !== null) { event.preventDefault(); focusDay(shiftDay(day, movement)); }
    if (event.key === "PageUp") { event.preventDefault(); focusDay(shiftDay(day, -28)); }
    if (event.key === "PageDown") { event.preventDefault(); focusDay(shiftDay(day, 28)); }
  };
  const defaultRange = defaultBaseerPeriodRange();
  const hasCustomPeriod = value.preset !== defaultRange.preset || value.from !== defaultRange.from || value.to !== defaultRange.to || value.months.join(",") !== defaultRange.months.join(",");
  return <section ref={rootRef} className={["baseer-period-filter", className].filter(Boolean).join(" ")} aria-label={language === "ar" ? "فلترة الفترة" : "Period filter"}>
    <div className="baseer-period-filter__bar">
      <button ref={triggerRef} className="baseer-period-filter__trigger" type="button" aria-haspopup="dialog" aria-controls={open ? popoverId : undefined} aria-expanded={open} onClick={() => open ? closePicker(true) : openPicker()} onKeyDown={(event) => { if ((event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") && !open) { event.preventDefault(); openPicker(); } }}><span className="baseer-period-filter__calendar" aria-hidden="true"><BaseerCalendarIcon /></span><span className="baseer-period-filter__label">{language === "ar" ? "الفترة" : "Period"}</span><strong>{baseerPeriodLabel(value, language)}</strong></button>
      {hasCustomPeriod && <button className="baseer-period-filter__clear" type="button" onClick={clearPeriod} aria-label={language === "ar" ? "إلغاء الفلترة" : "Clear filter"} title={language === "ar" ? "إلغاء الفلترة" : "Clear filter"}>×</button>}
    </div>
    {open && <section id={popoverId} className="baseer-period-filter__popover" role="dialog" aria-modal="false" aria-label={language === "ar" ? "اختيار الفترة" : "Choose period"}>
      <header><select ref={presetRef} aria-label={language === "ar" ? "نوع الفترة" : "Period type"} value={draft.preset} onChange={(event) => setPreset(event.target.value as BaseerPeriodPreset)}>{presets.map((preset) => <option key={preset} value={preset}>{labels[language][preset]}</option>)}</select>{(draft.preset === "MONTH" || draft.preset === "QUARTER") && <input type="number" inputMode="numeric" dir="ltr" lang="en" min="1" max="9999" value={cursor.slice(0, 4)} aria-label={language === "ar" ? "السنة" : "Year"} onChange={(event) => { const year = Number(normalizeBaseerNumericInput(event.target.value)); if (Number.isInteger(year) && year >= 1 && year <= 9999) setCursor(`${String(year).padStart(4, "0")}-01`); }} />}<div className="baseer-period-filter__nav"><button type="button" onClick={() => setCursor(shiftCursor(cursor, -1))} aria-label={language === "ar" ? "السابق" : "Previous"}>‹</button><strong>{monthName(language, cursor, "short")}</strong><button type="button" onClick={() => setCursor(shiftCursor(cursor, 1))} aria-label={language === "ar" ? "التالي" : "Next"}>›</button></div></header>
      {(draft.preset === "DAY" || draft.preset === "RANGE") && <><div className="baseer-period-filter__weekdays" aria-hidden="true">{weekdays[language].map((day) => <span key={day}>{day}</span>)}</div><div className="baseer-period-filter__days">{days.map((day) => <button id={`${popoverId}-day-${day.iso}`} key={day.iso} className={[!day.inMonth ? "is-outside" : "", day.iso === draft.from || day.iso === draft.to ? "is-selected" : "", day.iso > draft.from && day.iso < draft.to ? "is-between" : "", day.iso === today ? "is-today" : ""].filter(Boolean).join(" ")} type="button" disabled={day.iso > today} aria-label={day.iso} aria-pressed={day.iso === draft.from || day.iso === draft.to} onKeyDown={(event) => onDayKeyDown(event, day.iso)} onClick={() => selectDay(day.iso)}>{day.day}</button>)}</div></>}
      {draft.preset === "MONTH" && <div className="baseer-period-filter__months">{Array.from({ length: 12 }, (_, index) => { const token = `${cursor.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`; const selected = draft.months.includes(token); return <button className={selected ? "is-selected" : ""} key={token} type="button" disabled={token > `${riyadhToday().year}-${String(riyadhToday().month).padStart(2, "0")}`} aria-pressed={selected} onClick={() => selectMonth(index + 1)}>{monthName(language, token, "short")}</button>; })}</div>}
      {draft.preset === "QUARTER" && <div className="baseer-period-filter__quarters">{[1, 2, 3, 4].map((quarter) => { const from = iso(Number(cursor.slice(0, 4)), (quarter - 1) * 3 + 1, 1); return <button key={quarter} type="button" disabled={from > today} aria-pressed={draft.preset === "QUARTER" && draft.from === from} onClick={() => selectQuarter(quarter)}>{language === "ar" ? `الربع ${quarter}` : `Q${quarter}`}</button>; })}</div>}
      {draft.preset === "YEAR" && <div className="baseer-period-filter__years">{years.map((year) => <button className={Number(draft.from.slice(0, 4)) === year ? "is-selected" : ""} key={year} type="button" disabled={year > riyadhToday().year} aria-pressed={Number(draft.from.slice(0, 4)) === year} onClick={() => selectYear(year)}><bdi dir="ltr">{formatCount(year, language)}</bdi></button>)}</div>}
      <footer><span aria-live="polite">{draft.preset === "RANGE" && rangeStart ? (language === "ar" ? "اختر تاريخ النهاية" : "Choose the end date") : baseerPeriodLabel(draft, language)}</span><div><button type="button" onClick={() => closePicker(true)}>{language === "ar" ? "إلغاء" : "Cancel"}</button><button className="baseer-period-filter__apply" type="button" onClick={applyPeriod}>{language === "ar" ? "تطبيق" : "Apply"}</button></div></footer>
    </section>}
  </section>;
}
