import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { BASEER_OVERLAY_LAYER } from "./baseer-overlay-policy";
import "./baseer-navigation-drawer.css";

type Props = {
  open: boolean;
  title: string;
  eyebrow: string;
  closeLabel: string;
  onClose: () => void;
  children: ReactNode;
};

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/**
 * The only mobile navigation overlay. It owns portal placement, focus, Escape,
 * backdrop dismissal and document scrolling so individual workspaces cannot
 * drift into incompatible drawer behaviour.
 */
export function BaseerNavigationDrawer({ open, title, eyebrow, closeLabel, onClose, children }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>(focusableSelector)?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  if (!open) return null;
  return createPortal(
    <div className="mobile-drawer is-open" role="presentation" style={{ zIndex: BASEER_OVERLAY_LAYER.navigationDrawer }}>
      <div className="mobile-drawer__backdrop" aria-hidden="true" onClick={(event) => { event.preventDefault(); onClose(); }} />
      <aside ref={panelRef} className="mobile-drawer__panel" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header>
          <div><p className="overline">{eyebrow}</p><h2 id={titleId}>{title}</h2></div>
          <button className="close-button" type="button" onClick={onClose} aria-label={closeLabel}>×</button>
        </header>
        {children}
      </aside>
    </div>,
    document.body,
  );
}
