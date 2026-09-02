import { lazy, Suspense, useEffect, useRef, useState, type ComponentProps } from 'react';
import { BaseerButton } from './baseer-button';
import { FinancialEvidenceDialog } from './financial-evidence-dialog';
import { BaseerFilterBar } from './baseer-filter-bar';
import { BaseerFilterToggle } from './baseer-filter-controls';
import { defaultBaseerPeriodRange, iso, riyadhToday, type BaseerPeriodRange } from './baseer-period-values';
import { activeSession, api, type ActiveSession } from './daily-sales-client';
import { DailySalesSignIn } from './daily-sales-sign-in';
import { presentBaseerApiError } from './baseer-api-error';
import { ReportDocumentActions } from './report-document-actions';
import { BaseerCompanyReadQuery } from './baseer-company-read-query';
import { createOfficialReportRun, type OfficialReportRunPurpose } from './report-run-client';
import type { FinancialEvidenceDescriptor } from '@baseer-erp/contracts';

const LazyBaseerPeriodFilter = lazy(async () => ({ default: (await import('./baseer-period-filter')).BaseerPeriodFilter }));
function BaseerPeriodFilter(props: ComponentProps<typeof LazyBaseerPeriodFilter>) { return <Suspense fallback={<span className="baseer-period-filter" aria-busy="true" />}><LazyBaseerPeriodFilter {...props} /></Suspense>; }

type Language = 'ar' | 'en';
type Money = { raw: string; display: string; sign: 'positive' | 'negative' | 'zero' };
type Amounts = { openingDebit: Money; openingCredit: Money; periodDebit: Money; periodCredit: Money; closingDebit: Money; closingCredit: Money };
type TrialEvidence = { openingDebit: FinancialEvidenceDescriptor; openingCredit: FinancialEvidenceDescriptor; periodDebit: FinancialEvidenceDescriptor; periodCredit: FinancialEvidenceDescriptor; closingDebit: FinancialEvidenceDescriptor; closingCredit: FinancialEvidenceDescriptor };
type Row = { accountId: string; code: string; nameAr: string; nameEn: string; type: string; isSystem: boolean; amounts: Amounts; evidence: TrialEvidence };
type ReadyReport = { state: 'READY'; company: { displayName: string; functionalCurrency: string }; selectedPeriod: { from: string; to: string }; economicAsOfDate: string; businessTimezone: string; sourceKindAr: string; basisLabelAr: string; cancellationTreatmentAr: string; roundingRule: string; reconciliation: { messageAr: string }; rows: Row[]; totals: Amounts; totalsEvidence: TrialEvidence };
type Report = ReadyReport | { state: 'NO_DATA' | 'NOT_READY' | 'RANGE_EXCEEDS_INTERACTIVE_LIMIT'; messageAr: string };
type CentralEvidence = { descriptor: FinancialEvidenceDescriptor; nextCursor: string | null; items: Array<{ evidenceId: string; businessDate: string; amount: Money; source: { journalEntryId: string; labelAr: string; labelEn: string; reference: string; description: string | null; counterparty: { labelAr: string; labelEn: string } | null } }> };
type Evidence = CentralEvidence;
type CentralSource = { journalEntry: { businessDate: string; sourceReference: string; labelAr: string; labelEn: string; description: string | null; status: 'POSTED' | 'REVERSED'; counterparty: { labelAr: string; labelEn: string } | null; lines: Array<{ id: string; lineNumber: number; accountCode: string; accountNameAr: string; accountNameEn: string; debit: Money; credit: Money }> } };
type Source = CentralSource;
type Scope = 'OPENING' | 'PERIOD' | 'CLOSING';
type Side = 'DEBIT' | 'CREDIT';

const text = { ar: { title: 'ميزان المراجعة', period: 'الفترة', zero: 'إظهار الحسابات صفرية الرصيد', loading: 'يتم تحميل ميزان المراجعة…', opening: 'رصيد افتتاحي', movement: 'حركة الفترة', closing: 'رصيد ختامي', debit: 'مدين', credit: 'دائن', account: 'الحساب', total: 'إجمالي الدفتر', details: 'دليل الرقم', close: 'إغلاق', source: 'فتح القيد المصدر', back: 'العودة للدليل', more: 'تحميل المزيد', noData: 'لا توجد حسابات مؤهلة ضمن الفترة المحددة.' }, en: { title: 'Trial Balance', period: 'Period', zero: 'Show zero-balance accounts', loading: 'Loading Trial Balance…', opening: 'Opening balance', movement: 'Period movement', closing: 'Closing balance', debit: 'Debit', credit: 'Credit', account: 'Account', total: 'Ledger total', details: 'Amount evidence', close: 'Close', source: 'Open source journal', back: 'Back to evidence', more: 'Load more', noData: 'There are no eligible accounts in the selected period.' } } as const;

export function LedgerTrialBalanceWorkspaceRuntime({ language }: { language: Language }) {
  const [session] = useState<ActiveSession | null>(activeSession);
  const [period, setPeriod] = useState<BaseerPeriodRange>(() => trialBalancePeriod(defaultBaseerPeriodRange()));
  const [includeZeroRows, setIncludeZeroRows] = useState(false);
  if (!session) return <DailySalesSignIn language={language} />;
  return <BaseerCompanyReadQuery session={session} resource="reports.ledger-trial-balance" scope={[language, period.from, period.to, String(includeZeroRows)]} mode="live" load={(current, signal) => api<Report>(current, `/reports/ledger-trial-balance?from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}&includeZeroRows=${includeZeroRows}`, { signal })}>
    {({ data, loading, error, refetch }) => <LedgerTrialBalanceContent language={language} session={session} period={period} setPeriod={setPeriod} includeZeroRows={includeZeroRows} setIncludeZeroRows={setIncludeZeroRows} report={data ?? null} loading={loading} loadError={error} refetch={refetch} />}
  </BaseerCompanyReadQuery>;
}

function LedgerTrialBalanceContent({ language, session, period, setPeriod, includeZeroRows, setIncludeZeroRows, report, loading, loadError, refetch }: { language: Language; session: ActiveSession; period: BaseerPeriodRange; setPeriod: (value: BaseerPeriodRange) => void; includeZeroRows: boolean; setIncludeZeroRows: (value: boolean) => void; report: Report | null; loading: boolean; loadError: unknown; refetch: () => Promise<void> }) {
  const copy = text[language];
  const [message, setMessage] = useState('');
  const [selected, setSelected] = useState<{ row: Row; scope: Scope; side: Side } | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [sourceLineId, setSourceLineId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const readAbort = useRef<AbortController | null>(null);
  const readEpoch = useRef(0);
  useEffect(() => {
    readEpoch.current += 1; readAbort.current?.abort(); setSelected(null); setEvidence(null); setSource(null); setSourceLineId(null); setBusy(false); setMessage('');
    return () => readAbort.current?.abort();
  }, [session.companyId, session.sessionExpiresAt, period.from, period.to, includeZeroRows]);
  const createReportRun = (purpose: OfficialReportRunPurpose = 'evidence') => createOfficialReportRun(session, { reportCode: 'ledger_trial_balance', purpose, request: { from: period.from, to: period.to, includeZeroRows } });
  const openEvidence = async (row: Row, scope: Scope, side: Side, cursor?: string) => {
    if (!report || report.state !== 'READY') return;
    const epoch = ++readEpoch.current; readAbort.current?.abort(); const controller = new AbortController(); readAbort.current = controller;
    if (!cursor) { setSelected({ row, scope, side }); setEvidence(null); setSource(null); setSourceLineId(null); setMessage(''); }
    setBusy(true);
    try {
      const query = new URLSearchParams({ accountId: row.accountId, scope, ...(cursor ? { cursor } : {}) });
      // A central descriptor is authoritative when a newer API emits one.
      // Older report readers retain the frozen-run fallback until their server
      // migration has shipped, so a mixed deployment remains traceable.
      const next = await api<CentralEvidence>(session, `/reports/financial-evidence/live?${financialEvidenceQuery(trialDescriptor(row.evidence, scope, side), period, cursor).toString()}`, { signal: controller.signal });
      if (controller.signal.aborted || epoch !== readEpoch.current || activeSession()?.companyId !== session.companyId || activeSession()?.sessionExpiresAt !== session.sessionExpiresAt) return;
      setEvidence((previous) => cursor && previous && isCentralEvidence(previous) ? { ...next, items: [...previous.items, ...next.items] } : next);
    } catch (error) { if (!controller.signal.aborted) setMessage(presentBaseerApiError(error, language, copy.details)); }
    finally { if (epoch === readEpoch.current) setBusy(false); }
  };
  const openSource = async (lineId: string) => {
    if (!report || report.state !== 'READY' || !selected) return; const epoch = ++readEpoch.current; readAbort.current?.abort(); const controller = new AbortController(); readAbort.current = controller;
    setSourceLineId(lineId); setMessage('');
    setBusy(true);
    try {
      const centralItem = isCentralEvidence(evidence) ? evidence.items.find((item) => item.evidenceId === lineId) : null;
      if (!centralItem) throw new Error(language === 'ar' ? 'تعذر تحديد القيد المصدر لهذا السطر.' : 'The source journal could not be identified for this item.');
      const next = await api<CentralSource>(session, `/reports/financial-evidence/live/source/${centralItem.source.journalEntryId}?${financialEvidenceQuery(trialDescriptor(selected.row.evidence, selected.scope, selected.side), period).toString()}`, { signal: controller.signal });
      if (!controller.signal.aborted && epoch === readEpoch.current && activeSession()?.companyId === session.companyId && activeSession()?.sessionExpiresAt === session.sessionExpiresAt) setSource(next);
    }
    catch (error) { if (!controller.signal.aborted) setMessage(presentBaseerApiError(error, language, copy.source)); }
    finally { if (epoch === readEpoch.current) setBusy(false); }
  };
  const rootMessage = loadError ? presentBaseerApiError(loadError, language, copy.title) : '';
  return <section className="reports-prototype reports-trial-balance" aria-label={copy.title} dir={language === 'ar' ? 'rtl' : 'ltr'}>
    <header className="reports-prototype__intro"><div><h2>{copy.title}</h2></div></header>
    <section className="reports-prototype__canvas is-wide">
      <div className="reports-prototype__toolbar reports-prototype__toolbar--with-actions"><BaseerFilterBar language={language} controls={<><BaseerPeriodFilter language={language} value={period} onChange={(next) => setPeriod(trialBalancePeriod(next))} presets={['DAY', 'MONTH', 'QUARTER', 'YEAR', 'RANGE']} allowNonContiguousMonths={false} /><BaseerFilterToggle label={copy.zero} checked={includeZeroRows} onChange={setIncludeZeroRows} /></>} />{!loading && report?.state === 'READY' ? <ReportDocumentActions session={session} createReportRun={createReportRun} language={language} /> : null}</div>
      {!selected && (message || rootMessage) ? <><p className="reports-prototype__notice is-error">{message || rootMessage}</p><BaseerButton type="button" variant="secondary" onClick={() => { setMessage(''); void refetch().catch(() => undefined); }}>{language === 'ar' ? 'إعادة المحاولة' : 'Retry'}</BaseerButton></> : null}
      {loading ? <p className="reports-prototype__notice">{copy.loading}</p> : null}
      {!loading && report && report.state !== 'READY' ? <p className="reports-prototype__notice is-warning">{report.messageAr || copy.noData}</p> : null}
      {!loading && report?.state === 'READY' ? <TrialTable copy={copy} language={language} rows={report.rows} totals={report.totals} totalsEvidence={report.totalsEvidence} onOpen={openEvidence} /> : null}
    </section>
    <FinancialEvidenceDialog open={selected !== null} language={language} title={selected ? `${scopeLabel(selected.scope, language)} — ${language === 'ar' ? selected.row.nameAr : selected.row.nameEn || selected.row.nameAr}` : copy.details} amount={selected ? amountForScope(selected.row.amounts, selected.scope) : null} operations={selected ? evidence ? evidenceOperations(evidence, language) : null : []} journal={source ? { reference: source.journalEntry.sourceReference, businessDate: source.journalEntry.businessDate, description: sourceDescription(source, language), status: isCentralSource(source) ? source.journalEntry.status : null, lines: source.journalEntry.lines.map((line) => ({ id: line.id, lineNumber: line.lineNumber, accountCode: line.accountCode, accountName: language === 'ar' ? line.accountNameAr : line.accountNameEn || line.accountNameAr, debitAmount: line.debit.raw, creditAmount: line.credit.raw })) } : null} loading={busy} error={message || null} nextPageAvailable={Boolean(evidence?.nextCursor)} onLoadMore={() => evidence?.nextCursor && selected && void openEvidence(selected.row, selected.scope, selected.side, evidence.nextCursor)} onRetry={() => sourceLineId ? void openSource(sourceLineId) : selected && void openEvidence(selected.row, selected.scope, selected.side)} onOpenJournal={(lineId) => void openSource(lineId)} onBackToOperations={() => { setSource(null); setSourceLineId(null); setMessage(''); }} onClose={() => { setSelected(null); setEvidence(null); setSource(null); setSourceLineId(null); setMessage(''); }} />
  </section>;
}

function TrialTable({ copy, language, rows, totals, totalsEvidence, onOpen }: { copy: typeof text.ar | typeof text.en; language: Language; rows: Row[]; totals: Amounts; totalsEvidence: TrialEvidence; onOpen: (row: Row, scope: Scope, side: Side) => void }) {
  const cell = (row: Row, scope: Scope, side: Side, money: Money) => <td><MoneyButton money={money} onClick={() => onOpen(row, scope, side)} /></td>;
  const total = (scope: Scope, side: Side, money: Money) => <td><MoneyButton money={money} onClick={() => onOpen({ accountId: 'ledger-total', code: 'TOTAL', nameAr: copy.total, nameEn: copy.total, type: 'TOTAL', isSystem: true, amounts: totals, evidence: totalsEvidence }, scope, side)} /></td>;
  return <><div className="reports-prototype__table-shell reports-trial-balance__desktop-table"><table data-baseer-report-table="snapshot" className="reports-prototype__table reports-trial-balance__table"><caption>{copy.title}</caption><thead><tr><th scope="col" rowSpan={2}>{copy.account}</th><th scope="colgroup" colSpan={2}>{copy.opening}</th><th scope="colgroup" colSpan={2}>{copy.movement}</th><th scope="colgroup" colSpan={2}>{copy.closing}</th></tr><tr><th scope="col">{copy.debit}</th><th scope="col">{copy.credit}</th><th scope="col">{copy.debit}</th><th scope="col">{copy.credit}</th><th scope="col">{copy.debit}</th><th scope="col">{copy.credit}</th></tr></thead><tbody>{rows.map((row) => <tr className="reports-prototype__row" key={row.accountId}><th scope="row"><bdi dir="ltr">{row.code}</bdi> · {language === 'ar' ? row.nameAr : row.nameEn || row.nameAr}</th>{cell(row, 'OPENING', 'DEBIT', row.amounts.openingDebit)}{cell(row, 'OPENING', 'CREDIT', row.amounts.openingCredit)}{cell(row, 'PERIOD', 'DEBIT', row.amounts.periodDebit)}{cell(row, 'PERIOD', 'CREDIT', row.amounts.periodCredit)}{cell(row, 'CLOSING', 'DEBIT', row.amounts.closingDebit)}{cell(row, 'CLOSING', 'CREDIT', row.amounts.closingCredit)}</tr>)}</tbody><tfoot><tr className="reports-prototype__row--result"><th scope="row">{copy.total}</th>{total('OPENING', 'DEBIT', totals.openingDebit)}{total('OPENING', 'CREDIT', totals.openingCredit)}{total('PERIOD', 'DEBIT', totals.periodDebit)}{total('PERIOD', 'CREDIT', totals.periodCredit)}{total('CLOSING', 'DEBIT', totals.closingDebit)}{total('CLOSING', 'CREDIT', totals.closingCredit)}</tr></tfoot></table></div><TrialBalanceMobileList copy={copy} language={language} rows={rows} totals={totals} totalsEvidence={totalsEvidence} onOpen={onOpen} /></>;
}

function TrialBalanceMobileList({ copy, language, rows, totals, totalsEvidence, onOpen }: { copy: typeof text.ar | typeof text.en; language: Language; rows: Row[]; totals: Amounts; totalsEvidence: TrialEvidence; onOpen: (row: Row, scope: Scope, side: Side) => void }) {
  const groups: Array<{ key: Scope; label: string; debit: keyof Amounts; credit: keyof Amounts }> = [
    { key: 'OPENING', label: copy.opening, debit: 'openingDebit', credit: 'openingCredit' },
    { key: 'PERIOD', label: copy.movement, debit: 'periodDebit', credit: 'periodCredit' },
    { key: 'CLOSING', label: copy.closing, debit: 'closingDebit', credit: 'closingCredit' },
  ];
  const amount = (row: Row, scope: Scope, side: Side, money: Money, label: string) => <div className="reports-trial-balance__mobile-amount"><span>{label}</span><MoneyButton money={money} onClick={() => onOpen(row, scope, side)} /></div>;
  const group = (row: Row, item: typeof groups[number]) => <section className={`reports-trial-balance__mobile-group reports-trial-balance__mobile-group--${item.key.toLowerCase()}`} key={item.key}><h4>{item.label}</h4><div>{amount(row, item.key, 'DEBIT', row.amounts[item.debit], copy.debit)}{amount(row, item.key, 'CREDIT', row.amounts[item.credit], copy.credit)}</div></section>;
  const totalRow: Row = { accountId: 'ledger-total', code: 'TOTAL', nameAr: copy.total, nameEn: copy.total, type: 'TOTAL', isSystem: true, amounts: totals, evidence: totalsEvidence };
  return <section className="reports-trial-balance__mobile-list" aria-label={copy.title}>{rows.map((row) => <article className="reports-trial-balance__mobile-card" key={row.accountId}><header><bdi className="reports-trial-balance__mobile-code" dir="ltr">{row.code}</bdi><strong>{language === 'ar' ? row.nameAr : row.nameEn || row.nameAr}</strong></header><div className="reports-trial-balance__mobile-groups">{groups.map((item) => group(row, item))}</div></article>)}<article className="reports-trial-balance__mobile-card reports-trial-balance__mobile-card--total"><header><strong>{copy.total}</strong></header><div className="reports-trial-balance__mobile-groups">{groups.map((item) => <section className={`reports-trial-balance__mobile-group reports-trial-balance__mobile-group--${item.key.toLowerCase()}`} key={item.key}><h4>{item.label}</h4><div>{amount(totalRow, item.key, 'DEBIT', totals[item.debit], copy.debit)}{amount(totalRow, item.key, 'CREDIT', totals[item.credit], copy.credit)}</div></section>)}</div></article></section>;
}
function MoneyButton({ money, onClick }: { money: Money; onClick: () => void }) { return <button type="button" className="reports-prototype__number" dir="ltr" onClick={onClick}>{money.display}</button>; }
function amountForScope(amounts: Amounts, scope: Scope): Money {
  if (scope === 'OPENING') return nonZeroAmount(amounts.openingDebit, amounts.openingCredit);
  if (scope === 'PERIOD') return nonZeroAmount(amounts.periodDebit, amounts.periodCredit);
  return nonZeroAmount(amounts.closingDebit, amounts.closingCredit);
}
function isCentralEvidence(evidence: Evidence | null): evidence is CentralEvidence { return evidence !== null; }
function isCentralSource(source: Source): source is CentralSource { return true; }
function evidenceOperations(evidence: Evidence, language: Language) {
  return isCentralEvidence(evidence)
    ? evidence.items.map((item) => ({ id: item.evidenceId, kind: language === 'ar' ? item.source.labelAr : item.source.labelEn || item.source.labelAr, counterparty: item.source.counterparty ? (language === 'ar' ? item.source.counterparty.labelAr : item.source.counterparty.labelEn || item.source.counterparty.labelAr) : item.source.description, reference: item.source.reference, businessDate: item.businessDate, amount: item.amount }))
    : [];
}
function sourceDescription(source: Source, language: Language) { if (isCentralSource(source)) { const entry = source.journalEntry; const counterparty = entry.counterparty; if (counterparty) return `${language === 'ar' ? counterparty.labelAr : counterparty.labelEn || counterparty.labelAr}${entry.description ? ` · ${entry.description}` : ''}`; } return source.journalEntry.description; }
function trialDescriptor(evidence: TrialEvidence, scope: Scope, side: Side) { return evidence[scope === 'OPENING' ? side === 'DEBIT' ? 'openingDebit' : 'openingCredit' : scope === 'PERIOD' ? side === 'DEBIT' ? 'periodDebit' : 'periodCredit' : side === 'DEBIT' ? 'closingDebit' : 'closingCredit']; }
function financialEvidenceQuery(descriptor: FinancialEvidenceDescriptor, period: BaseerPeriodRange, cursor?: string) { const query = new URLSearchParams({ from: period.from, to: period.to, vatInclusive: 'true', reportCode: descriptor.reportCode, metricKind: descriptor.metric.kind, ...(period.preset === 'MONTH' && period.months.length > 1 ? { months: period.months.join(',') } : {}), ...(cursor ? { cursor } : {}) }); if (descriptor.reportCode === 'personal_cash_performance') query.set('rowCode', descriptor.metric.rowCode); else if (descriptor.reportCode === 'ledger_trial_balance') { query.set('scope', descriptor.metric.scope); query.set('side', descriptor.metric.side); if (descriptor.metric.kind === 'TRIAL_ACCOUNT') query.set('accountId', descriptor.metric.accountId); } else if (descriptor.metric.kind === 'STATEMENT_LINE') query.set('statementLineId', descriptor.metric.statementLineId); return query; }
function nonZeroAmount(debit: Money, credit: Money): Money { return debit.sign !== 'zero' ? debit : credit; }
function scopeLabel(scope: Scope, language: Language) { return language === 'ar' ? scope === 'OPENING' ? 'دليل الرصيد الافتتاحي' : scope === 'PERIOD' ? 'دليل حركة الفترة' : 'دليل الرصيد الختامي' : scope === 'OPENING' ? 'Opening balance evidence' : scope === 'PERIOD' ? 'Period movement evidence' : 'Closing balance evidence'; }

/** A report may never silently query future business dates. The current month
 * therefore opens through today's Riyadh date; completed months keep their
 * full calendar range. */
function trialBalancePeriod(value: BaseerPeriodRange): BaseerPeriodRange {
  const today = riyadhToday();
  const todayText = iso(today.year, today.month, today.day);
  return value.preset === 'MONTH' && value.from.slice(0, 7) === todayText.slice(0, 7)
    ? { ...value, to: todayText }
    : value;
}
