import { useCallback, useEffect, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { DataTable } from "./data-table";
import { activeSession, requestId } from "./daily-sales-client";
import { createHrEmployeePromotion, listHrEmployeePromotions, setHrEmployeeCompensation, type HrCompensationProfile, type HrEmployeePromotion } from "./hr-client";
import { HrJobTitleSelect } from "./hr-job-titles";

type Language = "ar" | "en";
const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => today().slice(0, 7);

export function HrEmployeePromotionsPanel({ employeeId, language, salary, onError, onChanged }: { employeeId: string; language: Language; salary: HrCompensationProfile | null; onError: (message: string) => void; onChanged: () => Promise<void> }) {
  const ar = language === "ar";
  const [promotions, setPromotions] = useState<HrEmployeePromotion[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [newJobTitle, setNewJobTitle] = useState("");
  const [decisionReference, setDecisionReference] = useState("");
  const [reason, setReason] = useState("");
  const [salaryIncreaseAmount, setSalaryIncreaseAmount] = useState("");
  const [salaryEffectiveMonth, setSalaryEffectiveMonth] = useState(currentMonth());
  const [message, setMessage] = useState("");
  const load = useCallback(async (cursor?: string, append = false) => {
    const session = activeSession(); if (!session) { setLoading(false); return; }
    setLoading(true);
    try { const receipt = await listHrEmployeePromotions(session, employeeId, { cursor, pageSize: 25 }); setPromotions((rows) => append ? [...rows, ...receipt.promotions] : receipt.promotions); setNextCursor(receipt.nextCursor); }
    catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر تحميل سجل الترقيات." : "Promotion history could not be loaded.")); }
    finally { setLoading(false); }
  }, [ar, employeeId, language, onError]);
  useEffect(() => { void load(); }, [load]);
  const create = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const session = activeSession(); if (!session) return;
    const increase = Number(salaryIncreaseAmount || 0);
    if (salaryIncreaseAmount.trim() && (!Number.isFinite(increase) || increase <= 0)) { setMessage(ar ? "أدخل مبلغ زيادة أكبر من صفر أو اتركه فارغاً." : "Enter a positive increase amount or leave it blank."); return; }
    if (increase > 0 && !salary) { setMessage(ar ? "حدّد راتب الموظف أولاً، ثم سجّل الترقية مع الزيادة." : "Set the employee salary first, then record the promotion with its increase."); return; }
    setBusy(true); setMessage("");
    try {
      await createHrEmployeePromotion(session, employeeId, { effectiveDate, newJobTitle, decisionReference, ...(reason.trim() ? { reason: reason.trim() } : {}), idempotencyKey: requestId() });
      if (increase > 0 && salary) {
        try {
          await setHrEmployeeCompensation(session, {
            employeeId,
            policyVersionId: salary.policyVersionId ?? undefined,
            effectiveFrom: `${salaryEffectiveMonth}-01`,
            monthlyGross: (Number(salary.monthlyGross) + increase).toFixed(4),
            compensationMethod: salary.compensationMethod,
            foodAllowance: salary.foodAllowance,
            housingAllowance: salary.housingAllowance,
            transportAllowance: salary.transportAllowance,
            otherAllowance: salary.otherAllowance,
            ...(salary.compensationMethod === "INCLUSIVE_OVERTIME" ? { scheduledHoursPerDay: salary.scheduledHoursPerDay, scheduledWorkDays: salary.scheduledWorkDays } : {}),
            notes: `${ar ? `ترقية إلى ${newJobTitle}` : `Promotion to ${newJobTitle}`}: ${ar ? "زيادة راتب" : "Salary increase"} ${increase.toFixed(4)}${reason.trim() ? ` — ${reason.trim()}` : ""}`,
            idempotencyKey: requestId(),
          });
        } catch (error) {
          await load(); await onChanged();
          setMessage(presentBaseerApiError(error, language, ar ? "سُجلت الترقية، لكن تعذر تسجيل زيادة الراتب." : "The promotion was recorded, but its salary increase could not be saved."));
          return;
        }
      }
      setOpen(false); setNewJobTitle(""); setDecisionReference(""); setReason(""); setSalaryIncreaseAmount(""); setSalaryEffectiveMonth(currentMonth()); setEffectiveDate(today());
      await load(); await onChanged();
    } catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تعذر تسجيل الترقية." : "The promotion could not be recorded.")); }
    finally { setBusy(false); }
  };
  const columns = [
    { id: "effective", header: ar ? "السريان" : "Effective", cell: (row: HrEmployeePromotion) => row.effectiveDate },
    { id: "previous", header: ar ? "المسمى السابق" : "Previous title", cell: (row: HrEmployeePromotion) => row.previousJobTitle ?? "—" },
    { id: "new", header: ar ? "المسمى الجديد" : "New title", cell: (row: HrEmployeePromotion) => row.newJobTitle },
    { id: "reference", header: ar ? "مرجع القرار" : "Decision reference", cell: (row: HrEmployeePromotion) => <span dir="ltr">{row.decisionReference}</span> },
    { id: "reason", header: ar ? "السبب" : "Reason", cell: (row: HrEmployeePromotion) => row.reason ?? "—" },
  ];
  return <><div className="baseer-inline-actions"><BaseerButton type="button" onClick={() => { setMessage(""); setOpen(true); }}>{ar ? "تسجيل ترقية" : "Record promotion"}</BaseerButton></div>{message ? <BaseerCard>{message}</BaseerCard> : null}{loading && !promotions.length ? <BaseerCard>{ar ? "جارٍ تحميل سجل الترقيات…" : "Loading promotion history…"}</BaseerCard> : promotions.length ? <><DataTable ariaLabel={ar ? "سجل الترقيات" : "Promotion history"} caption={ar ? "سجل الترقيات" : "Promotion history"} rows={promotions} columns={columns} rowKey={(row) => row.id} />{nextCursor ? <BaseerButton type="button" variant="secondary" disabled={loading} onClick={() => void load(nextCursor, true)}>{ar ? "تحميل المزيد" : "Load more"}</BaseerButton> : null}</> : <BaseerCard>{ar ? "لا توجد ترقيات موثقة." : "No promotions are recorded."}</BaseerCard>}
    <BaseerDialog open={open} title={ar ? "تسجيل ترقية" : "Record promotion"} language={language} busy={busy} onClose={() => setOpen(false)} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="submit" form="hr-employee-promotion" disabled={busy}>{ar ? "حفظ الترقية" : "Save promotion"}</BaseerButton></>}><form id="hr-employee-promotion" className="administration-form" onSubmit={(event) => void create(event)}><label>{ar ? "تاريخ الترقية" : "Promotion date"}<input required type="date" min="1900-01-01" max={today()} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></label><label>{ar ? "المسمى الجديد" : "New job title"}<HrJobTitleSelect id="hr-promotion-job-titles" language={language} value={newJobTitle} required onChange={setNewJobTitle} /></label><label>{ar ? "مرجع قرار الترقية" : "Promotion decision reference"}<input required value={decisionReference} onChange={(event) => setDecisionReference(event.target.value)} /></label><label>{ar ? "مبلغ زيادة الراتب (اختياري)" : "Salary increase amount (optional)"}<input inputMode="decimal" value={salaryIncreaseAmount} onChange={(event) => setSalaryIncreaseAmount(event.target.value)} /></label>{salaryIncreaseAmount.trim() ? <label>{ar ? "بداية زيادة الراتب" : "Salary increase month"}<input required type="month" min={currentMonth()} value={salaryEffectiveMonth} onChange={(event) => setSalaryEffectiveMonth(event.target.value)} /></label> : null}<label>{ar ? "سبب أو ملاحظة (اختياري)" : "Reason or note (optional)"}<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label><p>{ar ? "تُسجّل الترقية في المسار الوظيفي. عند إدخال مبلغ زيادة، يُسجل الراتب الجديد أيضاً في سجل الراتب من الشهر المحدد؛ المسيرات السابقة لا تتغير." : "The promotion is recorded in employment history. When an increase is entered, the new salary is also recorded from the selected month; past payroll never changes."}</p></form></BaseerDialog>
  </>;
}
