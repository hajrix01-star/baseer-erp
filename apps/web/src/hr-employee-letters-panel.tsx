import { useCallback, useEffect, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerNotice } from "./baseer-workspace";
import { DataTable } from "./data-table";
import { activeSession, requestId } from "./daily-sales-client";
import { openBaseerPrintWindow, printBaseerOutput, requestBaseerOutput } from "./baseer-output-client";
import { issueHrEmployeeLetter, listHrEmployeeLetters, revokeHrEmployeeLetter, type HrEmployeeLetter, type HrEmployeeLetterType } from "./hr-client";

type Language = "ar" | "en";

export function HrEmployeeLettersPanel({ employeeId, language, hasCurrentCompensation, onManageCompensation, onError, onChanged }: { employeeId: string; language: Language; hasCurrentCompensation: boolean; onManageCompensation: () => void; onError: (message: string) => void; onChanged: () => Promise<void> }) {
  const ar = language === "ar";
  const [letters, setLetters] = useState<HrEmployeeLetter[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [selected, setSelected] = useState<HrEmployeeLetter | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [letterType, setLetterType] = useState<HrEmployeeLetterType>("SALARY_CERTIFICATE");
  const [locale, setLocale] = useState<Language>(language);
  const [recipient, setRecipient] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const letterTypeLabel = (value: HrEmployeeLetterType) => value === "SALARY_CERTIFICATE" ? (ar ? "خطاب تعريف بالراتب" : "Salary certificate") : (ar ? "شهادة خدمة" : "Service certificate");
  const localeLabel = (value: Language) => value === "ar" ? "العربية" : "English";
  const statusLabel = (value: HrEmployeeLetter["status"]) => value === "ISSUED" ? (ar ? "صادر" : "Issued") : (ar ? "ملغى" : "Revoked");
  const load = useCallback(async () => {
    const session = activeSession(); if (!session) { setLoading(false); return; }
    setLoading(true);
    try { setLetters((await listHrEmployeeLetters(session, employeeId)).letters); }
    catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر تحميل سجل الخطابات." : "Letter history could not be loaded.")); }
    finally { setLoading(false); }
  }, [ar, employeeId, language, onError]);
  useEffect(() => { void load(); }, [load]);
  const issue = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const session = activeSession(); if (!session) return;
    if (letterType === "SALARY_CERTIFICATE" && !hasCurrentCompensation) { setMessage(ar ? "حدد راتب الموظف أولاً لإصدار خطاب تعريف بالراتب. يمكنك إصدار شهادة خدمة الآن." : "Set the employee salary before issuing a salary certificate. You can issue a service certificate now."); return; }
    setBusy(true); setMessage("");
    try { await issueHrEmployeeLetter(session, employeeId, { letterType, locale, ...(recipient.trim() ? { recipient: recipient.trim() } : {}), idempotencyKey: requestId() }); setIssueOpen(false); setRecipient(""); await load(); await onChanged(); }
    catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تعذر إصدار الخطاب." : "The letter could not be issued.")); }
    finally { setBusy(false); }
  };
  const preview = async (letter: HrEmployeeLetter) => {
    const session = activeSession(); if (!session) return;
    let printWindow: Window | null = null;
    try { printWindow = openBaseerPrintWindow(); }
    catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "اسمح للمتصفح بفتح نافذة الطباعة ثم أعد المحاولة." : "Allow the print pop-up, then try again.")); return; }
    setBusy(true); setMessage("");
    try { const receipt = await requestBaseerOutput(session, letter.outputReportCode, "preview", letter.locale, { letterId: letter.id }); await printBaseerOutput(session, receipt, printWindow); }
    catch (error) { printWindow.close(); setMessage(presentBaseerApiError(error, language, ar ? "تعذرت معاينة الخطاب." : "The letter preview could not be prepared.")); }
    finally { setBusy(false); }
  };
  const revoke = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const session = activeSession(); if (!session || !selected) return;
    setBusy(true); setMessage("");
    try { await revokeHrEmployeeLetter(session, selected.id, { reason, idempotencyKey: requestId() }); setRevokeOpen(false); setReason(""); setSelected(null); await load(); await onChanged(); }
    catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تعذر إلغاء الخطاب." : "The letter could not be revoked.")); }
    finally { setBusy(false); }
  };
  const columns = [
    { id: "number", header: ar ? "رقم الخطاب" : "Letter number", cell: (row: HrEmployeeLetter) => <BaseerButton type="button" variant="quiet" onClick={() => setSelected(row)}>{row.letterNumber}</BaseerButton> },
    { id: "type", header: ar ? "النوع" : "Type", cell: (row: HrEmployeeLetter) => letterTypeLabel(row.letterType) },
    { id: "recipient", header: ar ? "موجه إلى" : "Recipient", cell: (row: HrEmployeeLetter) => row.recipient ?? "—" },
    { id: "date", header: ar ? "الإصدار" : "Issued", cell: (row: HrEmployeeLetter) => row.issuedAt.slice(0, 10) },
    { id: "status", header: ar ? "الحالة" : "Status", cell: (row: HrEmployeeLetter) => statusLabel(row.status) },
  ];
  return <><div className="baseer-inline-actions"><BaseerButton type="button" onClick={() => { setLetterType(hasCurrentCompensation ? "SALARY_CERTIFICATE" : "SERVICE_CERTIFICATE"); setLocale(language); setRecipient(""); setMessage(""); setIssueOpen(true); }}>{ar ? "إصدار خطاب" : "Issue letter"}</BaseerButton></div>{message ? <BaseerCard>{message}</BaseerCard> : null}{loading ? <BaseerCard>{ar ? "جارٍ تحميل الخطابات…" : "Loading letters…"}</BaseerCard> : letters.length ? <DataTable ariaLabel={ar ? "سجل خطابات الموظف" : "Employee letter history"} caption={ar ? "سجل الخطابات" : "Letter history"} rows={letters} columns={columns} rowKey={(row) => row.id} /> : <BaseerCard>{ar ? "لا توجد خطابات صادرة." : "No letters have been issued."}</BaseerCard>}
    <BaseerDialog open={issueOpen} title={ar ? "إصدار خطاب موظف" : "Issue employee letter"} language={language} busy={busy} onClose={() => setIssueOpen(false)} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => setIssueOpen(false)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="submit" form="hr-employee-letter-issue" disabled={busy}>{ar ? "إصدار" : "Issue"}</BaseerButton></>}><form id="hr-employee-letter-issue" className="administration-form" onSubmit={(event) => void issue(event)}>{!hasCurrentCompensation ? <BaseerNotice tone="warning" title={ar ? "لا يوجد اتفاق راتب ساري" : "No current compensation agreement"}>{ar ? <>يمكن إصدار شهادة خدمة الآن. لخطاب تعريف بالراتب، أضف اتفاقاً ساريًا أولاً. <BaseerButton type="button" variant="quiet" onClick={() => { setIssueOpen(false); onManageCompensation(); }}>إضافة اتفاق راتب</BaseerButton></> : <>You can issue a service certificate now. Add a current agreement before issuing a salary certificate. <BaseerButton type="button" variant="quiet" onClick={() => { setIssueOpen(false); onManageCompensation(); }}>Add compensation agreement</BaseerButton></>}</BaseerNotice> : null}<label>{ar ? "نوع الخطاب" : "Letter type"}<select value={letterType} onChange={(event) => setLetterType(event.target.value as HrEmployeeLetterType)}><option disabled={!hasCurrentCompensation} value="SALARY_CERTIFICATE">{letterTypeLabel("SALARY_CERTIFICATE")}</option><option value="SERVICE_CERTIFICATE">{letterTypeLabel("SERVICE_CERTIFICATE")}</option></select></label><label>{ar ? "لغة الخطاب" : "Letter language"}<select value={locale} onChange={(event) => setLocale(event.target.value as Language)}><option value="ar">{localeLabel("ar")}</option><option value="en">{localeLabel("en")}</option></select></label><label>{ar ? "موجه إلى" : "Recipient"}<input value={recipient} onChange={(event) => setRecipient(event.target.value)} /></label><p>{ar ? "يُنشأ الخطاب من بيانات الخادم ويُحفظ في سجل الإصدار قبل معاينته أو طباعته." : "The letter is server-authored and stored in the issue history before preview or printing."}</p></form></BaseerDialog>
    <BaseerDialog open={Boolean(selected)} title={selected?.letterNumber ?? ""} language={language} busy={busy} onClose={() => setSelected(null)} footer={selected ? <><BaseerButton type="button" disabled={busy || selected.status !== "ISSUED"} onClick={() => void preview(selected)}>{ar ? "معاينة وطباعة" : "Preview & print"}</BaseerButton><BaseerButton type="button" variant="danger" disabled={busy || selected.status !== "ISSUED"} onClick={() => { setReason(""); setRevokeOpen(true); }}>{ar ? "إلغاء الخطاب" : "Revoke letter"}</BaseerButton></> : undefined}>{selected ? <dl className="administration-details"><div><dt>{ar ? "النوع" : "Type"}</dt><dd>{letterTypeLabel(selected.letterType)}</dd></div><div><dt>{ar ? "اللغة" : "Language"}</dt><dd>{localeLabel(selected.locale)}</dd></div><div><dt>{ar ? "موجه إلى" : "Recipient"}</dt><dd>{selected.recipient ?? "—"}</dd></div><div><dt>{ar ? "تاريخ الإصدار" : "Issued at"}</dt><dd>{selected.issuedAt.slice(0, 10)}</dd></div><div><dt>{ar ? "الحالة" : "Status"}</dt><dd>{statusLabel(selected.status)}</dd></div>{selected.revokedReason ? <div><dt>{ar ? "سبب الإلغاء" : "Revocation reason"}</dt><dd>{selected.revokedReason}</dd></div> : null}</dl> : null}</BaseerDialog>
    <BaseerDialog open={revokeOpen} title={ar ? "إلغاء الخطاب" : "Revoke letter"} language={language} busy={busy} onClose={() => setRevokeOpen(false)} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => setRevokeOpen(false)}>{ar ? "رجوع" : "Back"}</BaseerButton><BaseerButton type="submit" variant="danger" form="hr-employee-letter-revoke" disabled={busy}>{ar ? "تأكيد الإلغاء" : "Confirm revocation"}</BaseerButton></>}><form id="hr-employee-letter-revoke" className="administration-form" onSubmit={(event) => void revoke(event)}><label>{ar ? "سبب الإلغاء" : "Revocation reason"}<textarea required value={reason} onChange={(event) => setReason(event.target.value)} /></label></form></BaseerDialog>
  </>;
}
