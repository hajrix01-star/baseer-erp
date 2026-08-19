import { useEffect, useMemo, useRef, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { BaseerMoney } from "./baseer-money";
import { activeSession, requestId } from "./daily-sales-client";
import { setHrEmployeeCompensation, type HrCompensationMethod, type HrCompensationProfile, type HrEmployee } from "./hr-client";

type Language = "ar" | "en";
type SalaryOperation = "FULL" | "INCREASE" | "DECREASE";
export type SalaryAdjustmentMode = "INCREASE" | "DECREASE";

const month = (offset = 0) => {
  const value = new Date();
  value.setDate(1);
  value.setMonth(value.getMonth() + offset);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
};
const amount = (value: string) => Number(value || 0);
const operationLabel = (language: Language, operation: SalaryOperation) => ({
  FULL: language === "ar" ? "تعديل شامل" : "Full edit",
  INCREASE: language === "ar" ? "زيادة راتب" : "Increase salary",
  DECREASE: language === "ar" ? "تخفيض راتب" : "Decrease salary",
})[operation];

/** One governed salary action for an employee file. The selected mode only
 * changes the input experience; every save remains an effective-dated record. */
export function HrSalaryManagementDialog({ open, language, employee, profile, onClose, onSaved, onError }: { open: boolean; language: Language; employee: HrEmployee; profile: HrCompensationProfile | null; onClose: () => void; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  const ar = language === "ar";
  const [operation, setOperation] = useState<SalaryOperation>("FULL");
  const [effectiveMonth, setEffectiveMonth] = useState(month(profile ? 1 : 0));
  const [monthlyGross, setMonthlyGross] = useState(profile?.monthlyGross ?? "");
  const [compensationMethod, setCompensationMethod] = useState<HrCompensationMethod>(profile?.compensationMethod ?? "FIXED_MONTHLY");
  const [foodAllowance, setFoodAllowance] = useState(profile?.foodAllowance ?? "");
  const [housingAllowance, setHousingAllowance] = useState(profile?.housingAllowance ?? "");
  const [transportAllowance, setTransportAllowance] = useState(profile?.transportAllowance ?? "");
  const [otherAllowance, setOtherAllowance] = useState(profile?.otherAllowance ?? "");
  const [scheduledHoursPerDay, setScheduledHoursPerDay] = useState(profile?.scheduledHoursPerDay?.toString() ?? "");
  const [scheduledWorkDays, setScheduledWorkDays] = useState(profile?.scheduledWorkDays?.toString() ?? "");
  const [changeAmount, setChangeAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const submissionKey = useRef(requestId());

  useEffect(() => {
    if (!open) return;
    setOperation("FULL");
    setEffectiveMonth(month(profile ? 1 : 0));
    setMonthlyGross(profile?.monthlyGross ?? "");
    setCompensationMethod(profile?.compensationMethod ?? "FIXED_MONTHLY");
    setFoodAllowance(profile?.foodAllowance ?? "");
    setHousingAllowance(profile?.housingAllowance ?? "");
    setTransportAllowance(profile?.transportAllowance ?? "");
    setOtherAllowance(profile?.otherAllowance ?? "");
    setScheduledHoursPerDay(profile?.scheduledHoursPerDay?.toString() ?? "");
    setScheduledWorkDays(profile?.scheduledWorkDays?.toString() ?? "");
    setChangeAmount("");
    setReason("");
    submissionKey.current = requestId();
  }, [open, profile]);

  const current = amount(profile?.monthlyGross ?? "0");
  const delta = amount(changeAmount);
  const next = useMemo(() => operation === "FULL" ? amount(monthlyGross) : current + (operation === "INCREASE" ? delta : -delta), [current, delta, monthlyGross, operation]);
  const minimumMonth = month(profile ? 1 : 0);
  const isFullEdit = operation === "FULL";
  const requiresOvertimeSchedule = isFullEdit && compensationMethod === "INCLUSIVE_OVERTIME";

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const session = activeSession();
    if (!session || busy) return;
    if (!isFullEdit && (!Number.isFinite(delta) || delta <= 0)) { onError(ar ? "أدخل مبلغ التعديل أكبر من صفر." : "Enter an adjustment amount greater than zero."); return; }
    if (!Number.isFinite(next) || next <= 0) { onError(ar ? "لا يمكن أن يصبح الراتب صفراً أو أقل." : "The salary cannot become zero or less."); return; }
    if (requiresOvertimeSchedule && (!Number.isInteger(Number(scheduledHoursPerDay)) || Number(scheduledHoursPerDay) < 9 || Number(scheduledHoursPerDay) > 12 || !Number.isInteger(Number(scheduledWorkDays)) || Number(scheduledWorkDays) < 1 || Number(scheduledWorkDays) > 31)) {
      onError(ar ? "للراتب الشامل للأوفر تايم، أدخل ساعات الدوام من 9 إلى 12 وأيام العمل الشهرية." : "For inclusive overtime, enter daily hours from 9 to 12 and monthly work days.");
      return;
    }
    setBusy(true);
    try {
      const method = isFullEdit ? compensationMethod : profile!.compensationMethod;
      await setHrEmployeeCompensation(session, {
        employeeId: employee.id,
        policyVersionId: profile?.policyVersionId ?? undefined,
        effectiveFrom: `${effectiveMonth}-01`,
        monthlyGross: next.toFixed(4),
        compensationMethod: method,
        foodAllowance: (isFullEdit ? foodAllowance : profile!.foodAllowance) || "0",
        housingAllowance: (isFullEdit ? housingAllowance : profile!.housingAllowance) || "0",
        transportAllowance: (isFullEdit ? transportAllowance : profile!.transportAllowance) || "0",
        otherAllowance: (isFullEdit ? otherAllowance : profile!.otherAllowance) || "0",
        ...(method === "INCLUSIVE_OVERTIME" ? { scheduledHoursPerDay: Number(isFullEdit ? scheduledHoursPerDay : profile!.scheduledHoursPerDay), scheduledWorkDays: Number(isFullEdit ? scheduledWorkDays : profile!.scheduledWorkDays) } : {}),
        notes: `${operationLabel(language, operation)}${reason.trim() ? ` — ${reason.trim()}` : ""}`,
        idempotencyKey: submissionKey.current,
      });
      onClose();
      try { await onSaved(); }
      catch (error) { onError(presentBaseerApiError(error, language, ar ? "حُفظ الراتب، لكن تعذر تحديث العرض الحالي." : "The salary was saved, but the current view could not be refreshed.")); }
    } catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر حفظ الراتب." : "The salary could not be saved.")); }
    finally { setBusy(false); }
  };

  return <BaseerFormDialog open={open} title={profile ? (ar ? "إدارة الراتب" : "Manage salary") : (ar ? "تحديد الراتب" : "Set salary")} language={language} busy={busy} size="standard" formId="hr-salary-management" submitLabel={ar ? "حفظ الراتب" : "Save salary"} onClose={onClose}>
    <form id="hr-salary-management" className="baseer-form" onSubmit={(event) => void submit(event)}>
      <BaseerFormSection title={employee.nameAr}>
        {profile ? <div className="baseer-inline-actions" role="group" aria-label={ar ? "نوع تعديل الراتب" : "Salary change type"}>{(["FULL", "INCREASE", "DECREASE"] as const).map((value) => <BaseerButton key={value} type="button" variant={operation === value ? "primary" : "secondary"} disabled={busy} onClick={() => setOperation(value)}>{operationLabel(language, value)}</BaseerButton>)}</div> : null}
        <BaseerFormGrid>
          <label className="baseer-form-field">{ar ? "شهر التطبيق" : "Effective month"}<input required type="month" min={minimumMonth} value={effectiveMonth} onChange={(event) => setEffectiveMonth(event.target.value)} /></label>
          {profile ? <div className="baseer-form-field"><span>{ar ? "الراتب الحالي" : "Current salary"}</span><strong className="baseer-form-static"><BaseerMoney value={profile.monthlyGross} language={language} /></strong></div> : null}
          {isFullEdit ? <>
            <label className="baseer-form-field">{ar ? "إجمالي الراتب الشهري" : "Monthly salary"}<input required autoFocus inputMode="decimal" value={monthlyGross} onChange={(event) => setMonthlyGross(event.target.value)} /></label>
            <label className="baseer-form-field">{ar ? "طريقة الاحتساب" : "Calculation method"}<select value={compensationMethod} onChange={(event) => setCompensationMethod(event.target.value as HrCompensationMethod)}><option value="FIXED_MONTHLY">{ar ? "راتب شهري ثابت" : "Fixed monthly salary"}</option><option value="INCLUSIVE_OVERTIME">{ar ? "شامل الأوفر تايم" : "Inclusive overtime"}</option></select></label>
            <label className="baseer-form-field">{ar ? "بدل الأكل" : "Food allowance"}<input inputMode="decimal" value={foodAllowance} onChange={(event) => setFoodAllowance(event.target.value)} /></label>
            <label className="baseer-form-field">{ar ? "بدل السكن" : "Housing allowance"}<input inputMode="decimal" value={housingAllowance} onChange={(event) => setHousingAllowance(event.target.value)} /></label>
            <label className="baseer-form-field">{ar ? "بدل المواصلات" : "Transport allowance"}<input inputMode="decimal" value={transportAllowance} onChange={(event) => setTransportAllowance(event.target.value)} /></label>
            <label className="baseer-form-field">{ar ? "بدلات أخرى" : "Other allowances"}<input inputMode="decimal" value={otherAllowance} onChange={(event) => setOtherAllowance(event.target.value)} /></label>
            {requiresOvertimeSchedule ? <><label className="baseer-form-field">{ar ? "ساعات الدوام اليومية" : "Daily hours"}<input required type="number" min="9" max="12" value={scheduledHoursPerDay} onChange={(event) => setScheduledHoursPerDay(event.target.value)} /></label><label className="baseer-form-field">{ar ? "أيام العمل الشهرية" : "Monthly working days"}<input required type="number" min="1" max="31" value={scheduledWorkDays} onChange={(event) => setScheduledWorkDays(event.target.value)} /></label></> : null}
          </> : <>
            <label className="baseer-form-field baseer-form-field--full">{operation === "INCREASE" ? (ar ? "مبلغ الزيادة" : "Increase amount") : (ar ? "مبلغ التخفيض" : "Decrease amount")}<input required autoFocus inputMode="decimal" value={changeAmount} onChange={(event) => setChangeAmount(event.target.value)} /></label>
            <div className="baseer-form-field baseer-form-field--full"><span>{ar ? "الراتب بعد التعديل" : "Salary after adjustment"}</span><strong className="baseer-form-static"><BaseerMoney value={Number.isFinite(next) && next >= 0 ? next.toFixed(4) : "0"} language={language} /></strong></div>
          </>}
          <label className="baseer-form-field baseer-form-field--full">{ar ? "السبب أو الملاحظة (اختياري)" : "Reason or note (optional)"}<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        </BaseerFormGrid>
      </BaseerFormSection>
    </form>
  </BaseerFormDialog>;
}

/** @deprecated Profile quick-actions are retained only for compatibility while
 * the visible employee-file action is consolidated in the salary tab. */
export function HrSalaryAdjustmentDialog({ mode: _mode, ...props }: { open: boolean; language: Language; employee: HrEmployee; profile: HrCompensationProfile; mode: SalaryAdjustmentMode; onClose: () => void; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  void _mode;
  return <HrSalaryManagementDialog {...props} />;
}
