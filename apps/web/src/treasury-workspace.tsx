import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";
import { financeText } from "./finance-copy";

type Language = "ar" | "en";

export type { PaymentMethod, VaultForm } from "./treasury-workspace-runtime";

const TreasuryWorkspaceRuntime = lazy(async () => ({ default: (await import("./treasury-workspace-runtime")).TreasuryWorkspaceRuntime }));

/** Treasury opens directly; its runtime owns authentication and data loading. */
export function TreasuryWorkspace({ language }: { language: Language }) {
  const text = financeText(language);
  return <Suspense fallback={<BaseerCard variant="record" aria-busy="true">{text.loading}</BaseerCard>}><TreasuryWorkspaceRuntime language={language} /></Suspense>;
}
