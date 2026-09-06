import { lazy, Suspense } from "react";

import "./marketing-workspace.css";

const MarketingOverviewRoute = lazy(async () => ({ default: (await import("./marketing-overview-workspace")).MarketingOverviewRoute }));
const MarketingCampaignsWorkspace = lazy(async () => ({ default: (await import("./marketing-campaigns-workspace")).MarketingCampaignsWorkspace }));
const MarketingReputationRoute = lazy(async () => ({ default: (await import("./marketing-reputation-workspace")).MarketingReputationRoute }));
const MarketingGoogleAdsRoute = lazy(async () => ({ default: (await import("./marketing-google-ads-workspace")).MarketingGoogleAdsRoute }));
const MarketingPoliciesWorkspace = lazy(async () => ({ default: (await import("./marketing-policies-workspace")).MarketingPoliciesWorkspace }));

export function MarketingWorkspace({ language, section, permissionCodes }: { language: "ar" | "en"; section: number; permissionCodes: readonly string[] | null }) {
  const fallback = <section className="baseer-workspace" aria-busy="true"><p role="status">{language === "ar" ? "جارٍ تحميل الأداء التسويقي…" : "Loading marketing performance…"}</p></section>;
  return <Suspense fallback={fallback} key={section}>{section === 0 ? <MarketingOverviewRoute language={language} permissionCodes={permissionCodes} /> : section === 1 ? <MarketingCampaignsWorkspace language={language} permissionCodes={permissionCodes} /> : section === 2 ? <MarketingReputationRoute language={language} permissionCodes={permissionCodes} /> : section === 3 ? <MarketingGoogleAdsRoute language={language} permissionCodes={permissionCodes} /> : <MarketingPoliciesWorkspace language={language} permissionCodes={permissionCodes} />}</Suspense>;
}
