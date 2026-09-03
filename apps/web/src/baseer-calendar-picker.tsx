import { forwardRef, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ChangeEvent, type ComponentProps, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { BaseerCalendarIcon } from "./baseer-calendar-icon";
import { calendarDays, calendarMonthName, cursorForCalendar, shiftCalendarCursor, shiftCalendarDay } from "./baseer-calendar-utils";
import { BASEER_OVERLAY_LAYER } from "./baseer-overlay-policy";
import { iso, riyadhToday } from "./baseer-period-values";
import { normalizeBaseerNumericInput, toLatinDigits } from "./number-format";
import "./baseer-calendar.css";

type Language = "ar" | "en";
type Mode = "date" | "month";
type CalendarPickerProps = Omit<ComponentProps<"input">, "type"> & {
  mode: Mode;
  language?: Language;
  label: string;
  onValueChange?: (value: string) => void;
  inputClassName?: string;
  clearable?: boolean;
};

const weekdays: Record<Language, readonly string[]> = {
  ar: ["ح", "ن", "ث", "ر", "خ", "ج", "س"],
  en: ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"],
};

function languageFor(language?: Language): Language {
  if (language) return language;
  return typeof document !== "undefined" && document.documentElement.lang.toLowerCase().startsWith("ar") ? "ar" : "en";
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function validMonth(value: string) {
  return /^\d{4}-\d{2}$/.test(value);
}

/**
 * Calendar fields are date-shaped values, not generic decimal numbers. Keep
 * their ISO separators while accepting Arabic and Persian numerals, so manual
 * entry remains readable and matches the API contract.
 */
function normalizeCalendarInput(value: string, mode: Mode) {
  const digits = toLatinDigits(value).replace(/\D/g, "").slice(0, mode === "date" ? 8 : 6);
  if (digits.length <= 4) return digits;
  if (mode === "month" || digits.length <= 6) return `${digits.slice(0, 4)}-${digits.slice(4)}`;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6)}`;
}

function dateWithinBounds(value: string, min?: string, max?: string) {
  return (!min || value >= min) && (!max || value <= max);
}

function monthWithinBounds(value: string, min?: string, max?: string) {
  return (!min || value >= min.slice(0, 7)) && (!max || value <= max.slice(0, 7));
}

function assignRef(ref: React.ForwardedRef<HTMLInputElement>, node: HTMLInputElement | null) {
  if (typeof ref === "function") ref(node);
  else if (ref) ref.current = node;
}

/**
 * Baseer's shared browser-independent calendar control. It deliberately uses
 * a text field plus an owned popover, never a native date/month input.
 */
export const BaseerCalendarPicker = forwardRef<HTMLInputElement, CalendarPickerProps>(function BaseerCalendarPicker({ mode, language: languageProp, label, value, defaultValue, onChange, onValueChange, className, inputClassName, clearable = false, min, max, disabled = false, ...inputProps }, ref) {
  const language = languageFor(languageProp);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const popoverRef = useRef<HTMLElement>(null);
  const popoverId = useId();
  const stringValue = value === undefined || value === null ? undefined : String(value);
  const minValue = min === undefined ? undefined : String(min);
  const maxValue = max === undefined ? undefined : String(max);
  const initialValue = stringValue ?? (typeof defaultValue === "string" ? defaultValue : "");
  const [open, setOpen] = useState(false);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties>();
  const [cursor, setCursor] = useState(() => cursorForCalendar(initialValue));
  const currentValue = stringValue ?? inputRef.current?.value ?? initialValue;
  const currentIsValid = mode === "date" ? validDate(currentValue) : validMonth(currentValue);
  const today = useMemo(() => iso(riyadhToday().year, riyadhToday().month, riyadhToday().day), []);
  const monthToday = today.slice(0, 7);
  const isDate = mode === "date";
  const openLabel = language === "ar" ? `فتح التقويم: ${label}` : `Open calendar: ${label}`;
  const closeLabel = language === "ar" ? "إغلاق التقويم" : "Close calendar";
  const returnToFieldLabel = language === "ar" ? "العودة إلى حقل التاريخ" : "Return to date field";
  const clearLabel = language === "ar" ? "مسح التاريخ" : "Clear date";
  const closePopover = () => {
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  useEffect(() => {
    if (!open) setCursor(cursorForCalendar(currentValue));
  }, [currentValue, open]);

  useEffect(() => {
    if (!open) return;
    const closeWhenOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        requestAnimationFrame(() => triggerRef.current?.focus());
      }
    };
    document.addEventListener("pointerdown", closeWhenOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", closeWhenOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      setPopoverStyle(undefined);
      return;
    }
    const positionPopover = () => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      const gutter = 12;
      if (window.matchMedia("(max-width: 640px)").matches) {
        setPopoverStyle({ position: "fixed", zIndex: BASEER_OVERLAY_LAYER.portalPopover, insetInline: `${gutter}px`, bottom: `${gutter}px`, maxHeight: `${Math.max(160, viewportHeight - gutter * 2)}px`, overflowY: "auto" });
        return;
      }
      const width = Math.min(296, viewportWidth - gutter * 2);
      const spaceBelow = viewportHeight - rect.bottom - gutter;
      const spaceAbove = rect.top - gutter;
      const placeAbove = spaceBelow < (isDate ? 360 : 280) && spaceAbove > spaceBelow;
      const left = document.documentElement.dir === "rtl"
        ? Math.max(gutter, Math.min(rect.right - width, viewportWidth - width - gutter))
        : Math.max(gutter, Math.min(rect.left, viewportWidth - width - gutter));
      setPopoverStyle({
        position: "fixed",
        zIndex: BASEER_OVERLAY_LAYER.portalPopover,
        width,
        maxHeight: `${Math.max(160, placeAbove ? spaceAbove : spaceBelow)}px`,
        overflowY: "auto",
        left,
        ...(placeAbove ? { bottom: Math.max(gutter, viewportHeight - rect.top + 6) } : { top: Math.min(viewportHeight - gutter, rect.bottom + 6) }),
      });
    };
    positionPopover();
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, true);
    return () => {
      window.removeEventListener("resize", positionPopover);
      window.removeEventListener("scroll", positionPopover, true);
    };
  }, [isDate, open]);

  const setInputRef = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    assignRef(ref, node);
  };

  const emitValue = (next: string) => {
    const input = inputRef.current;
    if (input) input.value = next;
    const event = { target: input, currentTarget: input } as ChangeEvent<HTMLInputElement>;
    onChange?.(event);
    onValueChange?.(next);
  };

  const selectValue = (next: string) => {
    emitValue(next);
    setCursor(cursorForCalendar(next));
    setOpen(false);
    requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const selectDate = (next: string) => {
    if (dateWithinBounds(next, minValue, maxValue)) selectValue(next);
  };

  const selectMonth = (next: string) => {
    if (monthWithinBounds(next, minValue, maxValue)) selectValue(next);
  };

  const focusDate = (candidate: string) => {
    if (!dateWithinBounds(candidate, minValue, maxValue)) return;
    setCursor(cursorForCalendar(candidate));
    requestAnimationFrame(() => document.getElementById(`${popoverId}-day-${candidate}`)?.focus());
  };

  const onDateKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, day: string) => {
    const weekday = new Date(`${day}T00:00:00.000Z`).getUTCDay();
    const horizontal = language === "ar" ? -1 : 1;
    const movement = event.key === "ArrowRight" ? horizontal : event.key === "ArrowLeft" ? -horizontal : event.key === "ArrowDown" ? 7 : event.key === "ArrowUp" ? -7 : event.key === "Home" ? -weekday : event.key === "End" ? 6 - weekday : null;
    if (movement !== null) {
      event.preventDefault();
      focusDate(shiftCalendarDay(day, movement));
    }
    if (event.key === "PageUp") {
      event.preventDefault();
      focusDate(shiftCalendarDay(day, -28));
    }
    if (event.key === "PageDown") {
      event.preventDefault();
      focusDate(shiftCalendarDay(day, 28));
    }
  };

  const days = isDate ? calendarDays(cursor) : [];
  const inputValue = stringValue === undefined ? undefined : stringValue;
  const placeholder = isDate ? "YYYY-MM-DD" : "YYYY-MM";
  const formatError = isDate
    ? (language === "ar" ? "استخدم صيغة YYYY-MM-DD" : "Use YYYY-MM-DD")
    : (language === "ar" ? "استخدم صيغة YYYY-MM" : "Use YYYY-MM");

  const popover = open ? <section ref={popoverRef} id={popoverId} className="baseer-calendar-picker__popover" style={popoverStyle} role="dialog" aria-modal="false" aria-label={label} dir={language === "ar" ? "rtl" : "ltr"}>
    <button className="baseer-calendar-picker__close" type="button" aria-label={closeLabel} onClick={closePopover}>×</button>
    <header className="baseer-calendar-picker__header">
      <button type="button" aria-label={language === "ar" ? "السابق" : "Previous"} onClick={() => setCursor(shiftCalendarCursor(cursor, isDate ? -1 : -12))}>‹</button>
      <strong>{isDate ? calendarMonthName(language, cursor, "long") : cursor.slice(0, 4)}</strong>
      <button type="button" aria-label={language === "ar" ? "التالي" : "Next"} onClick={() => setCursor(shiftCalendarCursor(cursor, isDate ? 1 : 12))}>›</button>
    </header>
    {isDate ? <>
      <div className="baseer-calendar-picker__weekdays" aria-hidden="true">{weekdays[language].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="baseer-calendar-picker__days">{days.map((day) => {
        const unavailable = !dateWithinBounds(day.iso, minValue, maxValue);
        const selected = day.iso === currentValue;
        return <button id={`${popoverId}-day-${day.iso}`} key={day.iso} className={[!day.inMonth ? "is-outside" : "", selected ? "is-selected" : "", day.iso === today ? "is-today" : ""].filter(Boolean).join(" ")} type="button" disabled={unavailable} aria-pressed={selected} aria-current={day.iso === today ? "date" : undefined} onKeyDown={(event) => onDateKeyDown(event, day.iso)} onClick={() => selectDate(day.iso)}>{day.day}</button>;
      })}</div>
      {dateWithinBounds(today, minValue, maxValue) ? <footer><button type="button" onClick={() => selectDate(today)}>{language === "ar" ? "اليوم" : "Today"}</button></footer> : null}
    </> : <div className="baseer-calendar-picker__months">{Array.from({ length: 12 }, (_, index) => {
      const month = `${cursor.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`;
      const unavailable = !monthWithinBounds(month, minValue, maxValue);
      const selected = month === currentValue;
      return <button className={selected ? "is-selected" : ""} key={month} type="button" disabled={unavailable} aria-pressed={selected} aria-current={month === monthToday ? "date" : undefined} onClick={() => selectMonth(month)}>{calendarMonthName(language, month, "short")}</button>;
    })}</div>}
    {!currentIsValid && currentValue ? <small className="baseer-calendar-picker__format-error">{formatError}</small> : null}
  </section> : null;

  return <><span ref={rootRef} className={["baseer-calendar-picker", `baseer-calendar-picker--${mode}`, clearable && currentValue ? "baseer-calendar-picker--has-clear" : "", className].filter(Boolean).join(" ")}>
    <input
      ref={setInputRef}
      {...inputProps}
      className={["baseer-calendar-picker__input", inputClassName].filter(Boolean).join(" ")}
      type="text"
      dir="ltr"
      lang="en"
      inputMode="numeric"
      placeholder={placeholder}
      value={inputValue}
      defaultValue={inputValue === undefined ? defaultValue : undefined}
      minLength={mode === "date" ? 10 : 7}
      maxLength={mode === "date" ? 10 : 7}
      pattern={mode === "date" ? "\\d{4}-\\d{2}-\\d{2}" : "\\d{4}-\\d{2}"}
      aria-label={label}
      aria-describedby={inputProps["aria-describedby"]}
      disabled={disabled}
      onChange={(event) => {
        const normalized = normalizeCalendarInput(normalizeBaseerNumericInput(event.target.value), mode);
        if (normalized !== event.target.value) event.target.value = normalized;
        onChange?.(event);
        onValueChange?.(event.target.value);
      }}
      onKeyDown={(event) => {
        inputProps.onKeyDown?.(event);
        if (event.defaultPrevented || disabled) return;
        if (event.key === "ArrowDown" || event.key === "Enter") {
          event.preventDefault();
          setCursor(cursorForCalendar(event.currentTarget.value));
          setOpen(true);
        }
      }}
    />
    <button ref={triggerRef} className="baseer-calendar-picker__trigger" type="button" disabled={disabled} aria-label={open ? returnToFieldLabel : openLabel} aria-controls={open ? popoverId : undefined} aria-expanded={open} onClick={() => {
      setCursor(cursorForCalendar(currentValue));
      setOpen((current) => !current);
    }}><BaseerCalendarIcon /></button>
    {clearable && currentValue ? <button type="button" className="baseer-calendar-picker__clear" disabled={disabled} aria-label={clearLabel} onClick={() => emitValue("")}>×</button> : null}
  </span>{popover && typeof document !== "undefined" ? createPortal(popover, document.body) : popover}</>;
});
