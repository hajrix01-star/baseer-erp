import { CommandCenterWorkspaceRuntime } from "./command-center-workspace-runtime";

type Language = "ar" | "en";

/**
 * Once the Command Center route is selected, render its runtime immediately.
 * Its financial and marketing reads own their independent loading states.
 */
export function CommandCenterWorkspaceContent({ language, permissionCodes, section = 0 }: { language: Language; permissionCodes: readonly string[] | null; section?: number }) {
  return <CommandCenterWorkspaceRuntime language={language} permissionCodes={permissionCodes} section={section} />;
}
