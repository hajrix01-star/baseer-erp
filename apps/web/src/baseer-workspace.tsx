import type { ReactNode } from "react";

import { BaseerCard } from "./baseer-card";

export function BaseerWorkspace({ children, className }: { children: ReactNode; className?: string }) {
  return <section className={["baseer-workspace", className].filter(Boolean).join(" ")}>{children}</section>;
}

export function BaseerSectionHeader({ eyebrow, title, description, actions }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode }) {
  return <header className="baseer-section-header">
    <div className="baseer-section-header__copy">
      {eyebrow ? <p className="baseer-section-header__eyebrow">{eyebrow}</p> : null}
      <h2>{title}</h2>
      {description ? <p>{description}</p> : null}
    </div>
    {actions ? <div className="baseer-section-header__actions">{actions}</div> : null}
  </header>;
}

export function BaseerNotice({ tone = "info", title, children }: { tone?: "info" | "success" | "warning" | "danger"; title?: ReactNode; children: ReactNode }) {
  return <BaseerCard className={`baseer-notice baseer-notice--${tone}`} tone="muted"><div className="baseer-notice__icon" aria-hidden="true">{tone === "success" ? "✓" : tone === "warning" ? "!" : tone === "danger" ? "×" : "i"}</div><div>{title ? <strong>{title}</strong> : null}<div>{children}</div></div></BaseerCard>;
}

export function BaseerEmptyState({ title, description, action }: { title: ReactNode; description?: ReactNode; action?: ReactNode }) {
  return <BaseerCard className="baseer-empty-state" tone="muted"><div className="baseer-empty-state__mark" aria-hidden="true">⌁</div><div><strong>{title}</strong>{description ? <p>{description}</p> : null}{action ? <div className="baseer-empty-state__action">{action}</div> : null}</div></BaseerCard>;
}
