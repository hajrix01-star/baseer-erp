import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerBatchPanel, BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerMoneyInput } from "./baseer-form-fields";
import { BaseerSearchSelect } from "./baseer-search-select";
import { activeSession } from "./daily-sales-client";
import { getHrEmployee, listHrEmployees, type HrCompensationMethod, type HrDetail, type HrEmployee } from "./hr-client";
import { calculateSalaryTool, type SalaryToolInput } from "./hr-salary-tools-calculations";
import { formatNumber } from "./number-format";
import "./hr-salary-tools-workspace.css";

type Language = "ar" | "en";
type Tab = "salary" | "documents";

const HrCompensationAgreementDialog = lazy(async () => ({ default: (await import("./hr-compensation-agreement-dialog")).HrCompensationAgreementDialog }));
const HrEmployeeLettersPanel = lazy(async () => ({ default: (await import("./hr-employee-letters-panel")).HrEmployeeLettersPanel }));
const money = (value: number) => formatNumber(value);
const emptyDraft = (): SalaryToolInput => ({ monthlyGross: "", compensationMethod: "FIXED_MONTHLY", foodAllowance: "", housingAllowance: "", transportAllowance: "", otherAllowance: "", scheduledHoursPerDay: "", scheduledWorkDays: "" });
const labelEmployee = (language: Language, employee: HrEmployee) => `${employee.employeeNumber} · ${language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr}`;

/** Read-only salary calculator. It never creates a payroll event. */
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
      setDraft(emptyDraft());
    }).catch((error) => setMessage(presentBaseerApiError(error, language, ar ? "تحميل الراتب" : "Loading salary"))).finally(() => setLoadingEmployee(false));
  }, [ar, language, selectedEmployeeId]);

  const calculation = useMemo(() => calculateSalaryTool(draft), [draft]);
  const setField = <Key extends keyof SalaryToolInput>(key: Key, value: SalaryToolInput[Key]) => setDraft((current) => ({ ...current, [key]: value }));
  const errorMessage = calculation.error === "ALLOWANCES_EXCEED_GROSS"
    ? (ar ? "الإجمالي المتفق عليه يجب أن يكون أكبر من البدلات الثابتة." : "The agreed total must exceed fixed allowances.")
    : calculation.error === "INCLUSIVE_SCHEDULE_REQUIRED"
      ? (ar ? "الراتب الشامل للأوفر تايم يتطلب ساعات يومية (9–12) وأيام عمل شهرية (1–31)." : "Inclusive overtime needs daily hours (9–12) and monthly working days (1–31).")
      : calculation.error === "INCLUSIVE_TOTAL_TOO_LOW"
        ? (ar ? "الإجمالي المتفق عليه لا يغطي البدلات والجدول المختار." : "The agreed total cannot cover the selected allowances and schedule.")
        : "";

  return <section className="administration-workspace">
    <BaseerWorkspaceTabs ariaLabel={ar ? "تبويبات أدوات الراتب" : "Salary tools tabs"} idPrefix="hr-salary-tools" activeId={tab} onChange={(value) => setTab(value as Tab)} tabs={[{ id: "salary", label: ar ? "حاسبة الراتب" : "Salary calculator" }, { id: "documents", label: ar ? "وثائق الراتب" : "Salary documents" }]} />
    <BaseerBatchPanel id={`hr-salary-tools-panel-${tab}`} labelledBy={`hr-salary-tools-${tab}`}>
      {tab === "salary" ? <>
      {message ? <BaseerCard>{message}</BaseerCard> : null}
      <section className="hr-salary-tools__calculator">
        <section className="hr-salary-tools__inputs" aria-labelledby="salary-tool-inputs-title"><header><h3 id="salary-tool-inputs-title">{ar ? "مدخلات الحاسبة" : "Calculator inputs"}</h3><p>{ar ? "هذه معاينة فقط؛ لا تحفظ ولا تنشئ أي حركة." : "This is a preview only; it does not save or create a transaction."}</p></header><div className="hr-salary-tools__input-grid">
          <label className="hr-salary-tools__field--full">{ar ? "الموظف (اختياري)" : "Employee (optional)"}<BaseerSearchSelect label={ar ? "الموظف" : "Employee"} value={selectedEmployeeId} placeholder={ar ? "حساب يدوي أو اختر موظفاً" : "Manual calculation or select an employee"} options={employees.map((employee) => ({ id: employee.id, label: labelEmployee(language, employee) }))} onChange={setSelectedEmployeeId} /></label>
          <label>{ar ? "طريقة الاحتساب" : "Calculation method"}<select value={draft.compensationMethod} onChange={(event) => setField("compensationMethod", event.target.value as HrCompensationMethod)}><option value="FIXED_MONTHLY">{ar ? "راتب شهري ثابت" : "Fixed monthly salary"}</option><option value="INCLUSIVE_OVERTIME">{ar ? "إجمالي شامل الأوفر تايم" : "Inclusive overtime total"}</option></select></label>
          <label>{ar ? "إجمالي الراتب الشهري" : "Monthly salary"}<BaseerMoneyInput value={draft.monthlyGross} onValueChange={(monthlyGross) => setField("monthlyGross", monthlyGross)} /></label>
          <label className="hr-salary-tools__allowance">{ar ? "بدل الأكل الشهري" : "Monthly food allowance"}<BaseerMoneyInput value={draft.foodAllowance} onValueChange={(foodAllowance) => setField("foodAllowance", foodAllowance)} /></label>
          <label className="hr-salary-tools__allowance">{ar ? "بدل السكن الشهري" : "Monthly housing allowance"}<BaseerMoneyInput value={draft.housingAllowance} onValueChange={(housingAllowance) => setField("housingAllowance", housingAllowance)} /></label>
          <label className="hr-salary-tools__allowance">{ar ? "بدل المواصلات الشهري" : "Monthly transport allowance"}<BaseerMoneyInput value={draft.transportAllowance} onValueChange={(transportAllowance) => setField("transportAllowance", transportAllowance)} /></label>
          <label className="hr-salary-tools__allowance">{ar ? "بدلات ثابتة أخرى" : "Other fixed allowances"}<BaseerMoneyInput value={draft.otherAllowance} onValueChange={(otherAllowance) => setField("otherAllowance", otherAllowance)} /></label>
          {draft.compensationMethod === "INCLUSIVE_OVERTIME" ? <><label>{ar ? "ساعات الدوام المتفق عليها يومياً" : "Agreed daily hours"}<input type="number" min="9" max="12" value={draft.scheduledHoursPerDay} onChange={(event) => setField("scheduledHoursPerDay", event.target.value)} /></label><label>{ar ? "أيام العمل المتفق عليها شهرياً" : "Agreed monthly working days"}<input type="number" min="1" max="31" value={draft.scheduledWorkDays} onChange={(event) => setField("scheduledWorkDays", event.target.value)} /></label></> : null}
        </div></section>
        <aside className="hr-salary-tools__result" aria-live="polite"><header><h3>{ar ? "تفصيل الراتب" : "Salary breakdown"}</h3><p>{ar ? "معاينة حسابية فورية" : "Live calculation preview"}</p></header>{calculation.valid ? <><dl><div><dt>{ar ? "الراتب الأساسي" : "Basic salary"}</dt><dd dir="ltr">{money(calculation.basicSalary)} SAR</dd></div><div><dt>{ar ? "البدلات الثابتة" : "Fixed allowances"}</dt><dd dir="ltr">{money(calculation.fixedAllowances)} SAR</dd></div><div><dt>{ar ? "مكوّن الأوفر تايم" : "Overtime component"}</dt><dd dir="ltr">{money(calculation.overtimeAmount)} SAR</dd></div><div><dt>{ar ? "ساعات الأوفر تايم" : "Overtime hours"}</dt><dd dir="ltr">{formatNumber(calculation.overtimeHours)}</dd></div><div className="hr-salary-tools__result-total"><dt>{ar ? "الإجمالي الشهري" : "Monthly total"}</dt><dd dir="ltr">{money(calculation.monthlyGross)} <small>SAR</small></dd></div></dl></> : <p className="hr-salary-tools__result-empty">{ar ? "أدخل إجمالي الراتب لعرض التفصيل." : "Enter the monthly salary to view the breakdown."}</p>}<p className="hr-salary-tools__boundary">{ar ? "الأوفر تايم هنا تقديري وفق جدول الراتب فقط، وليس سجل حضور فعلي." : "Overtime here is a salary-schedule estimate, not actual attendance."}</p></aside>
      </section>
      {loadingEmployee ? <BaseerCard>{ar ? "جارٍ تحميل راتب الموظف…" : "Loading employee salary…"}</BaseerCard> : null}
      {errorMessage ? <BaseerCard tone="muted">{errorMessage}</BaseerCard> : null}
      {selectedDetail ? <div className="page-actions"><BaseerButton type="button" variant="secondary" onClick={() => setAgreementOpen(true)}>{ar ? "تعديل راتب الموظف" : "Edit employee salary"}</BaseerButton></div> : null}
      </> : null}
      {tab === "documents" ? <>
        <div className="administration-section-heading"><div><h2>{ar ? "وثائق الراتب المعتمدة" : "Approved salary documents"}</h2><p>{ar ? "إصدار الخطاب وحفظه ومعاينته يتم من سجل موثق. طباعة المسير أو المخالصة تصدر من سجل العملية المعتمد، وليس من نموذج حر." : "Issue, store, and preview employee letters from their governed register. Payroll-run and final-settlement output is produced from the approved operational record, never a free-form template."}</p></div></div>
        <label>{ar ? "الموظف" : "Employee"}<BaseerSearchSelect label={ar ? "الموظف" : "Employee"} value={selectedEmployeeId} placeholder={ar ? "اختر الموظف لإصدار خطاب" : "Select an employee to issue a letter"} options={employees.map((employee) => ({ id: employee.id, label: labelEmployee(language, employee) }))} onChange={setSelectedEmployeeId} /></label>
        {selectedEmployeeId ? <Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل سجل الخطابات…" : "Loading letter register…"}</BaseerCard>}><HrEmployeeLettersPanel employeeId={selectedEmployeeId} language={language} hasCurrentCompensation={Boolean(selectedDetail?.compensation)} onManageCompensation={() => setAgreementOpen(true)} onError={setMessage} onChanged={loadEmployees} /></Suspense> : <BaseerCard tone="muted">{ar ? "اختر موظفاً لإصدار خطاب تعريف بالراتب أو شهادة خدمة، ثم معاينته وطباعته من سجل الإصدار." : "Select an employee to issue a salary certificate or service certificate, then preview and print it from its issue register."}</BaseerCard>}
        <BaseerCard tone="muted"><strong>{ar ? "مسار الطباعة الصحيح" : "Correct printing path"}</strong><p>{ar ? "المسير: افتح مسير الرواتب ثم استخدم «معاينة وطباعة A4». المخالصة: افتح ملف الموظف ثم «نهاية الخدمة» واستخدم الإجراء نفسه بعد الاعتماد. هكذا تبقى كل وثيقة مرتبطة باللقطة المحاسبية والتشغيلية الصحيحة." : "Payroll: open the payroll run and choose “Preview & print A4”. Final settlement: open the employee file, then “End of service”, and use the same action after approval. This keeps every document tied to the correct accounting and operational snapshot."}</p></BaseerCard>
      </> : null}
    </BaseerBatchPanel>
    {agreementOpen ? <Suspense fallback={null}><HrCompensationAgreementDialog open={agreementOpen} language={language} employees={employees} fixedEmployeeId={selectedDetail?.employee.id} profile={selectedDetail?.compensation} onClose={() => setAgreementOpen(false)} onSaved={async () => { await loadEmployees(); if (selectedEmployeeId) { const session = activeSession(); if (session) setSelectedDetail(await getHrEmployee(session, selectedEmployeeId)); } }} onError={setMessage} /></Suspense> : null}
  </section>;
}
