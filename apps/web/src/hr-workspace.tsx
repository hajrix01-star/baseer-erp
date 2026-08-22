import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";

const HrWorkspaceContent = lazy(() =>
  import("./hr-workspace-content").then((module) => ({
    default: module.HrWorkspaceCore,
  })),
);

export function HrWorkspaceCore({
  language,
  section,
  stage,
}: {
  language: Language;
  section: number;
  stage?: string | null;
}) {
  return (
    <Suspense
      fallback={
        <BaseerCard>
          {language === "ar" ? "جارٍ تجهيز سجل الموارد البشرية…" : "Preparing the HR register…"}
        </BaseerCard>
      }
    >
      <HrWorkspaceContent language={language} section={section} stage={stage} />
    </Suspense>
  );
}
