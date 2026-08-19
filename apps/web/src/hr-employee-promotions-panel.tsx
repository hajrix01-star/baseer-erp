import { useCallback, useEffect, useMemo, useState } from "react";

import "./hr-employee-promotions-panel.css";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { BaseerMoney } from "./baseer-money";
import { BaseerEmptyState, BaseerNotice } from "./baseer-workspace";
import { DataTable } from "./data-table";
import { activeSession, requestId } from "./daily-sales-client";
import { HrCompensationAgreementDialog } from "./hr-compensation-agreement-dialog";
import { createHrEmployeePromotion, getHrEmployee, listHrEmployeePromotions, setHrEmployeeCompensation, type HrCompensationProfile, type HrDetail, type HrEmployeePromotion } from "./hr-client";
import { HrJobTitleSelect } from "./hr-job-titles";

type Language = "ar" | "en";
type Message = { tone: "info" | "danger"; text: string } | null;

const today = () => new Date().toISOString().slice(0, 10);
const nextMonth = () => {
  const value = new Date();
  value.setDate(1);
  value.setMonth(value.getMonth() + 1);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}`;
};
const amount = (value: string) => Number(value || 0);

/** Combines the employee's job path and compensation view while retaining two
 * governed records: promotion decisions and dated compensation profiles. */
export function HrEmployeePromotionsPanel({ employeeId, language, salary, onError, onChanged }: { employeeId: string; language: Language; salary: HrCompensationProfile | null; onError: (message: string) => void; onChanged: () => Promise<void> }) {
  const ar = language === "ar";
  const [detail, setDetail] = useState<HrDetail | null>(null);
  const [promotions, setPromotions] = useState<HrEmployeePromotion[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [promotionOpen, setPromotionOpen] = useState(false);
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState(today());
  const [newJobTitle, setNewJobTitle] = useState("");
  const [decisionReference, setDecisionReference] = useState("");
  const [reason, setReason] = useState("");
  const [salaryIncreaseAmount, setSalaryIncreaseAmount] = useState("");
  const [salaryEffectiveMonth, setSalaryEffectiveMonth] = useState(nextMonth());
  const [message, setMessage] = useState<Message>(null);

  const load = useCallback(async (cursor?: string, append = false) => {
    const session = activeSession();
    if (!session) { setLoading(false); return; }
    setLoading(true);
    try {
      const [promotionReceipt, employeeDetail] = await Promise.all([
        listHrEmployeePromotions(session, employeeId, { cursor, pageSize: 25 }),
        getHrEmployee(session, employeeId),
      ]);
      setPromotions((rows) => append ? [...rows, ...promotionReceipt.promotions] : promotionReceipt.promotions);
      setNextCursor(promotionReceipt.nextCursor);
      setDetail(employeeDetail);
    } catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر تحميل المسار والتعويض." : "Employment and compensation could not be loaded.")); }
    finally { setLoading(false); }
  }, [ar, employeeId, language, onError]);

  useEffect(() => { void load(); }, [load]);

  const employee = detail?.employee;
  const currentSalary = detail?.compensation ?? salary;
  const increase = amount(salaryIncreaseAmount);
  const nextSalary = currentSalary ? amount(currentSalary.monthlyGross) + increase : 0;
  const salaryHistory = useMemo(() => (detail?.compensationHistory ?? []).map((row, index, rows) => {
    const previous = rows[index + 1];
    const delta = previous ? Number(row.monthlyGross) - Number(previous.monthlyGross) : 0;
    const label = row.notes?.startsWith("ترقية") ? (ar ? "ترقية وزيادة راتب" : "Promotion & increase") : delta > 0 ? (ar ? "زيادة راتب" : "Salary increase") : delta < 0 ? (ar ? "تخفيض راتب" : "Salary decrease") : (ar ? "الراتب الأول / تعديل" : "Initial salary / edit");
    return { ...row, label, changeAmount: previous ? Math.abs(delta).toFixed(4) : null };
  }), [ar, detail?.compensationHistory]);

  const resetPromotion = () => {
    setEffectiveDate(today());
    setNewJobTitle("");
    setDecisionReference("");
    setReason("");
    setSalaryIncreaseAmount("");
    setSalaryEffectiveMonth(nextMonth());
  };

  const createPromotion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const session = activeSession();
    if (!session || busy) return;
    if (salaryIncreaseAmount.trim() && (!Number.isFinite(increase) || increase <= 0)) { setMessage({ tone: "danger", text: ar ? "أدخل مبلغ زيادة أكبر من صفر أو اتركه فارغاً." : "Enter a positive increase amount or leave it blank." }); return; }
    if (increase > 0 && !currentSalary) { setMessage({ tone: "danger", text: ar ? "حدّد راتب الموظف أولاً، ثم سجّل الترقية مع الزيادة." : "Set the employee salary first, then record the promotion with its increase." }); return; }
    setBusy(true);
    setMessage(null);
    try {
      await createHrEmployeePromotion(session, employeeId, { effectiveDate, newJobTitle, decisionReference, ...(reason.trim() ? { reason: reason.trim() } : {}), idempotencyKey: requestId() });
      if (increase > 0 && currentSalary) {
        try {
          await setHrEmployeeCompensation(session, {
            employeeId,
            policyVersionId: currentSalary.policyVersionId ?? undefined,
            effectiveFrom: `${salaryEffectiveMonth}-01`,
            monthlyGross: nextSalary.toFixed(4),
            compensationMethod: currentSalary.compensationMethod,
            foodAllowance: currentSalary.foodAllowance,
            housingAllowance: currentSalary.housingAllowance,
            transportAllowance: currentSalary.transportAllowance,
            otherAllowance: currentSalary.otherAllowance,
            ...(currentSalary.compensationMethod === "INCLUSIVE_OVERTIME" ? { scheduledHoursPerDay: currentSalary.scheduledHoursPerDay, scheduledWorkDays: currentSalary.scheduledWorkDays } : {}),
            notes: `${ar ? `ترقية إلى ${newJobTitle}` : `Promotion to ${newJobTitle}`}: ${ar ? "زيادة راتب" : "Salary increase"} ${increase.toFixed(4)}${reason.trim() ? ` — ${reason.trim()}` : ""}`,
            idempotencyKey: requestId(),
          });
        } catch (error) {
          await load();
          await onChanged();
          setMessage({ tone: "danger", text: presentBaseerApiError(error, language, ar ? "سُجلت الترقية، لكن لم تُحفظ زيادة الراتب. افتح إدارة الراتب وأعد تسجيلها." : "The promotion was saved, but the salary increase was not. Open salary management and record it again.") });
          return;
        }
      }
      setPromotionOpen(false);
      resetPromotion();
      await load();
      await onChanged();
    } catch (error) { setMessage({ tone: "danger", text: presentBaseerApiError(error, language, ar ? "تعذر تسجيل الترقية." : "The promotion could not be saved.") }); }
    finally { setBusy(false); }
  };

  const promotionColumns = [
    { id: "effective", header: ar ? "السريان" : "Effective", cell: (row: HrEmployeePromotion) => row.effectiveDate },
    { id: "previous", header: ar ? "المسمى السابق" : "Previous title", cell: (row: HrEmployeePromotion) => row.previousJobTitle ?? "—" },
    { id: "new", header: ar ? "المسمى الجديد" : "New title", cell: (row: HrEmployeePromotion) => row.newJobTitle },
    { id: "reference", header: ar ? "مرجع القرار" : "Decision reference", cell: (row: HrEmployeePromotion) => <span dir="ltr">{row.decisionReference}</span> },
    { id: "reason", header: ar ? "السبب" : "Reason", cell: (row: HrEmployeePromotion) => row.reason ?? "—" },
  ];
  const salaryHistoryColumns = [
    { id: "effective", header: ar ? "بداية التطبيق" : "Effective from", cell: (row: typeof salaryHistory[number]) => row.effectiveFrom },
    { id: "change", header: ar ? "التغيير" : "Change", cell: (row: typeof salaryHistory[number]) => <span>{row.label}{row.changeAmount ? <> · <BaseerMoney value={row.changeAmount} language={language} /></> : null}</span> },
    { id: "salary", header: ar ? "إجمالي الراتب" : "Monthly salary", numeric: true, align: "end" as const, cell: (row: typeof salaryHistory[number]) => <BaseerMoney value={row.monthlyGross} language={language} /> },
    { id: "reason", header: ar ? "السبب / الملاحظة" : "Reason / note", cell: (row: typeof salaryHistory[number]) => row.notes ?? "—" },
  ];

  return <section className="hr-employment-compensation">
    {message ? <BaseerNotice tone={message.tone}>{message.text}</BaseerNotice> : null}
    <section className="hr-employment-compensation__section" aria-labelledby="hr-compensation-heading"><header><div><h3 id="hr-compensation-heading">{ar ? "الراتب والبدلات" : "Salary & allowances"}</h3><p>{ar ? "تُحفظ تغييرات الراتب من بداية الشهر المحدد دون تغيير المسيرات السابقة." : "Salary changes apply from the selected month without changing past payroll."}</p></div><BaseerButton type="button" onClick={() => { setMessage(null); setSalaryOpen(true); }}>{currentSalary ? (ar ? "إدارة الراتب" : "Manage salary") : (ar ? "تحديد الراتب" : "Set salary")}</BaseerButton></header>{currentSalary ? <div className="hr-employment-compensation__salary-summary"><div><span>{ar ? "الإجمالي الشهري" : "Monthly total"}</span><strong><BaseerMoney value={currentSalary.monthlyGross} language={language} /></strong></div><div><span>{ar ? "الراتب الأساسي" : "Basic salary"}</span><strong><BaseerMoney value={(Number(currentSalary.monthlyGross) - Number(currentSalary.foodAllowance) - Number(currentSalary.housingAllowance) - Number(currentSalary.transportAllowance) - Number(currentSalary.otherAllowance)).toFixed(4)} language={language} /></strong></div><div><span>{ar ? "المسمى الحالي" : "Current title"}</span><strong>{employee?.jobTitle ?? "—"}</strong></div></div> : <BaseerEmptyState title={ar ? "لم يُحدد راتب بعد" : "Salary not set"} />}{salaryHistory.length ? <DataTable ariaLabel={ar ? "سجل تغييرات الراتب" : "Salary history"} caption={ar ? "سجل تغييرات الراتب" : "Salary change history"} rows={salaryHistory} columns={salaryHistoryColumns} rowKey={(row) => row.id} /> : null}</section>
    <section className="hr-employment-compensation__section" aria-labelledby="hr-employment-heading"><header><div><h3 id="hr-employment-heading">{ar ? "المسار الوظيفي" : "Employment path"}</h3><p>{ar ? "سجل المسمى الوظيفي وقرارات الترقية الخاصة بهذا الموظف." : "The employee's job-title and promotion decision history."}</p></div><BaseerButton type="button" variant="secondary" onClick={() => { setMessage(null); setPromotionOpen(true); }}>{ar ? "تسجيل ترقية" : "Record promotion"}</BaseerButton></header>{loading && !promotions.length ? <BaseerCard>{ar ? "جارٍ تحميل المسار الوظيفي…" : "Loading employment history…"}</BaseerCard> : promotions.length ? <><DataTable ariaLabel={ar ? "سجل الترقيات" : "Promotion history"} caption={ar ? "سجل الترقيات" : "Promotion history"} rows={promotions} columns={promotionColumns} rowKey={(row) => row.id} />{nextCursor ? <BaseerButton type="button" variant="secondary" disabled={loading} onClick={() => void load(nextCursor, true)}>{ar ? "تحميل المزيد" : "Load more"}</BaseerButton> : null}</> : <BaseerEmptyState title={ar ? "لا توجد ترقيات موثقة." : "No promotions are recorded."} />}</section>
    {salaryOpen && employee ? <HrCompensationAgreementDialog open language={language} employees={[employee]} fixedEmployeeId={employee.id} profile={currentSalary} onClose={() => setSalaryOpen(false)} onSaved={async () => { await load(); await onChanged(); }} onError={onError} /> : null}
    <BaseerFormDialog open={promotionOpen} title={ar ? "تسجيل ترقية" : "Record promotion"} language={language} busy={busy} size="standard" formId="hr-employee-promotion" submitLabel={ar ? "حفظ الترقية" : "Save promotion"} onClose={() => setPromotionOpen(false)}>
      <form id="hr-employee-promotion" className="baseer-form hr-promotion-form" onSubmit={(event) => void createPromotion(event)}>
        <BaseerFormSection title={ar ? "التغيير الوظيفي" : "Employment change"} description={ar ? "راجع المسمى الحالي والجديد قبل الحفظ." : "Review the current and new job titles before saving."}>
          <div className="hr-promotion-form__comparison"><div><span>{ar ? "المسمى الحالي" : "Current title"}</span><strong>{employee?.jobTitle ?? "—"}</strong></div><span aria-hidden="true">←</span><div><span>{ar ? "المسمى الجديد" : "New title"}</span><strong>{newJobTitle || "—"}</strong></div></div>
          <BaseerFormGrid><label className="baseer-form-field">{ar ? "تاريخ الترقية" : "Promotion date"}<input required type="date" min="1900-01-01" max={today()} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></label><label className="baseer-form-field">{ar ? "المسمى الجديد" : "New job title"}<HrJobTitleSelect id="hr-promotion-job-titles" language={language} value={newJobTitle} required onChange={setNewJobTitle} /></label><label className="baseer-form-field baseer-form-field--full">{ar ? "مرجع قرار الترقية" : "Promotion decision reference"}<input required value={decisionReference} onChange={(event) => setDecisionReference(event.target.value)} /></label></BaseerFormGrid>
        </BaseerFormSection>
        <BaseerFormSection title={ar ? "الأثر المالي (اختياري)" : "Salary effect (optional)"} description={ar ? "اترك مبلغ الزيادة فارغاً إذا كانت الترقية بلا تغيير راتب." : "Leave the increase blank when the promotion has no salary change."}>
          <BaseerFormGrid><label className="baseer-form-field">{ar ? "مبلغ زيادة الراتب" : "Salary increase"}<input inputMode="decimal" value={salaryIncreaseAmount} onChange={(event) => setSalaryIncreaseAmount(event.target.value)} /></label>{salaryIncreaseAmount.trim() ? <label className="baseer-form-field">{ar ? "شهر بداية الزيادة" : "Increase month"}<input required type="month" min={nextMonth()} value={salaryEffectiveMonth} onChange={(event) => setSalaryEffectiveMonth(event.target.value)} /></label> : null}</BaseerFormGrid>
          {currentSalary && salaryIncreaseAmount.trim() ? <div className="hr-promotion-form__salary-comparison"><div><span>{ar ? "الراتب الحالي" : "Current salary"}</span><strong><BaseerMoney value={currentSalary.monthlyGross} language={language} /></strong></div><span aria-hidden="true">←</span><div><span>{ar ? "الراتب بعد الزيادة" : "Salary after increase"}</span><strong><BaseerMoney value={Number.isFinite(nextSalary) && nextSalary >= 0 ? nextSalary.toFixed(4) : "0"} language={language} /></strong></div></div> : null}
          <label className="baseer-form-field baseer-form-field--full">{ar ? "سبب أو ملاحظة (اختياري)" : "Reason or note (optional)"}<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label>
        </BaseerFormSection>
      </form>
    </BaseerFormDialog>
  </section>;
}
