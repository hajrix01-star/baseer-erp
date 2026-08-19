import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerMoneyInput, formatBaseerEditableAmount } from "./baseer-form-fields";
import { BaseerMoney } from "./baseer-money";
import { activeSession, requestId } from "./daily-sales-client";
import { createHrPayrollRun, previewHrPayrollRun, type HrPayrollPreviewEmployee, type HrPayrollPreviewReceipt } from "./hr-client";
import "./hr-payroll-create-dialog.css";

type Language = "ar" | "en";
type ApplicationChoice = { enabled: boolean; amount: string };
type EmployeeApplications = { advances: Record<string, ApplicationChoice>; deductions: Record<string, ApplicationChoice> };

const today = () => new Date().toISOString().slice(0, 10);
const month = () => `${today().slice(0, 7)}-01`;
const employeeLabel = (language: Language, employee: HrPayrollPreviewEmployee) => `${employee.employeeNumber} · ${language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr}`;
const selectedApplicationsTotal = (applications: EmployeeApplications | undefined) => Object.values(applications?.advances ?? {}).concat(Object.values(applications?.deductions ?? {})).reduce((total, item) => total + (item.enabled && Number(item.amount) > 0 ? Number(item.amount) : 0), 0);

/** A compact operational view. The server remains the sole owner of eligibility and payroll math. */
export function HrPayrollCreateDialog({ open, onClose, onCreated, language, onError }: {
  open: boolean;
  onClose: () => void;
  onCreated: () => Promise<void>;
  language: Language;
  onError: (message: string) => void;
}) {
  const ar = language === "ar";
  const [busy, setBusy] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [draft, setDraft] = useState({ payrollMonth: month(), businessDate: today(), notes: "" });
  const [includeOnLeaveIds, setIncludeOnLeaveIds] = useState<string[]>([]);
  const [preview, setPreview] = useState<HrPayrollPreviewReceipt | null>(null);
  const [previewRows, setPreviewRows] = useState<HrPayrollPreviewEmployee[]>([]);
  const [previewCursor, setPreviewCursor] = useState<string | null>(null);
  const [applications, setApplications] = useState<Record<string, EmployeeApplications>>({});
  const requestSequence = useRef(0);

  const applicationLines = useMemo(() => Object.entries(applications).flatMap(([employeeId, choices]) => {
    const employee = previewRows.find((row) => row.id === employeeId);
    if (!employee?.included) return [];
    const advances = Object.entries(choices.advances).filter(([, item]) => item.enabled && Number(item.amount) > 0).map(([id, item]) => ({ id, amount: item.amount }));
    const administrativeDeductions = Object.entries(choices.deductions).filter(([, item]) => item.enabled && Number(item.amount) > 0).map(([id, item]) => ({ id, amount: item.amount }));
    return advances.length || administrativeDeductions.length ? [{ employeeId, advances, administrativeDeductions }] : [];
  }), [applications, previewRows]);
  const hasIncompleteApplications = previewRows.some((employee) => employee.hasMoreAdvances || employee.hasMoreAdministrativeDeductions);
  const includeOnLeaveIdsRef = useRef(includeOnLeaveIds);
  const applicationLinesRef = useRef(applicationLines);
  includeOnLeaveIdsRef.current = includeOnLeaveIds;
  applicationLinesRef.current = applicationLines;
  const previewInputKey = JSON.stringify({ payrollMonth: draft.payrollMonth, businessDate: draft.businessDate, includeOnLeaveIds, applicationLines });

  const resetApplications = () => { setIncludeOnLeaveIds([]); setApplications({}); };
  const loadPreview = useCallback(async (cursor?: string, append = false) => {
    const session = activeSession();
    if (!session) return;
    const sequence = ++requestSequence.current;
    setPreviewLoading(true);
    try {
      const receipt = await previewHrPayrollRun(session, { payrollMonth: draft.payrollMonth, businessDate: draft.businessDate, includeOnLeaveEmployeeIds: includeOnLeaveIdsRef.current, lines: applicationLinesRef.current, cursor, pageSize: 50 });
      if (sequence !== requestSequence.current) return;
      setPreview(receipt);
      setPreviewRows((rows) => append ? [...rows, ...receipt.employees] : receipt.employees);
      setPreviewCursor(receipt.nextCursor);
    } catch (error) {
      if (sequence !== requestSequence.current) return;
      onError(presentBaseerApiError(error, language, ar ? "معاينة المسير" : "Previewing payroll"));
      if (!append) { setPreview(null); setPreviewRows([]); setPreviewCursor(null); }
    } finally { if (sequence === requestSequence.current) setPreviewLoading(false); }
  }, [ar, draft.businessDate, draft.payrollMonth, language, onError]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => void loadPreview(), 250);
    return () => { window.clearTimeout(timer); requestSequence.current += 1; };
  }, [loadPreview, open, previewInputKey]);

  const updateApplication = (employeeId: string, kind: "advances" | "deductions", id: string, enabled: boolean, amount: string) => setApplications((rows) => ({ ...rows, [employeeId]: { advances: rows[employeeId]?.advances ?? {}, deductions: rows[employeeId]?.deductions ?? {}, [kind]: { ...(rows[employeeId]?.[kind] ?? {}), [id]: { enabled, amount } } } }));

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const session = activeSession();
    if (!session || busy || !preview || preview.counts.included === 0 || preview.counts.exceptions > 0) return;
    setBusy(true);
    try {
      await createHrPayrollRun(session, { payrollMonth: draft.payrollMonth, businessDate: draft.businessDate, notes: draft.notes || undefined, includeAllEligible: true, includeOnLeaveEmployeeIds: includeOnLeaveIds, lines: applicationLines, idempotencyKey: requestId() });
      onClose();
      await onCreated();
    } catch (error) { onError(presentBaseerApiError(error, language, ar ? "إنشاء مسير" : "Creating payroll")); }
    finally { setBusy(false); }
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
  const canSubmit = !busy && !previewLoading && preview !== null && preview.counts.included > 0 && preview.counts.exceptions === 0 && !hasIncompleteApplications;

  return <BaseerDialog open={open} title={ar ? "إنشاء مسير راتب" : "Create payroll run"} size="wide" className="hr-payroll-create-dialog" language={language} busy={busy} onClose={onClose} footer={<><div className="hr-payroll-create__total"><span>{ar ? "صافي المستحق" : "Net payable"}</span>{preview ? <BaseerMoney value={preview.totals.netPayableAmount} language={language} /> : "—"}</div><div className="hr-payroll-create__actions"><BaseerButton type="button" variant="secondary" disabled={busy} onClick={onClose}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="submit" form="hr-payroll-create-form" disabled={!canSubmit}>{ar ? "إنشاء المسودة" : "Create draft"}</BaseerButton></div></>}>
    <form id="hr-payroll-create-form" className="hr-payroll-create" onSubmit={(event) => void submit(event)}>
      <header className="hr-payroll-create__controls"><label>{ar ? "الشهر" : "Month"}<input required type="month" value={draft.payrollMonth.slice(0, 7)} onChange={(event) => { setDraft((value) => ({ ...value, payrollMonth: `${event.target.value}-01` })); resetApplications(); }} /></label><label>{ar ? "ملاحظات" : "Notes"}<input value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} /></label></header>
      <div className="hr-payroll-create__table-heading"><strong>{ar ? `قائمة الموظفين (${preview?.totals.employeeCount ?? 0})` : `Employees (${preview?.totals.employeeCount ?? 0})`}</strong><BaseerButton type="button" variant="secondary" disabled={previewLoading} onClick={() => void loadPreview()}>{ar ? "تحديث" : "Refresh"}</BaseerButton></div>
      {previewLoading && !preview ? <p className="hr-payroll-create__loading">{ar ? "جارٍ إعداد المسير…" : "Preparing payroll…"}</p> : null}
      {preview?.exceptions.length ? <p className="hr-payroll-create__notice" role="alert">{ar ? `يلزم معالجة ${preview.counts.exceptions} استثناء قبل إنشاء المسير.` : `${preview.counts.exceptions} exception(s) must be resolved before creating the payroll.`}</p> : null}
      {hasIncompleteApplications ? <p className="hr-payroll-create__notice" role="alert">{ar ? "توجد سلف أو خصومات إضافية غير ظاهرة في المعاينة. لا يمكن إنشاء المسير حتى تكتمل قائمة التطبيقات." : "Some advance or deduction applications are not shown. The payroll cannot be created until the application list is complete."}</p> : null}
      {previewRows.length ? <div className="hr-payroll-create__table-wrap"><table><thead><tr><th>{ar ? "الموظف" : "Employee"}</th><th>{ar ? "إجمالي الراتب" : "Gross salary"}</th><th>{ar ? "السلف" : "Advances"}</th><th>{ar ? "الخصومات الإدارية" : "Administrative deductions"}</th><th>{ar ? "الصافي التقديري" : "Estimated net"}</th><th>{ar ? "الحالة" : "Status"}</th></tr></thead><tbody>{previewRows.map((employee) => {
        const selectedTotal = selectedApplicationsTotal(applications[employee.id]);
        const estimatedNet = Math.max(0, Number(employee.estimatedGrossAmount ?? 0) - selectedTotal);
        return <tr key={employee.id}><td><strong>{employeeLabel(language, employee)}</strong></td><td>{employee.estimatedGrossAmount ? <BaseerMoney value={employee.estimatedGrossAmount} language={language} /> : "—"}</td><td>{applicationChoices(employee, "advances")}</td><td>{applicationChoices(employee, "deductions")}</td><td>{employee.included && employee.estimatedGrossAmount ? <BaseerMoney value={estimatedNet} language={language} /> : "—"}</td><td>{inclusionControl(employee)}</td></tr>;
      })}</tbody></table></div> : null}
      {previewCursor ? <BaseerButton type="button" variant="secondary" disabled={previewLoading} onClick={() => void loadPreview(previewCursor, true)}>{ar ? "تحميل المزيد" : "Load more"}</BaseerButton> : null}
    </form>
  </BaseerDialog>;
}
