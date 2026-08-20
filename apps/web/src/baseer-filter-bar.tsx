import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import "./baseer-filter-bar.css";

import { uiCopy, type BaseerLanguage } from "./baseer-ui-copy";

export type BaseerAppliedFilter = { id: string; label: string; onRemove: () => void };

type BaseerFilterBarProps = { language: BaseerLanguage; search: string; searchLabel: string; searchPlaceholder: string; onSearchChange: (value: string) => void; controls?: ReactNode; controlsPresentation?: "inline" | "menu"; appliedFilters?: BaseerAppliedFilter[]; onClear?: () => void };

export function BaseerFilterBar({ language, search, searchLabel, searchPlaceholder, onSearchChange, controls, controlsPresentation = "inline", appliedFilters = [], onClear }: BaseerFilterBarProps) {
  const text = uiCopy(language);
  const useMenu = controlsPresentation === "menu";
  const menuRootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!useMenu || !isMenuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      if (!menuRootRef.current?.contains(event.target as Node)) setIsMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [isMenuOpen, useMenu]);

  return <section className={`administration-companies-toolbar baseer-filter-bar${useMenu ? " baseer-filter-bar--odoo" : ""}`} aria-label={text.filters}>
    <div ref={menuRootRef} className={`baseer-filter-bar__search${useMenu ? " baseer-filter-bar__search--menu" : ""}`}><label><span className="visually-hidden">{searchLabel}</span><input value={search} placeholder={searchPlaceholder} onChange={(event) => onSearchChange(event.target.value)} /></label>{controls && useMenu ? <><button type="button" className="baseer-filter-bar__menu-trigger" aria-label={text.filters} aria-controls={menuId} aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen((open) => !open)}>▾</button>{isMenuOpen ? <div id={menuId} className="baseer-filter-bar__menu"><div className="baseer-filter-bar__menu-controls">{controls}</div></div> : null}</> : null}</div>
    {controls && !useMenu ? controls : null}
    <div className="baseer-inline-actions" aria-label={text.activeFilters}>{appliedFilters.length ? <><span>{text.activeFilters}</span>{appliedFilters.map((item) => <button key={item.id} type="button" className="daily-sales-badge posted" onClick={item.onRemove}>{item.label} ×<span className="visually-hidden">{text.removeFilter}</span></button>)}{appliedFilters.length > 1 && onClear ? <button type="button" className="daily-sales-badge posted" onClick={onClear}>{text.clearFilters}</button> : null}</> : null}</div>
  </section>;
}
