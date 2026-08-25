import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";
import { BaseerEmptyState } from "./baseer-workspace";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession } from "./daily-sales-client";
import { marketingIsArabic, type MarketingLanguage } from "./marketing-shared";

const MarketingCalendarWorkspaceRuntime = lazy(async () => ({ default: (await import("./marketing-calendar-workspace-runtime")).MarketingCalendarWorkspaceRuntime }));

/** Keep the permission boundary and open the authorized report directly. */
export function MarketingCalendarRoute({ language, permissionCodes }: { language: MarketingLanguage; permissionCodes: readonly string[] | null }) {
  const session = activeSession();
  const ar = marketingIsArabic(language);
  const canRead = permissionCodes?.includes("marketing.insights.read") ?? false;
  if (!session) return <DailySalesSignIn language={language} />;
  if (!canRead) return <section className="baseer-workspace"><BaseerEmptyState title={ar ? "لا تملك صلاحية عرض الأداء التسويقي" : "You cannot view marketing performance"} /></section>;
  return <Suspense fallback={<BaseerCard aria-busy="true">{ar ? "جارٍ تحميل التقويم التسويقي…" : "Loading marketing calendar…"}</BaseerCard>}><MarketingCalendarWorkspaceRuntime language={language} session={session} /></Suspense>;
}
