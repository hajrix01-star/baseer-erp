import { DecisionIntelligenceWorkspaceRuntime } from "./decision-intelligence-workspace-runtime";

export function DecisionIntelligenceWorkspace({ language, section, permissionCodes }: { language: "ar" | "en"; section: number; permissionCodes: readonly string[] | null }) {
  return <DecisionIntelligenceWorkspaceRuntime language={language} section={section} permissionCodes={permissionCodes} />;
}
