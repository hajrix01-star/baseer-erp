import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";
import { activeSession } from "./daily-sales-client";
import { DailySalesSignIn } from "./daily-sales-sign-in";

type Language = "ar" | "en";

const CommandCenterWorkspaceRuntime = lazy(async () => ({
  default: (await import("./command-center-workspace-runtime")).CommandCenterWorkspaceRuntime,
}));

/**
 * The command center is a live workspace. It deliberately does not first
 * build an all-or-nothing summary from unrelated financial and marketing
 * reads: each runtime panel owns its own error and retry state.
 */
export function CommandCenterWorkspaceContent({ language, permissionCodes, section = 0 }: { language: Language; permissionCodes: readonly string[] | null; section?: number }) {
  if (!activeSession()) return <DailySalesSignIn language={language} />;
  const loading = language === "ar" ? "جارٍ تحميل مركز القيادة…" : "Loading Command Center…";
  return <Suspense fallback={<BaseerCard className="command-center__loading" aria-busy="true">{loading}</BaseerCard>}><CommandCenterWorkspaceRuntime language={language} permissionCodes={permissionCodes} section={section} /></Suspense>;
}
