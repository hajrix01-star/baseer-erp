import type { ReactNode } from "react";

import { BaseerCard } from "./baseer-card";

export function BaseerWorkspace({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={["baseer-workspace", className].filter(Boolean).join(" ")}>{children}</section>;
}

/**
 * Keep workspace headers focused on the task name and available actions.
 * `description` remains part of the public contract for a gradual cleanup of
 * callers, but it is deliberately not rendered: long instructional copy does
 * not belong in the primary working surface.
 */
export function BaseerSectionHeader({ eyebrow, title, actions }: { eyebrow?: ReactNode; title?: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  if (!eyebrow && !title && !actions) return null;
  return <header className="baseer-section-header">
    {eyebrow || title ? <div className="baseer-section-header__copy">
      {eyebrow ? <p className="baseer-section-header__eyebrow">{eyebrow}</p> : null}
      {title ? <h2>{title}</h2> : null}
    </div> : null}
    {actions ? <div className="baseer-section-header__actions">{actions}</div> : null}
  </header>;
}

export function BaseerNotice({ tone = "info", title, children }: { tone?: "info" | "success" | "warning" | "danger"; title?: ReactNode; children: ReactNode }) {
  return <BaseerCard className={`baseer-notice baseer-notice--${tone}`} tone="muted"><div className="baseer-notice__icon" aria-hidden="true">{tone === "success" ? "✓" : tone === "warning" ? "!" : tone === "danger" ? "×" : "i"}</div><div>{title ? <strong>{title}</strong> : null}<div>{children}</div></div></BaseerCard>;
}

/** One operational surface for related warnings or information states.
 * Children keep their own text and actions, but never become visual cards
 * inside cards when a user needs to read them as one decision context. */
export function BaseerNoticeGroup({ children, ariaLabel }: { children: ReactNode; ariaLabel?: string }) {
  return <section className="baseer-notice-group" aria-label={ariaLabel}>{children}</section>;
}

export function BaseerEmptyState({ title, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return <BaseerCard className="baseer-empty-state" tone="muted"><div className="baseer-empty-state__mark" aria-hidden="true">⌁</div><div><strong>{title}</strong>{action ? <div className="baseer-empty-state__action">{action}</div> : null}</div></BaseerCard>;
}
