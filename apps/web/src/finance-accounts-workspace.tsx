import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";
import { financeText } from "./finance-copy";

type Language = "ar" | "en";

const FinanceAccountsWorkspaceRuntime = lazy(async () => ({ default: (await import("./finance-accounts-workspace-runtime")).FinanceAccountsWorkspaceRuntime }));

/** The accounts workspace is opened directly; its runtime owns authentication and data loading. */
export function FinanceAccountsWorkspace({ language }: { language: Language }) {
  const text = financeText(language);
  return <Suspense fallback={<BaseerCard variant="record" aria-busy="true">{text.loading}</BaseerCard>}><FinanceAccountsWorkspaceRuntime language={language} /></Suspense>;
}
