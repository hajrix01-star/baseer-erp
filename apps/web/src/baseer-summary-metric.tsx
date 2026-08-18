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
  tone?: BaseerCardTone;
  role?: "listitem";
};

/** A small, read-only metric used for workspace summaries—not detailed entity cards. */
export function BaseerSummaryMetricGrid({ children, className, ariaLabel, role }: SummaryMetricGridProps) {
  return <div className={["administration-role-cards", className].filter(Boolean).join(" ")} aria-label={ariaLabel} role={role}>{children}</div>;
}

export function BaseerSummaryMetric({ label, value, tone, role }: SummaryMetricProps) {
  return <BaseerCard padding="compact" tone={tone} role={role}><small>{label}</small><strong>{value}</strong></BaseerCard>;
}
