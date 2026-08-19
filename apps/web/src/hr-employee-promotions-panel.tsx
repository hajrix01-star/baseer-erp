import { useCallback, useEffect, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { DataTable } from "./data-table";
import { activeSession, requestId } from "./daily-sales-client";
import { createHrEmployeePromotion, listHrEmployeePromotions, type HrEmployeePromotion } from "./hr-client";
import { HrJobTitleSelect } from "./hr-job-titles";

type Language = "ar" | "en";
const today = () => new Date().toISOString().slice(0, 10);

export function HrEmployeePromotionsPanel({ employeeId, language, onError, onChanged }: { employeeId: string; language: Language; onError: (message: string) => void; onChanged: () => Promise<void> }) {
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
    setBusy(true); setMessage("");
    try {
      await createHrEmployeePromotion(session, employeeId, { effectiveDate, newJobTitle, decisionReference, ...(reason.trim() ? { reason: reason.trim() } : {}), idempotencyKey: requestId() });
      setOpen(false); setNewJobTitle(""); setDecisionReference(""); setReason(""); setEffectiveDate(today());
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
    <BaseerDialog open={open} title={ar ? "تسجيل ترقية" : "Record promotion"} language={language} busy={busy} onClose={() => setOpen(false)} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => setOpen(false)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="submit" form="hr-employee-promotion" disabled={busy}>{ar ? "حفظ الترقية" : "Save promotion"}</BaseerButton></>}><form id="hr-employee-promotion" className="administration-form" onSubmit={(event) => void create(event)}><label>{ar ? "تاريخ السريان" : "Effective date"}<input required type="date" min="1900-01-01" max={today()} value={effectiveDate} onChange={(event) => setEffectiveDate(event.target.value)} /></label><label>{ar ? "المسمى الجديد" : "New job title"}<HrJobTitleSelect id="hr-promotion-job-titles" language={language} value={newJobTitle} required onChange={setNewJobTitle} /></label><label>{ar ? "مرجع قرار الترقية" : "Promotion decision reference"}<input required value={decisionReference} onChange={(event) => setDecisionReference(event.target.value)} /></label><label>{ar ? "سبب أو ملاحظة (اختياري)" : "Reason or note (optional)"}<textarea value={reason} onChange={(event) => setReason(event.target.value)} /></label><p>{ar ? "لا تعدل الترقية أي مسير سابق. إن تغيّر الراتب، استخدم «تعديل الراتب» من ملف الموظف." : "A promotion never changes past payroll. If salary changes, use “Edit salary” in the employee file."}</p></form></BaseerDialog>
  </>;
}
