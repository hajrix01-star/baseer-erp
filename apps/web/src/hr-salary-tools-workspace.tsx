import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { presentBaseerApiError, presentBaseerLoadError } from "./baseer-api-error";
import { BaseerBatchPanel, BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { BaseerCard } from "./baseer-card";
import { BaseerMoneyInput } from "./baseer-form-fields";
import { BaseerComboboxField as BaseerCombobox } from "./baseer-combobox-field";
import { activeSession } from "./daily-sales-client";
import { getHrEmployee, listHrEmployees, type HrCompensationMethod, type HrDetail, type HrEmployee } from "./hr-client";
import { calculateSalaryTool, type SalaryToolInput } from "./hr-salary-tools-calculations";
import { formatNumber } from "./number-format";
import { hasActivePermission } from "./module-access";
import "./hr-salary-tools-workspace.css";

type Language = "ar" | "en";
type Tab = "salary" | "documents";

const HrEmployeeLettersPanel = lazy(async () => ({ default: (await import("./hr-employee-letters-panel")).HrEmployeeLettersPanel }));
const money = (value: number) => formatNumber(value);
const STANDARD_MONTHLY_HOURS = 208;
const emptyDraft = (): SalaryToolInput => ({ monthlyGross: "", compensationMethod: "FIXED_MONTHLY", foodAllowance: "", housingAllowance: "", transportAllowance: "", otherAllowance: "", scheduledHoursPerDay: "", scheduledWorkDays: "" });
const labelEmployee = (language: Language, employee: HrEmployee) => `${employee.employeeNumber} · ${language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr}`;

/** Read-only salary calculator. It never creates a payroll event. */
export function HrSalaryToolsWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  const canUseCalculator = hasActivePermission("hr.employees.read") || hasActivePermission("hr.payroll.read");
  const canReadDocuments = hasActivePermission("hr.employee_letters.read");
  const canIssueDocuments = hasActivePermission("hr.employee_letters.issue");
  const [tab, setTab] = useState<Tab>("salary");
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState("");
  const [selectedDetail, setSelectedDetail] = useState<HrDetail | null>(null);
  const [draft, setDraft] = useState<SalaryToolInput>(emptyDraft());
  const [loadingEmployee, setLoadingEmployee] = useState(false);
  const [message, setMessage] = useState("");

  const loadEmployees = useCallback(async () => {
    const session = activeSession();
    if (!session) return;
    try {
      const next = (await listHrEmployees(session, { pageSize: 100 })).employees.filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE");
      setEmployees((current) => [...next, ...current.filter((employee) => !next.some((candidate) => candidate.id === employee.id))]);
    }
    catch (error) { setMessage(presentBaseerLoadError(error, language, { ar: "الموظفين", en: "employees" })); }
  }, [ar, language]);
  useEffect(() => { void loadEmployees(); }, [loadEmployees]);
  const searchEmployeeOptions = useCallback(async (query: string, signal: AbortSignal) => {
    const session = activeSession(); if (!session) return [];
    const next = (await listHrEmployees(session, { search: query.trim() || undefined, pageSize: 50 }, { signal })).employees.filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE");
    setEmployees((current) => [...current, ...next.filter((employee) => !current.some((candidate) => candidate.id === employee.id))]);
    return next.map((employee) => ({ id: employee.id, label: labelEmployee(language, employee) }));
  }, [language]);
  useEffect(() => {
    const session = activeSession();
    if (!session || !selectedEmployeeId) { setSelectedDetail(null); return; }
    setLoadingEmployee(true); setMessage("");
    void getHrEmployee(session, selectedEmployeeId).then((detail) => {
      setSelectedDetail(detail);
      setDraft(emptyDraft());
    }).catch((error) => setMessage(presentBaseerLoadError(error, language, { ar: "الراتب", en: "salary" }))).finally(() => setLoadingEmployee(false));
  }, [ar, language, selectedEmployeeId]);

  const calculation = useMemo(() => calculateSalaryTool(draft), [draft]);
  const hourlyRates = useMemo(() => {
    if (!calculation.valid) return null;
    const actual = (calculation.basicSalary + calculation.fixedAllowances) / STANDARD_MONTHLY_HOURS;
    const basic = calculation.basicSalary / STANDARD_MONTHLY_HOURS;
    return { actual, basic, overtime: actual + basic * 0.5 };
  }, [calculation]);
  const setField = <Key extends keyof SalaryToolInput>(key: Key, value: SalaryToolInput[Key]) => setDraft((current) => ({ ...current, [key]: value }));
  const errorMessage = calculation.error === "ALLOWANCES_EXCEED_GROSS"
    ? (ar ? "الإجمالي المتفق عليه يجب أن يكون أكبر من البدلات الثابتة." : "The agreed total must exceed fixed allowances.")
    : calculation.error === "INCLUSIVE_SCHEDULE_REQUIRED"
      ? (ar ? "الراتب الشامل للأوفر تايم يتطلب ساعات يومية (9–12) وأيام عمل شهرية (1–31)." : "Inclusive overtime needs daily hours (9–12) and monthly working days (1–31).")
      : calculation.error === "INCLUSIVE_TOTAL_TOO_LOW"
        ? (ar ? "الإجمالي المتفق عليه لا يغطي البدلات والجدول المختار." : "The agreed total cannot cover the selected allowances and schedule.")
        : "";

  const tabs = [...(canUseCalculator ? [{ id: "salary", label: ar ? "حاسبة الراتب" : "Salary calculator" }] : []), ...(canReadDocuments ? [{ id: "documents", label: ar ? "وثائق الراتب" : "Salary documents" }] : [])] as Array<{ id: Tab; label: string }>;
  const activeTab = tabs.some((item) => item.id === tab) ? tab : tabs[0]?.id;

  return <section className="administration-workspace">
    {activeTab ? <><BaseerWorkspaceTabs ariaLabel={ar ? "تبويبات أدوات الراتب" : "Salary tools tabs"} idPrefix="hr-salary-tools" activeId={activeTab} onChange={(value) => setTab(value as Tab)} tabs={tabs} />
    <BaseerBatchPanel id={`hr-salary-tools-panel-${activeTab}`} labelledBy={`hr-salary-tools-${activeTab}`}>
      {activeTab === "salary" ? <>
      {message ? <BaseerCard>{message}</BaseerCard> : null}
      <section className="hr-salary-tools__calculator">
        <section className="hr-salary-tools__inputs" aria-labelledby="salary-tool-inputs-title"><header><h3 id="salary-tool-inputs-title">{ar ? "مدخلات الحاسبة" : "Calculator inputs"}</h3></header><div className="hr-salary-tools__input-grid">
          <label className="hr-salary-tools__field--full">{ar ? "الموظف (اختياري)" : "Employee (optional)"}<BaseerCombobox label={ar ? "الموظف" : "Employee"} value={selectedEmployeeId} placeholder={ar ? "حساب يدوي أو اختر موظفاً" : "Manual calculation or select an employee"} options={employees.map((employee) => ({ id: employee.id, label: labelEmployee(language, employee) }))} remoteSearch={searchEmployeeOptions} scopeKey={activeSession()?.companyId ?? "signed-out"} onChange={setSelectedEmployeeId} /></label>
          <label>{ar ? "طريقة الاحتساب" : "Calculation method"}<select value={draft.compensationMethod} onChange={(event) => setField("compensationMethod", event.target.value as HrCompensationMethod)}><option value="FIXED_MONTHLY">{ar ? "راتب شهري ثابت" : "Fixed monthly salary"}</option><option value="INCLUSIVE_OVERTIME">{ar ? "إجمالي شامل الأوفر تايم" : "Inclusive overtime total"}</option></select></label>
          <label>{ar ? "إجمالي الراتب الشهري" : "Monthly salary"}<BaseerMoneyInput value={draft.monthlyGross} onValueChange={(monthlyGross) => setField("monthlyGross", monthlyGross)} /></label>
          <label className="hr-salary-tools__allowance">{ar ? "بدل الأكل الشهري" : "Monthly food allowance"}<BaseerMoneyInput value={draft.foodAllowance} onValueChange={(foodAllowance) => setField("foodAllowance", foodAllowance)} /></label>
          <label className="hr-salary-tools__allowance">{ar ? "بدل السكن الشهري" : "Monthly housing allowance"}<BaseerMoneyInput value={draft.housingAllowance} onValueChange={(housingAllowance) => setField("housingAllowance", housingAllowance)} /></label>
          <label className="hr-salary-tools__allowance">{ar ? "بدل المواصلات الشهري" : "Monthly transport allowance"}<BaseerMoneyInput value={draft.transportAllowance} onValueChange={(transportAllowance) => setField("transportAllowance", transportAllowance)} /></label>
          <label className="hr-salary-tools__allowance">{ar ? "بدلات ثابتة أخرى" : "Other fixed allowances"}<BaseerMoneyInput value={draft.otherAllowance} onValueChange={(otherAllowance) => setField("otherAllowance", otherAllowance)} /></label>
          {draft.compensationMethod === "INCLUSIVE_OVERTIME" ? <><label>{ar ? "ساعات الدوام المتفق عليها يومياً" : "Agreed daily hours"}<input type="number" min="9" max="12" value={draft.scheduledHoursPerDay} onChange={(event) => setField("scheduledHoursPerDay", event.target.value)} /></label><label>{ar ? "أيام العمل المتفق عليها شهرياً" : "Agreed monthly working days"}<input type="number" min="1" max="31" value={draft.scheduledWorkDays} onChange={(event) => setField("scheduledWorkDays", event.target.value)} /></label></> : null}
        </div></section>
        <aside className="hr-salary-tools__result" aria-live="polite"><header><h3>{ar ? "تفصيل الراتب" : "Salary breakdown"}</h3></header>{calculation.valid ? <><dl><div><dt>{ar ? "الراتب الأساسي" : "Basic salary"}</dt><dd dir="ltr">{money(calculation.basicSalary)} SAR</dd></div><div><dt>{ar ? "البدلات الثابتة" : "Fixed allowances"}</dt><dd dir="ltr">{money(calculation.fixedAllowances)} SAR</dd></div><div><dt>{ar ? "مكوّن الأوفر تايم" : "Overtime component"}</dt><dd dir="ltr">{money(calculation.overtimeAmount)} SAR</dd></div><div><dt>{ar ? "ساعات الأوفر تايم" : "Overtime hours"}</dt><dd dir="ltr">{formatNumber(calculation.overtimeHours)}</dd></div><div className="hr-salary-tools__result-total"><dt>{ar ? "الإجمالي الشهري" : "Monthly total"}</dt><dd dir="ltr">{money(calculation.monthlyGross)} <small>SAR</small></dd></div></dl><section className="hr-salary-tools__hourly-rates"><h4>{ar ? "أجر الساعة (م107)" : "Hourly wage"}</h4><dl><div><dt>{ar ? "أجر الساعة الفعلي (أساسي + بدلات) ÷ 208" : "Actual hourly rate (base + allowances) ÷ 208"}</dt><dd dir="ltr">{money(hourlyRates!.actual)} SAR</dd></div><div><dt>{ar ? "أجر الساعة الأساسي (الأساسي ÷ 208)" : "Basic hourly rate (base ÷ 208)"}</dt><dd dir="ltr">{money(hourlyRates!.basic)} SAR</dd></div><div><dt>{ar ? "أجر ساعة الأوفر تايم (فعلي + 50% أساسي)" : "Overtime hourly rate (actual + 50% base)"}</dt><dd dir="ltr">{money(hourlyRates!.overtime)} SAR</dd></div></dl></section></> : <p className="hr-salary-tools__result-empty">{ar ? "أدخل إجمالي الراتب لعرض التفصيل." : "Enter the monthly salary to view the breakdown."}</p>}<p className="hr-salary-tools__boundary">{ar ? "الأوفر تايم هنا تقديري وفق جدول الراتب فقط، وليس سجل حضور فعلي." : "Overtime here is a salary-schedule estimate, not actual attendance."}</p></aside>
      </section>
      {loadingEmployee ? <BaseerCard>{ar ? "جارٍ تحميل راتب الموظف…" : "Loading employee salary…"}</BaseerCard> : null}
      {errorMessage ? <BaseerCard tone="muted">{errorMessage}</BaseerCard> : null}
      </> : null}
      {activeTab === "documents" ? <>
        <div className="administration-section-heading"><h2>{ar ? "وثائق الراتب المعتمدة" : "Approved salary documents"}</h2></div>
        <label>{ar ? "الموظف" : "Employee"}<BaseerCombobox label={ar ? "الموظف" : "Employee"} value={selectedEmployeeId} placeholder={ar ? "اختر الموظف" : "Select an employee"} options={employees.map((employee) => ({ id: employee.id, label: labelEmployee(language, employee) }))} remoteSearch={searchEmployeeOptions} scopeKey={activeSession()?.companyId ?? "signed-out"} onChange={setSelectedEmployeeId} /></label>
        {selectedEmployeeId ? <Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل سجل الخطابات…" : "Loading letter register…"}</BaseerCard>}><HrEmployeeLettersPanel employeeId={selectedEmployeeId} language={language} hasCurrentCompensation={Boolean(selectedDetail?.compensation)} canIssue={canIssueDocuments} onManageCompensation={() => setMessage(ar ? "تُدار رواتب الموظفين من ملف الموظف." : "Employee salary is managed from the employee file.")} onError={setMessage} onChanged={loadEmployees} /></Suspense> : <BaseerCard tone="muted">{ar ? "اختر موظفاً." : "Select an employee."}</BaseerCard>}
      </> : null}
    </BaseerBatchPanel>
    </> : <BaseerCard tone="muted">{ar ? "لا تملك صلاحية استخدام أدوات الراتب." : "You do not have access to salary tools."}</BaseerCard>}
  </section>;
}
