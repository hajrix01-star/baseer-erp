import { useEffect, useMemo, useRef, useState } from "react";

import "./hr-compensation-agreement-dialog.css";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { BaseerMoney } from "./baseer-money";
import { BaseerSearchSelect } from "./baseer-search-select";
import { activeSession, requestId } from "./daily-sales-client";
import { setHrEmployeeCompensation, type HrCompensationMethod, type HrCompensationProfile, type HrEmployee } from "./hr-client";

type Language = "ar" | "en";
type SalaryOperation = "FULL" | "INCREASE" | "DECREASE";
type Draft = {
  employeeId: string;
  policyVersionId: string;
  effectiveFrom: string;
  monthlyGross: string;
  compensationMethod: HrCompensationMethod;
  foodAllowance: string;
  housingAllowance: string;
  transportAllowance: string;
  otherAllowance: string;
  scheduledHoursPerDay: string;
  scheduledWorkDays: string;
  notes: string;
};

const month = (offset = 0) => {
  const value = new Date();
  value.setDate(1);
  value.setMonth(value.getMonth() + offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
};
const amount = (value: string) => Number(value || 0);
const employeeLabel = (language: Language, employee: HrEmployee) => `${employee.employeeNumber} · ${language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr}`;
const operationCopy = (language: Language, operation: SalaryOperation) => ({
  FULL: language === "ar" ? { label: "تعديل شامل", description: "الراتب والبدلات" } : { label: "Full edit", description: "Salary and allowances" },
  INCREASE: language === "ar" ? { label: "زيادة راتب", description: "أدخل مبلغ الزيادة" } : { label: "Increase", description: "Enter the increase amount" },
  DECREASE: language === "ar" ? { label: "تخفيض راتب", description: "أدخل مبلغ التخفيض" } : { label: "Decrease", description: "Enter the decrease amount" },
})[operation];
const empty = (employeeId = "", profile?: HrCompensationProfile | null): Draft => ({
  employeeId,
  policyVersionId: profile?.policyVersionId ?? "",
  effectiveFrom: `${month(profile ? 1 : 0)}-01`,
  monthlyGross: profile?.monthlyGross ?? "",
  compensationMethod: profile?.compensationMethod ?? "FIXED_MONTHLY",
  foodAllowance: profile?.foodAllowance ?? "",
  housingAllowance: profile?.housingAllowance ?? "",
  transportAllowance: profile?.transportAllowance ?? "",
  otherAllowance: profile?.otherAllowance ?? "",
  scheduledHoursPerDay: profile?.scheduledHoursPerDay?.toString() ?? "",
  scheduledWorkDays: profile?.scheduledWorkDays?.toString() ?? "",
  notes: "",
});

/** One compact workflow for salary-only changes. Promotions remain part of the
 * employment path so salary history and promotion history retain their roles. */
export function HrCompensationAgreementDialog({ open, language, employees, fixedEmployeeId, profile, onClose, onSaved, onError }: { open: boolean; language: Language; employees: readonly HrEmployee[]; fixedEmployeeId?: string; profile?: HrCompensationProfile | null; onClose: () => void; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  const ar = language === "ar";
  const [busy, setBusy] = useState(false);
  const [operation, setOperation] = useState<SalaryOperation>("FULL");
  const [draft, setDraft] = useState<Draft>(() => empty(fixedEmployeeId, profile));
  const [changeAmount, setChangeAmount] = useState("");
  const submissionKey = useRef(requestId());

  useEffect(() => {
    if (!open) return;
    setOperation("FULL");
    setDraft(empty(fixedEmployeeId, profile));
    setChangeAmount("");
    submissionKey.current = requestId();
  }, [fixedEmployeeId, open, profile]);

  const activeEmployees = useMemo(() => employees.filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE"), [employees]);
  const existingSalary = profile ?? null;
  const current = amount(existingSalary?.monthlyGross ?? "0");
  const delta = amount(changeAmount);
  const nextSalary = operation === "FULL" ? amount(draft.monthlyGross) : current + (operation === "INCREASE" ? delta : -delta);
  const fullEdit = operation === "FULL";
  const requiresOvertimeSchedule = fullEdit && draft.compensationMethod === "INCLUSIVE_OVERTIME";
  const selectedEmployee = activeEmployees.find((employee) => employee.id === draft.employeeId);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const session = activeSession();
    if (!session || busy) return;
    if (!fullEdit && (!Number.isFinite(delta) || delta <= 0)) { onError(ar ? "أدخل مبلغ التعديل أكبر من صفر." : "Enter an adjustment amount greater than zero."); return; }
    if (!Number.isFinite(nextSalary) || nextSalary <= 0) { onError(ar ? "لا يمكن أن يصبح الراتب صفراً أو أقل." : "The salary cannot become zero or less."); return; }
    if (requiresOvertimeSchedule && (!Number.isInteger(Number(draft.scheduledHoursPerDay)) || Number(draft.scheduledHoursPerDay) < 9 || Number(draft.scheduledHoursPerDay) > 12 || !Number.isInteger(Number(draft.scheduledWorkDays)) || Number(draft.scheduledWorkDays) < 1 || Number(draft.scheduledWorkDays) > 31)) { onError(ar ? "للراتب الشامل للأوفر تايم، أدخل ساعات الدوام من 9 إلى 12 وأيام العمل الشهرية." : "For inclusive overtime, enter daily hours from 9 to 12 and monthly work days."); return; }
    const method = fullEdit ? draft.compensationMethod : existingSalary!.compensationMethod;
    setBusy(true);
    try {
      await setHrEmployeeCompensation(session, {
        employeeId: draft.employeeId,
        policyVersionId: draft.policyVersionId || undefined,
        effectiveFrom: draft.effectiveFrom,
        monthlyGross: nextSalary.toFixed(4),
        compensationMethod: method,
        foodAllowance: (fullEdit ? draft.foodAllowance : existingSalary!.foodAllowance) || "0",
        housingAllowance: (fullEdit ? draft.housingAllowance : existingSalary!.housingAllowance) || "0",
        transportAllowance: (fullEdit ? draft.transportAllowance : existingSalary!.transportAllowance) || "0",
        otherAllowance: (fullEdit ? draft.otherAllowance : existingSalary!.otherAllowance) || "0",
        ...(method === "INCLUSIVE_OVERTIME" ? { scheduledHoursPerDay: Number(fullEdit ? draft.scheduledHoursPerDay : existingSalary!.scheduledHoursPerDay), scheduledWorkDays: Number(fullEdit ? draft.scheduledWorkDays : existingSalary!.scheduledWorkDays) } : {}),
        notes: `${operationCopy(language, operation).label}${!fullEdit ? `: ${delta.toFixed(4)}` : ""}${draft.notes.trim() ? ` — ${draft.notes.trim()}` : ""}`,
        idempotencyKey: submissionKey.current,
      });
      onClose();
      try { await onSaved(); }
      catch (error) { onError(presentBaseerApiError(error, language, ar ? "حُفظ الراتب، لكن تعذر تحديث العرض الحالي." : "The salary was saved, but the current view could not be refreshed.")); }
    } catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر حفظ الراتب." : "The salary could not be saved.")); }
    finally { setBusy(false); }
  };

  const title = existingSalary ? (ar ? "إدارة الراتب" : "Manage salary") : (ar ? "تحديد الراتب" : "Set salary");
  return <BaseerFormDialog open={open} title={title} language={language} busy={busy} size="standard" className="hr-salary-manager-dialog" formId="hr-salary-editor" submitLabel={ar ? "حفظ الراتب" : "Save salary"} onClose={onClose}>
    <form id="hr-salary-editor" className="baseer-form hr-salary-manager" onSubmit={(event) => void submit(event)}>
      <BaseerFormSection title={selectedEmployee ? (ar ? `راتب ${selectedEmployee.nameAr}` : `${selectedEmployee.nameEn ?? selectedEmployee.nameAr} salary`) : (ar ? "بيانات الراتب" : "Salary details")} description={ar ? "سيُنشئ النظام سجلاً مؤرخاً جديداً؛ المسيرات السابقة لا تتغير." : "The system creates a new dated record; past payroll does not change."}>
        {existingSalary ? <div className="hr-salary-manager__operations" role="group" aria-label={ar ? "نوع عملية الراتب" : "Salary operation"}>{(["FULL", "INCREASE", "DECREASE"] as const).map((value) => <BaseerButton key={value} type="button" variant={operation === value ? "primary" : "secondary"} className="hr-salary-manager__operation" disabled={busy} onClick={() => setOperation(value)}><span>{operationCopy(language, value).label}</span><small>{operationCopy(language, value).description}</small></BaseerButton>)}</div> : null}
        {existingSalary ? <div className="hr-salary-manager__summary"><div><span>{ar ? "الراتب الحالي" : "Current salary"}</span><strong><BaseerMoney value={existingSalary.monthlyGross} language={language} /></strong></div><div><span>{ar ? "بعد العملية" : "After change"}</span><strong><BaseerMoney value={Number.isFinite(nextSalary) && nextSalary >= 0 ? nextSalary.toFixed(4) : "0"} language={language} /></strong></div></div> : null}
        <BaseerFormGrid className="hr-salary-manager__fields">
          {!fixedEmployeeId ? <label className="baseer-form-field baseer-form-field--full">{ar ? "الموظف" : "Employee"}<BaseerSearchSelect required label={ar ? "الموظف" : "Employee"} value={draft.employeeId} placeholder={ar ? "اختر الموظف" : "Select employee"} options={activeEmployees.map((employee) => ({ id: employee.id, label: employeeLabel(language, employee) }))} onChange={(employeeId) => setDraft((value) => ({ ...value, employeeId }))} /></label> : null}
          <label className="baseer-form-field">{ar ? "شهر التطبيق" : "Effective month"}<input required type="month" min={month(existingSalary ? 1 : 0)} value={draft.effectiveFrom.slice(0, 7)} onChange={(event) => setDraft((value) => ({ ...value, effectiveFrom: `${event.target.value}-01` }))} /></label>
          {fullEdit ? <label className="baseer-form-field">{ar ? "إجمالي الراتب الشهري" : "Monthly salary"}<input required autoFocus inputMode="decimal" value={draft.monthlyGross} onChange={(event) => setDraft((value) => ({ ...value, monthlyGross: event.target.value }))} /></label> : <label className="baseer-form-field">{operation === "INCREASE" ? (ar ? "مبلغ الزيادة" : "Increase amount") : (ar ? "مبلغ التخفيض" : "Decrease amount")}<input required autoFocus inputMode="decimal" value={changeAmount} onChange={(event) => setChangeAmount(event.target.value)} /></label>}
          {fullEdit ? <details className="baseer-form-advanced" open={requiresOvertimeSchedule}><summary>{ar ? "البدلات وطريقة الاحتساب" : "Allowances & calculation"}</summary><div><label>{ar ? "طريقة الاحتساب" : "Calculation method"}<select value={draft.compensationMethod} onChange={(event) => setDraft((value) => ({ ...value, compensationMethod: event.target.value as HrCompensationMethod }))}><option value="FIXED_MONTHLY">{ar ? "راتب شهري ثابت" : "Fixed monthly salary"}</option><option value="INCLUSIVE_OVERTIME">{ar ? "شامل الأوفر تايم" : "Inclusive overtime"}</option></select></label><label>{ar ? "بدل الأكل" : "Food allowance"}<input inputMode="decimal" value={draft.foodAllowance} onChange={(event) => setDraft((value) => ({ ...value, foodAllowance: event.target.value }))} /></label><label>{ar ? "بدل السكن" : "Housing allowance"}<input inputMode="decimal" value={draft.housingAllowance} onChange={(event) => setDraft((value) => ({ ...value, housingAllowance: event.target.value }))} /></label><label>{ar ? "بدل المواصلات" : "Transport allowance"}<input inputMode="decimal" value={draft.transportAllowance} onChange={(event) => setDraft((value) => ({ ...value, transportAllowance: event.target.value }))} /></label><label>{ar ? "بدلات أخرى" : "Other allowances"}<input inputMode="decimal" value={draft.otherAllowance} onChange={(event) => setDraft((value) => ({ ...value, otherAllowance: event.target.value }))} /></label>{requiresOvertimeSchedule ? <><label>{ar ? "ساعات الدوام اليومية" : "Daily hours"}<input required type="number" min="9" max="12" value={draft.scheduledHoursPerDay} onChange={(event) => setDraft((value) => ({ ...value, scheduledHoursPerDay: event.target.value }))} /></label><label>{ar ? "أيام العمل الشهرية" : "Monthly working days"}<input required type="number" min="1" max="31" value={draft.scheduledWorkDays} onChange={(event) => setDraft((value) => ({ ...value, scheduledWorkDays: event.target.value }))} /></label></> : null}</div></details> : null}
          <label className="baseer-form-field baseer-form-field--full">{ar ? "السبب أو الملاحظة (اختياري)" : "Reason or note (optional)"}<textarea value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} /></label>
        </BaseerFormGrid>
      </BaseerFormSection>
    </form>
  </BaseerFormDialog>;
}
