import { lazy, Suspense, useEffect, useState } from "react";

import { BaseerBatchPanel, BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { DataTable } from "./data-table";
import { activeSession } from "./daily-sales-client";
import {
  listHrAdministrativeDeductions, listHrAdvances, listHrEmployeeLeaves, listHrEmployeePayrollHistory,
  type HrAdministrativeDeduction, type HrAdvance, type HrDetail, type HrEmployeeLeave, type HrEmployeePayrollHistoryLine,
} from "./hr-client";

type Language = "ar" | "en";
type ProfileTab = "overview" | "payroll" | "advances" | "leaves" | "services" | "financial";
const HrPayrollDetailDialog = lazy(async () => ({ default: (await import("./hr-payroll-detail-dialog")).HrPayrollDetailDialog }));
const money = (value: string) => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function HrEmployeeProfileDialog({ detail, language, onClose, onEdit, onLoadMoreMovements, onError, onChanged }: {
  detail: HrDetail;
  language: Language;
  onClose: () => void;
  onEdit: () => void;
  onLoadMoreMovements: () => Promise<void>;
  onError: (message: string) => void;
  onChanged: () => Promise<void>;
}) {
  const ar = language === "ar";
  const [tab, setTab] = useState<ProfileTab>("overview");
  const [loading, setLoading] = useState(false);
  const [payroll, setPayroll] = useState<HrEmployeePayrollHistoryLine[]>([]);
  const [payrollCursor, setPayrollCursor] = useState<string | null>(null);
  const [advances, setAdvances] = useState<HrAdvance[]>([]);
  const [advanceCursor, setAdvanceCursor] = useState<string | null>(null);
  const [deductions, setDeductions] = useState<HrAdministrativeDeduction[]>([]);
  const [deductionCursor, setDeductionCursor] = useState<string | null>(null);
  const [leaves, setLeaves] = useState<HrEmployeeLeave[]>([]);
  const [leaveCursor, setLeaveCursor] = useState<string | null>(null);
  const [payrollRunId, setPayrollRunId] = useState<string | null>(null);
  const employeeId = detail.employee.id;

  useEffect(() => { setTab("overview"); setPayroll([]); setPayrollCursor(null); setAdvances([]); setAdvanceCursor(null); setDeductions([]); setDeductionCursor(null); setLeaves([]); setLeaveCursor(null); }, [employeeId]);
  const loadTab = async (cursor?: string, append = false, register?: "advances" | "deductions") => {
    const session = activeSession(); if (!session || tab === "overview" || tab === "services" || tab === "financial") return;
    setLoading(true);
    try {
      if (tab === "payroll") { const receipt = await listHrEmployeePayrollHistory(session, employeeId, { cursor, pageSize: 25 }); setPayroll((rows) => append ? [...rows, ...receipt.lines] : receipt.lines); setPayrollCursor(receipt.nextCursor); }
      if (tab === "advances") {
        if (!append || register === "advances") {
          const receipt = await listHrAdvances(session, { employeeId, cursor: register === "advances" ? cursor : undefined, pageSize: 25 });
          setAdvances((rows) => append ? [...rows, ...receipt.advances] : receipt.advances); setAdvanceCursor(receipt.nextCursor);
        }
        if (!append || register === "deductions") {
          const receipt = await listHrAdministrativeDeductions(session, { employeeId, cursor: register === "deductions" ? cursor : undefined, pageSize: 25 });
          setDeductions((rows) => append ? [...rows, ...receipt.deductions] : receipt.deductions); setDeductionCursor(receipt.nextCursor);
        }
      }
      if (tab === "leaves") { const receipt = await listHrEmployeeLeaves(session, { employeeId, cursor, pageSize: 25 }); setLeaves((rows) => append ? [...rows, ...receipt.leaves] : receipt.leaves); setLeaveCursor(receipt.nextCursor); }
    } catch (error) { onError(ar ? "تعذر تحميل بيانات ملف الموظف." : "The employee-file data could not be loaded."); }
    finally { setLoading(false); }
  };
  useEffect(() => { void loadTab(); }, [tab, employeeId]);
  const name = ar ? detail.employee.nameAr : detail.employee.nameEn ?? detail.employee.nameAr;
  const status = ({ ACTIVE: ar ? "نشط" : "Active", ON_LEAVE: ar ? "في إجازة" : "On leave", TERMINATED: ar ? "منتهٍ" : "Terminated", ARCHIVED: ar ? "مؤرشف" : "Archived" })[detail.employee.status];
  const tabs: readonly { id: ProfileTab; label: string }[] = [
    { id: "overview", label: ar ? "نظرة عامة" : "Overview" }, { id: "payroll", label: ar ? "الرواتب" : "Payroll" }, { id: "advances", label: ar ? "السلف والخصومات" : "Advances & deductions" },
    { id: "leaves", label: ar ? "الإجازات" : "Leaves" }, { id: "services", label: ar ? "الخدمات" : "Services" }, { id: "financial", label: ar ? "السجل المالي" : "Financial record" },
  ];
  const payrollColumns = [{ id: "month", header: ar ? "الشهر" : "Month", cell: (row: HrEmployeePayrollHistoryLine) => row.payrollMonth }, { id: "run", header: ar ? "المسير" : "Run", cell: (row: HrEmployeePayrollHistoryLine) => <BaseerButton type="button" variant="quiet" onClick={() => setPayrollRunId(row.payrollRunId)}>{row.runNumber}</BaseerButton> }, { id: "gross", header: ar ? "الإجمالي" : "Gross", cell: (row: HrEmployeePayrollHistoryLine) => money(row.grossSalary) }, { id: "advance", header: ar ? "السلف" : "Advances", cell: (row: HrEmployeePayrollHistoryLine) => money(row.advanceSettlementAmount) }, { id: "deduction", header: ar ? "الخصومات" : "Deductions", cell: (row: HrEmployeePayrollHistoryLine) => money(row.administrativeDeductionAmount) }, { id: "net", header: ar ? "الصافي" : "Net", cell: (row: HrEmployeePayrollHistoryLine) => money(row.netPayableAmount) }, { id: "status", header: ar ? "الحالة" : "Status", cell: (row: HrEmployeePayrollHistoryLine) => row.payrollStatus }];
  const advanceColumns = [{ id: "number", header: ar ? "السلفة" : "Advance", cell: (row: HrAdvance) => row.advanceNumber }, { id: "date", header: ar ? "التاريخ" : "Date", cell: (row: HrAdvance) => row.businessDate }, { id: "original", header: ar ? "الأصل" : "Original", cell: (row: HrAdvance) => money(row.originalAmount) }, { id: "remaining", header: ar ? "المتبقي" : "Remaining", cell: (row: HrAdvance) => money(row.remainingAmount) }, { id: "status", header: ar ? "الحالة" : "Status", cell: (row: HrAdvance) => row.status }];
  const deductionColumns = [{ id: "number", header: ar ? "الخصم" : "Deduction", cell: (row: HrAdministrativeDeduction) => row.deductionNumber }, { id: "date", header: ar ? "التاريخ" : "Date", cell: (row: HrAdministrativeDeduction) => row.businessDate }, { id: "description", header: ar ? "البيان" : "Description", cell: (row: HrAdministrativeDeduction) => row.description }, { id: "remaining", header: ar ? "المتبقي" : "Remaining", cell: (row: HrAdministrativeDeduction) => money(row.remainingAmount) }, { id: "status", header: ar ? "الحالة" : "Status", cell: (row: HrAdministrativeDeduction) => row.status }];
  const leaveColumns = [{ id: "type", header: ar ? "النوع" : "Type", cell: (row: HrEmployeeLeave) => row.leaveType }, { id: "period", header: ar ? "الفترة" : "Period", cell: (row: HrEmployeeLeave) => `${row.startDate} — ${row.endDate}` }, { id: "return", header: ar ? "العودة الفعلية" : "Actual return", cell: (row: HrEmployeeLeave) => row.actualReturnDate ?? "—" }, { id: "status", header: ar ? "الحالة" : "Status", cell: (row: HrEmployeeLeave) => row.status }];
  const serviceColumns = [{ id: "type", header: ar ? "الخدمة" : "Service", cell: (row: HrDetail["services"][number]) => row.serviceType }, { id: "reference", header: ar ? "المرجع" : "Reference", cell: (row: HrDetail["services"][number]) => row.referenceNumber ?? "—" }, { id: "expiry", header: ar ? "الانتهاء" : "Expiry", cell: (row: HrDetail["services"][number]) => row.expiryDate ?? "—" }, { id: "cost", header: ar ? "التكلفة" : "Cost", cell: (row: HrDetail["services"][number]) => row.status === "ISSUED" ? (ar ? "صادرة" : "Issued") : (ar ? "لم تصدر" : "Not issued") }, { id: "compliance", header: ar ? "الامتثال" : "Compliance", cell: (row: HrDetail["services"][number]) => row.complianceStatus }];
  const movementColumns = [{ id: "date", header: ar ? "التاريخ" : "Date", cell: (row: HrDetail["movements"][number]) => row.businessDate }, { id: "type", header: ar ? "العملية" : "Operation", cell: (row: HrDetail["movements"][number]) => row.movementType }, { id: "reference", header: ar ? "المرجع" : "Reference", cell: (row: HrDetail["movements"][number]) => row.sourceReference }, { id: "amount", header: ar ? "المبلغ" : "Amount", cell: (row: HrDetail["movements"][number]) => <b dir="ltr">{money(row.amount)}</b> }];
  return <><BaseerDialog open title={name} size="wide" language={language} onClose={onClose} footer={<><BaseerButton type="button" variant="secondary" onClick={onEdit}>{ar ? "تعديل الموظف" : "Edit employee"}</BaseerButton><BaseerButton type="button" variant="secondary" onClick={onClose}>{ar ? "إغلاق" : "Close"}</BaseerButton></>}><header style={{ display: "flex", gap: ".5rem", flexWrap: "wrap", alignItems: "baseline", marginBlockEnd: ".75rem" }}><strong>{detail.employee.employeeNumber}</strong><span>{detail.employee.jobTitle ?? "—"}</span><span>{status}</span></header><div style={{ overflowX: "auto" }}><BaseerWorkspaceTabs ariaLabel={ar ? "تبويبات ملف الموظف" : "Employee profile tabs"} idPrefix="hr-employee-profile" tabs={tabs} activeId={tab} onChange={(value) => setTab(value as ProfileTab)} /></div><BaseerBatchPanel id={`hr-employee-profile-panel-${tab}`} labelledBy={`hr-employee-profile-${tab}`}>
    {tab === "overview" ? <div className="administration-list"><article><strong>{ar ? "بيانات الموظف" : "Employee details"}</strong><span>{ar ? "تاريخ التعيين" : "Hired"}: {detail.employee.hireDate}</span><span>{ar ? "الهاتف" : "Phone"}: {detail.employee.phone ?? "—"}</span><span>{ar ? "البريد" : "Email"}: {detail.employee.email ?? "—"}</span></article><article><strong>{ar ? "اتفاق الراتب الحالي" : "Current compensation agreement"}</strong>{detail.compensation ? <><span>{ar ? "الإجمالي الشهري" : "Monthly total"}: {money(detail.compensation.monthlyGross)}</span><span>{detail.compensation.compensationMethod === "INCLUSIVE_OVERTIME" ? (ar ? "شامل الأوفر تايم" : "Inclusive of overtime") : (ar ? "راتب ثابت" : "Fixed salary")}</span><span>{ar ? "بدل الأكل" : "Food allowance"}: {money(detail.compensation.foodAllowance)}</span>{detail.compensation.scheduledHoursPerDay ? <span>{ar ? "الدوام" : "Schedule"}: {detail.compensation.scheduledHoursPerDay}h × {detail.compensation.scheduledWorkDays}</span> : null}</> : <span>{ar ? "لا يوجد اتفاق راتب نشط." : "No active compensation agreement."}</span>}</article></div> : null}
    {tab === "payroll" ? <ProfileTable loading={loading} rows={payroll} columns={payrollColumns} rowKey={(row) => row.id} empty={ar ? "لا توجد مسيرات لهذا الموظف." : "No payroll runs for this employee."} onMore={payrollCursor ? () => void loadTab(payrollCursor, true) : undefined} moreLabel={ar ? "تحميل المزيد" : "Load more"} /> : null}
    {tab === "advances" ? <>{<ProfileTable loading={loading} rows={advances} columns={advanceColumns} rowKey={(row) => row.id} empty={ar ? "لا توجد سلف." : "No advances."} onMore={advanceCursor ? () => void loadTab(advanceCursor, true, "advances") : undefined} moreLabel={ar ? "تحميل المزيد" : "Load more"} />}<ProfileTable loading={loading} rows={deductions} columns={deductionColumns} rowKey={(row) => row.id} empty={ar ? "لا توجد خصومات إدارية." : "No administrative deductions."} onMore={deductionCursor ? () => void loadTab(deductionCursor, true, "deductions") : undefined} moreLabel={ar ? "تحميل المزيد" : "Load more"} /></> : null}
    {tab === "leaves" ? <ProfileTable loading={loading} rows={leaves} columns={leaveColumns} rowKey={(row) => row.id} empty={ar ? "لا توجد إجازات." : "No leaves."} onMore={leaveCursor ? () => void loadTab(leaveCursor, true) : undefined} moreLabel={ar ? "تحميل المزيد" : "Load more"} /> : null}
    {tab === "services" ? <ProfileTable rows={detail.services} columns={serviceColumns} rowKey={(row) => row.id} empty={ar ? "لا توجد خدمات موظف." : "No employee services."} /> : null}
    {tab === "financial" ? <ProfileTable rows={detail.movements} columns={movementColumns} rowKey={(row) => row.id} empty={ar ? "لا توجد حركات مالية." : "No financial movements."} onMore={detail.hasMoreMovements ? () => void onLoadMoreMovements() : undefined} moreLabel={ar ? "تحميل المزيد" : "Load more"} /> : null}
  </BaseerBatchPanel></BaseerDialog>{payrollRunId ? <Suspense fallback={null}><HrPayrollDetailDialog runId={payrollRunId} language={language} onClose={() => setPayrollRunId(null)} onChanged={onChanged} onError={onError} /></Suspense> : null}</>;
}

function ProfileTable<T>({ loading = false, rows, columns, rowKey, empty, onMore, moreLabel }: { loading?: boolean; rows: readonly T[]; columns: readonly any[]; rowKey: (row: T) => string; empty: string; onMore?: () => void; moreLabel?: string }) {
  if (loading && !rows.length) return <BaseerCard>{"…"}</BaseerCard>;
  return <div style={{ display: "grid", gap: ".75rem" }}>{rows.length ? <DataTable ariaLabel={empty} caption={empty} rows={rows} columns={columns} rowKey={rowKey} /> : <BaseerCard>{empty}</BaseerCard>}{onMore ? <BaseerButton type="button" variant="secondary" onClick={onMore}>{moreLabel}</BaseerButton> : null}</div>;
}
