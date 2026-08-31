import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";
type ReportId = "trial-balance" | "cash-performance";

const ReportsWorkspaceRuntime = lazy(async () => ({
  default: (await import("./reports-workspace-runtime")).ReportsWorkspaceRuntime,
}));

/** Financial reports render directly; their runtime owns authentication and data loading. */
export function ReportsWorkspaceContent({ language, initialReport }: { language: Language; initialReport?: ReportId }) {
  const loading = language === "ar" ? "جارٍ تجهيز التقرير…" : "Preparing report…";
  return <Suspense fallback={<BaseerCard variant="record" aria-busy="true">{loading}</BaseerCard>}><ReportsWorkspaceRuntime language={language} initialReport={initialReport} /></Suspense>;
}
