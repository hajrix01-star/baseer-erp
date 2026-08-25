import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";
import { financeText } from "./finance-copy";

type Language = "ar" | "en";

const InvoiceRegisterWorkspaceRuntime = lazy(async () => ({ default: (await import("./invoice-register-workspace-runtime")).InvoiceRegisterWorkspaceRuntime }));

/** The unified register is opened directly; its runtime owns authentication and data loading. */
export function InvoiceRegisterWorkspace({ language }: { language: Language }) {
  const text = financeText(language);
  return <Suspense fallback={<BaseerCard aria-busy="true">{text.loading}</BaseerCard>}><InvoiceRegisterWorkspaceRuntime language={language} /></Suspense>;
}
