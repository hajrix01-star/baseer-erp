import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";

const ReportsWorkspaceContent = lazy(async () => ({ default: (await import("./reports-workspace-content")).ReportsWorkspaceContent }));

/** Report navigation remains stable while its read, snapshot and export UI load on demand. */
export function ReportsWorkspace({ language, initialReport }: { language: Language; initialReport?: "trial-balance" | "cash-performance" }) {
  const text = language === "ar" ? "جارٍ تحميل التقارير المالية…" : "Loading financial reports…";
  return <Suspense fallback={<BaseerCard aria-busy="true">{text}</BaseerCard>}><ReportsWorkspaceContent language={language} initialReport={initialReport} /></Suspense>;
}
