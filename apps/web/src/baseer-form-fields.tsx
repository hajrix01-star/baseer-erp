import { forwardRef, useState, type ComponentProps, type ReactNode } from "react";
import { normalizeBaseerNumericInput } from "./number-format";
import { BaseerCalendarPicker } from "./baseer-calendar-picker";
import "./baseer-form.css";
export { BaseerTextInput } from "./baseer-text-input";

type MoneyInputProps = Omit<ComponentProps<"input">, "type" | "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
};

/** @deprecated Use normalizeBaseerNumericInput for numeric fields generally. */
export function normalizeBaseerAmount(value: string) {
  return normalizeBaseerNumericInput(value);
}

/**
 * Prepares an API amount for editing without formatting, parsing or rounding
 * a decimal string. This keeps a stored value such as `12.75` intact.
 */
export function formatBaseerEditableAmount(value: string | number) {
  if (typeof value === "string") return trimEditableAmountZeros(normalizeBaseerNumericInput(value));
  return Number.isFinite(value) ? String(value) : "";
}

/** Removes insignificant trailing fractional zeros for display only; API precision is unchanged. */
export function trimEditableAmountZeros(value: string) {
  if (!/^-?\d+\.\d+$/.test(value)) return value;
  const compact = value.replace(/0+$/, "");
  return compact.endsWith(".") ? compact.slice(0, -1) : compact;
}

/** Shared monetary input: accepts Arabic digits but emits ASCII/LTR text. */
export const BaseerMoneyInput = forwardRef<HTMLInputElement, MoneyInputProps>(function BaseerMoneyInput({ value, onValueChange, className, onFocus, onBlur, ...props }, ref) {
  const [draft, setDraft] = useState<string | null>(null);
  const normalizedValue = normalizeBaseerNumericInput(value);
  return <input ref={ref} {...props} className={["baseer-money-input", className].filter(Boolean).join(" ")} value={draft ?? trimEditableAmountZeros(normalizedValue)} inputMode="decimal" dir="ltr" lang="en" onFocus={(event) => { setDraft(trimEditableAmountZeros(normalizedValue)); onFocus?.(event); }} onBlur={(event) => { const compact = trimEditableAmountZeros(normalizeBaseerNumericInput(event.target.value)); setDraft(null); if (compact !== normalizedValue) onValueChange(compact); onBlur?.(event); }} onChange={(event) => { const next = normalizeBaseerNumericInput(event.target.value); setDraft(next); onValueChange(next); }} />;
});

type IntegerInputProps = Omit<ComponentProps<"input">, "type" | "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  allowNegative?: boolean;
};

/** Shared integer input: normalizes Arabic digits and rejects decimal separators. */
export const BaseerIntegerInput = forwardRef<HTMLInputElement, IntegerInputProps>(function BaseerIntegerInput({ value, onValueChange, allowNegative = false, className, ...props }, ref) {
  const normalize = (next: string) => normalizeBaseerNumericInput(next, { allowNegative }).replaceAll(".", "");
  return <input ref={ref} {...props} className={["baseer-integer-input", className].filter(Boolean).join(" ")} value={normalize(value)} inputMode="numeric" dir="ltr" lang="en" onChange={(event) => onValueChange(normalizeBaseerNumericInput(event.target.value, { allowNegative }).replaceAll(".", ""))} />;
});

type NumericSuffixInputProps = Omit<MoneyInputProps, "className"> & {
  /** Visible unit rendered inside the same field boundary, e.g. "%" or "ساعة". */
  suffix: ReactNode;
  /** Use "integer" when decimal separators must be rejected. Defaults to money/decimal behavior. */
  kind?: "money" | "integer";
  /** Enables a leading minus sign when `kind="integer"`. */
  allowNegative?: boolean;
  /** Places the unit correctly for the surrounding reading direction. Defaults to RTL. */
  suffixDirection?: "rtl" | "ltr";
  className?: string;
  inputClassName?: string;
};

/**
 * A numeric input with a non-interactive unit inside its boundary.
 * The control remains LTR/tabular while the wrapper retains the surrounding RTL layout.
 */
export const BaseerNumericSuffixInput = forwardRef<HTMLInputElement, NumericSuffixInputProps>(function BaseerNumericSuffixInput({ suffix, kind = "money", allowNegative, suffixDirection = "rtl", className, inputClassName, ...props }, ref) {
  const Control = kind === "integer" ? BaseerIntegerInput : BaseerMoneyInput;
  return <span dir={suffixDirection} className={["baseer-numeric-suffix-input", `baseer-numeric-suffix-input--${suffixDirection}`, className].filter(Boolean).join(" ")}>
    <Control ref={ref} {...props} allowNegative={kind === "integer" ? allowNegative : undefined} className={["baseer-numeric-suffix-input__control", inputClassName].filter(Boolean).join(" ")} />
    <span className="baseer-numeric-suffix-input__suffix" aria-hidden="true">{suffix}</span>
  </span>;
});

type MonthPickerProps = Omit<ComponentProps<"input">, "type">;

/** Shared Baseer-owned month picker, preserving RHF refs and input events. */
export const BaseerMonthPicker = forwardRef<HTMLInputElement, MonthPickerProps>(function BaseerMonthPicker({ className, ...props }, ref) {
  return <BaseerCalendarPicker ref={ref} {...props} mode="month" label={props["aria-label"] ?? "Month"} inputClassName={["baseer-text-input", "baseer-month-picker", className].filter(Boolean).join(" ")} />;
});

type TimeInputProps = Omit<ComponentProps<"input">, "type">;

/** Shared native time picker with the same field, focus and RTL contract as all Baseer inputs. */
export const BaseerTimeInput = forwardRef<HTMLInputElement, TimeInputProps>(function BaseerTimeInput({ className, ...props }, ref) {
  return <input ref={ref} {...props} className={["baseer-text-input", "baseer-time-input", className].filter(Boolean).join(" ")} type="time" dir="ltr" lang="en" />;
});

type CheckboxProps = Omit<ComponentProps<"input">, "type">;

/** Shared checkbox preserving native semantics, refs and React Hook Form integration. */
export const BaseerCheckbox = forwardRef<HTMLInputElement, CheckboxProps>(function BaseerCheckbox({ className, ...props }, ref) {
  return <input ref={ref} {...props} className={["baseer-checkbox", className].filter(Boolean).join(" ")} type="checkbox" />;
});

type RadioProps = Omit<ComponentProps<"input">, "type">;

/** Shared radio input so mutually exclusive choices retain one visual and accessibility contract. */
export const BaseerRadio = forwardRef<HTMLInputElement, RadioProps>(function BaseerRadio({ className, ...props }, ref) {
  return <input ref={ref} {...props} className={["baseer-radio", className].filter(Boolean).join(" ")} type="radio" />;
});

type TextAreaProps = ComponentProps<"textarea"> & {
  onValueChange?: (value: string) => void;
  compact?: boolean;
};

/** Shared resizable text area, compatible with controlled fields, React Hook Form and focus management. */
export const BaseerTextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function BaseerTextArea({ compact = false, className, onChange, onValueChange, ...props }, ref) {
  return <textarea ref={ref} {...props} rows={props.rows ?? (compact ? 1 : 3)} className={["baseer-textarea", compact ? "baseer-textarea--compact" : "", className].filter(Boolean).join(" ")} onChange={(event) => { onChange?.(event); onValueChange?.(event.target.value); }} />;
});

type FileInputProps = Omit<ComponentProps<"input">, "type" | "className"> & {
  triggerLabel: string;
  className?: string;
};

/** Shared file trigger; file handling and validation stay with the owning form. */
export function BaseerFileInput({ triggerLabel, className, ...props }: FileInputProps) {
  return <span className={["baseer-file-input", className].filter(Boolean).join(" ")}><input {...props} className="baseer-file-input__native" type="file" /><span className="baseer-file-input__trigger">{triggerLabel}</span></span>;
}
