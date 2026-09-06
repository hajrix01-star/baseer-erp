import { Fragment, lazy, Suspense, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import "./hr-employee-profile-dialog.css";
import { BaseerBatchPanel, BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerComboboxField } from "./baseer-combobox-field";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerTextInput, BaseerTimeInput } from "./baseer-form-fields";
import { BaseerDialog, BaseerDialogPresentationContext } from "./baseer-dialog";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerMoney } from "./baseer-money";
import { BaseerStatusBadge } from "./baseer-status-badge";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { BaseerEmptyState, BaseerNotice } from "./baseer-workspace";
import { BaseerDataGridField as BaseerDataGrid } from "./baseer-data-grid-field";
import { configureAttendanceEmployeeSchedule, getAttendanceEmployeePin, getAttendanceEmployeeSchedule, listAttendanceScheduleTemplates, type AttendanceEmployeePinDisplay, type AttendanceEmployeeSchedule, type AttendanceScheduleTemplateReceipt } from "./attendance-client";
import { activeSession } from "./daily-sales-client";
import { requestId } from "./daily-sales-client";
import { riyadhBusinessDate } from "./number-format";
import { compensationBreakdown } from "./hr-compensation-breakdown";
import { HrEmployeePhoto } from "./hr-employee-photo";
import { HrEmployeeAttendanceComplianceCard } from "./hr-employee-attendance-compliance-card";
import { hrEnumLabel, hrText } from "./hr-copy";
import { createHrEmployeeWorkTerms, listHrAdministrativeDeductions, listHrAdvances, listHrEmployeeLeaves, listHrEmployeePayrollHistory, listHrEmployeeWorkTerms, listHrFinalSettlements, type HrAdministrativeDeduction, type HrAdvance, type HrDetail, type HrEmployeeLeave, type HrEmployeePayrollHistoryLine, type HrEmployeeWorkTerm, type HrFinalSettlement } from "./hr-client";
import { listHrEmployeeServices, type HrEmployeeServiceRecord } from "./hr-services-client";
import { hasActivePermission } from "./module-access";
type Language = "ar" | "en";
type ProfileTab = "overview" | "employment" | "payroll" | "time" | "compliance" | "documents" | "financial";
type LedgerRow = {
    id: string;
    reference: ReactNode;
    date: string;
    description: ReactNode;
    gross: ReactNode;
    adjustments: ReactNode;
    balance: ReactNode;
    status: ReactNode;
};
type LedgerSection = {
    id: string;
    title: string;
    empty: string;
    rows: readonly LedgerRow[];
    onMore?: () => void | Promise<void>;
    loadingMore?: boolean;
};
type HrEmployeeProfileProps = {
    detail: HrDetail;
    language: Language;
    onClose: () => void;
    onEdit: () => void;
    onManageCompensation: () => void;
    onLoadMoreMovements: () => Promise<void>;
    onError: (message: string) => void;
    onChanged: () => Promise<void>;
};
const HrPayrollDetailDialog = lazy(async () => ({ default: (await import("./hr-payroll-detail-dialog")).HrPayrollDetailDialog }));
const HrEmployeeDocumentsPanel = lazy(async () => ({ default: (await import("./hr-employee-documents-panel")).HrEmployeeDocumentsPanel }));
const HrEmployeeLettersPanel = lazy(async () => ({ default: (await import("./hr-employee-letters-panel")).HrEmployeeLettersPanel }));
const HrEmployeePromotionsPanel = lazy(async () => ({ default: (await import("./hr-employee-promotions-panel")).HrEmployeePromotionsPanel }));
const HrFinalSettlementWorkspace = lazy(async () => ({ default: (await import("./hr-final-settlement-panel")).HrFinalSettlementWorkspace }));
const HrEmployeeAttendancePinDialog = lazy(async () => ({ default: (await import("./hr-employee-attendance-pin-dialog")).HrEmployeeAttendancePinDialog }));
const employeeStatus = (language: Language, status: HrDetail["employee"]["status"]) => ({ ACTIVE: language === "ar" ? "نشط" : "Active", ON_LEAVE: language === "ar" ? "في إجازة" : "On leave", TERMINATED: language === "ar" ? "منتهٍ" : "Terminated", ARCHIVED: language === "ar" ? "مؤرشف" : "Archived" })[status];
const payrollTone = (status: string) => status === "PAID" ? "success" as const : status === "REVERSED" ? "danger" as const : status === "DRAFT" ? "warning" as const : "info" as const;
function EmployeeWorkTermsPanel({ language, employeeId, workTerms, canManage, onChanged }: { language: Language; employeeId: string; workTerms: HrEmployeeWorkTerm[]; canManage: boolean; onChanged: () => Promise<void> }) {
    const ar = language === "ar"; const [open, setOpen] = useState(false); const [hours, setHours] = useState(""); const [effectiveFrom, setEffectiveFrom] = useState(riyadhBusinessDate); const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
    const active = workTerms.find((item) => item.effectiveFrom <= riyadhBusinessDate() && (!item.effectiveTo || item.effectiveTo >= riyadhBusinessDate())) ?? workTerms[0] ?? null;
    const save = async (event: React.FormEvent) => { event.preventDefault(); const session = activeSession(); const value = Number(hours); if (!session || !canManage || busy) return; if (!Number.isFinite(value) || value < .5 || value > 24 || Math.round(value * 60) !== value * 60) { setError(ar ? "أدخل ساعات يومية صحيحة بين نصف ساعة و24 ساعة." : "Enter daily hours between 0.5 and 24 hours."); return; } setBusy(true); setError(null); try { await createHrEmployeeWorkTerms(session, { employeeId, effectiveFrom, workMinutesPerDay: Math.round(value * 60), notes: notes.trim() || undefined, idempotencyKey: requestId() }); await onChanged(); setOpen(false); setHours(""); setNotes(""); } catch (cause) { setError(cause instanceof Error ? cause.message : (ar ? "تعذر حفظ اتفاق ساعات العمل." : "Could not save the work-hours agreement.")); } finally { setBusy(false); } };
    return <><div className="hr-employee-profile__work-terms"><h4>{ar ? "اتفاق ساعات العمل الأصلي" : "Original work-hours agreement"}</h4><p>{active ? (ar ? `${active.workMinutesPerDay / 60} ساعة يومياً · يسري من ${active.effectiveFrom}` : `${active.workMinutesPerDay / 60} hours/day · effective ${active.effectiveFrom}`) : (ar ? "لا يوجد اتفاق ساعات مسجل." : "No work-hours agreement has been recorded.")}</p><details><summary>{ar ? `سجل الاتفاقات (${workTerms.length})` : `Agreement history (${workTerms.length})`}</summary><ul>{workTerms.map((item) => <li key={item.id}>{ar ? `${item.workMinutesPerDay / 60} ساعة يومياً · ${item.effectiveFrom}${item.effectiveTo ? ` إلى ${item.effectiveTo}` : ""}` : `${item.workMinutesPerDay / 60} hours/day · ${item.effectiveFrom}${item.effectiveTo ? ` to ${item.effectiveTo}` : ""}`}</li>)}</ul></details>{canManage ? <BaseerButton type="button" variant="quiet" onClick={() => { setError(null); setEffectiveFrom(riyadhBusinessDate()); setOpen(true); }}>{ar ? "تسجيل اتفاق ساعات" : "Record work-hours agreement"}</BaseerButton> : null}</div><BaseerDialogPresentationContext.Provider value="modal"><BaseerFormDialog open={open} title={ar ? "اتفاق ساعات العمل الأصلي" : "Original work-hours agreement"} language={language} formId={`employee-work-terms-${employeeId}`} submitLabel={ar ? "حفظ الاتفاق" : "Save agreement"} onClose={() => setOpen(false)} busy={busy} error={error}><form id={`employee-work-terms-${employeeId}`} className="baseer-form" onSubmit={save}><p>{ar ? "للـمالك فقط. يظل الاتفاق السابق في السجل؛ ولا يغير هذا الراتب أو جدول الحضور." : "Owner-only. Earlier agreements remain in history; this does not change salary or the attendance schedule."}</p><label>{ar ? "ساعات العمل اليومية" : "Daily work hours"}<BaseerTextInput required dir="ltr" inputMode="decimal" value={hours} onChange={(event) => setHours(event.target.value)} /></label><BaseerDatePicker language={language} label={ar ? "تاريخ السريان" : "Effective from"} value={effectiveFrom} onChange={setEffectiveFrom} /><label>{ar ? "ملاحظة" : "Note"}<textarea className="baseer-textarea baseer-textarea--compact" value={notes} onChange={(event) => setNotes(event.target.value)} /></label></form></BaseerFormDialog></BaseerDialogPresentationContext.Provider></>;
}
function HrEmployeeProfileSummary({ detail, language, canReadPayroll, canReadAdvances, canReadLeaves, canReadDocuments }: Pick<HrEmployeeProfileProps, "detail" | "language"> & Readonly<{ canReadPayroll: boolean; canReadAdvances: boolean; canReadLeaves: boolean; canReadDocuments: boolean; }>) {
    const ar = language === "ar";
    const summary = detail.profileSummary;
    return <><section className="hr-employee-profile__summary" aria-label={ar ? "ملخص ملف الموظف" : "Employee file summary"}>
      <BaseerSummaryMetricGrid role="list" ariaLabel={ar ? "مؤشرات ملف الموظف" : "Employee file metrics"}>
        {canReadPayroll ? <BaseerSummaryMetric role="listitem" label={ar ? "إجمالي الراتب" : "Total salary"} value={detail.compensation ? <BaseerMoney value={detail.compensation.monthlyGross} language={language}/> : "—"}/> : null}
        {canReadAdvances ? <BaseerSummaryMetric role="listitem" label={ar ? "سجل السلفيات" : "Advance register"} value={summary.advanceCount}/> : null}
        {canReadAdvances ? <BaseerSummaryMetric role="listitem" label={ar ? `المتبقي · ${summary.openAdvanceCount} مفتوحة` : `Outstanding · ${summary.openAdvanceCount} open`} value={<BaseerMoney value={summary.openAdvanceBalance} language={language}/>}/> : null}
        {canReadPayroll ? <BaseerSummaryMetric role="listitem" label={ar ? "مسيرات الرواتب" : "Payroll runs"} value={summary.payrollRunCount}/> : null}
        {canReadLeaves ? <BaseerSummaryMetric role="listitem" label={ar ? "الإجازات" : "Leaves"} value={summary.leaveCount}/> : null}
        <BaseerSummaryMetric role="listitem" label={ar ? "خدمات الموظف" : "Employee services"} value={detail.serviceCount}/>
        {canReadDocuments ? <BaseerSummaryMetric role="listitem" label={ar ? "ملفات الموظف" : "Employee files"} value={summary.documentCount}/> : null}
        <BaseerSummaryMetric role="listitem" label={ar ? "الترقيات وتغييرات الراتب" : "Promotions & salary changes"} value={summary.promotionCount + detail.compensationHistoryCount}/>
      </BaseerSummaryMetricGrid>
    </section>{hasActivePermission("attendance.manage") ? <HrEmployeeAttendanceComplianceCard employeeId={detail.employee.id} language={language} /> : null}</>;
}
/** The employee file is the HR workspace. Salary history stays internal while the UI stays simple. */
export function HrEmployeeProfileDialog({ detail, language, onClose, onEdit, onManageCompensation, onLoadMoreMovements, onError, onChanged }: HrEmployeeProfileProps) {
    const ar = language === "ar";
    const text = hrText(language);
    const employeeId = detail.employee.id;
    const canManageEmployees = hasActivePermission("hr.employees.write");
    const canReadPayroll = hasActivePermission("hr.payroll.read");
    const canReadAdvances = hasActivePermission("hr.advances.read");
    const canManageDeductions = hasActivePermission("hr.deductions.manage");
    const canReadFinalSettlements = hasActivePermission("hr.final_settlements.read");
    const canCreateFinalSettlements = hasActivePermission("hr.final_settlements.create");
    const canReadLeaves = hasActivePermission("hr.leaves.read");
    const canReadDocuments = hasActivePermission("hr.employee_documents.read");
    const canReadLetters = hasActivePermission("hr.employee_letters.read");
    const canManageAttendance = hasActivePermission("attendance.manage");
    const [tab, setTab] = useState<ProfileTab>("overview");
    const [loadingTab, setLoadingTab] = useState<"payroll" | "time" | "compliance" | null>(null);
    const [payroll, setPayroll] = useState<HrEmployeePayrollHistoryLine[]>([]);
    const [payrollCursor, setPayrollCursor] = useState<string | null>(null);
    const [advances, setAdvances] = useState<HrAdvance[]>([]);
    const [advanceCursor, setAdvanceCursor] = useState<string | null>(null);
    const [deductions, setDeductions] = useState<HrAdministrativeDeduction[]>([]);
    const [deductionCursor, setDeductionCursor] = useState<string | null>(null);
    const [leaves, setLeaves] = useState<HrEmployeeLeave[]>([]);
    const [leaveCursor, setLeaveCursor] = useState<string | null>(null);
    const [settlements, setSettlements] = useState<HrFinalSettlement[]>([]);
    const [settlementCursor, setSettlementCursor] = useState<string | null>(null);
    const [services, setServices] = useState<HrEmployeeServiceRecord[]>([]);
    const [serviceCursor, setServiceCursor] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState<"payroll" | "settlements" | "advances" | "deductions" | "time" | "compliance" | null>(null);
    const [payrollRunId, setPayrollRunId] = useState<string | null>(null);
    const [finalSettlementOpen, setFinalSettlementOpen] = useState(false);
    const [attendancePinOpen, setAttendancePinOpen] = useState(false);
    const [attendancePinDisplay, setAttendancePinDisplay] = useState<AttendanceEmployeePinDisplay | null>(null);
    const [employeeSchedule, setEmployeeSchedule] = useState<AttendanceEmployeeSchedule | null>(null);
    const [employeeWorkTerms, setEmployeeWorkTerms] = useState<HrEmployeeWorkTerm[]>([]);
    const [scheduleTemplates, setScheduleTemplates] = useState<AttendanceScheduleTemplateReceipt[]>([]);
    const [scheduleOpen, setScheduleOpen] = useState(false);
    const [scheduleTemplateId, setScheduleTemplateId] = useState("");
    const [scheduleEffectiveFrom, setScheduleEffectiveFrom] = useState(riyadhBusinessDate);
    const [weeklyDay, setWeeklyDay] = useState("7");
    const [weeklyKind, setWeeklyKind] = useState<"FULL_REST" | "CUSTOM_PERIODS">("FULL_REST");
    const [weeklyStart, setWeeklyStart] = useState("10:00");
    const [weeklyEnd, setWeeklyEnd] = useState("15:30");
    const [scheduleBusy, setScheduleBusy] = useState(false);
    const [scheduleError, setScheduleError] = useState<string | null>(null);
    const loadedTabs = useRef(new Set<"payroll" | "time" | "compliance">());
    const loadingTabs = useRef(new Set<"payroll" | "time" | "compliance">());
    const employeeVersion = useRef(0);
    useEffect(() => {
        setTab("overview");
        setPayroll([]);
        setPayrollCursor(null);
        setAdvances([]);
        setAdvanceCursor(null);
        setDeductions([]);
        setDeductionCursor(null);
        setLeaves([]);
        setLeaveCursor(null);
        setSettlements([]);
        setSettlementCursor(null);
        setServices([]);
        setServiceCursor(null);
        loadedTabs.current.clear();
        loadingTabs.current.clear();
        employeeVersion.current += 1;
        setLoadingTab(null);
        setLoadingMore(null);
    }, [employeeId]);
    useEffect(() => { const session = activeSession(); if (!session || !canManageAttendance) {
        setAttendancePinDisplay(null);
        return;
    } let active = true; void getAttendanceEmployeePin(session, employeeId).then((value) => { if (active)
        setAttendancePinDisplay(value); }).catch(() => { if (active)
        setAttendancePinDisplay(null); }); return () => { active = false; }; }, [canManageAttendance, employeeId]);
    const refreshEmployeeSchedule = async () => {
        const session = activeSession();
        if (!session || !canManageAttendance)
            return;
        const [schedule, templates, workTerms] = await Promise.all([getAttendanceEmployeeSchedule(session, employeeId), listAttendanceScheduleTemplates(session), listHrEmployeeWorkTerms(session, employeeId)]);
        setEmployeeSchedule(schedule); setEmployeeWorkTerms(workTerms.workTerms);
        setScheduleTemplates(templates.templates);
    };
    useEffect(() => { let active = true; if (!canManageAttendance) {
        setEmployeeSchedule(null);
        setEmployeeWorkTerms([]);
        return;
    } void refreshEmployeeSchedule().catch(() => { if (active)
        setEmployeeSchedule(null); }); return () => { active = false; }; }, [canManageAttendance, employeeId]);
    useEffect(() => {
        const session = activeSession();
        // Payroll can be written by a completed migration while an employee file
        // remains open. Reload this tab whenever it is selected so a cached empty
        // result never hides newly linked payroll lines; the other read-only tabs
        // retain their lightweight first-load cache.
        if (!session || (tab !== "payroll" && tab !== "time" && tab !== "compliance") || (tab !== "payroll" && loadedTabs.current.has(tab)) || loadingTabs.current.has(tab))
            return;
        const requestedTab = tab;
        const version = employeeVersion.current;
        loadingTabs.current.add(requestedTab);
        setLoadingTab(requestedTab);
        const request = requestedTab === "payroll"
            ? Promise.all([
                canReadPayroll ? listHrEmployeePayrollHistory(session, employeeId, { pageSize: 25 }) : Promise.resolve(null),
                canReadAdvances ? listHrAdvances(session, { employeeId, pageSize: 50 }) : Promise.resolve(null),
                canManageDeductions ? listHrAdministrativeDeductions(session, { employeeId, pageSize: 50 }) : Promise.resolve(null),
                canReadFinalSettlements ? listHrFinalSettlements(session, { employeeId, pageSize: 25 }) : Promise.resolve(null),
            ]).then(([payrollReceipt, advanceReceipt, deductionReceipt, settlementReceipt]) => {
                if (version !== employeeVersion.current)
                    return;
                setPayroll(payrollReceipt?.lines ?? []);
                setPayrollCursor(payrollReceipt?.nextCursor ?? null);
                setAdvances(advanceReceipt?.advances ?? []);
                setAdvanceCursor(advanceReceipt?.nextCursor ?? null);
                setDeductions(deductionReceipt?.deductions ?? []);
                setDeductionCursor(deductionReceipt?.nextCursor ?? null);
                setSettlements(settlementReceipt?.settlements ?? []);
                setSettlementCursor(settlementReceipt?.nextCursor ?? null);
            })
            : requestedTab === "time" ? listHrEmployeeLeaves(session, { employeeId, pageSize: 50 }).then((leaveReceipt) => {
                if (version !== employeeVersion.current)
                    return;
                setLeaves(leaveReceipt.leaves);
                setLeaveCursor(leaveReceipt.nextCursor);
            }) : listHrEmployeeServices(session, { employeeId, pageSize: 50 }).then((serviceReceipt) => {
                if (version !== employeeVersion.current)
                    return;
                setServices(serviceReceipt.services);
                setServiceCursor(serviceReceipt.nextCursor);
            });
        void request.then(() => { if (version === employeeVersion.current)
            loadedTabs.current.add(requestedTab); })
            .catch(() => { if (version === employeeVersion.current)
            onError(requestedTab === "payroll" ? (ar ? "تعذر تحميل الرواتب والتسويات." : "Payroll and settlements could not be loaded.") : requestedTab === "time" ? (ar ? "تعذر تحميل سجل الإجازات." : "Leave history could not be loaded.") : (ar ? "تعذر تحميل الخدمات والامتثال." : "Services and compliance could not be loaded.")); })
            .finally(() => { loadingTabs.current.delete(requestedTab); if (version === employeeVersion.current)
            setLoadingTab((current) => current === requestedTab ? null : current); });
    }, [ar, canManageDeductions, canReadAdvances, canReadFinalSettlements, canReadLeaves, canReadPayroll, employeeId, onError, tab]);
    const loadMore = async (kind: "payroll" | "settlements" | "advances" | "deductions" | "time" | "compliance") => {
        const session = activeSession();
        const cursor = kind === "payroll" ? payrollCursor : kind === "settlements" ? settlementCursor : kind === "advances" ? advanceCursor : kind === "deductions" ? deductionCursor : kind === "time" ? leaveCursor : serviceCursor;
        if (!session || !cursor || loadingMore)
            return;
        const version = employeeVersion.current;
        setLoadingMore(kind);
        try {
            if (kind === "payroll") {
                const receipt = await listHrEmployeePayrollHistory(session, employeeId, { cursor, pageSize: 25 });
                if (version !== employeeVersion.current)
                    return;
                setPayroll((rows) => [...rows, ...receipt.lines.filter((line) => !rows.some((row) => row.id === line.id))]);
                setPayrollCursor(receipt.nextCursor);
            }
            else if (kind === "settlements") {
                const receipt = await listHrFinalSettlements(session, { employeeId, cursor, pageSize: 25 });
                if (version !== employeeVersion.current)
                    return;
                setSettlements((rows) => [...rows, ...receipt.settlements.filter((settlement) => !rows.some((row) => row.id === settlement.id))]);
                setSettlementCursor(receipt.nextCursor);
            }
            else if (kind === "advances") {
                const receipt = await listHrAdvances(session, { employeeId, cursor, pageSize: 50 });
                if (version !== employeeVersion.current)
                    return;
                setAdvances((rows) => [...rows, ...receipt.advances.filter((advance) => !rows.some((row) => row.id === advance.id))]);
                setAdvanceCursor(receipt.nextCursor);
            }
            else if (kind === "deductions") {
                const receipt = await listHrAdministrativeDeductions(session, { employeeId, cursor, pageSize: 50 });
                if (version !== employeeVersion.current)
                    return;
                setDeductions((rows) => [...rows, ...receipt.deductions.filter((deduction) => !rows.some((row) => row.id === deduction.id))]);
                setDeductionCursor(receipt.nextCursor);
            }
            else if (kind === "time") {
                const receipt = await listHrEmployeeLeaves(session, { employeeId, cursor, pageSize: 50 });
                if (version !== employeeVersion.current)
                    return;
                setLeaves((rows) => [...rows, ...receipt.leaves.filter((leave) => !rows.some((row) => row.id === leave.id))]);
                setLeaveCursor(receipt.nextCursor);
            }
            else {
                const receipt = await listHrEmployeeServices(session, { employeeId, cursor, pageSize: 50 });
                if (version !== employeeVersion.current)
                    return;
                setServices((rows) => [...rows, ...receipt.services.filter((service) => !rows.some((row) => row.id === service.id))]);
                setServiceCursor(receipt.nextCursor);
            }
        }
        catch {
            if (version === employeeVersion.current)
                onError(ar ? "تعذر تحميل المزيد من سجل الموظف." : "More employee records could not be loaded.");
        }
        finally {
            if (version === employeeVersion.current)
                setLoadingMore(null);
        }
    };
    const name = ar ? detail.employee.nameAr : detail.employee.nameEn ?? detail.employee.nameAr;
    const salary = detail.compensation;
    const currentSalaryBreakdown = salary ? compensationBreakdown(salary) : null;
    const currentAllowances = salary ? [
        { id: "food", label: ar ? "بدل الأكل" : "Food allowance", amount: salary.foodAllowance },
        { id: "housing", label: ar ? "بدل السكن" : "Housing allowance", amount: salary.housingAllowance },
        { id: "transport", label: ar ? "بدل المواصلات" : "Transport allowance", amount: salary.transportAllowance },
        { id: "other", label: ar ? "بدلات أخرى" : "Other allowances", amount: salary.otherAllowance },
    ].filter((allowance) => Number(allowance.amount) > 0) : [];
    const tabs = useMemo<readonly {
        id: ProfileTab;
        label: string;
    }[]>(() => [
        { id: "overview", label: ar ? "نظرة 360" : "360 overview" },
        { id: "employment", label: ar ? "المسار والتعويض والزيادات" : "Employment, compensation & raises" },
        ...((canReadPayroll || canReadAdvances || canManageDeductions || canReadFinalSettlements) ? [{ id: "payroll" as const, label: ar ? "الرواتب والتسويات" : "Payroll & settlements" }] : []),
        ...(canReadLeaves ? [{ id: "time" as const, label: ar ? "الإجازات" : "Leaves" }] : []),
        { id: "compliance", label: ar ? "الخدمات والامتثال" : "Services & compliance" },
        ...((canReadDocuments || canReadLetters) ? [{ id: "documents" as const, label: ar ? "المستندات والخطابات" : "Documents & letters" }] : []),
        { id: "financial", label: ar ? "السجل المالي" : "Financial record" },
    ], [ar, canManageDeductions, canReadAdvances, canReadDocuments, canReadFinalSettlements, canReadLeaves, canReadLetters, canReadPayroll]);
    useEffect(() => { if (!tabs.some((item) => item.id === tab))
        setTab(tabs[0]?.id ?? "overview"); }, [tab, tabs]);
    const leaveColumns = [{ id: "type", header: ar ? "النوع" : "Type", cell: (row: HrEmployeeLeave) => hrEnumLabel(language, row.leaveType) }, { id: "period", header: ar ? "الفترة" : "Period", cell: (row: HrEmployeeLeave) => `${row.startDate} — ${row.endDate}` }, { id: "return", header: ar ? "العودة" : "Return", cell: (row: HrEmployeeLeave) => row.actualReturnDate ?? "—" }, { id: "status", header: ar ? "الحالة" : "Status", cell: (row: HrEmployeeLeave) => <BaseerStatusBadge tone={row.status === "RETURNED" ? "success" : "warning"}>{row.status === "RETURNED" ? (ar ? "عاد للعمل" : "Returned") : (ar ? "معتمدة" : "Approved")}</BaseerStatusBadge> }];
    const serviceColumns = [{ id: "type", header: ar ? "الخدمة" : "Service", cell: (row: HrEmployeeServiceRecord) => hrEnumLabel(language, row.serviceType) }, { id: "reference", header: ar ? "المرجع" : "Reference", cell: (row: HrEmployeeServiceRecord) => row.referenceNumber ?? "—" }, { id: "expiry", header: ar ? "الانتهاء" : "Expiry", cell: (row: HrEmployeeServiceRecord) => row.expiryDate ?? "—" }, { id: "status", header: ar ? "الحالة" : "Status", cell: (row: HrEmployeeServiceRecord) => <BaseerStatusBadge tone={row.status === "ISSUED" ? "success" : row.status === "CANCELLED" ? "neutral" : "warning"}>{hrEnumLabel(language, row.status)}</BaseerStatusBadge> }];
    const movementColumns = [{ id: "date", header: ar ? "التاريخ" : "Date", cell: (row: HrDetail["movements"][number]) => row.businessDate }, { id: "type", header: ar ? "نوع الحركة" : "Movement type", cell: (row: HrDetail["movements"][number]) => hrEnumLabel(language, row.movementType) }, { id: "reference", header: ar ? "المرجع" : "Reference", cell: (row: HrDetail["movements"][number]) => <bdi dir="ltr">{row.sourceReference}</bdi> }, { id: "amount", header: ar ? "المبلغ" : "Amount", numeric: true, align: "end" as const, cell: (row: HrDetail["movements"][number]) => <BaseerMoney value={row.amount} language={language}/> }];
    const sections: readonly LedgerSection[] = [
        ...(canReadPayroll ? [{ id: "payroll", title: ar ? "مسيرات الرواتب" : "Payroll runs", empty: ar ? "لا توجد مسيرات لهذا الموظف." : "No payroll runs for this employee.", rows: payroll.map((row) => ({ id: row.id, reference: <BaseerButton type="button" variant="quiet" onClick={() => setPayrollRunId(row.payrollRunId)}>{row.runNumber}</BaseerButton>, date: row.payrollMonth.slice(0, 7), description: text.monthlyPayroll, gross: <BaseerMoney value={row.grossSalary} language={language}/>, adjustments: <span className="hr-payroll-settlements__adjustments"><span>{ar ? "سلف" : "Advances"} <BaseerMoney value={row.advanceSettlementAmount} language={language}/></span><span>{ar ? "خصومات" : "Deductions"} <BaseerMoney value={row.administrativeDeductionAmount} language={language}/></span></span>, balance: <BaseerMoney value={row.netPayableAmount} language={language}/>, status: <BaseerStatusBadge tone={payrollTone(row.payrollStatus)}>{hrEnumLabel(language, row.payrollStatus)}</BaseerStatusBadge> })), onMore: payrollCursor ? () => loadMore("payroll") : undefined, loadingMore: loadingMore === "payroll" }] : []),
        ...(canReadFinalSettlements ? [{ id: "settlements", title: ar ? "مخالصات نهاية الخدمة" : "End-of-service settlements", empty: ar ? "لا توجد مخالصات نهاية خدمة." : "No end-of-service settlements.", rows: settlements.map((row) => ({ id: row.id, reference: row.settlementNumber, date: row.terminationDate, description: ar ? "مخالصة نهاية الخدمة" : "End-of-service settlement", gross: <BaseerMoney value={row.fullAwardAmount} language={language}/>, adjustments: <BaseerMoney value={row.recoveryAmount} language={language}/>, balance: <BaseerMoney value={row.netPayableAmount} language={language}/>, status: <BaseerStatusBadge tone={payrollTone(row.status)}>{hrEnumLabel(language, row.status)}</BaseerStatusBadge> })), onMore: settlementCursor ? () => loadMore("settlements") : undefined, loadingMore: loadingMore === "settlements" }] : []),
        ...(canReadAdvances ? [{ id: "advances", title: ar ? "السلف" : "Advances", empty: ar ? "لا توجد سلف." : "No advances.", rows: advances.map((row) => ({ id: row.id, reference: row.advanceNumber, date: row.businessDate, description: row.notes || (ar ? "سلفة موظف" : "Employee advance"), gross: <BaseerMoney value={row.originalAmount} language={language}/>, adjustments: <BaseerMoney value={row.settledAmount} language={language}/>, balance: <BaseerMoney value={row.remainingAmount} language={language}/>, status: <BaseerStatusBadge tone={row.status === "SETTLED" ? "success" : row.status === "REVERSED" ? "danger" : "warning"}>{hrEnumLabel(language, row.status)}</BaseerStatusBadge> })), onMore: advanceCursor ? () => loadMore("advances") : undefined, loadingMore: loadingMore === "advances" }] : []),
        ...(canManageDeductions ? [{ id: "deductions", title: ar ? "الخصومات الإدارية" : "Administrative deductions", empty: ar ? "لا توجد خصومات إدارية." : "No administrative deductions.", rows: deductions.map((row) => ({ id: row.id, reference: row.deductionNumber, date: row.businessDate, description: row.description, gross: <BaseerMoney value={row.originalAmount} language={language}/>, adjustments: <BaseerMoney value={row.appliedAmount} language={language}/>, balance: <BaseerMoney value={row.remainingAmount} language={language}/>, status: <BaseerStatusBadge tone={row.status === "APPLIED" ? "success" : row.status === "CANCELLED" ? "neutral" : "info"}>{hrEnumLabel(language, row.status)}</BaseerStatusBadge> })), onMore: deductionCursor ? () => loadMore("deductions") : undefined, loadingMore: loadingMore === "deductions" }] : []),
    ];
    const loadingTabText = tab === "payroll" ? text.loadingPayrollSettlements : tab === "time" ? text.loadingLeaveHistory : text.loadingServicesCompliance;
    const refreshAttendancePin = async () => { const session = activeSession(); if (session) {
        try {
            setAttendancePinDisplay(await getAttendanceEmployeePin(session, employeeId));
        }
        catch {
            setAttendancePinDisplay(null);
        }
    } await onChanged(); };
    const saveEmployeeSchedule = async (event: React.FormEvent) => {
        event.preventDefault();
        const session = activeSession();
        if (!session || scheduleBusy)
            return;
        if (!scheduleTemplateId) {
            setScheduleError(ar ? "اختر قالب الدوام." : "Choose a work template.");
            return;
        }
        if (weeklyKind === "CUSTOM_PERIODS" && (!weeklyStart || !weeklyEnd || weeklyStart === weeklyEnd)) {
            setScheduleError(ar ? "أدخل فترة نصف دوام صحيحة." : "Enter a valid half-day period.");
            return;
        }
        setScheduleBusy(true);
        setScheduleError(null);
        try {
            await configureAttendanceEmployeeSchedule(session, { employeeId, templateId: scheduleTemplateId, effectiveFrom: scheduleEffectiveFrom, weeklyAdjustment: { dayOfWeek: Number(weeklyDay), kind: weeklyKind, periods: weeklyKind === "FULL_REST" ? [] : [{ startTime: weeklyStart, endTime: weeklyEnd }] }, idempotencyKey: requestId() });
            await refreshEmployeeSchedule();
            setScheduleOpen(false);
            await onChanged();
        }
        catch (error) {
            setScheduleError(error instanceof Error ? error.message : (ar ? "تعذر حفظ دوام الموظف." : "Could not save the employee schedule."));
        }
        finally {
            setScheduleBusy(false);
        }
    };
    // Schedule requests are loaded independently from the employee profile.
    // Keep the profile usable while a stale or incomplete read is replaced by
    // its next valid response; the attendance card can then show its empty
    // state instead of letting a partial payload break the whole file.
    const currentAssignment = employeeSchedule?.assignments?.[0] ?? null;
    const activeWeeklyAdjustments = (employeeSchedule?.weeklyAdjustments ?? []).filter((item) => item.effectiveFrom <= riyadhBusinessDate());
    const permanentRosterRule = [...new Map(activeWeeklyAdjustments.map((item) => [item.effectiveFrom, activeWeeklyAdjustments.filter((candidate) => candidate.effectiveFrom === item.effectiveFrom)])).entries()].find(([, rules]) => new Set(rules.map((rule) => rule.dayOfWeek)).size === 7)?.[0] ?? null;
    const currentWeeklyAdjustment = activeWeeklyAdjustments.sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0] ?? null;
    const weekdayOptions = [
        { id: "1", label: ar ? "الاثنين" : "Monday" }, { id: "2", label: ar ? "الثلاثاء" : "Tuesday" }, { id: "3", label: ar ? "الأربعاء" : "Wednesday" }, { id: "4", label: ar ? "الخميس" : "Thursday" }, { id: "5", label: ar ? "الجمعة" : "Friday" }, { id: "6", label: ar ? "السبت" : "Saturday" }, { id: "7", label: ar ? "الأحد" : "Sunday" },
    ];
    return <><BaseerDialog open title={name} size="wide" language={language} onClose={onClose}><section className="hr-employee-profile"><header className="hr-employee-profile__hero"><div className="hr-employee-profile__identity"><HrEmployeePhoto employeeId={employeeId} photoVersionId={detail.employee.profilePhotoVersionId} name={name} language={language} onError={onError} onChanged={onChanged}/><div><div className="hr-employee-profile__name"><h2>{name}</h2><BaseerStatusBadge tone={detail.employee.status === "ACTIVE" ? "success" : detail.employee.status === "ON_LEAVE" ? "warning" : "neutral"}>{employeeStatus(language, detail.employee.status)}</BaseerStatusBadge></div><p>{detail.employee.employeeNumber} · {detail.employee.jobTitle ?? (ar ? "دون مسمى وظيفي" : "No job title")}</p></div></div><div className="hr-employee-profile__actions">{canCreateFinalSettlements ? <BaseerButton type="button" variant="secondary" disabled={detail.employee.status !== "TERMINATED"} title={detail.employee.status !== "TERMINATED" ? (ar ? "يُتاح بعد إنهاء الموظف وتسجيل تاريخ الإنهاء." : "Available after terminating the employee and recording the termination date.") : undefined} onClick={() => setFinalSettlementOpen(true)}>{ar ? "نهاية الخدمة" : "End of service"}</BaseerButton> : null}{canManageEmployees ? <BaseerButton type="button" variant="secondary" onClick={onEdit}>{ar ? "تعديل البيانات" : "Edit employee"}</BaseerButton> : null}</div></header><HrEmployeeProfileSummary detail={detail} language={language} canReadPayroll={canReadPayroll} canReadAdvances={canReadAdvances} canReadLeaves={canReadLeaves} canReadDocuments={canReadDocuments}/><BaseerWorkspaceTabs ariaLabel={ar ? "أقسام ملف الموظف" : "Employee file sections"} idPrefix="hr-employee-profile" tabs={tabs} activeId={tab} onChange={(value) => setTab(value as ProfileTab)}/><BaseerBatchPanel id={`hr-employee-profile-panel-${tab}`} labelledBy={`hr-employee-profile-${tab}`}>{loadingTab === tab ? <BaseerNotice tone="info">{loadingTabText}</BaseerNotice> : null}
    {tab === "overview" ? <div className="hr-employee-profile__overview"><div className="hr-employee-profile__facts"><BaseerCard><h3>{ar ? "بيانات العمل" : "Employment details"}</h3><dl><div><dt>{ar ? "الحالة" : "Status"}</dt><dd>{employeeStatus(language, detail.employee.status)}</dd></div><div><dt>{ar ? "تاريخ التعيين" : "Hire date"}</dt><dd>{detail.employee.hireDate}</dd></div>{detail.employee.status === "TERMINATED" || detail.employee.status === "ARCHIVED" ? <><div><dt>{detail.employee.status === "TERMINATED" ? (ar ? "تاريخ انتهاء الخدمة" : "End-of-service date") : (ar ? "تاريخ الأرشفة" : "Archive date")}</dt><dd>{detail.employee.statusEffectiveAt ?? detail.employee.terminatedAt ?? (ar ? "غير مسجل" : "Not recorded")}</dd></div><div><dt>{detail.employee.status === "TERMINATED" ? (ar ? "سبب انتهاء الخدمة" : "End-of-service reason") : (ar ? "سبب الأرشفة" : "Archive reason")}</dt><dd>{detail.employee.statusReason ?? (ar ? "غير مسجل" : "Not recorded")}</dd></div></> : null}<div><dt>{ar ? "رقم الإقامة" : "Iqama number"}</dt><dd dir="ltr">{detail.employee.iqamaNumber ?? "—"}</dd></div><div><dt>{ar ? "الجوال" : "Phone"}</dt><dd>{detail.employee.phone ?? "—"}</dd></div><div><dt>{ar ? "البريد" : "Email"}</dt><dd>{detail.employee.email ?? "—"}</dd></div></dl></BaseerCard><BaseerCard className="hr-current-compensation"><header><h3>{ar ? "الراتب الحالي" : "Current salary"}</h3>{salary ? <BaseerButton type="button" variant="secondary" onClick={onManageCompensation}>{ar ? "إدارة الراتب" : "Manage salary"}</BaseerButton> : null}</header>{salary ? <><dl><div><dt>{ar ? "الإجمالي الشهري" : "Monthly total"}</dt><dd><BaseerMoney value={salary.monthlyGross} language={language}/></dd></div><div><dt>{ar ? "الراتب الأساسي المحتسب" : "Calculated basic salary"}</dt><dd>{currentSalaryBreakdown?.basicSalary ? <BaseerMoney value={currentSalaryBreakdown.basicSalary} language={language}/> : "—"}</dd></div>{salary.compensationMethod === "INCLUSIVE_OVERTIME" ? <><div><dt>{ar ? "الأوفر تايم المشمول" : "Included overtime"}</dt><dd>{currentSalaryBreakdown?.includedOvertime ? <BaseerMoney value={currentSalaryBreakdown.includedOvertime} language={language}/> : "—"}</dd></div><div><dt>{ar ? "نظام الأوفر تايم" : "Overtime schedule"}</dt><dd>{ar ? `${salary.scheduledHoursPerDay ?? "—"} ساعة يوميًا · ${salary.scheduledWorkDays ?? "—"} يومًا` : `${salary.scheduledHoursPerDay ?? "—"} hours/day · ${salary.scheduledWorkDays ?? "—"} days`}</dd></div></> : <div><dt>{ar ? "طريقة الاحتساب" : "Calculation method"}</dt><dd>{ar ? "راتب شهري ثابت" : "Fixed monthly salary"}</dd></div>}<div><dt>{ar ? "يسري من" : "Applies from"}</dt><dd>{salary.effectiveFrom}</dd></div></dl><section className="hr-current-compensation__allowances"><h4>{ar ? "البدلات النشطة" : "Active allowances"}</h4>{currentAllowances.length ? <dl>{currentAllowances.map((allowance) => <div key={allowance.id}><dt>{allowance.label}</dt><dd><BaseerMoney value={allowance.amount} language={language}/></dd></div>)}</dl> : <p>{ar ? "لا توجد بدلات نشطة." : "No active allowances."}</p>}</section></> : <BaseerEmptyState title={ar ? "لم يُحدد راتب بعد" : "Salary not set"} action={<BaseerButton type="button" onClick={onManageCompensation}>{ar ? "تحديد الراتب" : "Set salary"}</BaseerButton>}/>}</BaseerCard>{canManageAttendance ? <BaseerCard><h3>{ar ? "الدوام والراحة الأسبوعية" : "Work schedule & weekly rest"}</h3><dl><EmployeeWorkTermsPanel language={language} employeeId={employeeId} workTerms={employeeWorkTerms} canManage={canManageEmployees} onChanged={refreshEmployeeSchedule}/><div><dt>{ar ? "مرجع ساعات الجدول" : "Schedule-hours reference"}</dt><dd>{employeeSchedule?.workTermsReference ? (ar ? `${employeeSchedule.workTermsReference.workMinutesPerDay / 60} ساعة يومياً · مستورد من اتفاق ${employeeSchedule.workTermsReference.effectiveFrom}` : `${employeeSchedule.workTermsReference.workMinutesPerDay / 60} hours/day · imported from agreement ${employeeSchedule.workTermsReference.effectiveFrom}`) : "—"}</dd></div><div><dt>{ar ? "قالب الدوام" : "Work template"}</dt><dd>{currentAssignment ? `${ar ? currentAssignment.templateNameAr : currentAssignment.templateNameEn ?? currentAssignment.templateNameAr} · ${currentAssignment.effectiveFrom}` : "—"}</dd></div>{permanentRosterRule ? <div><dt>{ar ? "جدول دائم من التخطيط" : "Permanent roster plan"}</dt><dd>{ar ? `دوام مخصص معتمد · يسري من ${permanentRosterRule}` : `Approved custom schedule · effective ${permanentRosterRule}`}</dd></div> : null}<div><dt>{ar ? "كل الراحة/أنصاف الدوام الفعالة" : "All active rest / half days"}</dt><dd>{activeWeeklyAdjustments.length ? <ul>{activeWeeklyAdjustments.map((item) => <li key={item.id}>{`${weekdayOptions.find((weekday) => weekday.id === String(item.dayOfWeek))?.label ?? "—"} · ${item.kind === "FULL_REST" ? (ar ? "راحة كاملة" : "Full rest") : (item.periods ?? []).map((period) => `${period.startTime}–${period.endTime}`).join(" · ")} · ${item.effectiveFrom}`}</li>)}</ul> : "—"}</dd></div></dl><p>{ar ? "اتفاق الساعات للعرض فقط ولا يتغير هنا. تعديلات جدول الحضور مستقلة ومؤرخة ولا تعدل الراتب أو الاتفاق." : "The work-hours agreement is read-only here. Attendance schedule edits are separate, effective-dated, and never change salary or the agreement."}</p><BaseerButton type="button" variant="secondary" onClick={() => { setScheduleError(null); setScheduleTemplateId(currentAssignment?.templateId ?? scheduleTemplates.find((template) => template.status === "ACTIVE")?.id ?? ""); setScheduleEffectiveFrom(riyadhBusinessDate()); setWeeklyDay(String(currentWeeklyAdjustment?.dayOfWeek ?? 7)); setWeeklyKind(currentWeeklyAdjustment?.kind ?? "FULL_REST"); setWeeklyStart(currentWeeklyAdjustment?.periods?.[0]?.startTime ?? "10:00"); setWeeklyEnd(currentWeeklyAdjustment?.periods?.[0]?.endTime ?? "15:30"); setScheduleOpen(true); }}>{ar ? "إدارة تعديل جدول الحضور" : "Manage attendance-schedule adjustment"}</BaseerButton></BaseerCard> : null}{canManageAttendance ? <BaseerCard><h3>{ar ? "كود الحضور" : "Attendance PIN"}</h3><dl><div><dt>{ar ? "الكود الحالي" : "Current PIN"}</dt><dd dir="ltr">{attendancePinDisplay?.state === "SET" ? attendancePinDisplay.pin : attendancePinDisplay?.state === "RESET_REQUIRED" ? (ar ? "يلزم تعيين كود جديد" : "Reset required") : attendancePinDisplay?.state === "NOT_SET" ? (ar ? "غير معيّن" : "Not assigned") : "—"}</dd></div></dl><p>{ar ? "يظهر للمالك ومدير الشركة فقط. تغيير الكود يلغي الكود السابق مباشرةً." : "Visible only to the owner and company manager. Changing it immediately replaces the previous PIN."}</p><BaseerButton type="button" variant="secondary" onClick={() => setAttendancePinOpen(true)}>{ar ? "تعيين أو تغيير كود الحضور" : "Set or change attendance PIN"}</BaseerButton></BaseerCard> : null}</div><div className="hr-employee-profile__snapshot"><BaseerCard><h3>{ar ? "لقطة السجل" : "Record snapshot"}</h3><div className="hr-employee-profile__stats"><span><small>{ar ? "تغييرات الراتب" : "Salary changes"}</small><strong>{detail.compensationHistoryCount}</strong></span><span><small>{ar ? "الخدمات" : "Services"}</small><strong>{detail.serviceCount}</strong></span><span><small>{ar ? "الحركات المالية" : "Financial movements"}</small><strong>{detail.movementCount}</strong></span></div></BaseerCard></div></div> : null}
    {tab === "employment" ? <div className="hr-employee-profile__stack"><Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل المسار الوظيفي…" : "Loading employment history…"}</BaseerCard>}><HrEmployeePromotionsPanel employeeId={employeeId} language={language} detail={detail} onError={onError} onChanged={onChanged}/></Suspense></div> : null}
    {tab === "payroll" ? <PayrollSettlementLedger language={language} sections={sections}/> : null}
    {tab === "time" ? <ProfileTable language={language} rows={leaves} columns={leaveColumns} rowKey={(row) => row.id} empty={ar ? "لا توجد إجازات." : "No leaves."} label={ar ? "إجازات الموظف" : "Employee leaves"} loadingMore={loadingMore === "time"} onMore={leaveCursor ? () => loadMore("time") : undefined}/> : null}
    {tab === "compliance" ? <ProfileTable language={language} rows={services} columns={serviceColumns} rowKey={(row) => row.id} empty={ar ? "لا توجد خدمات أو سجلات امتثال." : "No services or compliance records."} label={ar ? "خدمات الموظف وامتثاله" : "Employee services & compliance"} loadingMore={loadingMore === "compliance"} onMore={serviceCursor ? () => loadMore("compliance") : undefined}/> : null}
    {tab === "documents" ? <div className="hr-employee-profile__stack">{canReadDocuments ? <Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل المستندات…" : "Loading documents…"}</BaseerCard>}><HrEmployeeDocumentsPanel employeeId={employeeId} language={language} canWrite={hasActivePermission("hr.employee_documents.write")} canRevoke={hasActivePermission("hr.employee_documents.revoke")} canDownload={hasActivePermission("hr.employee_documents.download")} onError={onError} onChanged={onChanged}/></Suspense> : null}{canReadLetters ? <Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل الخطابات…" : "Loading letters…"}</BaseerCard>}><HrEmployeeLettersPanel employeeId={employeeId} language={language} hasCurrentCompensation={Boolean(salary)} canIssue={hasActivePermission("hr.employee_letters.issue")} canRevoke={hasActivePermission("hr.employee_letters.revoke")} onManageCompensation={onManageCompensation} onError={onError} onChanged={onChanged}/></Suspense> : null}</div> : null}
    {tab === "financial" ? <ProfileTable language={language} rows={detail.movements} columns={movementColumns} rowKey={(row) => row.id} empty={ar ? "لا توجد حركات مالية." : "No financial movements."} label={ar ? "الحركات المالية المرتبطة بالموظف" : "Employee-linked financial movements"} onMore={detail.hasMoreMovements ? onLoadMoreMovements : undefined}/> : null}
  </BaseerBatchPanel></section></BaseerDialog>{scheduleOpen ? <BaseerDialogPresentationContext.Provider value="modal"><BaseerFormDialog open title={ar ? `دوام ${name}` : `${name} work schedule`} language={language} formId="employee-attendance-schedule" submitLabel={ar ? "حفظ الدوام" : "Save schedule"} onClose={() => setScheduleOpen(false)} busy={scheduleBusy} error={scheduleError} size="standard"><form id="employee-attendance-schedule" className="baseer-form" onSubmit={saveEmployeeSchedule}><label>{ar ? "قالب الدوام" : "Work template"}<BaseerComboboxField required label={ar ? "قالب الدوام" : "Work template"} value={scheduleTemplateId} placeholder={ar ? "اختر القالب" : "Choose a template"} options={scheduleTemplates.filter((template) => template.status === "ACTIVE").map((template) => ({ id: template.id, label: ar ? template.nameAr : template.nameEn ?? template.nameAr }))} onChange={setScheduleTemplateId}/></label><label>{ar ? "تاريخ السريان" : "Effective from"}<BaseerDatePicker language={language} label={ar ? "تاريخ السريان" : "Effective from"} value={scheduleEffectiveFrom} onChange={setScheduleEffectiveFrom}/></label><label>{ar ? "يوم الراحة أو نصف الدوام" : "Rest or half-day weekday"}<BaseerComboboxField required searchable={false} label={ar ? "يوم الراحة أو نصف الدوام" : "Rest or half-day weekday"} value={weeklyDay} options={weekdayOptions} onChange={setWeeklyDay}/></label><label>{ar ? "نوع التخصيص" : "Adjustment type"}<BaseerComboboxField required searchable={false} label={ar ? "نوع التخصيص" : "Adjustment type"} value={weeklyKind} options={[{ id: "FULL_REST", label: ar ? "راحة كاملة" : "Full rest" }, { id: "CUSTOM_PERIODS", label: ar ? "نصف دوام / فترة محددة" : "Half day / custom period" }]} onChange={(value) => setWeeklyKind(value as "FULL_REST" | "CUSTOM_PERIODS")}/></label>{weeklyKind === "CUSTOM_PERIODS" ? <><label>{ar ? "بداية الفترة" : "Period start"}<BaseerTimeInput value={weeklyStart} onChange={(event) => setWeeklyStart(event.target.value)}/></label><label>{ar ? "نهاية الفترة" : "Period end"}<BaseerTimeInput value={weeklyEnd} onChange={(event) => setWeeklyEnd(event.target.value)}/></label></> : null}<p>{ar ? "لا يعدل هذا الحضور السابق. استخدم الاستثناءات لتغيير يوم مؤقت فقط." : "This never rewrites past attendance. Use exceptions for temporary changes only."}</p></form></BaseerFormDialog></BaseerDialogPresentationContext.Provider> : null}{attendancePinOpen ? <BaseerDialogPresentationContext.Provider value="modal"><Suspense fallback={null}><HrEmployeeAttendancePinDialog open language={language} employeeId={employeeId} employeeName={name} onClose={() => setAttendancePinOpen(false)} onSaved={refreshAttendancePin} onError={onError}/></Suspense></BaseerDialogPresentationContext.Provider> : null}{payrollRunId ? <BaseerDialogPresentationContext.Provider value="modal"><Suspense fallback={null}><HrPayrollDetailDialog runId={payrollRunId} language={language} onClose={() => setPayrollRunId(null)} onChanged={onChanged} onError={onError}/></Suspense></BaseerDialogPresentationContext.Provider> : null}{finalSettlementOpen ? <BaseerDialogPresentationContext.Provider value="modal"><BaseerDialog open title={ar ? `نهاية خدمة ${name}` : `End of service — ${name}`} size="wide" language={language} onClose={() => { setFinalSettlementOpen(false); void onChanged(); }}><Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل المخالصة…" : "Loading settlement…"}</BaseerCard>}><HrFinalSettlementWorkspace language={language} employee={detail.employee}/></Suspense></BaseerDialog></BaseerDialogPresentationContext.Provider> : null}</>;
}
export function HrEmployeeProfilePage(props: HrEmployeeProfileProps) {
    return <BaseerDialogPresentationContext.Provider value="inline"><div className="hr-employee-profile-page"><HrEmployeeProfileDialog {...props}/></div></BaseerDialogPresentationContext.Provider>;
}
function ProfileTable<T extends object>({ language, rows, columns, rowKey, empty, label, onMore, loadingMore = false }: {
    language: Language;
    rows: readonly T[];
    columns: readonly any[];
    rowKey: (row: T) => string;
    empty: string;
    label: string;
    onMore?: () => void | Promise<void>;
    loadingMore?: boolean;
}) {
    return <section className="hr-profile-table"><header><h3>{label}</h3></header>{rows.length ? <BaseerDataGrid ariaLabel={label} caption={label} rows={rows} columns={columns} rowKey={rowKey}/> : <BaseerEmptyState title={empty}/>}{onMore ? <BaseerButton type="button" variant="secondary" disabled={loadingMore} onClick={() => void onMore()}>{hrText(language).loadMore}</BaseerButton> : null}</section>;
}
function PayrollSettlementLedger({ language, sections }: {
    language: Language;
    sections: readonly LedgerSection[];
}) {
    const ar = language === "ar";
    return <section className="hr-payroll-settlements" aria-label={ar ? "الرواتب والتسويات" : "Payroll and settlements"}><header><h3>{ar ? "الرواتب والتسويات" : "Payroll & settlements"}</h3></header><div className="hr-payroll-settlements__scroll"><table><thead><tr><th>{ar ? "المرجع" : "Reference"}</th><th>{ar ? "التاريخ" : "Date"}</th><th>{ar ? "البيان" : "Description"}</th><th>{ar ? "الإجمالي" : "Gross"}</th><th>{ar ? "التسوية / المسدد" : "Settled / applied"}</th><th>{ar ? "الصافي / المتبقي" : "Net / remaining"}</th><th>{ar ? "الحالة" : "Status"}</th></tr></thead><tbody>{sections.map((section) => <Fragment key={section.id}><tr className="hr-payroll-settlements__section"><th colSpan={7}><span>{section.title}</span><small>{section.rows.length}{section.onMore ? "+" : ""}</small></th></tr>{section.rows.length ? section.rows.map((row) => <tr key={row.id}><td>{row.reference}</td><td dir="ltr">{row.date}</td><td>{row.description}</td><td className="hr-payroll-settlements__amount">{row.gross}</td><td className="hr-payroll-settlements__amount">{row.adjustments}</td><td className="hr-payroll-settlements__amount hr-payroll-settlements__balance">{row.balance}</td><td>{row.status}</td></tr>) : <tr className="hr-payroll-settlements__empty"><td colSpan={7}>{section.empty}</td></tr>}{section.onMore ? <tr className="hr-payroll-settlements__more"><td colSpan={7}><BaseerButton type="button" variant="secondary" disabled={section.loadingMore} onClick={() => void section.onMore?.()}>{ar ? `تحميل المزيد من ${section.title}` : `Load more ${section.title}`}</BaseerButton></td></tr> : null}</Fragment>)}</tbody></table></div></section>;
}
