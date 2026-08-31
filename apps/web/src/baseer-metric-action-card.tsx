import type { ReactNode } from "react";

import { BaseerSectionIcon, type SectionGlyph } from "./baseer-section-icon";

export type BaseerMetricActionTone = "brand" | "success" | "warning" | "info" | "danger";
export type BaseerMetricActionLayout = "stacked" | "compact" | "hero";

/**
 * A reusable KPI that also opens a related operational workspace.  It keeps
 * the button semantics, numeric reading and icon placement consistent across
 * modules without turning every card into the same component.
 */
export function BaseerMetricActionCard({ title, value, detail, icon, tone = "brand", layout = "stacked", actionLabel, className, disabled = false, onClick }: {
  title: ReactNode;
  value: ReactNode;
  detail: ReactNode;
  icon: SectionGlyph;
  tone?: BaseerMetricActionTone;
  layout?: BaseerMetricActionLayout;
  actionLabel?: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return <button type="button" className={`baseer-metric-action-card baseer-metric-action-card--${tone} baseer-metric-action-card--${layout}${className ? ` ${className}` : ""}`} disabled={disabled} onClick={onClick}>
    <span className="baseer-metric-action-card__copy"><small>{title}</small></span>
    <strong className="baseer-metric-action-card__value">{value}</strong>
    <span className="baseer-metric-action-card__detail">{detail}</span>
    {actionLabel ? <em className="baseer-metric-action-card__action">{actionLabel}</em> : null}
    <span className="baseer-metric-action-card__icon" aria-hidden="true"><BaseerSectionIcon glyph={icon} /></span>
  </button>;
}
