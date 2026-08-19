import { useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerMoney } from "./baseer-money";
import { BaseerNotice } from "./baseer-workspace";
import { activeSession, api, requestId } from "./daily-sales-client";
import { createHrEmployeeDocument, setHrEmployeeCompensation } from "./hr-client";
import { HrJobTitleSelect } from "./hr-job-titles";
import { HR_PROFILE_PHOTO_REFERENCE, hrEmployeePhotoAsBase64, isHrEmployeePhoto } from "./hr-employee-photo";
import { calculateSalaryTool } from "./hr-salary-tools-calculations";
import "./hr-onboarding.css";

type Language = "ar" | "en";
type Draft = { nameAr: string; nameEn: string; jobTitle: string; hireDate: string; iqamaNumber: string; phone: string; email: string; monthlyGross: string; housingAllowance: string; transportAllowance: string; foodAllowance: string; otherAllowance: string; scheduledHoursPerDay: string; scheduledWorkDays: string; notes: string };
const today = () => new Date().toISOString().slice(0, 10);
const empty = (): Draft => ({ nameAr: "", nameEn: "", jobTitle: "", hireDate: today(), iqamaNumber: "", phone: "", email: "", monthlyGross: "", housingAllowance: "0", transportAllowance: "0", foodAllowance: "0", otherAllowance: "0", scheduledHoursPerDay: "12", scheduledWorkDays: "26", notes: "" });
const number = (value: string) => { const parsed = Number(value || "0"); return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0; };

/** Guided onboarding keeps the pleasant single form while persisting an effective-dated agreement. */
export function HrEmployeeOnboardingDialog({ open, language, onClose, onSaved, onError }: { open: boolean; language: Language; onClose: () => void; onSaved: () => Promise<void>; onError: (message: string) => void }) {
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
  const calculation = useMemo(() => calculateSalaryTool({ monthlyGross: draft.monthlyGross, compensationMethod: "INCLUSIVE_OVERTIME", foodAllowance: draft.foodAllowance, housingAllowance: draft.housingAllowance, transportAllowance: draft.transportAllowance, otherAllowance: draft.otherAllowance, scheduledHoursPerDay: draft.scheduledHoursPerDay, scheduledWorkDays: draft.scheduledWorkDays }), [draft]);
  const allowancesTotal = number(draft.foodAllowance) + number(draft.housingAllowance) + number(draft.transportAllowance) + number(draft.otherAllowance);
  const identityComplete = Boolean(draft.nameAr.trim() && draft.hireDate);
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const close = () => { if (busy) return; setDraft(empty()); setPhotoFile(null); onClose(); };
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); const session = activeSession(); if (!session || busy || !calculation.valid) return;
    if (photoFile && !isHrEmployeePhoto(photoFile)) { onError(ar ? "اختر صورة JPG أو PNG بحجم لا يتجاوز 5 ميجابايت." : "Choose a JPG or PNG image up to 5 MiB."); return; }
    setBusy(true);
    try {
      const employee = await api<{ id: string }>(session, "/hr/employees", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nameAr: draft.nameAr, nameEn: draft.nameEn || undefined, jobTitle: draft.jobTitle || undefined, phone: draft.phone || undefined, email: draft.email || undefined, hireDate: draft.hireDate, notes: draft.notes || undefined, idempotencyKey: requestId() }) });
      await setHrEmployeeCompensation(session, { employeeId: employee.id, effectiveFrom: `${draft.hireDate.slice(0, 7)}-01`, monthlyGross: calculation.monthlyGross.toFixed(4), compensationMethod: "INCLUSIVE_OVERTIME", foodAllowance: number(draft.foodAllowance).toFixed(4), housingAllowance: number(draft.housingAllowance).toFixed(4), transportAllowance: number(draft.transportAllowance).toFixed(4), otherAllowance: number(draft.otherAllowance).toFixed(4), scheduledHoursPerDay: Number(draft.scheduledHoursPerDay), scheduledWorkDays: Number(draft.scheduledWorkDays), idempotencyKey: requestId() });
      if (photoFile) await createHrEmployeeDocument(session, employee.id, { documentType: "OTHER", title: ar ? "صورة الموظف الشخصية" : "Employee profile photo", referenceNumber: HR_PROFILE_PHOTO_REFERENCE, upload: { fileName: photoFile.name, contentBase64: await hrEmployeePhotoAsBase64(photoFile) }, idempotencyKey: requestId() });
      if (draft.iqamaNumber.trim()) await api(session, "/hr/services", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employeeId: employee.id, serviceType: "IQAMA_ISSUANCE", referenceNumber: draft.iqamaNumber.trim(), issueDate: draft.hireDate, idempotencyKey: requestId() }) });
      await onSaved(); setDraft(empty()); setPhotoFile(null); onClose();
    } catch (error) { onError(presentBaseerApiError(error, language, ar ? "إضافة الموظف" : "Adding employee")); }
    finally { setBusy(false); }
  };
  return <BaseerDialog open={open} title={ar ? "إضافة موظف" : "Add employee"} size="wide" className="hr-onboarding-dialog" language={language} busy={busy} onClose={close} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={close}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="submit" form="hr-employee-onboarding" disabled={busy || !calculation.valid}>{ar ? "إضافة الموظف وحفظ الاتفاق" : "Add employee & save agreement"}</BaseerButton></>}>
    <form id="hr-employee-onboarding" className="hr-onboarding" onSubmit={(event) => void submit(event)}>
      <div className="hr-onboarding__workspace">
        <div className="hr-onboarding__entry">
          <section className="hr-onboarding__section"><header><span>01</span><div><h3>{ar ? "الهوية والتعيين" : "Identity & employment"}</h3><p>{ar ? "البيانات الأساسية التي ستظهر في ملف الموظف." : "The core information shown in the employee file."}</p></div><label className="hr-onboarding__avatar-picker" title={ar ? "إضافة صورة الموظف" : "Add employee photo"}><input accept="image/jpeg,image/png" type="file" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} />{photoPreviewUrl ? <img src={photoPreviewUrl} alt={ar ? "معاينة صورة الموظف" : "Employee photo preview"} /> : <span aria-hidden="true" />}<b aria-hidden="true">+</b></label></header><div className="hr-onboarding__grid"><label>{ar ? "الاسم الكامل" : "Full name"}<em>*</em><input required autoFocus value={draft.nameAr} placeholder={ar ? "الاسم الكامل" : "Full name"} onChange={(event) => set("nameAr", event.target.value)} /></label><label>{ar ? "الاسم بالإنجليزية" : "Name (English)"}<input dir="ltr" value={draft.nameEn} placeholder="Employee name in English" onChange={(event) => set("nameEn", event.target.value)} /></label><label>{ar ? "المسمى الوظيفي" : "Job title"}<HrJobTitleSelect id="hr-onboarding-job-titles" language={language} value={draft.jobTitle} allowCustom={false} onChange={(value) => set("jobTitle", value)} /></label><label>{ar ? "تاريخ التعيين" : "Hire date"}<em>*</em><input required type="date" max={today()} value={draft.hireDate} onChange={(event) => set("hireDate", event.target.value)} /></label><label>{ar ? "رقم الإقامة" : "Iqama number"}<input inputMode="numeric" value={draft.iqamaNumber} placeholder="1234567890" onChange={(event) => set("iqamaNumber", event.target.value)} /></label><label>{ar ? "رقم الجوال" : "Phone"}<input dir="ltr" inputMode="tel" value={draft.phone} onChange={(event) => set("phone", event.target.value)} /></label><label>{ar ? "البريد الإلكتروني" : "Email"}<input dir="ltr" type="email" value={draft.email} onChange={(event) => set("email", event.target.value)} /></label></div></section>
          <section className="hr-onboarding__section"><header><span>02</span><div><h3>{ar ? "الاتفاق المالي الأول" : "Initial compensation agreement"}</h3><p>{ar ? "أدخل الإجمالي والبدلات والجدول؛ يسري الاتفاق تلقائياً من شهر التعيين." : "Enter the total, allowances and schedule; the agreement starts automatically in the hire month."}</p></div></header><div className="hr-onboarding__grid"><label>{ar ? "إجمالي الراتب الشهري" : "Total monthly salary"}<em>*</em><input required min="0.01" inputMode="decimal" value={draft.monthlyGross} placeholder="2500" onChange={(event) => set("monthlyGross", event.target.value)} /></label><label>{ar ? "بدل الأكل الشهري" : "Monthly food allowance"}<input inputMode="decimal" value={draft.foodAllowance} placeholder="500" onChange={(event) => set("foodAllowance", event.target.value)} /></label><label>{ar ? "بدل السكن" : "Housing allowance"}<input inputMode="decimal" value={draft.housingAllowance} onChange={(event) => set("housingAllowance", event.target.value)} /></label><label>{ar ? "بدل المواصلات" : "Transport allowance"}<input inputMode="decimal" value={draft.transportAllowance} onChange={(event) => set("transportAllowance", event.target.value)} /></label><label>{ar ? "بدلات أخرى" : "Other allowances"}<input inputMode="decimal" value={draft.otherAllowance} onChange={(event) => set("otherAllowance", event.target.value)} /></label><label>{ar ? "ساعات الدوام يومياً" : "Daily scheduled hours"}<em>*</em><input required type="number" min="9" max="12" value={draft.scheduledHoursPerDay} onChange={(event) => set("scheduledHoursPerDay", event.target.value)} /></label><label>{ar ? "أيام العمل شهرياً" : "Monthly working days"}<em>*</em><input required type="number" min="1" max="31" value={draft.scheduledWorkDays} onChange={(event) => set("scheduledWorkDays", event.target.value)} /></label></div></section>
          <section className="hr-onboarding__section"><header><span>03</span><div><h3>{ar ? "ملاحظات" : "Notes"}</h3><p>{ar ? "اختياري؛ خاص بملف الموظف." : "Optional; stored in the employee file."}</p></div></header><label className="hr-onboarding__notes">{ar ? "ملاحظات الموظف" : "Employee notes"}<textarea value={draft.notes} onChange={(event) => set("notes", event.target.value)} /></label></section>
        </div>
        <aside className="hr-onboarding__result" aria-live="polite">
          <header><div><span>{ar ? "ملخص الموظف" : "Employee summary"}</span><small>{ar ? "يتحدّث أثناء الإدخال" : "Updates while you type"}</small></div><strong className={identityComplete ? "is-ready" : ""}>{identityComplete ? (ar ? "مكتمل" : "Ready") : (ar ? "بانتظار البيانات" : "Waiting")}</strong></header>
          <div className="hr-onboarding__summary-identity"><span>{ar ? "الاسم" : "Name"}</span><strong>{draft.nameAr.trim() || (ar ? "لم يُدخل بعد" : "Not entered yet")}</strong><span>{ar ? "المسمى" : "Job title"}</span><strong>{draft.jobTitle || "—"}</strong><span>{ar ? "تاريخ التعيين" : "Hire date"}</span><strong dir="ltr">{draft.hireDate || "—"}</strong></div>
          <div className="hr-onboarding__summary-divider" />
          <div className="hr-onboarding__result-heading"><span>{ar ? "نتيجة الاتفاق المالي" : "Compensation result"}</span><small>{ar ? "محسوبة تلقائياً" : "Calculated automatically"}</small></div>
          {calculation.valid ? <div className="hr-onboarding__calculation"><div className="hr-onboarding__total hr-onboarding__total--featured"><span>{ar ? "إجمالي الراتب" : "Total salary"}</span><BaseerMoney value={calculation.monthlyGross} language={language} /></div><div className="hr-onboarding__total"><span>{ar ? "إجمالي البدلات" : "Total allowances"}</span><BaseerMoney value={allowancesTotal} language={language} /></div><div className="hr-onboarding__total"><span>{ar ? "الراتب الأساسي" : "Basic salary"}</span><BaseerMoney value={calculation.basicSalary} language={language} /></div><div className="hr-onboarding__total"><span>{ar ? "مكوّن الأوفر تايم" : "Overtime component"}</span><BaseerMoney value={calculation.overtimeAmount} language={language} /></div><div className="hr-onboarding__total"><span>{ar ? "ساعات الأوفر تايم" : "Overtime hours"}</span><strong>{calculation.overtimeHours.toLocaleString("en-US", { maximumFractionDigits: 1 })}</strong></div></div> : <BaseerNotice tone="warning" title={ar ? "أكمل بيانات الاتفاق" : "Complete the agreement details"}>{ar ? "أدخل إجمالي الراتب، وتأكد أن البدلات لا تتجاوزه وأن الساعات من 9 إلى 12 يومياً." : "Enter the total salary, keep allowances within it, and set daily hours between 9 and 12."}</BaseerNotice>}
        </aside>
      </div>
    </form>
  </BaseerDialog>;
}
