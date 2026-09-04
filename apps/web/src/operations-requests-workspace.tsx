import { lazy, Suspense, useEffect, useState } from "react";

import { BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { BaseerCard } from "./baseer-card";

type Language = "ar" | "en";
type RequestsTab = "catalog" | "requests" | "registration" | "reports";

const LazyCatalog = lazy(async () => ({ default: (await import("./operations-catalog-workspace")).OperationsCatalogWorkspace }));
const LazyExecution = lazy(async () => ({ default: (await import("./operations-execution-workspace")).OperationsExecutionWorkspace }));
const LazyRegistration = lazy(async () => ({ default: (await import("./operations-internal-registration-workspace")).OperationsInternalRegistrationWorkspace }));
const LazyReports = lazy(async () => ({ default: (await import("./operations-reports-workspace")).OperationsReportsWorkspace }));

const tabLabels: Record<Language, Record<RequestsTab, string>> = {
  ar: { catalog: "إدارة الأصناف والمخزون", requests: "الطلبات والعهدة", registration: "التسجيل الداخلي", reports: "التقارير" },
  en: { catalog: "Items & inventory", requests: "Requests & custody", registration: "Internal registration", reports: "Reports" },
};

/** One operational station: its screens are tabs, never a nested sidebar. */
export function OperationsRequestsWorkspace({ language, initialTab }: { language: Language; initialTab: RequestsTab }) {
  const [tab, setTab] = useState<RequestsTab>(initialTab);
  useEffect(() => setTab(initialTab), [initialTab]);
  const labels = tabLabels[language];
  const content = tab === "catalog" ? <LazyCatalog language={language} />
    : tab === "requests" ? <LazyExecution language={language} />
      : tab === "registration" ? <LazyRegistration language={language} />
        : <LazyReports language={language} />;
  return <section className="operations-requests-workspace" dir={language === "ar" ? "rtl" : "ltr"}>
    <BaseerWorkspaceTabs ariaLabel={language === "ar" ? "الطلبات" : "Requests"} idPrefix="operations-requests" activeId={tab} onChange={(id) => setTab(id as RequestsTab)} tabs={[
      { id: "requests", label: labels.requests },
      { id: "catalog", label: labels.catalog },
      { id: "registration", label: labels.registration },
      { id: "reports", label: labels.reports },
    ]} />
    <Suspense fallback={<BaseerCard aria-busy="true">{language === "ar" ? "جارٍ تحميل قسم الطلبات…" : "Loading requests…"}</BaseerCard>}>{content}</Suspense>
  </section>;
}
