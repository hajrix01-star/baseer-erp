import { lazy, Suspense, useCallback, useEffect, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerDataGridField as BaseerDataGrid } from "./baseer-data-grid-field";
import { activeSession, requestId } from "./daily-sales-client";
import { openBaseerPrintWindow, printBaseerOutput, requestBaseerOutput } from "./baseer-output-client";
import { issueHrEmployeeLetter, listHrEmployeeLetters, revokeHrEmployeeLetter, type HrEmployeeLetter, type HrEmployeeLetterType } from "./hr-client";
import { hrText } from "./hr-copy";
import { reportTopmostDialogError } from "./use-dialog-focus-trap";
import type { IssueLetterForm, RevokeLetterForm } from "./hr-employee-letter-forms";

type Language = "ar" | "en";
const LazyHrEmployeeLetterIssueDialog = lazy(() => import("./hr-employee-letter-forms").then((module) => ({ default: module.HrEmployeeLetterIssueDialog })));
const LazyHrEmployeeLetterRevokeDialog = lazy(() => import("./hr-employee-letter-forms").then((module) => ({ default: module.HrEmployeeLetterRevokeDialog })));

export function HrEmployeeLettersPanel({ employeeId, language, hasCurrentCompensation, canIssue = false, canRevoke = false, onManageCompensation, onError, onChanged }: { employeeId: string; language: Language; hasCurrentCompensation: boolean; canIssue?: boolean; canRevoke?: boolean; onManageCompensation: () => void; onError: (message: string) => void; onChanged: () => Promise<void> }) {
  const ar = language === "ar";
  const text = hrText(language);
  const [letters, setLetters] = useState<HrEmployeeLetter[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [selected, setSelected] = useState<HrEmployeeLetter | null>(null);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [message, setMessage] = useState("");
  const showError = (value: string) => { if (!reportTopmostDialogError(value)) setMessage(value); };
  const letterTypeLabel = (value: HrEmployeeLetterType) => value === "SALARY_CERTIFICATE" ? (ar ? "خطاب تعريف بالراتب" : "Salary certificate") : (ar ? "شهادة خدمة" : "Service certificate");
  const localeLabel = (value: Language) => value === "ar" ? "العربية" : "English";
  const statusLabel = (value: HrEmployeeLetter["status"]) => value === "ISSUED" ? (ar ? "صادر" : "Issued") : (ar ? "ملغى" : "Revoked");
  const load = useCallback(async (cursor?: string, append = false) => {
    const session = activeSession(); if (!session) { setLoading(false); return; }
    setLoading(true);
    try {
      const receipt = await listHrEmployeeLetters(session, employeeId, { cursor, pageSize: 50 });
      setLetters((current) => append ? [...current, ...receipt.letters.filter((letter) => !current.some((existing) => existing.id === letter.id))] : receipt.letters);
      setNextCursor(receipt.nextCursor);
    }
    catch (error) { onError(presentBaseerApiError(error, language, ar ? "تعذر تحميل سجل الخطابات." : "Letter history could not be loaded.")); }
    finally { setLoading(false); }
  }, [ar, employeeId, language, onError]);
  useEffect(() => { void load(); }, [load]);
  const issue = async ({ letterType, locale, recipient }: IssueLetterForm) => {
    const session = activeSession(); if (!session) return;
    if (letterType === "SALARY_CERTIFICATE" && !hasCurrentCompensation) { showError(ar ? "حدد راتب الموظف أولاً لإصدار خطاب تعريف بالراتب. يمكنك إصدار شهادة خدمة الآن." : "Set the employee salary before issuing a salary certificate. You can issue a service certificate now."); return; }
    setBusy(true); setMessage("");
    try { await issueHrEmployeeLetter(session, employeeId, { letterType, locale, ...(recipient.trim() ? { recipient: recipient.trim() } : {}), idempotencyKey: requestId() }); setIssueOpen(false); await load(); await onChanged(); }
    catch (error) { showError(presentBaseerApiError(error, language, ar ? "تعذر إصدار الخطاب." : "The letter could not be issued.")); }
    finally { setBusy(false); }
  };
  const preview = async (letter: HrEmployeeLetter) => {
    const session = activeSession(); if (!session) return;
    let printWindow: Window | null = null;
    try { printWindow = openBaseerPrintWindow(); }
    catch (error) { showError(presentBaseerApiError(error, language, ar ? "اسمح للمتصفح بفتح نافذة الطباعة ثم أعد المحاولة." : "Allow the print pop-up, then try again.")); return; }
    setBusy(true); setMessage("");
    try { const receipt = await requestBaseerOutput(session, letter.outputReportCode, "preview", letter.locale, { letterId: letter.id }); await printBaseerOutput(session, receipt, printWindow); }
    catch (error) { printWindow.close(); showError(presentBaseerApiError(error, language, ar ? "تعذرت معاينة الخطاب." : "The letter preview could not be prepared.")); }
    finally { setBusy(false); }
  };
  const revoke = async ({ reason }: RevokeLetterForm) => {
    const session = activeSession(); if (!session || !selected) return;
    setBusy(true); setMessage("");
    try { await revokeHrEmployeeLetter(session, selected.id, { reason, idempotencyKey: requestId() }); setRevokeOpen(false); setSelected(null); await load(); await onChanged(); }
    catch (error) { showError(presentBaseerApiError(error, language, ar ? "تعذر إلغاء الخطاب." : "The letter could not be revoked.")); }
    finally { setBusy(false); }
  };
  const columns = [
    { id: "number", header: ar ? "رقم الخطاب" : "Letter number", cell: (row: HrEmployeeLetter) => <BaseerButton type="button" variant="quiet" onClick={() => setSelected(row)}>{row.letterNumber}</BaseerButton> },
    { id: "type", header: ar ? "النوع" : "Type", cell: (row: HrEmployeeLetter) => letterTypeLabel(row.letterType) },
    { id: "recipient", header: ar ? "موجه إلى" : "Recipient", cell: (row: HrEmployeeLetter) => row.recipient ?? "—" },
    { id: "date", header: ar ? "الإصدار" : "Issued", cell: (row: HrEmployeeLetter) => row.issuedAt.slice(0, 10) },
    { id: "status", header: ar ? "الحالة" : "Status", cell: (row: HrEmployeeLetter) => statusLabel(row.status) },
  ];
  return <>{canIssue ? <div className="baseer-inline-actions"><BaseerButton type="button" onClick={() => { setMessage(""); setIssueOpen(true); }}>{ar ? "إصدار خطاب" : "Issue letter"}</BaseerButton></div> : null}{message ? <BaseerCard>{message}</BaseerCard> : null}{loading ? <BaseerCard>{ar ? "جارٍ تحميل الخطابات…" : "Loading letters…"}</BaseerCard> : letters.length ? <BaseerDataGrid ariaLabel={ar ? "سجل خطابات الموظف" : "Employee letter history"} caption={ar ? "سجل الخطابات" : "Letter history"} rows={letters} columns={columns} rowKey={(row) => row.id} /> : <BaseerCard>{ar ? "لا توجد خطابات صادرة." : "No letters have been issued."}</BaseerCard>}{nextCursor ? <BaseerButton type="button" variant="secondary" disabled={loading} onClick={() => void load(nextCursor, true)}>{text.loadMore}</BaseerButton> : null}
    <Suspense fallback={null}><LazyHrEmployeeLetterIssueDialog open={issueOpen} language={language} busy={busy} hasCurrentCompensation={hasCurrentCompensation} onClose={() => setIssueOpen(false)} onManageCompensation={onManageCompensation} onSubmit={issue} /></Suspense>
    <BaseerDialog open={Boolean(selected)} title={selected?.letterNumber ?? ""} language={language} busy={busy} onClose={() => setSelected(null)} footer={selected ? <><BaseerButton type="button" disabled={busy || selected.status !== "ISSUED"} onClick={() => void preview(selected)}>{ar ? "معاينة وطباعة" : "Preview & print"}</BaseerButton>{canRevoke ? <BaseerButton type="button" variant="danger" disabled={busy || selected.status !== "ISSUED"} onClick={() => setRevokeOpen(true)}>{ar ? "إلغاء الخطاب" : "Revoke letter"}</BaseerButton> : null}</> : undefined}>{selected ? <dl className="administration-details"><div><dt>{ar ? "النوع" : "Type"}</dt><dd>{letterTypeLabel(selected.letterType)}</dd></div><div><dt>{ar ? "اللغة" : "Language"}</dt><dd>{localeLabel(selected.locale)}</dd></div><div><dt>{ar ? "موجه إلى" : "Recipient"}</dt><dd>{selected.recipient ?? "—"}</dd></div><div><dt>{ar ? "تاريخ الإصدار" : "Issued at"}</dt><dd>{selected.issuedAt.slice(0, 10)}</dd></div><div><dt>{ar ? "الحالة" : "Status"}</dt><dd>{statusLabel(selected.status)}</dd></div>{selected.revokedReason ? <div><dt>{ar ? "سبب الإلغاء" : "Revocation reason"}</dt><dd>{selected.revokedReason}</dd></div> : null}</dl> : null}</BaseerDialog>
    <Suspense fallback={null}><LazyHrEmployeeLetterRevokeDialog open={revokeOpen} language={language} busy={busy} onClose={() => setRevokeOpen(false)} onSubmit={revoke} /></Suspense>
  </>;
}
