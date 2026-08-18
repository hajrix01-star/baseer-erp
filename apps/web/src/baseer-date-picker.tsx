import { useEffect, useId, useMemo, useRef, useState } from "react";
import { BaseerCalendarIcon } from "./baseer-calendar-icon";
import { createPortal } from "react-dom";

import { cursorFor, daysForCalendar, iso, monthName, riyadhToday, shiftCursor } from "./baseer-period-filter";

type Language = "ar" | "en";
type Props = {
  language: Language;
  value: string;
  onChange: (value: string) => void;
  label: string;
  max?: string;
  min?: string;
  clearable?: boolean;
  presentation?: "modal" | "popover";
  plain?: boolean;
  disabled?: boolean;
  className?: string;
};

const weekdays: Record<Language, readonly string[]> = { ar: ["ح", "ن", "ث", "ر", "خ", "ج", "س"], en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"] };

function dateLabel(language: Language, value: string) {
  if (!value) return language === "ar" ? "اختر التاريخ" : "Select date";
  return `${value.slice(5, 7)}/${value.slice(8, 10)}/${value.slice(0, 4)}`;
}

/** Shared single-date control. Every form uses the compact anchored calendar by default. */
export function BaseerDatePicker({ language, value, onChange, label, max, min, clearable = false, presentation = "popover", plain = false, disabled = false, className }: Props) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const dialogId = useId();
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(cursorFor(value));
  const days = useMemo(() => daysForCalendar(cursor), [cursor]);
  const { year, month, day } = riyadhToday();
  const today = iso(year, month, day);
  const invalid = (candidate: string) => Boolean((min && candidate < min) || (max && candidate > max));
  useEffect(() => {
    if (!open) return;
    const closeEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setOpen(false); triggerRef.current?.focus(); } };
    document.addEventListener("keydown", closeEscape);
    return () => document.removeEventListener("keydown", closeEscape);
  }, [open]);
  useEffect(() => {
    if (!open || presentation !== "popover") return;
    const dismissOutside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) dismiss(); };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [open, presentation]);
  const show = () => { setCursor(cursorFor(value)); setOpen(true); };
  const dismiss = () => { setOpen(false); triggerRef.current?.focus(); };
  const clear = () => { onChange(""); dismiss(); };
  const calendar = <div className="baseer-period-filter__popover" style={presentation === "modal" ? { position: "static", width: "auto", padding: 0, border: 0, boxShadow: "none" } : undefined}>
    <header className="baseer-period-filter__nav"><button type="button" onClick={() => setCursor(shiftCursor(cursor, -1))} aria-label={language === "ar" ? "الشهر السابق" : "Previous month"}>‹</button><strong>{monthName("en", cursor)}</strong><button type="button" onClick={() => setCursor(shiftCursor(cursor, 1))} aria-label={language === "ar" ? "الشهر التالي" : "Next month"}>›</button></header>
    <div className="baseer-period-filter__weekdays">{weekdays[language].map((item) => <span key={item}>{item}</span>)}</div>
    <div className="baseer-period-filter__days">{days.map((item) => <button key={item.iso} type="button" disabled={invalid(item.iso)} className={[!item.inMonth ? "is-outside" : "", item.iso === value ? "is-selected" : "", item.iso === today ? "is-today" : ""].filter(Boolean).join(" ")} onClick={() => { onChange(item.iso); dismiss(); }}>{item.day}</button>)}</div>
    {clearable ? <footer><button type="button" onClick={clear}>{language === "ar" ? "مسح" : "Clear"}</button><span>{dateLabel(language, value)}</span></footer> : null}
  </div>;
  const dialog = open && presentation === "modal" ? <div className="daily-sales-dialog-backdrop" role="presentation" onMouseDown={dismiss}>
    <section id={dialogId} className="daily-sales-dialog" role="dialog" aria-modal="true" aria-label={label} onMouseDown={(event) => event.stopPropagation()}>
      <header className="daily-sales-dialog__header"><h3>{label}</h3><button className="dialog-icon-button" type="button" aria-label={language === "ar" ? "إغلاق" : "Close"} onClick={dismiss}>×</button></header>
      {calendar}
    </section>
  </div> : null;
  return <div ref={rootRef} className={["baseer-period-filter", "baseer-date-picker", className].filter(Boolean).join(" ")}>
    <button ref={triggerRef} className="baseer-period-filter__trigger baseer-date-picker__trigger" style={plain ? { padding: 0, border: 0, background: "transparent", boxShadow: "none" } : undefined} type="button" disabled={disabled} aria-label={label} aria-expanded={open} aria-controls={open ? dialogId : undefined} onClick={show}>
      <span className="baseer-period-filter__calendar" aria-hidden="true"><BaseerCalendarIcon /></span><span className="baseer-period-filter__trigger-label">{dateLabel(language, value)}</span>
    </button>
    {open && presentation === "popover" ? <section id={dialogId} role="dialog" aria-label={label}>{calendar}</section> : null}
    {typeof document !== "undefined" && dialog ? createPortal(dialog, document.body) : null}
  </div>;
}
