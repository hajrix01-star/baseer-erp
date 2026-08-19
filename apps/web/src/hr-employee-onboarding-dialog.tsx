import { useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerMoney } from "./baseer-money";
import { formatNumber } from "./number-format";
import { activeSession, requestId } from "./daily-sales-client";
import { createHrEmployeeDocument, getHrEmployee, onboardHrEmployee } from "./hr-client";
import { HrJobTitleSelect } from "./hr-job-titles";
import { HR_PROFILE_PHOTO_REFERENCE, hrEmployeePhotoAsBase64, isHrEmployeePhoto } from "./hr-employee-photo";
import { calculateSalaryTool } from "./hr-salary-tools-calculations";
import "./hr-onboarding.css";

type Language = "ar" | "en";
type Draft = { nameAr: string; nameEn: string; jobTitle: string; hireDate: string; iqamaNumber: string; phone: string; email: string; monthlyGross: string; housingAllowance: string; transportAllowance: string; foodAllowance: string; otherAllowance: string; scheduledHoursPerDay: string; scheduledWorkDays: string; notes: string };
const today = () => new Date().toISOString().slice(0, 10);
const empty = (): Draft => ({ nameAr: "", nameEn: "", jobTitle: "", hireDate: "", iqamaNumber: "", phone: "", email: "", monthlyGross: "", housingAllowance: "", transportAllowance: "", foodAllowance: "", otherAllowance: "", scheduledHoursPerDay: "", scheduledWorkDays: "", notes: "" });
const number = (value: string) => { const parsed = Number(value || "0"); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; };

/** Creates the employee and their first salary record together. */
export function HrEmployeeOnboardingDialog({ open, language, onClose, onSaved, onError }: { open: boolean; language: Language; onClose: () => void; onSaved: () => Promise<boolean>; onError: (message: string) => void }) {
  const ar = language === "ar";
  const [draft, setDraft] = useState<Draft>(empty);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!photoFile) { setPhotoPreviewUrl(""); return; }
    const nextUrl = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [photoFile]);
  useEffect(() => {
    if (!open) return;
    setDraft(empty());
    setPhotoFile(null);
  }, [open]);
  // Eight hours is a normal monthly agreement. The agreed total still has a
  // useful salary breakdown, but it must not be treated as inclusive overtime.
  const enteredHours = draft.scheduledHoursPerDay.trim() ? Number(draft.scheduledHoursPerDay) : null;
  const enteredWorkDays = draft.scheduledWorkDays.trim() ? Number(draft.scheduledWorkDays) : null;
  const compensationMethod = enteredHours !== null && enteredHours > 8 ? "INCLUSIVE_OVERTIME" : "FIXED_MONTHLY";
  const calculation = useMemo(() => calculateSalaryTool({ monthlyGross: draft.monthlyGross, compensationMethod, foodAllowance: draft.foodAllowance, housingAllowance: draft.housingAllowance, transportAllowance: draft.transportAllowance, otherAllowance: draft.otherAllowance, scheduledHoursPerDay: draft.scheduledHoursPerDay, scheduledWorkDays: draft.scheduledWorkDays }), [compensationMethod, draft.foodAllowance, draft.housingAllowance, draft.monthlyGross, draft.otherAllowance, draft.scheduledHoursPerDay, draft.scheduledWorkDays, draft.transportAllowance]);
  const allowancesTotal = number(draft.foodAllowance) + number(draft.housingAllowance) + number(draft.transportAllowance) + number(draft.otherAllowance);
  const identityComplete = Boolean(draft.nameAr.trim() && draft.hireDate);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const close = () => { if (busy) return; setDraft(empty()); setPhotoFile(null); onClose(); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); const session = activeSession(); if (!session || busy) return;
    if (!draft.nameAr.trim() || !draft.hireDate) { onError(ar ? "أدخل الاسم الكامل وتاريخ التعيين قبل الحفظ." : "Enter the full name and hire date before saving."); return; }
    if (enteredHours !== null && (!Number.isInteger(enteredHours) || enteredHours < 8 || enteredHours > 12)) { onError(ar ? "ساعات الدوام، عند إدخالها، تكون من 8 إلى 12 ساعة." : "When entered, daily hours must be from 8 to 12."); return; }
    if (enteredWorkDays !== null && (!Number.isInteger(enteredWorkDays) || enteredWorkDays < 1 || enteredWorkDays > 31)) { onError(ar ? "أيام العمل الشهرية، عند إدخالها، تكون من 1 إلى 31 يوماً." : "When entered, monthly work days must be from 1 to 31."); return; }
    if (compensationMethod === "INCLUSIVE_OVERTIME" && (!Number.isInteger(enteredHours) || (enteredHours ?? 0) <= 8 || (enteredHours ?? 0) > 12 || !Number.isInteger(enteredWorkDays) || (enteredWorkDays ?? 0) < 1 || (enteredWorkDays ?? 0) > 31)) {
      onError(ar ? "للراتب الشامل للأوفر تايم، أدخل ساعات الدوام من 9 إلى 12 وأيام العمل الشهرية." : "For inclusive overtime, enter daily hours from 9 to 12 and monthly work days."); return;
    }
    if (!calculation.valid) { onError(ar ? "أكمل بيانات الراتب قبل الحفظ." : "Complete the salary details before saving."); return; }
    if (photoFile && !isHrEmployeePhoto(photoFile)) { onError(ar ? "اختر صورة JPG أو PNG بحجم لا يتجاوز 5 ميجابايت." : "Choose a JPG or PNG image up to 5 MiB."); return; }
    setBusy(true);
    try {
      const employee = await onboardHrEmployee(session, { nameAr: draft.nameAr, nameEn: draft.nameEn || undefined, jobTitle: draft.jobTitle || undefined, phone: draft.phone || undefined, email: draft.email || undefined, iqamaNumber: draft.iqamaNumber || undefined, hireDate: draft.hireDate, notes: draft.notes || undefined, initialCompensation: { monthlyGross: calculation.monthlyGross.toFixed(4), compensationMethod, foodAllowance: number(draft.foodAllowance).toFixed(4), housingAllowance: number(draft.housingAllowance).toFixed(4), transportAllowance: number(draft.transportAllowance).toFixed(4), otherAllowance: number(draft.otherAllowance).toFixed(4), ...(compensationMethod === "INCLUSIVE_OVERTIME" ? { scheduledHoursPerDay: enteredHours!, scheduledWorkDays: enteredWorkDays! } : {}) }, idempotencyKey: requestId() });
      if (photoFile) await createHrEmployeeDocument(session, employee.id, { documentType: "OTHER", title: ar ? "صورة الموظف الشخصية" : "Employee profile photo", referenceNumber: HR_PROFILE_PHOTO_REFERENCE, upload: { fileName: photoFile.name, contentBase64: await hrEmployeePhotoAsBase64(photoFile) }, idempotencyKey: requestId() });
      const saved = await getHrEmployee(session, employee.id);
      if (saved.employee.id !== employee.id || saved.compensation?.id !== employee.compensationId) {
        onError(ar ? "تعذر التحقق من حفظ الموظف والراتب. لم تُعرض العملية كنجاح." : "The employee and salary could not be verified. The operation was not shown as successful.");
        return;
      }
      if (!await onSaved()) {
        onError(ar ? "حُفظ الموظف والراتب، لكن تعذر تحديث جدول الموظفين. لم تُعرض العملية كنجاح." : "The employee and salary were saved, but the employee register could not be refreshed. The operation was not shown as successful.");
        return;
      }
      setDraft(empty()); setPhotoFile(null); onClose();
    } catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر إضافة الموظف وحفظ الراتب." : "The employee and salary could not be saved.")); }
    finally { setBusy(false); }
  };
  return <BaseerFormDialog open={open} title={ar ? "إضافة موظف" : "Add employee"} size="wide" className="hr-onboarding-dialog" language={language} busy={busy} formId="hr-employee-onboarding" submitLabel={ar ? "إضافة الموظف وحفظ الراتب" : "Add employee & save salary"} onClose={close}>
    <form id="hr-employee-onboarding" className="hr-onboarding" noValidate onSubmit={(event) => void submit(event)}>
      <div className="hr-onboarding__workspace">
        <div className="hr-onboarding__entry">
          <section className="hr-onboarding__section"><header><span>01</span><div><h3>{ar ? "الهوية والتعيين" : "Identity & employment"}</h3><p>{ar ? "البيانات الأساسية التي ستظهر في ملف الموظف." : "The core information shown in the employee file."}</p></div><label className="hr-onboarding__avatar-picker" title={ar ? "إضافة صورة الموظف" : "Add employee photo"}><input accept="image/jpeg,image/png" type="file" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} />{photoPreviewUrl ? <img src={photoPreviewUrl} alt={ar ? "معاينة صورة الموظف" : "Employee photo preview"} /> : <span aria-hidden="true" />}<b aria-hidden="true">+</b></label></header><div className="hr-onboarding__grid"><label><span className="hr-onboarding__field-label">{ar ? "الاسم الكامل" : "Full name"}<em>*</em></span><input required autoFocus value={draft.nameAr} placeholder={ar ? "الاسم الكامل" : "Full name"} onChange={(event) => set("nameAr", event.target.value)} /></label><label>{ar ? "الاسم بالإنجليزية" : "Name (English)"}<input dir="ltr" value={draft.nameEn} placeholder="Employee name in English" onChange={(event) => set("nameEn", event.target.value)} /></label><label>{ar ? "المسمى الوظيفي" : "Job title"}<HrJobTitleSelect id="hr-onboarding-job-titles" language={language} value={draft.jobTitle} allowCustom={false} onChange={(value) => set("jobTitle", value)} /></label><label><span className="hr-onboarding__field-label">{ar ? "تاريخ التعيين" : "Hire date"}<em>*</em></span><input required type="date" max={today()} value={draft.hireDate} onChange={(event) => set("hireDate", event.target.value)} /></label><label>{ar ? "رقم الإقامة" : "Iqama number"}<input inputMode="numeric" value={draft.iqamaNumber} placeholder="1234567890" onChange={(event) => set("iqamaNumber", event.target.value)} /></label><label>{ar ? "رقم الجوال" : "Phone"}<input dir="ltr" inputMode="tel" value={draft.phone} onChange={(event) => set("phone", event.target.value)} /></label><label>{ar ? "البريد الإلكتروني" : "Email"}<input dir="ltr" type="email" value={draft.email} onChange={(event) => set("email", event.target.value)} /></label></div></section>
          <section className="hr-onboarding__section"><header><span>02</span><div><h3>{ar ? "الراتب الأول" : "Initial salary"}</h3><p>{ar ? "أدخل الراتب والبدلات. أضف الساعات والأيام فقط إذا كان الراتب شاملاً للأوفر تايم." : "Enter salary and allowances. Add hours and days only for inclusive overtime."}</p></div></header><div className="hr-onboarding__grid"><label><span className="hr-onboarding__field-label">{ar ? "إجمالي الراتب الشهري" : "Total monthly salary"}<em>*</em></span><input required min="0.01" inputMode="decimal" value={draft.monthlyGross} placeholder="2500" onChange={(event) => set("monthlyGross", event.target.value)} /></label><label>{ar ? "بدل الأكل الشهري" : "Monthly food allowance"}<input inputMode="decimal" value={draft.foodAllowance} placeholder="500" onChange={(event) => set("foodAllowance", event.target.value)} /></label><label>{ar ? "بدل السكن" : "Housing allowance"}<input inputMode="decimal" value={draft.housingAllowance} onChange={(event) => set("housingAllowance", event.target.value)} /></label><label>{ar ? "بدل المواصلات" : "Transport allowance"}<input inputMode="decimal" value={draft.transportAllowance} onChange={(event) => set("transportAllowance", event.target.value)} /></label><label>{ar ? "بدلات أخرى" : "Other allowances"}<input inputMode="decimal" value={draft.otherAllowance} onChange={(event) => set("otherAllowance", event.target.value)} /></label><label>{ar ? "ساعات الدوام يومياً (للأوفر تايم)" : "Daily hours (for overtime)"}<input type="number" min="8" max="12" value={draft.scheduledHoursPerDay} onChange={(event) => set("scheduledHoursPerDay", event.target.value)} /></label><label>{ar ? "أيام العمل شهرياً (للأوفر تايم)" : "Monthly work days (for overtime)"}<input type="number" min="1" max="31" value={draft.scheduledWorkDays} onChange={(event) => set("scheduledWorkDays", event.target.value)} /></label></div></section>
          <section className="hr-onboarding__section"><header><span>03</span><div><h3>{ar ? "ملاحظات" : "Notes"}</h3><p>{ar ? "اختياري؛ خاص بملف الموظف." : "Optional; stored in the employee file."}</p></div></header><label className="hr-onboarding__notes">{ar ? "ملاحظات الموظف" : "Employee notes"}<textarea value={draft.notes} onChange={(event) => set("notes", event.target.value)} /></label></section>
        </div>
        <aside className="hr-onboarding__result" aria-live="polite">
          <header><div><span>{ar ? "ملخص الموظف" : "Employee summary"}</span><small>{ar ? "يتحدّث أثناء الإدخال" : "Updates while you type"}</small></div><strong className={identityComplete ? "is-ready" : ""}>{identityComplete ? (ar ? "مكتمل" : "Ready") : (ar ? "بانتظار البيانات" : "Waiting")}</strong></header>
          <div className="hr-onboarding__summary-identity"><span>{ar ? "الاسم" : "Name"}</span><strong>{draft.nameAr.trim() || (ar ? "لم يُدخل بعد" : "Not entered yet")}</strong><span>{ar ? "المسمى" : "Job title"}</span><strong>{draft.jobTitle || "—"}</strong><span>{ar ? "تاريخ التعيين" : "Hire date"}</span><strong dir="ltr">{draft.hireDate || "—"}</strong></div>
          <div className="hr-onboarding__summary-divider" />
          <div className="hr-onboarding__result-heading"><span>{ar ? "نتيجة الراتب" : "Salary result"}</span><small>{ar ? "محسوبة تلقائياً" : "Calculated automatically"}</small></div>
          {calculation.valid ? <div className="hr-onboarding__calculation"><div className="hr-onboarding__total hr-onboarding__total--featured"><span>{ar ? "إجمالي الراتب" : "Total salary"}</span><BaseerMoney value={calculation.monthlyGross} language={language} /></div><div className="hr-onboarding__total"><span>{ar ? "الراتب الأساسي" : "Basic salary"}</span><BaseerMoney value={calculation.basicSalary} language={language} /></div><div className="hr-onboarding__total"><span>{ar ? "إجمالي البدلات" : "Total allowances"}</span><BaseerMoney value={allowancesTotal} language={language} /></div><div className="hr-onboarding__total"><span>{ar ? "مكوّن الأوفر تايم" : "Overtime component"}</span><BaseerMoney value={calculation.overtimeAmount} language={language} /></div><div className="hr-onboarding__total"><span>{ar ? "ساعات الأوفر تايم" : "Overtime hours"}</span><strong>{formatNumber(calculation.overtimeHours)}</strong></div></div> : null}
        </aside>
      </div>
    </form>
  </BaseerFormDialog>;
}
