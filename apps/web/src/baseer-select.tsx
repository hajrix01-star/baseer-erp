import { lazy, Suspense } from "react";

import type { BaseerSearchOption } from "./baseer-select-options";

const LazyBaseerCombobox = lazy(async () => ({ default: (await import("./baseer-combobox")).BaseerCombobox }));

/**
 * Lazy Baseer selection adapter for static and searchable choices. It keeps
 * React Aria out of a route until the user opens a selector.
 */
export function BaseerSelect({ id, label, value, options, placeholder, disabled, required, className, menuClassName, searchable = true, remoteSearch, scopeKey, onChange }: { id?: string; label: string; value: string; options: readonly BaseerSearchOption[]; placeholder: string; disabled?: boolean; required?: boolean; className?: string; menuClassName?: string; searchable?: boolean; remoteSearch?: (query: string, signal: AbortSignal) => Promise<readonly BaseerSearchOption[]>; scopeKey?: string; onChange: (value: string) => void }) {
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
