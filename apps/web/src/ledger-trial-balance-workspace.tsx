import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";

const LedgerTrialBalanceWorkspaceRuntime = lazy(async () => ({ default: (await import("./ledger-trial-balance-workspace-runtime")).LedgerTrialBalanceWorkspaceRuntime }));

/** Trial balance renders directly; its runtime owns authentication and data loading. */
export function LedgerTrialBalanceWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  return <Suspense fallback={<BaseerCard aria-busy="true">{ar ? "جارٍ تحميل ميزان المراجعة…" : "Loading Trial Balance…"}</BaseerCard>}><LedgerTrialBalanceWorkspaceRuntime language={language} /></Suspense>;
}
