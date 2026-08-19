import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerOutputActions } from "./baseer-output-actions";
import { BaseerSearchSelect } from "./baseer-search-select";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { DataTable, type DataTableColumn } from "./data-table";
import { activeSession, requestId, type ActiveSession } from "./daily-sales-client";
import {
  listHrAdministrativeDeductions, listHrAdvances, listHrEmployees, listHrPayrollRuns, setHrEmployeeCompensation,
  type HrAdministrativeDeduction, type HrAdvance, type HrEmployee, type HrPayrollRun,
} from "./hr-client";

type Language = "ar" | "en";

const HrPayrollCreateDialog = lazy(async () => ({ default: (await import("./hr-payroll-create-dialog")).HrPayrollCreateDialog }));
const HrPayrollDetailDialog = lazy(async () => ({ default: (await import("./hr-payroll-detail-dialog")).HrPayrollDetailDialog }));

const today = () => new Date().toISOString().slice(0, 10);
const month = () => `${today().slice(0, 7)}-01`;
const label = (language: Language, row: { nameAr: string; nameEn: string | null }) => language === "ar" ? row.nameAr : row.nameEn ?? row.nameAr;
const money = (value: string) => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function HrPayrollWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [runs, setRuns] = useState<HrPayrollRun[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [employees, setEmployees] = useState<HrEmployee[]>([]);
  const [advances, setAdvances] = useState<HrAdvance[]>([]);
  const [deductions, setDeductions] = useState<HrAdministrativeDeduction[]>([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [salaryOpen, setSalaryOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [salary, setSalary] = useState({ employeeId: "", effectiveFrom: month(), monthlyGross: "", compensationMethod: "FIXED_MONTHLY", foodAllowance: "0", otherAllowance: "0", scheduledHoursPerDay: "12", scheduledWorkDays: "30", notes: "" });

  const load = useCallback(async (cursor?: string, append = false) => {
    const current = activeSession(); setSession(current); if (!current) { setLoading(false); return; }
    if (!append) setLoading(true);
    try {
      const [payroll, employeeReceipt, advanceReceipt, deductionReceipt] = await Promise.all([
        listHrPayrollRuns(current, { cursor, pageSize: 50 }), append ? Promise.resolve(null) : listHrEmployees(current, { pageSize: 100 }), append ? Promise.resolve(null) : listHrAdvances(current, { pageSize: 100 }), append ? Promise.resolve(null) : listHrAdministrativeDeductions(current, { pageSize: 100 }),
      ]);
      setRuns((rows) => append ? [...rows, ...payroll.payrollRuns] : payroll.payrollRuns); setNextCursor(payroll.nextCursor);
      if (employeeReceipt) setEmployees(employeeReceipt.employees);
      if (advanceReceipt) setAdvances(advanceReceipt.advances);
      if (deductionReceipt) setDeductions(deductionReceipt.deductions);
    } catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تحميل مسيرات الرواتب" : "Loading payroll runs")); }
    finally { setLoading(false); }
  }, [ar, language]);
  useEffect(() => { void load(); }, [load]);
  const activeEmployees = useMemo(() => employees.filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE"), [employees]);
  const searchEmployeeOptions = useCallback(async (query: string) => {
    const current = activeSession();
    if (!current) return [];
    const receipt = await listHrEmployees(current, { search: query.trim() || undefined, pageSize: 50 });
    return receipt.employees
      .filter((employee) => employee.status === "ACTIVE" || employee.status === "ON_LEAVE")
      .map((employee) => ({ id: employee.id, label: `${employee.employeeNumber} · ${label(language, employee)}` }));
  }, [language]);
  const visibleRuns = useMemo(() => { const needle = search.trim().toLowerCase(); return needle ? runs.filter((run) => [run.runNumber, run.status, run.payrollMonth].join(" ").toLowerCase().includes(needle)) : runs; }, [runs, search]);
  const runStatus = (status: HrPayrollRun["status"]) => ({ DRAFT: ar ? "مسودة" : "Draft", APPROVED: ar ? "معتمد" : "Approved", PARTIALLY_PAID: ar ? "مدفوع جزئياً" : "Partially paid", PAID: ar ? "مدفوع" : "Paid", REVERSED: ar ? "معكوس" : "Reversed" })[status];
  const openDetail = (run: HrPayrollRun) => setDetailId(run.id);
  const saveSalary = async (event: React.FormEvent) => { event.preventDefault(); const current = activeSession(); if (!current || busy) return; setBusy(true); try {
    await setHrEmployeeCompensation(current, {
      employeeId: salary.employeeId, effectiveFrom: salary.effectiveFrom, monthlyGross: salary.monthlyGross,
      compensationMethod: salary.compensationMethod, foodAllowance: salary.foodAllowance || "0", otherAllowance: salary.otherAllowance || "0",
      ...(salary.compensationMethod === "INCLUSIVE_OVERTIME" ? { scheduledHoursPerDay: Number(salary.scheduledHoursPerDay), scheduledWorkDays: Number(salary.scheduledWorkDays) } : {}),
      notes: salary.notes || undefined, idempotencyKey: requestId(),
    });
    setSalaryOpen(false); setMessage(ar ? "تم حفظ اتفاق الراتب؛ سيظهر في المسير من تاريخ سريانه." : "Compensation agreement saved; it will appear in payroll from its effective date.");
  } catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "حفظ اتفاق الراتب" : "Saving compensation agreement")); } finally { setBusy(false); } };

  const columns: readonly DataTableColumn<HrPayrollRun>[] = [
    { id: "number", header: ar ? "رقم المسير" : "Run no.", cell: (row) => <BaseerButton type="button" variant="quiet" onClick={() => void openDetail(row)}>{row.runNumber}</BaseerButton>, sort: (row) => row.runNumber, width: "14rem" },
    { id: "month", header: ar ? "الشهر" : "Month", cell: (row) => row.payrollMonth, sort: (row) => row.payrollMonth, width: "10rem" },
    { id: "employees", header: ar ? "الموظفون" : "Employees", cell: (row) => row.employeeCount, sort: (row) => row.employeeCount, width: "8rem" },
    { id: "gross", header: ar ? "الإجمالي" : "Gross", cell: (row) => money(row.grossAmount), sort: (row) => row.grossAmount, width: "10rem" },
    { id: "advances", header: ar ? "السلف" : "Advances", cell: (row) => money(row.advanceSettlementAmount), sort: (row) => row.advanceSettlementAmount, width: "9rem" },
    { id: "deductions", header: ar ? "الخصومات" : "Deductions", cell: (row) => money(row.administrativeDeductionAmount), sort: (row) => row.administrativeDeductionAmount, width: "10rem" },
    { id: "net", header: ar ? "الصافي" : "Net", cell: (row) => money(row.netPayableAmount), sort: (row) => row.netPayableAmount, width: "10rem" },
    { id: "status", header: ar ? "الحالة" : "Status", cell: (row) => runStatus(row.status), sort: (row) => row.status, width: "10rem" },
  ];
  const totals = visibleRuns.reduce((result, run) => ({ gross: result.gross + Number(run.grossAmount), advances: result.advances + Number(run.advanceSettlementAmount), deductions: result.deductions + Number(run.administrativeDeductionAmount), net: result.net + Number(run.netPayableAmount) }), { gross: 0, advances: 0, deductions: 0, net: 0 });
  if (!session) return null;
  return <section className="administration-panel">
    <div className="administration-section-heading"><div><h2>{ar ? "مسير الرواتب" : "Payroll runs"}</h2><p>{ar ? "مسودة، اعتماد، سداد، وعكس موثق من السجل المحاسبي." : "Draft, approve, pay, and reverse from the accounting record."}</p></div><div className="page-actions"><BaseerButton type="button" variant="secondary" onClick={() => setSalaryOpen(true)}>{ar ? "تحديد راتب" : "Set salary"}</BaseerButton><BaseerButton type="button" onClick={() => setCreateOpen(true)}>{ar ? "إنشاء مسير" : "Create payroll"}</BaseerButton></div></div>
    <BaseerSummaryMetricGrid ariaLabel={ar ? "ملخص مسيرات الرواتب" : "Payroll summary"}><BaseerSummaryMetric label={ar ? "إجمالي الاستحقاق" : "Gross entitlement"} value={money(String(totals.gross))} /><BaseerSummaryMetric label={ar ? "تسوية السلف" : "Advance settlements"} value={money(String(totals.advances))} /><BaseerSummaryMetric label={ar ? "الخصومات الإدارية" : "Administrative deductions"} value={money(String(totals.deductions))} /><BaseerSummaryMetric label={ar ? "صافي المستحق" : "Net payable"} value={money(String(totals.net))} /></BaseerSummaryMetricGrid>
    <BaseerFilterBar language={language} search={search} searchLabel={ar ? "البحث في المسيرات" : "Search payroll"} searchPlaceholder={ar ? "ابحث برقم المسير أو الحالة" : "Search run number or status"} onSearchChange={setSearch} />
    {loading ? <BaseerCard>{ar ? "جارٍ تحميل مسيرات الرواتب…" : "Loading payroll runs…"}</BaseerCard> : visibleRuns.length ? <DataTable<HrPayrollRun> ariaLabel={ar ? "سجل مسيرات الرواتب" : "Payroll run register"} caption={ar ? "سجل مسيرات الرواتب" : "Payroll run register"} rows={visibleRuns} columns={columns} rowKey={(row) => row.id} /> : <BaseerCard>{ar ? "لا توجد مسيرات رواتب لهذه الشركة." : "No payroll runs exist for this company."}</BaseerCard>}
    {nextCursor ? <BaseerButton type="button" variant="secondary" onClick={() => void load(nextCursor, true)}>{ar ? "تحميل المزيد" : "Load more"}</BaseerButton> : null}
    <BaseerOutputActions session={session} reportCode="hr.payroll-runs" language={language} />
    {message ? <p className="daily-sales-message error">{message}</p> : null}

    <BaseerDialog open={salaryOpen} title={ar ? "اتفاق الراتب" : "Compensation agreement"} language={language} busy={busy} onClose={() => setSalaryOpen(false)} footer={<><BaseerButton type="button" variant="secondary" onClick={() => setSalaryOpen(false)}>{ar ? "إلغاء" : "Cancel"}</BaseerButton><BaseerButton type="submit" form="hr-compensation-form" disabled={busy}>{ar ? "حفظ" : "Save"}</BaseerButton></>}><form id="hr-compensation-form" className="administration-form" onSubmit={(event) => void saveSalary(event)}><label>{ar ? "الموظف" : "Employee"}<BaseerSearchSelect required label={ar ? "الموظف" : "Employee"} value={salary.employeeId} placeholder={ar ? "اختر الموظف" : "Select employee"} options={activeEmployees.map((employee) => ({ id: employee.id, label: `${employee.employeeNumber} · ${label(language, employee)}` }))} remoteSearch={searchEmployeeOptions} onChange={(employeeId) => setSalary((value) => ({ ...value, employeeId }))} /></label><label>{ar ? "تاريخ السريان" : "Effective from"}<input required type="date" max={today()} value={salary.effectiveFrom} onChange={(event) => setSalary((value) => ({ ...value, effectiveFrom: event.target.value }))} /></label><label>{ar ? "طريقة الاتفاق" : "Agreement method"}<select value={salary.compensationMethod} onChange={(event) => setSalary((value) => ({ ...value, compensationMethod: event.target.value }))}><option value="FIXED_MONTHLY">{ar ? "راتب شهري ثابت" : "Fixed monthly salary"}</option><option value="INCLUSIVE_OVERTIME">{ar ? "إجمالي شامل الأوفر تايم" : "Total inclusive of overtime"}</option></select></label><label>{salary.compensationMethod === "INCLUSIVE_OVERTIME" ? (ar ? "الإجمالي الشهري المتفق عليه" : "Agreed monthly total") : (ar ? "الراتب الشهري" : "Monthly salary")}<input required inputMode="decimal" value={salary.monthlyGross} onChange={(event) => setSalary((value) => ({ ...value, monthlyGross: event.target.value }))} /></label>{salary.compensationMethod === "INCLUSIVE_OVERTIME" ? <><label>{ar ? "بدل الأكل الشهري" : "Monthly food allowance"}<input required inputMode="decimal" value={salary.foodAllowance} onChange={(event) => setSalary((value) => ({ ...value, foodAllowance: event.target.value }))} /></label><label>{ar ? "بدلات ثابتة أخرى" : "Other fixed allowances"}<input required inputMode="decimal" value={salary.otherAllowance} onChange={(event) => setSalary((value) => ({ ...value, otherAllowance: event.target.value }))} /></label><label>{ar ? "ساعات الدوام اليومية المتفق عليها" : "Agreed daily work hours"}<input required type="number" min="9" max="12" value={salary.scheduledHoursPerDay} onChange={(event) => setSalary((value) => ({ ...value, scheduledHoursPerDay: event.target.value }))} /></label><label>{ar ? "أيام العمل في الشهر" : "Working days per month"}<input required type="number" min="1" max="31" value={salary.scheduledWorkDays} onChange={(event) => setSalary((value) => ({ ...value, scheduledWorkDays: event.target.value }))} /></label></> : null}<label>{ar ? "ملاحظات الاتفاق" : "Agreement notes"}<textarea value={salary.notes} onChange={(event) => setSalary((value) => ({ ...value, notes: event.target.value }))} /></label></form></BaseerDialog>
    {createOpen ? <Suspense fallback={null}><HrPayrollCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={async () => { setMessage(ar ? "تم إنشاء مسودة المسير. راجعها ثم اعتمدها." : "Payroll draft created. Review it, then approve."); await load(); }} language={language} employees={employees} advances={advances} deductions={deductions} onError={setMessage} /></Suspense> : null}
    {detailId ? <Suspense fallback={null}><HrPayrollDetailDialog runId={detailId} language={language} onClose={() => setDetailId(null)} onChanged={load} onError={setMessage} /></Suspense> : null}
  </section>;
}
