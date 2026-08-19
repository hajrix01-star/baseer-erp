import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerOutputActions } from "./baseer-output-actions";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { DataTable, type DataTableColumn } from "./data-table";
import { activeSession, type ActiveSession } from "./daily-sales-client";
import { listHrPayrollRuns, type HrPayrollRun } from "./hr-client";

type Language = "ar" | "en";

const HrPayrollCreateDialog = lazy(async () => ({ default: (await import("./hr-payroll-create-dialog")).HrPayrollCreateDialog }));
const HrPayrollDetailDialog = lazy(async () => ({ default: (await import("./hr-payroll-detail-dialog")).HrPayrollDetailDialog }));
const HrCompensationPoliciesDialog = lazy(async () => ({ default: (await import("./hr-compensation-policies-dialog")).HrCompensationPoliciesDialog }));

const today = () => new Date().toISOString().slice(0, 10);
const month = () => `${today().slice(0, 7)}-01`;
const money = (value: string) => Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function HrPayrollWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [runs, setRuns] = useState<HrPayrollRun[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [policiesOpen, setPoliciesOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async (cursor?: string, append = false) => {
    const current = activeSession(); setSession(current); if (!current) { setLoading(false); return; }
    if (!append) setLoading(true);
    try {
      const payroll = await listHrPayrollRuns(current, { cursor, pageSize: 50 });
      setRuns((rows) => append ? [...rows, ...payroll.payrollRuns] : payroll.payrollRuns); setNextCursor(payroll.nextCursor);
    } catch (error) { setMessage(presentBaseerApiError(error, language, ar ? "تحميل مسيرات الرواتب" : "Loading payroll runs")); }
    finally { setLoading(false); }
  }, [ar, language]);
  useEffect(() => { void load(); }, [load]);
  const visibleRuns = useMemo(() => { const needle = search.trim().toLowerCase(); return needle ? runs.filter((run) => [run.runNumber, run.status, run.payrollMonth].join(" ").toLowerCase().includes(needle)) : runs; }, [runs, search]);
  const runStatus = (status: HrPayrollRun["status"]) => ({ DRAFT: ar ? "مسودة" : "Draft", APPROVED: ar ? "معتمد" : "Approved", PARTIALLY_PAID: ar ? "مدفوع جزئياً" : "Partially paid", PAID: ar ? "مدفوع" : "Paid", REVERSED: ar ? "معكوس" : "Reversed" })[status];
  const openDetail = (run: HrPayrollRun) => setDetailId(run.id);

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
    <div className="administration-section-heading"><div><h2>{ar ? "مسير الرواتب" : "Payroll runs"}</h2><p>{ar ? "مسودة، اعتماد، سداد، وعكس موثق من السجل المحاسبي." : "Draft, approve, pay, and reverse from the accounting record."}</p></div><div className="page-actions"><BaseerButton type="button" variant="secondary" onClick={() => setPoliciesOpen(true)}>{ar ? "سياسات التعويض" : "Compensation policies"}</BaseerButton><BaseerButton type="button" onClick={() => setCreateOpen(true)}>{ar ? "إنشاء مسير" : "Create payroll"}</BaseerButton></div></div>
    <BaseerSummaryMetricGrid ariaLabel={ar ? "ملخص مسيرات الرواتب" : "Payroll summary"}><BaseerSummaryMetric label={ar ? "إجمالي الاستحقاق" : "Gross entitlement"} value={money(String(totals.gross))} /><BaseerSummaryMetric label={ar ? "تسوية السلف" : "Advance settlements"} value={money(String(totals.advances))} /><BaseerSummaryMetric label={ar ? "الخصومات الإدارية" : "Administrative deductions"} value={money(String(totals.deductions))} /><BaseerSummaryMetric label={ar ? "صافي المستحق" : "Net payable"} value={money(String(totals.net))} /></BaseerSummaryMetricGrid>
    <BaseerFilterBar language={language} search={search} searchLabel={ar ? "البحث في المسيرات" : "Search payroll"} searchPlaceholder={ar ? "ابحث برقم المسير أو الحالة" : "Search run number or status"} onSearchChange={setSearch} />
    {loading ? <BaseerCard>{ar ? "جارٍ تحميل مسيرات الرواتب…" : "Loading payroll runs…"}</BaseerCard> : visibleRuns.length ? <DataTable<HrPayrollRun> ariaLabel={ar ? "سجل مسيرات الرواتب" : "Payroll run register"} caption={ar ? "سجل مسيرات الرواتب" : "Payroll run register"} rows={visibleRuns} columns={columns} rowKey={(row) => row.id} /> : <BaseerCard>{ar ? "لا توجد مسيرات رواتب لهذه الشركة." : "No payroll runs exist for this company."}</BaseerCard>}
    {nextCursor ? <BaseerButton type="button" variant="secondary" onClick={() => void load(nextCursor, true)}>{ar ? "تحميل المزيد" : "Load more"}</BaseerButton> : null}
    <BaseerOutputActions session={session} reportCode="hr.payroll-runs" language={language} />
    {message ? <p className="daily-sales-message error">{message}</p> : null}

    {policiesOpen ? <Suspense fallback={null}><HrCompensationPoliciesDialog open={policiesOpen} language={language} onClose={() => setPoliciesOpen(false)} onChanged={load} onError={setMessage} /></Suspense> : null}
    {createOpen ? <Suspense fallback={null}><HrPayrollCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={async () => { setMessage(ar ? "تم إنشاء مسودة المسير. راجعها ثم اعتمدها." : "Payroll draft created. Review it, then approve."); await load(); }} language={language} onError={setMessage} /></Suspense> : null}
    {detailId ? <Suspense fallback={null}><HrPayrollDetailDialog runId={detailId} language={language} onClose={() => setDetailId(null)} onChanged={load} onError={setMessage} /></Suspense> : null}
  </section>;
}
