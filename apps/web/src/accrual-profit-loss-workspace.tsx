import { useState } from 'react';

import { BaseerButton } from './baseer-button';
import { BaseerCompanyReadQuery } from './baseer-company-read-query';
import { FinancialEvidenceDialog } from './financial-evidence-dialog';
import { BaseerFilterBar } from './baseer-filter-bar';
import { BaseerFilterToggle } from './baseer-filter-controls';
import { BaseerPeriodFilter } from './baseer-period-filter';
import { defaultBaseerPeriodRange, type BaseerPeriodRange } from './baseer-period-values';
import { DailySalesSignIn } from './daily-sales-sign-in';
import { activeSession, api, type ActiveSession } from './daily-sales-client';
import { presentBaseerApiError } from './baseer-api-error';
import { ReportDocumentActions } from './report-document-actions';
import { createOfficialReportRun, type OfficialReportRunPurpose } from './report-run-client';
import { formatCount, formatDate, formatMoney, formatMonthYear, formatPercent } from './number-format';
import type { FinancialEvidenceDescriptor } from '@baseer-erp/contracts';

type Language = 'ar' | 'en';
type Money = Readonly<{ raw: string; display: string; sign: 'positive' | 'negative' | 'zero' }>;
type Row = Readonly<{ statementLineId: string; code: string; nameAr: string; nameEn: string; section: 'REVENUE' | 'EXPENSE'; amount: Money; shareOfRevenuePercent: string | null; evidence: FinancialEvidenceDescriptor }>;
type Coverage = Readonly<{ state: 'COMPLETE' | 'APPROVED_HISTORICAL_EXCEPTION'; warningAr: string | null }>;
type SalesByVault = Readonly<{
  grossTotal: Money;
  netTotal: Money;
  vatTotal: Money;
  displayedTotal: Money;
  shareOfRevenuePercent: string | null;
  evidence: FinancialEvidenceDescriptor;
  rows: readonly Readonly<{ vaultId: string; vaultNameAr: string; vaultNameEn: string; eventCount: number; displayedAmount: Money; shareOfRevenuePercent: string | null; evidence: FinancialEvidenceDescriptor }>[];
}>;
type PeriodComparison = Readonly<{
  columns: readonly Readonly<{ key: string }>[];
  rows: readonly Readonly<{ statementLineId: string; amounts: readonly Money[] }>[];
  totals: { revenue: readonly Money[]; expenses: readonly Money[]; netProfit: readonly Money[]; salesVat: readonly Money[] };
  salesByVaultTotals: readonly Money[];
  salesByVault: readonly Readonly<{ vaultId: string; amounts: readonly Money[] }>[];
}>;
type ReportMetadata = Readonly<{
  totals: { revenue: Money; expenses: Money; netProfit: Money; revenueShareOfRevenuePercent: string | null; expensesShareOfRevenuePercent: string | null; netProfitShareOfRevenuePercent: string | null; revenueEvidence: FinancialEvidenceDescriptor; expensesEvidence: FinancialEvidenceDescriptor; netProfitEvidence: FinancialEvidenceDescriptor };
  basisLabelAr: string;
  dataCoverage: Coverage;
  vatInclusive: boolean;
  vatPresentation: Readonly<{ state: 'COMPLETE' | 'INCOMPLETE'; warningAr: string | null }>;
  salesByVault: SalesByVault;
}>;
type Result =
  | Readonly<{ state: 'NOT_READY'; messageAr: string }>
  | (ReportMetadata & Readonly<{ state: 'NO_DATA'; messageAr: string; rows: readonly [] }>)
  | (ReportMetadata & Readonly<{ state: 'READY'; rows: readonly Row[]; periodComparison?: PeriodComparison }>);
type Counterparty = Readonly<{ labelAr: string; labelEn: string }>;
type Evidence = Readonly<{ descriptor: FinancialEvidenceDescriptor; nextCursor: string | null; items: readonly (Readonly<{ evidenceId: string; businessDate: string; amount: Money; source: { journalEntryId: string; labelAr: string; labelEn: string; reference: string; description: string | null; counterparty: Counterparty | null } }>)[] }>;
type SourceJournal = Readonly<{ journalEntry: Readonly<{ id: string; businessDate: string; labelAr: string; labelEn: string; sourceReference: string; description: string | null; counterparty: Counterparty | null; status: 'POSTED' | 'REVERSED'; lines: readonly Readonly<{ id: string; lineNumber: number; accountCode: string; accountNameAr: string; accountNameEn: string; debit: Money; credit: Money; description: string | null }>[] }> }>;

const copy = {
  ar: { title: 'الربح والخسارة', period: 'الفترة', item: 'البند المالي', amount: 'المبلغ', total: 'المجموع', shareOfRevenue: 'من الإيرادات', gross: 'شامل الضريبة', revenue: 'إجمالي الإيرادات', expenses: 'إجمالي المصروفات', result: 'صافي الربح أو الخسارة', salesByVault: 'إيرادات المبيعات حسب الخزينة', salesByVaultGross: 'المبالغ شاملة الضريبة', salesByVaultNet: 'المبالغ بدون الضريبة', salesVat: 'ضريبة المبيعات ضمن التحصيل', noVaultSales: 'لا توجد مبيعات محصلة موزعة على خزائن ضمن الفترة.', loading: 'يتم تحميل التقرير…', noData: 'لا توجد إيرادات أو مصروفات مثبتة ضمن الفترة.', retry: 'إعادة المحاولة', details: 'أساس الرقم والعمليات', close: 'إغلاق', noOperations: 'لا توجد قيود مصدر لهذا البند ضمن الفترة المحددة.', operation: 'نوع العملية', counterparty: 'المورد / الجهة', journal: 'القيد / المستند', date: 'التاريخ', openJournal: 'فتح القيد', back: 'العودة للعمليات', debit: 'مدين', credit: 'دائن', statusCancelled: 'ملغى', statusPosted: 'مثبت' },
  en: { title: 'Profit and loss', period: 'Period', item: 'Financial item', amount: 'Amount', total: 'Total', shareOfRevenue: 'Of revenue', gross: 'VAT inclusive', revenue: 'Total revenue', expenses: 'Total expenses', result: 'Net profit or loss', salesByVault: 'Sales revenue by vault', salesByVaultGross: 'Amounts include VAT', salesByVaultNet: 'Amounts exclude VAT', salesVat: 'Sales VAT within collections', noVaultSales: 'There are no collected sales allocated to vaults in this period.', loading: 'Loading report…', noData: 'There are no posted revenues or expenses in this period.', retry: 'Retry', details: 'Amount basis and operations', close: 'Close', noOperations: 'There are no source journals for this item in the selected period.', operation: 'Operation type', counterparty: 'Supplier / party', journal: 'Journal / document', date: 'Date', openJournal: 'Open journal', back: 'Back to operations', debit: 'Debit', credit: 'Credit', statusCancelled: 'Cancelled', statusPosted: 'Posted' },
} as const;

export function AccrualProfitLossWorkspace({ language }: { language: Language }) {
  const [session] = useState<ActiveSession | null>(activeSession);
  const [period, setPeriod] = useState<BaseerPeriodRange>(defaultBaseerPeriodRange);
  const [vatInclusive, setVatInclusive] = useState(true);
  if (!session) return <DailySalesSignIn language={language} />;
  const query = new URLSearchParams({ from: period.from, to: period.to, vatInclusive: String(vatInclusive) });
  if (period.preset === 'MONTH' && period.months.length > 1) query.set('months', period.months.join(','));
  return <BaseerCompanyReadQuery session={session} resource="reports.accrual-profit-loss" scope={[language, period.preset, period.from, period.to, period.months.join(','), String(vatInclusive)]} mode="live" refreshIntervalMs={5_000} load={(current, signal) => api<Result>(current, `/reports/accrual-profit-loss?${query.toString()}`, { signal })}>
    {({ data, loading, error, refetch }) => <Content language={language} session={session} period={period} setPeriod={setPeriod} vatInclusive={vatInclusive} setVatInclusive={setVatInclusive} report={data ?? null} loading={loading} error={error} retry={() => void refetch().catch(() => undefined)} />}
  </BaseerCompanyReadQuery>;
}

function Content({ language, session, period, setPeriod, vatInclusive, setVatInclusive, report, loading, error, retry }: { language: Language; session: ActiveSession; period: BaseerPeriodRange; setPeriod: (value: BaseerPeriodRange) => void; vatInclusive: boolean; setVatInclusive: (value: boolean) => void; report: Result | null; loading: boolean; error: unknown; retry: () => void }) {
  const text = copy[language];
  const message = error ? presentBaseerApiError(error, language, text.title) : '';
  const createReportRun = (purpose: OfficialReportRunPurpose) => createOfficialReportRun(session, { reportCode: 'accrual_profit_loss', purpose, request: { from: period.from, to: period.to, ...(period.preset === 'MONTH' && period.months.length > 1 ? { months: period.months } : {}), vatInclusive } });
  const rows = report?.state === 'READY' ? report.rows : [];
  const periodComparison = report?.state === 'READY' ? report.periodComparison ?? null : null;
  const [selectedEvidence, setSelectedEvidence] = useState<Readonly<{ descriptor: FinancialEvidenceDescriptor; label: string; amount: Money; share: string | null; scope: Readonly<{ from: string; to: string; months: readonly string[] }> }> | null>(null);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [sourceJournal, setSourceJournal] = useState<SourceJournal | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [evidenceMessage, setEvidenceMessage] = useState('');
  const monthScope = (month: string) => ({ from: `${month}-01`, to: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).toISOString().slice(0, 10), months: [] as const });
  const openEvidence = async (descriptor: FinancialEvidenceDescriptor, label: string, amount: Money, share: string | null, scope?: Readonly<{ from: string; to: string; months: readonly string[] }>) => {
    const selectedScope = scope ?? { from: period.from, to: period.to, months: period.preset === 'MONTH' && period.months.length > 1 ? period.months : [] };
    setSelectedEvidence({ descriptor, label, amount, share, scope: selectedScope }); setEvidence(null); setSourceJournal(null); setEvidenceMessage(''); setEvidenceBusy(true);
    try {
      const query = financialEvidenceQuery(descriptor, selectedScope, vatInclusive);
      setEvidence(await api<Evidence>(session, `/reports/financial-evidence/live?${query.toString()}`));
    } catch (cause) { setEvidenceMessage(presentBaseerApiError(cause, language, text.details)); }
    finally { setEvidenceBusy(false); }
  };
  const openSourceJournal = async (evidenceId: string) => {
    if (!selectedEvidence) return;
    const journalEntryId = evidence?.items.find((item) => item.evidenceId === evidenceId)?.source.journalEntryId;
    if (!journalEntryId) return;
    setEvidenceBusy(true); setEvidenceMessage('');
    try {
      const { scope } = selectedEvidence;
      const query = financialEvidenceQuery(selectedEvidence.descriptor, scope, vatInclusive);
      setSourceJournal(await api<SourceJournal>(session, `/reports/financial-evidence/live/source/${journalEntryId}?${query.toString()}`));
    } catch (cause) { setEvidenceMessage(presentBaseerApiError(cause, language, text.journal)); }
    finally { setEvidenceBusy(false); }
  };
  return <section className="reports-prototype reports-workspace" aria-label={text.title}>
    <header className="reports-prototype__intro"><div><h2>{text.title}</h2></div></header>
    <section className="reports-prototype__canvas" dir={language === 'ar' ? 'rtl' : 'ltr'}>
      <div className="reports-prototype__toolbar reports-prototype__toolbar--with-actions" aria-label={text.period}>
        <BaseerFilterBar language={language} controls={<><BaseerPeriodFilter language={language} value={period} onChange={setPeriod} presets={['MONTH', 'QUARTER', 'YEAR', 'RANGE']} /><BaseerFilterToggle label={text.gross} checked={vatInclusive} onChange={setVatInclusive} /></>} />
        {!loading && report?.state === 'READY' ? <ReportDocumentActions session={session} createReportRun={createReportRun} language={language} /> : null}
      </div>
      {message ? <><p className="reports-prototype__notice is-error">{message}</p><div className="reports-prototype__retry"><BaseerButton type="button" variant="secondary" onClick={retry}>{text.retry}</BaseerButton></div></> : null}
      {loading ? <p className="reports-prototype__notice">{text.loading}</p> : null}
      {!loading && report && report.state !== 'READY' ? <p className="reports-prototype__notice">{report.messageAr || text.noData}</p> : null}
      {!loading && report && report.state !== 'NOT_READY' ? <p className={`reports-prototype__notice${report.dataCoverage.state === 'APPROVED_HISTORICAL_EXCEPTION' || report.vatPresentation.state === 'INCOMPLETE' ? ' is-warning' : ''}`}>{report.vatPresentation.warningAr ?? report.dataCoverage.warningAr ?? report.basisLabelAr}</p> : null}
      {!loading && report?.state === 'READY' ? <div className="reports-prototype__table-shell"><table data-baseer-report-table="snapshot" className="reports-prototype__table"><caption>{text.title}</caption><thead><tr><th scope="col">{text.item}</th>{periodComparison?.columns.map((column) => <th key={column.key} scope="col" className="reports-prototype__period-column"><bdi dir="ltr">{formatMonthYear(column.key, language, 'short')}</bdi></th>)}<th scope="col" className="reports-prototype__amount">{periodComparison ? text.total : text.amount}</th><th scope="col" className="reports-prototype__sales-share-column">{text.shareOfRevenue}</th></tr></thead><tbody>
        <TotalRow language={language} label={text.revenue} money={report.totals.revenue} share={report.totals.revenueShareOfRevenuePercent} periodAmounts={periodComparison?.totals.revenue ?? []} periodKeys={periodComparison?.columns.map((column) => column.key) ?? []} onOpen={() => void openEvidence(report.totals.revenueEvidence, text.revenue, report.totals.revenue, report.totals.revenueShareOfRevenuePercent)} onOpenMonth={(month) => void openEvidence(report.totals.revenueEvidence, text.revenue, report.totals.revenue, report.totals.revenueShareOfRevenuePercent, monthScope(month))} />
        {rows.filter((row) => row.section === 'REVENUE').map((row) => <AccountRow key={row.statementLineId} language={language} row={row} periodAmounts={periodComparison?.rows.find((comparison) => comparison.statementLineId === row.statementLineId)?.amounts ?? []} periodKeys={periodComparison?.columns.map((column) => column.key) ?? []} onOpen={() => void openEvidence(row.evidence, language === 'ar' ? row.nameAr : row.nameEn || row.nameAr, row.amount, row.shareOfRevenuePercent)} onOpenMonth={(month) => void openEvidence(row.evidence, language === 'ar' ? row.nameAr : row.nameEn || row.nameAr, row.amount, row.shareOfRevenuePercent, monthScope(month))} />)}
        <SalesByVaultRows language={language} sales={report.salesByVault} vatInclusive={vatInclusive} periodComparison={periodComparison} onOpen={(descriptor, label, amount, share) => void openEvidence(descriptor, label, amount, share)} />
        <TotalRow language={language} label={text.expenses} money={report.totals.expenses} share={report.totals.expensesShareOfRevenuePercent} periodAmounts={periodComparison?.totals.expenses ?? []} periodKeys={periodComparison?.columns.map((column) => column.key) ?? []} onOpen={() => void openEvidence(report.totals.expensesEvidence, text.expenses, report.totals.expenses, report.totals.expensesShareOfRevenuePercent)} onOpenMonth={(month) => void openEvidence(report.totals.expensesEvidence, text.expenses, report.totals.expenses, report.totals.expensesShareOfRevenuePercent, monthScope(month))} />
        {rows.filter((row) => row.section === 'EXPENSE').map((row) => <AccountRow key={row.statementLineId} language={language} row={row} periodAmounts={periodComparison?.rows.find((comparison) => comparison.statementLineId === row.statementLineId)?.amounts ?? []} periodKeys={periodComparison?.columns.map((column) => column.key) ?? []} onOpen={() => void openEvidence(row.evidence, language === 'ar' ? row.nameAr : row.nameEn || row.nameAr, row.amount, row.shareOfRevenuePercent)} onOpenMonth={(month) => void openEvidence(row.evidence, language === 'ar' ? row.nameAr : row.nameEn || row.nameAr, row.amount, row.shareOfRevenuePercent, monthScope(month))} />)}
        <TotalRow language={language} label={text.result} money={report.totals.netProfit} share={report.totals.netProfitShareOfRevenuePercent} periodAmounts={periodComparison?.totals.netProfit ?? []} periodKeys={periodComparison?.columns.map((column) => column.key) ?? []} result onOpen={() => void openEvidence(report.totals.netProfitEvidence, text.result, report.totals.netProfit, report.totals.netProfitShareOfRevenuePercent)} onOpenMonth={(month) => void openEvidence(report.totals.netProfitEvidence, text.result, report.totals.netProfit, report.totals.netProfitShareOfRevenuePercent, monthScope(month))} />
      </tbody></table></div> : null}
    </section>
    <FinancialEvidenceDialog
      open={selectedEvidence !== null}
      language={language}
      title={selectedEvidence?.label ?? text.details}
      amount={selectedEvidence?.amount ?? null}
      shareOfBasePercent={selectedEvidence?.share ?? null}
      shareLabel={text.shareOfRevenue}
      operations={selectedEvidence ? evidence ? evidence.items.map((item) => ({
        id: item.evidenceId,
        kind: language === 'ar' ? item.source.labelAr : item.source.labelEn || item.source.labelAr,
        counterparty: item.source.counterparty ? (language === 'ar' ? item.source.counterparty.labelAr : item.source.counterparty.labelEn || item.source.counterparty.labelAr) : null,
        reference: item.source.reference,
        businessDate: item.businessDate,
        amount: item.amount,
      })) : null : []}
      journal={sourceJournal ? {
        reference: sourceJournal.journalEntry.sourceReference,
        businessDate: sourceJournal.journalEntry.businessDate,
        description: [
          language === 'ar' ? sourceJournal.journalEntry.labelAr : sourceJournal.journalEntry.labelEn || sourceJournal.journalEntry.labelAr,
          sourceJournal.journalEntry.counterparty ? `${text.counterparty}: ${language === 'ar' ? sourceJournal.journalEntry.counterparty.labelAr : sourceJournal.journalEntry.counterparty.labelEn || sourceJournal.journalEntry.counterparty.labelAr}` : null,
          sourceJournal.journalEntry.description,
        ].filter(Boolean).join(' · '),
        status: sourceJournal.journalEntry.status,
        lines: sourceJournal.journalEntry.lines.map((line) => ({
          id: line.id,
          lineNumber: line.lineNumber,
          accountCode: line.accountCode,
          accountName: language === 'ar' ? line.accountNameAr : line.accountNameEn || line.accountNameAr,
          debitAmount: line.debit.raw,
          creditAmount: line.credit.raw,
        })),
      } : null}
      loading={evidenceBusy}
      error={evidenceMessage || null}
      onRetry={() => selectedEvidence && void openEvidence(selectedEvidence.descriptor, selectedEvidence.label, selectedEvidence.amount, selectedEvidence.share, selectedEvidence.scope)}
      onOpenJournal={(evidenceId) => void openSourceJournal(evidenceId)}
      onBackToOperations={() => { setSourceJournal(null); setEvidenceMessage(''); }}
      onClose={() => { setSelectedEvidence(null); setSourceJournal(null); setEvidenceMessage(''); }}
    />
  </section>;
}

function SalesByVaultRows({ language, sales, vatInclusive, periodComparison, onOpen }: { language: Language; sales: SalesByVault; vatInclusive: boolean; periodComparison: PeriodComparison | null; onOpen: (descriptor: FinancialEvidenceDescriptor, label: string, amount: Money, share: string | null) => void }) {
  const text = copy[language];
  const vaultAmounts = (vaultId: string) => periodComparison?.salesByVault.find((row) => row.vaultId === vaultId)?.amounts ?? [];
  return <>
    <tr className="reports-prototype__row reports-prototype__row--support-section">
      <th scope="row"><button type="button" className="reports-prototype__row-label-button" onClick={() => onOpen(sales.evidence, text.salesByVault, sales.displayedTotal, sales.shareOfRevenuePercent)}>{text.salesByVault}</button><small>{vatInclusive ? text.salesByVaultGross : text.salesByVaultNet}</small></th>
      {periodComparison?.salesByVaultTotals.map((money, index) => <PeriodValue key={periodComparison.columns[index]?.key ?? index} money={money} />)}
      <td><MoneyValue money={sales.displayedTotal} onClick={() => onOpen(sales.evidence, text.salesByVault, sales.displayedTotal, sales.shareOfRevenuePercent)} /></td><ShareValue language={language} value={sales.shareOfRevenuePercent} />
    </tr>
    {sales.rows.length ? sales.rows.map((row) => <tr className="reports-prototype__row reports-prototype__row--vault" key={row.vaultId}>
      <th scope="row"><button type="button" className="reports-prototype__row-label-button" onClick={() => onOpen(row.evidence, language === 'ar' ? row.vaultNameAr : row.vaultNameEn || row.vaultNameAr, row.displayedAmount, row.shareOfRevenuePercent)}>{language === 'ar' ? row.vaultNameAr : row.vaultNameEn || row.vaultNameAr}</button><small>{language === 'ar' ? `${row.eventCount} حركة` : `${row.eventCount} movements`}</small></th>
      {vaultAmounts(row.vaultId).map((money, index) => <PeriodValue key={`${row.vaultId}:${index}`} money={money} />)}
      <td><MoneyValue money={row.displayedAmount} onClick={() => onOpen(row.evidence, language === 'ar' ? row.vaultNameAr : row.vaultNameEn || row.vaultNameAr, row.displayedAmount, row.shareOfRevenuePercent)} /></td><ShareValue language={language} value={row.shareOfRevenuePercent} />
    </tr>) : <tr className="reports-prototype__row reports-prototype__row--vault-empty"><td colSpan={3 + (periodComparison?.columns.length ?? 0)}>{text.noVaultSales}</td></tr>}
    {vatInclusive && sales.vatTotal.sign !== 'zero' ? <tr className="reports-prototype__row reports-prototype__row--vat-note"><th scope="row">{text.salesVat}</th>{periodComparison?.totals.salesVat.map((money, index) => <PeriodValue key={periodComparison.columns[index]?.key ?? index} money={money} />)}<td><MoneyValue money={sales.vatTotal} /></td><ShareValue language={language} value={null} /></tr> : null}
  </>;
}

function AccountRow({ language, row, periodAmounts, periodKeys, onOpen, onOpenMonth }: { language: Language; row: Row; periodAmounts: readonly Money[]; periodKeys: readonly string[]; onOpen: () => void; onOpenMonth: (month: string) => void }) {
  return <tr className="reports-prototype__row reports-prototype__row--line"><th scope="row"><button type="button" className="reports-prototype__row-label-button" onClick={onOpen}><span dir="ltr">{row.code}</span> · {language === 'ar' ? row.nameAr : row.nameEn || row.nameAr}</button></th>{periodAmounts.map((money, index) => <PeriodValue key={`${row.statementLineId}:${index}`} money={money} onOpen={() => onOpenMonth(periodKeys[index]!)} />)}<td><MoneyValue money={row.amount} onClick={onOpen} /></td><ShareValue language={language} value={row.shareOfRevenuePercent} /></tr>;
}
function TotalRow({ language, label, money, share, periodAmounts, periodKeys, result = false, onOpen, onOpenMonth }: { language: Language; label: string; money: Money; share: string | null; periodAmounts: readonly Money[]; periodKeys: readonly string[]; result?: boolean; onOpen: () => void; onOpenMonth: (month: string) => void }) {
  return <tr className={`reports-prototype__row reports-prototype__row--${result ? 'result' : 'section'}`}><th scope="row"><button type="button" className="reports-prototype__row-label-button" onClick={onOpen}>{label}</button></th>{periodAmounts.map((value, index) => <PeriodValue key={`${label}:${index}`} money={value} onOpen={() => onOpenMonth(periodKeys[index]!)} />)}<td><MoneyValue money={money} onClick={onOpen} /></td><ShareValue language={language} value={share} /></tr>;
}
function MoneyValue({ money, onClick }: { money: Money; onClick?: () => void }) { const value = <bdi className={`reports-prototype__number${money.sign === 'negative' ? ' is-negative' : ''}`} dir="ltr">{money.sign === 'negative' ? '−' : ''}{money.display}</bdi>; return onClick ? <button type="button" className="reports-prototype__number" onClick={onClick}>{value}</button> : value; }
function PeriodValue({ money, onOpen }: { money: Money; onOpen?: () => void }) { return <td className="reports-prototype__period-column"><MoneyValue money={money} onClick={onOpen} /></td>; }
function ShareValue({ language, value }: { language: Language; value: string | null }) { return <td className="reports-prototype__sales-share-column"><bdi className="reports-prototype__sales-share-value" dir="ltr">{value === null ? '—' : formatPercent(value, language)}</bdi></td>; }

function SourceJournalDetail({ language, source, onBack }: { language: Language; source: SourceJournal; onBack: () => void }) {
  const text = copy[language]; const journal = source.journalEntry;
  return <div className="reports-prototype__detail" dir={language === 'ar' ? 'rtl' : 'ltr'}><BaseerButton type="button" variant="secondary" onClick={onBack}>{text.back}</BaseerButton><div className="reports-prototype__source-journal"><p><strong>{language === 'ar' ? journal.labelAr : journal.labelEn || journal.labelAr}</strong> · <bdi dir="ltr">{journal.sourceReference}</bdi> · <bdi dir="ltr">{formatDate(journal.businessDate, language)}</bdi> · {journal.status === 'REVERSED' ? text.statusCancelled : text.statusPosted}</p>{journal.counterparty ? <p><strong>{text.counterparty}:</strong> {language === 'ar' ? journal.counterparty.labelAr : journal.counterparty.labelEn || journal.counterparty.labelAr}</p> : null}{journal.description ? <p>{journal.description}</p> : null}<table data-baseer-report-table="detail"><thead><tr><th>#</th><th>{text.item}</th><th>{text.debit}</th><th>{text.credit}</th></tr></thead><tbody>{journal.lines.map((line) => <tr key={line.id}><td><bdi dir="ltr">{formatCount(line.lineNumber, language)}</bdi></td><td><span dir="ltr">{line.accountCode}</span> · {language === 'ar' ? line.accountNameAr : line.accountNameEn || line.accountNameAr}</td><td><bdi dir="ltr">{formatMoney(line.debit.raw, 'SAR', language)}</bdi></td><td><bdi dir="ltr">{formatMoney(line.credit.raw, 'SAR', language)}</bdi></td></tr>)}</tbody></table></div></div>;
}

function financialEvidenceQuery(descriptor: FinancialEvidenceDescriptor, scope: Readonly<{ from: string; to: string; months: readonly string[] }>, vatInclusive: boolean) {
  const query = new URLSearchParams({ from: scope.from, to: scope.to, vatInclusive: String(vatInclusive), reportCode: descriptor.reportCode, metricKind: descriptor.metric.kind, ...(scope.months.length ? { months: scope.months.join(',') } : {}) });
  if (descriptor.reportCode === 'personal_cash_performance') query.set('rowCode', descriptor.metric.rowCode);
  else if (descriptor.metric.kind === 'STATEMENT_LINE') query.set('statementLineId', descriptor.metric.statementLineId);
  return query;
}
