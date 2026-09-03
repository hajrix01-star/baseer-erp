import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { BASEER_OVERLAY_LAYER } from "./baseer-overlay-policy";
import { BaseerBrand } from "./baseer-brand";
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

function drawerFocusable(panel: HTMLElement | null) {
  return Array.from(panel?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter((element) => {
    if (element.closest("[aria-hidden='true'], [inert]")) return false;
    // Browsers may still report a layout box for controls nested in a closed
    // <details>. They are not reachable in the drawer's visible navigation,
    // so including them would send the focus loop to a hidden branch.
    if (element.closest("details:not([open])")) return false;
    const style = getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && element.getClientRects().length > 0;
  });
}

/**
 * Mobile-only navigation overlay. It owns portal placement, focus, Escape,
 * backdrop dismissal and document scrolling so module workspaces keep one
 * predictable navigation experience.
 */
export function BaseerNavigationDrawer({ open, title, eyebrow, closeLabel, onClose, children }: Props) {
  const panelRef = useRef<HTMLElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = drawerFocusable(panelRef.current);
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

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const previousOverscroll = document.body.style.overscrollBehavior;
    document.body.style.overflow = "hidden";
    document.body.style.overscrollBehavior = "contain";
    const timer = window.setTimeout(() => {
      drawerFocusable(panelRef.current)[0]?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      document.body.style.overscrollBehavior = previousOverscroll;
      previousFocusRef.current?.focus();
      previousFocusRef.current = null;
    };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="mobile-drawer is-open" role="presentation" style={{ zIndex: BASEER_OVERLAY_LAYER.navigationDrawer }}>
      <div className="mobile-drawer__backdrop" aria-hidden="true" onClick={(event) => { event.preventDefault(); onClose(); }} />
      <aside ref={panelRef} className="mobile-drawer__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDownCapture={handleKeyDown}>
        <header>
          <div className="mobile-drawer__identity">
            <BaseerBrand className="mobile-drawer__brand" />
            <div className="mobile-drawer__context"><p className="overline">{eyebrow}</p><h2 id={titleId}>{title}</h2></div>
          </div>
          <button className="close-button" type="button" onClick={onClose} aria-label={closeLabel}>×</button>
        </header>
        {children}
      </aside>
    </div>,
    document.body,
  );
}
