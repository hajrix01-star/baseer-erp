import type { ReactNode } from "react";

export type BaseerStatusTone = "neutral" | "info" | "success" | "warning" | "danger";

/** A textual, colour-supported status primitive; it never relies on colour alone. */
export function BaseerStatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: BaseerStatusTone }) {
  return <span className={`baseer-status-badge baseer-status-badge--${tone}`}><span className="baseer-status-badge__dot" aria-hidden="true" />{children}</span>;
}
