import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";
import { OwnerDailyBriefWorkspace } from "./owner-daily-brief-workspace";

type Language = "ar" | "en";

const OwnerFinancialMovementWorkspace = lazy(async () => ({ default: (await import("./owner-financial-movement-workspace")).OwnerFinancialMovementWorkspace }));

/** The financial movement is intentionally first; the existing daily notebook
 * remains below it as a second owner-only section. */
export function OwnerDashboardWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  return <>
    <Suspense fallback={<BaseerCard aria-busy="true">{ar ? "جارٍ تحميل لوحة المالك…" : "Loading owner dashboard…"}</BaseerCard>}><OwnerFinancialMovementWorkspace language={language} /></Suspense>
    <OwnerDailyBriefWorkspace language={language} />
  </>;
}
