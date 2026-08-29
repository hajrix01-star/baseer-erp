import { CommandCenterWorkspaceRuntime } from "./command-center-workspace-runtime";
import { activeSession } from "./daily-sales-client";
import { DailySalesSignIn } from "./daily-sales-sign-in";

type Language = "ar" | "en";

/**
 * Once the Command Center route is selected, render its runtime immediately.
 * Its financial and marketing reads own their independent loading states.
 */
export function CommandCenterWorkspaceContent({ language, permissionCodes, section = 0 }: { language: Language; permissionCodes: readonly string[] | null; section?: number }) {
  if (!activeSession()) return <DailySalesSignIn language={language} />;
  return <CommandCenterWorkspaceRuntime language={language} permissionCodes={permissionCodes} section={section} />;
}
