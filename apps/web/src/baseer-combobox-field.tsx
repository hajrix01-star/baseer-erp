import { lazy, Suspense } from "react";

import type { BaseerSearchOption } from "./baseer-select-options";

const LazyBaseerCombobox = lazy(async () => ({ default: (await import("./baseer-combobox")).BaseerCombobox }));

type Props = {
  id?: string;
  label: string;
  value: string;
  options: readonly BaseerSearchOption[];
  placeholder: string;
  disabled?: boolean;
  required?: boolean;
  scopeKey?: string;
  remoteSearch?: (query: string, signal: AbortSignal) => Promise<readonly BaseerSearchOption[]>;
  loadingLabel?: string;
  emptyLabel?: string;
  errorLabel?: string;
  searchable?: boolean;
  className?: string;
  menuClassName?: string;
  onChange: (value: string) => void;
};

/**
 * Lazy screen gateway for BaseerCombobox. Feature modules import this facade
 * so React Aria stays outside their route chunk until a selector is rendered.
 */
export function BaseerComboboxField(props: Props) {
  const selected = props.options.find((option) => option.id === props.value);
  return <Suspense fallback={<input
    id={props.id}
    className={props.className}
    aria-label={props.label}
    placeholder={props.placeholder}
    disabled={props.disabled}
    required={props.required}
    readOnly
    value={selected?.label ?? ""}
  />}><LazyBaseerCombobox {...props} /></Suspense>;
}
