import type { ReactNode } from "react";
import { BaseerCard, type BaseerCardTone } from "./baseer-card";

type SummaryMetricGridProps = {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
  role?: "list";
};

type SummaryMetricProps = {
  label: ReactNode;
  value: ReactNode;
  /** Optional, decorative visual cue. The label and value remain the source of truth. */
  icon?: ReactNode;
  accent?: "brand" | "success" | "warning" | "info" | "danger";
  tone?: BaseerCardTone;
  role?: "listitem";
};

/** A small, read-only metric used for workspace summaries—not detailed entity cards. */
export function BaseerSummaryMetricGrid({ children, className, ariaLabel, role }: SummaryMetricGridProps) {
  return <div className={["baseer-metric-grid", className].filter(Boolean).join(" ")} aria-label={ariaLabel} role={role}>{children}</div>;
}

export function BaseerSummaryMetric({ label, value, icon, accent = "brand", tone, role }: SummaryMetricProps) {
  return <BaseerCard variant="metric" padding="compact" tone={tone} role={role} contextIcon={false} className={`baseer-metric baseer-metric--${accent}`}><div className="baseer-metric__content"><small>{label}</small><strong>{value}</strong></div>{icon ? <span className={`baseer-metric__icon baseer-metric__icon--${accent}`} aria-hidden="true">{icon}</span> : null}</BaseerCard>;
}
