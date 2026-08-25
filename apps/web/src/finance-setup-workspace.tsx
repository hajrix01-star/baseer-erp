import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

export type { SupplierForm } from "./finance-setup-workspace-runtime";

type Language = "ar" | "en";
type FinanceSetupView = "setup" | "suppliers";

const FinanceSetupWorkspaceRuntime = lazy(async () => ({ default: (await import("./finance-setup-workspace-runtime")).FinanceSetupWorkspaceRuntime }));

/** Finance setup is a primary workspace and loads directly for its selected route. */
export function FinanceSetupWorkspace({ language, view = "setup" }: { language: Language; view?: FinanceSetupView }) {
  const text = language === "ar" ? "جارٍ تحميل إعدادات المالية…" : "Loading finance setup…";
  return <Suspense fallback={<BaseerCard aria-busy="true">{text}</BaseerCard>}><FinanceSetupWorkspaceRuntime language={language} view={view} /></Suspense>;
}
