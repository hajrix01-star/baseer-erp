import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";

const OperationsExecutionWorkspaceRuntime = lazy(async () => ({ default: (await import("./operations-execution-workspace-runtime")).OperationsExecutionWorkspaceRuntime }));

/** The purchase-request and custody workspace opens directly for its route. */
export function OperationsExecutionWorkspace({ language }: { language: Language }) {
  const text = language === "ar" ? "جارٍ تحميل تنفيذ العمليات…" : "Loading operations execution…";
  return <Suspense fallback={<BaseerCard aria-busy="true">{text}</BaseerCard>}><OperationsExecutionWorkspaceRuntime language={language} /></Suspense>;
}
