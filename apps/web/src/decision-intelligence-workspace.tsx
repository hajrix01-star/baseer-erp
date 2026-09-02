import { DecisionIntelligenceWorkspaceRuntime } from "./decision-intelligence-workspace-runtime";

export function DecisionIntelligenceWorkspace({ language, section, permissionCodes, migrationReviewLocked }: { language: "ar" | "en"; section: number; permissionCodes: readonly string[] | null; migrationReviewLocked: boolean }) {
  return <DecisionIntelligenceWorkspaceRuntime language={language} section={section} permissionCodes={permissionCodes} migrationReviewLocked={migrationReviewLocked} />;
}
