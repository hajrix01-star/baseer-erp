import { useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { BaseerMoney } from "./baseer-money";
import { activeSession, requestId } from "./daily-sales-client";
import { setHrEmployeeCompensation, type HrCompensationProfile, type HrEmployee } from "./hr-client";

type Language = "ar" | "en";
export type SalaryAdjustmentMode = "INCREASE" | "DECREASE";

const month = () => new Date().toISOString().slice(0, 7);
const amount = (value: string) => Number(value || 0);

/** A narrow action dialog: it derives a new effective-dated salary record without touching payroll history. */
export function HrSalaryAdjustmentDialog({ open, language, employee, profile, mode, onClose, onSaved, onError }: { open: boolean; language: Language; employee: HrEmployee; profile: HrCompensationProfile; mode: SalaryAdjustmentMode; onClose: () => void; onSaved: () => Promise<void>; onError: (message: string) => void }) {
  const ar = language === "ar";
  const [effectiveMonth, setEffectiveMonth] = useState(month());
  const [changeAmount, setChangeAmount] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setEffectiveMonth(month()); setChangeAmount(""); setReason(""); } }, [open]);

  const current = amount(profile.monthlyGross);
  const delta = amount(changeAmount);
  const next = useMemo(() => current + (mode === "INCREASE" ? delta : -delta), [current, delta, mode]);
  const label = mode === "INCREASE" ? (ar ? "تسجيل زيادة راتب" : "Record salary increase") : (ar ? "تسجيل تخفيض راتب" : "Record salary decrease");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const session = activeSession();
    if (!session || busy) return;
    if (!Number.isFinite(delta) || delta <= 0) { onError(ar ? "أدخل مبلغ التعديل أكبر من صفر." : "Enter an adjustment amount greater than zero."); return; }
    if (next <= 0) { onError(ar ? "لا يمكن أن يصبح الراتب صفراً أو أقل." : "The salary cannot become zero or less."); return; }
    setBusy(true);
    try {
      const changeLabel = mode === "INCREASE" ? (ar ? "زيادة راتب" : "Salary increase") : (ar ? "تخفيض راتب" : "Salary decrease");
      await setHrEmployeeCompensation(session, {
        employeeId: employee.id,
        policyVersionId: profile.policyVersionId ?? undefined,
        effectiveFrom: `${effectiveMonth}-01`,
        monthlyGross: next.toFixed(4),
        compensationMethod: profile.compensationMethod,
        foodAllowance: profile.foodAllowance,
        housingAllowance: profile.housingAllowance,
        transportAllowance: profile.transportAllowance,
        otherAllowance: profile.otherAllowance,
        ...(profile.compensationMethod === "INCLUSIVE_OVERTIME" ? { scheduledHoursPerDay: profile.scheduledHoursPerDay, scheduledWorkDays: profile.scheduledWorkDays } : {}),
        notes: `${changeLabel}: ${delta.toFixed(4)}${reason.trim() ? ` — ${reason.trim()}` : ""}`,
        idempotencyKey: requestId(),
      });
      await onSaved();
      onClose();
    } catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر حفظ تعديل الراتب." : "The salary adjustment could not be saved.")); }
    finally { setBusy(false); }
  };

  return <BaseerFormDialog open={open} title={label} language={language} busy={busy} size="standard" formId="hr-salary-adjustment" submitLabel={ar ? "حفظ وتسجيل" : "Save and record"} onClose={onClose}>
    <form id="hr-salary-adjustment" className="baseer-form" onSubmit={(event) => void submit(event)}>
      <BaseerFormSection title={employee.nameAr} description={ar ? "يُنشأ سجل راتب جديد من بداية الشهر المحدد؛ المسيرات السابقة لا تتغير." : "A new salary record starts in the selected month; past payroll never changes."}>
        <BaseerFormGrid>
          <label className="baseer-form-field">{ar ? "بداية التطبيق" : "Effective month"}<input required type="month" min={month()} value={effectiveMonth} onChange={(event) => setEffectiveMonth(event.target.value)} /></label>
          <div className="baseer-form-field"><span>{ar ? "الراتب الحالي" : "Current salary"}</span><strong className="baseer-form-static"><BaseerMoney value={profile.monthlyGross} language={language} /></strong></div>
          <label className="baseer-form-field baseer-form-field--full">{mode === "INCREASE" ? (ar ? "مبلغ الزيادة" : "Increase amount") : (ar ? "مبلغ التخفيض" : "Decrease amount")}<input required autoFocus inputMode="decimal" value={changeAmount} onChange={(event) => setChangeAmount(event.target.value)} /></label>
          <div className="baseer-form-field baseer-form-field--full"><span>{ar ? "الراتب بعد التعديل" : "Salary after adjustment"}</span><strong className="baseer-form-static"><BaseerMoney value={Number.isFinite(next) && next >= 0 ? next.toFixed(4) : "0"} language={language} /></strong></div>
          <label className="baseer-form-field baseer-form-field--full">{ar ? "السبب (اختياري)" : "Reason (optional)"}<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        </BaseerFormGrid>
      </BaseerFormSection>
    </form>
  </BaseerFormDialog>;
}
