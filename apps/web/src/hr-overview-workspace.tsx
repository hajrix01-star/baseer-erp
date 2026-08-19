import { useCallback, useEffect, useState } from "react";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerNotice, BaseerSectionHeader, BaseerWorkspace } from "./baseer-workspace";
import { activeSession, type ActiveSession } from "./daily-sales-client";
import { listHrEmployeeLeaves, listHrEmployees, listHrFinalSettlements, listHrPayrollRuns, type HrEmployeeLeavesReceipt, type HrEmployeesReceipt, type HrFinalSettlementsReceipt, type HrPayrollRunsReceipt } from "./hr-client";
import { listHrEmployeeServices, type HrEmployeeServiceRecord } from "./hr-services-client";
import { formatNumber } from "./number-format";

type Language = "ar" | "en";
type OverviewData = { employees: HrEmployeesReceipt["summary"]; payrollRuns: HrPayrollRunsReceipt["payrollRuns"]; services: HrEmployeeServiceRecord[]; leaves: HrEmployeeLeavesReceipt["leaves"]; finalSettlements: HrFinalSettlementsReceipt["settlements"] };

const emptyOverview: OverviewData = { employees: { activeEmployees: 0, employeesOnLeave: 0, openAdvances: 0, openAdministrativeDeductions: 0 }, payrollRuns: [], services: [], leaves: [], finalSettlements: [] };
const routeTo = (section: number) => { window.location.hash = `#module=hr&section=${section}`; };
const dateValue = (value: string | null) => value ? new Date(`${value}T00:00:00`).getTime() : Number.POSITIVE_INFINITY;

function serviceTypeLabel(value: HrEmployeeServiceRecord["serviceType"], language: Language) {
  const labels = { IQAMA_ISSUANCE: ["إصدار إقامة", "Iqama issuance"], IQAMA_RENEWAL: ["تجديد إقامة", "Iqama renewal"], SPONSORSHIP_TRANSFER: ["نقل كفالة", "Sponsorship transfer"], EXIT_REENTRY_VISA: ["تأشيرة خروج وعودة", "Exit/re-entry visa"], FLIGHT_TICKET: ["تذكرة طيران", "Flight ticket"], MEDICAL_INSURANCE: ["تأمين طبي", "Medical insurance"], HEALTH_CERTIFICATE: ["شهادة صحية", "Health certificate"], OTHER: ["خدمة أخرى", "Other service"] } as const;
  return labels[value][language === "ar" ? 0 : 1];
}

function payrollStatusLabel(value: HrPayrollRunsReceipt["payrollRuns"][number]["status"], language: Language) {
  const labels = { DRAFT: ["مسودة", "Draft"], APPROVED: ["معتمد", "Approved"], PARTIALLY_PAID: ["مدفوع جزئياً", "Partially paid"], PAID: ["مدفوع", "Paid"], REVERSED: ["معكوس", "Reversed"] } as const;
  return labels[value][language === "ar" ? 0 : 1];
}

function settlementStatusLabel(value: HrFinalSettlementsReceipt["settlements"][number]["status"], language: Language) {
  const labels = { DRAFT: ["مسودة", "Draft"], APPROVED: ["معتمد", "Approved"], PARTIALLY_PAID: ["مدفوع جزئياً", "Partially paid"], PAID: ["مدفوع", "Paid"], REVERSED: ["معكوس", "Reversed"], CANCELLED: ["ملغى", "Cancelled"] } as const;
  return labels[value][language === "ar" ? 0 : 1];
}

export function HrOverviewWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [data, setData] = useState<OverviewData>(emptyOverview);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const current = activeSession(); setSession(current);
    if (!current) { setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const expirationCutoff = new Date(); expirationCutoff.setDate(expirationCutoff.getDate() + 30);
      const [employees, payroll, services, leaves, settlements] = await Promise.all([
        listHrEmployees(current, { pageSize: 100 }), listHrPayrollRuns(current, { pageSize: 12 }), listHrEmployeeServices(current, { expiryBefore: expirationCutoff.toISOString().slice(0, 10), pageSize: 100 }), listHrEmployeeLeaves(current, { status: "APPROVED", pageSize: 20 }), listHrFinalSettlements(current, { pageSize: 20 }),
      ]);
      setData({ employees: employees.summary, payrollRuns: payroll.payrollRuns, services: services.services.filter((item) => item.status === "ISSUED" && item.complianceStatus === "ACTIVE"), leaves: leaves.leaves, finalSettlements: settlements.settlements });
    } catch { setError(ar ? "تعذر تحميل ملخص الموارد البشرية. حاول مرة أخرى." : "The HR overview could not be loaded. Please try again."); }
    finally { setLoading(false); }
  }, [ar]);
  useEffect(() => { void load(); }, [load]);
  if (!session) return null;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const deadline = new Date(today); deadline.setDate(deadline.getDate() + 30);
  const draftRuns = data.payrollRuns.filter((item) => item.status === "DRAFT");
  const paymentRuns = data.payrollRuns.filter((item) => item.status === "APPROVED" || item.status === "PARTIALLY_PAID");
  const overdueServices = data.services.filter((item) => dateValue(item.expiryDate) < today.getTime());
  const expiringServices = data.services.filter((item) => dateValue(item.expiryDate) >= today.getTime() && dateValue(item.expiryDate) <= deadline.getTime());
  const serviceAttention = [...overdueServices, ...expiringServices].sort((a, b) => dateValue(a.expiryDate) - dateValue(b.expiryDate));
  const pendingSettlements = data.finalSettlements.filter((item) => item.status === "DRAFT" || item.status === "APPROVED" || item.status === "PARTIALLY_PAID");
  const taskCount = draftRuns.length + paymentRuns.length + data.leaves.length + serviceAttention.length + pendingSettlements.length;
  const task = (section: number, className: string, icon: string, title: string, detail: string, count: number) => <button type="button" className={className} onClick={() => routeTo(section)}><span className="hr-overview__task-icon" aria-hidden="true">{icon}</span><span><strong>{title}</strong><small>{detail}</small></span><b>{formatNumber(count)}</b></button>;

  return <BaseerWorkspace className="hr-overview">
    <BaseerSectionHeader eyebrow={ar ? "مركز عمل الموارد البشرية" : "HR operations hub"} title={ar ? "اليوم في الموارد البشرية" : "Today in human resources"} description={ar ? "ملخص تشغيلي للمهام التي تحتاج قراراً أو متابعة، مع انتقال مباشر إلى السجل المناسب." : "An operational summary of work that needs a decision or follow-up, with direct links to the relevant register."} actions={<BaseerButton type="button" variant="primary" onClick={() => routeTo(1)}>{ar ? "إدارة الموظفين" : "Manage employees"}</BaseerButton>} />
    {error ? <BaseerNotice tone="danger" title={ar ? "تعذر التحديث" : "Unable to refresh"}>{error}<div className="hr-overview__notice-action"><BaseerButton type="button" onClick={() => void load()}>{ar ? "إعادة المحاولة" : "Try again"}</BaseerButton></div></BaseerNotice> : null}
    <section className="hr-overview__metrics" aria-label={ar ? "ملخص الموارد البشرية" : "Human resources summary"}>
      <button type="button" onClick={() => routeTo(1)}><small>{ar ? "الموظفون النشطون" : "Active employees"}</small><strong>{formatNumber(data.employees.activeEmployees)}</strong><span>{ar ? "فتح سجل الموظفين" : "Open employees"}</span></button>
      <button type="button" onClick={() => routeTo(2)}><small>{ar ? "في إجازة حالياً" : "Currently on leave"}</small><strong>{formatNumber(data.employees.employeesOnLeave)}</strong><span>{ar ? "متابعة الإجازات والعودة" : "Review leave and return"}</span></button>
      <button type="button" onClick={() => routeTo(4)}><small>{ar ? "سلف وخصومات مفتوحة" : "Open advances and deductions"}</small><strong>{formatNumber(data.employees.openAdvances + data.employees.openAdministrativeDeductions)}</strong><span>{ar ? "فتح التسويات" : "Open settlements"}</span></button>
      <button type="button" onClick={() => routeTo(3)}><small>{ar ? "مسيرات تحتاج إجراء" : "Payrolls needing action"}</small><strong>{formatNumber(draftRuns.length + paymentRuns.length)}</strong><span>{ar ? "فتح مسير الرواتب" : "Open payroll"}</span></button>
    </section>
    <section className="hr-overview__quick-actions" aria-label={ar ? "إجراءات سريعة" : "Quick actions"}><div><h3>{ar ? "إجراءات سريعة" : "Quick actions"}</h3><p>{ar ? "ابدأ العملية من السجل الصحيح ليبقى ملف الموظف وسجله المالي مترابطين." : "Start from the right register to keep the employee profile and financial history connected."}</p></div><nav><BaseerButton type="button" variant="primary" onClick={() => routeTo(1)}>{ar ? "موظف جديد" : "New employee"}</BaseerButton><BaseerButton type="button" onClick={() => routeTo(3)}>{ar ? "إنشاء مسير" : "Create payroll"}</BaseerButton><BaseerButton type="button" onClick={() => routeTo(2)}>{ar ? "تسجيل إجازة" : "Record leave"}</BaseerButton><BaseerButton type="button" onClick={() => routeTo(5)}>{ar ? "تسجيل خدمة" : "Record service"}</BaseerButton></nav></section>
    <section className="hr-overview__work" aria-label={ar ? "يحتاج إجراء" : "Needs action"}><header><div><p>{ar ? "يحتاج إجراء" : "Needs action"}</p><h3>{taskCount ? (ar ? `${formatNumber(taskCount)} عناصر بانتظار المتابعة` : `${formatNumber(taskCount)} items need follow-up`) : (ar ? "لا توجد مهام معلقة" : "No pending work")}</h3></div></header><div className="hr-overview__task-grid">
      {task(3, draftRuns.length ? "is-warning" : "", "▣", ar ? "مسيرات مسودة" : "Draft payrolls", draftRuns.length ? (ar ? "راجعها ثم اعتمدها أو احذفها." : "Review, approve, or discard them.") : (ar ? "لا توجد مسيرات مسودة." : "No draft payrolls."), draftRuns.length)}
      {task(3, paymentRuns.length ? "is-warning" : "", "₪", ar ? "رواتب بانتظار السداد" : "Payrolls awaiting payment", paymentRuns.length ? (ar ? "مسيرات معتمدة تحتاج دفعاً أو استكمال دفع." : "Approved runs need payment or completion.") : (ar ? "لا توجد رواتب بانتظار السداد." : "No payrolls await payment."), paymentRuns.length)}
      {task(5, serviceAttention.length ? "is-danger" : "", "⌁", ar ? "خدمات وإقامات قريبة الانتهاء" : "Services nearing expiry", overdueServices.length ? (ar ? `${formatNumber(overdueServices.length)} منتهية وتحتاج معالجة.` : `${formatNumber(overdueServices.length)} are already expired.`) : (ar ? "تستحق المتابعة خلال 30 يوماً." : "Need review within 30 days."), serviceAttention.length)}
      {task(2, data.leaves.length ? "is-info" : "", "◷", ar ? "إجازات مفتوحة" : "Open leave records", data.leaves.length ? (ar ? "موظفون في إجازة بانتظار تسجيل العودة." : "Employees are away pending return registration.") : (ar ? "لا توجد عودة معلقة." : "No returns are pending."), data.leaves.length)}
      {task(1, pendingSettlements.length ? "is-warning" : "", "↔", ar ? "مخالصات نهاية الخدمة" : "Final settlements", pendingSettlements.length ? (ar ? "افتح ملف الموظف لإكمال التحقق أو الاعتماد أو السداد." : "Open the employee file to verify, approve, or pay.") : (ar ? "لا توجد مخالصات مفتوحة." : "No open settlements."), pendingSettlements.length)}
    </div></section>
    <section className="hr-overview__activity">
      <BaseerCard className="hr-overview__activity-card"><header><div><h3>{ar ? "آخر مسيرات الرواتب" : "Recent payroll runs"}</h3><p>{ar ? "أحدث المسيرات المسجلة في الشركة." : "The latest payroll runs for this company."}</p></div><BaseerButton type="button" variant="quiet" onClick={() => routeTo(3)}>{ar ? "كل المسيرات" : "All payrolls"}</BaseerButton></header>{loading ? <p className="hr-overview__muted">{ar ? "جارٍ تحميل الملخص…" : "Loading summary…"}</p> : data.payrollRuns.length ? <ul>{data.payrollRuns.slice(0, 4).map((item) => <li key={item.id}><span><strong dir="ltr">{item.runNumber}</strong><small>{item.payrollMonth}</small></span><span className={`hr-overview__status hr-overview__status--${item.status.toLowerCase()}`}>{payrollStatusLabel(item.status, language)}</span></li>)}</ul> : <p className="hr-overview__muted">{ar ? "لا توجد مسيرات مسجلة بعد." : "No payroll runs have been created yet."}</p>}</BaseerCard>
      <BaseerCard className="hr-overview__activity-card"><header><div><h3>{ar ? "الأقرب في الخدمات والامتثال" : "Upcoming services and compliance"}</h3><p>{ar ? "الخدمات المنتهية أو التي تنتهي خلال 30 يوماً." : "Expired services or those expiring within 30 days."}</p></div><BaseerButton type="button" variant="quiet" onClick={() => routeTo(5)}>{ar ? "كل الخدمات" : "All services"}</BaseerButton></header>{loading ? <p className="hr-overview__muted">{ar ? "جارٍ تحميل الملخص…" : "Loading summary…"}</p> : serviceAttention.length ? <ul>{serviceAttention.slice(0, 4).map((item) => <li key={item.id}><span><strong>{item.employee.nameAr} · {serviceTypeLabel(item.serviceType, language)}</strong><small>{item.expiryDate ?? (ar ? "دون تاريخ انتهاء" : "No expiry date")}</small></span><span className={dateValue(item.expiryDate) < today.getTime() ? "hr-overview__status hr-overview__status--expired" : "hr-overview__status hr-overview__status--expiring"}>{dateValue(item.expiryDate) < today.getTime() ? (ar ? "منتهية" : "Expired") : (ar ? "قريبة" : "Upcoming")}</span></li>)}</ul> : <p className="hr-overview__muted">{ar ? "لا توجد خدمات تحتاج متابعة خلال 30 يوماً." : "No services need attention within 30 days."}</p>}</BaseerCard>
      <BaseerCard className="hr-overview__activity-card"><header><div><h3>{ar ? "مخالصات تحتاج متابعة" : "Final settlements to follow up"}</h3><p>{ar ? "تظهر هنا حتى لا تُفصل عن دورة الموظف." : "Shown here to keep them connected to the employee lifecycle."}</p></div><BaseerButton type="button" variant="quiet" onClick={() => routeTo(1)}>{ar ? "ملفات الموظفين" : "Employee files"}</BaseerButton></header>{loading ? <p className="hr-overview__muted">{ar ? "جارٍ تحميل الملخص…" : "Loading summary…"}</p> : pendingSettlements.length ? <ul>{pendingSettlements.slice(0, 4).map((item) => <li key={item.id}><span><strong dir="ltr">{item.settlementNumber}</strong><small>{item.terminationDate}</small></span><span className={`hr-overview__status hr-overview__status--${item.status.toLowerCase()}`}>{settlementStatusLabel(item.status, language)}</span></li>)}</ul> : <p className="hr-overview__muted">{ar ? "لا توجد مخالصات مفتوحة." : "No final settlements are open."}</p>}</BaseerCard>
    </section>
  </BaseerWorkspace>;
}
