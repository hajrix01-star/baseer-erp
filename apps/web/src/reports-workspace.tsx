import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';

import { BaseerButton } from './baseer-button';
import { BaseerDialog } from './baseer-dialog';
import { BaseerFilterBar } from './baseer-filter-bar';
import { BaseerFilterToggle } from './baseer-filter-controls';
import { BaseerWorkspaceTabs } from './baseer-batch-layout';
import { defaultBaseerPeriodRange, iso, riyadhToday, type BaseerPeriodRange } from './baseer-period-values';
import { ReportDocumentActions } from './report-document-actions';
import { DailySalesSignIn } from './daily-sales-sign-in';
import { activeSession, api, type ActiveSession } from './daily-sales-client';
import { presentBaseerApiError } from './baseer-api-error';
import { BaseerCompanyReadQuery } from './baseer-company-read-query';
import { formatCount, formatDate, formatMoney, formatPercent } from './number-format';
import './reports-workspace.css';

const LazyBaseerPeriodFilter = lazy(async () => ({ default: (await import('./baseer-period-filter')).BaseerPeriodFilter }));
const LazyLedgerTrialBalanceWorkspace = lazy(async () => ({ default: (await import('./ledger-trial-balance-workspace')).LedgerTrialBalanceWorkspace }));
function BaseerPeriodFilter(props: ComponentProps<typeof LazyBaseerPeriodFilter>) { return <Suspense fallback={<span className="baseer-period-filter" aria-busy="true" />}><LazyBaseerPeriodFilter {...props} /></Suspense>; }

type Language = 'ar' | 'en';
type MoneyDisplay = Readonly<{ raw: string; display: string; sign: 'positive' | 'negative' | 'zero' }>;
type ReportRow = Readonly<{ code: string; labelAr: string; labelEn: string; kind: 'SECTION' | 'LINE'; parentCode: string | null; direction: 'INFLOW' | 'OUTFLOW'; eventCount: number; amount: MoneyDisplay; shareOfCollectedSalesPercent: string | null }>;
type ReportTotals = Readonly<{ inflows: MoneyDisplay; outflows: MoneyDisplay; netCashResult: MoneyDisplay; netCashResultShareOfCollectedSalesPercent: string | null }>;
type ReportMetadata = Readonly<{ reportRunId: string; selectedPeriod: { from: string; to: string; months?: readonly string[] }; basisLabelAr: string; company: { displayName: string; functionalCurrency: string } }>;
type ReportResult =
  | Readonly<{ state: 'NOT_READY'; messageAr: string }>
  | Readonly<{ state: 'COVERAGE_INCOMPLETE'; messageAr: string; coverageStartBusinessDate?: string }>
  | (ReportMetadata & Readonly<{ state: 'NO_DATA'; messageAr: string; rows: readonly []; totals: ReportTotals }> )
  | (ReportMetadata & Readonly<{ state: 'READY'; rows: readonly ReportRow[]; totals: ReportTotals }>);
type EvidenceItem = Readonly<{ eventId: string; businessDate: string; direction: 'INFLOW' | 'OUTFLOW'; amount: MoneyDisplay; source: { journalEntryId: string; labelAr: string; labelEn: string; reference: string } }>;
type EvidenceReceipt = Readonly<{ reportRunId: string; rowCode: string; nextCursor: string | null; items: readonly EvidenceItem[] }>;
type SourceReceipt = Readonly<{ journalEntry: { id: string; businessDate: string; sourceReference: string; description: string | null; status: 'POSTED' | 'REVERSED'; lines: readonly { id: string; lineNumber: number; accountCode: string; accountNameAr: string; accountNameEn: string; debitAmount: string; creditAmount: string }[] } }>;

const copy = {
  ar: {
    title: 'الربح والخسارة المالي', amount: 'المبلغ', gross: 'شامل الضريبة', period: 'الفترة', loading: 'يتم تحميل التقرير…', details: 'تفصيل الرقم', close: 'إغلاق', source: 'المصدر', openSource: 'فتح القيد المصدر', back: 'العودة للتفصيل', loadMore: 'تحميل المزيد',
    salesShare: 'نسبة البند من المبيعات المحصّلة', noEvidence: 'لا توجد عمليات مصدر لهذا البند ضمن نتيجة التقرير المجمدة.', sourceJournal: 'القيد المصدر', debit: 'مدين', credit: 'دائن', statusCancelled: 'ملغى', statusPosted: 'مثبت', noData: 'لا توجد حركات مؤهلة ضمن الفترة المحددة.', retry: 'إعادة المحاولة', showCoveredPeriod: 'عرض الفترة المؤهلة', displayLevel: 'مستوى العرض', twoLevels: 'مستويان', threeLevels: 'ثلاثة مستويات',
  },
  en: {
    title: 'Financial profit and loss', amount: 'Amount', gross: 'VAT inclusive', period: 'Period', loading: 'Loading report…', details: 'Amount details', close: 'Close', source: 'Source', openSource: 'Open source journal', back: 'Back to details', loadMore: 'Load more',
    salesShare: 'Share of collected sales', noEvidence: 'There are no source operations for this line in the frozen report result.', sourceJournal: 'Source journal', debit: 'Debit', credit: 'Credit', statusCancelled: 'Cancelled', statusPosted: 'Posted', noData: 'There are no eligible movements in the selected period.', retry: 'Retry', showCoveredPeriod: 'Show covered period', displayLevel: 'Display level', twoLevels: 'Two levels', threeLevels: 'Three levels',
  },
} as const;

function PersonalCashPerformanceWorkspace({ language }: { language: Language }) {
  const [session] = useState<ActiveSession | null>(activeSession);
  const [period, setPeriod] = useState<BaseerPeriodRange>(defaultBaseerPeriodRange);
  const [vatInclusive, setVatInclusive] = useState(true);
  if (!session) return <DailySalesSignIn language={language} />;
  const query = new URLSearchParams({ from: period.from, to: period.to, vatInclusive: String(vatInclusive) });
  if (period.preset === 'MONTH' && period.months.length > 1) query.set('months', period.months.join(','));
  return <BaseerCompanyReadQuery session={session} resource="reports.personal-cash-performance" scope={[language, period.preset, period.from, period.to, period.months.join(','), String(vatInclusive)]} mode="snapshot" load={(current, signal) => api<ReportResult>(current, `/reports/personal-cash-performance?${query.toString()}`, { signal })}>
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
  const readAbort = useRef<AbortController | null>(null);
  const readEpoch = useRef(0);
  const runId = report?.state === 'READY' ? report.reportRunId : '';
  useEffect(() => {
    readEpoch.current += 1;
    readAbort.current?.abort();
    setSelectedRow(null); setEvidence(null); setSource(null); setEvidenceBusy(false); setMessage('');
    return () => readAbort.current?.abort();
  }, [session.companyId, session.sessionExpiresAt, period.from, period.to, period.months, vatInclusive, runId]);

  const rows = report?.state === 'READY' ? report.rows : [];
  const netResultRow: ReportRow | null = report?.state === 'READY' ? {
    code: 'net_cash_result', labelAr: 'صافي الربح والخسارة المالي', labelEn: 'Net financial profit and loss', kind: 'SECTION', parentCode: null,
    direction: report.totals.netCashResult.sign === 'negative' ? 'OUTFLOW' : 'INFLOW', eventCount: 0, amount: report.totals.netCashResult,
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
  const openEvidence = async (row: ReportRow, cursor?: string) => {
    if (!report || report.state !== 'READY') return;
    const epoch = ++readEpoch.current; readAbort.current?.abort(); const controller = new AbortController(); readAbort.current = controller;
    if (!cursor) { setSelectedRow(row); setEvidence(null); setSource(null); }
    setEvidenceBusy(true);
    try {
      const query = new URLSearchParams({ rowCode: row.code, ...(cursor ? { cursor } : {}) });
      const next = await api<EvidenceReceipt>(session, `/reports/personal-cash-performance/${report.reportRunId}/evidence?${query.toString()}`, { signal: controller.signal });
      if (controller.signal.aborted || epoch !== readEpoch.current || activeSession()?.companyId !== session.companyId || activeSession()?.sessionExpiresAt !== session.sessionExpiresAt) return;
      setEvidence((previous) => cursor && previous ? { ...next, items: [...previous.items, ...next.items] } : next);
    } catch (error) { if (!controller.signal.aborted) setMessage(presentBaseerApiError(error, language, text.details)); }
    finally { if (epoch === readEpoch.current) setEvidenceBusy(false); }
  };
  const openSource = async (eventId: string) => {
    if (!report || report.state !== 'READY') return;
    const epoch = ++readEpoch.current; readAbort.current?.abort(); const controller = new AbortController(); readAbort.current = controller;
    setEvidenceBusy(true);
    try { const next = await api<SourceReceipt>(session, `/reports/personal-cash-performance/${report.reportRunId}/evidence/${eventId}/source`, { signal: controller.signal }); if (!controller.signal.aborted && epoch === readEpoch.current && activeSession()?.companyId === session.companyId && activeSession()?.sessionExpiresAt === session.sessionExpiresAt) setSource(next); }
    catch (error) { if (!controller.signal.aborted) setMessage(presentBaseerApiError(error, language, text.source)); }
    finally { if (epoch === readEpoch.current) setEvidenceBusy(false); }
  };
  const closeDetails = () => { setSelectedRow(null); setEvidence(null); setSource(null); };
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
        {!loading && report?.state === 'READY' ? <ReportDocumentActions session={session} reportRunId={report.reportRunId} language={language} /> : null}
      </div>
      {message || rootMessage ? <p className="reports-prototype__notice is-error">{message || rootMessage}</p> : null}
      {message || rootMessage ? <div className="reports-prototype__retry"><BaseerButton type="button" variant="secondary" onClick={() => { setMessage(''); void refetch().catch(() => undefined); }}>{text.retry}</BaseerButton></div> : null}
      {loading ? <p className="reports-prototype__notice">{text.loading}</p> : null}
      {!loading && report && report.state !== 'READY' ? <p className={`reports-prototype__notice${report.state === 'NO_DATA' ? '' : ' is-warning'}`}>{report.messageAr || text.noData}</p> : null}
      {!loading && report?.state === 'COVERAGE_INCOMPLETE' && report.coverageStartBusinessDate ? <div className="reports-prototype__coverage-action"><BaseerButton type="button" variant="secondary" onClick={useCoveredPeriod}>{text.showCoveredPeriod}</BaseerButton></div> : null}
      {!loading && report?.state === 'READY' ? <div className="reports-prototype__table-shell"><table data-baseer-report-table="snapshot" className="reports-prototype__table"><caption>{text.title}</caption><thead><tr><th scope="col">{text.title}</th><th scope="col" className="reports-prototype__amount">{text.amount}</th></tr></thead><tbody>
        {hierarchy.visible.map((row) => <ReportTableRow key={row.code} language={language} row={row} depth={hierarchy.depthFor(row)} label={label(row)} hasChildren={hasChildren(row)} expanded={expanded[row.code] !== false} onToggle={() => setExpanded((current) => ({ ...current, [row.code]: !(current[row.code] !== false) }))} onOpen={() => void openEvidence(row)} />)}
        {netResultRow ? <tr className="reports-prototype__row reports-prototype__row--result"><th scope="row">{label(netResultRow)}</th><td><MoneyButton language={language} money={netResultRow.amount} label={label(netResultRow)} onClick={() => void openEvidence(netResultRow)} /></td></tr> : null}
      </tbody></table></div> : null}
    </section>
    <BaseerDialog open={selectedRow !== null} size="wide" language={language} title={source ? text.sourceJournal : selectedRow ? `${text.details} — ${label(selectedRow)}` : text.details} busy={evidenceBusy} onClose={closeDetails} footer={<BaseerButton type="button" onClick={closeDetails}>{text.close}</BaseerButton>}>
      {source ? <SourceJournal language={language} source={source} onBack={() => setSource(null)} /> : selectedRow ? <EvidenceDetail language={language} text={text} row={selectedRow} evidence={evidence} onOpenSource={openSource} onLoadMore={() => evidence?.nextCursor && void openEvidence(selectedRow, evidence.nextCursor)} /> : null}
    </BaseerDialog>
  </section>;
}

export function ReportsWorkspace({ language, initialReport }: { language: Language; initialReport?: 'trial-balance' | 'cash-performance' }) {
  const [report, setReport] = useState<'trial-balance' | 'cash-performance'>(initialReport ?? 'trial-balance');
  useEffect(() => { if (initialReport) setReport(initialReport); }, [initialReport]);
  return <section className="reports-workspace"><BaseerWorkspaceTabs ariaLabel={language === 'ar' ? 'التقارير المالية' : 'Financial reports'} idPrefix="financial-report" activeId={report} onChange={(value) => setReport(value as 'trial-balance' | 'cash-performance')} tabs={[{ id: 'trial-balance', label: language === 'ar' ? 'ميزان المراجعة' : 'Trial Balance' }, { id: 'cash-performance', label: language === 'ar' ? 'الربح والخسارة المالي' : 'Financial profit and loss' }]} />{report === 'trial-balance' ? <Suspense fallback={<section className="reports-prototype__canvas" aria-busy="true" />}><LazyLedgerTrialBalanceWorkspace language={language} /></Suspense> : <PersonalCashPerformanceWorkspace language={language} />}</section>;
}

function ReportTableRow({ language, row, depth, label, hasChildren, expanded, onToggle, onOpen }: { language: Language; row: ReportRow; depth: number; label: string; hasChildren: boolean; expanded: boolean; onToggle: () => void; onOpen: () => void }) {
  const labelButton = <button type="button" className="reports-prototype__row-label-button" onClick={onOpen}>{label}</button>;
  const action = hasChildren
    ? <span className="reports-prototype__row-action"><button type="button" className="reports-prototype__row-button" onClick={onToggle} aria-expanded={expanded} aria-label={label}><span className="reports-prototype__chevron" aria-hidden="true">›</span></button>{labelButton}</span>
    : labelButton;
  return <tr className={`reports-prototype__row reports-prototype__row--${row.kind === 'SECTION' ? 'section' : 'line'} ${row.direction === 'INFLOW' ? 'is-inflow' : 'is-outflow'}`}><th scope="row" style={{ '--report-level': depth - 1 } as React.CSSProperties}>{action}</th><td><MoneyButton language={language} money={row.amount} label={label} onClick={onOpen} /></td></tr>;
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

function MoneyButton({ language, money, label, onClick }: { language: Language; money: MoneyDisplay; label: string; onClick: () => void }) { return <button type="button" className={`reports-prototype__number${money.sign === 'negative' ? ' is-negative' : ''}`} dir="ltr" aria-label={label} onClick={onClick}>{money.sign === 'negative' ? '−' : ''}{formatMoney(Math.abs(Number(money.raw)), 'SAR', language)}</button>; }

function EvidenceDetail({ language, text, row, evidence, onOpenSource, onLoadMore }: { language: Language; text: typeof copy[Language]; row: ReportRow; evidence: EvidenceReceipt | null; onOpenSource: (eventId: string) => void; onLoadMore: () => void }) {
  const label = language === 'ar' ? row.labelAr : row.labelEn || row.labelAr;
  return <div className="reports-prototype__detail" dir={language === 'ar' ? 'rtl' : 'ltr'}><div className="reports-prototype__drawer-total"><span>{label}</span><bdi dir="ltr">{row.amount.sign === 'negative' ? '−' : ''}{formatMoney(Math.abs(Number(row.amount.raw)), 'SAR', language)}</bdi></div><div className="reports-prototype__sales-share"><span>{text.salesShare}</span><bdi dir="ltr">{row.shareOfCollectedSalesPercent ? formatPercent(row.shareOfCollectedSalesPercent, 2, language) : '—'}</bdi></div>{!evidence ? <p>{text.loading}</p> : evidence.items.length ? <><ul className="reports-prototype__source-list">{evidence.items.map((item) => <li key={item.eventId}><div><span>{language === 'ar' ? item.source.labelAr : item.source.labelEn}</span><strong dir="ltr">{item.source.reference}</strong><small dir="ltr">{formatDate(item.businessDate, language)}</small></div><div className="reports-prototype__source-value"><bdi dir="ltr">{item.amount.sign === 'negative' ? '−' : ''}{formatMoney(Math.abs(Number(item.amount.raw)), 'SAR', language)}</bdi><button type="button" onClick={() => onOpenSource(item.eventId)}>{text.openSource} <span aria-hidden="true">‹</span></button></div></li>)}</ul>{evidence.nextCursor ? <BaseerButton type="button" variant="secondary" onClick={onLoadMore}>{text.loadMore}</BaseerButton> : null}</> : <p>{text.noEvidence}</p>}</div>;
}

function SourceJournal({ language, source, onBack }: { language: Language; source: SourceReceipt; onBack: () => void }) {
  const text = copy[language]; const journal = source.journalEntry;
  return <div className="reports-prototype__detail" dir={language === 'ar' ? 'rtl' : 'ltr'}><BaseerButton type="button" variant="secondary" onClick={onBack}>{text.back}</BaseerButton><div className="reports-prototype__source-journal"><p><strong dir="ltr">{journal.sourceReference}</strong> · <bdi dir="ltr">{formatDate(journal.businessDate, language)}</bdi> · {journal.status === 'REVERSED' ? text.statusCancelled : text.statusPosted}</p>{journal.description ? <p>{journal.description}</p> : null}<table data-baseer-report-table="detail"><thead><tr><th>#</th><th>{text.source}</th><th>{text.debit}</th><th>{text.credit}</th></tr></thead><tbody>{journal.lines.map((line) => <tr key={line.id}><td><bdi dir="ltr">{formatCount(line.lineNumber, language)}</bdi></td><td>{line.accountCode} · {language === 'ar' ? line.accountNameAr : line.accountNameEn}</td><td dir="ltr">{formatMoney(line.debitAmount, 'SAR', language)}</td><td dir="ltr">{formatMoney(line.creditAmount, 'SAR', language)}</td></tr>)}</tbody></table></div></div>;
}
