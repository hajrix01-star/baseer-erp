import { lazy, Suspense, useCallback, useEffect, useState, type ComponentProps } from 'react';
import { BaseerButton } from './baseer-button';
import { BaseerDialog } from './baseer-dialog';
import { BaseerFilterBar } from './baseer-filter-bar';
import { BaseerFilterToggle } from './baseer-filter-controls';
import { defaultBaseerPeriodRange, iso, riyadhToday, type BaseerPeriodRange } from './baseer-period-values';
import { activeSession, api, type ActiveSession } from './daily-sales-client';
import { DailySalesSignIn } from './daily-sales-sign-in';
import { presentBaseerApiError } from './baseer-api-error';
import { ReportDocumentActions } from './report-document-actions';

const LazyBaseerPeriodFilter = lazy(async () => ({ default: (await import('./baseer-period-filter')).BaseerPeriodFilter }));
function BaseerPeriodFilter(props: ComponentProps<typeof LazyBaseerPeriodFilter>) { return <Suspense fallback={<span className="baseer-period-filter" aria-busy="true" />}><LazyBaseerPeriodFilter {...props} /></Suspense>; }

type Language = 'ar' | 'en';
type Money = { raw: string; display: string; sign: 'positive' | 'negative' | 'zero' };
type Amounts = { openingDebit: Money; openingCredit: Money; periodDebit: Money; periodCredit: Money; closingDebit: Money; closingCredit: Money };
type Row = { accountId: string; code: string; nameAr: string; nameEn: string; type: string; isSystem: boolean; amounts: Amounts };
type ReadyReport = { state: 'READY'; reportRunId: string; company: { displayName: string; functionalCurrency: string }; selectedPeriod: { from: string; to: string }; economicAsOfDate: string; businessTimezone: string; sourceKindAr: string; basisLabelAr: string; cancellationTreatmentAr: string; roundingRule: string; reconciliation: { messageAr: string }; rows: Row[]; totals: Amounts };
type Report = ReadyReport | { state: 'NO_DATA' | 'NOT_READY' | 'RANGE_EXCEEDS_INTERACTIVE_LIMIT'; messageAr: string };
type Evidence = { reportRunId: string; accountId: string; scope: 'OPENING' | 'PERIOD' | 'CLOSING'; nextCursor: string | null; items: Array<{ lineId: string; businessDate: string; reference: string; labelAr: string; labelEn: string; description: string | null; debit: Money; credit: Money; cancellationLabelAr: string | null }> };
type Source = { journalEntry: { businessDate: string; sourceReference: string; labelAr: string; labelEn: string; description: string | null; cancellationLabelAr: string | null; lines: Array<{ id: string; lineNumber: number; accountCode: string; accountNameAr: string; accountNameEn: string; debit: Money; credit: Money }> } };
type Scope = Evidence['scope'];

const text = { ar: { title: 'ميزان المراجعة', period: 'الفترة', zero: 'إظهار الحسابات صفرية الرصيد', loading: 'يتم تحميل ميزان المراجعة…', opening: 'رصيد افتتاحي', movement: 'حركة الفترة', closing: 'رصيد ختامي', debit: 'مدين', credit: 'دائن', account: 'الحساب', total: 'إجمالي الدفتر', details: 'دليل الرقم', close: 'إغلاق', source: 'فتح القيد المصدر', back: 'العودة للدليل', more: 'تحميل المزيد', noData: 'لا توجد حسابات مؤهلة ضمن الفترة المحددة.' }, en: { title: 'Trial Balance', period: 'Period', zero: 'Show zero-balance accounts', loading: 'Loading Trial Balance…', opening: 'Opening balance', movement: 'Period movement', closing: 'Closing balance', debit: 'Debit', credit: 'Credit', account: 'Account', total: 'Ledger total', details: 'Amount evidence', close: 'Close', source: 'Open source journal', back: 'Back to evidence', more: 'Load more', noData: 'There are no eligible accounts in the selected period.' } } as const;

export function LedgerTrialBalanceWorkspace({ language }: { language: Language }) {
  const copy = text[language];
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [period, setPeriod] = useState<BaseerPeriodRange>(() => trialBalancePeriod(defaultBaseerPeriodRange()));
  const [includeZeroRows, setIncludeZeroRows] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ row: Row; scope: Scope } | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const current = activeSession(); setSession(current); if (!current) { setLoading(false); return; }
    setLoading(true); setMessage('');
    try { setReport(await api<Report>(current, `/reports/ledger-trial-balance?from=${encodeURIComponent(period.from)}&to=${encodeURIComponent(period.to)}&includeZeroRows=${includeZeroRows}`)); }
    catch (error) { setReport(null); setMessage(presentBaseerApiError(error, language, copy.title)); }
    finally { setLoading(false); }
  }, [copy.title, includeZeroRows, language, period.from, period.to]);
  useEffect(() => { void load(); }, [load]);
  const openEvidence = async (row: Row, scope: Scope, cursor?: string) => {
    if (!report || report.state !== 'READY') return;
    const current = activeSession(); if (!current) return;
    if (!cursor) { setSelected({ row, scope }); setEvidence(null); setSource(null); }
    setBusy(true);
    try {
      const query = new URLSearchParams({ accountId: row.accountId, scope, ...(cursor ? { cursor } : {}) });
      const next = await api<Evidence>(current, `/reports/ledger-trial-balance/${report.reportRunId}/evidence?${query}`);
      setEvidence((previous) => cursor && previous ? { ...next, items: [...previous.items, ...next.items] } : next);
    } catch (error) { setMessage(presentBaseerApiError(error, language, copy.details)); }
    finally { setBusy(false); }
  };
  const openSource = async (lineId: string) => {
    if (!report || report.state !== 'READY' || !selected) return; const current = activeSession(); if (!current) return;
    setBusy(true);
    try { setSource(await api<Source>(current, `/reports/ledger-trial-balance/${report.reportRunId}/evidence/${lineId}/source?${new URLSearchParams({ accountId: selected.row.accountId, scope: selected.scope })}`)); }
    catch (error) { setMessage(presentBaseerApiError(error, language, copy.source)); }
    finally { setBusy(false); }
  };
  if (!session) return <DailySalesSignIn language={language} />;
  return <section className="reports-prototype reports-trial-balance" aria-label={copy.title} dir={language === 'ar' ? 'rtl' : 'ltr'}>
    <header className="reports-prototype__intro"><div><h2>{copy.title}</h2></div></header>
    <section className="reports-prototype__canvas is-wide">
      <div className="reports-prototype__toolbar reports-prototype__toolbar--with-actions"><BaseerFilterBar language={language} controls={<><BaseerPeriodFilter language={language} value={period} onChange={(next) => setPeriod(trialBalancePeriod(next))} presets={['MONTH', 'QUARTER', 'YEAR', 'RANGE']} allowNonContiguousMonths={false} /><BaseerFilterToggle label={copy.zero} checked={includeZeroRows} onChange={setIncludeZeroRows} /></>} />{!loading && report?.state === 'READY' ? <ReportDocumentActions session={session} reportRunId={report.reportRunId} language={language} /> : null}</div>
      {message ? <p className="reports-prototype__notice is-error">{message}</p> : null}
      {loading ? <p className="reports-prototype__notice">{copy.loading}</p> : null}
      {!loading && report && report.state !== 'READY' ? <p className="reports-prototype__notice is-warning">{report.messageAr || copy.noData}</p> : null}
      {!loading && report?.state === 'READY' ? <TrialTable copy={copy} language={language} rows={report.rows} totals={report.totals} onOpen={openEvidence} /> : null}
    </section>
    <BaseerDialog open={selected !== null} size="wide" language={language} title={source ? copy.source : selected ? `${scopeLabel(selected.scope, language)} — ${language === 'ar' ? selected.row.nameAr : selected.row.nameEn || selected.row.nameAr}` : copy.details} busy={busy} onClose={() => { setSelected(null); setEvidence(null); setSource(null); }}>
      {source ? <SourceView language={language} source={source} onBack={() => setSource(null)} label={copy.back} /> : selected ? <EvidenceView language={language} copy={copy} evidence={evidence} onSource={openSource} onMore={() => evidence?.nextCursor && void openEvidence(selected.row, selected.scope, evidence.nextCursor)} /> : null}
    </BaseerDialog>
  </section>;
}

function TrialTable({ copy, language, rows, totals, onOpen }: { copy: typeof text.ar | typeof text.en; language: Language; rows: Row[]; totals: Amounts; onOpen: (row: Row, scope: Scope) => void }) {
  const cell = (row: Row, scope: Scope, money: Money) => <td><MoneyButton money={money} onClick={() => onOpen(row, scope)} /></td>;
  const total = (money: Money) => <td><span className="reports-prototype__number" dir="ltr">{money.display}</span></td>;
  return <div className="reports-prototype__table-shell"><table className="reports-prototype__table reports-trial-balance__table"><caption>{copy.title}</caption><thead><tr><th scope="col" rowSpan={2}>{copy.account}</th><th scope="colgroup" colSpan={2}>{copy.opening}</th><th scope="colgroup" colSpan={2}>{copy.movement}</th><th scope="colgroup" colSpan={2}>{copy.closing}</th></tr><tr><th scope="col">{copy.debit}</th><th scope="col">{copy.credit}</th><th scope="col">{copy.debit}</th><th scope="col">{copy.credit}</th><th scope="col">{copy.debit}</th><th scope="col">{copy.credit}</th></tr></thead><tbody>{rows.map((row) => <tr className="reports-prototype__row" key={row.accountId}><th scope="row"><bdi dir="ltr">{row.code}</bdi> · {language === 'ar' ? row.nameAr : row.nameEn || row.nameAr}</th>{cell(row, 'OPENING', row.amounts.openingDebit)}{cell(row, 'OPENING', row.amounts.openingCredit)}{cell(row, 'PERIOD', row.amounts.periodDebit)}{cell(row, 'PERIOD', row.amounts.periodCredit)}{cell(row, 'CLOSING', row.amounts.closingDebit)}{cell(row, 'CLOSING', row.amounts.closingCredit)}</tr>)}</tbody><tfoot><tr className="reports-prototype__row--result"><th scope="row">{copy.total}</th>{total(totals.openingDebit)}{total(totals.openingCredit)}{total(totals.periodDebit)}{total(totals.periodCredit)}{total(totals.closingDebit)}{total(totals.closingCredit)}</tr></tfoot></table></div>;
}
function MoneyButton({ money, onClick }: { money: Money; onClick: () => void }) { return money.sign === 'zero' ? <span className="reports-prototype__number" dir="ltr">{money.display}</span> : <button type="button" className="reports-prototype__number" dir="ltr" onClick={onClick}>{money.display}</button>; }
function EvidenceView({ language, copy, evidence, onSource, onMore }: { language: Language; copy: typeof text.ar | typeof text.en; evidence: Evidence | null; onSource: (lineId: string) => void; onMore: () => void }) { return evidence ? <div className="reports-prototype__detail"><ul className="reports-prototype__source-list">{evidence.items.map((item) => <li key={item.lineId}><div><span>{item.businessDate}</span><strong>{language === 'ar' ? item.labelAr : item.labelEn}</strong><small>{item.reference}{item.cancellationLabelAr ? ` · ${item.cancellationLabelAr}` : ''}{item.description ? ` · ${item.description}` : ''}</small></div><div className="reports-prototype__source-value"><bdi dir="ltr">{item.debit.display} / {item.credit.display}</bdi><button type="button" onClick={() => onSource(item.lineId)}>{copy.source}</button></div></li>)}</ul>{evidence.nextCursor ? <BaseerButton type="button" variant="secondary" onClick={onMore}>{copy.more}</BaseerButton> : null}</div> : <p>{language === 'ar' ? 'يتم تحميل الدليل…' : 'Loading evidence…'}</p>; }
function SourceView({ language, source, onBack, label }: { language: Language; source: Source; onBack: () => void; label: string }) { const ar = language === 'ar'; return <div className="reports-prototype__source-journal"><BaseerButton type="button" variant="secondary" onClick={onBack}>{label}</BaseerButton><p>{source.journalEntry.businessDate} · {ar ? source.journalEntry.labelAr : source.journalEntry.labelEn} · {source.journalEntry.sourceReference}{source.journalEntry.description ? ` · ${source.journalEntry.description}` : ''}</p><table><thead><tr><th>#</th><th>{ar ? 'الحساب' : 'Account'}</th><th>{ar ? 'مدين' : 'Debit'}</th><th>{ar ? 'دائن' : 'Credit'}</th></tr></thead><tbody>{source.journalEntry.lines.map((line) => <tr key={line.id}><td>{line.lineNumber}</td><td>{line.accountCode} · {ar ? line.accountNameAr : line.accountNameEn}</td><td dir="ltr">{line.debit.display}</td><td dir="ltr">{line.credit.display}</td></tr>)}</tbody></table></div>; }
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
