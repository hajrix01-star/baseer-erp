import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type BaseerSearchOption = { id: string; label: string };

export function BaseerSearchSelect({ id, label, value, options, placeholder, disabled, required, className, onChange }: { id?: string; label: string; value: string; options: readonly BaseerSearchOption[]; placeholder: string; disabled?: boolean; required?: boolean; className?: string; onChange: (value: string) => void }) {
  const generatedId = useId();
  const inputId = id ?? `baseer-search-select-${generatedId}`;
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const suppressNextFocusOpenRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [menuStyle, setMenuStyle] = useState<React.CSSProperties>({});
  const selected = useMemo(() => options.find((option) => option.id === value), [options, value]);
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return options.filter((option) => !term || option.label.toLocaleLowerCase().includes(term));
  }, [options, query]);

  const positionMenu = () => {
    const rect = inputRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = Math.min(Math.max(rect.width, 208), window.innerWidth - 16);
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

  const menu = open ? <div ref={menuRef} id={`${inputId}-options`} className="company-session-control__menu" style={menuStyle} role="listbox" aria-label={label}>{matches.length ? matches.map((option) => <button key={option.id} type="button" role="option" aria-selected={option.id === value} className={option.id === value ? "is-active" : undefined} onClick={() => choose(option)}>{option.label}</button>) : <p className="empty-results">{placeholder}</p>}</div> : null;
  return <div ref={rootRef} className="company-session-control"><input ref={inputRef} id={inputId} className={className} style={{ paddingInlineEnd: "1.6rem" }} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${inputId}-options`} aria-label={label} autoComplete="off" disabled={disabled} required={required} value={open ? query : selected?.label ?? ""} placeholder={placeholder} onFocus={() => { if (suppressNextFocusOpenRef.current) { suppressNextFocusOpenRef.current = false; return; } setQuery(""); setOpen(true); }} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onKeyDown={(event) => { if (event.key === "Escape") { setOpen(false); setQuery(""); } else if (event.key === "Enter" && matches.length === 1) { event.preventDefault(); choose(matches[0]!); } else if (event.key === "ArrowDown") { setOpen(true); } else if (event.key === "Backspace" && !query && value && !required) { onChange(""); } }} /><span aria-hidden="true" style={{ pointerEvents: "none", position: "absolute", insetInlineEnd: ".45rem", insetBlockStart: "50%", transform: "translateY(-50%)", color: "var(--ink)", fontSize: ".75rem" }}>▾</span>{typeof document === "undefined" ? null : createPortal(menu, document.body)}</div>;
}
