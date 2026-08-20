import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerOutputActions } from "./baseer-output-actions";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { DataTable, type DataTableColumn } from "./data-table";
import { activeSession, type ActiveSession } from "./daily-sales-client";
import { reportTopmostDialogError } from "./use-dialog-focus-trap";
import { consumeHrRouteStage } from "./hr-route-stage";
import { listHrPayrollRuns, type HrPayrollRun } from "./hr-client";
import { formatNumber } from "./number-format";
import "./hr-payroll-create-dialog.css";

type Language = "ar" | "en";

const HrPayrollCreateDialog = lazy(async () => ({ default: (await import("./hr-payroll-create-dialog")).HrPayrollCreateDialog }));
const HrPayrollDetailDialog = lazy(async () => ({ default: (await import("./hr-payroll-detail-dialog")).HrPayrollDetailDialog }));
const HrCompensationPoliciesDialog = lazy(async () => ({ default: (await import("./hr-compensation-policies-dialog")).HrCompensationPoliciesDialog }));

const today = () => new Date().toISOString().slice(0, 10);
const month = () => `${today().slice(0, 7)}-01`;
const money = (value: string) => formatNumber(value);

function PayrollDialogLoadingShell({ title, language, onClose }: { title: string; language: Language; onClose: () => void }) {
  return <BaseerDialog open title={title} size="wide" className="hr-payroll-create-dialog" language={language} onClose={onClose}><p className="hr-payroll-create__loading-shell" role="status">{language === "ar" ? "جارٍ فتح المسير…" : "Opening payroll…"}</p></BaseerDialog>;
}

export function HrPayrollWorkspace({ language, stage }: { language: Language; stage?: string | null }) {
  const ar = language === "ar";
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [runs, setRuns] = useState<HrPayrollRun[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [serverSearch, setServerSearch] = useState("");
  const [summary, setSummary] = useState({ count: 0, grossAmount: "0", advanceSettlementAmount: "0", administrativeDeductionAmount: "0", netPayableAmount: "0" });
  const [message, setMessage] = useState("");
  const showError = useCallback((message: string) => { if (!reportTopmostDialogError(message)) setMessage(message); }, []);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [selectedRun, setSelectedRun] = useState<HrPayrollRun | null>(null);
  const [reviewDraft, setReviewDraft] = useState(false);
  const [policiesOpen, setPoliciesOpen] = useState(false);
  useEffect(() => { if (stage !== "create-payroll") return; setCreateOpen(true); consumeHrRouteStage(3); }, [stage]);
  const [createOpen, setCreateOpen] = useState(false);
  const loadRequestRef = useRef(0);
  useEffect(() => { const timeout = window.setTimeout(() => setServerSearch(search.trim()), 250); return () => window.clearTimeout(timeout); }, [search]);

  const load = useCallback(async (cursor?: string, append = false) => {
    const current = activeSession(); setSession(current); if (!current) { setLoading(false); return; }
    const requestNumber = ++loadRequestRef.current;
    if (!append) setLoading(true);
    try {
      const payroll = await listHrPayrollRuns(current, { search: serverSearch || undefined, cursor, pageSize: 50 });
      if (requestNumber !== loadRequestRef.current) return;
      setRuns((rows) => append ? [...rows, ...payroll.payrollRuns] : payroll.payrollRuns); setNextCursor(payroll.nextCursor);
      setSummary(payroll.summary);
    } catch (error) { showError(presentBaseerApiError(error, language, ar ? "تحميل مسيرات الرواتب" : "Loading payroll runs")); }
    finally { if (requestNumber === loadRequestRef.current) setLoading(false); }
  }, [ar, language, serverSearch]);
  useEffect(() => { void load(); }, [load]);
  const runStatus = (status: HrPayrollRun["status"]) => ({ DRAFT: ar ? "مسودة" : "Draft", APPROVED: ar ? "معتمد" : "Approved", PARTIALLY_PAID: ar ? "مدفوع جزئياً" : "Partially paid", PAID: ar ? "مدفوع" : "Paid", REVERSED: ar ? "معكوس" : "Reversed" })[status];
  const openDetail = (run: HrPayrollRun) => { setReviewDraft(false); setSelectedRun(run); };

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
  if (!session) return null;
  return <section className="administration-panel">
    <div className="administration-section-heading"><div><h2>{ar ? "مسير الرواتب" : "Payroll runs"}</h2></div><div className="page-actions"><BaseerButton type="button" variant="secondary" onClick={() => setPoliciesOpen(true)}>{ar ? "سياسات التعويض" : "Compensation policies"}</BaseerButton><BaseerButton type="button" onClick={() => setCreateOpen(true)}>{ar ? "إنشاء مسير" : "Create payroll"}</BaseerButton></div></div>
    <BaseerSummaryMetricGrid ariaLabel={ar ? "ملخص مسيرات الرواتب" : "Payroll summary"}><BaseerSummaryMetric label={ar ? "إجمالي الاستحقاق" : "Gross entitlement"} value={money(summary.grossAmount)} /><BaseerSummaryMetric label={ar ? "تسوية السلف" : "Advance settlements"} value={money(summary.advanceSettlementAmount)} /><BaseerSummaryMetric label={ar ? "الخصومات الإدارية" : "Administrative deductions"} value={money(summary.administrativeDeductionAmount)} /><BaseerSummaryMetric label={ar ? "صافي المستحق" : "Net payable"} value={money(summary.netPayableAmount)} /></BaseerSummaryMetricGrid>
    <BaseerFilterBar language={language} search={search} searchLabel={ar ? "البحث في المسيرات" : "Search payroll"} searchPlaceholder={ar ? "ابحث برقم المسير أو الحالة" : "Search run number or status"} onSearchChange={setSearch} />
    {loading ? <BaseerCard>{ar ? "جارٍ تحميل مسيرات الرواتب…" : "Loading payroll runs…"}</BaseerCard> : runs.length ? <DataTable<HrPayrollRun> ariaLabel={ar ? "سجل مسيرات الرواتب" : "Payroll run register"} caption={ar ? "سجل مسيرات الرواتب" : "Payroll run register"} rows={runs} columns={columns} rowKey={(row) => row.id} /> : <BaseerCard>{ar ? "لا توجد مسيرات رواتب لهذه الشركة." : "No payroll runs exist for this company."}</BaseerCard>}
    {nextCursor ? <BaseerButton type="button" variant="secondary" onClick={() => void load(nextCursor, true)}>{ar ? "تحميل المزيد" : "Load more"}</BaseerButton> : null}
    <BaseerOutputActions session={session} reportCode="hr.payroll-runs" language={language} />
    {message ? <p className="daily-sales-message error">{message}</p> : null}

    {policiesOpen ? <Suspense fallback={null}><HrCompensationPoliciesDialog open={policiesOpen} language={language} onClose={() => setPoliciesOpen(false)} onChanged={load} onError={showError} /></Suspense> : null}
    {createOpen ? <Suspense fallback={<PayrollDialogLoadingShell title={ar ? "إنشاء مسير راتب" : "Create payroll run"} language={language} onClose={() => setCreateOpen(false)} />}><HrPayrollCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={async () => { setMessage(ar ? "تم إنشاء مسودة المسير. راجعها ثم اعتمدها." : "Payroll draft created. Review it, then approve."); await load(); }} language={language} onError={showError} /></Suspense> : null}
    {selectedRun?.status === "DRAFT" && !reviewDraft ? <Suspense fallback={<PayrollDialogLoadingShell title={ar ? `تعديل مسودة ${selectedRun.runNumber}` : `Edit draft ${selectedRun.runNumber}`} language={language} onClose={() => setSelectedRun(null)} />}><HrPayrollCreateDialog open payrollRunId={selectedRun.id} runNumber={selectedRun.runNumber} onClose={() => setSelectedRun(null)} onReview={() => setReviewDraft(true)} onCreated={async () => { setMessage(ar ? "تم حفظ تعديلات مسودة المسير." : "Payroll draft changes were saved."); await load(); }} language={language} onError={showError} /></Suspense> : null}
    {selectedRun && (selectedRun.status !== "DRAFT" || reviewDraft) ? <Suspense fallback={<PayrollDialogLoadingShell title={selectedRun.runNumber} language={language} onClose={() => setSelectedRun(null)} />}><HrPayrollDetailDialog runId={selectedRun.id} runNumber={selectedRun.runNumber} language={language} onClose={() => setSelectedRun(null)} onChanged={load} onError={showError} /></Suspense> : null}
  </section>;
}
