import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";

import { presentBaseerApiError, presentBaseerLoadError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerBatchPanel, BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { BaseerCard } from "./baseer-card";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerFilterBar } from "./baseer-filter-bar";
import { BaseerPeriodFilter, baseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import { BaseerOutputActions } from "./baseer-output-actions";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import type { BaseerDataGridColumn } from "./baseer-data-grid";
import { BaseerDataGridField as BaseerDataGrid } from "./baseer-data-grid-field";
import { activeSession, type ActiveSession } from "./daily-sales-client";
import { reportTopmostDialogError } from "./use-dialog-focus-trap";
import { consumeHrRouteStage } from "./hr-route-stage";
import { getHrNurixHistoricalPayroll, getHrPayrollMissingMonthPreview, listHrNurixHistoricalPayrolls, listHrPayrollRuns, type HrNurixHistoricalPayroll, type HrNurixHistoricalPayrollDetail, type HrNurixHistoricalPayrollStatus, type HrPayrollMissingMonthPreview, type HrPayrollRun } from "./hr-client";
import { formatNumber } from "./number-format";
import "./hr-payroll-create-dialog.css";

type Language = "ar" | "en";
type WorkspaceMessage = { tone: "success" | "error"; text: string };
type PayrollWorkspaceTab = "operational" | "nurix-history";

const HrPayrollCreateDialog = lazy(async () => ({ default: (await import("./hr-payroll-create-dialog")).HrPayrollCreateDialog }));
const HrPayrollDetailDialog = lazy(async () => ({ default: (await import("./hr-payroll-detail-dialog")).HrPayrollDetailDialog }));
const HrCompensationPoliciesDialog = lazy(async () => ({ default: (await import("./hr-compensation-policies-dialog")).HrCompensationPoliciesDialog }));

const today = () => new Date().toISOString().slice(0, 10);
const month = () => `${today().slice(0, 7)}-01`;
const money = (value: string) => formatNumber(value);

function PayrollDialogLoadingShell({ title, language, onClose }: { title: string; language: Language; onClose: () => void }) {
  return <BaseerDialog open title={title} size="wide" className="hr-payroll-create-dialog" language={language} onClose={onClose}><p className="hr-payroll-create__loading-shell" role="status">{language === "ar" ? "جارٍ فتح المسير…" : "Opening payroll…"}</p></BaseerDialog>;
}

function NurixHistoryStatus({ language, status }: { language: Language; status: HrNurixHistoricalPayrollStatus }) {
  const ar = language === "ar";
  const label = ({
    SOURCE_PAID_RECONCILED: ar ? "مدفوع تاريخياً — موثق بالمصدر" : "Historically paid — source evidenced",
    SOURCE_EVIDENCE_INCOMPLETE: ar ? "دليل المصدر غير مكتمل" : "Source evidence incomplete",
    SOURCE_CANCELLED_SUPERSEDED: ar ? "ملغى/مستبدل في نوركس" : "Cancelled/superseded in Noorix",
  })[status];
  return <span className={`baseer-status-badge ${status === "SOURCE_PAID_RECONCILED" ? "success" : status === "SOURCE_EVIDENCE_INCOMPLETE" ? "warning" : "neutral"}`}>{label}</span>;
}

function NurixPayrollHistoryDetailDialog({ language, payrollId, title, onClose, onError }: { language: Language; payrollId: string; title: string; onClose: () => void; onError: (text: string) => void }) {
  const ar = language === "ar";
  const [detail, setDetail] = useState<HrNurixHistoricalPayrollDetail | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    const current = activeSession();
    if (!current) { setLoading(false); return () => { alive = false; }; }
    void getHrNurixHistoricalPayroll(current, payrollId).then((value) => { if (alive) setDetail(value); }).catch((error) => { if (alive) onError(presentBaseerLoadError(error, language, { ar: "تفاصيل مسير نوركس التاريخي", en: "Noorix historical payroll details" })); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [language, onError, payrollId]);
  const lineColumns: readonly BaseerDataGridColumn<HrNurixHistoricalPayrollDetail["lines"][number]>[] = [
    { id: "employee", header: ar ? "الموظف" : "Employee", cell: (row) => <span>{row.employeeNumber ? `${row.employeeNumber} · ` : ""}{ar ? row.employeeNameAr : row.employeeNameEn ?? row.employeeNameAr}</span>, sort: (row) => `${row.employeeNumber ?? ""}:${row.employeeNameAr}`, width: "17rem" },
    { id: "gross", header: ar ? "الراتب" : "Salary", cell: (row) => money(row.grossSalary), sort: (row) => row.grossSalary, width: "9rem" },
    { id: "deductions", header: ar ? "الخصومات" : "Deductions", cell: (row) => money(row.deductionsAmount), sort: (row) => row.deductionsAmount, width: "9rem" },
    { id: "advances", header: ar ? "السلف" : "Advances", cell: (row) => money(row.advancesAmount), sort: (row) => row.advancesAmount, width: "9rem" },
    { id: "net", header: ar ? "الصافي" : "Net", cell: (row) => money(row.netAmount), sort: (row) => row.netAmount, width: "9rem" },
  ];
  const ledgerColumns: readonly BaseerDataGridColumn<HrNurixHistoricalPayrollDetail["ledgerEntries"][number]>[] = [
    { id: "reference", header: ar ? "مرجع القيد" : "Ledger reference", cell: (row) => row.reference, sort: (row) => row.reference, width: "14rem" },
    { id: "transaction", header: ar ? "تاريخ العملية" : "Transaction date", cell: (row) => row.transactionDate, sort: (row) => row.transactionDate, width: "10rem" },
    { id: "posted", header: ar ? "تاريخ القيد" : "Posted date", cell: (row) => row.postedAt ?? "—", sort: (row) => row.postedAt ?? "", width: "10rem" },
    { id: "vault", header: ar ? "الخزنة" : "Vault", cell: (row) => ar ? row.vaultNameAr ?? "—" : row.vaultNameEn ?? row.vaultNameAr ?? "—", sort: (row) => row.vaultNameAr ?? "", width: "12rem" },
    { id: "amount", header: ar ? "المبلغ" : "Amount", cell: (row) => money(row.amount), sort: (row) => row.amount, width: "9rem" },
  ];
  const allocationColumns: readonly BaseerDataGridColumn<HrNurixHistoricalPayrollDetail["vaultAllocations"][number]>[] = [
    { id: "vault", header: ar ? "الخزنة المصدرية" : "Source vault", cell: (row) => ar ? row.vaultNameAr : row.vaultNameEn ?? row.vaultNameAr, sort: (row) => row.vaultNameAr, width: "16rem" },
    { id: "amount", header: ar ? "المبلغ" : "Amount", cell: (row) => money(row.amount), sort: (row) => row.amount, width: "10rem" },
  ];
  return <BaseerDialog open title={title} size="wide" language={language} onClose={onClose} footer={<BaseerButton type="button" variant="secondary" onClick={onClose}>{ar ? "إغلاق" : "Close"}</BaseerButton>}>
    {loading ? <BaseerCard>{ar ? "جارٍ تحميل دليل مسير نوركس…" : "Loading Noorix payroll evidence…"}</BaseerCard> : detail ? <section className="administration-list">
      <BaseerCard><p><strong>{ar ? "سجل تاريخي للقراءة فقط." : "Read-only historical record."}</strong> {ar ? "لا يمثل هذا المسير اعتماداً أو دفعة أو قيداً داخل بصير." : "It is not a Baseer approval, payment, or journal entry."}</p></BaseerCard>
      <BaseerSummaryMetricGrid ariaLabel={ar ? "ملخص المسير التاريخي" : "Historical payroll summary"}><BaseerSummaryMetric label={ar ? "الراتب الإجمالي" : "Gross salary"} value={money(detail.payrollRun.grossAmount)} /><BaseerSummaryMetric label={ar ? "الخصومات" : "Deductions"} value={money(detail.payrollRun.deductionsAmount)} /><BaseerSummaryMetric label={ar ? "السلف" : "Advances"} value={money(detail.payrollRun.advancesAmount)} /><BaseerSummaryMetric label={ar ? "الصافي" : "Net"} value={money(detail.payrollRun.netAmount)} /></BaseerSummaryMetricGrid>
      <dl className="administration-details"><div><dt>{ar ? "فترة الراتب" : "Payroll period"}</dt><dd>{detail.payrollRun.payrollMonth.slice(0, 7)}</dd></div><div><dt>{ar ? "الحالة التاريخية" : "Historical status"}</dt><dd><NurixHistoryStatus language={language} status={detail.payrollRun.historicalStatus} /></dd></div><div><dt>{ar ? "فاتورة الراتب" : "Salary invoice"}</dt><dd>{detail.invoice ? `${detail.invoice.number} · ${money(detail.invoice.amount)}` : "—"}</dd></div><div><dt>{ar ? "تاريخ العملية المصدرية" : "Source transaction date"}</dt><dd>{detail.payrollRun.sourceTransactionDate ?? "—"}</dd></div><div><dt>{ar ? "تاريخ القيد بالمصدر" : "Source posting date"}</dt><dd>{detail.payrollRun.sourcePostedAt ?? "—"}</dd></div><div><dt>{ar ? "الأثر المالي في بصير" : "Baseer financial state"}</dt><dd>{ar ? "غير مُنشأ — دليل فقط" : "Not posted — evidence only"}</dd></div></dl>
      <BaseerDataGrid ariaLabel={ar ? "بنود مسير نوركس التاريخي" : "Noorix historical payroll lines"} caption={ar ? "بنود المسير" : "Payroll lines"} rows={detail.lines} columns={lineColumns} rowKey={(row) => row.id} />
      {detail.ledgerEntries.length ? <BaseerDataGrid ariaLabel={ar ? "قيود المصدر المرتبطة" : "Linked source ledger entries"} caption={ar ? "قيود المصدر المرتبطة" : "Linked source ledger entries"} rows={detail.ledgerEntries} columns={ledgerColumns} rowKey={(row) => row.id} /> : null}
      {detail.vaultAllocations.length ? <BaseerDataGrid ariaLabel={ar ? "توزيع خزائن المصدر" : "Source-vault allocation"} caption={ar ? "توزيع خزائن المصدر" : "Source-vault allocation"} rows={detail.vaultAllocations} columns={allocationColumns} rowKey={(row) => row.id} /> : null}
    </section> : <BaseerCard>{ar ? "لا يتوفر دليل تفصيلي لهذا المسير." : "No detailed evidence is available for this payroll."}</BaseerCard>}
  </BaseerDialog>;
}

export function HrPayrollWorkspace({ language, stage }: { language: Language; stage?: string | null }) {
  const ar = language === "ar";
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [tab, setTab] = useState<PayrollWorkspaceTab>("operational");
  const [runs, setRuns] = useState<HrPayrollRun[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  // Payroll is a monthly register, but opening it on a full year makes
  // completed historical runs discoverable immediately after migration.
  // Users can still narrow it to a month from the period control.
  const [period, setPeriod] = useState<BaseerPeriodRange>(() => baseerPeriodRange("YEAR"));
  const [serverSearch, setServerSearch] = useState("");
  const [missingMonthPreview, setMissingMonthPreview] = useState<HrPayrollMissingMonthPreview | null>(null);
  const [historicalRuns, setHistoricalRuns] = useState<HrNurixHistoricalPayroll[]>([]);
  const [historicalSummary, setHistoricalSummary] = useState({ count: 0, grossAmount: "0", deductionsAmount: "0", advancesAmount: "0", netAmount: "0" });
  const [message, setMessage] = useState<WorkspaceMessage | null>(null);
  const showError = useCallback((text: string) => { if (!reportTopmostDialogError(text)) setMessage({ tone: "error", text }); }, []);
  const [loading, setLoading] = useState(true);
  const [missingMonthLoading, setMissingMonthLoading] = useState(true);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [selectedRun, setSelectedRun] = useState<HrPayrollRun | null>(null);
  const [reviewDraft, setReviewDraft] = useState(false);
  const [selectedHistoricalRun, setSelectedHistoricalRun] = useState<HrNurixHistoricalPayroll | null>(null);
  const [policiesOpen, setPoliciesOpen] = useState(false);
  useEffect(() => { if (stage !== "create-payroll") return; setCreateOpen(true); consumeHrRouteStage(3); }, [stage]);
  const [createOpen, setCreateOpen] = useState(false);
  const loadRequestRef = useRef(0);
  const historicalLoadRequestRef = useRef(0);
  useEffect(() => { const timeout = window.setTimeout(() => setServerSearch(search.trim()), 250); return () => window.clearTimeout(timeout); }, [search]);

  const load = useCallback(async (cursor?: string, append = false) => {
    const current = activeSession(); setSession(current); if (!current) { setLoading(false); return; }
    const requestNumber = ++loadRequestRef.current;
    if (!append) setLoading(true);
    try {
      const searchPeriod = serverSearch ? baseerPeriodRange("ALL") : period;
      const payroll = await listHrPayrollRuns(current, { periodFrom: searchPeriod.from, periodTo: searchPeriod.to, search: serverSearch || undefined, cursor, pageSize: 50 });
      if (requestNumber !== loadRequestRef.current) return;
      setRuns((rows) => append ? [...rows, ...payroll.payrollRuns] : payroll.payrollRuns); setNextCursor(payroll.nextCursor);
    } catch (error) { showError(presentBaseerLoadError(error, language, { ar: "مسيرات الرواتب", en: "payroll runs" })); }
    finally { if (requestNumber === loadRequestRef.current) setLoading(false); }
  }, [ar, language, period.from, period.to, serverSearch]);
  useEffect(() => { if (tab === "operational") void load(); }, [load, tab]);
  const loadMissingMonthPreview = useCallback(async () => {
    const current = activeSession();
    if (!current) { setMissingMonthLoading(false); return; }
    setMissingMonthLoading(true);
    try { setMissingMonthPreview(await getHrPayrollMissingMonthPreview(current)); }
    catch (error) { showError(presentBaseerLoadError(error, language, { ar: "معاينة استحقاق الشهر", en: "monthly entitlement preview" })); }
    finally { setMissingMonthLoading(false); }
  }, [language, showError]);
  useEffect(() => { if (tab === "operational") void loadMissingMonthPreview(); }, [loadMissingMonthPreview, tab]);
  const reloadPayroll = useCallback(async () => { await Promise.all([load(), loadMissingMonthPreview()]); }, [load, loadMissingMonthPreview]);
  const loadHistorical = useCallback(async () => {
    const current = activeSession(); setSession(current); if (!current) { setHistoricalLoading(false); return; }
    const requestNumber = ++historicalLoadRequestRef.current;
    setHistoricalLoading(true);
    try {
      const history = await listHrNurixHistoricalPayrolls(current);
      if (requestNumber !== historicalLoadRequestRef.current) return;
      setHistoricalRuns(history.payrollRuns); setHistoricalSummary(history.summary);
    } catch (error) { showError(presentBaseerLoadError(error, language, { ar: "مسيرات نوركس التاريخية", en: "Noorix historical payroll" })); }
    finally { if (requestNumber === historicalLoadRequestRef.current) setHistoricalLoading(false); }
  }, [language, showError]);
  useEffect(() => { void loadHistorical(); }, [loadHistorical]);
  useEffect(() => { if (!historicalLoading && historicalSummary.count === 0 && tab === "nurix-history") setTab("operational"); }, [historicalLoading, historicalSummary.count, tab]);
  const runStatus = (status: HrPayrollRun["status"]) => ({ DRAFT: ar ? "مسودة" : "Draft", APPROVED: ar ? "معتمد" : "Approved", PARTIALLY_PAID: ar ? "مدفوع جزئياً" : "Partially paid", PAID: ar ? "مدفوع" : "Paid", REVERSED: ar ? "ملغى" : "Cancelled" })[status];
  const openDetail = (run: HrPayrollRun) => { setReviewDraft(false); setSelectedRun(run); };

  const columns: readonly BaseerDataGridColumn<HrPayrollRun>[] = [
    { id: "number", header: ar ? "رقم المسير" : "Run no.", cell: (row) => <BaseerButton type="button" variant="quiet" onClick={() => void openDetail(row)}>{row.runNumber}</BaseerButton>, sort: (row) => row.runNumber, width: "14rem" },
    { id: "month", header: ar ? "الشهر" : "Month", cell: (row) => row.payrollMonth.slice(0, 7), sort: (row) => row.payrollMonth, width: "10rem" },
    { id: "employees", header: ar ? "الموظفون" : "Employees", cell: (row) => row.employeeCount, sort: (row) => row.employeeCount, width: "8rem" },
    { id: "gross", header: ar ? "الإجمالي" : "Gross", cell: (row) => money(row.grossAmount), sort: (row) => row.grossAmount, width: "10rem" },
    { id: "advances", header: ar ? "السلف" : "Advances", cell: (row) => money(row.advanceSettlementAmount), sort: (row) => row.advanceSettlementAmount, width: "9rem" },
    { id: "deductions", header: ar ? "الخصومات" : "Deductions", cell: (row) => money(row.administrativeDeductionAmount), sort: (row) => row.administrativeDeductionAmount, width: "10rem" },
    { id: "net", header: ar ? "الصافي" : "Net", cell: (row) => money(row.netPayableAmount), sort: (row) => row.netPayableAmount, width: "10rem" },
    { id: "status", header: ar ? "الحالة" : "Status", cell: (row) => runStatus(row.status), sort: (row) => row.status, width: "10rem" },
  ];
  const historicalColumns: readonly BaseerDataGridColumn<HrNurixHistoricalPayroll>[] = [
    { id: "number", header: ar ? "رقم المسير" : "Run no.", cell: (row) => <BaseerButton type="button" variant="quiet" onClick={() => setSelectedHistoricalRun(row)}>{row.runNumber}</BaseerButton>, sort: (row) => row.runNumber, width: "14rem" },
    { id: "month", header: ar ? "فترة الراتب" : "Payroll period", cell: (row) => row.payrollMonth.slice(0, 7), sort: (row) => row.payrollMonth, width: "10rem" },
    { id: "employees", header: ar ? "الموظفون" : "Employees", cell: (row) => row.employeeCount, sort: (row) => row.employeeCount, width: "8rem" },
    { id: "gross", header: ar ? "الراتب" : "Salary", cell: (row) => money(row.grossAmount), sort: (row) => row.grossAmount, width: "9rem" },
    { id: "deductions", header: ar ? "الخصومات" : "Deductions", cell: (row) => money(row.deductionsAmount), sort: (row) => row.deductionsAmount, width: "9rem" },
    { id: "advances", header: ar ? "السلف" : "Advances", cell: (row) => money(row.advancesAmount), sort: (row) => row.advancesAmount, width: "9rem" },
    { id: "net", header: ar ? "الصافي" : "Net", cell: (row) => money(row.netAmount), sort: (row) => row.netAmount, width: "9rem" },
    { id: "invoice", header: ar ? "الفاتورة" : "Invoice", cell: (row) => row.invoiceNumber ?? "—", sort: (row) => row.invoiceNumber ?? "", width: "14rem" },
    { id: "ledger", header: ar ? "القيد" : "Ledger", cell: (row) => row.ledgerEntryCount ? (ar ? `${row.ledgerEntryCount} قيد` : `${row.ledgerEntryCount} entries`) : "—", sort: (row) => row.ledgerEntryCount, width: "8rem" },
    { id: "status", header: ar ? "الحالة التاريخية" : "Historical status", cell: (row) => <NurixHistoryStatus language={language} status={row.historicalStatus} />, sort: (row) => row.historicalStatus, width: "17rem" },
  ];
  if (!session) return null;
  const missingMonth = missingMonthPreview?.state === "READY" ? missingMonthPreview : null;
  return <section className="administration-panel">
    <div className="administration-section-heading"><div><h2>{ar ? "مسير الرواتب" : "Payroll runs"}</h2></div>{tab === "operational" ? <div className="page-actions"><BaseerButton type="button" variant="secondary" onClick={() => setPoliciesOpen(true)}>{ar ? "سياسات التعويض" : "Compensation policies"}</BaseerButton><BaseerButton type="button" onClick={() => setCreateOpen(true)}>{ar ? "إنشاء مسير" : "Create payroll"}</BaseerButton></div> : null}</div>
    <BaseerWorkspaceTabs ariaLabel={ar ? "أقسام مسيرات الرواتب" : "Payroll sections"} idPrefix="hr-payroll-workspace" tabs={[{ id: "operational", label: ar ? "مسيرات بصير" : "Baseer payroll" }, ...(historicalSummary.count > 0 ? [{ id: "nurix-history", label: ar ? "مسيرات نوركس التاريخية" : "Noorix historical payroll" }] : [])]} activeId={tab} onChange={(value) => setTab(value as PayrollWorkspaceTab)} />
    {tab === "operational" ? <BaseerBatchPanel id="hr-payroll-workspace-panel-operational" labelledBy="hr-payroll-workspace-operational">
      <BaseerSummaryMetricGrid ariaLabel={ar ? "استحقاق أحدث شهر مكتمل بلا مسير" : "Latest completed month without payroll"}><BaseerSummaryMetric label={ar ? `إجمالي الاستحقاق${missingMonth?.payrollMonth ? ` · ${missingMonth.payrollMonth.slice(0, 7)}` : ""}` : "Gross entitlement"} value={missingMonth ? money(missingMonth.totals.grossEntitlementAmount) : "—"} /><BaseerSummaryMetric label={ar ? "سلف مؤهلة للمراجعة" : "Eligible advances to review"} value={missingMonth ? money(missingMonth.totals.eligibleAdvanceAmount) : "—"} /><BaseerSummaryMetric label={ar ? "خصومات مؤهلة للمراجعة" : "Eligible deductions to review"} value={missingMonth ? money(missingMonth.totals.eligibleAdministrativeDeductionAmount) : "—"} /><BaseerSummaryMetric label={ar ? "موظفون مؤهلون" : "Eligible employees"} value={missingMonth ? String(missingMonth.counts.eligibleEmployees) : "—"} /><BaseerSummaryMetric tone="muted" label={ar ? "اتفاقات تحتاج مراجعة" : "Compensation agreements to review"} value={missingMonth ? String(missingMonth.counts.employeesMissingCompensation) : "—"} /></BaseerSummaryMetricGrid>
      {missingMonthLoading ? <BaseerCard>{ar ? "جارٍ تحديد استحقاق أحدث شهر مكتمل بلا مسير…" : "Finding the latest completed month without payroll…"}</BaseerCard> : missingMonthPreview?.messageAr ? <BaseerCard>{missingMonthPreview.messageAr}</BaseerCard> : null}
      <BaseerFilterBar language={language} search={search} searchLabel={ar ? "البحث في المسيرات" : "Search payroll"} searchPlaceholder={ar ? "ابحث برقم المسير أو الحالة" : "Search run number or status"} onSearchChange={setSearch} controls={<BaseerPeriodFilter language={language} value={period} onChange={setPeriod} allowNonContiguousMonths={false} />} />
      {loading ? <BaseerCard>{ar ? "جارٍ تحميل مسيرات الرواتب…" : "Loading payroll runs…"}</BaseerCard> : runs.length ? <BaseerDataGrid<HrPayrollRun> ariaLabel={ar ? "سجل مسيرات الرواتب" : "Payroll run register"} caption={ar ? "سجل مسيرات الرواتب" : "Payroll run register"} rows={runs} columns={columns} rowKey={(row) => row.id} /> : <BaseerCard>{ar ? "لا توجد مسيرات رواتب ضمن الفترة المختارة." : "No payroll runs match the selected period."}</BaseerCard>}
      {nextCursor ? <BaseerButton type="button" variant="secondary" onClick={() => void load(nextCursor, true)}>{ar ? "تحميل المزيد" : "Load more"}</BaseerButton> : null}
      <BaseerOutputActions session={session} reportCode="hr.payroll-runs" language={language} />
    </BaseerBatchPanel> : <BaseerBatchPanel id="hr-payroll-workspace-panel-nurix-history" labelledBy="hr-payroll-workspace-nurix-history">
      <BaseerCard><p><strong>{ar ? "دليل نوركس التاريخي للقراءة فقط." : "Read-only Noorix historical evidence."}</strong> {ar ? "لا ينشئ هذا العرض مسير بصير أو دفعة أو قيداً مالياً." : "This view never creates a Baseer payroll, payment, or financial journal."}</p></BaseerCard>
      <BaseerSummaryMetricGrid ariaLabel={ar ? "ملخص مسيرات نوركس التاريخية" : "Noorix historical payroll summary"}><BaseerSummaryMetric label={ar ? "عدد المسيرات" : "Payroll runs"} value={String(historicalSummary.count)} /><BaseerSummaryMetric label={ar ? "الراتب الإجمالي" : "Gross salary"} value={money(historicalSummary.grossAmount)} /><BaseerSummaryMetric label={ar ? "الخصومات" : "Deductions"} value={money(historicalSummary.deductionsAmount)} /><BaseerSummaryMetric label={ar ? "السلف" : "Advances"} value={money(historicalSummary.advancesAmount)} /><BaseerSummaryMetric label={ar ? "الصافي" : "Net"} value={money(historicalSummary.netAmount)} /></BaseerSummaryMetricGrid>
      {historicalLoading ? <BaseerCard>{ar ? "جارٍ تحميل مسيرات نوركس التاريخية…" : "Loading Noorix historical payroll…"}</BaseerCard> : historicalRuns.length ? <BaseerDataGrid<HrNurixHistoricalPayroll> ariaLabel={ar ? "سجل مسيرات نوركس التاريخية" : "Noorix historical payroll register"} caption={ar ? "مسيرات نوركس التاريخية" : "Noorix historical payroll"} rows={historicalRuns} columns={historicalColumns} rowKey={(row) => row.id} /> : <BaseerCard>{ar ? "لا توجد مسيرات نوركس تاريخية موثقة لهذه الشركة." : "No Noorix historical payroll evidence exists for this company."}</BaseerCard>}
    </BaseerBatchPanel>}
    {message ? <p className={`daily-sales-message ${message.tone}`}>{message.text}</p> : null}

    {policiesOpen ? <Suspense fallback={null}><HrCompensationPoliciesDialog open={policiesOpen} language={language} onClose={() => setPoliciesOpen(false)} onChanged={reloadPayroll} onError={showError} /></Suspense> : null}
    {createOpen ? <Suspense fallback={<PayrollDialogLoadingShell title={ar ? "إنشاء مسير راتب" : "Create payroll run"} language={language} onClose={() => setCreateOpen(false)} />}><HrPayrollCreateDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={async () => { setMessage({ tone: "success", text: ar ? "تم إنشاء مسودة المسير. راجعها ثم اعتمدها." : "Payroll draft created. Review it, then approve." }); await reloadPayroll(); }} language={language} onError={showError} /></Suspense> : null}
    {selectedRun?.status === "DRAFT" && !reviewDraft ? <Suspense fallback={<PayrollDialogLoadingShell title={ar ? `تعديل مسودة ${selectedRun.runNumber}` : `Edit draft ${selectedRun.runNumber}`} language={language} onClose={() => setSelectedRun(null)} />}><HrPayrollCreateDialog open payrollRunId={selectedRun.id} runNumber={selectedRun.runNumber} onClose={() => setSelectedRun(null)} onReview={() => setReviewDraft(true)} onCreated={async () => { setMessage({ tone: "success", text: ar ? "تم حفظ تعديلات مسودة المسير." : "Payroll draft changes were saved." }); await reloadPayroll(); }} onDiscarded={async () => { setMessage({ tone: "success", text: ar ? "تم حذف مسودة المسير." : "Payroll draft discarded." }); await reloadPayroll(); }} language={language} onError={showError} /></Suspense> : null}
    {selectedRun && (selectedRun.status !== "DRAFT" || reviewDraft) ? <Suspense fallback={<PayrollDialogLoadingShell title={selectedRun.runNumber} language={language} onClose={() => setSelectedRun(null)} />}><HrPayrollDetailDialog runId={selectedRun.id} runNumber={selectedRun.runNumber} language={language} onClose={() => setSelectedRun(null)} onChanged={reloadPayroll} onError={showError} /></Suspense> : null}
    {selectedHistoricalRun ? <NurixPayrollHistoryDetailDialog language={language} payrollId={selectedHistoricalRun.id} title={ar ? `مسير نوركس ${selectedHistoricalRun.runNumber}` : `Noorix payroll ${selectedHistoricalRun.runNumber}`} onClose={() => setSelectedHistoricalRun(null)} onError={showError} /> : null}
  </section>;
}
