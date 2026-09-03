import { BaseerDatePickerRuntime } from "./baseer-date-picker-runtime";

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

/** Public business-date contract, rendered through the Baseer-owned calendar. */
export function BaseerDatePicker({ presentation: _presentation, ...props }: BaseerDatePickerProps) {
  return <BaseerDatePickerRuntime {...props} />;
}
