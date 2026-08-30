import { lazy, Suspense } from "react";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerApiError } from "./baseer-api-error";
import { BaseerNotice, BaseerSectionHeader, BaseerWorkspace } from "./baseer-workspace";
import { activeSession, clearActiveSession, type ActiveSession } from "./daily-sales-client";
import { getHrOverview, type HrFinalSettlementStatus, type HrOverviewReceipt, type HrPayrollStatus, type HrService } from "./hr-client";
import { formatNumber } from "./number-format";
import { hasActivePermission } from "./module-access";
import { getPageByLegacySection, pageRouteHash } from "./page-registry";
import "./hr-overview-workspace.css";

type Language = "ar" | "en";
const routeTo = (section: number, stage?: string) => {
  const page = getPageByLegacySection("hr", section);
  if (page) window.location.hash = pageRouteHash(page.id, stage);
};
const dateValue = (value: string) => new Date(`${value}T00:00:00`).getTime();
const LazyHrWorkforceStatusChart = lazy(() => import("./baseer-chart").then((module) => ({ default: module.HrWorkforceStatusChart })));

function serviceTypeLabel(value: HrService["serviceType"], language: Language) {
  const labels = { IQAMA_ISSUANCE: ["إصدار إقامة", "Iqama issuance"], IQAMA_RENEWAL: ["تجديد إقامة", "Iqama renewal"], SPONSORSHIP_TRANSFER: ["نقل كفالة", "Sponsorship transfer"], EXIT_REENTRY_VISA: ["تأشيرة خروج وعودة", "Exit/re-entry visa"], FLIGHT_TICKET: ["تذكرة طيران", "Flight ticket"], MEDICAL_INSURANCE: ["تأمين طبي", "Medical insurance"], HEALTH_CERTIFICATE: ["شهادة صحية", "Health certificate"], OTHER: ["خدمة أخرى", "Other service"] } as const;
  return labels[value][language === "ar" ? 0 : 1];
}
function payrollStatusLabel(value: HrPayrollStatus, language: Language) {
  const labels = { DRAFT: ["مسودة", "Draft"], APPROVED: ["معتمد", "Approved"], PARTIALLY_PAID: ["مدفوع جزئياً", "Partially paid"], PAID: ["مدفوع", "Paid"], REVERSED: ["ملغى", "Cancelled"] } as const;
  return labels[value][language === "ar" ? 0 : 1];
}
function settlementStatusLabel(value: HrFinalSettlementStatus, language: Language) {
  const labels = { DRAFT: ["مسودة", "Draft"], APPROVED: ["معتمد", "Approved"], PARTIALLY_PAID: ["مدفوع جزئياً", "Partially paid"], PAID: ["مدفوع", "Paid"], REVERSED: ["ملغى", "Cancelled"], CANCELLED: ["ملغى", "Cancelled"] } as const;
  return labels[value][language === "ar" ? 0 : 1];
}

export function HrOverviewWorkspace({ language }: { language: Language }) {
  const session = activeSession();
  if (!session) return null;
  return <BaseerCompanyReadQuery session={session} resource="hr-overview" load={getHrOverview}>{({ data, loading, error, refetch }) => <HrOverviewContent language={language} data={data} loading={loading} error={error} refetch={refetch} />}</BaseerCompanyReadQuery>;
}

function HrOverviewContent({ language, data, loading, error, refetch }: { language: Language; data: HrOverviewReceipt | undefined; loading: boolean; error: unknown; refetch: () => void }) {
  const ar = language === "ar";

  const workforce = data?.workforce ?? null;
  const financial = data?.financial ?? null;
  const payroll = data?.payroll ?? null;
  const services = data?.services ?? null;
  const leaves = data?.leaves ?? null;
  const finalSettlements = data?.finalSettlements ?? null;
  const financialCount = financial ? (financial.openAdvances ?? 0) + (financial.openAdministrativeDeductions ?? 0) : null;
  const payrollActionCount = payroll ? payroll.draftCount + payroll.awaitingPaymentCount : null;
  const serviceAttentionCount = services ? services.expiredCount + services.expiringCount : null;
  const taskCount = (payrollActionCount ?? 0) + (serviceAttentionCount ?? 0) + (leaves?.openCount ?? 0) + (finalSettlements?.openCount ?? 0);
  const hasTaskVisibility = Boolean(payroll || services || leaves || finalSettlements);
  const unavailable = ar ? "غير متاح ضمن صلاحياتك." : "Unavailable with your permissions.";
  const canOnboardEmployee = hasActivePermission("hr.employees.write") && hasActivePermission("hr.payroll.create");
  const canCreatePayroll = hasActivePermission("hr.payroll.create");
  const canManageLeaves = hasActivePermission("hr.leaves.manage");
  const canRecordService = hasActivePermission("hr.employees.write") && hasActivePermission("finance.purchase_expense.create");
  const hasQuickAction = canOnboardEmployee || canCreatePayroll || canManageLeaves || canRecordService;
  const companyAccessLost = error instanceof BaseerApiError && error.code === "AUTHORIZATION_DENIED";
  const countLabel = (value: number | null | undefined) => value == null ? "—" : formatNumber(value);
  const task = (section: number, className: string, icon: string, title: string, detail: string, count: number | null) => <button type="button" className={className} disabled={count == null} onClick={() => routeTo(section)}><span className="hr-overview__task-icon" aria-hidden="true">{icon}</span><span><strong>{title}</strong><small>{count == null ? unavailable : detail}</small></span><b>{countLabel(count)}</b></button>;
  const businessDateMs = data ? dateValue(data.businessDate) : Date.now();
  const workforceChartPoints = workforce ? [{ label: ar ? "موظفون نشطون" : "Active employees", value: workforce.activeEmployees }, { label: ar ? "في إجازة" : "On leave", value: workforce.employeesOnLeave }, { label: ar ? "خدمات تحتاج متابعة" : "Services needing follow-up", value: serviceAttentionCount ?? 0 }] : [];

  return <BaseerWorkspace className="hr-overview">
    <BaseerSectionHeader eyebrow={ar ? "مركز عمل الموارد البشرية" : "HR operations hub"} title={ar ? "اليوم في الموارد البشرية" : "Today in human resources"} actions={<BaseerButton type="button" variant="primary" onClick={() => routeTo(1)}>{ar ? "إدارة الموظفين" : "Manage employees"}</BaseerButton>} />
    {error ? <BaseerNotice tone="danger" title={companyAccessLost ? (ar ? "تحتاج إلى إعادة بدء الجلسة" : "Session needs to be restarted") : (ar ? "تعذر التحديث" : "Unable to refresh")}>{companyAccessLost ? (ar ? "الشركة المحفوظة في جلسة المتصفح لم تعد متاحة. أعد بدء الجلسة ثم اختر الشركة الصحيحة." : "The company saved in this browser session is no longer available. Restart the session and select the correct company.") : (ar ? "تعذر تحميل ملخص الموارد البشرية. حاول مرة أخرى." : "The HR overview could not be loaded. Please try again.")}<div className="hr-overview__notice-action">{companyAccessLost ? <BaseerButton type="button" onClick={() => { clearActiveSession(); window.location.reload(); }}>{ar ? "إعادة بدء الجلسة" : "Restart session"}</BaseerButton> : <BaseerButton type="button" onClick={refetch}>{ar ? "إعادة المحاولة" : "Try again"}</BaseerButton>}</div></BaseerNotice> : null}
    <section className="hr-overview__metrics" aria-label={ar ? "ملخص الموارد البشرية" : "Human resources summary"}>
      <button type="button" disabled={!workforce} onClick={() => routeTo(1)}><small>{ar ? "الموظفون النشطون" : "Active employees"}</small><strong>{countLabel(workforce?.activeEmployees)}</strong><span>{workforce ? (ar ? "فتح سجل الموظفين" : "Open employees") : unavailable}</span></button>
      <button type="button" disabled={!workforce} onClick={() => routeTo(2)}><small>{ar ? "في إجازة حالياً" : "Currently on leave"}</small><strong>{countLabel(workforce?.employeesOnLeave)}</strong><span>{workforce ? (ar ? "متابعة الإجازات والعودة" : "Review leave and return") : unavailable}</span></button>
      <button type="button" disabled={!financial} onClick={() => routeTo(4)}><small>{ar ? "سلف وخصومات مفتوحة" : "Open advances and deductions"}</small><strong>{countLabel(financialCount)}</strong><span>{financial ? (ar ? "فتح التسويات" : "Open settlements") : unavailable}</span></button>
      <button type="button" disabled={!payroll} onClick={() => routeTo(3)}><small>{ar ? "مسيرات تحتاج إجراء" : "Payrolls needing action"}</small><strong>{countLabel(payrollActionCount)}</strong><span>{payroll ? (ar ? "فتح مسير الرواتب" : "Open payroll") : unavailable}</span></button>
    </section>
    <section className={`hr-overview__operations${workforceChartPoints.length ? "" : " hr-overview__operations--without-chart"}`} aria-label={ar ? "اللقطة التشغيلية والمتابعة" : "Operational snapshot and follow-up"}>
      {workforceChartPoints.length ? <Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل الرسم…" : "Loading chart…"}</BaseerCard>}><LazyHrWorkforceStatusChart language={language} title={ar ? "صورة القوى العاملة اليوم" : "Today's workforce picture"} points={workforceChartPoints} asOf={data?.businessDate ?? ""} /></Suspense> : null}
      <section className="hr-overview__work" aria-label={ar ? "يحتاج إجراء" : "Needs action"}><header><div><p>{ar ? "يحتاج إجراء" : "Needs action"}</p><h3>{hasTaskVisibility ? (taskCount ? (ar ? `${formatNumber(taskCount)} عناصر بانتظار المتابعة` : `${formatNumber(taskCount)} items need follow-up`) : (ar ? "لا توجد مهام معلقة" : "No pending work")) : unavailable}</h3></div></header><div className="hr-overview__task-grid">
      {task(3, payroll?.draftCount ? "is-warning" : "", "▣", ar ? "مسيرات مسودة" : "Draft payrolls", payroll?.draftCount ? (ar ? "راجعها ثم اعتمدها أو احذفها." : "Review, approve, or discard them.") : (ar ? "لا توجد مسيرات مسودة." : "No draft payrolls."), payroll?.draftCount ?? null)}
      {task(3, payroll?.awaitingPaymentCount ? "is-warning" : "", "₪", ar ? "رواتب بانتظار السداد" : "Payrolls awaiting payment", payroll?.awaitingPaymentCount ? (ar ? "مسيرات معتمدة تحتاج دفعاً أو استكمال دفع." : "Approved runs need payment or completion.") : (ar ? "لا توجد رواتب بانتظار السداد." : "No payrolls await payment."), payroll?.awaitingPaymentCount ?? null)}
      {task(5, serviceAttentionCount ? "is-danger" : "", "⌁", ar ? "خدمات وإقامات قريبة الانتهاء" : "Services nearing expiry", services?.expiredCount ? (ar ? `${formatNumber(services.expiredCount)} منتهية وتحتاج معالجة.` : `${formatNumber(services.expiredCount)} are already expired.`) : (ar ? "تستحق المتابعة خلال 30 يوماً." : "Need review within 30 days."), serviceAttentionCount)}
      {task(2, leaves?.openCount ? "is-info" : "", "◷", ar ? "إجازات مفتوحة" : "Open leave records", leaves?.openCount ? (ar ? "موظفون في إجازة بانتظار تسجيل العودة." : "Employees are away pending return registration.") : (ar ? "لا توجد عودة معلقة." : "No returns are pending."), leaves?.openCount ?? null)}
      {task(1, finalSettlements?.openCount ? "is-warning" : "", "↔", ar ? "مخالصات نهاية الخدمة" : "Final settlements", finalSettlements?.openCount ? (ar ? "افتح ملف الموظف لإكمال التحقق أو الاعتماد أو السداد." : "Open the employee file to verify, approve, or pay.") : (ar ? "لا توجد مخالصات مفتوحة." : "No open settlements."), finalSettlements?.openCount ?? null)}
      </div></section>
    </section>
    {hasQuickAction ? <section className="hr-overview__quick-actions" aria-label={ar ? "إجراءات سريعة" : "Quick actions"}><h3>{ar ? "إجراءات سريعة" : "Quick actions"}</h3><nav>{canOnboardEmployee ? <BaseerButton type="button" variant="primary" onClick={() => routeTo(1, "new-employee")}>{ar ? "موظف جديد" : "New employee"}</BaseerButton> : null}{canCreatePayroll ? <BaseerButton type="button" onClick={() => routeTo(3, "create-payroll")}>{ar ? "إنشاء مسير" : "Create payroll"}</BaseerButton> : null}{canManageLeaves ? <BaseerButton type="button" onClick={() => routeTo(2, "record-leave")}>{ar ? "تسجيل إجازة" : "Record leave"}</BaseerButton> : null}{canRecordService ? <BaseerButton type="button" onClick={() => routeTo(5, "record-service")}>{ar ? "تسجيل خدمة" : "Record service"}</BaseerButton> : null}</nav></section> : null}
    <section className="hr-overview__activity">
      <BaseerCard className="hr-overview__activity-card"><header><h3>{ar ? "آخر مسيرات الرواتب" : "Recent payroll runs"}</h3><BaseerButton type="button" variant="quiet" onClick={() => routeTo(3)}>{ar ? "كل المسيرات" : "All payrolls"}</BaseerButton></header>{loading ? <p className="hr-overview__muted">{ar ? "جارٍ تحميل الملخص…" : "Loading summary…"}</p> : !payroll ? <p className="hr-overview__muted">{unavailable}</p> : payroll.recentRuns.length ? <ul>{payroll.recentRuns.map((item) => <li key={item.id}><span><strong dir="ltr">{item.runNumber}</strong><small>{item.payrollMonth}</small></span><span className={`hr-overview__status hr-overview__status--${item.status.toLowerCase()}`}>{payrollStatusLabel(item.status, language)}</span></li>)}</ul> : <p className="hr-overview__muted">{ar ? "لا توجد مسيرات مسجلة بعد." : "No payroll runs have been created yet."}</p>}</BaseerCard>
      <BaseerCard className="hr-overview__activity-card"><header><h3>{ar ? "الأقرب في الخدمات والامتثال" : "Upcoming services and compliance"}</h3><BaseerButton type="button" variant="quiet" onClick={() => routeTo(5)}>{ar ? "كل الخدمات" : "All services"}</BaseerButton></header>{loading ? <p className="hr-overview__muted">{ar ? "جارٍ تحميل الملخص…" : "Loading summary…"}</p> : !services ? <p className="hr-overview__muted">{unavailable}</p> : services.attentionItems.length ? <ul>{services.attentionItems.map((item) => <li key={item.id}><span><strong>{(ar ? item.employeeNameAr : item.employeeNameEn ?? item.employeeNameAr)} · {serviceTypeLabel(item.serviceType, language)}</strong><small>{item.expiryDate}</small></span><span className={dateValue(item.expiryDate) < businessDateMs ? "hr-overview__status hr-overview__status--expired" : "hr-overview__status hr-overview__status--expiring"}>{dateValue(item.expiryDate) < businessDateMs ? (ar ? "منتهية" : "Expired") : (ar ? "قريبة" : "Upcoming")}</span></li>)}</ul> : <p className="hr-overview__muted">{ar ? "لا توجد خدمات تحتاج متابعة خلال 30 يوماً." : "No services need attention within 30 days."}</p>}</BaseerCard>
      <BaseerCard className="hr-overview__activity-card"><header><h3>{ar ? "مخالصات تحتاج متابعة" : "Final settlements to follow up"}</h3><BaseerButton type="button" variant="quiet" onClick={() => routeTo(1)}>{ar ? "ملفات الموظفين" : "Employee files"}</BaseerButton></header>{loading ? <p className="hr-overview__muted">{ar ? "جارٍ تحميل الملخص…" : "Loading summary…"}</p> : !finalSettlements ? <p className="hr-overview__muted">{unavailable}</p> : finalSettlements.actionItems.length ? <ul>{finalSettlements.actionItems.map((item) => <li key={item.id}><span><strong dir="ltr">{item.settlementNumber}</strong><small>{item.terminationDate}</small></span><span className={`hr-overview__status hr-overview__status--${item.status.toLowerCase()}`}>{settlementStatusLabel(item.status, language)}</span></li>)}</ul> : <p className="hr-overview__muted">{ar ? "لا توجد مخالصات مفتوحة." : "No final settlements are open."}</p>}</BaseerCard>
    </section>
  </BaseerWorkspace>;
}
