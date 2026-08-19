import type { ComponentProps } from "react";

type MoneyInputProps = Omit<ComponentProps<"input">, "type" | "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
};

const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
const persianDigits = "۰۱۲۳۴۵۶۷۸۹";

/**
 * Normalises keyboard input to the ASCII decimal notation used by the API.
 * The display deliberately stays LTR even inside an Arabic form so amounts
 * remain easy to scan and copy without changing the stored value.
 */
export function normalizeBaseerAmount(value: string) {
  return value
    .replace(/[٠-٩]/g, (digit) => String(arabicDigits.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String(persianDigits.indexOf(digit)))
    .replace(/[٬,\s]/g, "")
    .replace(/٫/g, ".")
    .replace(/[^0-9.]/g, "")
    .replace(/(\..*)\./g, "$1");
}

/** Formats API money for an editable field without interfering with partial input such as `1.`. */
export function formatBaseerEditableAmount(value: string | number) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
}

/** Shared monetary input: plain, compact and consistently English-numeric. */
export function BaseerMoneyInput({ value, onValueChange, className, ...props }: MoneyInputProps) {
  return <input {...props} className={["baseer-money-input", className].filter(Boolean).join(" ")} value={value} inputMode="decimal" dir="ltr" onChange={(event) => onValueChange(normalizeBaseerAmount(event.target.value))} />;
}

type TextAreaProps = Omit<ComponentProps<"textarea">, "onChange"> & {
  onValueChange: (value: string) => void;
  compact?: boolean;
};

/** A one-line, resizable text area for reasons and notes without oversized forms. */
export function BaseerTextArea({ compact = false, className, onValueChange, ...props }: TextAreaProps) {
  return <textarea {...props} rows={props.rows ?? (compact ? 1 : 3)} className={["baseer-textarea", compact ? "baseer-textarea--compact" : "", className].filter(Boolean).join(" ")} onChange={(event) => onValueChange(event.target.value)} />;
}
