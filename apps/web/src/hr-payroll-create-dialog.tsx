import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerMoneyInput, formatBaseerEditableAmount } from "./baseer-form-fields";
import { useBaseerForm, z } from "./baseer-form-state";
import { BaseerMoney } from "./baseer-money";
import { activeSession, requestId } from "./daily-sales-client";
import { createHrPayrollRun, discardHrPayrollRun, getHrPayrollRun, previewHrPayrollRun, updateHrPayrollRun, type HrPayrollDetail, type HrPayrollPreviewEmployee, type HrPayrollPreviewReceipt } from "./hr-client";
import "./hr-payroll-create-dialog.css";

type Language = "ar" | "en";
type ApplicationChoice = { enabled: boolean; amount: string };
type EmployeeApplications = { advances: Record<string, ApplicationChoice>; deductions: Record<string, ApplicationChoice> };
type PayrollDraft = { payrollMonth: string; businessDate: string; notes: string };

const today = () => new Date().toISOString().slice(0, 10);
const month = () => `${today().slice(0, 7)}-01`;
const employeeLabel = (language: Language, employee: HrPayrollPreviewEmployee) => `${employee.employeeNumber} · ${language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr}`;
const selectedApplicationsTotal = (applications: EmployeeApplications | undefined) => Object.values(applications?.advances ?? {}).concat(Object.values(applications?.deductions ?? {})).reduce((total, item) => total + (item.enabled && Number(item.amount) > 0 ? Number(item.amount) : 0), 0);
const payrollDraftSchema = (ar: boolean) => z.object({
  payrollMonth: z.string().regex(/^\d{4}-\d{2}-01$/, ar ? "اختر شهر المسير." : "Choose a payroll month."),
  businessDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, ar ? "تاريخ العمل غير صالح." : "Business date is invalid."),
  notes: z.string(),
});

/** A compact operational view. The server remains the sole owner of eligibility and payroll math. */
export function HrPayrollCreateDialog({ open, payrollRunId, runNumber, onClose, onCreated, onDiscarded, onReview, language, onError }: {
  open: boolean;
  payrollRunId?: string;
  runNumber?: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
  onDiscarded?: () => Promise<void>;
  onReview?: () => void;
  language: Language;
  onError: (message: string) => void;
}) {
  const ar = language === "ar";
  const editing = Boolean(payrollRunId);
  const [busy, setBusy] = useState(false);
  const [draftLoading, setDraftLoading] = useState(editing);
  const [draftReady, setDraftReady] = useState(!editing);
  const [sourceIdsComplete, setSourceIdsComplete] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const draftSchema = useMemo(() => payrollDraftSchema(ar), [ar]);
  const draftForm = useBaseerForm<PayrollDraft>({ schema: draftSchema, defaultValues: { payrollMonth: month(), businessDate: today(), notes: "" } });
  const draft = draftForm.watch();
  const [includeOnLeaveIds, setIncludeOnLeaveIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<HrPayrollPreviewReceipt | null>(null);
  const [previewRows, setPreviewRows] = useState<HrPayrollPreviewEmployee[]>([]);
  const [previewCursor, setPreviewCursor] = useState<string | null>(null);
  const [applications, setApplications] = useState<Record<string, EmployeeApplications>>({});
  const [discardOpen, setDiscardOpen] = useState(false);
  const requestSequence = useRef(0);
  const previewAbortRef = useRef<AbortController | null>(null);
  const detailRequestSequence = useRef(0);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  useEffect(() => {
    if (!open || !payrollRunId) return;
    const sequence = ++detailRequestSequence.current;
    setDraftLoading(true);
    setDraftReady(false);
    setPreview(null);
    setPreviewRows([]);
    setPreviewCursor(null);
    const loadDraft = async () => {
      const session = activeSession();
      if (!session) return;
      try {
        let receipt = await getHrPayrollRun(session, payrollRunId, { linePageSize: 250, paymentPageSize: 1 });
        const lines: HrPayrollDetail["lines"] = [...receipt.lines];
        while (receipt.hasMoreLines && receipt.nextLineCursor) {
          receipt = await getHrPayrollRun(session, payrollRunId, { lineCursor: receipt.nextLineCursor, linePageSize: 250, paymentPageSize: 1 });
          lines.push(...receipt.lines);
        }
        if (sequence !== detailRequestSequence.current) return;
        const restored: Record<string, EmployeeApplications> = {};
        let complete = true;
        for (const line of lines) {
          const advances: Record<string, ApplicationChoice> = {};
          const deductions: Record<string, ApplicationChoice> = {};
          for (const application of line.advances) {
            if (!application.sourceId) { complete = false; continue; }
            advances[application.sourceId] = { enabled: true, amount: formatBaseerEditableAmount(application.amount) };
          }
          for (const application of line.administrativeDeductions) {
            if (!application.sourceId) { complete = false; continue; }
            deductions[application.sourceId] = { enabled: true, amount: formatBaseerEditableAmount(application.amount) };
          }
          if (Object.keys(advances).length || Object.keys(deductions).length) restored[line.employeeId] = { advances, deductions };
        }
        draftForm.reset({ payrollMonth: receipt.payrollRun.payrollMonth, businessDate: receipt.payrollRun.businessDate, notes: receipt.payrollRun.notes ?? "" });
        setIncludeOnLeaveIds(lines.filter((line) => line.eligibilityCode === "FULL_MONTH_ON_LEAVE_EXCEPTION_V1").map((line) => line.employeeId));
        setApplications(restored);
        setSourceIdsComplete(complete);
        setDraftReady(true);
      } catch (error) {
        if (sequence === detailRequestSequence.current) onErrorRef.current(presentBaseerApiError(error, language, ar ? "فتح مسودة المسير" : "Opening payroll draft"));
      } finally {
        if (sequence === detailRequestSequence.current) setDraftLoading(false);
      }
    };
    void loadDraft();
    return () => { detailRequestSequence.current += 1; };
  }, [ar, draftForm, language, open, payrollRunId]);

  const applicationLines = useMemo(() => Object.entries(applications).flatMap(([employeeId, choices]) => {
    const employee = previewRows.find((row) => row.id === employeeId);
    if (employee && !employee.included) return [];
    const advances = Object.entries(choices.advances).filter(([, item]) => item.enabled && Number(item.amount) > 0).map(([id, item]) => ({ id, amount: item.amount }));
    const administrativeDeductions = Object.entries(choices.deductions).filter(([, item]) => item.enabled && Number(item.amount) > 0).map(([id, item]) => ({ id, amount: item.amount }));
    return advances.length || administrativeDeductions.length ? [{ employeeId, advances, administrativeDeductions }] : [];
  }), [applications, previewRows]);
  // The preview population remains stable while a user selects applications.
  // Reflect those selections in the footer immediately, without issuing a
  // preview request for every checkbox click or amount keystroke.
  const selectedApplicationAmount = useMemo(() => applicationLines.reduce((total, line) => total
    + line.advances.reduce((lineTotal, application) => lineTotal + Number(application.amount), 0)
    + line.administrativeDeductions.reduce((lineTotal, application) => lineTotal + Number(application.amount), 0), 0), [applicationLines]);
  const displayedNetPayable = preview
    ? Math.max(0, Number(preview.totals.grossAmount) - selectedApplicationAmount).toFixed(4)
    : null;
  const hasIncompleteApplications = previewRows.some((employee) => employee.hasMoreAdvances || employee.hasMoreAdministrativeDeductions);
  const includeOnLeaveIdsRef = useRef(includeOnLeaveIds);
  const applicationLinesRef = useRef(applicationLines);
  includeOnLeaveIdsRef.current = includeOnLeaveIds;
  applicationLinesRef.current = applicationLines;
  // Settlement choices are calculated locally while the user edits. Re-fetch
  // only when the population changes; otherwise every keystroke becomes a
  // payroll-preview request and can overload slower installations.
  const previewInputKey = JSON.stringify({ payrollMonth: draft.payrollMonth, businessDate: draft.businessDate, includeOnLeaveIds });

  const resetApplications = () => { setIncludeOnLeaveIds([]); setApplications({}); };
  const loadPreview = useCallback(async (cursor?: string, append = false) => {
    const session = activeSession();
    if (!session || !draftReady) return;
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    const sequence = ++requestSequence.current;
    setPreviewLoading(true);
    try {
      const receipt = await previewHrPayrollRun(session, { payrollMonth: draft.payrollMonth, businessDate: draft.businessDate, includeOnLeaveEmployeeIds: includeOnLeaveIdsRef.current, lines: applicationLinesRef.current, cursor, pageSize: 50 }, controller.signal);
      if (sequence !== requestSequence.current) return;
      setPreview(receipt);
      setPreviewRows((rows) => append ? [...rows, ...receipt.employees] : receipt.employees);
      setPreviewCursor(receipt.nextCursor);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      if ((error as { name?: string }).name === "AbortError") return;
      onErrorRef.current(presentBaseerApiError(error, language, ar ? "معاينة المسير" : "Previewing payroll"));
      if (!append) { setPreview(null); setPreviewRows([]); setPreviewCursor(null); }
    } finally {
      if (previewAbortRef.current === controller) previewAbortRef.current = null;
      if (sequence === requestSequence.current) setPreviewLoading(false);
    }
  }, [ar, draft.businessDate, draft.payrollMonth, draftReady, language]);

  useEffect(() => {
    if (!open || !draftReady) return;
    const timer = window.setTimeout(() => void loadPreview(), 250);
    return () => { window.clearTimeout(timer); requestSequence.current += 1; previewAbortRef.current?.abort(); };
  }, [draftReady, loadPreview, open, previewInputKey]);

  const updateApplication = (employeeId: string, kind: "advances" | "deductions", id: string, enabled: boolean, amount: string) => setApplications((rows) => ({ ...rows, [employeeId]: { advances: rows[employeeId]?.advances ?? {}, deductions: rows[employeeId]?.deductions ?? {}, [kind]: { ...(rows[employeeId]?.[kind] ?? {}), [id]: { enabled, amount } } } }));

  const submit = async (values: PayrollDraft) => {
    const session = activeSession();
    if (!session || busy || !preview || preview.counts.included === 0 || preview.counts.exceptions > 0 || !sourceIdsComplete) return;
    setBusy(true);
    try {
      const payload = { payrollMonth: values.payrollMonth, businessDate: values.businessDate, notes: values.notes || undefined, includeAllEligible: true, includeOnLeaveEmployeeIds: includeOnLeaveIds, lines: applicationLines, idempotencyKey: requestId() };
      if (payrollRunId) await updateHrPayrollRun(session, { payrollRunId, ...payload });
      else await createHrPayrollRun(session, payload);
      onClose();
      await onCreated();
    } catch (error) { onError(presentBaseerApiError(error, language, editing ? (ar ? "تعديل مسودة المسير" : "Updating payroll draft") : (ar ? "إنشاء مسير" : "Creating payroll"))); }
    finally { setBusy(false); }
  };

  const discard = async () => {
    const session = activeSession();
    if (!session || !payrollRunId || busy) return;
    setBusy(true);
    try {
      await discardHrPayrollRun(session, { payrollRunId, idempotencyKey: requestId() });
      setDiscardOpen(false);
      onClose();
      await (onDiscarded ?? onCreated)();
    } catch (error) {
      onError(presentBaseerApiError(error, language, ar ? "حذف مسودة المسير" : "Discarding payroll draft"));
    } finally { setBusy(false); }
  };

  const reason = (employee: HrPayrollPreviewEmployee) => ({
    ACTIVE_WITH_VALID_COMPENSATION: ar ? "مدرج" : "Included",
    ACTIVE_NEW_HIRE_PRORATED: ar ? "استحقاق نسبي" : "Prorated",
    ACTIVE_MISSING_COMPENSATION: ar ? "اتفاق راتب مطلوب" : "Agreement required",
    COMPENSATION_DOES_NOT_COVER_PAYROLL_PERIOD: ar ? "الاتفاق لا يغطي الشهر" : "Agreement does not cover month",
    HIRED_AFTER_BUSINESS_DATE: ar ? "تعيين بعد تاريخ الاستحقاق" : "Hired after accrual date",
    ON_LEAVE_EXPLICITLY_INCLUDED: ar ? "إجازة مدرجة" : "Leave included",
    ON_LEAVE_REQUIRES_EXPLICIT_INCLUSION: ar ? "يتطلب إدراجاً" : "Choose inclusion",
    ON_LEAVE_MISSING_COMPENSATION: ar ? "اتفاق راتب مطلوب" : "Agreement required",
  })[employee.reason];

  const inclusionControl = (employee: HrPayrollPreviewEmployee) => {
    const canIncludeLeave = employee.status === "ON_LEAVE" && employee.reason !== "ON_LEAVE_MISSING_COMPENSATION";
    if (!canIncludeLeave) return <span className={employee.included ? "hr-payroll-create__included" : "hr-payroll-create__excluded"}>{reason(employee)}</span>;
    return <label className="hr-payroll-create__leave-toggle"><input type="checkbox" checked={includeOnLeaveIds.includes(employee.id)} disabled={previewLoading} onChange={(event) => setIncludeOnLeaveIds((ids) => event.target.checked ? [...new Set([...ids, employee.id])] : ids.filter((id) => id !== employee.id))} />{ar ? "إدراج الإجازة" : "Include leave"}</label>;
  };

  const applicationChoices = (employee: HrPayrollPreviewEmployee, kind: "advances" | "deductions") => {
    const rows = kind === "advances" ? employee.advances : employee.administrativeDeductions;
    const count = kind === "advances" ? employee.advanceCount : employee.administrativeDeductionCount;
    const hasMore = kind === "advances" ? employee.hasMoreAdvances : employee.hasMoreAdministrativeDeductions;
    const label = kind === "advances" ? (ar ? "سلفة" : "Advance") : (ar ? "خصم" : "Deduction");
    const choices = applications[employee.id]?.[kind] ?? {};
    if (!rows.length && !hasMore) return <span className="hr-payroll-create__no-application">—</span>;
    return <div className="hr-payroll-create__application-list">{rows.map((entry) => {
      const item = choices[entry.id] ?? { enabled: false, amount: formatBaseerEditableAmount(entry.remainingAmount) };
      return <label key={entry.id} className={item.enabled ? "is-selected" : undefined}>
        <input type="checkbox" checked={item.enabled} disabled={!employee.included || busy} onChange={(event) => updateApplication(employee.id, kind, entry.id, event.target.checked, item.amount)} />
        <span>{label} · {entry.referenceNumber}</span>
        <BaseerMoneyInput aria-label={`${label} ${entry.referenceNumber}`} disabled={!employee.included || !item.enabled || busy} value={item.amount} onValueChange={(amount) => updateApplication(employee.id, kind, entry.id, item.enabled, amount)} />
      </label>;
    })}{hasMore ? <small role="alert">{ar ? `تظهر ${rows.length} من ${count}. توجد تطبيقات إضافية غير ظاهرة.` : `Showing ${rows.length} of ${count}. More applications are not shown.`}</small> : null}</div>;
  };
  const canSubmit = !busy && !draftLoading && !previewLoading && preview !== null && preview.counts.included > 0 && preview.counts.exceptions === 0 && !hasIncompleteApplications && sourceIdsComplete;

  const title = editing ? (ar ? `تعديل مسودة ${runNumber ?? ""}`.trim() : `Edit draft ${runNumber ?? ""}`.trim()) : (ar ? "إنشاء مسير راتب" : "Create payroll run");
  return <><BaseerDialog open={open} title={title} size="wide" className="hr-payroll-create-dialog" language={language} busy={busy} onClose={onClose} footer={<><div className="hr-payroll-create__total"><span>{ar ? "صافي المستحق" : "Net payable"}</span>{displayedNetPayable !== null ? <BaseerMoney value={displayedNetPayable} language={language} /> : "—"}</div><div className="hr-payroll-create__actions">{editing ? <BaseerButton type="button" variant="danger" disabled={busy || draftLoading} onClick={() => setDiscardOpen(true)}>{ar ? "حذف المسودة" : "Discard draft"}</BaseerButton> : null}{editing && onReview ? <BaseerButton type="button" variant="secondary" disabled={busy || draftLoading} onClick={onReview}>{ar ? "مراجعة واعتماد" : "Review and approve"}</BaseerButton> : null}<BaseerButton type="button" variant="secondary" disabled={busy} onClick={onClose}>{ar ? "إغلاق" : "Close"}</BaseerButton><BaseerButton type="submit" form="hr-payroll-create-form" disabled={!canSubmit}>{editing ? (ar ? "حفظ التعديلات" : "Save changes") : (ar ? "إنشاء المسودة" : "Create draft")}</BaseerButton></div></>}>
    {draftLoading ? <p className="hr-payroll-create__loading-shell" role="status">{ar ? "جارٍ فتح مسودة المسير…" : "Opening payroll draft…"}</p> : <form id="hr-payroll-create-form" className="hr-payroll-create" data-baseer-rhf-form="true" noValidate onSubmit={draftForm.handleSubmit((values) => void submit(values))}>
      <header className="hr-payroll-create__controls"><label>{ar ? "الشهر" : "Month"}<input {...draftForm.register("payrollMonth")} required disabled={editing} type="month" aria-invalid={draftForm.formState.errors.payrollMonth ? "true" : undefined} aria-describedby={draftForm.formState.errors.payrollMonth ? "hr-payroll-month-error" : undefined} value={draft.payrollMonth.slice(0, 7)} onChange={(event) => { draftForm.setValue("payrollMonth", `${event.target.value}-01`, { shouldDirty: true, shouldValidate: true }); resetApplications(); }} />{draftForm.formState.errors.payrollMonth ? <small id="hr-payroll-month-error" role="alert">{draftForm.formState.errors.payrollMonth.message}</small> : null}</label><label>{ar ? "ملاحظات" : "Notes"}<input {...draftForm.register("notes")} /></label></header>
      <div className="hr-payroll-create__table-heading"><strong>{ar ? `قائمة الموظفين (${preview?.totals.employeeCount ?? 0})` : `Employees (${preview?.totals.employeeCount ?? 0})`}</strong><BaseerButton type="button" variant="secondary" disabled={previewLoading} onClick={() => void loadPreview()}>{ar ? "تحديث" : "Refresh"}</BaseerButton></div>
      {previewLoading && !preview ? <p className="hr-payroll-create__loading">{ar ? "جارٍ إعداد المسير…" : "Preparing payroll…"}</p> : null}
      {preview?.exceptions.length ? <p className="hr-payroll-create__notice" role="alert">{ar ? `يلزم معالجة ${preview.counts.exceptions} استثناء قبل إنشاء المسير.` : `${preview.counts.exceptions} exception(s) must be resolved before creating the payroll.`}</p> : null}
      {hasIncompleteApplications ? <p className="hr-payroll-create__notice" role="alert">{ar ? "توجد سلف أو خصومات إضافية غير ظاهرة في المعاينة. لا يمكن إنشاء المسير حتى تكتمل قائمة التطبيقات." : "Some advance or deduction applications are not shown. The payroll cannot be created until the application list is complete."}</p> : null}
      {!sourceIdsComplete ? <p className="hr-payroll-create__notice" role="alert">{ar ? "تعذر استعادة معرفات بعض تطبيقات السلف أو الخصومات. حدّث الصفحة بعد اكتمال ترقية الخادم؛ تم إيقاف الحفظ لحماية المسودة." : "Some advance or deduction source identifiers could not be restored. Saving is blocked to protect the draft."}</p> : null}
      {previewRows.length ? <div className="hr-payroll-create__table-wrap"><table><thead><tr><th>{ar ? "الموظف" : "Employee"}</th><th>{ar ? "إجمالي الراتب" : "Gross salary"}</th><th>{ar ? "السلف" : "Advances"}</th><th>{ar ? "الخصومات الإدارية" : "Administrative deductions"}</th><th>{ar ? "الصافي التقديري" : "Estimated net"}</th><th>{ar ? "الحالة" : "Status"}</th></tr></thead><tbody>{previewRows.map((employee) => {
        const selectedTotal = selectedApplicationsTotal(applications[employee.id]);
        const estimatedNet = Math.max(0, Number(employee.estimatedGrossAmount ?? 0) - selectedTotal);
        return <tr key={employee.id}><td><strong>{employeeLabel(language, employee)}</strong></td><td>{employee.estimatedGrossAmount ? <BaseerMoney value={employee.estimatedGrossAmount} language={language} /> : "—"}</td><td>{applicationChoices(employee, "advances")}</td><td>{applicationChoices(employee, "deductions")}</td><td>{employee.included && employee.estimatedGrossAmount ? <BaseerMoney value={estimatedNet} language={language} /> : "—"}</td><td>{inclusionControl(employee)}</td></tr>;
      })}</tbody></table></div> : null}
      {previewCursor ? <BaseerButton type="button" variant="secondary" disabled={previewLoading} onClick={() => void loadPreview(previewCursor, true)}>{ar ? "تحميل المزيد" : "Load more"}</BaseerButton> : null}
    </form>}
  </BaseerDialog>
  <BaseerConfirmDialog open={discardOpen} language={language} busy={busy} destructive title={ar ? "حذف مسودة المسير" : "Discard payroll draft"} message={ar ? "سيُحذف هذا المسير قبل الاعتماد. لا توجد قيود محاسبية أو مدفوعات مرتبطة به." : "This draft will be deleted before approval. No accounting entries or payments are attached."} confirmLabel={ar ? "حذف المسودة" : "Discard draft"} onCancel={() => setDiscardOpen(false)} onConfirm={() => void discard()} />
  </>;
}
