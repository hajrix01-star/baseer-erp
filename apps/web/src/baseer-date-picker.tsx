import { lazy, Suspense } from "react";

const LazyBaseerAriaDatePicker = lazy(async () => ({ default: (await import("./baseer-aria-date-picker")).BaseerAriaDatePicker }));

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

/**
 * Compatibility entry point for every existing Baseer business-date field.
 * React Aria owns focus, keyboard navigation, popover dismissal and Gregorian
 * localisation; callers retain Baseer's YYYY-MM-DD contract. `presentation`
 * remains accepted for source compatibility while the accessible popover is
 * used consistently across the application.
 */
export function BaseerDatePicker({ language, value, onChange, label, max, min, clearable = false, presentation: _presentation = "popover", plain = false, disabled = false, className }: Props) {
  return <Suspense fallback={<input className={["baseer-date-picker", className].filter(Boolean).join(" ")} aria-label={label} type="date" value={value} min={min} max={max} disabled={disabled} onChange={(event) => onChange(event.target.value)} />}><LazyBaseerAriaDatePicker language={language} value={value} onChange={onChange} label={label} min={min} max={max} disabled={disabled} clearable={clearable} plain={plain} className={["baseer-date-picker", className].filter(Boolean).join(" ")} /></Suspense>;
}
