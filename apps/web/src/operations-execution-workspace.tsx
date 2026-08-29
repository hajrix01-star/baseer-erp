import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";

const OperationsExecutionWorkspaceContent = lazy(async () => ({ default: (await import("./operations-execution-workspace-content")).OperationsExecutionWorkspaceContent }));

/** The detailed management workspace remains behind an explicit action. */
export function OperationsExecutionWorkspace({ language }: { language: Language }) {
  const text = language === "ar" ? "جارٍ تحميل ملخص العمليات…" : "Loading operations summary…";
  return <Suspense fallback={<BaseerCard aria-busy="true" role="status">{text}</BaseerCard>}><OperationsExecutionWorkspaceContent language={language} /></Suspense>;
}
