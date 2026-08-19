import { Fragment, lazy, Suspense, type ReactNode, useEffect, useRef, useState } from "react";

import "./hr-employee-profile-dialog.css";

import { BaseerBatchPanel, BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerMoney } from "./baseer-money";
import { BaseerStatusBadge } from "./baseer-status-badge";
import { BaseerEmptyState, BaseerNotice } from "./baseer-workspace";
import { DataTable } from "./data-table";
import { activeSession } from "./daily-sales-client";
import { HrEmployeePhoto } from "./hr-employee-photo";
import { hrEnumLabel, hrText } from "./hr-copy";
import { listHrAdministrativeDeductions, listHrAdvances, listHrEmployeeLeaves, listHrEmployeePayrollHistory, listHrFinalSettlements, type HrAdministrativeDeduction, type HrAdvance, type HrDetail, type HrEmployeeLeave, type HrEmployeePayrollHistoryLine, type HrFinalSettlement } from "./hr-client";
import { listHrEmployeeServices, type HrEmployeeServiceRecord } from "./hr-services-client";

type Language = "ar" | "en";
type ProfileTab = "overview" | "employment" | "payroll" | "time" | "compliance" | "documents" | "financial";
type LedgerRow = { id: string; reference: ReactNode; date: string; description: ReactNode; gross: ReactNode; adjustments: ReactNode; balance: ReactNode; status: ReactNode };
type LedgerSection = { id: string; title: string; empty: string; rows: readonly LedgerRow[]; onMore?: () => void | Promise<void>; loadingMore?: boolean };
const HrPayrollDetailDialog = lazy(async () => ({ default: (await import("./hr-payroll-detail-dialog")).HrPayrollDetailDialog }));
const HrEmployeeDocumentsPanel = lazy(async () => ({ default: (await import("./hr-employee-documents-panel")).HrEmployeeDocumentsPanel }));
const HrEmployeeLettersPanel = lazy(async () => ({ default: (await import("./hr-employee-letters-panel")).HrEmployeeLettersPanel }));
const HrEmployeePromotionsPanel = lazy(async () => ({ default: (await import("./hr-employee-promotions-panel")).HrEmployeePromotionsPanel }));
const HrFinalSettlementWorkspace = lazy(async () => ({ default: (await import("./hr-final-settlement-panel")).HrFinalSettlementWorkspace }));

const employeeStatus = (language: Language, status: HrDetail["employee"]["status"]) => ({ ACTIVE: language === "ar" ? "نشط" : "Active", ON_LEAVE: language === "ar" ? "في إجازة" : "On leave", TERMINATED: language === "ar" ? "منتهٍ" : "Terminated", ARCHIVED: language === "ar" ? "مؤرشف" : "Archived" })[status];
const payrollTone = (status: string) => status === "PAID" ? "success" as const : status === "REVERSED" ? "danger" as const : status === "DRAFT" ? "warning" as const : "info" as const;

/** The employee file is the HR workspace. Salary history stays internal while the UI stays simple. */
export function HrEmployeeProfileDialog({ detail, language, onClose, onEdit, onManageCompensation, onLoadMoreMovements, onError, onChanged }: { detail: HrDetail; language: Language; onClose: () => void; onEdit: () => void; onManageCompensation: () => void; onLoadMoreMovements: () => Promise<void>; onError: (message: string) => void; onChanged: () => Promise<void> }) {
  const ar = language === "ar";
  const text = hrText(language);
  const employeeId = detail.employee.id;
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
  const loadedTabs = useRef(new Set<"payroll" | "time" | "compliance">());
  const loadingTabs = useRef(new Set<"payroll" | "time" | "compliance">());
  const employeeVersion = useRef(0);

  useEffect(() => {
    setTab("overview");
    setPayroll([]); setPayrollCursor(null); setAdvances([]); setAdvanceCursor(null); setDeductions([]); setDeductionCursor(null); setLeaves([]); setLeaveCursor(null); setSettlements([]); setSettlementCursor(null); setServices([]); setServiceCursor(null);
    loadedTabs.current.clear(); loadingTabs.current.clear(); employeeVersion.current += 1; setLoadingTab(null); setLoadingMore(null);
  }, [employeeId]);
  useEffect(() => {
    const session = activeSession();
    if (!session || (tab !== "payroll" && tab !== "time" && tab !== "compliance") || loadedTabs.current.has(tab) || loadingTabs.current.has(tab)) return;
    const requestedTab = tab;
    const version = employeeVersion.current;
    loadingTabs.current.add(requestedTab); setLoadingTab(requestedTab);
    const request = requestedTab === "payroll"
      ? Promise.all([listHrEmployeePayrollHistory(session, employeeId, { pageSize: 25 }), listHrAdvances(session, { employeeId, pageSize: 50 }), listHrAdministrativeDeductions(session, { employeeId, pageSize: 50 }), listHrFinalSettlements(session, { employeeId, pageSize: 25 })]).then(([payrollReceipt, advanceReceipt, deductionReceipt, settlementReceipt]) => {
        if (version !== employeeVersion.current) return;
        setPayroll(payrollReceipt.lines); setPayrollCursor(payrollReceipt.nextCursor); setAdvances(advanceReceipt.advances); setAdvanceCursor(advanceReceipt.nextCursor); setDeductions(deductionReceipt.deductions); setDeductionCursor(deductionReceipt.nextCursor); setSettlements(settlementReceipt.settlements); setSettlementCursor(settlementReceipt.nextCursor);
      })
      : requestedTab === "time" ? listHrEmployeeLeaves(session, { employeeId, pageSize: 50 }).then((leaveReceipt) => {
        if (version !== employeeVersion.current) return;
        setLeaves(leaveReceipt.leaves); setLeaveCursor(leaveReceipt.nextCursor);
      }) : listHrEmployeeServices(session, { employeeId, pageSize: 50 }).then((serviceReceipt) => {
        if (version !== employeeVersion.current) return;
        setServices(serviceReceipt.services); setServiceCursor(serviceReceipt.nextCursor);
      });
    void request.then(() => { if (version === employeeVersion.current) loadedTabs.current.add(requestedTab); })
      .catch(() => { if (version === employeeVersion.current) onError(requestedTab === "payroll" ? (ar ? "تعذر تحميل الرواتب والتسويات." : "Payroll and settlements could not be loaded.") : requestedTab === "time" ? (ar ? "تعذر تحميل سجل الإجازات." : "Leave history could not be loaded.") : (ar ? "تعذر تحميل الخدمات والامتثال." : "Services and compliance could not be loaded.")); })
      .finally(() => { loadingTabs.current.delete(requestedTab); if (version === employeeVersion.current) setLoadingTab((current) => current === requestedTab ? null : current); });
  }, [ar, employeeId, onError, tab]);

  const loadMore = async (kind: "payroll" | "settlements" | "advances" | "deductions" | "time" | "compliance") => {
    const session = activeSession();
    const cursor = kind === "payroll" ? payrollCursor : kind === "settlements" ? settlementCursor : kind === "advances" ? advanceCursor : kind === "deductions" ? deductionCursor : kind === "time" ? leaveCursor : serviceCursor;
    if (!session || !cursor || loadingMore) return;
    const version = employeeVersion.current;
    setLoadingMore(kind);
    try {
      if (kind === "payroll") {
        const receipt = await listHrEmployeePayrollHistory(session, employeeId, { cursor, pageSize: 25 });
        if (version !== employeeVersion.current) return;
        setPayroll((rows) => [...rows, ...receipt.lines.filter((line) => !rows.some((row) => row.id === line.id))]); setPayrollCursor(receipt.nextCursor);
      } else if (kind === "settlements") {
        const receipt = await listHrFinalSettlements(session, { employeeId, cursor, pageSize: 25 });
        if (version !== employeeVersion.current) return;
        setSettlements((rows) => [...rows, ...receipt.settlements.filter((settlement) => !rows.some((row) => row.id === settlement.id))]); setSettlementCursor(receipt.nextCursor);
      } else if (kind === "advances") {
        const receipt = await listHrAdvances(session, { employeeId, cursor, pageSize: 50 });
        if (version !== employeeVersion.current) return;
        setAdvances((rows) => [...rows, ...receipt.advances.filter((advance) => !rows.some((row) => row.id === advance.id))]); setAdvanceCursor(receipt.nextCursor);
      } else if (kind === "deductions") {
        const receipt = await listHrAdministrativeDeductions(session, { employeeId, cursor, pageSize: 50 });
        if (version !== employeeVersion.current) return;
        setDeductions((rows) => [...rows, ...receipt.deductions.filter((deduction) => !rows.some((row) => row.id === deduction.id))]); setDeductionCursor(receipt.nextCursor);
      } else if (kind === "time") {
        const receipt = await listHrEmployeeLeaves(session, { employeeId, cursor, pageSize: 50 });
        if (version !== employeeVersion.current) return;
        setLeaves((rows) => [...rows, ...receipt.leaves.filter((leave) => !rows.some((row) => row.id === leave.id))]); setLeaveCursor(receipt.nextCursor);
      } else {
        const receipt = await listHrEmployeeServices(session, { employeeId, cursor, pageSize: 50 });
        if (version !== employeeVersion.current) return;
        setServices((rows) => [...rows, ...receipt.services.filter((service) => !rows.some((row) => row.id === service.id))]); setServiceCursor(receipt.nextCursor);
      }
    } catch {
      if (version === employeeVersion.current) onError(ar ? "تعذر تحميل المزيد من سجل الموظف." : "More employee records could not be loaded.");
    } finally {
      if (version === employeeVersion.current) setLoadingMore(null);
    }
  };

  const name = ar ? detail.employee.nameAr : detail.employee.nameEn ?? detail.employee.nameAr;
  const salary = detail.compensation;
  const tabs: readonly { id: ProfileTab; label: string }[] = [{ id: "overview", label: ar ? "نظرة 360" : "360 overview" }, { id: "employment", label: ar ? "المسار والتعويض" : "Employment & compensation" }, { id: "payroll", label: ar ? "الرواتب والتسويات" : "Payroll & settlements" }, { id: "time", label: ar ? "الإجازات" : "Leaves" }, { id: "compliance", label: ar ? "الخدمات والامتثال" : "Services & compliance" }, { id: "documents", label: ar ? "المستندات والخطابات" : "Documents & letters" }, { id: "financial", label: ar ? "السجل المالي" : "Financial record" }];
  const leaveColumns = [{ id: "type", header: ar ? "النوع" : "Type", cell: (row: HrEmployeeLeave) => hrEnumLabel(language, row.leaveType) }, { id: "period", header: ar ? "الفترة" : "Period", cell: (row: HrEmployeeLeave) => `${row.startDate} — ${row.endDate}` }, { id: "return", header: ar ? "العودة" : "Return", cell: (row: HrEmployeeLeave) => row.actualReturnDate ?? "—" }, { id: "status", header: ar ? "الحالة" : "Status", cell: (row: HrEmployeeLeave) => <BaseerStatusBadge tone={row.status === "RETURNED" ? "success" : "warning"}>{row.status === "RETURNED" ? (ar ? "عاد للعمل" : "Returned") : (ar ? "معتمدة" : "Approved")}</BaseerStatusBadge> }];
  const serviceColumns = [{ id: "type", header: ar ? "الخدمة" : "Service", cell: (row: HrEmployeeServiceRecord) => hrEnumLabel(language, row.serviceType) }, { id: "reference", header: ar ? "المرجع" : "Reference", cell: (row: HrEmployeeServiceRecord) => row.referenceNumber ?? "—" }, { id: "expiry", header: ar ? "الانتهاء" : "Expiry", cell: (row: HrEmployeeServiceRecord) => row.expiryDate ?? "—" }, { id: "status", header: ar ? "الحالة" : "Status", cell: (row: HrEmployeeServiceRecord) => <BaseerStatusBadge tone={row.status === "ISSUED" ? "success" : row.status === "CANCELLED" ? "neutral" : "warning"}>{hrEnumLabel(language, row.status)}</BaseerStatusBadge> }];
  const movementColumns = [{ id: "date", header: ar ? "التاريخ" : "Date", cell: (row: HrDetail["movements"][number]) => row.businessDate }, { id: "type", header: ar ? "العملية" : "Operation", cell: (row: HrDetail["movements"][number]) => hrEnumLabel(language, row.movementType) }, { id: "reference", header: ar ? "المرجع" : "Reference", cell: (row: HrDetail["movements"][number]) => row.sourceReference }, { id: "amount", header: ar ? "المبلغ" : "Amount", numeric: true, align: "end" as const, cell: (row: HrDetail["movements"][number]) => <BaseerMoney value={row.amount} language={language} /> }];
  const sections: readonly LedgerSection[] = [
    { id: "payroll", title: ar ? "مسيرات الرواتب" : "Payroll runs", empty: ar ? "لا توجد مسيرات لهذا الموظف." : "No payroll runs for this employee.", rows: payroll.map((row) => ({ id: row.id, reference: <BaseerButton type="button" variant="quiet" onClick={() => setPayrollRunId(row.payrollRunId)}>{row.runNumber}</BaseerButton>, date: row.payrollMonth, description: text.monthlyPayroll, gross: <BaseerMoney value={row.grossSalary} language={language} />, adjustments: <span className="hr-payroll-settlements__adjustments"><span>{ar ? "سلف" : "Advances"} <BaseerMoney value={row.advanceSettlementAmount} language={language} /></span><span>{ar ? "خصومات" : "Deductions"} <BaseerMoney value={row.administrativeDeductionAmount} language={language} /></span></span>, balance: <BaseerMoney value={row.netPayableAmount} language={language} />, status: <BaseerStatusBadge tone={payrollTone(row.payrollStatus)}>{hrEnumLabel(language, row.payrollStatus)}</BaseerStatusBadge> })), onMore: payrollCursor ? () => loadMore("payroll") : undefined, loadingMore: loadingMore === "payroll" },
    { id: "settlements", title: ar ? "مخالصات نهاية الخدمة" : "End-of-service settlements", empty: ar ? "لا توجد مخالصات نهاية خدمة." : "No end-of-service settlements.", rows: settlements.map((row) => ({ id: row.id, reference: row.settlementNumber, date: row.terminationDate, description: ar ? "مخالصة نهاية الخدمة" : "End-of-service settlement", gross: <BaseerMoney value={row.fullAwardAmount} language={language} />, adjustments: <BaseerMoney value={row.recoveryAmount} language={language} />, balance: <BaseerMoney value={row.netPayableAmount} language={language} />, status: <BaseerStatusBadge tone={payrollTone(row.status)}>{hrEnumLabel(language, row.status)}</BaseerStatusBadge> })), onMore: settlementCursor ? () => loadMore("settlements") : undefined, loadingMore: loadingMore === "settlements" },
    { id: "advances", title: ar ? "السلف" : "Advances", empty: ar ? "لا توجد سلف." : "No advances.", rows: advances.map((row) => ({ id: row.id, reference: row.advanceNumber, date: row.businessDate, description: row.notes || (ar ? "سلفة موظف" : "Employee advance"), gross: <BaseerMoney value={row.originalAmount} language={language} />, adjustments: <BaseerMoney value={row.settledAmount} language={language} />, balance: <BaseerMoney value={row.remainingAmount} language={language} />, status: <BaseerStatusBadge tone={row.status === "SETTLED" ? "success" : row.status === "REVERSED" ? "danger" : "warning"}>{hrEnumLabel(language, row.status)}</BaseerStatusBadge> })), onMore: advanceCursor ? () => loadMore("advances") : undefined, loadingMore: loadingMore === "advances" },
    { id: "deductions", title: ar ? "الخصومات الإدارية" : "Administrative deductions", empty: ar ? "لا توجد خصومات إدارية." : "No administrative deductions.", rows: deductions.map((row) => ({ id: row.id, reference: row.deductionNumber, date: row.businessDate, description: row.description, gross: <BaseerMoney value={row.originalAmount} language={language} />, adjustments: <BaseerMoney value={row.appliedAmount} language={language} />, balance: <BaseerMoney value={row.remainingAmount} language={language} />, status: <BaseerStatusBadge tone={row.status === "APPLIED" ? "success" : row.status === "CANCELLED" ? "neutral" : "info"}>{hrEnumLabel(language, row.status)}</BaseerStatusBadge> })), onMore: deductionCursor ? () => loadMore("deductions") : undefined, loadingMore: loadingMore === "deductions" },
  ];
  const loadingTabText = tab === "payroll" ? text.loadingPayrollSettlements : tab === "time" ? text.loadingLeaveHistory : text.loadingServicesCompliance;

  return <><BaseerDialog open title={name} size="wide" language={language} onClose={onClose}><section className="hr-employee-profile"><header className="hr-employee-profile__hero"><div className="hr-employee-profile__identity"><HrEmployeePhoto employeeId={employeeId} photoVersionId={detail.employee.profilePhotoVersionId} name={name} language={language} onError={onError} onChanged={onChanged} /><div><div className="hr-employee-profile__name"><h2>{name}</h2><BaseerStatusBadge tone={detail.employee.status === "ACTIVE" ? "success" : detail.employee.status === "ON_LEAVE" ? "warning" : "neutral"}>{employeeStatus(language, detail.employee.status)}</BaseerStatusBadge></div><p>{detail.employee.employeeNumber} · {detail.employee.jobTitle ?? (ar ? "دون مسمى وظيفي" : "No job title")}</p></div></div><div className="hr-employee-profile__actions"><BaseerButton type="button" variant="secondary" disabled={detail.employee.status !== "TERMINATED"} title={detail.employee.status !== "TERMINATED" ? (ar ? "يُتاح بعد إنهاء الموظف وتسجيل تاريخ الإنهاء." : "Available after terminating the employee and recording the termination date.") : undefined} onClick={() => setFinalSettlementOpen(true)}>{ar ? "نهاية الخدمة" : "End of service"}</BaseerButton><BaseerButton type="button" variant="secondary" onClick={onEdit}>{ar ? "تعديل البيانات" : "Edit employee"}</BaseerButton></div></header><BaseerWorkspaceTabs ariaLabel={ar ? "أقسام ملف الموظف" : "Employee file sections"} idPrefix="hr-employee-profile" tabs={tabs} activeId={tab} onChange={(value) => setTab(value as ProfileTab)} /><BaseerBatchPanel id={`hr-employee-profile-panel-${tab}`} labelledBy={`hr-employee-profile-${tab}`}>{loadingTab === tab ? <BaseerNotice tone="info">{loadingTabText}</BaseerNotice> : null}
    {tab === "overview" ? <div className="hr-employee-profile__overview"><div className="hr-employee-profile__facts"><BaseerCard><h3>{ar ? "بيانات العمل" : "Employment details"}</h3><dl><div><dt>{ar ? "تاريخ التعيين" : "Hire date"}</dt><dd>{detail.employee.hireDate}</dd></div><div><dt>{ar ? "رقم الإقامة" : "Iqama number"}</dt><dd dir="ltr">{detail.employee.iqamaNumber ?? "—"}</dd></div><div><dt>{ar ? "الجوال" : "Phone"}</dt><dd>{detail.employee.phone ?? "—"}</dd></div><div><dt>{ar ? "البريد" : "Email"}</dt><dd>{detail.employee.email ?? "—"}</dd></div></dl></BaseerCard><BaseerCard><h3>{ar ? "الراتب الحالي" : "Current salary"}</h3>{salary ? <dl><div><dt>{ar ? "الإجمالي الشهري" : "Monthly total"}</dt><dd><BaseerMoney value={salary.monthlyGross} language={language} /></dd></div><div><dt>{ar ? "طريقة الاحتساب" : "Calculation method"}</dt><dd>{salary.compensationMethod === "INCLUSIVE_OVERTIME" ? (ar ? "شامل الأوفر تايم" : "Inclusive overtime") : (ar ? "راتب ثابت" : "Fixed monthly")}</dd></div><div><dt>{ar ? "يسري من" : "Applies from"}</dt><dd>{salary.effectiveFrom}</dd></div></dl> : <BaseerEmptyState title={ar ? "لم يُحدد راتب بعد" : "Salary not set"} action={<BaseerButton type="button" onClick={onManageCompensation}>{ar ? "تحديد الراتب" : "Set salary"}</BaseerButton>} />}</BaseerCard></div><div className="hr-employee-profile__snapshot"><BaseerCard><h3>{ar ? "لقطة السجل" : "Record snapshot"}</h3><div className="hr-employee-profile__stats"><span><small>{ar ? "تغييرات الراتب" : "Salary changes"}</small><strong>{detail.compensationHistoryCount}</strong></span><span><small>{ar ? "الخدمات" : "Services"}</small><strong>{detail.serviceCount}</strong></span><span><small>{ar ? "الحركات المالية" : "Financial movements"}</small><strong>{detail.movementCount}</strong></span></div></BaseerCard></div></div> : null}
    {tab === "employment" ? <Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل المسار الوظيفي…" : "Loading employment history…"}</BaseerCard>}><HrEmployeePromotionsPanel employeeId={employeeId} language={language} detail={detail} onError={onError} onChanged={onChanged} /></Suspense> : null}
    {tab === "payroll" ? <PayrollSettlementLedger language={language} sections={sections} /> : null}
    {tab === "time" ? <ProfileTable language={language} rows={leaves} columns={leaveColumns} rowKey={(row) => row.id} empty={ar ? "لا توجد إجازات." : "No leaves."} label={ar ? "إجازات الموظف" : "Employee leaves"} loadingMore={loadingMore === "time"} onMore={leaveCursor ? () => loadMore("time") : undefined} /> : null}
    {tab === "compliance" ? <ProfileTable language={language} rows={services} columns={serviceColumns} rowKey={(row) => row.id} empty={ar ? "لا توجد خدمات أو سجلات امتثال." : "No services or compliance records."} label={ar ? "خدمات الموظف وامتثاله" : "Employee services & compliance"} loadingMore={loadingMore === "compliance"} onMore={serviceCursor ? () => loadMore("compliance") : undefined} /> : null}
    {tab === "documents" ? <div className="hr-employee-profile__stack"><Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل المستندات…" : "Loading documents…"}</BaseerCard>}><HrEmployeeDocumentsPanel employeeId={employeeId} language={language} onError={onError} onChanged={onChanged} /></Suspense><Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل الخطابات…" : "Loading letters…"}</BaseerCard>}><HrEmployeeLettersPanel employeeId={employeeId} language={language} hasCurrentCompensation={Boolean(salary)} onManageCompensation={onManageCompensation} onError={onError} onChanged={onChanged} /></Suspense></div> : null}
    {tab === "financial" ? <ProfileTable language={language} rows={detail.movements} columns={movementColumns} rowKey={(row) => row.id} empty={ar ? "لا توجد حركات مالية." : "No financial movements."} label={ar ? "الحركات المالية المرتبطة بالموظف" : "Employee-linked financial movements"} onMore={detail.hasMoreMovements ? onLoadMoreMovements : undefined} /> : null}
  </BaseerBatchPanel></section></BaseerDialog>{payrollRunId ? <Suspense fallback={null}><HrPayrollDetailDialog runId={payrollRunId} language={language} onClose={() => setPayrollRunId(null)} onChanged={onChanged} onError={onError} /></Suspense> : null}{finalSettlementOpen ? <BaseerDialog open title={ar ? `نهاية خدمة ${name}` : `End of service — ${name}`} size="wide" language={language} onClose={() => { setFinalSettlementOpen(false); void onChanged(); }}><Suspense fallback={<BaseerCard>{ar ? "جارٍ تحميل المخالصة…" : "Loading settlement…"}</BaseerCard>}><HrFinalSettlementWorkspace language={language} employee={detail.employee} /></Suspense></BaseerDialog> : null}</>;
}

function ProfileTable<T>({ language, rows, columns, rowKey, empty, label, onMore, loadingMore = false }: { language: Language; rows: readonly T[]; columns: readonly any[]; rowKey: (row: T) => string; empty: string; label: string; onMore?: () => void | Promise<void>; loadingMore?: boolean }) {
  return <section className="hr-profile-table"><header><h3>{label}</h3></header>{rows.length ? <DataTable ariaLabel={label} caption={label} rows={rows} columns={columns} rowKey={rowKey} /> : <BaseerEmptyState title={empty} />}{onMore ? <BaseerButton type="button" variant="secondary" disabled={loadingMore} onClick={() => void onMore()}>{hrText(language).loadMore}</BaseerButton> : null}</section>;
}

function PayrollSettlementLedger({ language, sections }: { language: Language; sections: readonly LedgerSection[] }) {
  const ar = language === "ar";
  return <section className="hr-payroll-settlements" aria-label={ar ? "الرواتب والتسويات" : "Payroll and settlements"}><header><h3>{ar ? "الرواتب والتسويات" : "Payroll & settlements"}</h3></header><div className="hr-payroll-settlements__scroll"><table><thead><tr><th>{ar ? "المرجع" : "Reference"}</th><th>{ar ? "التاريخ" : "Date"}</th><th>{ar ? "البيان" : "Description"}</th><th>{ar ? "الإجمالي" : "Gross"}</th><th>{ar ? "التسوية / المسدد" : "Settled / applied"}</th><th>{ar ? "الصافي / المتبقي" : "Net / remaining"}</th><th>{ar ? "الحالة" : "Status"}</th></tr></thead><tbody>{sections.map((section) => <Fragment key={section.id}><tr className="hr-payroll-settlements__section"><th colSpan={7}><span>{section.title}</span><small>{section.rows.length}{section.onMore ? "+" : ""}</small></th></tr>{section.rows.length ? section.rows.map((row) => <tr key={row.id}><td>{row.reference}</td><td dir="ltr">{row.date}</td><td>{row.description}</td><td className="hr-payroll-settlements__amount">{row.gross}</td><td className="hr-payroll-settlements__amount">{row.adjustments}</td><td className="hr-payroll-settlements__amount hr-payroll-settlements__balance">{row.balance}</td><td>{row.status}</td></tr>) : <tr className="hr-payroll-settlements__empty"><td colSpan={7}>{section.empty}</td></tr>}{section.onMore ? <tr className="hr-payroll-settlements__more"><td colSpan={7}><BaseerButton type="button" variant="secondary" disabled={section.loadingMore} onClick={() => void section.onMore?.()}>{ar ? `تحميل المزيد من ${section.title}` : `Load more ${section.title}`}</BaseerButton></td></tr> : null}</Fragment>)}</tbody></table></div></section>;
}
