import { lazy, Suspense } from "react";

import type { BaseerComboboxProps } from "./baseer-combobox";

const LazyBaseerCombobox = lazy(async () => ({ default: (await import("./baseer-combobox")).BaseerCombobox }));

type Props = Omit<BaseerComboboxProps, "placeholder"> & { placeholder?: string };

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
    aria-invalid={props.invalid || undefined}
    placeholder={props.placeholder}
    disabled={props.disabled}
    required={props.required}
    readOnly
    value={selected?.label ?? ""}
  />}><LazyBaseerCombobox {...props} placeholder={props.placeholder ?? ""} /></Suspense>;
}
