import { lazy, Suspense } from "react";

type Language = "ar" | "en";

export type BaseerDatePickerProps = {
  language: Language;
  value: string;
  onChange: (value: string) => void;
  label: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  clearable?: boolean;
  /** Legacy callers may explicitly request the only supported presentation. */
  presentation?: "popover";
  plain?: boolean;
  className?: string;
};

const LazyBaseerDatePicker = lazy(async () => ({ default: (await import("./baseer-date-picker-runtime")).BaseerDatePickerRuntime }));

/**
 * Public business-date contract. The accessible calendar implementation is
 * intentionally loaded only when a route renders a date field, keeping React
 * Aria out of the route's initial JavaScript closure.
 */
export function BaseerDatePicker({ presentation: _presentation, ...props }: BaseerDatePickerProps) {
  return <Suspense fallback={<input
    className={["baseer-date-picker__input", props.className].filter(Boolean).join(" ")}
    type="date"
    dir="ltr"
    lang="en"
    aria-label={props.label}
    disabled={props.disabled}
    value={props.value}
    min={props.min}
    max={props.max}
    onChange={(event) => props.onChange(event.target.value)}
  />}><LazyBaseerDatePicker {...props} /></Suspense>;
}
