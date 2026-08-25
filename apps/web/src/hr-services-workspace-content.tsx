import { lazy, Suspense, useEffect, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import type { BaseerDataGridColumn } from "./baseer-data-grid";
import { BaseerDataGridField as BaseerDataGrid } from "./baseer-data-grid-field";
import { activeSession, type ActiveSession } from "./daily-sales-client";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { listHrEmployeeServices, type HrEmployeeServiceRecord } from "./hr-services-client";

type Language = "ar" | "en";

const HrServicesWorkspaceRuntime = lazy(() =>
  import("./hr-services-workspace-runtime").then((module) => ({
    default: module.HrServicesWorkspace,
  })),
);

function serviceEmployeeLabel(language: Language, service: HrEmployeeServiceRecord) {
  const employee = language === "ar" ? service.employee.nameAr : service.employee.nameEn ?? service.employee.nameAr;
  return employee;
}

export function HrServicesWorkspace({ language, stage }: { language: Language; stage?: string | null }) {
  const ar = language === "ar";
  const [session, setSession] = useState<ActiveSession | null>(() => activeSession());
  const [services, setServices] = useState<HrEmployeeServiceRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [openRuntime, setOpenRuntime] = useState(stage === "record-service");
  const [runtimeStage, setRuntimeStage] = useState<string | null | undefined>(stage);

  useEffect(() => {
    const current = activeSession();
    setSession(current);
    if (!current) { setLoading(false); return; }
    let cancelled = false;
    void listHrEmployeeServices(current, { pageSize: 25 })
      .then((receipt) => {
        if (!cancelled) setServices(receipt.services);
      })
      .catch(() => {
        if (!cancelled) setMessage(ar ? "تعذر تحميل خدمات الموظفين. افتح مساحة الإدارة لإعادة المحاولة." : "Employee services could not be loaded. Open management to retry.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [ar]);

  useEffect(() => {
    if (stage === "record-service") { setRuntimeStage(stage); setOpenRuntime(true); }
  }, [stage]);

  if (!session) return <DailySalesSignIn language={language} />;
  if (openRuntime) {
    return <Suspense fallback={<BaseerCard>{ar ? "جارٍ تجهيز إدارة الخدمات…" : "Preparing service management…"}</BaseerCard>}>
      <HrServicesWorkspaceRuntime language={language} stage={runtimeStage} />
    </Suspense>;
  }

  const serviceColumns: readonly BaseerDataGridColumn<HrEmployeeServiceRecord>[] = [
    { id: "employee", header: ar ? "الموظف" : "Employee", cell: (service) => serviceEmployeeLabel(language, service), width: "36%" },
    { id: "reference", header: ar ? "المرجع" : "Reference", cell: (service) => service.referenceNumber ?? "—", width: "24%", className: "baseer-data-table__numeric" },
    { id: "expiry", header: ar ? "الانتهاء" : "Expiry", cell: (service) => service.expiryDate ?? "—", width: "20%", align: "end", className: "baseer-data-table__numeric" },
    { id: "status", header: ar ? "الحالة" : "Status", cell: (service) => service.status, width: "20%", align: "end" },
  ];

  return <section className="hr-services-overview">
    <BaseerCard>
      <div className="baseer-workspace__heading">
        <div><p className="overline">{ar ? "الموارد البشرية" : "Human resources"}</p><h2>{ar ? "خدمات الموظفين" : "Employee services"}</h2></div>
        <div className="baseer-workspace__actions">
          <BaseerButton type="button" onClick={() => { setRuntimeStage("record-service"); setOpenRuntime(true); }}>{ar ? "تسجيل خدمة" : "Record service"}</BaseerButton>
          <BaseerButton type="button" variant="secondary" onClick={() => { setRuntimeStage(undefined); setOpenRuntime(true); }}>{ar ? "إدارة الخدمات" : "Manage services"}</BaseerButton>
        </div>
      </div>
      {message ? <p className="daily-sales-message error" role="alert">{message}</p> : null}
      {loading ? <p>{ar ? "جارٍ تحميل الخدمات…" : "Loading services…"}</p> : services.length ? <BaseerDataGrid ariaLabel={ar ? "سجل خدمات الموظفين" : "Employee services register"} caption={ar ? "سجل خدمات الموظفين" : "Employee services register"} columns={serviceColumns} rows={services} rowKey={(service) => service.id} /> : <p>{ar ? "لا توجد خدمات مسجلة لهذه الشركة." : "No services are recorded for this company."}</p>}
    </BaseerCard>
  </section>;
}
