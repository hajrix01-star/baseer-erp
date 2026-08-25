import { forwardRef, type ComponentProps } from "react";
import { normalizeBaseerNumericInput } from "./number-format";
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
  if (typeof value === "string") return normalizeBaseerNumericInput(value);
  return Number.isFinite(value) ? String(value) : "";
}

/** Shared monetary input: accepts Arabic digits but emits ASCII/LTR text. */
export function BaseerMoneyInput({ value, onValueChange, className, ...props }: MoneyInputProps) {
  return <input {...props} className={["baseer-money-input", className].filter(Boolean).join(" ")} value={normalizeBaseerNumericInput(value)} inputMode="decimal" dir="ltr" lang="en" onChange={(event) => onValueChange(normalizeBaseerNumericInput(event.target.value))} />;
}

type IntegerInputProps = Omit<ComponentProps<"input">, "type" | "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  allowNegative?: boolean;
};

/** Shared integer input: normalizes Arabic digits and rejects decimal separators. */
export function BaseerIntegerInput({ value, onValueChange, allowNegative = false, className, ...props }: IntegerInputProps) {
  const normalize = (next: string) => normalizeBaseerNumericInput(next, { allowNegative }).replaceAll(".", "");
  return <input {...props} className={["baseer-integer-input", className].filter(Boolean).join(" ")} value={normalize(value)} inputMode="numeric" dir="ltr" lang="en" onChange={(event) => onValueChange(normalizeBaseerNumericInput(event.target.value, { allowNegative }).replaceAll(".", ""))} />;
}

type MonthPickerProps = Omit<ComponentProps<"input">, "type">;

/** Shared native month picker, with RHF refs and a single RTL/LTR visual contract. */
export const BaseerMonthPicker = forwardRef<HTMLInputElement, MonthPickerProps>(function BaseerMonthPicker({ className, ...props }, ref) {
  return <input ref={ref} {...props} className={["baseer-text-input", "baseer-month-picker", className].filter(Boolean).join(" ")} type="month" />;
});

type CheckboxProps = Omit<ComponentProps<"input">, "type">;

/** Shared checkbox preserving native semantics, refs and React Hook Form integration. */
export const BaseerCheckbox = forwardRef<HTMLInputElement, CheckboxProps>(function BaseerCheckbox({ className, ...props }, ref) {
  return <input ref={ref} {...props} className={["baseer-checkbox", className].filter(Boolean).join(" ")} type="checkbox" />;
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
