import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';

import { BaseerButton } from './baseer-button';
import { FinancialEvidenceDialog } from './financial-evidence-dialog';
import { BaseerFilterBar } from './baseer-filter-bar';
import { BaseerFilterToggle } from './baseer-filter-controls';
import { BaseerWorkspaceTabs } from './baseer-batch-layout';
import { defaultBaseerPeriodRange, iso, riyadhToday, type BaseerPeriodRange } from './baseer-period-values';
import { ReportDocumentActions } from './report-document-actions';
import { DailySalesSignIn } from './daily-sales-sign-in';
import { activeSession, api, type ActiveSession } from './daily-sales-client';
import { presentBaseerApiError } from './baseer-api-error';
import { BaseerCompanyReadQuery } from './baseer-company-read-query';
import { createOfficialReportRun, type OfficialReportRunPurpose } from './report-run-client';
import { formatCount, formatDate, formatMonthYear, formatNumberFixed, formatPercent } from './number-format';
import type { FinancialEvidenceDescriptor } from '@baseer-erp/contracts';
import './reports-workspace.css';

const LazyBaseerPeriodFilter = lazy(async () => ({ default: (await import('./baseer-period-filter')).BaseerPeriodFilter }));
const LazyLedgerTrialBalanceWorkspace = lazy(async () => ({ default: (await import('./ledger-trial-balance-workspace')).LedgerTrialBalanceWorkspace }));
const LazyAccrualProfitLossWorkspace = lazy(async () => ({ default: (await import('./accrual-profit-loss-workspace')).AccrualProfitLossWorkspace }));
function BaseerPeriodFilter(props: ComponentProps<typeof LazyBaseerPeriodFilter>) { return <Suspense fallback={<span className="baseer-period-filter" aria-busy="true" />}><LazyBaseerPeriodFilter {...props} /></Suspense>; }

type Language = 'ar' | 'en';
type MoneyDisplay = Readonly<{ raw: string; display: string; sign: 'positive' | 'negative' | 'zero' }>;
type ReportRow = Readonly<{ code: string; labelAr: string; labelEn: string; kind: 'SECTION' | 'LINE'; parentCode: string | null; direction: 'INFLOW' | 'OUTFLOW'; eventCount: number; amount: MoneyDisplay; shareOfCollectedSalesPercent: string | null; evidence: FinancialEvidenceDescriptor }>;
type ReportTotals = Readonly<{ inflows: MoneyDisplay; outflows: MoneyDisplay; netCashResult: MoneyDisplay; netCashResultShareOfCollectedSalesPercent: string | null; inflowsEvidence: FinancialEvidenceDescriptor; outflowsEvidence: FinancialEvidenceDescriptor; netCashResultEvidence: FinancialEvidenceDescriptor }>;
type PeriodComparison = Readonly<{ columns: readonly Readonly<{ key: string }>[]; rows: readonly Readonly<{ code: string; amounts: readonly MoneyDisplay[] }>[]; netCashResultAmounts: readonly MoneyDisplay[] }>;
type ReportResult =
  | Readonly<{ state: 'NOT_READY'; messageAr: string }>
  | Readonly<{ state: 'COVERAGE_INCOMPLETE'; messageAr: string; coverageStartBusinessDate?: string }>
  | Readonly<{ state: 'NO_DATA'; messageAr: string; rows: readonly []; totals: ReportTotals }>
  | Readonly<{ state: 'READY'; rows: readonly ReportRow[]; totals: ReportTotals; periodComparison?: PeriodComparison }>;
type Counterparty = Readonly<{ labelAr: string; labelEn: string }>;
type EvidenceItem = Readonly<{ evidenceId: string; businessDate: string; amount: MoneyDisplay; source: { journalEntryId: string; labelAr: string; labelEn: string; reference: string; description: string | null; counterparty: Counterparty | null } }>;
type EvidenceReceipt = Readonly<{ descriptor: FinancialEvidenceDescriptor; nextCursor: string | null; items: readonly EvidenceItem[] }>;
type SourceReceipt = Readonly<{ journalEntry: { id: string; businessDate: string; labelAr: string; labelEn: string; sourceReference: string; description: string | null; counterparty: Counterparty | null; status: 'POSTED' | 'REVERSED'; lines: readonly { id: string; lineNumber: number; accountCode: string; accountNameAr: string; accountNameEn: string; debit: MoneyDisplay; credit: MoneyDisplay; description: string | null }[] } }>;

const copy = {
  ar: {
    title: 'حركة النقد الفعلية', amount: 'المبلغ', gross: 'شامل الضريبة', period: 'الفترة', loading: 'يتم تحميل التقرير…', details: 'تفصيل الرقم', close: 'إغلاق', source: 'المصدر', counterparty: 'المورد / الجهة', openSource: 'فتح القيد المصدر', back: 'العودة للتفصيل', loadMore: 'تحميل المزيد',
    salesShare: 'نسبة البند من المبيعات المحصّلة', salesShareColumn: 'من المبيعات', total: 'المجموع', noEvidence: 'لا توجد عمليات مصدر لهذا البند ضمن الفترة المحددة.', sourceJournal: 'القيد المصدر', debit: 'مدين', credit: 'دائن', statusCancelled: 'ملغى', statusPosted: 'مثبت', noData: 'لا توجد حركات مؤهلة ضمن الفترة المحددة.', retry: 'إعادة المحاولة', showCoveredPeriod: 'عرض الفترة المؤهلة', displayLevel: 'مستوى العرض', twoLevels: 'مستويان', threeLevels: 'ثلاثة مستويات',
  },
  en: {
    title: 'Actual cash movement', amount: 'Amount', gross: 'VAT inclusive', period: 'Period', loading: 'Loading report…', details: 'Amount details', close: 'Close', source: 'Source', counterparty: 'Supplier / party', openSource: 'Open source journal', back: 'Back to details', loadMore: 'Load more',
    salesShare: 'Share of collected sales', salesShareColumn: 'Of sales', total: 'Total', noEvidence: 'There are no source operations for this line in the selected period.', sourceJournal: 'Source journal', debit: 'Debit', credit: 'Credit', statusCancelled: 'Cancelled', statusPosted: 'Posted', noData: 'There are no eligible movements in the selected period.', retry: 'Retry', showCoveredPeriod: 'Show covered period', displayLevel: 'Display level', twoLevels: 'Two levels', threeLevels: 'Three levels',
  },
} as const;

export type PersonalCashPerformanceSharedRead = Readonly<{
  session: ActiveSession;
  period: BaseerPeriodRange;
  setPeriod: (value: BaseerPeriodRange) => void;
  vatInclusive: boolean;
  setVatInclusive: (value: boolean) => void;
  report: ReportResult | undefined;
  loading: boolean;
  loadError: unknown;
  refetch: () => Promise<void>;
}>;

/**
 * The cash-movement report is deliberately reusable.  Reports owns the
 * default live read; consumers such as Command Center can provide its
 * already-active read instead, keeping the hierarchy, filters, drill-down,
 * and source-journal behavior in one place without issuing a second read.
 */
export function PersonalCashPerformanceWorkspace({ language, sharedRead }: { language: Language; sharedRead?: PersonalCashPerformanceSharedRead }) {
  if (sharedRead) return <PersonalCashPerformanceContent language={language} session={sharedRead.session} period={sharedRead.period} setPeriod={sharedRead.setPeriod} vatInclusive={sharedRead.vatInclusive} setVatInclusive={sharedRead.setVatInclusive} report={sharedRead.report ?? null} loading={sharedRead.loading} loadError={sharedRead.loadError} refetch={sharedRead.refetch} />;
  return <PersonalCashPerformanceWorkspaceLive language={language} />;
}

function PersonalCashPerformanceWorkspaceLive({ language }: { language: Language }) {
  const [session] = useState<ActiveSession | null>(activeSession);
  const [period, setPeriod] = useState<BaseerPeriodRange>(defaultBaseerPeriodRange);
  const [vatInclusive, setVatInclusive] = useState(true);
  if (!session) return <DailySalesSignIn language={language} />;
  const query = new URLSearchParams({ from: period.from, to: period.to, vatInclusive: String(vatInclusive) });
  if (period.preset === 'MONTH' && period.months.length > 1) query.set('months', period.months.join(','));
  return <BaseerCompanyReadQuery session={session} resource="reports.personal-cash-performance" scope={[language, period.preset, period.from, period.to, period.months.join(','), String(vatInclusive)]} mode="live" refreshIntervalMs={5_000} load={(current, signal) => api<ReportResult>(current, `/reports/personal-cash-performance?${query.toString()}`, { signal })}>
    {({ data, loading, error, refetch }) => <PersonalCashPerformanceContent language={language} session={session} period={period} setPeriod={setPeriod} vatInclusive={vatInclusive} setVatInclusive={setVatInclusive} report={data ?? null} loading={loading} loadError={error} refetch={refetch} />}
  </BaseerCompanyReadQuery>;
}

function PersonalCashPerformanceContent({ language, session, period, setPeriod, vatInclusive, setVatInclusive, report, loading, loadError, refetch }: { language: Language; session: ActiveSession; period: BaseerPeriodRange; setPeriod: (value: BaseerPeriodRange) => void; vatInclusive: boolean; setVatInclusive: (value: boolean) => void; report: ReportResult | null; loading: boolean; loadError: unknown; refetch: () => Promise<void> }) {
  const text = copy[language];
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [displayLevel, setDisplayLevel] = useState<2 | 3>(2);
  const [selectedRow, setSelectedRow] = useState<ReportRow | null>(null);
  const [evidence, setEvidence] = useState<EvidenceReceipt | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [source, setSource] = useState<SourceReceipt | null>(null);
  const [evidenceScope, setEvidenceScope] = useState<Readonly<{ from: string; to: string; months: readonly string[] }> | null>(null);
  const readAbort = useRef<AbortController | null>(null);
  const readEpoch = useRef(0);
  useEffect(() => {
    readEpoch.current += 1;
    readAbort.current?.abort();
    setSelectedRow(null); setEvidence(null); setSource(null); setEvidenceScope(null); setEvidenceBusy(false); setMessage('');
    return () => readAbort.current?.abort();
  }, [session.companyId, session.sessionExpiresAt, period.from, period.to, period.months, vatInclusive]);

  const createReportRun = (purpose: OfficialReportRunPurpose = 'evidence') => createOfficialReportRun(session, {
    reportCode: 'personal_cash_performance',
    purpose,
    request: { from: period.from, to: period.to, ...(period.preset === 'MONTH' && period.months.length > 1 ? { months: period.months } : {}), vatInclusive },
  });

  const rows = report?.state === 'READY' ? report.rows : [];
  const periodComparison = report?.state === 'READY' ? report.periodComparison ?? null : null;
  const netResultRow: ReportRow | null = report?.state === 'READY' ? {
    code: 'net_cash_result', labelAr: 'صافي الحركة النقدية', labelEn: 'Net cash movement', kind: 'SECTION', parentCode: null,
    direction: report.totals.netCashResult.sign === 'negative' ? 'OUTFLOW' : 'INFLOW', eventCount: 0, amount: report.totals.netCashResult, evidence: report.totals.netCashResultEvidence,
    shareOfCollectedSalesPercent: report.totals.netCashResultShareOfCollectedSalesPercent,
  } : null;
  const hierarchy = useMemo(() => {
    const byCode = new Map(rows.map((row) => [row.code, row]));
    const depthFor = (row: ReportRow) => reportRowDepth(row, byCode);
    const visible = rows.filter((row) => depthFor(row) <= displayLevel && reportRowIsExpanded(row, byCode, expanded));
    return { depthFor, visible };
  }, [displayLevel, expanded, rows]);
  const label = (row: ReportRow) => language === 'ar' ? row.labelAr : row.labelEn || row.labelAr;
  const hasChildren = (row: ReportRow) => rows.some((candidate) => candidate.parentCode === row.code && hierarchy.depthFor(candidate) <= displayLevel);
  const openEvidence = async (row: ReportRow, cursor?: string, requestedScope?: Readonly<{ from: string; to: string; months: readonly string[] }>) => {
    if (!report || report.state !== 'READY') return;
    const epoch = ++readEpoch.current; readAbort.current?.abort(); const controller = new AbortController(); readAbort.current = controller;
    const scope = requestedScope ?? evidenceScope ?? { from: period.from, to: period.to, months: period.preset === 'MONTH' && period.months.length > 1 ? period.months : [] };
    if (!cursor) { setSelectedRow(row); setEvidence(null); setSource(null); setEvidenceScope(scope); }
    setEvidenceBusy(true);
    try {
      const query = financialEvidenceQuery(row.evidence, scope, vatInclusive, cursor);
      if (!query) return;
      const next = await api<EvidenceReceipt>(session, `/reports/financial-evidence/live?${query.toString()}`, { signal: controller.signal });
      if (controller.signal.aborted || epoch !== readEpoch.current || activeSession()?.companyId !== session.companyId || activeSession()?.sessionExpiresAt !== session.sessionExpiresAt) return;
      setEvidence((previous) => cursor && previous ? { ...next, items: [...previous.items, ...next.items] } : next);
    } catch (error) { if (!controller.signal.aborted) setMessage(presentBaseerApiError(error, language, text.details)); }
    finally { if (epoch === readEpoch.current) setEvidenceBusy(false); }
  };
  const openSource = async (evidenceId: string) => {
    if (!report || report.state !== 'READY') return;
    const journalEntryId = evidence?.items.find((item) => item.evidenceId === evidenceId)?.source.journalEntryId;
    if (!journalEntryId) return;
    const epoch = ++readEpoch.current; readAbort.current?.abort(); const controller = new AbortController(); readAbort.current = controller;
    setMessage(''); setSource(null); setEvidenceBusy(true);
    try { const scope = evidenceScope ?? { from: period.from, to: period.to, months: period.preset === 'MONTH' && period.months.length > 1 ? period.months : [] }; const query = financialEvidenceQuery(selectedRow?.evidence ?? null, scope, vatInclusive); if (!query) return; const next = await api<SourceReceipt>(session, `/reports/financial-evidence/live/source/${journalEntryId}?${query.toString()}`, { signal: controller.signal }); if (!controller.signal.aborted && epoch === readEpoch.current && activeSession()?.companyId === session.companyId && activeSession()?.sessionExpiresAt === session.sessionExpiresAt) setSource(next); }
    catch (error) { if (!controller.signal.aborted) setMessage(presentBaseerApiError(error, language, text.source)); }
    finally { if (epoch === readEpoch.current) setEvidenceBusy(false); }
  };
  const closeDetails = () => { setSelectedRow(null); setEvidence(null); setSource(null); setEvidenceScope(null); };
  const monthScope = (month: string) => ({ from: `${month}-01`, to: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10), months: [] as const });
  const useCoveredPeriod = () => {
    if (report?.state !== 'COVERAGE_INCOMPLETE' || !report.coverageStartBusinessDate) return;
    const today = riyadhToday();
    const todayText = iso(today.year, today.month, today.day);
    const to = period.to < report.coverageStartBusinessDate
      ? report.coverageStartBusinessDate
      : period.to > todayText ? todayText : period.to;
    setPeriod({ preset: 'RANGE', from: report.coverageStartBusinessDate, to, months: [] });
  };
  const rootMessage = loadError ? presentBaseerApiError(loadError, language, text.title) : '';
  return <section className="reports-prototype reports-workspace" aria-label={text.title}>
    <header className="reports-prototype__intro"><div><h2>{text.title}</h2></div></header>
    <section className="reports-prototype__canvas" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <div className="reports-prototype__toolbar reports-prototype__toolbar--with-actions" aria-label={text.period}>
        <BaseerFilterBar language={language} controls={<><BaseerPeriodFilter language={language} value={period} onChange={setPeriod} presets={['DAY', 'MONTH', 'QUARTER', 'YEAR', 'RANGE']} /><BaseerFilterToggle label={text.gross} checked={vatInclusive} onChange={setVatInclusive} /></>} />
        <div className="reports-prototype__depth-control" role="group" aria-label={text.displayLevel}>
          <BaseerButton type="button" variant={displayLevel === 2 ? 'primary' : 'secondary'} aria-pressed={displayLevel === 2} onClick={() => setDisplayLevel(2)}>{text.twoLevels}</BaseerButton>
          <BaseerButton type="button" variant={displayLevel === 3 ? 'primary' : 'secondary'} aria-pressed={displayLevel === 3} onClick={() => setDisplayLevel(3)}>{text.threeLevels}</BaseerButton>
        </div>
        {!loading && report?.state === 'READY' ? <ReportDocumentActions session={session} createReportRun={createReportRun} language={language} /> : null}
      </div>
      {message || rootMessage ? <p className="reports-prototype__notice is-error">{message || rootMessage}</p> : null}
      {message || rootMessage ? <div className="reports-prototype__retry"><BaseerButton type="button" variant="secondary" onClick={() => { setMessage(''); void refetch().catch(() => undefined); }}>{text.retry}</BaseerButton></div> : null}
      {loading ? <p className="reports-prototype__notice">{text.loading}</p> : null}
      {!loading && report && report.state !== 'READY' ? <p className={`reports-prototype__notice${report.state === 'NO_DATA' ? '' : ' is-warning'}`}>{report.messageAr || text.noData}</p> : null}
      {!loading && report?.state === 'COVERAGE_INCOMPLETE' && report.coverageStartBusinessDate ? <div className="reports-prototype__coverage-action"><BaseerButton type="button" variant="secondary" onClick={useCoveredPeriod}>{text.showCoveredPeriod}</BaseerButton></div> : null}
      {!loading && report?.state === 'READY' ? <div className="reports-prototype__table-shell"><table data-baseer-report-table="snapshot" className="reports-prototype__table"><caption>{text.title}</caption><thead><tr><th scope="col">{text.title}</th>{periodComparison?.columns.map((column) => <th key={column.key} scope="col" className="reports-prototype__period-column"><bdi dir="ltr">{formatMonthYear(column.key, language, 'short')}</bdi></th>)}<th scope="col" className="reports-prototype__amount">{periodComparison ? text.total : text.amount}</th><th scope="col" className="reports-prototype__sales-share-column">{text.salesShareColumn}</th></tr></thead><tbody>
        {hierarchy.visible.map((row) => <ReportTableRow key={row.code} language={language} row={row} depth={hierarchy.depthFor(row)} label={label(row)} hasChildren={hasChildren(row)} expanded={expanded[row.code] !== false} periodAmounts={periodComparison?.rows.find((comparison) => comparison.code === row.code)?.amounts ?? []} periodKeys={periodComparison?.columns.map((column) => column.key) ?? []} onToggle={() => setExpanded((current) => ({ ...current, [row.code]: !(current[row.code] !== false) }))} onOpen={() => void openEvidence(row)} onOpenMonth={(amount, month) => void openEvidence({ ...row, amount }, undefined, monthScope(month))} />)}
        {netResultRow ? <tr className="reports-prototype__row reports-prototype__row--result"><th scope="row">{label(netResultRow)}</th>{periodComparison?.netCashResultAmounts.map((amount, index) => <PeriodAmountCell key={periodComparison.columns[index]?.key ?? index} money={amount} onOpen={() => void openEvidence({ ...netResultRow, amount }, undefined, monthScope(periodComparison.columns[index]!.key))} />)}<td><MoneyButton money={netResultRow.amount} label={label(netResultRow)} onClick={() => void openEvidence(netResultRow)} /></td><SalesShareCell language={language} value={netResultRow.shareOfCollectedSalesPercent} /></tr> : null}
      </tbody></table></div> : null}
    </section>
    <FinancialEvidenceDialog
      open={selectedRow !== null}
      language={language}
      title={selectedRow ? label(selectedRow) : text.details}
      amount={selectedRow?.amount ?? null}
      shareOfBasePercent={selectedRow?.shareOfCollectedSalesPercent ?? null}
      shareLabel={text.salesShare}
      operations={selectedRow ? evidence ? evidence.items.map((item) => ({
        id: item.evidenceId,
        kind: language === 'ar' ? item.source.labelAr : item.source.labelEn || item.source.labelAr,
        counterparty: item.source.counterparty ? (language === 'ar' ? item.source.counterparty.labelAr : item.source.counterparty.labelEn || item.source.counterparty.labelAr) : null,
        reference: item.source.reference,
        businessDate: item.businessDate,
        amount: item.amount,
      })) : null : []}
      journal={source ? {
        reference: source.journalEntry.sourceReference,
        businessDate: source.journalEntry.businessDate,
        description: [
          language === 'ar' ? source.journalEntry.labelAr : source.journalEntry.labelEn || source.journalEntry.labelAr,
          source.journalEntry.counterparty ? `${text.counterparty}: ${language === 'ar' ? source.journalEntry.counterparty.labelAr : source.journalEntry.counterparty.labelEn || source.journalEntry.counterparty.labelAr}` : null,
          source.journalEntry.description,
        ].filter(Boolean).join(' · '),
        status: source.journalEntry.status,
        lines: source.journalEntry.lines.map((line) => ({
          id: line.id,
          lineNumber: line.lineNumber,
          accountCode: line.accountCode,
          accountName: language === 'ar' ? line.accountNameAr : line.accountNameEn || line.accountNameAr,
          debitAmount: line.debit.raw,
          creditAmount: line.credit.raw,
        })),
      } : null}
      loading={evidenceBusy}
      error={message || null}
      nextPageAvailable={Boolean(evidence?.nextCursor)}
      onLoadMore={() => evidence?.nextCursor && selectedRow && void openEvidence(selectedRow, evidence.nextCursor)}
      onRetry={() => selectedRow && void openEvidence(selectedRow)}
      onOpenJournal={(eventId) => void openSource(eventId)}
      onBackToOperations={() => { setSource(null); setMessage(''); }}
      onClose={closeDetails}
    />
  </section>;
}

type FinancialReportId = 'trial-balance' | 'accrual-profit-loss' | 'cash-performance';
export function ReportsWorkspaceRuntime({ language, initialReport, onReportChange }: { language: Language; initialReport?: FinancialReportId; onReportChange?: (report: FinancialReportId) => void }) {
  const [report, setReport] = useState<FinancialReportId>(initialReport ?? 'trial-balance');
  useEffect(() => { if (initialReport) setReport(initialReport); }, [initialReport]);
  const changeReport = (value: string) => {
    const next = value as FinancialReportId;
    setReport(next);
    onReportChange?.(next);
  };
  return <section className="reports-workspace"><BaseerWorkspaceTabs ariaLabel={language === 'ar' ? 'التقارير المالية' : 'Financial reports'} idPrefix="financial-report" activeId={report} onChange={changeReport} tabs={[{ id: 'trial-balance', label: language === 'ar' ? 'ميزان المراجعة' : 'Trial Balance' }, { id: 'accrual-profit-loss', label: language === 'ar' ? 'الربح والخسارة' : 'Profit and loss' }, { id: 'cash-performance', label: language === 'ar' ? 'حركة النقد' : 'Cash movement' }]} /><section id={`financial-report-panel-${report}`} role="tabpanel" aria-labelledby={`financial-report-${report}`}>{report === 'trial-balance' ? <Suspense fallback={<section className="reports-prototype__canvas" aria-busy="true" />}><LazyLedgerTrialBalanceWorkspace language={language} /></Suspense> : report === 'accrual-profit-loss' ? <Suspense fallback={<section className="reports-prototype__canvas" aria-busy="true" />}><LazyAccrualProfitLossWorkspace language={language} /></Suspense> : <PersonalCashPerformanceWorkspace language={language} />}</section></section>;
}

function ReportTableRow({ language, row, depth, label, hasChildren, expanded, periodAmounts, periodKeys, onToggle, onOpen, onOpenMonth }: { language: Language; row: ReportRow; depth: number; label: string; hasChildren: boolean; expanded: boolean; periodAmounts: readonly MoneyDisplay[]; periodKeys: readonly string[]; onToggle: () => void; onOpen: () => void; onOpenMonth: (amount: MoneyDisplay, month: string) => void }) {
  const labelButton = <button type="button" className="reports-prototype__row-label-button" onClick={onOpen}>{label}</button>;
  const action = hasChildren
    ? <span className="reports-prototype__row-action"><button type="button" className="reports-prototype__row-button" onClick={onToggle} aria-expanded={expanded} aria-label={label}><span className="reports-prototype__chevron" aria-hidden="true">›</span></button>{labelButton}</span>
    : labelButton;
  return <tr className={`reports-prototype__row reports-prototype__row--${row.kind === 'SECTION' ? 'section' : 'line'} ${row.direction === 'INFLOW' ? 'is-inflow' : 'is-outflow'}`}><th scope="row" style={{ '--report-level': depth - 1 } as React.CSSProperties}>{action}</th>{periodAmounts.map((amount, index) => <PeriodAmountCell key={`${row.code}:${index}`} money={amount} onOpen={() => onOpenMonth(amount, periodKeys[index]!)} />)}<td><MoneyButton money={row.amount} label={label} onClick={onOpen} /></td><SalesShareCell language={language} value={row.shareOfCollectedSalesPercent} /></tr>;
}

function PeriodAmountCell({ money, onOpen }: { money: MoneyDisplay; onOpen: () => void }) { return <td className="reports-prototype__period-column"><MoneyButton money={money} label={money.display} onClick={onOpen} /></td>; }

function SalesShareCell({ language, value }: { language: Language; value: string | null }) {
  const text = copy[language];
  return <td className="reports-prototype__sales-share-column"><bdi className="reports-prototype__sales-share-value" dir="ltr" aria-label={text.salesShare}>{value === null ? '—' : formatPercent(value, language)}</bdi></td>;
}

function reportRowDepth(row: ReportRow, byCode: ReadonlyMap<string, ReportRow>) {
  let depth = 1;
  let parentCode = row.parentCode;
  const seen = new Set<string>();
  while (parentCode && !seen.has(parentCode)) {
    seen.add(parentCode);
    depth += 1;
    parentCode = byCode.get(parentCode)?.parentCode ?? null;
  }
  return depth;
}

function reportRowIsExpanded(row: ReportRow, byCode: ReadonlyMap<string, ReportRow>, expanded: Readonly<Record<string, boolean>>) {
  let parentCode = row.parentCode;
  const seen = new Set<string>();
  while (parentCode && !seen.has(parentCode)) {
    if (expanded[parentCode] === false) return false;
    seen.add(parentCode);
    parentCode = byCode.get(parentCode)?.parentCode ?? null;
  }
  return true;
}

function MoneyButton({ money, label, onClick }: { money: MoneyDisplay; label: string; onClick: () => void }) { return <button type="button" className={`reports-prototype__number${money.sign === 'negative' ? ' is-negative' : ''}`} dir="ltr" aria-label={label} onClick={onClick}>{money.sign === 'negative' ? '−' : ''}{money.display}</button>; }

function EvidenceDetail({ language, text, row, evidence, onOpenSource, onLoadMore }: { language: Language; text: typeof copy[Language]; row: ReportRow; evidence: EvidenceReceipt | null; onOpenSource: (eventId: string) => void; onLoadMore: () => void }) {
  const label = language === 'ar' ? row.labelAr : row.labelEn || row.labelAr;
  return <div className="reports-prototype__detail" dir={language === 'ar' ? 'rtl' : 'ltr'}><div className="reports-prototype__drawer-total"><span>{label}</span><bdi dir="ltr">{row.amount.sign === 'negative' ? '−' : ''}{row.amount.display}</bdi></div><div className="reports-prototype__sales-share"><span>{text.salesShare}</span><bdi dir="ltr">{row.shareOfCollectedSalesPercent ? formatPercent(row.shareOfCollectedSalesPercent, language) : '—'}</bdi></div>{!evidence ? <p>{text.loading}</p> : evidence.items.length ? <><ul className="reports-prototype__source-list">{evidence.items.map((item) => <li key={item.evidenceId}><div><span>{language === 'ar' ? item.source.labelAr : item.source.labelEn}</span>{item.source.counterparty ? <small>{text.counterparty}: {language === 'ar' ? item.source.counterparty.labelAr : item.source.counterparty.labelEn || item.source.counterparty.labelAr}</small> : null}<strong dir="ltr">{item.source.reference}</strong><small dir="ltr">{formatDate(item.businessDate, language)}</small></div><div className="reports-prototype__source-value"><bdi dir="ltr">{item.amount.sign === 'negative' ? '−' : ''}{item.amount.display}</bdi><button type="button" onClick={() => onOpenSource(item.evidenceId)}>{text.openSource} <span aria-hidden="true">‹</span></button></div></li>)}</ul>{evidence.nextCursor ? <BaseerButton type="button" variant="secondary" onClick={onLoadMore}>{text.loadMore}</BaseerButton> : null}</> : <p>{text.noEvidence}</p>}</div>;
}

function SourceJournal({ language, source, onBack }: { language: Language; source: SourceReceipt; onBack: () => void }) {
  const text = copy[language]; const journal = source.journalEntry;
  return <div className="reports-prototype__detail" dir={language === 'ar' ? 'rtl' : 'ltr'}><BaseerButton type="button" variant="secondary" onClick={onBack}>{text.back}</BaseerButton><div className="reports-prototype__source-journal"><p><strong>{language === 'ar' ? journal.labelAr : journal.labelEn || journal.labelAr}</strong> · <bdi dir="ltr">{journal.sourceReference}</bdi> · <bdi dir="ltr">{formatDate(journal.businessDate, language)}</bdi> · {journal.status === 'REVERSED' ? text.statusCancelled : text.statusPosted}</p>{journal.counterparty ? <p><strong>{text.counterparty}:</strong> {language === 'ar' ? journal.counterparty.labelAr : journal.counterparty.labelEn || journal.counterparty.labelAr}</p> : null}{journal.description ? <p>{journal.description}</p> : null}<table data-baseer-report-table="detail"><thead><tr><th>#</th><th>{text.source}</th><th>{text.debit}</th><th>{text.credit}</th></tr></thead><tbody>{journal.lines.map((line) => {
    const debit = line.debit;
    const credit = line.credit;
    return <tr key={line.id}><td><bdi dir="ltr">{formatCount(line.lineNumber, language)}</bdi></td><td>{line.accountCode} · {language === 'ar' ? line.accountNameAr : line.accountNameEn}</td><td dir="ltr">{debit.sign === 'negative' ? '−' : ''}{debit.display}</td><td dir="ltr">{credit.sign === 'negative' ? '−' : ''}{credit.display}</td></tr>;
  })}</tbody></table></div></div>;
}

function financialEvidenceQuery(descriptor: FinancialEvidenceDescriptor | null, scope: Readonly<{ from: string; to: string; months: readonly string[] }>, vatInclusive: boolean, cursor?: string) {
  if (!descriptor) return null;
  const query = new URLSearchParams({ from: scope.from, to: scope.to, vatInclusive: String(vatInclusive), reportCode: descriptor.reportCode, metricKind: descriptor.metric.kind, ...(scope.months.length ? { months: scope.months.join(',') } : {}), ...(cursor ? { cursor } : {}) });
  if (descriptor.reportCode === 'personal_cash_performance') query.set('rowCode', descriptor.metric.rowCode);
  else if (descriptor.metric.kind === 'STATEMENT_LINE') query.set('statementLineId', descriptor.metric.statementLineId);
  return query;
}
