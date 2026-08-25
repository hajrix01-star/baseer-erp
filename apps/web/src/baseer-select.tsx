import { lazy, Suspense } from "react";

import type { BaseerComboboxProps } from "./baseer-combobox";

const LazyBaseerCombobox = lazy(async () => ({ default: (await import("./baseer-combobox")).BaseerCombobox }));

/**
 * Lazy Baseer selection adapter for static and searchable choices. It keeps
 * React Aria out of a route until the user opens a selector.
 */
export function BaseerSelect({ id, label, value, options, placeholder, disabled, required, className, menuClassName, searchable = true, remoteSearch, scopeKey, onChange }: BaseerComboboxProps) {
  return <Suspense fallback={<input id={id} className={className} aria-label={label} placeholder={placeholder} disabled={disabled} required={required} readOnly value={options.find((option) => option.id === value)?.label ?? ""} />}><LazyBaseerCombobox
    id={id}
    label={label}
    value={value}
    options={options}
    placeholder={placeholder}
    disabled={disabled}
    required={required}
    searchable={searchable}
    scopeKey={scopeKey}
    className={className}
    menuClassName={menuClassName}
    remoteSearch={remoteSearch}
    onChange={onChange}
  /></Suspense>;
}
