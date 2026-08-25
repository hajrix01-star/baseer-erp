import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";

const CommandCenterWorkspaceContent = lazy(async () => ({ default: (await import("./command-center-workspace-content")).CommandCenterWorkspaceContent }));

/**
 * The command center aggregates two independently expensive live reads. Keep
 * its application shell small and defer those panels until the route is both
 * selected and authorized.
 */
export function CommandCenterWorkspace({ language, permissionCodes, section = 0 }: { language: Language; permissionCodes: readonly string[] | null; section?: number }) {
  const text = language === "ar" ? "جارٍ تحميل مركز القيادة…" : "Loading Command Center…";
  return <Suspense fallback={<BaseerCard className="command-center__loading" aria-busy="true">{text}</BaseerCard>}><CommandCenterWorkspaceContent language={language} permissionCodes={permissionCodes} section={section} /></Suspense>;
}
