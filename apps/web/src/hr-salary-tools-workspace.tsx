import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerBatchPanel, BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerSearchSelect } from "./baseer-search-select";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { activeSession } from "./daily-sales-client";
import { getHrEmployee, listHrEmployees, type HrCompensationMethod, type HrDetail, type HrEmployee } from "./hr-client";
import { calculateSalaryTool, type SalaryToolInput } from "./hr-salary-tools-calculations";

type Language = "ar" | "en";
type Tab = "salary";

const HrCompensationAgreementDialog = lazy(async () => ({ default: (await import("./hr-compensation-agreement-dialog")).HrCompensationAgreementDialog }));
const money = (value: number) => value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const emptyDraft = (): SalaryToolInput => ({ monthlyGross: "", compensationMethod: "FIXED_MONTHLY", foodAllowance: "0", otherAllowance: "0", scheduledHoursPerDay: "", scheduledWorkDays: "" });
const labelEmployee = (language: Language, employee: HrEmployee) => `${employee.employeeNumber} · ${language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr}`;

/** Read-only salary agreement calculator. It never creates a payroll event. */
export function HrSalaryToolsWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  const [tab, setTab] = useState<Tab>("salary");
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<HrDetail | null>(null);
  const [draft, setDraft] = useState<SalaryToolInput>(emptyDraft());
  const [loadingEmployee, setLoadingEmployee] = useState(false);
  const [message, setMessage] = useState("");
  const [agreementOpen, setAgreementOpen] = useState(false);

  const loadEmployees = useCallback(async () => {
    const session = activeSession();
    if (!session) return;
    try { setEmployees((await listHrEmployees(session, { pageSize: 100 })).employees.filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE")); }
    catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تحميل الموظفين" : "Loading employees")); }
  }, [ar, language]);
  useEffect(() => { void loadEmployees(); }, [loadEmployees]);
  useEffect(() => {
    const session = activeSession();
    if (!session || !selectedEmployeeId) { setSelectedDetail(null); return; }
    setLoadingEmployee(true); setMessage("");
    void getHrEmployee(session, selectedEmployeeId).then((detail) => {
      setSelectedDetail(detail);
      const agreement = detail.compensation;
      setDraft(agreement ? {
        monthlyGross: agreement.monthlyGross,
        compensationMethod: agreement.compensationMethod,
        foodAllowance: agreement.foodAllowance,
        otherAllowance: agreement.otherAllowance,
        scheduledHoursPerDay: agreement.scheduledHoursPerDay?.toString() ?? "",
        scheduledWorkDays: agreement.scheduledWorkDays?.toString() ?? "",
      } : emptyDraft());
    }).catch((error) => setMessage(presentBaseerApiError(error, language, ar ? "تحميل اتفاق الراتب" : "Loading compensation agreement"))).finally(() => setLoadingEmployee(false));
  }, [ar, language, selectedEmployeeId]);

  const calculation = useMemo(() => calculateSalaryTool(draft), [draft]);
  const setField = <Key extends keyof SalaryToolInput>(key: Key, value: SalaryToolInput[Key]) => setDraft((current) => ({ ...current, [key]: value }));
  const errorMessage = calculation.error === "ALLOWANCES_EXCEED_GROSS"
    ? (ar ? "الإجمالي المتفق عليه يجب أن يكون أكبر من البدلات الثابتة." : "The agreed total must exceed fixed allowances.")
    : calculation.error === "INCLUSIVE_SCHEDULE_REQUIRED"
      ? (ar ? "الاتفاق الشامل للأوفر تايم يتطلب ساعات متفقاً عليها (9–12) وأيام عمل شهرية (1–31)." : "An inclusive-overtime agreement needs agreed daily hours (9–12) and monthly working days (1–31).")
      : calculation.error === "INCLUSIVE_TOTAL_TOO_LOW"
        ? (ar ? "الإجمالي المتفق عليه لا يغطي البدلات والجدول المختار." : "The agreed total cannot cover the selected allowances and schedule.")
        : "";

  return <section className="administration-workspace">
    <BaseerWorkspaceTabs ariaLabel={ar ? "تبويبات أدوات الراتب" : "Salary tools tabs"} idPrefix="hr-salary-tools" activeId={tab} onChange={(value) => setTab(value as Tab)} tabs={[{ id: "salary", label: ar ? "حاسبة الراتب" : "Salary calculator" }]} />
    <BaseerBatchPanel id="hr-salary-tools-panel-salary" labelledBy="hr-salary-tools-salary">
      <div className="administration-section-heading"><div><h2>{ar ? "حاسبة اتفاق الراتب" : "Salary agreement calculator"}</h2><p>{ar ? "معاينة تفسيرية لمعادلة اتفاق الراتب القياسية. لا تتصل بالحضور أو الانصراف ولا تُنشئ قيداً أو مسير رواتب." : "An explanatory preview of the standard salary-agreement formula. It has no attendance integration and never creates a journal or payroll run."}</p></div></div>
      {message ? <BaseerCard>{message}</BaseerCard> : null}
      <div className="administration-form">
        <label>{ar ? "الموظف (اختياري)" : "Employee (optional)"}<BaseerSearchSelect label={ar ? "الموظف" : "Employee"} value={selectedEmployeeId} placeholder={ar ? "حساب يدوي أو اختر موظفاً" : "Manual calculation or select an employee"} options={employees.map((employee) => ({ id: employee.id, label: labelEmployee(language, employee) }))} onChange={setSelectedEmployeeId} /></label>
        <label>{ar ? "طريقة الاتفاق" : "Agreement method"}<select value={draft.compensationMethod} onChange={(event) => setField("compensationMethod", event.target.value as HrCompensationMethod)}><option value="FIXED_MONTHLY">{ar ? "راتب شهري ثابت" : "Fixed monthly salary"}</option><option value="INCLUSIVE_OVERTIME">{ar ? "إجمالي شامل الأوفر تايم" : "Inclusive overtime total"}</option></select></label>
        <label>{ar ? "الإجمالي الشهري المتفق عليه" : "Agreed monthly total"}<input inputMode="decimal" value={draft.monthlyGross} onChange={(event) => setField("monthlyGross", event.target.value)} /></label>
        <label>{ar ? "بدل الأكل الشهري" : "Monthly food allowance"}<input inputMode="decimal" value={draft.foodAllowance} onChange={(event) => setField("foodAllowance", event.target.value)} /></label>
        <label>{ar ? "بدلات ثابتة أخرى" : "Other fixed allowances"}<input inputMode="decimal" value={draft.otherAllowance} onChange={(event) => setField("otherAllowance", event.target.value)} /></label>
        {draft.compensationMethod === "INCLUSIVE_OVERTIME" ? <><label>{ar ? "ساعات الدوام المتفق عليها يومياً" : "Agreed daily hours"}<input type="number" min="9" max="12" value={draft.scheduledHoursPerDay} onChange={(event) => setField("scheduledHoursPerDay", event.target.value)} /></label><label>{ar ? "أيام العمل المتفق عليها شهرياً" : "Agreed monthly working days"}<input type="number" min="1" max="31" value={draft.scheduledWorkDays} onChange={(event) => setField("scheduledWorkDays", event.target.value)} /></label></> : null}
      </div>
      {loadingEmployee ? <BaseerCard>{ar ? "جارٍ تحميل اتفاق الموظف…" : "Loading employee agreement…"}</BaseerCard> : null}
      {errorMessage ? <BaseerCard tone="muted">{errorMessage}</BaseerCard> : null}
      {calculation.valid ? <><BaseerSummaryMetricGrid ariaLabel={ar ? "نتيجة حاسبة الراتب" : "Salary calculator result"}>
        <BaseerSummaryMetric label={ar ? "الإجمالي الشهري" : "Monthly total"} value={money(calculation.monthlyGross)} />
        <BaseerSummaryMetric label={ar ? "الراتب الأساسي" : "Basic salary"} value={money(calculation.basicSalary)} />
        <BaseerSummaryMetric label={ar ? "البدلات الثابتة" : "Fixed allowances"} value={money(calculation.fixedAllowances)} />
        <BaseerSummaryMetric label={ar ? "مكوّن الأوفر تايم" : "Overtime component"} value={money(calculation.overtimeAmount)} />
        {calculation.overtimeHours > 0 ? <BaseerSummaryMetric label={ar ? "ساعات أوفر تايم الاتفاق" : "Agreement overtime hours"} value={calculation.overtimeHours.toLocaleString("en-US", { maximumFractionDigits: 2 })} /> : null}
      </BaseerSummaryMetricGrid><BaseerCard><strong>{ar ? "حدود هذه المعاينة" : "Preview boundary"}</strong><p>{ar ? "يُشتق الأوفر تايم من جدول الاتفاق فقط، ولا يثبت ساعات عمل فعلية أو غياباً أو إجازة. عند إنشاء المسير، يعيد الخادم حساب الاتفاق الساري ويثبت لقطة مستقلة لكل مسير." : "Overtime is derived only from the agreed schedule; it does not prove actual worked hours, absence, or leave. When a payroll run is created, the server recalculates the effective agreement and snapshots it independently."}</p></BaseerCard></> : null}
      {selectedDetail ? <div className="page-actions"><BaseerButton type="button" variant="secondary" onClick={() => setAgreementOpen(true)}>{ar ? "إدارة اتفاق الراتب المركزي" : "Manage central agreement"}</BaseerButton></div> : null}
    </BaseerBatchPanel>
    {agreementOpen ? <Suspense fallback={null}><HrCompensationAgreementDialog open={agreementOpen} language={language} employees={employees} fixedEmployeeId={selectedDetail?.employee.id} profile={selectedDetail?.compensation} onClose={() => setAgreementOpen(false)} onSaved={async () => { await loadEmployees(); if (selectedEmployeeId) { const session = activeSession(); if (session) setSelectedDetail(await getHrEmployee(session, selectedEmployeeId)); } }} onError={setMessage} /></Suspense> : null}
  </section>;
}
