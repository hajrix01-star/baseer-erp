import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerComboboxField } from "./baseer-combobox-field";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerMoneyInput, BaseerRadio, BaseerTextArea, BaseerTextInput, BaseerTimeInput } from "./baseer-form-fields";
import { BaseerNotice, BaseerSectionHeader, BaseerWorkspace } from "./baseer-workspace";
import { activeSession, requestId } from "./daily-sales-client";
import { createHrEmployeeAdministrativeDeduction } from "./hr-client";
import { approveAttendanceRoster, archiveAttendanceScheduleTemplate, assignAttendanceEmployeesSchedule, createAttendanceBranch, createAttendanceScheduleException, createAttendanceScheduleTemplate, createAttendanceScheduleVersion, decideAttendanceScheduleException, getAttendanceAlerts, getAttendanceCoverage, getAttendanceDashboard, getAttendanceEmployeePortalScope, getAttendanceReport, getAttendanceRoster, issueAttendanceQr, listAttendanceBranches, listAttendanceEmployeeSchedules, listAttendanceScheduleTemplates, saveAttendanceRosterDraft, updateAttendanceScheduleTemplate, type AttendanceAlerts, type AttendanceBranch, type AttendanceCoverage, type AttendanceDashboardV2, type AttendanceEmployeeSchedule, type AttendanceReportV2, type AttendanceRoster, type AttendanceScheduleTemplateReceipt } from "./attendance-client";
import { BaseerApiError, presentBaseerApiError, presentBaseerLoadError } from "./baseer-api-error";
import { formatNumberFixed, formatTime, riyadhBusinessDate } from "./number-format";
import type { AttendanceScheduleDraft, AttendanceScheduleTemplate } from "./hr-attendance-schedules-panel";
import type { AttendanceTeamReportView } from "./hr-attendance-team-report";
import "./hr-attendance-workspace.css";

const HrAttendanceSchedulesPanel = lazy(async () => ({ default: (await import("./hr-attendance-schedules-panel")).HrAttendanceSchedulesPanel }));
const HrAttendanceCoveragePanel = lazy(async () => ({ default: (await import("./hr-attendance-coverage-panel")).HrAttendanceCoveragePanel }));
const HrAttendanceRosterEditor = lazy(async () => ({ default: (await import("./hr-attendance-roster-editor")).HrAttendanceRosterEditor }));
const HrAttendanceEmployeeReport = lazy(async () => ({ default: (await import("./hr-attendance-employee-report")).HrAttendanceEmployeeReport }));
const HrAttendanceTeamReport = lazy(async () => ({ default: (await import("./hr-attendance-team-report")).HrAttendanceTeamReport }));

type Language = "ar" | "en";
type BranchForm = { nameAr: string; latitude: string; longitude: string; radiusMeters: string; maxAccuracyMeters: string; qrValiditySeconds: string };
type DeductionForm = { employeeId: string; employeeName: string; amount: string; reason: string; note: string };
type ExceptionForm = { employeeId: string; employeeName: string; businessDate: string; kind: "FULL_REST" | "CUSTOM_PERIODS"; startTime: string; endTime: string; reason: string };
type AttendanceWorkspaceTab = "today" | "schedules" | "reports" | "settings";
type ReportQuickPeriod = "TODAY" | "WEEK" | "MONTH" | null;
const today = () => riyadhBusinessDate();
const blankBranch = (): BranchForm => ({ nameAr: "ARZ Lounge", latitude: "", longitude: "", radiusMeters: "100", maxAccuracyMeters: "75", qrValiditySeconds: "45" });
const blankDeduction = (): DeductionForm => ({ employeeId: "", employeeName: "", amount: "", reason: "", note: "" });
const blankException = (): ExceptionForm => ({ employeeId: "", employeeName: "", businessDate: today(), kind: "FULL_REST", startTime: "10:00", endTime: "15:30", reason: "" });
const minutes = (value: number, ar: boolean) => value < 60 ? (ar ? `${value} د` : `${value}m`) : (ar ? `${Math.floor(value / 60)} س ${value % 60} د` : `${Math.floor(value / 60)}h ${value % 60}m`);
const isoFromPanelDay = (day: number) => day === 0 ? 7 : day;
const panelFromIsoDay = (day: number) => day === 7 ? 0 : day;
const templatePeriods = (draft: AttendanceScheduleDraft) => draft.days.flatMap((day) => day.intervals.filter((period) => period.start && period.end).map((period) => ({ dayOfWeek: isoFromPanelDay(day.day), startTime: period.start, endTime: period.end })));
const nextRiyadhBusinessDate = () => { const value = new Date(`${riyadhBusinessDate()}T12:00:00+03:00`); value.setDate(value.getDate() + 1); return riyadhBusinessDate(value); };
const reportRange = (period: Exclude<ReportQuickPeriod, null>) => {
  const businessDate = today();
  if (period === "TODAY") return { from: businessDate, to: businessDate };
  if (period === "MONTH") return { from: `${businessDate.slice(0, 8)}01`, to: businessDate };
  const date = new Date(`${businessDate}T12:00:00+03:00`);
  date.setUTCDate(date.getUTCDate() - date.getUTCDay());
  return { from: date.toISOString().slice(0, 10), to: businessDate };
};
const operationalYearStart = () => {
  const value = new Date(`${today()}T12:00:00+03:00`);
  value.setDate(value.getDate() - 364);
  return riyadhBusinessDate(value);
};
function singleEmployeeReport(receipt: AttendanceReportV2, employeeId: string): AttendanceReportV2 {
  const row = receipt.rows.find((item) => item.employeeId === employeeId);
  if (!row) return { ...receipt, rows: [] };
  return {
    ...receipt,
    summary: {
      sessions: row.sessions,
      completedSessions: row.completedSessions,
      openSessions: row.sessions - row.completedSessions,
      workedMinutes: row.workedMinutes,
      plannedMinutes: row.plannedMinutes,
      lateMinutes: row.lateMinutes,
      earlyLeaveMinutes: row.earlyLeaveMinutes,
      extraMinutes: row.extraMinutes,
      shortageMinutes: row.shortageMinutes,
      missingCheckInDays: row.missingCheckInDays,
    },
    rows: [row],
  };
}
function AttendanceDateField({ language, label, value, onChange }: { language: Language; label: string; value: string; onChange: (value: string) => void }) {
  return <label className="hr-attendance__date-field"><span>{label}</span><BaseerDatePicker language={language} label={label} value={value} onChange={onChange} /></label>;
}
function AttendancePanelFallback({ ar }: { ar: boolean }) {
  return <BaseerCard aria-busy="true"><p role="status">{ar ? "جارٍ تحميل القسم…" : "Loading section…"}</p></BaseerCard>;
}
function panelTemplate(template: AttendanceScheduleTemplateReceipt): AttendanceScheduleTemplate {
  const version = template.versions[0];
  return { id: template.id, nameAr: template.nameAr, nameEn: template.nameEn, status: template.status, effectiveFrom: version?.effectiveFrom ?? null, version: version?.versionNumber, days: Array.from({ length: 7 }, (_, day) => ({ day, intervals: (version?.periods ?? []).filter((period) => panelFromIsoDay(period.dayOfWeek) === day).map((period, index) => ({ id: `${template.id}-${day}-${index}`, start: period.startTime, end: period.endTime })) })) };
}
function sameTemplatePeriods(template: AttendanceScheduleTemplateReceipt, draft: AttendanceScheduleDraft) {
  const actual = (template.versions[0]?.periods ?? []).map((period) => `${period.dayOfWeek}:${period.startTime}-${period.endTime}`).sort();
  const proposed = templatePeriods(draft).map((period) => `${period.dayOfWeek}:${period.startTime}-${period.endTime}`).sort();
  return actual.length === proposed.length && actual.every((value, index) => value === proposed[index]);
}

export function HrAttendanceWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  const [branches, setBranches] = useState<AttendanceBranch[]>([]);
  const [dashboard, setDashboard] = useState<AttendanceDashboardV2 | null>(null);
  const [report, setReport] = useState<AttendanceReportV2 | null>(null);
  const [alerts, setAlerts] = useState<AttendanceAlerts | null>(null);
  const [coverage, setCoverage] = useState<AttendanceCoverage | null>(null);
  const [roster, setRoster] = useState<AttendanceRoster | null>(null);
  const [employeeSchedules, setEmployeeSchedules] = useState<Record<string, AttendanceEmployeeSchedule>>({});
  const [employeeSchedulesNextCursor, setEmployeeSchedulesNextCursor] = useState<string | null>(null);
  const [employeeSchedulesLoadingMore, setEmployeeSchedulesLoadingMore] = useState(false);
  const [scheduleTemplates, setScheduleTemplates] = useState<AttendanceScheduleTemplateReceipt[]>([]);
  const [selectedDate, setSelectedDate] = useState(today);
  const [activeTab, setActiveTab] = useState<AttendanceWorkspaceTab>("today");
  const [reportFrom, setReportFrom] = useState(today);
  const [reportTo, setReportTo] = useState(today);
  const [reportQuickPeriod, setReportQuickPeriod] = useState<ReportQuickPeriod>("TODAY");
  const [reportEmployeeId, setReportEmployeeId] = useState("ALL");
  const [teamReportView, setTeamReportView] = useState<AttendanceTeamReportView>("cards");
  const [employeeCommitments, setEmployeeCommitments] = useState<{ month: number | null; year: number | null } | null>(null);
  const [branchOpen, setBranchOpen] = useState(false);
  const [deductionOpen, setDeductionOpen] = useState(false);
  const [exceptionOpen, setExceptionOpen] = useState(false);
  const [exceptionForm, setExceptionForm] = useState<ExceptionForm>(blankException);
  const [exceptionDecision, setExceptionDecision] = useState<{ exceptionId: string; decision: "REJECT" | "CANCEL" } | null>(null);
  const [exceptionDecisionNote, setExceptionDecisionNote] = useState("");
  const [branchForm, setBranchForm] = useState(blankBranch);
  const [deductionForm, setDeductionForm] = useState(blankDeduction);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "danger" | "info"; text: string } | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [qr, setQr] = useState<{ branch: AttendanceBranch; token: string; expiresAt: string } | null>(null);
  const [qrImage, setQrImage] = useState<string | null>(null);
  const [employeePortalScope, setEmployeePortalScope] = useState<{ tenantId: string; companyId: string } | null>(null);
  const loadRequest = useRef(0);
  const loadAbort = useRef<AbortController | null>(null);
  const employeePortalUrl = employeePortalScope ? `${window.location.origin}${window.location.pathname}#attendance?tenant=${employeePortalScope.tenantId}&company=${employeePortalScope.companyId}` : null;

  useEffect(() => {
    if (activeTab !== "settings") return;
    const current = activeSession();
    if (!current) { setEmployeePortalScope(null); return; }
    void getAttendanceEmployeePortalScope(current).then(setEmployeePortalScope).catch(() => setEmployeePortalScope(null));
  }, [activeTab]);

  const load = useCallback(async () => {
    const current = activeSession(); if (!current) return;
    const request = ++loadRequest.current;
    loadAbort.current?.abort();
    const controller = new AbortController(); loadAbort.current = controller;
    const readOptions = { signal: controller.signal };
    try {
      if (activeTab === "today") {
        const [dashboardReceipt, alertsReceipt] = await Promise.all([getAttendanceDashboard(current, selectedDate, readOptions), getAttendanceAlerts(current, selectedDate, readOptions)]);
        if (request !== loadRequest.current) return;
        setDashboard(dashboardReceipt); setAlerts(alertsReceipt);
        return;
      }
      if (activeTab === "schedules") {
        const [scheduleReceipt, coverageReceipt, rosterReceipt, schedulesReceipt] = await Promise.all([listAttendanceScheduleTemplates(current, readOptions), getAttendanceCoverage(current, selectedDate, readOptions), getAttendanceRoster(current, selectedDate, readOptions), listAttendanceEmployeeSchedules(current, readOptions)]);
        if (request !== loadRequest.current) return;
        setScheduleTemplates(scheduleReceipt.templates); setCoverage(coverageReceipt); setRoster(rosterReceipt); setEmployeeSchedules(Object.fromEntries(schedulesReceipt.schedules.map((schedule) => [schedule.employeeId, schedule]))); setEmployeeSchedulesNextCursor(schedulesReceipt.hasMore ? schedulesReceipt.nextCursor : null);
        return;
      }
      if (activeTab === "reports") {
        const dashboardReceipt = await getAttendanceDashboard(current, selectedDate, readOptions);
        if (request !== loadRequest.current) return;
        setDashboard(dashboardReceipt);
        return;
      }
      const branchReceipt = await listAttendanceBranches(current, readOptions);
      if (request !== loadRequest.current) return;
      setBranches(branchReceipt.branches);
    } catch (error) { if (!controller.signal.aborted && request === loadRequest.current) setMessage({ tone: "danger", text: presentBaseerLoadError(error, language, { ar: "بيانات الحضور", en: "attendance data" }) }); }
  }, [activeTab, selectedDate]);
  useEffect(() => { void load(); return () => loadAbort.current?.abort(); }, [load]);

  const loadMoreEmployeeSchedules = async () => {
    const current = activeSession();
    const cursor = employeeSchedulesNextCursor;
    if (!current || !cursor || employeeSchedulesLoadingMore) return;
    setEmployeeSchedulesLoadingMore(true);
    try {
      const receipt = await listAttendanceEmployeeSchedules(current, { cursor, pageSize: 500 });
      setEmployeeSchedules((previous) => ({ ...previous, ...Object.fromEntries(receipt.schedules.map((schedule) => [schedule.employeeId, schedule])) }));
      setEmployeeSchedulesNextCursor(receipt.hasMore ? receipt.nextCursor : null);
    } catch (error) {
      setMessage({ tone: "danger", text: presentBaseerLoadError(error, language, { ar: "جداول الموظفين", en: "employee schedules" }) });
    } finally { setEmployeeSchedulesLoadingMore(false); }
  };

  const saveRoster = async (entries: Array<{ employeeId: string; businessDate: string; kind: "FULL_REST" | "CUSTOM_PERIODS"; periods: Array<{ startMinute: number; endMinute: number; endsNextDay: boolean }> }>, peakPeriods: Array<{ businessDate: string; startMinute: number; endMinute: number }>, baseRevision?: number) => {
    const current = activeSession(); if (!current || !roster || busy) return;
    setBusy(true); setSaveError(null);
    try { const receipt = await saveAttendanceRosterDraft(current, { weekStart: roster.weekStart, baseRevision, entries, peakPeriods, idempotencyKey: requestId() }); setRoster(receipt); setMessage({ tone: "success", text: ar ? "تم حفظ مسودة جدول الدوام وأوقات الذروة." : "The work roster draft and peak periods were saved." }); }
    catch (error) { const text = presentBaseerApiError(error, language, ar ? "تعذر حفظ مسودة جدول الدوام." : "The work roster draft could not be saved."); setSaveError(text); setMessage({ tone: "danger", text }); }
    finally { setBusy(false); }
  };
  const approveRoster = async (mode: "WEEK" | "TEMPORARY" | "PERMANENT", baseRevision: number, effectiveFrom: string, temporaryDays?: 7 | 10) => {
    const current = activeSession(); if (!current || !roster || busy || !roster.plan) return;
    setBusy(true); setSaveError(null);
    try { const receipt = await approveAttendanceRoster(current, { planId: roster.plan.id, baseRevision, mode, effectiveFrom, ...(mode === "TEMPORARY" ? { temporaryDays } : {}), idempotencyKey: requestId() }); setRoster(receipt); setMessage({ tone: "success", text: mode === "WEEK" ? (ar ? "تم اعتماد جدول الأسبوع." : "The weekly roster was approved.") : mode === "TEMPORARY" ? (ar ? "تم اعتماد الدوام المؤقت." : "The temporary schedule was approved.") : (ar ? "تم اعتماد الدوام الدائم وتحديث ملف الموظف." : "The permanent schedule was approved and employee files were updated.") }); await load(); }
    catch (error) { const text = presentBaseerApiError(error, language, ar ? "تعذر اعتماد جدول الدوام." : "The work roster could not be approved."); setSaveError(text); setMessage({ tone: "danger", text }); }
    finally { setBusy(false); }
  };

  const saveBranch = async (event: React.FormEvent) => {
    event.preventDefault(); const current = activeSession(); if (!current || busy) return;
    setSaveError(null);
    const latitude = Number(branchForm.latitude), longitude = Number(branchForm.longitude), radiusMeters = Number(branchForm.radiusMeters), maxAccuracyMeters = Number(branchForm.maxAccuracyMeters), qrValiditySeconds = Number(branchForm.qrValiditySeconds);
    if (!branchForm.nameAr.trim() || !branchForm.latitude.trim() || !branchForm.longitude.trim() || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180 || !Number.isInteger(radiusMeters) || radiusMeters < 25 || radiusMeters > 1_000 || !Number.isInteger(maxAccuracyMeters) || maxAccuracyMeters < 10 || maxAccuracyMeters > 250 || !Number.isInteger(qrValiditySeconds) || qrValiditySeconds < 30 || qrValiditySeconds > 60) { setSaveError(ar ? "أدخل إحداثيات ونطاقاً ودقة صالحين." : "Enter valid coordinates, radius and accuracy."); return; }
    setBusy(true);
    try { await createAttendanceBranch(current, { nameAr: branchForm.nameAr.trim(), latitude, longitude, radiusMeters, maxAccuracyMeters, qrValiditySeconds, idempotencyKey: requestId() }); setBranchOpen(false); setBranchForm(blankBranch()); setMessage({ tone: "success", text: ar ? "تم حفظ موقع الحضور." : "Attendance location saved." }); await load(); }
    catch (error) { const text = presentBaseerApiError(error, language, ar ? "تعذر حفظ الموقع." : "The location could not be saved."); setSaveError(text); setMessage({ tone: "danger", text }); }
    finally { setBusy(false); }
  };
  const refreshQr = async (branch: AttendanceBranch) => {
    const current = activeSession(); if (!current) return;
    try { const next = await issueAttendanceQr(current, branch.id); setQr({ branch, ...next }); }
    catch (error) { setMessage({ tone: "danger", text: presentBaseerApiError(error, language, ar ? "تعذر إنشاء رمز QR." : "Could not generate QR.") }); }
  };
  useEffect(() => {
    if (!qr) { setQrImage(null); return; }
    let cancelled = false;
    // QR output is an encoded scanning contract, not presentation chrome: the
    // fixed dark/light pair preserves finder-pattern contrast in camera apps.
    void import("qrcode").then(({ toDataURL }) => toDataURL(qr.token, { errorCorrectionLevel: "M", margin: 2, width: 420, color: { dark: "#102e20", light: "#ffffff" } })).then((image) => { if (!cancelled) setQrImage(image); }).catch(() => { if (!cancelled) setQrImage(null); });
    const refreshIn = Math.max(500, new Date(qr.expiresAt).valueOf() - Date.now() - 2_000);
    const timer = window.setTimeout(() => void refreshQr(qr.branch), refreshIn);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [qr, language]);
  const loadReport = async (from = reportFrom, to = reportTo, employeeIdOverride?: string) => {
    const current = activeSession(); if (!current || from > to) { setMessage({ tone: "danger", text: ar ? "اختر فترة تقرير صحيحة." : "Choose a valid report period." }); return; }
    const selectedEmployeeId = employeeIdOverride ?? reportEmployeeId;
    const employeeId = selectedEmployeeId === "ALL" ? undefined : selectedEmployeeId;
    setBusy(true);
    try {
      if (!employeeId) {
        setReport(await getAttendanceReport(current, from, to));
        setEmployeeCommitments(null);
        return;
      }
      const readEmployeeReport = async (rangeFrom: string, rangeTo: string) => {
        try { return await getAttendanceReport(current, rangeFrom, rangeTo, employeeId); }
        catch (error) {
          // A legacy local API may still reject the optional employeeId query.
          // Keep the report available from the same server receipt; no browser-side calculation is introduced.
          if (!(error instanceof BaseerApiError) || error.status !== 400 || error.code !== "VALIDATION_FAILED") throw error;
          return singleEmployeeReport(await getAttendanceReport(current, rangeFrom, rangeTo), employeeId);
        }
      };
      const month = reportRange("MONTH");
      const [periodReceipt, monthReceipt, yearReceipt] = await Promise.all([
        readEmployeeReport(from, to),
        readEmployeeReport(month.from, month.to),
        readEmployeeReport(operationalYearStart(), today()),
      ]);
      const score = (row: typeof periodReceipt.rows[number] | undefined) => row?.plannedMinutes ? Math.max(0, Math.min(100, Math.round(((row.plannedMinutes - row.shortageMinutes) / row.plannedMinutes) * 100))) : null;
      setReport(periodReceipt);
      setEmployeeCommitments({ month: score(monthReceipt.rows[0]), year: score(yearReceipt.rows[0]) });
    } catch (error) { setMessage({ tone: "danger", text: presentBaseerApiError(error, language, ar ? "تعذر إعداد تقرير الحضور." : "Could not prepare the attendance report.") }); } finally { setBusy(false); }
  };
  const chooseReportQuickPeriod = (period: Exclude<ReportQuickPeriod, null>) => {
    const range = reportRange(period);
    setReportQuickPeriod(period); setReportFrom(range.from); setReportTo(range.to); void loadReport(range.from, range.to);
  };
  const openEmployeeReport = (employeeId: string) => {
    setReportEmployeeId(employeeId); setEmployeeCommitments(null); setReport(null);
    void loadReport(reportFrom, reportTo, employeeId);
  };
  const saveDeduction = async (event: React.FormEvent) => {
    event.preventDefault(); const current = activeSession(); if (!current || busy) return;
    if (!deductionForm.employeeId || !deductionForm.reason.trim() || !deductionForm.amount.trim()) { setSaveError(ar ? "أدخل المبلغ والسبب." : "Enter the amount and reason."); return; }
    setBusy(true); setSaveError(null);
    try {
      const description = [ar ? `سبب الخصم: ${deductionForm.reason.trim()}` : `Deduction reason: ${deductionForm.reason.trim()}`, deductionForm.note.trim() ? (ar ? `ملاحظة: ${deductionForm.note.trim()}` : `Note: ${deductionForm.note.trim()}`) : ""].filter(Boolean).join("\n");
      await createHrEmployeeAdministrativeDeduction(current, { employeeId: deductionForm.employeeId, businessDate: selectedDate, amount: deductionForm.amount, description, idempotencyKey: requestId() });
      setDeductionOpen(false); setDeductionForm(blankDeduction()); setMessage({ tone: "success", text: ar ? "تم إنشاء الخصم الإداري. لن يدخل في مسير الرواتب إلا عند اختياره لاحقاً." : "Administrative deduction created. It will not affect payroll unless selected later." });
    } catch (error) { const text = presentBaseerApiError(error, language, ar ? "تعذر إنشاء الخصم الإداري." : "Could not create the administrative deduction."); setSaveError(text); setMessage({ tone: "danger", text }); } finally { setBusy(false); }
  };
  const saveException = async (event: React.FormEvent) => {
    event.preventDefault(); const current = activeSession(); if (!current || busy) return;
    if (!exceptionForm.employeeId || !exceptionForm.businessDate || !exceptionForm.reason.trim() || (exceptionForm.kind === "CUSTOM_PERIODS" && (!exceptionForm.startTime || !exceptionForm.endTime || exceptionForm.startTime === exceptionForm.endTime))) {
      setSaveError(ar ? "أدخل تاريخاً وسبباً وفترة صالحة للاستثناء." : "Enter a date, reason and valid exception period."); return;
    }
    setBusy(true); setSaveError(null);
    try {
      await createAttendanceScheduleException(current, { employeeId: exceptionForm.employeeId, businessDate: exceptionForm.businessDate, kind: exceptionForm.kind, periods: exceptionForm.kind === "CUSTOM_PERIODS" ? [{ startTime: exceptionForm.startTime, endTime: exceptionForm.endTime }] : [], reason: exceptionForm.reason.trim(), idempotencyKey: requestId() });
      setExceptionOpen(false); setExceptionForm(blankException()); setMessage({ tone: "success", text: ar ? "تم إنشاء الاستثناء بانتظار الاعتماد." : "The exception was created and is awaiting approval." }); await load();
    } catch (error) { const text = presentBaseerApiError(error, language, ar ? "تعذر إنشاء الاستثناء." : "Could not create the exception."); setSaveError(text); setMessage({ tone: "danger", text }); } finally { setBusy(false); }
  };
  const decideException = async (exceptionId: string, decision: "APPROVE" | "REJECT" | "CANCEL", decisionNote?: string): Promise<boolean> => {
    const current = activeSession(); if (!current || busy) return false;
    setBusy(true);
    try {
      await decideAttendanceScheduleException(current, { exceptionId, decision, decisionNote: decisionNote?.trim() || undefined, idempotencyKey: requestId() });
      setMessage({ tone: "success", text: decision === "APPROVE" ? (ar ? "تم اعتماد الاستثناء." : "Exception approved.") : decision === "REJECT" ? (ar ? "تم رفض الاستثناء." : "Exception rejected.") : (ar ? "تم إلغاء الاستثناء." : "Exception cancelled.") }); await load(); return true;
    } catch (error) { setMessage({ tone: "danger", text: presentBaseerApiError(error, language, ar ? "تعذر تحديث حالة الاستثناء." : "Could not update exception status.") }); return false; } finally { setBusy(false); }
  };
  const submitExceptionDecision = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!exceptionDecision) return;
    if (!exceptionDecisionNote.trim()) { setSaveError(ar ? "أدخل سبب الرفض أو الإلغاء." : "Enter the rejection or cancellation reason."); return; }
    setSaveError(null);
    if (await decideException(exceptionDecision.exceptionId, exceptionDecision.decision, exceptionDecisionNote)) { setExceptionDecision(null); setExceptionDecisionNote(""); }
  };
  const stateLabel = (state: AttendanceDashboardV2["employees"][number]["state"]) => state === "IN_PROGRESS" ? (ar ? "في الدوام" : "At work") : state === "CHECKED_OUT" ? (ar ? "انصرف" : "Checked out") : (ar ? "لم يسجل" : "Not recorded");
  const evaluationSourceLabel = (source: AttendanceDashboardV2["employees"][number]["evaluation"]["scheduleSource"]) => source === "ROSTER" ? (ar ? "جدول معتمد" : "Approved roster") : source === "EXCEPTION" ? (ar ? "استثناء معتمد" : "Approved exception") : source === "WEEKLY_ADJUSTMENT" ? (ar ? "راحة/نصف دوام" : "Weekly adjustment") : source === "TEMPLATE" ? (ar ? "قالب الدوام" : "Work template") : (ar ? "لا يوجد قالب" : "No schedule");
  const alertTone = (type: AttendanceAlerts["alerts"][number]["type"]) => type === "LATE" ? "warning" : type === "MISSING_CHECK_IN" ? "danger" : "info";
  const alertMessage = (alert: AttendanceAlerts["alerts"][number]) => {
    if (ar) return alert.messageAr;
    if (alert.type === "LATE") return `Late by ${alert.minutes} minutes.`;
    if (alert.type === "MISSING_CHECK_IN") return "No check-in has been recorded after the planned start.";
    return "An attendance session remains open and needs review.";
  };
  const createTemplate = async (draft: AttendanceScheduleDraft) => {
    const current = activeSession(); if (!current) return;
    await createAttendanceScheduleTemplate(current, { nameAr: draft.nameAr, nameEn: draft.nameEn || undefined, effectiveFrom: riyadhBusinessDate(), periods: templatePeriods(draft), idempotencyKey: requestId() });
    await load(); setMessage({ tone: "success", text: ar ? "تم إنشاء قالب الدوام." : "Work template created." });
  };
  const updateTemplate = async (templateId: string, draft: AttendanceScheduleDraft) => {
    const current = activeSession(); if (!current) return;
    const previous = scheduleTemplates.find((template) => template.id === templateId);
    await updateAttendanceScheduleTemplate(current, { templateId, nameAr: draft.nameAr, nameEn: draft.nameEn || null, idempotencyKey: requestId() });
    if (previous && !sameTemplatePeriods(previous, draft)) await createAttendanceScheduleVersion(current, { templateId, effectiveFrom: nextRiyadhBusinessDate(), periods: templatePeriods(draft), idempotencyKey: requestId() });
    await load(); setMessage({ tone: "success", text: ar ? "تم حفظ التعديل كنسخة مستقبلية؛ لم تتغير تقارير الماضي." : "Saved as a future version; historic reports are unchanged." });
  };
  const archiveTemplate = async (template: AttendanceScheduleTemplate) => {
    const current = activeSession(); if (!current) return;
    await archiveAttendanceScheduleTemplate(current, { templateId: template.id, idempotencyKey: requestId() });
    await load(); setMessage({ tone: "success", text: ar ? "تمت أرشفة قالب الدوام." : "Work template archived." });
  };
  const assignEmployeesToTemplate = async (template: AttendanceScheduleTemplate, employeeIds: string[], effectiveFrom: string) => {
    const current = activeSession(); if (!current) return;
    const alreadyAssigned = new Set(Object.values(employeeSchedules)
      .filter((schedule) => schedule.assignments.some((assignment) => assignment.templateId === template.id && assignment.effectiveFrom === effectiveFrom))
      .map((schedule) => schedule.employeeId));
    const pending = employeeIds.filter((employeeId) => !alreadyAssigned.has(employeeId));
    if (!pending.length) { setMessage({ tone: "info", text: ar ? "الموظفون المختارون مرتبطون بهذا الشفت بالفعل من التاريخ المحدد." : "Selected employees are already assigned to this shift from the selected date." }); return; }
    const conflict = pending.some((employeeId) => employeeSchedules[employeeId]?.assignments.some((assignment) => assignment.effectiveFrom === effectiveFrom && assignment.templateId !== template.id));
    if (conflict) throw new Error(ar ? "لدى أحد الموظفين شفت آخر يبدأ في التاريخ نفسه. اختر تاريخ سريان لاحقاً." : "At least one employee already has another shift starting on this date. Choose a later effective date.");
    await assignAttendanceEmployeesSchedule(current, { employeeIds: pending, templateId: template.id, effectiveFrom, idempotencyKey: requestId() });
    await load(); setMessage({ tone: "success", text: ar ? `تم ربط ${pending.length} موظف بالشفت.` : `${pending.length} employees were assigned to the shift.` });
  };
  const employeeDirectory = roster?.employees ?? dashboard?.employees ?? [];
  const employeeById = new Map(employeeDirectory.map((employee) => [employee.employeeId, employee]));
  const attendanceEmployees = employeeDirectory.map((employee) => ({ id: employee.employeeId, employeeNumber: employee.employeeNumber, nameAr: employee.employeeNameAr, nameEn: employee.employeeNameEn }));
  const assignedEmployeeIdsByTemplate = Object.fromEntries(scheduleTemplates.map((template) => [template.id, Object.values(employeeSchedules).filter((schedule) => {
    const assignment = schedule.assignments.filter((item) => item.effectiveFrom <= today()).sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0];
    return assignment?.templateId === template.id;
  }).map((schedule) => schedule.employeeId)]));
  const exceptionRows = Object.values(employeeSchedules).flatMap((schedule) => schedule.exceptions.map((exception) => ({ ...exception, employee: employeeById.get(schedule.employeeId) }))).sort((first, second) => second.businessDate.localeCompare(first.businessDate));
  const selectedReportRow = reportEmployeeId === "ALL" ? null : report?.rows[0] ?? null;
  const selectedReportSchedule = selectedReportRow ? employeeSchedules[selectedReportRow.employeeId] : null;

  return <BaseerWorkspace>
    <BaseerSectionHeader eyebrow={ar ? "HR · حضور وانصراف" : "HR · Timekeeping"} title={ar ? "الحضور والانصراف" : "Attendance & timekeeping"} description={ar ? "سجل تشغيلي مستقل. الوقت الزائد والنقص يظهران في التقارير فقط؛ لا خصم أو أوفر تايم تلقائي في الرواتب." : "A separate operational record. Extra and missing time is reported only; payroll is never changed automatically."} actions={activeTab === "settings" ? <BaseerButton type="button" onClick={() => { setSaveError(null); setBranchOpen(true); }}>{ar ? "إضافة موقع حضور" : "Add attendance location"}</BaseerButton> : undefined} />
    {message ? <BaseerNotice tone={message.tone} title={message.tone === "danger" ? (ar ? "تعذر الإجراء" : "Action failed") : undefined}>{message.text}</BaseerNotice> : null}
    <nav className="hr-attendance__tabs" aria-label={ar ? "أقسام الحضور والانصراف" : "Attendance and timekeeping sections"}>
      {([
        ["today", ar ? "اليوم" : "Today"],
        ["schedules", ar ? "الجداول" : "Schedules"],
        ["reports", ar ? "التقارير" : "Reports"],
        ["settings", ar ? "الإعدادات" : "Settings"],
      ] as const).map(([tab, label]) => <button key={tab} type="button" className={`hr-attendance__tab${activeTab === tab ? " hr-attendance__tab--active" : ""}`} aria-current={activeTab === tab ? "page" : undefined} onClick={() => setActiveTab(tab)}>{label}</button>)}
    </nav>
    {activeTab === "reports" ? <BaseerCard className={`hr-attendance__employee-report-picker${reportEmployeeId !== "ALL" ? " is-selected" : ""}`}>
      <div className="hr-attendance__card-header">
        <div>
          <span>{ar ? "تحليل الموظف" : "Employee analysis"}</span>
          <h3>{ar ? "تقرير عملي في شاشة واحدة" : "One practical report"}</h3>
          <p>{ar ? "لا يغيّر التقرير الراتب أو السجل." : "The report never changes payroll or attendance records."}</p>
        </div>
      </div>
      <div className="hr-attendance__report-filter hr-attendance__employee-report-picker-controls">
        <label className="hr-attendance__employee-field"><span>{ar ? "الموظف" : "Employee"}</span><BaseerComboboxField id="attendance-report-employee" label={ar ? "الموظف" : "Employee"} value={reportEmployeeId} options={[{ id: "ALL", label: ar ? "كل الموظفين — الملخص العام" : "All employees — summary" }, ...attendanceEmployees.map((employee) => ({ id: employee.id, label: `${employee.employeeNumber} · ${ar ? employee.nameAr : employee.nameEn ?? employee.nameAr}` }))]} placeholder={ar ? "ابحث بالاسم أو الرقم الوظيفي" : "Search by name or employee number"} emptyLabel={ar ? "لا توجد نتيجة" : "No results"} onChange={(value) => { setReportEmployeeId(value); setEmployeeCommitments(null); setReport(null); }} /></label>
        <AttendanceDateField language={language} label={ar ? "من تاريخ" : "From date"} value={reportFrom} onChange={(value) => { setReportQuickPeriod(null); setReportFrom(value); }} />
        <AttendanceDateField language={language} label={ar ? "إلى تاريخ" : "To date"} value={reportTo} onChange={(value) => { setReportQuickPeriod(null); setReportTo(value); }} />
        <BaseerButton type="button" onClick={() => void loadReport()} disabled={busy}>{ar ? "تطبيق" : "Apply"}</BaseerButton>
      </div>
      <div className="hr-attendance__report-quick-periods" role="group" aria-label={ar ? "فترات التحليل السريعة" : "Quick analysis periods"}>
        {(["TODAY", "WEEK", "MONTH"] as const).map((period) => <BaseerButton key={period} type="button" variant={reportQuickPeriod === period ? "primary" : "quiet"} aria-pressed={reportQuickPeriod === period} disabled={busy} onClick={() => chooseReportQuickPeriod(period)}>{period === "TODAY" ? (ar ? "اليوم" : "Today") : period === "WEEK" ? (ar ? "هذا الأسبوع" : "This week") : (ar ? "هذا الشهر" : "This month")}</BaseerButton>)}
      </div>
    </BaseerCard> : null}
    {activeTab === "reports" && reportEmployeeId !== "ALL" ? <section className="hr-attendance__employee-report-detail" aria-label={ar ? "تفصيل الموظف" : "Employee detail"}>
      {selectedReportRow ? <Suspense fallback={<AttendancePanelFallback ar={ar} />}><HrAttendanceEmployeeReport row={selectedReportRow} schedule={selectedReportSchedule} from={reportFrom} to={reportTo} language={language} monthCommitment={employeeCommitments?.month ?? null} yearCommitment={employeeCommitments?.year ?? null} /></Suspense> : null}
    </section> : null}
    {activeTab === "reports" && reportEmployeeId === "ALL" && report ? <Suspense fallback={<AttendancePanelFallback ar={ar} />}><HrAttendanceTeamReport report={report} language={language} view={teamReportView} onViewChange={setTeamReportView} onOpenEmployee={openEmployeeReport} /></Suspense> : null}
    {activeTab === "schedules" ? <section className="hr-attendance__tab-panel" aria-label={ar ? "الجداول" : "Schedules"}>
    <Suspense fallback={<AttendancePanelFallback ar={ar} />}><HrAttendanceSchedulesPanel language={language} schedules={scheduleTemplates.map(panelTemplate)} employees={attendanceEmployees} assignedEmployeeIdsByTemplate={assignedEmployeeIdsByTemplate} busy={busy} onCreate={createTemplate} onUpdate={updateTemplate} onArchive={archiveTemplate} onAssignEmployees={assignEmployeesToTemplate} /></Suspense>
    {employeeSchedulesNextCursor ? <BaseerCard><BaseerButton type="button" variant="secondary" onClick={() => void loadMoreEmployeeSchedules()} disabled={busy || employeeSchedulesLoadingMore}>{employeeSchedulesLoadingMore ? (ar ? "جارٍ تحميل المزيد من جداول الموظفين…" : "Loading more employee schedules…") : (ar ? "تحميل المزيد من جداول الموظفين" : "Load more employee schedules")}</BaseerButton></BaseerCard> : null}
    {roster ? <Suspense fallback={<AttendancePanelFallback ar={ar} />}><HrAttendanceRosterEditor roster={roster} language={language} busy={busy} onSave={saveRoster} onApprove={approveRoster} /></Suspense> : null}
    {coverage ? <Suspense fallback={<AttendancePanelFallback ar={ar} />}><HrAttendanceCoveragePanel coverage={coverage} language={language} /></Suspense> : null}
    </section> : null}
    {activeTab === "today" ? <section className="hr-attendance__tab-panel" aria-label={ar ? "متابعة اليوم" : "Today monitoring"}>
    <BaseerCard variant="record" className="hr-attendance__daily-overview"><div className="hr-attendance__card-header"><div><span>{ar ? "المتابعة اليومية" : "Daily monitoring"}</span><h3>{ar ? "المخطط مقابل الفعلي" : "Planned versus actual"}</h3><p>{ar ? "المؤشرات تشغيلية فقط؛ لا تنشئ أوفر تايم أو خصماً في الرواتب تلقائياً." : "These are operational indicators only; payroll is never changed automatically."}</p></div><div className="hr-attendance__date-action"><BaseerDatePicker language={language} label={ar ? "تاريخ المتابعة" : "Attendance date"} value={selectedDate} onChange={setSelectedDate} /><BaseerButton type="button" onClick={() => void load()} disabled={busy}>{ar ? "تحديث" : "Refresh"}</BaseerButton></div></div>{dashboard ? <div className="hr-attendance__metrics"><div><small>{ar ? "الموظفون النشطون" : "Active employees"}</small><b>{dashboard.summary.activeEmployees}</b></div><div><small>{ar ? "في الدوام" : "At work"}</small><b>{dashboard.summary.openSessions}</b></div><div><small>{ar ? "لم يسجلوا" : "Missing check-in"}</small><b>{dashboard.summary.notRecorded}</b></div><div><small>{ar ? "تنبيهات اليوم" : "Today alerts"}</small><b>{alerts?.alerts.length ?? "—"}</b></div></div> : null}</BaseerCard>
    <BaseerCard className="hr-attendance__alerts"><div className="hr-attendance__card-header"><div><span>{ar ? "تنبيهات تشغيلية" : "Operational alerts"}</span><h3>{ar ? "ما يحتاج متابعة الآن" : "Requires attention now"}</h3></div><p>{ar ? "تنبيهات اليوم لا تعدل أي سجل أو راتب." : "Today’s alerts never alter attendance or payroll."}</p></div>{alerts?.alerts.length ? <ul className="hr-attendance__alert-list">{alerts.alerts.map((alert) => <li key={`${alert.employeeId}-${alert.type}-${alert.businessDate}`} className={`hr-attendance__alert hr-attendance__alert--${alertTone(alert.type)}`}><span aria-hidden="true">{alert.type === "LATE" ? "◷" : alert.type === "MISSING_CHECK_IN" ? "!" : "◌"}</span><div><b>{alert.employeeNumber} · {ar ? alert.employeeNameAr : alert.employeeNameEn ?? alert.employeeNameAr}</b><p>{alertMessage(alert)}</p></div></li>)}</ul> : <p className="hr-attendance__quiet-state">{ar ? "لا توجد تنبيهات تشغيلية لهذا التاريخ." : "There are no operational alerts for this date."}</p>}</BaseerCard>
    <BaseerCard><div className="hr-attendance__card-header"><div><span>{ar ? "سجل اليوم" : "Today’s record"}</span><h3>{ar ? "الحضور مقابل خطة الدوام" : "Attendance against the work plan"}</h3></div></div>{dashboard?.employees.length ? <div className="baseer-data-grid__scroll"><table className="baseer-data-grid hr-attendance__comparison"><thead><tr><th>{ar ? "الموظف" : "Employee"}</th><th>{ar ? "الحالة" : "Status"}</th><th>{ar ? "المخطط" : "Planned"}</th><th>{ar ? "الفعلي" : "Actual"}</th><th>{ar ? "تأخر" : "Late"}</th><th>{ar ? "خروج مبكر" : "Early leave"}</th><th>{ar ? "زائد / ناقص" : "Extra / shortage"}</th><th>{ar ? "إجراء" : "Action"}</th></tr></thead><tbody>{dashboard.employees.map((employee) => { const evaluation = employee.evaluation; const employeeName = ar ? employee.employeeNameAr : employee.employeeNameEn ?? employee.employeeNameAr; const requiresReview = evaluation.hasOpenSession && selectedDate !== today(); return <tr key={employee.employeeId}><td><strong>{employee.employeeNumber} · {employeeName}</strong><small>{evaluationSourceLabel(evaluation.scheduleSource)}</small></td><td><span className={`hr-attendance__state hr-attendance__state--${requiresReview ? "in_progress" : employee.state.toLowerCase()}`}>{requiresReview ? (ar ? "مراجعة لازمة" : "Review required") : stateLabel(employee.state)}</span></td><td>{evaluation.scheduleSource === "NONE" ? "—" : minutes(evaluation.plannedMinutes, ar)}</td><td>{minutes(evaluation.workedMinutes, ar)}{evaluation.hasOpenSession ? <small>{requiresReview ? (ar ? "جلسة تاريخية مفتوحة" : "Historical session open") : (ar ? "جلسة مفتوحة" : "Open session")}</small> : null}</td><td>{evaluation.lateMinutes ? minutes(evaluation.lateMinutes, ar) : "—"}</td><td>{evaluation.earlyLeaveMinutes ? minutes(evaluation.earlyLeaveMinutes, ar) : "—"}</td><td><span className={evaluation.extraMinutes ? "hr-attendance__time-positive" : evaluation.shortageMinutes ? "hr-attendance__time-negative" : undefined}>{evaluation.extraMinutes ? `+${minutes(evaluation.extraMinutes, ar)}` : evaluation.shortageMinutes ? `−${minutes(evaluation.shortageMinutes, ar)}` : "—"}</span></td><td><div className="hr-attendance__row-actions"><BaseerButton type="button" variant="quiet" onClick={() => { setSaveError(null); setExceptionForm({ ...blankException(), employeeId: employee.employeeId, employeeName, businessDate: selectedDate }); setExceptionOpen(true); }}>{ar ? "استثناء" : "Exception"}</BaseerButton><BaseerButton type="button" variant="quiet" onClick={() => { setSaveError(null); setDeductionForm({ ...blankDeduction(), employeeId: employee.employeeId, employeeName }); setDeductionOpen(true); }}>{ar ? "خصم" : "Deduction"}</BaseerButton></div></td></tr>; })}</tbody></table></div> : <p>{ar ? "لا توجد بيانات حضور لهذا اليوم بعد." : "There is no attendance data for this date yet."}</p>}</BaseerCard>
    </section> : null}
    {activeTab === "reports" ? <section className="hr-attendance__tab-panel" aria-label={ar ? "التقارير" : "Reports"}><BaseerCard><div className="hr-attendance__card-header"><div><span>{ar ? "تقرير الفترة" : "Period report"}</span><h3>{ar ? "ملخص الوقت المخطط والفعلي" : "Planned and actual time summary"}</h3></div></div><div className="hr-attendance__report-quick-periods" role="group" aria-label={ar ? "فترات التقرير السريعة" : "Quick report periods"}>{(["TODAY", "WEEK", "MONTH"] as const).map((period) => <BaseerButton key={period} type="button" variant={reportQuickPeriod === period ? "primary" : "quiet"} aria-pressed={reportQuickPeriod === period} disabled={busy} onClick={() => chooseReportQuickPeriod(period)}>{period === "TODAY" ? (ar ? "اليوم" : "Today") : period === "WEEK" ? (ar ? "هذا الأسبوع" : "This week") : (ar ? "هذا الشهر" : "This month")}</BaseerButton>)}</div><div className="hr-attendance__report-filter"><BaseerDatePicker language={language} label={ar ? "من" : "From"} value={reportFrom} onChange={(value) => { setReportQuickPeriod(null); setReportFrom(value); }} /><BaseerDatePicker language={language} label={ar ? "إلى" : "To"} value={reportTo} onChange={(value) => { setReportQuickPeriod(null); setReportTo(value); }} /><BaseerButton type="button" onClick={() => void loadReport()} disabled={busy}>{ar ? "إعداد التقرير" : "Run report"}</BaseerButton></div>{report ? <><div className="hr-attendance__metrics hr-attendance__metrics--report"><div><small>{ar ? "مخطط" : "Planned"}</small><b>{minutes(report.summary.plannedMinutes, ar)}</b></div><div><small>{ar ? "فعلي" : "Actual"}</small><b>{minutes(report.summary.workedMinutes, ar)}</b></div><div><small>{ar ? "تأخر + مبكر" : "Late + early"}</small><b>{minutes(report.summary.lateMinutes + report.summary.earlyLeaveMinutes, ar)}</b></div><div><small>{ar ? "ناقص" : "Shortage"}</small><b>{minutes(report.summary.shortageMinutes, ar)}</b></div><div><small>{ar ? "زائد" : "Extra"}</small><b>{minutes(report.summary.extraMinutes, ar)}</b></div></div><div className="baseer-data-grid__scroll"><table className="baseer-data-grid hr-attendance__report-table"><thead><tr><th>{ar ? "الموظف" : "Employee"}</th><th>{ar ? "أيام بلا حضور" : "Missing"}</th><th>{ar ? "مخطط" : "Planned"}</th><th>{ar ? "فعلي" : "Actual"}</th><th>{ar ? "تأخر" : "Late"}</th><th>{ar ? "مبكر" : "Early"}</th><th>{ar ? "زائد" : "Extra"}</th><th>{ar ? "ناقص" : "Shortage"}</th></tr></thead><tbody>{report.rows.map((row) => <tr key={row.employeeId}><td>{row.employeeNumber} · {ar ? row.employeeNameAr : row.employeeNameEn ?? row.employeeNameAr}</td><td>{row.missingCheckInDays || "—"}</td><td>{minutes(row.plannedMinutes, ar)}</td><td>{minutes(row.workedMinutes, ar)}</td><td>{row.lateMinutes ? minutes(row.lateMinutes, ar) : "—"}</td><td>{row.earlyLeaveMinutes ? minutes(row.earlyLeaveMinutes, ar) : "—"}</td><td className="hr-attendance__time-positive">{row.extraMinutes ? `+${minutes(row.extraMinutes, ar)}` : "—"}</td><td className="hr-attendance__time-negative">{row.shortageMinutes ? `−${minutes(row.shortageMinutes, ar)}` : "—"}</td></tr>)}</tbody></table></div></> : <p className="hr-attendance__quiet-state">{ar ? "اختر الفترة لإظهار المقارنة والتجميع." : "Choose a period to show the comparison and totals."}</p>}</BaseerCard>
    <BaseerCard className="hr-attendance__exceptions"><div className="hr-attendance__card-header"><div><span>{ar ? "إدارة الاستثناءات" : "Exception management"}</span><h3>{ar ? "تغييرات يومية مؤقتة" : "Temporary daily changes"}</h3><p>{ar ? "لا تغير القالب ولا تعيد كتابة الحضور السابق؛ الاعتماد فقط يجعلها الخطة الفعلية لذلك التاريخ." : "They never edit a template or rewrite past attendance; approval makes the exception the plan for that date only."}</p></div></div>{exceptionRows.length ? <div className="baseer-data-grid__scroll"><table className="baseer-data-grid"><thead><tr><th>{ar ? "التاريخ" : "Date"}</th><th>{ar ? "الموظف" : "Employee"}</th><th>{ar ? "التغيير" : "Change"}</th><th>{ar ? "السبب" : "Reason"}</th><th>{ar ? "الحالة" : "Status"}</th><th>{ar ? "قرار" : "Decision"}</th></tr></thead><tbody>{exceptionRows.map((exception) => <tr key={exception.id}><td dir="ltr">{exception.businessDate}</td><td>{exception.employee ? `${exception.employee.employeeNumber} · ${ar ? exception.employee.employeeNameAr : exception.employee.employeeNameEn ?? exception.employee.employeeNameAr}` : "—"}</td><td>{exception.kind === "FULL_REST" ? (ar ? "راحة كاملة" : "Full rest") : exception.periods.map((period) => `${period.startTime}–${period.endTime}`).join(" · ")}</td><td>{exception.reason}</td><td><span className={`hr-attendance__exception-status hr-attendance__exception-status--${exception.status.toLowerCase()}`}>{exception.status === "PENDING" ? (ar ? "بانتظار الاعتماد" : "Pending") : exception.status === "APPROVED" ? (ar ? "معتمد" : "Approved") : exception.status === "REJECTED" ? (ar ? "مرفوض" : "Rejected") : (ar ? "ملغى" : "Cancelled")}</span></td><td>{exception.status === "PENDING" ? <div className="hr-attendance__row-actions"><BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => void decideException(exception.id, "APPROVE")}>{ar ? "اعتماد" : "Approve"}</BaseerButton><BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => { setSaveError(null); setExceptionDecisionNote(""); setExceptionDecision({ exceptionId: exception.id, decision: "REJECT" }); }}>{ar ? "رفض" : "Reject"}</BaseerButton><BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => { setSaveError(null); setExceptionDecisionNote(""); setExceptionDecision({ exceptionId: exception.id, decision: "CANCEL" }); }}>{ar ? "إلغاء" : "Cancel"}</BaseerButton></div> : "—"}</td></tr>)}</tbody></table></div> : <p className="hr-attendance__quiet-state">{ar ? "لا توجد استثناءات ظاهرة للموظفين في هذه الصفحة." : "There are no visible exceptions for the employees on this page."}</p>}</BaseerCard>
    </section> : null}
    {activeTab === "settings" ? <BaseerCard className="hr-attendance__employee-portal-link"><div><span>{ar ? "رابط الموظفين" : "Employee portal link"}</span><h3>{ar ? "صفحة الموظف بدون دخول ERP" : "Employee page without ERP login"}</h3><p>{ar ? "شارك هذا الرابط مع الموظفين. يدخل الموظف بكوده فقط؛ أما الحضور والانصراف فيتطلبان QR والموقع." : "Share this link with employees. They use only their personal code; check-in and check-out still require QR and location."}</p></div>{employeePortalUrl ? <a dir="ltr" href={employeePortalUrl}>{employeePortalUrl}</a> : <p className="hr-attendance__quiet-state">{ar ? "تعذر تجهيز الرابط. سجل دخول ERP ثم أعد فتح الإعدادات." : "The link could not be prepared. Sign in to ERP, then reopen settings."}</p>}</BaseerCard> : null}
    {activeTab === "settings" ? <section className="hr-attendance__tab-panel" aria-label={ar ? "الإعدادات" : "Settings"}><BaseerCard><h3>{ar ? "موقع الحضور ورمز QR" : "Attendance location and QR"}</h3><p>{ar ? "PIN شخصي من 4 أرقام + QR متغير + موقع دقيق لحظة الحضور أو الانصراف. لا يوجد تتبع مستمر أو ربط هاتف." : "A four-digit personal PIN, rotating QR, and precise location only at check-in or check-out. No continuous tracking or phone binding."}</p><section className="baseer-card-grid">{branches.map((branch) => <BaseerCard key={branch.id} padding="compact"><h4>{ar ? branch.nameAr : branch.nameEn ?? branch.nameAr}</h4><p dir="ltr">{formatNumberFixed(branch.latitude, 6, language)}, {formatNumberFixed(branch.longitude, 6, language)}</p><p>{ar ? `النطاق ${branch.radiusMeters} م · الدقة ${branch.maxAccuracyMeters} م · QR كل ${branch.qrValiditySeconds} ث` : `Radius ${branch.radiusMeters}m · accuracy ${branch.maxAccuracyMeters}m · QR every ${branch.qrValiditySeconds}s`}</p><BaseerButton type="button" onClick={() => void refreshQr(branch)}>{ar ? "عرض QR الحالي" : "Show current QR"}</BaseerButton></BaseerCard>)}</section>{!branches.length ? <BaseerNotice tone="info">{ar ? "أضف موقع المنشأة أولاً، ثم ضع شاشة QR في الكاشير." : "Add the location first, then place the QR screen at the cashier."}</BaseerNotice> : null}</BaseerCard>
    {qr ? <BaseerCard><h3>{ar ? `رمز ${qr.branch.nameAr}` : `${qr.branch.nameAr} code`}</h3><p>{ar ? `صالح حتى ${formatTime(qr.expiresAt, language, "Asia/Riyadh")}` : `Valid until ${formatTime(qr.expiresAt, language, "Asia/Riyadh")}`}</p>{qrImage ? <img style={{ width: "min(100%, 420px)", marginInline: "auto", display: "block" }} src={qrImage} alt={ar ? `رمز حضور ${qr.branch.nameAr}` : `Attendance QR for ${qr.branch.nameAr}`} /> : <p>{ar ? "جارٍ تجهيز الرمز…" : "Preparing QR…"}</p>}<p>{ar ? "اترك هذه الشاشة مفتوحة على جهاز الكاشير؛ يتجدد الرمز تلقائياً." : "Keep this screen open at the cashier; the code refreshes automatically."}</p></BaseerCard> : null}</section> : null}
    <BaseerFormDialog open={branchOpen} title={ar ? "موقع الحضور" : "Attendance location"} language={language} formId="attendance-branch-form" submitLabel={ar ? "حفظ" : "Save"} onClose={() => setBranchOpen(false)} busy={busy} error={saveError}><form id="attendance-branch-form" className="baseer-form" onSubmit={saveBranch}><label>{ar ? "اسم الفرع" : "Branch name"}<BaseerTextInput value={branchForm.nameAr} onChange={(event) => setBranchForm({ ...branchForm, nameAr: event.target.value })} /></label><p>{ar ? "أدخل إحداثيات نقطة المدخل يدوياً." : "Enter the entrance coordinates manually."}</p><label>Latitude<BaseerTextInput dir="ltr" value={branchForm.latitude} onChange={(event) => setBranchForm({ ...branchForm, latitude: event.target.value })} /></label><label>Longitude<BaseerTextInput dir="ltr" value={branchForm.longitude} onChange={(event) => setBranchForm({ ...branchForm, longitude: event.target.value })} /></label><label>{ar ? "النطاق بالمتر" : "Radius in metres"}<BaseerTextInput dir="ltr" value={branchForm.radiusMeters} onChange={(event) => setBranchForm({ ...branchForm, radiusMeters: event.target.value })} /></label><label>{ar ? "أقصى دقة مقبولة" : "Maximum accepted accuracy"}<BaseerTextInput dir="ltr" value={branchForm.maxAccuracyMeters} onChange={(event) => setBranchForm({ ...branchForm, maxAccuracyMeters: event.target.value })} /></label><details className="baseer-form-advanced"><summary>{ar ? "إعدادات QR المتقدمة" : "Advanced QR settings"}</summary><div><label>{ar ? "صلاحية رمز QR بالثواني" : "QR validity in seconds"}<BaseerTextInput dir="ltr" inputMode="numeric" value={branchForm.qrValiditySeconds} onChange={(event) => setBranchForm({ ...branchForm, qrValiditySeconds: event.target.value })} /></label><p>{ar ? "القيمة الافتراضية 45 ثانية؛ النطاق المسموح من 30 إلى 60 ثانية." : "Default: 45 seconds. The allowed range is 30–60 seconds."}</p></div></details></form></BaseerFormDialog>
    <BaseerFormDialog open={deductionOpen} title={ar ? "خصم إداري من الحضور" : "Attendance administrative deduction"} language={language} formId="attendance-deduction-form" submitLabel={ar ? "حفظ الخصم" : "Save deduction"} onClose={() => setDeductionOpen(false)} busy={busy} error={saveError}><form id="attendance-deduction-form" className="baseer-form" onSubmit={saveDeduction}><p>{deductionForm.employeeName}</p><p>{ar ? "ينشأ الخصم في قسم السلفيات والخصومات، ولا يطبق على الراتب تلقائياً." : "The record is created in advances and deductions and never applies to payroll automatically."}</p><label>{ar ? "المبلغ" : "Amount"}<BaseerMoneyInput required value={deductionForm.amount} onValueChange={(amount) => setDeductionForm({ ...deductionForm, amount })} /></label><label>{ar ? "سبب الخصم" : "Deduction reason"}<BaseerTextArea compact required value={deductionForm.reason} onValueChange={(reason) => setDeductionForm({ ...deductionForm, reason })} /></label><label>{ar ? "ملاحظة" : "Note"}<BaseerTextArea compact value={deductionForm.note} onValueChange={(note) => setDeductionForm({ ...deductionForm, note })} /></label></form></BaseerFormDialog>
    <BaseerFormDialog open={exceptionOpen} title={ar ? "استثناء دوام مؤقت" : "Temporary work exception"} language={language} formId="attendance-exception-form" submitLabel={ar ? "إرسال للاعتماد" : "Send for approval"} onClose={() => setExceptionOpen(false)} busy={busy} error={saveError}><form id="attendance-exception-form" className="baseer-form hr-attendance__exception-form" onSubmit={saveException}><p><strong>{exceptionForm.employeeName}</strong></p><p>{ar ? "هذا الاستثناء يخص تاريخاً واحداً فقط. لا يعدل قالب الدوام أو سجل الحضور السابق." : "This exception applies to one date only. It never edits the work template or a past attendance record."}</p><BaseerDatePicker language={language} label={ar ? "تاريخ الاستثناء" : "Exception date"} value={exceptionForm.businessDate} onChange={(businessDate) => setExceptionForm({ ...exceptionForm, businessDate })} /><fieldset><legend>{ar ? "نوع الاستثناء" : "Exception type"}</legend><label><BaseerRadio name="attendance-exception-kind" checked={exceptionForm.kind === "FULL_REST"} onChange={() => setExceptionForm({ ...exceptionForm, kind: "FULL_REST" })} />{ar ? "راحة كاملة" : "Full rest"}</label><label><BaseerRadio name="attendance-exception-kind" checked={exceptionForm.kind === "CUSTOM_PERIODS"} onChange={() => setExceptionForm({ ...exceptionForm, kind: "CUSTOM_PERIODS" })} />{ar ? "فترة دوام خاصة" : "Custom work period"}</label></fieldset>{exceptionForm.kind === "CUSTOM_PERIODS" ? <div className="hr-attendance__time-fields"><label>{ar ? "من" : "From"}<BaseerTimeInput value={exceptionForm.startTime} onChange={(event) => setExceptionForm({ ...exceptionForm, startTime: event.target.value })} /></label><label>{ar ? "إلى" : "To"}<BaseerTimeInput value={exceptionForm.endTime} onChange={(event) => setExceptionForm({ ...exceptionForm, endTime: event.target.value })} /></label></div> : null}<label>{ar ? "السبب" : "Reason"}<BaseerTextArea compact required value={exceptionForm.reason} onValueChange={(reason) => setExceptionForm({ ...exceptionForm, reason })} /></label></form></BaseerFormDialog>
    <BaseerFormDialog open={Boolean(exceptionDecision)} title={exceptionDecision?.decision === "CANCEL" ? (ar ? "إلغاء الاستثناء" : "Cancel exception") : (ar ? "رفض الاستثناء" : "Reject exception")} language={language} formId="attendance-exception-decision-form" submitLabel={exceptionDecision?.decision === "CANCEL" ? (ar ? "تأكيد الإلغاء" : "Confirm cancellation") : (ar ? "تأكيد الرفض" : "Confirm rejection")} onClose={() => { setExceptionDecision(null); setExceptionDecisionNote(""); }} busy={busy} error={saveError} size="compact"><form id="attendance-exception-decision-form" className="baseer-form hr-attendance__exception-form" onSubmit={submitExceptionDecision}><p>{exceptionDecision?.decision === "CANCEL" ? (ar ? "اكتب سبب الإلغاء. يبقى طلب الاستثناء وسجل القرار محفوظين للمراجعة." : "Provide the cancellation reason. The exception request and its decision remain available for review.") : (ar ? "اكتب سبب الرفض. يبقى طلب الاستثناء وسجل القرار محفوظين للمراجعة." : "Provide the rejection reason. The exception request and its decision remain available for review.")}</p><label>{exceptionDecision?.decision === "CANCEL" ? (ar ? "سبب الإلغاء" : "Cancellation reason") : (ar ? "سبب الرفض" : "Rejection reason")}<BaseerTextArea compact required value={exceptionDecisionNote} onValueChange={setExceptionDecisionNote} /></label></form></BaseerFormDialog>
  </BaseerWorkspace>;
}
