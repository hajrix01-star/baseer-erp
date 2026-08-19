import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

const HrFinalSettlementPanel = lazy(() => import("./hr-final-settlement-panel").then((module) => ({ default: module.HrFinalSettlementWorkspace })));

/** Keep the HR shell light; the calculator, register, dialogs, and A4 output actions load only inside this route. */
export function HrFinalSettlementWorkspace({ language }: { language: "ar" | "en" }) {
  return <Suspense fallback={<BaseerCard>{language === "ar" ? "جارٍ تحميل مكافأة نهاية الخدمة…" : "Loading end-of-service award…"}</BaseerCard>}><HrFinalSettlementPanel language={language} /></Suspense>;
}
