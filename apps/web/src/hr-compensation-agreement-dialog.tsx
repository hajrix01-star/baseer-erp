import { useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { BaseerSearchSelect } from "./baseer-search-select";
import { activeSession, requestId } from "./daily-sales-client";
import { setHrEmployeeCompensation, type HrCompensationMethod, type HrCompensationProfile, type HrEmployee } from "./hr-client";

type Language = "ar" | "en";
type Draft = { employeeId: string; policyVersionId: string; effectiveFrom: string; monthlyGross: string; compensationMethod: HrCompensationMethod; foodAllowance: string; housingAllowance: string; transportAllowance: string; otherAllowance: string; scheduledHoursPerDay: string; scheduledWorkDays: string; notes: string };
const today = () => new Date().toISOString().slice(0, 10);
const month = () => today().slice(0, 7);
const employeeLabel = (language: Language, employee: HrEmployee) => `${employee.employeeNumber} · ${language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr}`;
const empty = (employeeId = "", profile?: HrCompensationProfile | null): Draft => ({ employeeId, policyVersionId: profile?.policyVersionId ?? "", effectiveFrom: `${month()}-01`, monthlyGross: profile?.monthlyGross ?? "", compensationMethod: profile?.compensationMethod ?? "FIXED_MONTHLY", foodAllowance: profile?.foodAllowance ?? "", housingAllowance: profile?.housingAllowance ?? "", transportAllowance: profile?.transportAllowance ?? "", otherAllowance: profile?.otherAllowance ?? "", scheduledHoursPerDay: profile?.scheduledHoursPerDay?.toString() ?? "", scheduledWorkDays: profile?.scheduledWorkDays?.toString() ?? "", notes: "" });

/** A simple salary editor. Its dated payroll snapshot remains internal, so past payroll is never changed. */
export function HrCompensationAgreementDialog({ open, language, employees, fixedEmployeeId, profile, onClose, onSaved, onError }: { open: boolean; language: Language; employees: readonly HrEmployee[]; fixedEmployeeId?: string; profile?: HrCompensationProfile | null; onClose: () => void; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  const ar = language === "ar";
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Draft>(() => empty(fixedEmployeeId, profile));
  useEffect(() => { if (open) setDraft(empty(fixedEmployeeId, profile)); }, [fixedEmployeeId, open, profile]);
  const activeEmployees = useMemo(() => employees.filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE"), [employees]);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); const session = activeSession(); if (!session || busy) return;
    setBusy(true);
    try {
      await setHrEmployeeCompensation(session, {
        employeeId: draft.employeeId,
        policyVersionId: draft.policyVersionId || undefined,
        effectiveFrom: draft.effectiveFrom,
        monthlyGross: draft.monthlyGross,
        compensationMethod: draft.compensationMethod,
        foodAllowance: draft.foodAllowance || "0",
        housingAllowance: draft.housingAllowance || "0",
        transportAllowance: draft.transportAllowance || "0",
        otherAllowance: draft.otherAllowance || "0",
        ...(draft.compensationMethod === "INCLUSIVE_OVERTIME" ? { scheduledHoursPerDay: Number(draft.scheduledHoursPerDay), scheduledWorkDays: Number(draft.scheduledWorkDays) } : {}),
        notes: draft.notes.trim() || undefined,
        idempotencyKey: requestId(),
      });
      await onSaved(); onClose();
    } catch (error) { onError(presentBaseerApiError(error, language, ar ? "حفظ الراتب" : "Saving salary")); }
    finally { setBusy(false); }
  };
  const title = profile ? (ar ? "تعديل الراتب" : "Edit salary") : (ar ? "تحديد الراتب" : "Set salary");
  return <BaseerFormDialog open={open} title={title} language={language} busy={busy} size="standard" formId="hr-salary-editor" submitLabel={ar ? "حفظ الراتب" : "Save salary"} onClose={onClose}>
    <form id="hr-salary-editor" className="baseer-form" onSubmit={(event) => void submit(event)}>
      <BaseerFormSection title={ar ? "الراتب" : "Salary"} description={ar ? "أدخل الراتب والبدلات. سبب التعديل اختياري، والسجل الداخلي يحمي المسيرات السابقة." : "Enter salary and allowances. A reason is optional; the internal record protects past payroll."}>
        <BaseerFormGrid>
          {!fixedEmployeeId ? <label className="baseer-form-field baseer-form-field--full">{ar ? "الموظف" : "Employee"}<BaseerSearchSelect required label={ar ? "الموظف" : "Employee"} value={draft.employeeId} placeholder={ar ? "اختر الموظف" : "Select employee"} options={activeEmployees.map((employee) => ({ id: employee.id, label: employeeLabel(language, employee) }))} onChange={(employeeId) => setDraft((value) => ({ ...value, employeeId }))} /></label> : null}
          <label className="baseer-form-field">{ar ? "شهر تطبيق التعديل" : "Change month"}<input required type="month" value={draft.effectiveFrom.slice(0, 7)} onChange={(event) => setDraft((value) => ({ ...value, effectiveFrom: `${event.target.value}-01` }))} /></label>
          <label className="baseer-form-field">{ar ? "إجمالي الراتب الشهري" : "Monthly salary"}<input required inputMode="decimal" value={draft.monthlyGross} onChange={(event) => setDraft((value) => ({ ...value, monthlyGross: event.target.value }))} /></label>
          <label className="baseer-form-field">{ar ? "طريقة الاحتساب" : "Calculation method"}<select value={draft.compensationMethod} onChange={(event) => setDraft((value) => ({ ...value, compensationMethod: event.target.value as HrCompensationMethod }))}><option value="FIXED_MONTHLY">{ar ? "راتب شهري ثابت" : "Fixed monthly salary"}</option><option value="INCLUSIVE_OVERTIME">{ar ? "شامل الأوفر تايم" : "Inclusive overtime"}</option></select></label>
          <label className="baseer-form-field">{ar ? "بدل الأكل" : "Food allowance"}<input inputMode="decimal" value={draft.foodAllowance} onChange={(event) => setDraft((value) => ({ ...value, foodAllowance: event.target.value }))} /></label>
          <label className="baseer-form-field">{ar ? "بدل السكن" : "Housing allowance"}<input inputMode="decimal" value={draft.housingAllowance} onChange={(event) => setDraft((value) => ({ ...value, housingAllowance: event.target.value }))} /></label>
          <label className="baseer-form-field">{ar ? "بدل المواصلات" : "Transport allowance"}<input inputMode="decimal" value={draft.transportAllowance} onChange={(event) => setDraft((value) => ({ ...value, transportAllowance: event.target.value }))} /></label>
          <label className="baseer-form-field">{ar ? "بدلات أخرى" : "Other allowances"}<input inputMode="decimal" value={draft.otherAllowance} onChange={(event) => setDraft((value) => ({ ...value, otherAllowance: event.target.value }))} /></label>
          {draft.compensationMethod === "INCLUSIVE_OVERTIME" ? <><label className="baseer-form-field">{ar ? "ساعات الدوام اليومية" : "Daily hours"}<input required type="number" min="9" max="12" value={draft.scheduledHoursPerDay} onChange={(event) => setDraft((value) => ({ ...value, scheduledHoursPerDay: event.target.value }))} /></label><label className="baseer-form-field">{ar ? "أيام العمل الشهرية" : "Monthly working days"}<input required type="number" min="1" max="31" value={draft.scheduledWorkDays} onChange={(event) => setDraft((value) => ({ ...value, scheduledWorkDays: event.target.value }))} /></label></> : null}
          <label className="baseer-form-field baseer-form-field--full">{ar ? "سبب التعديل أو ملاحظة (اختياري)" : "Change reason or note (optional)"}<textarea value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} /></label>
        </BaseerFormGrid>
      </BaseerFormSection>
    </form>
  </BaseerFormDialog>;
}
