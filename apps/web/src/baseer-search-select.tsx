import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type BaseerSearchOption = { id: string; label: string; description?: string; isFavorite?: boolean };

export function BaseerSearchSelect({ id, label, value, options, placeholder, disabled, required, className, menuClassName, searchable = true, remoteSearch, onChange }: { id?: string; label: string; value: string; options: readonly BaseerSearchOption[]; placeholder: string; disabled?: boolean; required?: boolean; className?: string; menuClassName?: string; searchable?: boolean; remoteSearch?: (query: string) => Promise<readonly BaseerSearchOption[]>; onChange: (value: string) => void }) {
  const generatedId = useId();
  const inputId = id ?? `baseer-search-select-${generatedId}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suppressNextFocusOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [remoteOptions, setRemoteOptions] = useState<readonly BaseerSearchOption[]>([]);
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const selected = useMemo(() => options.find((option) => option.id === value) ?? remoteOptions.find((option) => option.id === value), [options, remoteOptions, value]);
  const matches = useMemo(() => {
    if (remoteSearch) return remoteOptions;
    const term = query.trim().toLocaleLowerCase();
    return options.filter((option) => !term || option.label.toLocaleLowerCase().includes(term));
  }, [options, query, remoteOptions, remoteSearch]);

  useEffect(() => {
    if (!open || !remoteSearch) return;
    let active = true;
    const timeout = window.setTimeout(() => {
      void remoteSearch(query).then((next) => { if (active) setRemoteOptions(next); }).catch(() => { if (active) setRemoteOptions([]); });
    }, 180);
    return () => { active = false; window.clearTimeout(timeout); };
  }, [open, query, remoteSearch]);

  const positionMenu = () => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(rect.width, window.innerWidth - 16);
    const below = window.innerHeight - rect.bottom - 12;
    const placeAbove = below < 180 && rect.top > below;
    setMenuStyle({ position: "fixed", zIndex: 100, width, maxHeight: Math.max(120, Math.min(288, (placeAbove ? rect.top : below) - 8)), overflowY: "auto", ...(document.documentElement.dir === "rtl" ? { left: Math.max(8, rect.right - width) } : { left: Math.min(rect.left, window.innerWidth - width - 8) }), ...(placeAbove ? { bottom: window.innerHeight - rect.top + 4 } : { top: rect.bottom + 4 }) });
  };

  useEffect(() => {
    if (!open) return;
    positionMenu();
    const updatePosition = () => positionMenu();
    const closeOnOutsidePress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !menuRef.current?.contains(target)) { setOpen(false); setQuery(""); }
    };
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
      document.removeEventListener("pointerdown", closeOnOutsidePress);
    };
  }, [open]);

  const choose = (option: BaseerSearchOption) => {
    onChange(option.id);
    setOpen(false);
    setQuery("");
    suppressNextFocusOpenRef.current = true;
    inputRef.current?.focus();
  };

  const menu = open ? <div ref={menuRef} id={`${inputId}-options`} className={["company-session-control__menu", menuClassName].filter(Boolean).join(" ")} style={menuStyle} role="listbox" aria-label={label}>{matches.length ? matches.map((option) => <button key={option.id} type="button" role="option" aria-selected={option.id === value} className={option.id === value ? "is-active" : undefined} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: ".5rem" }} onClick={() => choose(option)}><span>{option.label}{option.description ? <small>{option.description}</small> : null}</span>{option.isFavorite ? <span aria-hidden="true" style={{ color: "var(--brand)", lineHeight: 1 }}>★</span> : null}</button>) : <p className="empty-results">{placeholder}</p>}</div> : null;
  return <div ref={rootRef} className="company-session-control"><input ref={inputRef} id={inputId} className={className} style={{ paddingInlineEnd: "1.6rem" }} role="combobox" aria-autocomplete={searchable ? "list" : "none"} aria-expanded={open} aria-controls={`${inputId}-options`} aria-label={label} autoComplete="off" disabled={disabled} readOnly={!searchable} required={required} value={searchable && open ? query : selected?.label ?? ""} placeholder={placeholder} onClick={() => !searchable && setOpen(true)} onFocus={() => { if (suppressNextFocusOpenRef.current) { suppressNextFocusOpenRef.current = false; return; } if (searchable) setQuery(""); setOpen(true); }} onChange={(event) => { if (!searchable) return; setQuery(event.target.value); setOpen(true); }} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); setQuery(""); } else if (event.key === "Enter" && matches.length === 1) { event.preventDefault(); choose(matches[0]!); } else if (event.key === "ArrowDown") { setOpen(true); } else if (searchable && event.key === "Backspace" && !query && value && !required) { onChange(""); } }} /><span aria-hidden="true" style={{ pointerEvents: "none", position: "absolute", insetInlineEnd: ".45rem", insetBlockStart: "50%", transform: "translateY(-50%)", color: "var(--ink)", fontSize: ".75rem" }}>▾</span>{typeof document === "undefined" ? null : createPortal(menu, document.body)}</div>;
}
