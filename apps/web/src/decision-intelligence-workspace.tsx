import { lazy, Suspense } from "react";

const DecisionIntelligenceWorkspaceContent = lazy(async () => {
  const module = await import("./decision-intelligence-workspace-content");
  return { default: module.DecisionIntelligenceWorkspaceContent };
});

export function DecisionIntelligenceWorkspace({ language, section, permissionCodes }: { language: "ar" | "en"; section: number; permissionCodes: readonly string[] | null }) {
  return <Suspense fallback={<section className="decision-workspace" aria-busy="true"><p role="status">{language === "ar" ? "جارٍ تحميل مركز القرار…" : "Loading Decision Intelligence…"}</p></section>}><DecisionIntelligenceWorkspaceContent language={language} section={section} permissionCodes={permissionCodes} /></Suspense>;
}
