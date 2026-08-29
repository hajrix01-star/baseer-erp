import { CommandCenterWorkspaceContent } from "./command-center-workspace-content";

type Language = "ar" | "en";

/**
 * The route itself remains lazy-loaded by WorkspacePageContent. Once the user
 * has selected it, its inner shell must be synchronous so live reads can start
 * immediately rather than waiting through nested Suspense boundaries.
 */
export function CommandCenterWorkspace({ language, permissionCodes, section = 0 }: { language: Language; permissionCodes: readonly string[] | null; section?: number }) {
  return <CommandCenterWorkspaceContent language={language} permissionCodes={permissionCodes} section={section} />;
}
