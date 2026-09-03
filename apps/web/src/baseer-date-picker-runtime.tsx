import type { BaseerDatePickerProps } from "./baseer-date-picker";
import { BaseerCalendarPicker } from "./baseer-calendar-picker";

/** Baseer-owned Gregorian date picker; all values remain YYYY-MM-DD. */
export function BaseerDatePickerRuntime({ language: _language, value, onChange, label, min, max, disabled = false, clearable = false, plain = false, className }: Omit<BaseerDatePickerProps, "presentation">) {
  return <BaseerCalendarPicker mode="date" language={_language} label={label} value={value} min={min} max={max} disabled={disabled} clearable={clearable} className={["baseer-date-picker", plain ? "is-plain" : "", className].filter(Boolean).join(" ")} inputClassName="baseer-date-picker__input" onValueChange={onChange} />;
}
