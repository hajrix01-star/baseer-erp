import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";

const InternalVatReportWorkspaceRuntime = lazy(async () => ({ default: (await import("./internal-vat-report-workspace-runtime")).InternalVatReportWorkspaceRuntime }));

/** VAT report renders directly; its runtime owns authentication, errors and data loading. */
export function InternalVatReportWorkspace({ language, companyId }: { language: Language; companyId?: string }) {
  const ar = language === "ar";
  return <Suspense fallback={<BaseerCard aria-busy="true">{ar ? "جارٍ تحميل التقرير الضريبي…" : "Loading VAT report…"}</BaseerCard>}><InternalVatReportWorkspaceRuntime language={language} companyId={companyId} /></Suspense>;
}
