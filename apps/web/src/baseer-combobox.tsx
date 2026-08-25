import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

import { BASEER_OVERLAY_LAYER } from "./baseer-overlay-policy";
import type { BaseerSearchOption } from "./baseer-select-options";

export type BaseerComboboxProps = {
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
  invalid?: boolean;
  className?: string;
  menuClassName?: string;
  onChange: (value: string) => void;
};

/**
 * Single-select combobox with the ARIA 1.2 input/listbox contract. The input
 * retains focus while arrow keys move its active descendant; both local and
 * remote choices use the same keyboard and assistive-technology behavior.
 */
export function BaseerCombobox({ id, label, value, options, placeholder, disabled = false, required = false, scopeKey = "baseer-combobox", remoteSearch, loadingLabel, emptyLabel, errorLabel, searchable = true, invalid = false, className, menuClassName, onChange }: BaseerComboboxProps) {
  const generatedId = useId();
  const inputId = id ?? `baseer-combobox-${generatedId}`;
  const listboxId = `${inputId}-options`;
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousScope = useRef(scopeKey);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [remoteOptions, setRemoteOptions] = useState<readonly BaseerSearchOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const selected = useMemo(() => options.find((option) => option.id === value) ?? remoteOptions.find((option) => option.id === value), [options, remoteOptions, value]);
  const matches = useMemo(() => {
    const byId = new Map(options.map((option) => [option.id, option]));
    for (const option of remoteOptions) byId.set(option.id, option);
    const term = query.trim().toLocaleLowerCase();
    const filtered = [...byId.values()].filter((option) => !term || option.label.toLocaleLowerCase().includes(term));
    return selected && !filtered.some((option) => option.id === selected.id) ? [selected, ...filtered] : filtered;
  }, [options, query, remoteOptions, selected]);
  const copy = { loading: loadingLabel ?? "جارٍ التحميل…", empty: emptyLabel ?? "لا توجد نتائج مطابقة", error: errorLabel ?? "تعذر إتمام البحث" };
  const optionId = (option: BaseerSearchOption) => `${inputId}-option-${option.id}`;

  const openMenu = () => {
    if (disabled) return;
    setOpen(true);
  };
  const closeMenu = (restoreQuery = true) => {
    setOpen(false);
    if (restoreQuery) setQuery("");
    setActiveIndex(-1);
  };
  const choose = (option: BaseerSearchOption) => {
    onChange(option.id);
    closeMenu();
    inputRef.current?.focus();
  };

  useEffect(() => {
    if (!open || !remoteSearch) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setFailed(false);
      void remoteSearch(query, controller.signal)
        .then((next) => { if (!controller.signal.aborted) setRemoteOptions(next); })
        .catch(() => { if (!controller.signal.aborted) { setRemoteOptions([]); setFailed(true); } })
        .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 180);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [open, query, remoteSearch, scopeKey]);

  useEffect(() => {
    if (previousScope.current === scopeKey) return;
    previousScope.current = scopeKey;
    setRemoteOptions([]);
    setQuery("");
    setFailed(false);
    closeMenu(false);
  }, [scopeKey]);

  useEffect(() => {
    if (!open) return;
    const selectedIndex = matches.findIndex((option) => option.id === value);
    setActiveIndex((current) => current >= 0 && current < matches.length ? current : selectedIndex >= 0 ? selectedIndex : matches.length ? 0 : -1);
  }, [matches, open, value]);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) closeMenu();
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const position = () => {
      const rect = inputRef.current?.getBoundingClientRect();
      if (!rect) return;
      const width = Math.min(rect.width, window.innerWidth - 16);
      const below = window.innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const placeAbove = below < 180 && above > below;
      setMenuStyle({
        position: "fixed",
        zIndex: BASEER_OVERLAY_LAYER.portalPopover,
        width,
        maxHeight: Math.max(120, Math.min(288, (placeAbove ? above : below) - 8)),
        overflowY: "auto",
        left: document.documentElement.dir === "rtl" ? Math.max(8, rect.right - width) : Math.min(rect.left, window.innerWidth - width - 8),
        ...(placeAbove ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }),
      });
    };
    position();
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => { window.removeEventListener("resize", position); window.removeEventListener("scroll", position, true); };
  }, [open]);

  const moveActive = (direction: 1 | -1, edge?: "start" | "end") => {
    if (!matches.length) return;
    openMenu();
    setActiveIndex((current) => edge === "start" ? 0 : edge === "end" ? matches.length - 1 : current < 0 ? direction === 1 ? 0 : matches.length - 1 : (current + direction + matches.length) % matches.length);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowDown") { event.preventDefault(); moveActive(1); return; }
    if (event.key === "ArrowUp") { event.preventDefault(); moveActive(-1); return; }
    if (event.key === "Home" && open) { event.preventDefault(); moveActive(1, "start"); return; }
    if (event.key === "End" && open) { event.preventDefault(); moveActive(1, "end"); return; }
    if (event.key === "Enter" && open) {
      const active = matches[activeIndex] ?? (matches.length === 1 ? matches[0] : undefined);
      if (active) { event.preventDefault(); choose(active); }
      return;
    }
    if (event.key === "Escape" && open) { event.preventDefault(); closeMenu(); return; }
    if (event.key === "Tab") { closeMenu(); return; }
    if (searchable && (event.key === "Backspace" || event.key === "Delete") && !query && value && !required) onChange("");
  };
  const activeOption = open && activeIndex >= 0 ? matches[activeIndex] : undefined;

  return <div ref={rootRef} className={["baseer-combobox", "company-session-control", className].filter(Boolean).join(" ")}>
    <input
      ref={inputRef}
      id={inputId}
      className="baseer-combobox__input"
      role="combobox"
      aria-autocomplete={searchable ? "list" : "none"}
      aria-controls={open ? listboxId : undefined}
      aria-activedescendant={activeOption ? optionId(activeOption) : undefined}
      aria-expanded={open}
      aria-haspopup="listbox"
      aria-label={label}
      aria-invalid={invalid || undefined}
      aria-busy={loading || undefined}
      autoComplete="off"
      disabled={disabled}
      required={required}
      readOnly={!searchable}
      value={searchable && open ? query : selected?.label ?? ""}
      placeholder={placeholder}
      onClick={openMenu}
      onFocus={() => { setQuery(""); openMenu(); }}
      onChange={(event) => { if (searchable) { setQuery(event.target.value); openMenu(); } }}
      onKeyDown={onKeyDown}
    />
    <span className="baseer-combobox__trigger" aria-hidden="true">▾</span>
    {typeof document === "undefined" || !open ? null : createPortal(<div ref={menuRef} id={listboxId} style={menuStyle} className={["baseer-combobox__menu", "company-session-control__menu", menuClassName].filter(Boolean).join(" ")} role="listbox" aria-label={label} aria-busy={loading || undefined}>
      {matches.length ? matches.map((option, index) => <button
        key={option.id}
        id={optionId(option)}
        type="button"
        role="option"
        aria-selected={option.id === value}
        className={[option.id === value ? "is-active" : "", index === activeIndex ? "is-highlighted" : ""].filter(Boolean).join(" ") || undefined}
        onMouseMove={() => setActiveIndex(index)}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => choose(option)}
      ><span>{option.label}{option.description ? <small>{option.description}</small> : null}</span>{option.isFavorite ? <b aria-hidden="true">★</b> : null}</button>) : <p role="status" aria-live="polite">{loading ? copy.loading : failed ? copy.error : copy.empty}</p>}
    </div>, document.body)}
  </div>;
}
