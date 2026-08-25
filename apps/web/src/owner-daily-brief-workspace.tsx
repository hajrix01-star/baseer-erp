import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";

const OwnerDailyBriefWorkspaceRuntime = lazy(async () => ({ default: (await import("./owner-daily-brief-workspace-runtime")).OwnerDailyBriefWorkspaceRuntime }));

/** The saved brief is a read-only operational view, so it opens directly with the route. */
export function OwnerDailyBriefWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  return <Suspense fallback={<BaseerCard aria-busy="true">{ar ? "جارٍ تحميل دفتر المالك…" : "Loading the owner’s notebook…"}</BaseerCard>}><OwnerDailyBriefWorkspaceRuntime language={language} /></Suspense>;
}
