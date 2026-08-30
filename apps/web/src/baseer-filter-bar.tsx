import { useEffect, useRef, useState, type ReactNode } from "react";

import "./baseer-filter-bar.css";
import { uiCopy, type BaseerLanguage } from "./baseer-ui-copy";

export type BaseerAppliedFilter = { id: string; label: string; onRemove: () => void };

type BaseerFilterBarProps = { className?: string; language: BaseerLanguage; search?: string; searchLabel?: string; searchPlaceholder?: string; onSearchChange?: (value: string) => void; controls?: ReactNode; controlsPresentation?: "inline" | "menu"; appliedFilters?: BaseerAppliedFilter[]; onClear?: () => void };

export function BaseerFilterBar({ className, language, search, searchLabel, searchPlaceholder, onSearchChange, controls, controlsPresentation = "inline", appliedFilters = [], onClear }: BaseerFilterBarProps) {
  const text = uiCopy(language);
  const useMenu = controlsPresentation === "menu";
  const hasSearch = search !== undefined && searchLabel !== undefined && searchPlaceholder !== undefined && onSearchChange !== undefined;
  const menuRootRef = useRef<HTMLDivElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (!useMenu || !isMenuOpen) return;
    const closeMenu = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (!menuRootRef.current?.contains(target) && !target?.closest("[data-baseer-filter-menu-portal]")) setIsMenuOpen(false);
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

  return <section className={`administration-companies-toolbar baseer-filter-bar${useMenu ? " baseer-filter-bar--odoo" : ""}${className ? ` ${className}` : ""}`} aria-label={text.filters}>
    {hasSearch ? <div ref={menuRootRef} className={`baseer-filter-bar__search${useMenu ? " baseer-period-filter" : ""}`} style={useMenu ? { display: "flex", flex: "0 1 28rem", minWidth: 0 } : undefined}><label style={{ flex: 1, minInlineSize: 0 }}><span className="visually-hidden">{searchLabel}</span><input value={search} placeholder={searchPlaceholder} style={useMenu ? { paddingInlineEnd: "7.25rem" } : undefined} onChange={(event) => onSearchChange(event.target.value)} /></label>{controls && useMenu ? <><button type="button" className="baseer-filter-bar__menu-button" aria-controls="baseer-filter-menu" aria-expanded={isMenuOpen} onClick={() => setIsMenuOpen((open) => !open)}><span aria-hidden="true">☷</span><span>{text.filters}</span></button>{isMenuOpen ? <div id="baseer-filter-menu" className="baseer-period-filter__popover" style={{ insetInlineStart: "auto", insetInlineEnd: 0 }}><div className="administration-list" style={{ gap: "2px" }}>{controls}</div></div> : null}</> : null}</div> : null}
    {controls && !useMenu ? controls : null}
    <div className="baseer-inline-actions" role="group" aria-label={text.activeFilters}>{appliedFilters.length ? <><span>{text.activeFilters}</span>{appliedFilters.map((item) => <button key={item.id} type="button" className="daily-sales-badge posted" onClick={item.onRemove}>{item.label} ×<span className="visually-hidden">{text.removeFilter}</span></button>)}{appliedFilters.length > 1 && onClear ? <button type="button" className="daily-sales-badge posted" onClick={onClear}>{text.clearFilters}</button> : null}</> : null}</div>
  </section>;
}
