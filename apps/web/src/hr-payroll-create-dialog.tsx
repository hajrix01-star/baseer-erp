import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerConfirmDialog } from "./baseer-confirm-dialog";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerCheckbox, BaseerMoneyInput, BaseerMonthPicker, BaseerTextInput, formatBaseerEditableAmount } from "./baseer-form-fields";
import { useBaseerForm, z } from "./baseer-form-state";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { BaseerMoney } from "./baseer-money";
import { riyadhToday } from "./baseer-period-values";
import { activeSession, requestId } from "./daily-sales-client";
import { createHrPayrollRun, discardHrPayrollRun, getHrPayrollRun, previewHrPayrollRun, updateHrPayrollRun, type HrPayrollDetail, type HrPayrollPreviewEmployee, type HrPayrollPreviewReceipt } from "./hr-client";
import "./hr-payroll-create-dialog.css";

type Language = "ar" | "en";
type ApplicationChoice = { enabled: boolean; amount: string };
type EmployeeApplications = { advances: Record<string, ApplicationChoice>; deductions: Record<string, ApplicationChoice> };
type EmployeeSelection = { selectedEmployeeIds: string[]; excludedEmployeeIds?: never } | { excludedEmployeeIds: string[]; selectedEmployeeIds?: never };
type PayrollDraft = { payrollMonth: string; notes: string };

const month = () => { const date = riyadhToday(); return `${date.year}-${String(date.month).padStart(2, "0")}`; };
const payrollMonthPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
const employeeLabel = (language: Language, employee: HrPayrollPreviewEmployee) => language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr;
const payrollDraftSchema = (ar: boolean) => z.object({
  payrollMonth: z.string().regex(payrollMonthPattern, ar ? "اختر شهر المسير." : "Choose a payroll month."),
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
  const [draftChanged, setDraftChanged] = useState(false);
  const [draftReady, setDraftReady] = useState(!editing);
  const [sourceIdsComplete, setSourceIdsComplete] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewFailed, setPreviewFailed] = useState(false);
  const draftSchema = useMemo(() => payrollDraftSchema(ar), [ar]);
  const draftForm = useBaseerForm<PayrollDraft>({ schema: draftSchema, defaultValues: { payrollMonth: month(), notes: "" } });
  const draft = draftForm.watch();
  const [includeOnLeaveIds, setIncludeOnLeaveIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<HrPayrollPreviewReceipt | null>(null);
  const [previewRows, setPreviewRows] = useState<HrPayrollPreviewEmployee[]>([]);
  const [previewCursor, setPreviewCursor] = useState<string | null>(null);
  const [pageCursors, setPageCursors] = useState<Array<string | undefined>>([undefined]);
  const pageCursor = pageCursors[pageCursors.length - 1];
  const [knownIncompleteEmployees, setKnownIncompleteEmployees] = useState<Record<string, "ACTIVE" | "ON_LEAVE">>({});
  const [selection, setSelection] = useState<EmployeeSelection>({ excludedEmployeeIds: [] });
  const [resolvedPreviewKey, setResolvedPreviewKey] = useState<string | null>(null);
  const [applications, setApplications] = useState<Record<string, EmployeeApplications>>({});
  const [discardOpen, setDiscardOpen] = useState(false);
  const requestSequence = useRef(0);
  const previewAbortRef = useRef<AbortController | null>(null);
  const previewTimerRef = useRef<number | null>(null);
  const previewDelayRef = useRef(0);
  const [resolvedPreviewScope, setResolvedPreviewScope] = useState<string | null>(null);
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
        draftForm.reset({ payrollMonth: receipt.payrollRun.payrollMonth.slice(0, 7), notes: receipt.payrollRun.notes ?? "" });
        setIncludeOnLeaveIds(lines.filter((line) => line.employeeStatus === "ON_LEAVE" || (line.employeeStatus === undefined && line.eligibilityCode === "FULL_MONTH_ON_LEAVE_EXCEPTION_V1")).map((line) => line.employeeId));
        setSelection({ selectedEmployeeIds: lines.map((line) => line.employeeId) });
        setPageCursors([undefined]);
        setApplications(restored);
        setSourceIdsComplete(complete);
        setKnownIncompleteEmployees({});
        setDraftChanged(false);
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
    if (selection.selectedEmployeeIds ? !selection.selectedEmployeeIds.includes(employeeId) : selection.excludedEmployeeIds.includes(employeeId)) return [];
    const advances = Object.entries(choices.advances).filter(([, item]) => item.enabled).map(([id, item]) => ({ id, amount: item.amount }));
    const administrativeDeductions = Object.entries(choices.deductions).filter(([, item]) => item.enabled).map(([id, item]) => ({ id, amount: item.amount }));
    return advances.length || administrativeDeductions.length ? [{ employeeId, advances, administrativeDeductions }] : [];
  }), [applications, selection]);
  const previewInputKey = JSON.stringify({ payrollMonth: draft.payrollMonth + "-01", includeOnLeaveEmployeeIds: includeOnLeaveIds, ...selection, lines: applicationLines, cursor: pageCursor, pageSize: 50 });
  const previewScope = JSON.stringify([activeSession()?.companyId, payrollRunId, draft.payrollMonth]);
  const samePreviewScope = resolvedPreviewScope === previewScope;
  const displayedPreview = samePreviewScope ? preview : null;
  const displayedRows = samePreviewScope ? previewRows : [];
  const previewCurrent = displayedPreview !== null && resolvedPreviewKey === previewInputKey && !previewLoading;
  const previewPending = !previewCurrent && !previewFailed;
  // Last server-confirmed values remain visible while updating; saving still requires a matching receipt.
  const displayedNetPayable = displayedPreview?.totals.netPayableAmount ?? null;
  const hasIncompleteApplications = Object.entries(knownIncompleteEmployees).some(([id, status]) => (selection.selectedEmployeeIds ? selection.selectedEmployeeIds.includes(id) : !selection.excludedEmployeeIds.includes(id)) && (status !== "ON_LEAVE" || includeOnLeaveIds.includes(id)));
  const resetApplications = () => { previewDelayRef.current = 0; setIncludeOnLeaveIds([]); setApplications({}); setSelection({ excludedEmployeeIds: [] }); setKnownIncompleteEmployees({}); setPageCursors([undefined]); };
  const loadPreview = useCallback(async () => {
    previewDelayRef.current = 0;
    if (previewTimerRef.current !== null) { window.clearTimeout(previewTimerRef.current); previewTimerRef.current = null; }
    const session = activeSession();
    if (!session || !draftReady) return;
    previewAbortRef.current?.abort();
    const controller = new AbortController();
    previewAbortRef.current = controller;
    const sequence = ++requestSequence.current;
    if (!payrollMonthPattern.test(draft.payrollMonth)) {
      setPreview(null);
      setPreviewRows([]);
      setPreviewCursor(null);
      setPreviewLoading(false);
      return;
    }
    setPreviewLoading(true);
    setPreviewFailed(false);
    try {
      const receipt = await previewHrPayrollRun(session, JSON.parse(previewInputKey) as Parameters<typeof previewHrPayrollRun>[1], controller.signal);
      if (sequence !== requestSequence.current) return;
      setPreview(receipt);
      setResolvedPreviewKey(previewInputKey);
      setResolvedPreviewScope(previewScope);
      setPreviewRows(receipt.employees);
      setKnownIncompleteEmployees((current) => { const next = { ...current }; for (const employee of receipt.employees) { if (employee.hasMoreAdvances || employee.hasMoreAdministrativeDeductions) next[employee.id] = employee.status; else delete next[employee.id]; } return next; });
      setPreviewCursor(receipt.nextCursor);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      if ((error as { name?: string }).name === "AbortError") return;
      onErrorRef.current(presentBaseerApiError(error, language, ar ? "معاينة المسير" : "Previewing payroll"));
      setPreview(null); setResolvedPreviewKey(null); setPreviewFailed(true);
    } finally {
      if (previewAbortRef.current === controller) previewAbortRef.current = null;
      if (sequence === requestSequence.current) setPreviewLoading(false);
    }
  }, [ar, draft.payrollMonth, draftReady, language, previewInputKey, previewScope]);

  useEffect(() => {
    if (!open || !draftReady) return;
    const timer = window.setTimeout(() => void loadPreview(), previewDelayRef.current);
    previewDelayRef.current = 0;
    previewTimerRef.current = timer;
    return () => { window.clearTimeout(timer); previewTimerRef.current = null; requestSequence.current += 1; previewAbortRef.current?.abort(); };
  }, [draftReady, loadPreview, open, previewInputKey]);

  const updateApplication = (employeeId: string, kind: "advances" | "deductions", id: string, enabled: boolean, amount: string, typing = false) => { previewDelayRef.current = typing ? 150 : 0; setDraftChanged(true); setApplications((rows) => ({ ...rows, [employeeId]: { advances: rows[employeeId]?.advances ?? {}, deductions: rows[employeeId]?.deductions ?? {}, [kind]: { ...(rows[employeeId]?.[kind] ?? {}), [id]: { enabled, amount } } } })); };

  const submit = async (values: PayrollDraft) => {
    const session = activeSession();
    if (!session || busy || !previewCurrent || !preview || preview.counts.included === 0 || preview.counts.exceptions > 0 || !sourceIdsComplete || hasIncompleteApplications) return;
    setBusy(true);
    try {
      const payload = { payrollMonth: `${values.payrollMonth}-01`, notes: values.notes || undefined, includeAllEligible: true, ...selection, includeOnLeaveEmployeeIds: includeOnLeaveIds, lines: applicationLines, idempotencyKey: requestId() };
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

  const employeeSelected = (employee: HrPayrollPreviewEmployee) =>
    (selection.selectedEmployeeIds ? selection.selectedEmployeeIds.includes(employee.id) : !selection.excludedEmployeeIds.includes(employee.id))
    && (employee.status !== "ON_LEAVE" || includeOnLeaveIds.includes(employee.id));
  const toggleEmployee = (employee: HrPayrollPreviewEmployee, checked: boolean) => {
    previewDelayRef.current = 0;
    setDraftChanged(true);
    setSelection((current) => current.selectedEmployeeIds
      ? { selectedEmployeeIds: checked ? [...new Set([...current.selectedEmployeeIds, employee.id])] : current.selectedEmployeeIds.filter((id) => id !== employee.id) }
      : { excludedEmployeeIds: checked ? current.excludedEmployeeIds.filter((id) => id !== employee.id) : [...new Set([...current.excludedEmployeeIds, employee.id])] });
    if (employee.status === "ON_LEAVE") setIncludeOnLeaveIds((ids) => checked ? [...new Set([...ids, employee.id])] : ids.filter((id) => id !== employee.id));
    if (!checked) setApplications((current) => { const next = { ...current }; delete next[employee.id]; return next; });
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
        <BaseerCheckbox checked={item.enabled} disabled={!employeeSelected(employee) || !employee.included || busy} onChange={(event) => updateApplication(employee.id, kind, entry.id, event.target.checked, item.amount)} />
        <span>{label} · {entry.referenceNumber}</span>
        <BaseerMoneyInput aria-label={`${label} ${entry.referenceNumber}`} disabled={!employeeSelected(employee) || !employee.included || !item.enabled || busy} value={item.amount} onValueChange={(amount) => updateApplication(employee.id, kind, entry.id, item.enabled, amount, true)} />
      </label>;
    })}{hasMore ? <small role="alert">{ar ? `تظهر ${rows.length} من ${count}. توجد تطبيقات إضافية غير ظاهرة.` : `Showing ${rows.length} of ${count}. More applications are not shown.`}</small> : null}</div>;
  };
  const canSubmit = !busy && !draftLoading && previewCurrent && preview !== null && preview.counts.included > 0 && preview.counts.exceptions === 0 && !hasIncompleteApplications && sourceIdsComplete;

  const title = editing ? (ar ? `تعديل مسودة ${runNumber ?? ""}`.trim() : `Edit draft ${runNumber ?? ""}`.trim()) : (ar ? "إنشاء مسير راتب" : "Create payroll run");
  return <><BaseerDialog open={open} title={title} size="wide" className="hr-payroll-create-dialog" language={language} busy={busy} onClose={onClose} footer={<><div className="hr-payroll-create__total" aria-busy={previewPending}><span>{ar ? "صافي المستحق" : "Net payable"}<small className="hr-payroll-create__total-status" data-visible={previewPending}>{ar ? "جارٍ التحديث" : "Updating"}</small></span>{displayedNetPayable !== null ? <BaseerMoney value={displayedNetPayable} language={language} /> : "—"}</div><div className="hr-payroll-create__actions">{editing ? <BaseerButton type="button" variant="danger" disabled={busy || draftLoading} onClick={() => setDiscardOpen(true)}>{ar ? "حذف المسودة" : "Discard draft"}</BaseerButton> : null}{editing && onReview ? <BaseerButton type="button" variant="secondary" disabled={busy || draftLoading || draftChanged || draftForm.formState.isDirty || !previewCurrent} onClick={onReview}>{ar ? "مراجعة واعتماد" : "Review and approve"}</BaseerButton> : null}<BaseerButton type="button" variant="secondary" disabled={busy} onClick={onClose}>{ar ? "إغلاق" : "Close"}</BaseerButton><BaseerButton type="submit" form="hr-payroll-create-form" disabled={!canSubmit}>{editing ? (ar ? "حفظ التعديلات" : "Save changes") : (ar ? "إنشاء المسودة" : "Create draft")}</BaseerButton></div></>}>
    {draftLoading ? <p className="hr-payroll-create__loading-shell" role="status">{ar ? "جارٍ فتح مسودة المسير…" : "Opening payroll draft…"}</p> : <form id="hr-payroll-create-form" className="hr-payroll-create" data-baseer-rhf-form="true" noValidate onSubmit={draftForm.handleSubmit((values) => void submit(values))}>
      <header className="hr-payroll-create__controls"><label>{ar ? "الشهر" : "Month"}<BaseerMonthPicker {...draftForm.register("payrollMonth")} required disabled={editing} aria-label={ar ? "الشهر" : "Month"} aria-invalid={draftForm.formState.errors.payrollMonth ? "true" : undefined} aria-describedby={draftForm.formState.errors.payrollMonth ? "hr-payroll-month-error" : undefined} value={draft.payrollMonth} onChange={(event) => { draftForm.setValue("payrollMonth", event.target.value, { shouldDirty: true, shouldValidate: true }); setPreview(null); setPreviewRows([]); setPreviewCursor(null); resetApplications(); }} />{draftForm.formState.errors.payrollMonth ? <small id="hr-payroll-month-error" role="alert">{draftForm.formState.errors.payrollMonth.message}</small> : null}</label><label>{ar ? "ملاحظات" : "Notes"}<BaseerTextInput {...draftForm.register("notes")} /></label></header>
      {editing && (draftChanged || draftForm.formState.isDirty) ? <p className="hr-payroll-create__notice">{ar ? "احفظ التعديلات قبل مراجعة المسير واعتماده." : "Save changes before reviewing and approving this payroll."}</p> : null}
      <div className="hr-payroll-create__summary-region" aria-busy={previewPending}>
      <BaseerSummaryMetricGrid className="hr-payroll-create__summary" ariaLabel={ar ? "ملخص المسير" : "Payroll summary"} role="list">
        {([
          [ar ? "إجمالي الرواتب" : "Gross salaries", "grossAmount", "brand"],
          [ar ? "الخصومات" : "Deductions", "administrativeDeductionAmount", "warning"],
          [ar ? "سداد السلف" : "Advance settlements", "advanceSettlementAmount", "info"],
          [ar ? "صافي الرواتب" : "Net salaries", "netPayableAmount", "success"],
        ] as const).map(([label, key, accent]) => <BaseerSummaryMetric key={key} label={label} accent={accent} role="listitem" value={displayedPreview ? <BaseerMoney value={displayedPreview.totals[key]} language={language} /> : "—"} />)}
      </BaseerSummaryMetricGrid>
      </div>
      <p role="status" className="hr-payroll-create__update-status" data-visible={!previewCurrent}>
        {!previewCurrent ? (previewFailed ? (ar ? "تعذر تحديث الحسابات. صحّح المدخلات أو أعد المحاولة." : "Totals could not be updated. Correct the entries or retry.") : (displayedPreview ? (ar ? "جارٍ التحديث — الأرقام المعروضة من آخر حساب مكتمل." : "Updating — showing the last completed calculation.") : (ar ? "جارٍ إعداد حسابات المسير…" : "Preparing payroll totals…"))) : ""}
      </p>
      <div className="hr-payroll-create__selection-actions"><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => { previewDelayRef.current = 0; setDraftChanged(true); setSelection({ excludedEmployeeIds: [] }); }}>{ar ? "تحديد الكل" : "Select all"}</BaseerButton><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => { previewDelayRef.current = 0; setDraftChanged(true); setSelection({ selectedEmployeeIds: [] }); setIncludeOnLeaveIds([]); setApplications({}); }}>{ar ? "إلغاء التحديد" : "Clear selection"}</BaseerButton></div>
      <div className="hr-payroll-create__table-heading"><strong>{ar ? `قائمة الموظفين (${displayedPreview ? displayedPreview.totals.employeeCount : "—"})` : `Employees (${displayedPreview ? displayedPreview.totals.employeeCount : "—"})`}</strong><BaseerButton type="button" variant="secondary" disabled={previewLoading} onClick={() => void loadPreview()}>{ar ? "تحديث" : "Refresh"}</BaseerButton></div>
      {displayedPreview?.exceptions.length ? <p className="hr-payroll-create__notice" role="alert">{ar ? `يلزم معالجة ${displayedPreview.counts.exceptions} استثناء قبل إنشاء المسير.` : `${displayedPreview.counts.exceptions} exception(s) must be resolved before creating the payroll.`}</p> : null}
      {hasIncompleteApplications ? <p className="hr-payroll-create__notice" role="alert">{ar ? "توجد سلف أو خصومات إضافية غير ظاهرة في المعاينة. لا يمكن إنشاء المسير حتى تكتمل قائمة التطبيقات." : "Some advance or deduction applications are not shown. The payroll cannot be created until the application list is complete."}</p> : null}
      {!sourceIdsComplete ? <p className="hr-payroll-create__notice" role="alert">{ar ? "تعذر استعادة معرفات بعض تطبيقات السلف أو الخصومات. حدّث الصفحة بعد اكتمال ترقية الخادم؛ تم إيقاف الحفظ لحماية المسودة." : "Some advance or deduction source identifiers could not be restored. Saving is blocked to protect the draft."}</p> : null}
      {displayedRows.length ? <div className="hr-payroll-create__table-wrap" aria-busy={previewPending}><table><thead><tr><th>{ar ? "الموظف" : "Employee"}</th><th>{ar ? "إجمالي الراتب" : "Gross salary"}</th><th>{ar ? "السلف" : "Advances"}</th><th>{ar ? "الخصومات الإدارية" : "Administrative deductions"}</th><th>{ar ? "الصافي التقديري" : "Estimated net"}</th><th>{ar ? "الحالة" : "Status"}</th></tr></thead><tbody>{displayedRows.map((employee) => {
        const selected = employeeSelected(employee);
        return <tr key={employee.id} className={selected ? undefined : "hr-payroll-create__unselected"}><td><label className="hr-payroll-create__employee-toggle"><BaseerCheckbox checked={selected} disabled={busy} aria-label={ar ? `إدراج ${employeeLabel(language, employee)}` : `Include ${employeeLabel(language, employee)}`} onChange={(event) => toggleEmployee(employee, event.target.checked)} /><strong>{employeeLabel(language, employee)}</strong></label></td><td data-label={ar ? "إجمالي الراتب" : "Gross salary"}>{displayedPreview && employee.estimatedGrossAmount ? <BaseerMoney value={employee.estimatedGrossAmount} language={language} /> : "—"}</td><td data-label={ar ? "السلف" : "Advances"}>{applicationChoices(employee, "advances")}</td><td data-label={ar ? "الخصومات" : "Deductions"}>{applicationChoices(employee, "deductions")}</td><td data-label={ar ? "الصافي" : "Net salary"}>{displayedPreview && employee.estimatedNetAmount != null ? <BaseerMoney value={employee.estimatedNetAmount} language={language} /> : "—"}</td><td data-label={ar ? "الحالة" : "Status"}><span className={selected && employee.included ? "hr-payroll-create__included" : "hr-payroll-create__excluded"}>{selected ? reason(employee) : (ar ? "غير محدد" : "Not selected")}</span></td></tr>;
      })}</tbody></table></div> : null}
      {pageCursors.length > 1 || previewCursor ? <div className="hr-payroll-create__selection-actions"><BaseerButton type="button" variant="secondary" disabled={previewLoading || pageCursors.length === 1} onClick={() => { previewDelayRef.current = 0; setPageCursors((cursors) => cursors.slice(0, -1)); }}>{ar ? "السابق" : "Previous"}</BaseerButton><BaseerButton type="button" variant="secondary" disabled={!previewCurrent || !previewCursor} onClick={() => { previewDelayRef.current = 0; if (previewCursor) setPageCursors((cursors) => [...cursors, previewCursor]); }}>{ar ? "التالي" : "Next"}</BaseerButton></div> : null}
    </form>}
  </BaseerDialog>
  <BaseerConfirmDialog open={discardOpen} language={language} busy={busy} destructive title={ar ? "حذف مسودة المسير" : "Discard payroll draft"} message={ar ? "سيُحذف هذا المسير قبل الاعتماد. لا توجد قيود محاسبية أو مدفوعات مرتبطة به." : "This draft will be deleted before approval. No accounting entries or payments are attached."} confirmLabel={ar ? "حذف المسودة" : "Discard draft"} onCancel={() => setDiscardOpen(false)} onConfirm={() => void discard()} />
  </>;
}
