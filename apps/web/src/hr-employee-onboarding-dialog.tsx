import { baseerDecimalString, useBaseerForm, z } from "./baseer-form-state";
import { useEffect, useMemo, useRef, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerIntegerInput, BaseerMoneyInput, BaseerTextArea, BaseerTextInput } from "./baseer-form-fields";
import { BaseerMoney } from "./baseer-money";
import { formatNumber } from "./number-format";
import { activeSession, requestId } from "./daily-sales-client";
import { normalizeMoneyDecimal } from "./decimal-string";
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

function onboardingSchema(ar: boolean) {
  const required = ar ? "هذا الحقل مطلوب." : "This field is required.";
  const invalidEmail = ar ? "أدخل بريداً إلكترونياً صحيحاً أو اتركه فارغاً." : "Enter a valid email address or leave it blank.";
  const invalidDate = ar ? "أدخل تاريخاً صحيحاً." : "Enter a valid date.";
  const invalidMoney = ar ? "أدخل مبلغاً عشرياً صحيحاً ضمن حد الدقة المالية." : "Enter a valid decimal amount within the financial precision limit.";
  const money = baseerDecimalString(invalidMoney, 4, 14);
  const optionalMoney = z.string().refine((value) => !value.trim() || money.safeParse(value.trim()).success, invalidMoney);
  return z.object({
    nameAr: z.string().trim().min(1, required),
    nameEn: z.string(),
    jobTitle: z.string(),
    hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, invalidDate),
    iqamaNumber: z.string(),
    phone: z.string(),
    email: z.string().trim().refine((value) => !value || z.email().safeParse(value).success, invalidEmail),
    monthlyGross: money.refine((value) => !/^0+(?:\.0+)?$/.test(value), ar ? "يجب أن يكون الراتب أكبر من صفر." : "The salary must be greater than zero."),
    housingAllowance: optionalMoney,
    transportAllowance: optionalMoney,
    foodAllowance: optionalMoney,
    otherAllowance: optionalMoney,
    scheduledHoursPerDay: z.string(),
    scheduledWorkDays: z.string(),
    notes: z.string(),
  });
}

/** Creates the employee and their first salary record together. */
export function HrEmployeeOnboardingDialog({ open, language, onClose, onSaved, onError }: { open: boolean; language: Language; onClose: () => void; onSaved: () => Promise<boolean>; onError: (message: string) => void }) {
  const ar = language === "ar";
  const schema = useMemo(() => onboardingSchema(ar), [ar]);
  const { formState: { errors }, handleSubmit, register, reset, setValue, watch } = useBaseerForm<Draft>({ defaultValues: empty(), schema: schema, shouldFocusError: true });
  const draft = watch();
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const submissionKey = useRef(requestId());
  useEffect(() => {
    if (!photoFile) { setPhotoPreviewUrl(""); return; }
    const nextUrl = URL.createObjectURL(photoFile);
    setPhotoPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [photoFile]);
  useEffect(() => {
    if (!open) return;
    reset(empty());
    setPhotoFile(null);
    submissionKey.current = requestId();
  }, [open]);
  // Eight hours is a normal monthly agreement. The agreed total still has a
  // useful salary breakdown, but it must not be treated as inclusive overtime.
  const enteredHours = draft.scheduledHoursPerDay.trim() ? Number(draft.scheduledHoursPerDay) : null;
  const enteredWorkDays = draft.scheduledWorkDays.trim() ? Number(draft.scheduledWorkDays) : null;
  const compensationMethod = enteredHours !== null && enteredHours > 8 ? "INCLUSIVE_OVERTIME" : "FIXED_MONTHLY";
  const calculation = useMemo(() => calculateSalaryTool({ monthlyGross: draft.monthlyGross, compensationMethod, foodAllowance: draft.foodAllowance, housingAllowance: draft.housingAllowance, transportAllowance: draft.transportAllowance, otherAllowance: draft.otherAllowance, scheduledHoursPerDay: draft.scheduledHoursPerDay, scheduledWorkDays: draft.scheduledWorkDays }), [compensationMethod, draft.foodAllowance, draft.housingAllowance, draft.monthlyGross, draft.otherAllowance, draft.scheduledHoursPerDay, draft.scheduledWorkDays, draft.transportAllowance]);
  const allowancesTotal = number(draft.foodAllowance) + number(draft.housingAllowance) + number(draft.transportAllowance) + number(draft.otherAllowance);
  const identityComplete = Boolean(draft.nameAr.trim() && draft.hireDate);
  const set = (key: keyof Draft, value: string) => setValue(key, value, { shouldDirty: true, shouldValidate: true });
  const close = () => { if (busy) return; reset(empty()); setPhotoFile(null); onClose(); };
  const submit = async (draft: Draft) => {
    const session = activeSession(); if (!session || busy) return;
    if (enteredHours !== null && (!Number.isInteger(enteredHours) || enteredHours < 8 || enteredHours > 12)) { onError(ar ? "ساعات الدوام، عند إدخالها، تكون من 8 إلى 12 ساعة." : "When entered, daily hours must be from 8 to 12."); return; }
    if (enteredWorkDays !== null && (!Number.isInteger(enteredWorkDays) || enteredWorkDays < 1 || enteredWorkDays > 31)) { onError(ar ? "أيام العمل الشهرية، عند إدخالها، تكون من 1 إلى 31 يوماً." : "When entered, monthly work days must be from 1 to 31."); return; }
    if (compensationMethod === "INCLUSIVE_OVERTIME" && (!Number.isInteger(enteredHours) || (enteredHours ?? 0) <= 8 || (enteredHours ?? 0) > 12 || !Number.isInteger(enteredWorkDays) || (enteredWorkDays ?? 0) < 1 || (enteredWorkDays ?? 0) > 31)) {
      onError(ar ? "للراتب الشامل للأوفر تايم، أدخل ساعات الدوام من 9 إلى 12 وأيام العمل الشهرية." : "For inclusive overtime, enter daily hours from 9 to 12 and monthly work days."); return;
    }
    if (!calculation.valid) { onError(ar ? "أكمل بيانات الراتب قبل الحفظ." : "Complete the salary details before saving."); return; }
    if (photoFile && !isHrEmployeePhoto(photoFile)) { onError(ar ? "اختر صورة JPG أو PNG بحجم لا يتجاوز 5 ميجابايت." : "Choose a JPG or PNG image up to 5 MiB."); return; }
    setBusy(true);
    try {
      const employee = await onboardHrEmployee(session, { nameAr: draft.nameAr, nameEn: draft.nameEn || undefined, jobTitle: draft.jobTitle || undefined, phone: draft.phone || undefined, email: draft.email || undefined, iqamaNumber: draft.iqamaNumber || undefined, hireDate: draft.hireDate, notes: draft.notes || undefined, initialCompensation: { monthlyGross: normalizeMoneyDecimal(draft.monthlyGross), compensationMethod, foodAllowance: normalizeMoneyDecimal(draft.foodAllowance || "0"), housingAllowance: normalizeMoneyDecimal(draft.housingAllowance || "0"), transportAllowance: normalizeMoneyDecimal(draft.transportAllowance || "0"), otherAllowance: normalizeMoneyDecimal(draft.otherAllowance || "0"), ...(compensationMethod === "INCLUSIVE_OVERTIME" ? { scheduledHoursPerDay: enteredHours!, scheduledWorkDays: enteredWorkDays! } : {}) }, idempotencyKey: submissionKey.current });
      const followUpErrors: string[] = [];
      if (photoFile) {
        try { await createHrEmployeeDocument(session, employee.id, { documentType: "OTHER", title: ar ? "صورة الموظف الشخصية" : "Employee profile photo", referenceNumber: HR_PROFILE_PHOTO_REFERENCE, upload: { fileName: photoFile.name, contentBase64: await hrEmployeePhotoAsBase64(photoFile) }, idempotencyKey: requestId() }); }
        catch (error) { followUpErrors.push(presentBaseerApiError(error, language, ar ? "حُفظ الموظف والراتب، لكن تعذر حفظ الصورة." : "The employee and salary were saved, but the photo could not be saved.")); }
      }
      try {
        const saved = await getHrEmployee(session, employee.id);
        if (saved.employee.id !== employee.id || saved.compensation?.id !== employee.compensationId) followUpErrors.push(ar ? "حُفظ الموظف، لكن تعذر التحقق من تحديث الراتب في العرض الحالي." : "The employee was saved, but the current view could not verify the salary update.");
      } catch (error) { followUpErrors.push(presentBaseerApiError(error, language, ar ? "حُفظ الموظف والراتب، لكن تعذر التحقق من السجل." : "The employee and salary were saved, but the record could not be verified.")); }
      let refreshed = false;
      try { refreshed = await onSaved(); }
      catch { refreshed = false; }
      if (!refreshed) followUpErrors.push(ar ? "حُفظ الموظف والراتب، لكن تعذر تحديث جدول الموظفين." : "The employee and salary were saved, but the employee register could not be refreshed.");
      reset(empty()); setPhotoFile(null); onClose();
      if (followUpErrors.length) onError(followUpErrors.join(" "));
    } catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر إضافة الموظف وحفظ الراتب." : "The employee and salary could not be saved.")); }
    finally { setBusy(false); }
  };
  return <BaseerFormDialog open={open} title={ar ? "إضافة موظف" : "Add employee"} size="wide" className="hr-onboarding-dialog" language={language} busy={busy} formId="hr-employee-onboarding" submitLabel={ar ? "إضافة الموظف وحفظ الراتب" : "Add employee & save salary"} onClose={close}>
    <form id="hr-employee-onboarding" className="hr-onboarding" data-baseer-rhf-form="true" noValidate onSubmit={handleSubmit((values) => void submit(values))}>
      <div className="hr-onboarding__workspace">
        <div className="hr-onboarding__entry">
          <section className="hr-onboarding__section"><header><span>01</span><h3>{ar ? "الهوية والتعيين" : "Identity & employment"}</h3><label className="hr-onboarding__avatar-picker" title={ar ? "إضافة صورة الموظف" : "Add employee photo"}><input accept="image/jpeg,image/png" type="file" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} />{photoPreviewUrl ? <img src={photoPreviewUrl} alt={ar ? "معاينة صورة الموظف" : "Employee photo preview"} /> : <span aria-hidden="true" />}<b aria-hidden="true">+</b></label></header><div className="hr-onboarding__grid"><label><span className="hr-onboarding__field-label">{ar ? "الاسم الكامل" : "Full name"}<em>*</em></span><BaseerTextInput autoFocus aria-invalid={Boolean(errors.nameAr)} aria-describedby={errors.nameAr ? "hr-onboarding-name-error" : undefined} placeholder={ar ? "الاسم الكامل" : "Full name"} {...register("nameAr")} />{errors.nameAr ? <small id="hr-onboarding-name-error" role="alert">{errors.nameAr.message}</small> : null}</label><label>{ar ? "الاسم بالإنجليزية" : "Name (English)"}<BaseerTextInput dir="ltr" placeholder="Employee name in English" {...register("nameEn")} /></label><label>{ar ? "المسمى الوظيفي" : "Job title"}<HrJobTitleSelect id="hr-onboarding-job-titles" language={language} value={draft.jobTitle} allowCustom={false} onChange={(value) => set("jobTitle", value)} /></label><label><span className="hr-onboarding__field-label">{ar ? "تاريخ التعيين" : "Hire date"}<em>*</em></span><BaseerDatePicker language={language} label={ar ? "تاريخ التعيين" : "Hire date"} max={today()} value={draft.hireDate} onChange={(value) => set("hireDate", value)} />{errors.hireDate ? <small id="hr-onboarding-hire-date-error" role="alert">{errors.hireDate.message}</small> : null}</label><label>{ar ? "رقم الإقامة" : "Iqama number"}<BaseerTextInput dir="ltr" inputMode="numeric" placeholder="1234567890" {...register("iqamaNumber")} /></label><label>{ar ? "رقم الجوال" : "Phone"}<BaseerTextInput dir="ltr" inputMode="tel" {...register("phone")} /></label><label>{ar ? "البريد الإلكتروني" : "Email"}<BaseerTextInput dir="ltr" type="email" aria-invalid={Boolean(errors.email)} aria-describedby={errors.email ? "hr-onboarding-email-error" : undefined} {...register("email")} />{errors.email ? <small id="hr-onboarding-email-error" role="alert">{errors.email.message}</small> : null}</label></div></section>
          <section className="hr-onboarding__section"><header><span>02</span><h3>{ar ? "الراتب الأول" : "Initial salary"}</h3></header><div className="hr-onboarding__grid"><label><span className="hr-onboarding__field-label">{ar ? "إجمالي الراتب الشهري" : "Total monthly salary"}<em>*</em></span><BaseerMoneyInput aria-invalid={Boolean(errors.monthlyGross)} aria-describedby={errors.monthlyGross ? "hr-onboarding-salary-error" : undefined} placeholder="2500" value={draft.monthlyGross} onValueChange={(monthlyGross) => setValue("monthlyGross", monthlyGross, { shouldDirty: true, shouldValidate: true })} />{errors.monthlyGross ? <small id="hr-onboarding-salary-error" role="alert">{errors.monthlyGross.message}</small> : null}</label><label>{ar ? "بدل الأكل الشهري" : "Monthly food allowance"}<BaseerMoneyInput placeholder="500" value={draft.foodAllowance} onValueChange={(foodAllowance) => setValue("foodAllowance", foodAllowance, { shouldDirty: true, shouldValidate: true })} /></label><label>{ar ? "بدل السكن" : "Housing allowance"}<BaseerMoneyInput value={draft.housingAllowance} onValueChange={(housingAllowance) => setValue("housingAllowance", housingAllowance, { shouldDirty: true, shouldValidate: true })} /></label><label>{ar ? "بدل المواصلات" : "Transport allowance"}<BaseerMoneyInput value={draft.transportAllowance} onValueChange={(transportAllowance) => setValue("transportAllowance", transportAllowance, { shouldDirty: true, shouldValidate: true })} /></label><label>{ar ? "بدلات أخرى" : "Other allowances"}<BaseerMoneyInput value={draft.otherAllowance} onValueChange={(otherAllowance) => setValue("otherAllowance", otherAllowance, { shouldDirty: true, shouldValidate: true })} /></label><label>{ar ? "ساعات الدوام يومياً (للأوفر تايم)" : "Daily hours (for overtime)"}<BaseerIntegerInput min="8" max="12" value={draft.scheduledHoursPerDay} onValueChange={(scheduledHoursPerDay) => setValue("scheduledHoursPerDay", scheduledHoursPerDay, { shouldDirty: true, shouldValidate: true })} /></label><label>{ar ? "أيام العمل شهرياً (للأوفر تايم)" : "Monthly work days (for overtime)"}<BaseerIntegerInput min="1" max="31" value={draft.scheduledWorkDays} onValueChange={(scheduledWorkDays) => setValue("scheduledWorkDays", scheduledWorkDays, { shouldDirty: true, shouldValidate: true })} /></label></div></section>
          <section className="hr-onboarding__section"><header><span>03</span><h3>{ar ? "ملاحظات" : "Notes"}</h3></header><label className="hr-onboarding__notes">{ar ? "ملاحظات الموظف" : "Employee notes"}<BaseerTextArea {...register("notes")} /></label></section>
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
