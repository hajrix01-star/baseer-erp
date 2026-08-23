import { lazy, Suspense } from "react";

const MarketingWorkspaceContent = lazy(async () => ({ default: (await import("./marketing-workspace-content")).MarketingWorkspaceContent }));

export function MarketingWorkspace({ language, section, permissionCodes }: { language: "ar" | "en"; section: number; permissionCodes: readonly string[] | null }) {
  return <Suspense fallback={<section className="baseer-workspace" aria-busy="true"><p role="status">{language === "ar" ? "جارٍ تحميل الأداء التسويقي…" : "Loading marketing performance…"}</p></section>}><MarketingWorkspaceContent language={language} section={section} permissionCodes={permissionCodes} /></Suspense>;
}
