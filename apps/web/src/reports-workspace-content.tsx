import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";
type ReportId = "trial-balance" | "accrual-profit-loss" | "cash-performance";

const ReportsWorkspaceRuntime = lazy(async () => ({
  default: (await import("./reports-workspace-runtime")).ReportsWorkspaceRuntime,
}));

/** Financial reports render directly; their runtime owns authentication and data loading. */
export function ReportsWorkspaceContent({ language, initialReport, onReportChange }: { language: Language; initialReport?: ReportId; onReportChange?: (report: ReportId) => void }) {
  const loading = language === "ar" ? "جارٍ تجهيز التقرير…" : "Preparing report…";
  return <Suspense fallback={<BaseerCard variant="record" aria-busy="true">{loading}</BaseerCard>}><ReportsWorkspaceRuntime language={language} initialReport={initialReport} onReportChange={onReportChange} /></Suspense>;
}
