import type { BaseerDatePickerProps } from "./baseer-date-picker";

/**
 * Native browser date semantics are the right primitive for Baseer's fixed
 * Gregorian YYYY-MM-DD business contract. They provide a labelled keyboard
 * control, min/max enforcement and mobile calendar without importing a large
 * calendar framework into every date-field interaction.
 */
export function BaseerDatePickerRuntime({ language: _language, value, onChange, label, min, max, disabled = false, clearable = false, plain = false, className }: Omit<BaseerDatePickerProps, "presentation">) {
  const clearLabel = _language === "ar" ? "مسح التاريخ" : "Clear date";
  return <span className={["baseer-date-picker", plain ? "is-plain" : "", className].filter(Boolean).join(" ")}>
    <input
      className="baseer-date-picker__input"
      type="date"
      dir="ltr"
      lang="en"
      aria-label={label}
      value={value}
      min={min}
      max={max}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
    {clearable && value ? <button type="button" className="baseer-date-picker__clear" disabled={disabled} aria-label={clearLabel} onClick={() => onChange("")}>×</button> : null}
  </span>;
}
