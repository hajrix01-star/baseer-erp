import type { ComponentProps } from "react";
import { normalizeBaseerNumericInput } from "./number-format";

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

type TextAreaProps = Omit<ComponentProps<"textarea">, "onChange"> & {
  onValueChange: (value: string) => void;
  compact?: boolean;
};

/** A one-line, resizable text area for reasons and notes without oversized forms. */
export function BaseerTextArea({ compact = false, className, onValueChange, ...props }: TextAreaProps) {
  return <textarea {...props} rows={props.rows ?? (compact ? 1 : 3)} className={["baseer-textarea", compact ? "baseer-textarea--compact" : "", className].filter(Boolean).join(" ")} onChange={(event) => onValueChange(event.target.value)} />;
}
