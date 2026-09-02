import { useEffect, useMemo, useRef, useState } from "react";

export type BaseerFilterOption = { id: string; label: string };
type Props = { id: string; label: string; placeholder: string; values: readonly string[]; options: BaseerFilterOption[]; onChange: (values: string[]) => void };

export function BaseerFilterAutocomplete({ id, label, placeholder, values, options, onChange }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = useMemo(() => options.filter((item) => values.includes(item.id)), [options, values]);
  const displayValue = open ? query : selected.map((item) => item.label).join("، ");
  const matches = useMemo(() => {
    const term = query.trim().toLocaleLowerCase();
    return options.filter((item) => !term || item.label.toLocaleLowerCase().includes(term)).slice(0, 12);
  }, [options, query]);

  useEffect(() => {
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) { setOpen(false); setQuery(""); }
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePress);
  }, []);

  const toggle = (item: BaseerFilterOption) => {
    onChange(values.includes(item.id) ? values.filter((value) => value !== item.id) : [...values, item.id]);
    setQuery("");
  };

  return <div ref={rootRef} className="company-session-control">
    <label><span className="visually-hidden">{label}</span><input id={id} className="baseer-filter-bar__select" style={{ paddingInlineEnd: "2rem" }} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-options`} autoComplete="off" value={displayValue} placeholder={placeholder} onFocus={() => setQuery("")} onClick={() => { setQuery(""); setOpen(true); }} onChange={(event) => { setQuery(event.target.value); setOpen(true); }} onKeyDown={(event) => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setOpen(true); } if (event.key === "Escape") { setOpen(false); setQuery(""); } if (event.key === "Enter" && matches.length === 1) { event.preventDefault(); toggle(matches[0]!); } }} /></label><span aria-hidden="true" style={{ pointerEvents: "none", position: "absolute", insetInlineEnd: "0.65rem", insetBlockStart: "50%", transform: "translateY(-50%)", color: "var(--brand-deep)", fontSize: "0.8rem" }}>▾</span>
    {open ? <div id={`${id}-options`} className="company-session-control__menu" style={{ maxBlockSize: "18rem", overflowY: "auto" }} role="listbox" aria-label={label} aria-multiselectable="true">{matches.length ? matches.map((item) => <button key={item.id} type="button" role="option" aria-selected={values.includes(item.id)} className={values.includes(item.id) ? "is-active" : undefined} onClick={() => toggle(item)}>{values.includes(item.id) ? "✓ " : ""}{item.label}</button>) : <p className="empty-results">{placeholder}</p>}</div> : null}
  </div>;
}
