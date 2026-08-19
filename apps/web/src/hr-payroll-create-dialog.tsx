import { useCallback, useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { DataTable, type DataTableColumn } from "./data-table";
import { activeSession, requestId } from "./daily-sales-client";
import { createHrPayrollRun, previewHrPayrollRun, type HrPayrollPreviewEmployee, type HrPayrollPreviewReceipt } from "./hr-client";

type Language = "ar" | "en";
type ApplicationChoice = { enabled: boolean; amount: string };
type EmployeeApplications = { advances: Record<string, ApplicationChoice>; deductions: Record<string, ApplicationChoice> };
type ApplicationEligibilityRule = { onLeave: boolean };

const today = () => new Date().toISOString().slice(0, 10);
const month = () => `${today().slice(0, 7)}-01`;
const employeeLabel = (language: Language, employee: HrPayrollPreviewEmployee) => `${employee.employeeNumber} · ${language === "ar" ? employee.nameAr : employee.nameEn ?? employee.nameAr}`;
const money = (value: string) => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The server owns eligibility; the UI chooses only explicit leave inclusion and optional applications. */
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
  const [applicationEligibilityRules, setApplicationEligibilityRules] = useState<Record<string, ApplicationEligibilityRule>>({});
  const [applicationEmployeeId, setApplicationEmployeeId] = useState<string | null>(null);

  const applicationLines = useMemo(() => Object.entries(applications).flatMap(([employeeId, choices]) => {
    const rule = applicationEligibilityRules[employeeId] ?? { onLeave: false };
    const isEligible = !rule.onLeave || includeOnLeaveIds.includes(employeeId);
    if (!isEligible) return [];
    const advances = Object.entries(choices.advances).filter(([, item]) => item.enabled && Number(item.amount) > 0).map(([id, item]) => ({ id, amount: item.amount }));
    const administrativeDeductions = Object.entries(choices.deductions).filter(([, item]) => item.enabled && Number(item.amount) > 0).map(([id, item]) => ({ id, amount: item.amount }));
    return advances.length || administrativeDeductions.length ? [{ employeeId, advances, administrativeDeductions }] : [];
  }), [applicationEligibilityRules, applications, includeOnLeaveIds]);

  const loadPreview = useCallback(async (cursor?: string, append = false) => {
    const session = activeSession();
    if (!session) return;
    setPreviewLoading(true);
    try {
      const receipt = await previewHrPayrollRun(session, { payrollMonth: draft.payrollMonth, businessDate: draft.businessDate, includeOnLeaveEmployeeIds: includeOnLeaveIds, lines: applicationLines, cursor, pageSize: 50 });
      setPreview(receipt);
      setPreviewRows((rows) => append ? [...rows, ...receipt.employees] : receipt.employees);
      setPreviewCursor(receipt.nextCursor);
    } catch (error) {
      onError(presentBaseerApiError(error, language, ar ? "معاينة المسير" : "Previewing payroll"));
      if (!append) { setPreview(null); setPreviewRows([]); setPreviewCursor(null); }
    } finally { setPreviewLoading(false); }
  }, [applicationLines, ar, draft.businessDate, draft.payrollMonth, includeOnLeaveIds, language, onError]);

  useEffect(() => { if (!open) return; const timer = window.setTimeout(() => void loadPreview(), 250); return () => window.clearTimeout(timer); }, [loadPreview, open]);

  const updateLeaveInclusion = (employeeId: string, enabled: boolean) => setIncludeOnLeaveIds((ids) => enabled ? [...new Set([...ids, employeeId])] : ids.filter((id) => id !== employeeId));
  const updateApplication = (employeeId: string, kind: "advances" | "deductions", id: string, enabled: boolean, amount: string) => setApplications((rows) => ({ ...rows, [employeeId]: { advances: rows[employeeId]?.advances ?? {}, deductions: rows[employeeId]?.deductions ?? {}, [kind]: { ...(rows[employeeId]?.[kind] ?? {}), [id]: { enabled, amount } } } }));
  const applicationEmployee = previewRows.find((employee) => employee.id === applicationEmployeeId) ?? null;
  const applicationChoices = applicationEmployee ? applications[applicationEmployee.id] ?? { advances: {}, deductions: {} } : null;

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
    ACTIVE_WITH_VALID_COMPENSATION: ar ? "مدرج تلقائياً" : "Included by default",
    ACTIVE_NEW_HIRE_PRORATED: ar ? "تعيين جديد: استحقاق نسبي تلقائي" : "New hire: automatically prorated",
    ACTIVE_MISSING_COMPENSATION: ar ? "لا يوجد اتفاق راتب صالح" : "No valid compensation agreement",
    COMPENSATION_DOES_NOT_COVER_PAYROLL_PERIOD: ar ? "اتفاق الراتب لا يغطي فترة المسير" : "Compensation agreement does not cover the payroll period",
    HIRED_AFTER_BUSINESS_DATE: ar ? "تاريخ التعيين بعد تاريخ الاستحقاق" : "Hired after the accrual date",
    ON_LEAVE_EXPLICITLY_INCLUDED: ar ? "مضاف بإدراج صريح" : "Explicitly included",
    ON_LEAVE_REQUIRES_EXPLICIT_INCLUSION: ar ? "يتطلب اختياراً صريحاً" : "Requires explicit selection",
    ON_LEAVE_MISSING_COMPENSATION: ar ? "لا يوجد اتفاق راتب صالح" : "No valid compensation agreement",
  })[employee.reason];
  const inclusionControl = (employee: HrPayrollPreviewEmployee) => {
    const canIncludeLeave = employee.status === "ON_LEAVE" && employee.reason !== "ON_LEAVE_MISSING_COMPENSATION";
    if (!canIncludeLeave) return employee.included ? (ar ? "مدرج تلقائياً" : "Included by default") : (ar ? "مستثنى" : "Excluded");
    return <label><input type="checkbox" checked={includeOnLeaveIds.includes(employee.id)} disabled={previewLoading} onChange={(event) => updateLeaveInclusion(employee.id, event.target.checked)} /> {ar ? "إدراج الإجازة" : "Include leave"}</label>;
  };
  const columns: readonly DataTableColumn<HrPayrollPreviewEmployee>[] = [
    { id: "employee", header: ar ? "الموظف" : "Employee", cell: (employee) => employeeLabel(language, employee), width: "18rem" },
    { id: "status", header: ar ? "الحالة" : "Status", cell: (employee) => employee.status === "ACTIVE" ? (ar ? "نشط" : "Active") : (ar ? "إجازة" : "On leave"), width: "8rem" },
    { id: "inclusion", header: ar ? "الإدراج" : "Inclusion", cell: inclusionControl, width: "12rem" },
    { id: "period", header: ar ? "فترة الاستحقاق" : "Eligibility period", cell: (employee) => employee.calculationPeriodStart && employee.calculationPeriodEnd ? `${employee.calculationPeriodStart} → ${employee.calculationPeriodEnd}` : "—", width: "13rem" },
    { id: "estimate", header: ar ? "التقدير الخادمي" : "Server estimate", cell: (employee) => employee.estimatedGrossAmount ? `${money(employee.estimatedGrossAmount)} · ${employee.prorationRatio ?? "—"}` : "—", width: "12rem" },
    { id: "reason", header: ar ? "النتيجة" : "Result", cell: reason, width: "15rem" },
    { id: "applications", header: ar ? "سلف وخصومات" : "Applications", cell: (employee) => employee.included ? <BaseerButton type="button" variant="quiet" onClick={() => { setApplicationEmployeeId(employee.id); setApplicationEligibilityRules((rules) => ({ ...rules, [employee.id]: { onLeave: employee.status === "ON_LEAVE" } })); }}>{ar ? `إدارة (${employee.advances.length + employee.administrativeDeductions.length})` : `Manage (${employee.advances.length + employee.administrativeDeductions.length})`}</BaseerButton> : "—", width: "12rem" },
  ];

  return <BaseerDialog open={open} title={ar ? "إنشاء مسير رواتب" : "Create payroll run"} language={language} busy={busy || previewLoading} onClose={onClose} footer={<><BaseerButton type="button" variant="secondary" disabled={busy} onClick={onClose}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="submit" form="hr-payroll-create-form" disabled={busy || previewLoading || !preview || preview.counts.included === 0 || preview.counts.exceptions > 0}>{ar ? "حفظ مسودة" : "Save draft"}</BaseerButton></>}>
    <form id="hr-payroll-create-form" className="administration-form" onSubmit={(event) => void submit(event)}>
      <label>{ar ? "شهر المسير" : "Payroll month"}<input required type="month" value={draft.payrollMonth.slice(0, 7)} onChange={(event) => { setDraft((value) => ({ ...value, payrollMonth: `${event.target.value}-01` })); setIncludeOnLeaveIds([]); setApplications({}); setApplicationEligibilityRules({}); setApplicationEmployeeId(null); }} /></label>
      <label>{ar ? "تاريخ الاستحقاق" : "Accrual date"}<input required type="date" max={today()} value={draft.businessDate} onChange={(event) => { setDraft((value) => ({ ...value, businessDate: event.target.value })); setIncludeOnLeaveIds([]); setApplications({}); setApplicationEligibilityRules({}); setApplicationEmployeeId(null); }} /></label>
      <label>{ar ? "ملاحظات" : "Notes"}<textarea value={draft.notes} onChange={(event) => setDraft((value) => ({ ...value, notes: event.target.value }))} /></label>
    </form>
    {previewLoading && !preview ? <BaseerCard>{ar ? "جارٍ إعداد معاينة الموظفين المؤهلين…" : "Preparing the eligible employee preview…"}</BaseerCard> : null}
    {preview ? <><BaseerSummaryMetricGrid ariaLabel={ar ? "ملخص معاينة المسير" : "Payroll preview summary"}><BaseerSummaryMetric label={ar ? "نشطون" : "Active"} value={preview.counts.active} /><BaseerSummaryMetric label={ar ? "في إجازة" : "On leave"} value={preview.counts.onLeave} /><BaseerSummaryMetric label={ar ? "موظفو المسير" : "Payroll employees"} value={preview.totals.employeeCount} /><BaseerSummaryMetric label={ar ? "إجمالي تقديري" : "Estimated gross"} value={money(preview.totals.grossAmount)} /><BaseerSummaryMetric label={ar ? "تسوية السلف" : "Advance settlements"} value={money(preview.totals.advanceSettlementAmount)} /><BaseerSummaryMetric label={ar ? "الخصومات الإدارية" : "Administrative deductions"} value={money(preview.totals.administrativeDeductionAmount)} /><BaseerSummaryMetric label={ar ? "صافي تقديري" : "Estimated net"} value={money(preview.totals.netPayableAmount)} /><BaseerSummaryMetric label={ar ? "استثناءات" : "Exceptions"} value={preview.counts.exceptions} /></BaseerSummaryMetricGrid>
      <BaseerCard><strong>{ar ? "قاعدة المسير" : "Payroll rule"}</strong><p>{ar ? "الموظفون النشطون ذوو اتفاق راتب صالح يدرجون تلقائياً. الموظف الجديد خلال الشهر يدرج تلقائياً باستحقاق نسبي وفترة ومبلغ محسوبين من الخادم. موظف الإجازة لا يدرج إلا باختيار صريح، ويستحق كامل الاتفاق؛ لا يوجد خصم إجازة تلقائي. من عُيّن بعد تاريخ الاستحقاق لا يمكن إدراجه." : "Active employees with a valid compensation agreement are included by default. A new hire during the month is automatically included with a server-calculated prorated period and amount. An employee on leave is included only explicitly and receives the full agreement; no leave deduction is automatic. One hired after the accrual date cannot be included."}</p></BaseerCard>
      {preview.exceptions.length ? <BaseerCard><strong>{ar ? "يجب معالجة الاستثناءات قبل الإنشاء" : "Exceptions must be resolved before creation"}</strong><ul>{preview.exceptions.map((item) => <li key={item.employeeId}>{item.employeeNumber} · {item.employeeNameAr} — {item.reason === "ACTIVE_MISSING_COMPENSATION" || item.reason === "ON_LEAVE_MISSING_COMPENSATION" ? (ar ? "لا يوجد اتفاق راتب صالح للشهر المحدد." : "No valid compensation agreement for this month.") : item.reason === "COMPENSATION_DOES_NOT_COVER_PAYROLL_PERIOD" ? (ar ? "اتفاق الراتب لا يغطي فترة الاستحقاق." : "The compensation agreement does not cover the eligibility period.") : (ar ? "تاريخ التعيين بعد تاريخ الاستحقاق؛ لا يمكن إدراجه." : "The hire date is after the accrual date, so this employee cannot be included.")}</li>)}</ul></BaseerCard> : null}
      {previewRows.length ? <DataTable<HrPayrollPreviewEmployee> ariaLabel={ar ? "معاينة موظفي المسير" : "Payroll employee preview"} caption={ar ? "معاينة موظفي المسير" : "Payroll employee preview"} rows={previewRows} columns={columns} rowKey={(employee) => employee.id} /> : null}
      {previewCursor ? <BaseerButton type="button" variant="secondary" disabled={previewLoading} onClick={() => void loadPreview(previewCursor, true)}>{ar ? "تحميل المزيد" : "Load more"}</BaseerButton> : null}
      {applicationEmployee && applicationChoices ? <BaseerCard><strong>{ar ? `تطبيقات ${employeeLabel(language, applicationEmployee)}` : `Applications for ${employeeLabel(language, applicationEmployee)}`}</strong>{applicationEmployee.advances.length || applicationEmployee.administrativeDeductions.length ? <>{applicationEmployee.advances.map((advance) => { const item = applicationChoices.advances[advance.id] ?? { enabled: false, amount: advance.remainingAmount }; return <label key={advance.id}><input type="checkbox" checked={item.enabled} onChange={(event) => updateApplication(applicationEmployee.id, "advances", advance.id, event.target.checked, item.amount)} /> {ar ? `سلفة ${advance.referenceNumber}` : `Advance ${advance.referenceNumber}`} ({money(advance.remainingAmount)}) <input disabled={!item.enabled} inputMode="decimal" value={item.amount} onChange={(event) => updateApplication(applicationEmployee.id, "advances", advance.id, item.enabled, event.target.value)} /></label>; })}{applicationEmployee.administrativeDeductions.map((deduction) => { const item = applicationChoices.deductions[deduction.id] ?? { enabled: false, amount: deduction.remainingAmount }; return <label key={deduction.id}><input type="checkbox" checked={item.enabled} onChange={(event) => updateApplication(applicationEmployee.id, "deductions", deduction.id, event.target.checked, item.amount)} /> {ar ? `خصم إداري ${deduction.referenceNumber}` : `Administrative deduction ${deduction.referenceNumber}`} ({money(deduction.remainingAmount)}) <input disabled={!item.enabled} inputMode="decimal" value={item.amount} onChange={(event) => updateApplication(applicationEmployee.id, "deductions", deduction.id, item.enabled, event.target.value)} /></label>; })}</> : <p>{ar ? "لا توجد سلف أو خصومات إدارية مفتوحة لهذا الموظف." : "This employee has no open advances or administrative deductions."}</p>}<BaseerButton type="button" variant="secondary" onClick={() => setApplicationEmployeeId(null)}>{ar ? "إغلاق التطبيقات" : "Close applications"}</BaseerButton></BaseerCard> : null}
    </> : null}
  </BaseerDialog>;
}
