import { lazy, Suspense } from "react";

import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";

const HrServicesWorkspaceContent = lazy(() =>
  import("./hr-services-workspace-content").then((module) => ({
    default: module.HrServicesWorkspace,
  })),
);

export function HrServicesWorkspace({ language, stage }: { language: Language; stage?: string | null }) {
  return (
    <Suspense
      fallback={
        <BaseerCard>
          {language === "ar" ? "جارٍ تجهيز خدمات الموظفين…" : "Preparing employee services…"}
        </BaseerCard>
      }
    >
      <HrServicesWorkspaceContent language={language} stage={stage} />
    </Suspense>
  );
}
