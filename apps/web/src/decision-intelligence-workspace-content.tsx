import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";

const DecisionIntelligenceWorkspaceRuntime = lazy(async () => ({
  default: (await import("./decision-intelligence-workspace-runtime")).DecisionIntelligenceWorkspaceRuntime,
}));

/** The decision workspace owns its own permission and loading states, so the route loads it directly. */
export function DecisionIntelligenceWorkspaceContent({ language, section, permissionCodes }: { language: Language; section: number; permissionCodes: readonly string[] | null }) {
  const loading = language === "ar" ? "جارٍ تحميل مركز القرار…" : "Loading decision center…";
  return <Suspense fallback={<BaseerCard aria-busy="true">{loading}</BaseerCard>}><DecisionIntelligenceWorkspaceRuntime language={language} section={section} permissionCodes={permissionCodes} /></Suspense>;
}
