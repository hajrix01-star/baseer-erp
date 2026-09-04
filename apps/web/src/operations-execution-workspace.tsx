import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";

const OperationsExecutionWorkspaceRuntime = lazy(async () => ({ default: (await import("./operations-execution-workspace-runtime")).OperationsExecutionWorkspaceRuntime }));

/** Requests open directly; the catalog and reports remain adjacent workspace tabs. */
export function OperationsExecutionWorkspace({ language }: { language: Language }) {
  const text = language === "ar" ? "جارٍ تحميل الطلبات…" : "Loading requests…";
  return <Suspense fallback={<BaseerCard aria-busy="true" role="status">{text}</BaseerCard>}><OperationsExecutionWorkspaceRuntime language={language} /></Suspense>;
}
