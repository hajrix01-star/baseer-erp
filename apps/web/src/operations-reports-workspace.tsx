import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession } from "./daily-sales-client";

type Language = "ar" | "en";

const OperationsReportsWorkspaceRuntime = lazy(async () => ({ default: (await import("./operations-reports-workspace-runtime")).OperationsReportsWorkspaceRuntime }));

/** Purchase and custody reports are read-only and load directly. */
export function OperationsReportsWorkspace({ language }: { language: Language }) {
  const session = activeSession();
  const ar = language === "ar";
  if (!session) return <DailySalesSignIn language={language} />;
  return <Suspense fallback={<BaseerCard aria-busy="true">{ar ? "جارٍ تحميل تقارير العمليات…" : "Loading operations reports…"}</BaseerCard>}><OperationsReportsWorkspaceRuntime language={language} /></Suspense>;
}
