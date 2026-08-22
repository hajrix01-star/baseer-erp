import { lazy, Suspense } from "react";

const LazyBaseerCombobox = lazy(async () => ({ default: (await import("./baseer-combobox")).BaseerCombobox }));

export type BaseerSearchOption = { id: string; label: string; description?: string; isFavorite?: boolean };

/**
 * Compatibility entry point for existing screens.  React Aria now owns the
 * combobox, portal, focus, keyboard and mobile semantics while callers retain
 * Baseer's established value/options contract.
 */
export function BaseerSearchSelect({ id, label, value, options, placeholder, disabled, required, className, menuClassName, searchable = true, remoteSearch, scopeKey, onChange }: { id?: string; label: string; value: string; options: readonly BaseerSearchOption[]; placeholder: string; disabled?: boolean; required?: boolean; className?: string; menuClassName?: string; searchable?: boolean; remoteSearch?: (query: string) => Promise<readonly BaseerSearchOption[]>; scopeKey?: string; onChange: (value: string) => void }) {
  const english = typeof document !== "undefined" && document.documentElement.lang === "en";
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
    className={["company-session-control", className].filter(Boolean).join(" ")}
    menuClassName={menuClassName}
    remoteSearch={remoteSearch ? (query) => remoteSearch(query) : undefined}
    loadingLabel={english ? "Loading…" : "جارٍ التحميل…"}
    emptyLabel={english ? "No matching results" : "لا توجد نتائج مطابقة"}
    errorLabel={english ? "Search could not be completed" : "تعذر إتمام البحث"}
    onChange={onChange}
  /></Suspense>;
}
