import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";

import { presentBaseerLoadError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerDialog } from "./baseer-dialog";
import { BaseerMoneyInput } from "./baseer-form-fields";
import { BaseerWorkspaceTabs } from "./baseer-batch-layout";
import { BaseerPeriodFilter, baseerPeriodRange, defaultBaseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import { BaseerEmptyState, BaseerSectionHeader, BaseerWorkspace } from "./baseer-workspace";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { formatCount, formatDate, formatMoney, formatNumber, formatNumberFixed, formatPercent } from "./number-format";
import "./command-center-workspace.css";

const LazyBaseerChart = lazy(() => import("./baseer-chart").then((module) => ({ default: module.BaseerChart })));
const LazyMarketingTimelineChart = lazy(() => import("./baseer-chart").then((module) => ({ default: module.BaseerMarketingTimelineChart })));

import { pageRouteHash } from "./page-registry";

type Language = "ar" | "en";
type MoneyDisplay = Readonly<{ raw: string; display: string; sign: "positive" | "negative" | "zero" }>;
type FinancialRow = Readonly<{ code: string; labelAr: string; labelEn: string; kind: "SECTION" | "LINE"; parentCode: string | null; direction: "INFLOW" | "OUTFLOW"; eventCount: number; amount: MoneyDisplay; shareOfCollectedSalesPercent: string | null }>;
type FinancialTotals = Readonly<{ inflows: MoneyDisplay; outflows: MoneyDisplay; netCashResult: MoneyDisplay; netCashResultShareOfCollectedSalesPercent: string | null }>;
type VaultLedgerItem = Readonly<{ vaultId: string; vaultNameAr: string; vaultNameEn: string; inflows: MoneyDisplay; outflows: MoneyDisplay; balance: MoneyDisplay }>;
type FinancialEvidence = Readonly<{ reportRunId: string; rowCode: string; nextCursor: string | null; items: readonly Readonly<{ eventId: string; businessDate: string; amount: MoneyDisplay; source: { journalEntryId: string; labelAr: string; labelEn: string; reference: string; origin: { labelAr: string; labelEn: string; route: string } } }>[] }>;
type SourceJournal = Readonly<{ journalEntry: { businessDate: string; sourceType: string; sourceReference: string; description: string | null; status: "POSTED" | "REVERSED"; lines: readonly { id: string; lineNumber: number; accountCode: string; accountNameAr: string; accountNameEn: string; debitAmount: string; creditAmount: string }[] } }>;
type FinancialReport =
  | Readonly<{ state: "NOT_READY" | "COVERAGE_INCOMPLETE"; messageAr: string }>
  | Readonly<{ state: "NO_DATA"; messageAr: string; rows: readonly []; vaults: readonly []; totals: FinancialTotals }>
  | Readonly<{ state: "READY"; reportRunId: string; selectedPeriod: { from: string; to: string }; rows: readonly FinancialRow[]; vaults: readonly VaultLedgerItem[]; totals: FinancialTotals }>;

type MarketingCampaign = Readonly<{ id: string; titleAr: string; titleEn: string | null }>;
type MarketingDay = Readonly<{ businessDate: string; officialNetSales: string | null; salesDayQuality: "READY" | "PENDING" | "PARTIAL" | "MISSING"; dailySalesTarget: string | null; targetStatus: "NO_TARGET" | "NO_SALES" | "BELOW" | "NEAR" | "MET" | "EXCEEDED"; linkedActualSpend: string; linkedFinancialDocumentCount: number; activeCampaignIds: readonly string[] }>;
type MarketingRead = Readonly<{
  period: { fromBusinessDate: string; toBusinessDate: string; timezone: string };
  sales: { dataQuality: string; payload: { netAmount: string } };
  campaigns: readonly MarketingCampaign[];
  days: readonly MarketingDay[];
  weekdayAverages: readonly { weekday: number; averageOfficialNetSales: string | null; eligibleDayCount: number }[];
  salesTargets: readonly { periodMonth: string; amount: string }[];
  context: readonly { id: string; titleAr: string; startsOn: string; endsOn: string; verificationStatus: string }[];
  linkedActualGrossAmount: string;
  spendResult: { plannedCampaignCost: string; linkedActualSpend: string; officialNetSales: string | null; spendToSalesPercent: string | null; campaignCount: number; salesDataQuality: string; conclusionAr: string; conclusionEn: string };
}>;

const copy = {
  ar: {
    eyebrow: "مركز القيادة", title: "المال والتسويق",
    day: "اليوم", month: "الشهر", financial: "المال", vaultLedger: "دفتر الخزائن", vaultLedgerDescription: "حركة النقد عبر الخزائن والبنوك خلال الفترة المحددة.", cashIn: "إجمالي الداخل", cashOut: "إجمالي الخارج", netMovement: "صافي الحركة", comparedToPrevious: "مقارنة بالفترة المطابقة من الشهر السابق",
    share: "من المبيعات", financialChart: "الحركة المالية حسب البند", categoryChart: "تفصيل المشتريات والمصروفات حسب الفئة", total: "المجموع", details: "تفصيل العمليات", sourceJournal: "العملية الأصلية", openSource: "فتح العملية الأصلية", openLocation: "فتحها في قسمها", back: "العودة للعمليات", loadingOperations: "جارٍ تحميل العمليات…", noOperations: "لا توجد عمليات ضمن هذا البند.", close: "إغلاق", debit: "مدين", credit: "دائن",
    marketing: "التسويق", marketingDescription: "الحملات المسجلة، المبيعات الرسمية، والصرف المثبت المرتبط بها.",
    campaigns: "الحملات في الفترة", plannedSpend: "التكلفة المخططة", linkedSpend: "الصرف المثبت المرتبط", officialSales: "المبيعات الرسمية", spendShare: "الصرف من المبيعات", marketingChart: "الخط الزمني للتسويق", marketingTimeline: "الخط الزمني", calendar: "التقويم", daily: "يومي", monthly: "شهري", campaignsView: "الحملات", calendarMonth: "شهر التقويم", salesTarget: "هدف المبيعات", saveTarget: "حفظ الهدف", saving: "جارٍ الحفظ…", noTarget: "لا يوجد هدف لهذا الشهر", targetBelow: "أقل من 80٪", targetNear: "من 80٪ إلى أقل من 100٪", targetMet: "من 100٪ إلى أقل من 120٪", targetExceeded: "120٪ فأعلى", targetNoSales: "لا توجد قراءة مبيعات", event: "مناسبة", dayDetails: "تفاصيل اليوم", daySales: "مبيعات اليوم", dayTarget: "هدف اليوم", dayStatus: "حالة الهدف", noEvent: "لا توجد مناسبة مرتبطة بهذا اليوم", openContext: "فتح المناسبات والسياق",
    openMarketing: "فتح الأداء التسويقي", monthEvents: "مناسبات الشهر", loading: "جارٍ تحميل القراءة…", noData: "لا توجد بيانات مؤهلة للفترة المحددة.", noFinancialAccess: "لا تملك صلاحية قراءة التقرير المالي.", noMarketingAccess: "لا تملك صلاحية قراءة الأداء التسويقي.", retry: "إعادة المحاولة", dataBoundary: "تعرض الحملة سياقاً زمنياً ولا تثبت سبب المبيعات. بيانات الإعلانات الخارجية لا تظهر قبل الربط المعتمد.",
  },
  en: {
    eyebrow: "Command center", title: "Money and marketing",
    day: "Day", month: "Month", financial: "Money", vaultLedger: "Vault ledger", vaultLedgerDescription: "Cash movement across vaults and banks in the selected period.", cashIn: "Total inflow", cashOut: "Total outflow", netMovement: "Net movement", comparedToPrevious: "Compared with the matching prior-month period",
    share: "of sales", financialChart: "Financial movement by item", categoryChart: "Purchase and expense breakdown by category", total: "Total", details: "Operation details", sourceJournal: "Original operation", openSource: "Open original operation", openLocation: "Open in its section", back: "Back to operations", loadingOperations: "Loading operations…", noOperations: "There are no operations for this item.", close: "Close", debit: "Debit", credit: "Credit",
    marketing: "Marketing", marketingDescription: "Recorded campaigns, official sales, and their posted linked spend.",
    campaigns: "Campaigns in period", plannedSpend: "Planned cost", linkedSpend: "Posted linked spend", officialSales: "Official sales", spendShare: "Spend of sales", marketingChart: "Marketing timeline", marketingTimeline: "Timeline", calendar: "Calendar", daily: "Daily", monthly: "Monthly", campaignsView: "Campaigns", calendarMonth: "Calendar month", salesTarget: "Sales target", saveTarget: "Save target", saving: "Saving…", noTarget: "No target for this month", targetBelow: "Below 80%", targetNear: "80% to under 100%", targetMet: "100% to under 120%", targetExceeded: "120% or higher", targetNoSales: "No sales read", event: "Event", dayDetails: "Day details", daySales: "Day sales", dayTarget: "Day target", dayStatus: "Target status", noEvent: "No event is linked to this day", openContext: "Open events and context",
    openMarketing: "Open marketing performance", monthEvents: "Month events", loading: "Loading the read…", noData: "There is no eligible data for the selected period.", noFinancialAccess: "You cannot read the financial report.", noMarketingAccess: "You cannot read marketing performance.", retry: "Retry", dataBoundary: "Campaigns provide temporal context; they do not prove sales causation. External advertising data remains unavailable until an approved connection exists.",
  },
} as const;

function hasCapability(codes: readonly string[] | null, capability: string) { return codes === null || codes.includes(capability); }
function moneyClass(money: MoneyDisplay) { return money.sign === "negative" ? "is-negative" : money.sign === "positive" ? "is-positive" : ""; }
function AnimatedMoney({ money, language }: { money: MoneyDisplay; language: Language }) {
  const target = Math.abs(Number(money.raw)); const [value, setValue] = useState(0);
  useEffect(() => {
    if (!Number.isFinite(target)) return;
    if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { setValue(target); return; }
    let frame = 0; const startedAt = performance.now(); const duration = 680;
    setValue(0);
    const tick = (now: number) => { const progress = Math.min((now - startedAt) / duration, 1); setValue(target * (1 - Math.pow(1 - progress, 3))); if (progress < 1) frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [target]);
  const display = formatMoney(value, "SAR", language);
  return <>{money.sign === "negative" ? "−" : ""}{display}</>;
}
function MoneyValue({ money, language, onClick, label }: { money: MoneyDisplay; language: Language; onClick?: () => void; label?: string }) {
  const value = <bdi className={`command-center__money command-center__money--count-up ${moneyClass(money)}`} dir="ltr"><AnimatedMoney money={money} language={language} /></bdi>;
  return onClick ? <button type="button" className="command-center__amount-link" onClick={onClick} aria-label={label}>{value}</button> : value;
}
function MovementDelta({ current, previous, label }: { current: MoneyDisplay; previous: MoneyDisplay | null; label: string }) {
  if (!previous || Number(previous.raw) === 0) return null;
  const percent = ((Math.abs(Number(current.raw)) - Math.abs(Number(previous.raw))) / Math.abs(Number(previous.raw))) * 100;
  const direction = percent >= 0 ? "up" : "down";
  return <small className={`command-center__movement-delta is-${direction}`} title={label}><span aria-hidden="true">{direction === "up" ? "↑" : "↓"}</span><bdi dir="ltr">{formatPercent(Math.abs(percent), 1)}</bdi></small>;
}
function PercentValue({ value }: { value: string | null }) { return <bdi className="command-center__share" dir="ltr">{formatPercent(value, 2)}</bdi>; }

export function CommandCenterWorkspace({ language, permissionCodes, section = 0 }: { language: Language; permissionCodes: readonly string[] | null; section?: number }) {
  const [period, setPeriod] = useState<BaseerPeriodRange>(defaultBaseerPeriodRange);
  const session = activeSession(); const text = copy[language];
  if (!session) return <DailySalesSignIn language={language} />;
  const financialAllowed = hasCapability(permissionCodes, "reports.read");
  const marketingAllowed = hasCapability(permissionCodes, "marketing.insights.read");
  const calendarSection = section === 1;
  return <BaseerWorkspace className="command-center">
    <BaseerSectionHeader eyebrow={text.eyebrow} title={calendarSection ? text.calendar : text.title} actions={<div className="command-center__period-actions"><BaseerButton type="button" variant={period.preset === "DAY" ? "primary" : "secondary"} aria-pressed={period.preset === "DAY"} onClick={() => setPeriod(baseerPeriodRange("DAY"))}>{text.day}</BaseerButton><BaseerButton type="button" variant={period.preset === "MONTH" ? "primary" : "secondary"} aria-pressed={period.preset === "MONTH"} onClick={() => setPeriod(baseerPeriodRange("MONTH"))}>{text.month}</BaseerButton><BaseerPeriodFilter language={language} value={period} onChange={setPeriod} presets={["DAY", "MONTH", "QUARTER", "YEAR", "RANGE"]} allowNonContiguousMonths={false} /></div>} />
    {permissionCodes === null ? <BaseerCard className="command-center__loading" aria-busy="true">{text.loading}</BaseerCard> : null}
    <section className="command-center__sections">
      {calendarSection ? marketingAllowed ? <MarketingCalendarPanel language={language} session={session} initialMonth={period.from.slice(0, 7)} canManageTarget={permissionCodes !== null && hasCapability(permissionCodes, "marketing.campaign.write")} /> : <AccessCard title={text.calendar} message={text.noMarketingAccess} /> : <><>{financialAllowed ? <FinancialPanel language={language} session={session} period={period} /> : <AccessCard title={text.financial} message={text.noFinancialAccess} />}</>{marketingAllowed ? <MarketingPanel language={language} session={session} period={period} /> : <AccessCard title={text.marketing} message={text.noMarketingAccess} />}</>}
    </section>
  </BaseerWorkspace>;
}

function AccessCard({ title, message }: { title: string; message: string }) { return <section className="command-center__section"><h2>{title}</h2><BaseerEmptyState title={message} /></section>; }

function FinancialPanel({ language, session, period }: { language: Language; session: ActiveSession; period: BaseerPeriodRange }) {
  const text = copy[language]; const query = useMemo(() => new URLSearchParams({ from: period.from, to: period.to, vatInclusive: "true" }), [period.from, period.to]);
  const previous = useMemo(() => previousCalendarPeriod(period.from, period.to), [period.from, period.to]); const previousQuery = useMemo(() => new URLSearchParams({ from: previous.from, to: previous.to, vatInclusive: "true" }), [previous]);
  return <BaseerCompanyReadQuery session={session} resource="command-center.financial-performance" scope={[period.preset, period.from, period.to, previous.from, previous.to]} mode="snapshot" load={async (current, signal) => { const [report, previousReport] = await Promise.all([api<FinancialReport>(current, `/reports/personal-cash-performance?${query.toString()}`, { signal }), api<FinancialReport>(current, `/reports/personal-cash-performance?${previousQuery.toString()}`, { signal })]); return { report, previousReport }; }}>{({ data, loading, error, refetch }) => <section className="command-center__section" aria-busy={loading}>
    {loading ? <BaseerCard className="command-center__loading">{text.loading}</BaseerCard> : null}
    {error ? <BaseerEmptyState title={presentBaseerLoadError(error, language, { ar: "القراءة المالية", en: "the financial read" })} action={<BaseerButton type="button" variant="secondary" onClick={() => void refetch().catch(() => undefined)}>{text.retry}</BaseerButton>} /> : null}
    {!loading && !error && data?.report.state !== "READY" ? <BaseerEmptyState title={data?.report.messageAr || text.noData} /> : null}
    {!loading && !error && data?.report.state === "READY" ? <FinancialRead language={language} session={session} period={period} report={data.report} previousReport={data.previousReport.state === "READY" ? data.previousReport : null} /> : null}
  </section>}</BaseerCompanyReadQuery>;
}

function FinancialRead({ language, session, period, report, previousReport }: { language: Language; session: ActiveSession; period: BaseerPeriodRange; report: Extract<FinancialReport, { state: "READY" }>; previousReport: Extract<FinancialReport, { state: "READY" }> | null }) {
  const text = copy[language];
  const [selectedRow, setSelectedRow] = useState<FinancialRow | null>(null);
  const [evidence, setEvidence] = useState<FinancialEvidence | null>(null);
  const [source, setSource] = useState<SourceJournal | null>(null);
  const [sourceReference, setSourceReference] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const topRows = report.rows.filter((row) => row.parentCode === null && row.code !== "sales_collections");
  const previousRows = new Map(previousReport?.rows.map((row) => [row.code, row]) ?? []);
  // This chart deliberately shows only the operational category roots. Child
  // categories are drill-down detail and would make this high-level view noisy.
  // Outflows are shown as positive spend magnitudes; the signed result remains
  // exclusively in the financial-summary card beside it.
  const categoryRows = report.rows
    .filter((row) => row.parentCode === "purchases" || row.parentCode === "expenses" || row.parentCode === "recurring_expenses")
    .sort((left, right) => Math.abs(Number(right.amount.raw)) - Math.abs(Number(left.amount.raw)));
  const categorySpendTotal = categoryRows.reduce((total, row) => total + Math.abs(Number(row.amount.raw)), 0);
  const chartPoints = categoryRows
    .map((row, index) => {
      const value = Math.abs(Number(row.amount.raw));
      return {
      id: row.code,
      label: language === "ar" ? row.labelAr : row.labelEn || row.labelAr,
      value,
      // The category chart expresses spend magnitude, not signed profit/loss.
      displayValue: formatMoney(value, language === "ar" ? "ر.س" : "SAR", language),
      rank: index + 1,
      shareOfTotalPercent: categorySpendTotal > 0 ? formatNumberFixed((value / categorySpendTotal) * 100, 2) : formatNumberFixed(0, 2),
    };
    });
  const openEvidence = async (row: FinancialRow) => {
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller;
    setSelectedRow(row); setEvidence(null); setSource(null); setSourceReference(null); setSelectedEventId(null); setMessage(""); setBusy(true);
    try {
      const query = new URLSearchParams({ rowCode: row.code });
      const next = await api<FinancialEvidence>(session, `/reports/personal-cash-performance/${report.reportRunId}/evidence?${query.toString()}`, { signal: controller.signal });
      if (!controller.signal.aborted) setEvidence(next);
    } catch (error) { if (!controller.signal.aborted) setMessage(presentBaseerLoadError(error, language, { ar: "عمليات هذا البند", en: "this item's operations" })); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const openSource = async (eventId: string) => {
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller;
    setMessage(""); setSourceReference(evidence?.items.find((item) => item.eventId === eventId)?.source.reference ?? null); setBusy(true);
    try {
      const next = await api<SourceJournal>(session, `/reports/personal-cash-performance/${report.reportRunId}/evidence/${eventId}/source`, { signal: controller.signal });
      if (!controller.signal.aborted) setSource(next);
    } catch (error) { if (!controller.signal.aborted) setMessage(presentBaseerLoadError(error, language, { ar: "العملية الأصلية", en: "the original operation" })); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const closeEvidence = () => { abortRef.current?.abort(); setSelectedRow(null); setEvidence(null); setSource(null); setSourceReference(null); setSelectedEventId(null); setMessage(""); setBusy(false); };
  const sourceTitle = source ? text.sourceJournal : selectedRow ? `${text.details} — ${financialRowLabel(selectedRow, language)}` : text.details;
  return <><div className="command-center__financial-grid"><BaseerCard className="command-center__breakdown" padding="compact"><h3>{text.financialChart}</h3><ul>{topRows.map((row) => <li key={row.code}><span>{financialRowLabel(row, language)}</span><span><MoneyValue money={row.amount} language={language} label={`${text.details} — ${financialRowLabel(row, language)}`} onClick={() => void openEvidence(row)} /><small>{text.share} <PercentValue value={row.shareOfCollectedSalesPercent} /></small><MovementDelta current={row.amount} previous={previousRows.get(row.code)?.amount ?? null} label={text.comparedToPrevious} /></span></li>)}</ul><footer className="command-center__breakdown-total"><span>{text.total}</span><MoneyValue money={report.totals.netCashResult} language={language} label={text.total} onClick={() => void openEvidence({ code: "net_cash_result", labelAr: text.total, labelEn: text.total, kind: "SECTION", parentCode: null, direction: report.totals.netCashResult.sign === "negative" ? "OUTFLOW" : "INFLOW", eventCount: 0, amount: report.totals.netCashResult, shareOfCollectedSalesPercent: report.totals.netCashResultShareOfCollectedSalesPercent })} /></footer></BaseerCard>{chartPoints.length ? <Suspense fallback={<BaseerCard className="command-center__loading">{text.loading}</BaseerCard>}><LazyBaseerChart language={language} title={text.categoryChart} points={chartPoints} asOf={report.selectedPeriod.to} showSummary={false} presentation="inlineRows" onPointClick={(point) => { const row = categoryRows.find((item) => item.code === point.id); if (row) void openEvidence(row); }} /></Suspense> : null}</div><div className="command-center__money-support"><VaultLedgerCard language={language} totals={report.totals} vaults={report.vaults} /><WeeklySalesAverageCard language={language} session={session} period={period} /></div><BaseerDialog open={selectedRow !== null} size="wide" language={language} title={sourceTitle} busy={busy} onClose={closeEvidence} footer={<BaseerButton type="button" onClick={closeEvidence}>{text.close}</BaseerButton>}>{source ? <SourceJournalView language={language} source={source} reference={sourceReference} onBack={() => { setSource(null); setSourceReference(null); }} /> : message ? <p className="command-center__evidence-message is-error">{message}</p> : !evidence ? <p className="command-center__evidence-message">{text.loadingOperations}</p> : evidence.items.length ? <EvidenceTable language={language} items={evidence.items} selectedEventId={selectedEventId} onSelect={(eventId) => setSelectedEventId((current) => current === eventId ? null : eventId)} onOpenSource={openSource} /> : <p className="command-center__evidence-message">{text.noOperations}</p>}</BaseerDialog></>;
}

function VaultLedgerCard({ language, totals, vaults }: { language: Language; totals: FinancialTotals; vaults: readonly VaultLedgerItem[] }) {
  const text = copy[language];
  return <BaseerCard className="command-center__vault-ledger command-center__breakdown" padding="compact"><header><div><h3>{text.vaultLedger}</h3><p>{text.vaultLedgerDescription}</p></div></header><div className="command-center__vault-ledger-table"><div className="command-center__vault-ledger-row is-head"><span>{language === "ar" ? "الخزينة" : "Vault"}</span><span>{text.cashIn}</span><span>{text.cashOut}</span><span>{language === "ar" ? "المتبقي" : "Balance"}</span></div>{vaults.map((vault) => <div className="command-center__vault-ledger-row" key={vault.vaultId}><strong>{language === "ar" ? vault.vaultNameAr : vault.vaultNameEn || vault.vaultNameAr}</strong><bdi className="is-inflow" dir="ltr"><AnimatedMoney money={vault.inflows} language={language} /></bdi><bdi className="is-outflow" dir="ltr"><AnimatedMoney money={vault.outflows} language={language} /></bdi><bdi className="is-balance" dir="ltr"><AnimatedMoney money={vault.balance} language={language} /></bdi></div>)}</div><footer className="command-center__breakdown-total"><span>{text.netMovement}</span><bdi className="command-center__vault-ledger-net" dir="ltr"><AnimatedMoney money={totals.netCashResult} language={language} /></bdi></footer></BaseerCard>;
}

function WeeklySalesAverageCard({ language, session, period }: { language: Language; session: ActiveSession; period: BaseerPeriodRange }) {
  const initialMonth = period.from.slice(0, 7); const [primaryMonth, setPrimaryMonth] = useState(initialMonth); const [comparisonMonth, setComparisonMonth] = useState(previousMonthValue(initialMonth)); const [salesDays, setSalesDays] = useState<MarketingDay[]>([]); const [previousSalesDays, setPreviousSalesDays] = useState<MarketingDay[]>([]);
  useEffect(() => { setPrimaryMonth(initialMonth); setComparisonMonth(previousMonthValue(initialMonth)); }, [initialMonth]);
  const primary = useMemo(() => monthPeriod(primaryMonth), [primaryMonth]); const comparison = useMemo(() => monthPeriod(comparisonMonth), [comparisonMonth]);
  useEffect(() => { const controller = new AbortController(); void Promise.all([api<Pick<MarketingRead, "days">>(session, `/marketing/calendar?from=${primary.from}&to=${primary.to}`, { signal: controller.signal }), api<Pick<MarketingRead, "days">>(session, `/marketing/calendar?from=${comparison.from}&to=${comparison.to}`, { signal: controller.signal })]).then(([current, prior]) => { setSalesDays([...current.days]); setPreviousSalesDays([...prior.days]); }).catch(() => { if (!controller.signal.aborted) { setSalesDays([]); setPreviousSalesDays([]); } }); return () => controller.abort(); }, [comparison.from, comparison.to, primary.from, primary.to, session]);
  const currentWeeks = weeklySalesAverages(salesDays, primary.from, primary.to); const priorWeeks = weeklySalesAverages(previousSalesDays, comparison.from, comparison.to); const ar = language === "ar";
  return <BaseerCard className="command-center__weekly-sales" padding="compact"><header><div><h3>{ar ? "متوسط المبيعات اليومية حسب أسبوع الشهر" : "Daily sales average by month week"}</h3><small>{ar ? "شامل الضريبة" : "VAT inclusive"}</small></div></header><div className="command-center__weekly-sales-filters"><label>{ar ? "الفترة الأولى" : "Primary period"}<input type="month" value={primaryMonth} onChange={(event) => event.target.value && setPrimaryMonth(event.target.value)} /></label><label>{ar ? "فترة المقارنة" : "Comparison period"}<input type="month" value={comparisonMonth} onChange={(event) => event.target.value && setComparisonMonth(event.target.value)} /></label></div><div className="command-center__weekly-sales-table"><div className="is-head"><span>{ar ? "الفترة" : "Period"}</span><span dir="ltr">{primaryMonth}</span><span dir="ltr">{comparisonMonth}</span><span>{ar ? "التغير" : "Change"}</span></div>{currentWeeks.map((week, index) => { const prior = priorWeeks[index]?.average ?? null; const change = week.average === null || prior === null || prior === 0 ? null : ((week.average - prior) / prior) * 100; return <div key={week.label}><strong>{week.label}</strong><bdi dir="ltr">{formatNumber(week.average)}</bdi><bdi dir="ltr">{formatNumber(prior)}</bdi><bdi className={change === null ? "" : change >= 0 ? "is-positive" : "is-negative"} dir="ltr">{change === null ? "—" : `${change >= 0 ? "+" : ""}${formatPercent(change, 1)}`}</bdi></div>; })}</div></BaseerCard>;
}

function weeklySalesAverages(days: readonly MarketingDay[], from: string, to: string) {
  const daily = new Map<string, number>(); for (const day of days) if (day.officialNetSales !== null && day.salesDayQuality === "READY") daily.set(day.businessDate, Number(day.officialNetSales));
  const first = Number(from.slice(8)); const last = Number(to.slice(8)); const groups = Array.from({ length: Math.ceil((last - first + 1) / 7) }, (_, index) => ({ start: first + index * 7, end: Math.min(first + index * 7 + 6, last) }));
  return groups.map((group, index) => { const values = [...daily].filter(([date]) => { const day = Number(date.slice(8)); return day >= group.start && day <= group.end; }).map(([, amount]) => amount); return { label: `أسبوع ${index + 1} · ${group.start}–${group.end}`, average: values.length ? values.reduce((sum, amount) => sum + amount, 0) / values.length : null }; });
}

function EvidenceTable({ language, items, selectedEventId, onSelect, onOpenSource }: { language: Language; items: FinancialEvidence["items"]; selectedEventId: string | null; onSelect: (eventId: string) => void; onOpenSource: (eventId: string) => void }) {
  const text = copy[language];
  return <div className="command-center__evidence-table-shell"><table className="command-center__evidence-table"><thead><tr><th>{language === "ar" ? "العملية" : "Operation"}</th><th>{language === "ar" ? "المرجع والتاريخ" : "Reference and date"}</th><th>{language === "ar" ? "المبلغ" : "Amount"}</th></tr></thead><tbody>{items.map((item) => <Fragment key={item.eventId}><tr><td><strong>{language === "ar" ? item.source.labelAr : item.source.labelEn || item.source.labelAr}</strong><small>{language === "ar" ? item.source.origin.labelAr : item.source.origin.labelEn}</small></td><td><bdi dir="ltr">{item.source.reference}</bdi><small dir="ltr">{formatDate(item.businessDate, language)}</small></td><td><MoneyValue money={item.amount} language={language} label={`${text.details} — ${item.source.reference}`} onClick={() => onSelect(item.eventId)} /></td></tr>{selectedEventId === item.eventId ? <tr className="command-center__evidence-table-actions"><td colSpan={3}><BaseerButton type="button" variant="secondary" onClick={() => onOpenSource(item.eventId)}>{text.openSource}</BaseerButton><BaseerButton type="button" variant="quiet" onClick={() => { window.location.hash = item.source.origin.route; }}>{text.openLocation}</BaseerButton></td></tr> : null}</Fragment>)}</tbody></table></div>;
}

function SourceJournalView({ language, source, reference, onBack }: { language: Language; source: SourceJournal; reference: string | null; onBack: () => void }) {
  const text = copy[language]; const entry = source.journalEntry;
  return <div className="command-center__source-journal" dir={language === "ar" ? "rtl" : "ltr"}><BaseerButton type="button" variant="secondary" onClick={onBack}>{text.back}</BaseerButton><p><strong dir="ltr">{reference ?? entry.sourceReference}</strong> · <bdi dir="ltr">{formatDate(entry.businessDate, language)}</bdi>{entry.description ? ` · ${entry.description}` : ""}</p><table><thead><tr><th>#</th><th>{language === "ar" ? "الحساب" : "Account"}</th><th>{text.debit}</th><th>{text.credit}</th></tr></thead><tbody>{entry.lines.map((line) => <tr key={line.id}><td><bdi dir="ltr">{formatCount(line.lineNumber, language)}</bdi></td><td>{line.accountCode} · {language === "ar" ? line.accountNameAr : line.accountNameEn}</td><td dir="ltr">{formatMoney(line.debitAmount, "SAR", language)}</td><td dir="ltr">{formatMoney(line.creditAmount, "SAR", language)}</td></tr>)}</tbody></table></div>;
}

function financialRowLabel(row: FinancialRow, language: Language) {
  if (language !== "ar") return row.labelEn || row.labelAr;
  return ({
    sales: "المبيعات",
    sales_collections: "المبيعات",
    purchases: "المشتريات",
    expenses: "المصروفات",
    recurring_expenses: "المصروفات الدورية",
    employee_payments: "رواتب وسلف الموظفين",
    final_settlement: "مخالصة نهاية الخدمة",
    vat: "الضريبة",
    other_inflows: "حركات داخلة أخرى",
    other_outflows: "حركات خارجة أخرى",
  } as Record<string, string>)[row.code] ?? row.labelAr;
}

function MarketingPanel({ language, session, period }: { language: Language; session: ActiveSession; period: BaseerPeriodRange }) {
  const text = copy[language]; const query = useMemo(() => new URLSearchParams({ from: period.from, to: period.to }), [period.from, period.to]);
  return <BaseerCompanyReadQuery session={session} resource="command-center.marketing" scope={[period.from, period.to]} load={(current, signal) => api<MarketingRead>(current, `/marketing/calendar?${query.toString()}`, { signal })}>{({ data, loading, error, refetch }) => <section className="command-center__section" aria-busy={loading}>
    <header className="command-center__section-header"><div><h2>{text.marketing}</h2><p>{text.marketingDescription}</p></div><button type="button" className="command-center__link" onClick={() => { window.location.hash = pageRouteHash("marketing-calendar"); }}>{text.openMarketing}</button></header>
    {loading ? <BaseerCard className="command-center__loading">{text.loading}</BaseerCard> : null}
    {error ? <BaseerEmptyState title={presentBaseerLoadError(error, language, { ar: "قراءة التسويق", en: "the marketing read" })} action={<BaseerButton type="button" variant="secondary" onClick={() => void refetch().catch(() => undefined)}>{text.retry}</BaseerButton>} /> : null}
    {!loading && !error && data ? <MarketingReadView language={language} data={data} /> : null}
  </section>}</BaseerCompanyReadQuery>;
}

function MarketingReadView({ language, data }: { language: Language; data: MarketingRead }) {
  const [timelineMode, setTimelineMode] = useState<"daily" | "monthly" | "campaigns">("daily");
  const text = copy[language]; return <><div className="command-center__metrics command-center__metrics--marketing"><TextMetricCard label={text.campaigns} value={String(data.spendResult.campaignCount)} /><TextMetricCard label={text.plannedSpend} value={data.spendResult.plannedCampaignCost} /><TextMetricCard label={text.linkedSpend} value={data.spendResult.linkedActualSpend} /><TextMetricCard label={text.officialSales} value={data.spendResult.officialNetSales ?? "—"} /><TextMetricCard label={text.spendShare} value={data.spendResult.spendToSalesPercent === null ? "—" : `${data.spendResult.spendToSalesPercent}%`} /></div><div className="command-center__timeline-controls"><BaseerWorkspaceTabs ariaLabel={text.marketingChart} idPrefix="command-center-marketing-timeline" activeId={timelineMode} onChange={(next) => setTimelineMode(next as "daily" | "monthly" | "campaigns")} tabs={[{ id: "daily", label: text.daily }, { id: "monthly", label: text.monthly }, { id: "campaigns", label: text.campaignsView }]} /></div><Suspense fallback={<BaseerCard className="command-center__loading">{text.loading}</BaseerCard>}><LazyMarketingTimelineChart language={language} title={text.marketingChart} days={data.days} campaigns={data.campaigns} context={data.context} asOf={data.period.toBusinessDate} mode={timelineMode} /></Suspense><p className="command-center__boundary">{text.dataBoundary}</p></>;
}

function MarketingCalendarPanel({ language, session, initialMonth, canManageTarget }: { language: Language; session: ActiveSession; initialMonth: string; canManageTarget: boolean }) {
  const [month, setMonth] = useState(initialMonth);
  useEffect(() => setMonth(initialMonth), [initialMonth]);
  const { from, to } = marketingMonthRange(month);
  const query = useMemo(() => new URLSearchParams({ from, to }), [from, to]);
  return <BaseerCompanyReadQuery session={session} resource="command-center.marketing.calendar" scope={[month]} load={(current, signal) => api<MarketingRead>(current, `/marketing/calendar?${query.toString()}`, { signal })}>{({ data, loading, error, refetch }) => {
    const text = copy[language];
    if (loading) return <BaseerCard className="command-center__loading">{text.loading}</BaseerCard>;
    if (error) return <BaseerEmptyState title={presentBaseerLoadError(error, language, { ar: "تقويم التسويق", en: "the marketing calendar" })} action={<BaseerButton type="button" variant="secondary" onClick={() => void refetch().catch(() => undefined)}>{text.retry}</BaseerButton>} />;
    return data ? <MarketingCalendarView language={language} session={session} month={month} data={data} canManageTarget={canManageTarget} onMonthChange={setMonth} onSaved={() => void refetch().catch(() => undefined)} /> : null;
  }}</BaseerCompanyReadQuery>;
}

function MarketingCalendarView({ language, session, month, data, canManageTarget, onMonthChange, onSaved }: { language: Language; session: ActiveSession; month: string; data: MarketingRead; canManageTarget: boolean; onMonthChange: (month: string) => void; onSaved: () => void }) {
  const text = copy[language]; const storedTarget = data.salesTargets.find((target) => target.periodMonth === month)?.amount ?? "";
  const [targetAmount, setTargetAmount] = useState(storedTarget ? formatNumber(storedTarget) : ""); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [selectedDate, setSelectedDate] = useState<string | null>(null);
  useEffect(() => { setTargetAmount(storedTarget ? formatNumber(storedTarget) : ""); setMessage(""); setSelectedDate(null); }, [month, storedTarget]);
  const eventsByDate = new Map(data.days.map((day) => [day.businessDate, data.context.filter((event) => event.startsOn <= day.businessDate && event.endsOn >= day.businessDate)]));
  const daysByDate = new Map(data.days.map((day) => [day.businessDate, day]));
  const averagesByWeekday = new Map(data.weekdayAverages.map((average) => [average.weekday, average]));
  const monthEvents = data.context.filter((event) => event.startsOn.slice(0, 7) <= month && event.endsOn.slice(0, 7) >= month);
  const weekdayLabels = language === "ar" ? ["الأحد", "الاثنين", "الثلاثاء", "الأربعاء", "الخميس", "الجمعة", "السبت"] : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const cells = monthCells(month);
  const selectedDay = daysByDate.get(selectedDate ?? data.days[0]?.businessDate ?? "") ?? data.days[0];
  const selectedEvents = selectedDay ? eventsByDate.get(selectedDay.businessDate) ?? [] : [];
  const selectedStatus = calendarTargetStatus(selectedDay, storedTarget);
  const saveTarget = async () => {
    const normalizedTargetAmount = targetAmount.replaceAll(",", "");
    if (!canManageTarget || !/^\d+(\.\d{1,4})?$/.test(normalizedTargetAmount) || Number(normalizedTargetAmount) <= 0) return;
    setBusy(true); setMessage("");
    try { const idempotencyKey = requestId(); await api(session, `/marketing/sales-targets/${month}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ amount: normalizedTargetAmount, idempotencyKey }) }); onSaved(); }
    catch (error) { setMessage(presentBaseerLoadError(error, language, { ar: "هدف المبيعات", en: "the sales target" })); }
    finally { setBusy(false); }
  };
  return <BaseerCard className="command-center__calendar" padding="compact">
    <header className="command-center__calendar-header"><div><h3>{text.calendar}</h3><small>{text.calendarMonth}</small></div><input aria-label={text.calendarMonth} type="month" value={month} onChange={(event) => event.target.value && onMonthChange(event.target.value)} /></header>
    <div className="command-center__target"><span>{text.salesTarget}</span>{canManageTarget ? <div><BaseerMoneyInput value={targetAmount} onValueChange={setTargetAmount} placeholder="0.00" aria-label={text.salesTarget} /><BaseerButton type="button" variant="secondary" disabled={busy || !targetAmount} onClick={() => void saveTarget()}>{busy ? text.saving : text.saveTarget}</BaseerButton></div> : <bdi dir="ltr">{storedTarget || text.noTarget}</bdi>}</div>
    {monthEvents.length ? <section className="command-center__calendar-events" aria-label={text.monthEvents}><strong>{text.monthEvents}</strong><div>{monthEvents.map((event) => <button type="button" key={event.id} onClick={() => { window.location.hash = pageRouteHash("decision-timeline"); }}><span>{event.titleAr}</span><small dir="ltr">{event.startsOn} — {event.endsOn}</small></button>)}</div></section> : null}
    {message ? <p className="command-center__calendar-message">{message}</p> : null}<div className="command-center__calendar-legend" aria-label={text.salesTarget}><span className="is-below">{text.targetBelow}</span><span className="is-near">{text.targetNear}</span><span className="is-met">{text.targetMet}</span><span className="is-exceeded">{text.targetExceeded}</span><span className="is-no-sales">{text.targetNoSales}</span></div>
    <div className="command-center__calendar-body"><div><div className="command-center__calendar-weekdays">{weekdayLabels.map((label, weekday) => { const average = averagesByWeekday.get(weekday); return <span key={label} className="command-center__calendar-weekday"><strong>{label}</strong>{average?.averageOfficialNetSales ? <bdi dir="ltr">{formatNumber(average.averageOfficialNetSales)}</bdi> : null}</span>; })}</div><div className="command-center__calendar-grid">{cells.map((date, index) => { if (!date) return <span key={`blank-${index}`} className="command-center__calendar-empty" aria-hidden="true" />; const day = daysByDate.get(date); const events = eventsByDate.get(date) ?? []; const status = calendarTargetStatus(day, storedTarget); const label = `${date}: ${day?.officialNetSales ?? text.targetNoSales}${events.length ? ` · ${text.event}: ${events.map((event) => event.titleAr).join("، ")}` : ""}`; return <button type="button" key={date} className={`command-center__calendar-day${selectedDay?.businessDate === date ? " is-selected" : ""}${events.length ? " has-event" : ""} is-${status.toLowerCase().replaceAll("_", "-")}`} aria-label={label} title={label} onClick={() => setSelectedDate(date)}><bdi className="command-center__calendar-day-number" dir="ltr">{Number(date.slice(8))}</bdi><small className="command-center__calendar-day-sales" dir="ltr">{formatNumber(day?.officialNetSales)}</small>{events.length ? <span className="command-center__calendar-day-event">{events[0]?.titleAr}{events.length > 1 ? ` +${events.length - 1}` : ""}</span> : null}</button>; })}</div></div>
      <aside className={`command-center__calendar-detail is-${selectedStatus.toLowerCase().replaceAll("_", "-")}`}><header><strong>{text.dayDetails}</strong><bdi dir="ltr">{selectedDay?.businessDate}</bdi></header><dl><div><dt>{text.daySales}</dt><dd dir="ltr">{formatNumber(selectedDay?.officialNetSales)}</dd></div><div><dt>{text.dayTarget}</dt><dd dir="ltr">{formatNumber(storedTarget)}</dd></div><div><dt>{text.dayStatus}</dt><dd>{targetStatusLabel(text, selectedStatus)}</dd></div></dl>{selectedEvents.length ? <div className="command-center__calendar-detail-events">{selectedEvents.map((event) => <button type="button" key={event.id} onClick={() => { window.location.hash = pageRouteHash("decision-timeline"); }}><strong>{event.titleAr}</strong><small dir="ltr">{event.startsOn} — {event.endsOn}</small></button>)}</div> : <p>{text.noEvent}</p>}</aside></div>
  </BaseerCard>;
}

function marketingMonthRange(month: string) { const [year, calendarMonth] = month.split("-").map(Number); const from = `${month}-01`; const to = new Date(Date.UTC(year, calendarMonth, 0)).toISOString().slice(0, 10); return { from, to }; }
function previousCalendarPeriod(from: string, to: string) { const shift = (value: string) => { const date = new Date(`${value}T00:00:00.000Z`); const day = date.getUTCDate(); const previousMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)); const lastDay = new Date(Date.UTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1, 0)).getUTCDate(); return new Date(Date.UTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth(), Math.min(day, lastDay))).toISOString().slice(0, 10); }; return { from: shift(from), to: shift(to) }; }
function previousMonthValue(month: string) { const [year, value] = month.split("-").map(Number); return `${value === 1 ? year - 1 : year}-${String(value === 1 ? 12 : value - 1).padStart(2, "0")}`; }
function monthPeriod(month: string) { const [year, value] = month.split("-").map(Number); return { from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(year, value, 0)).getUTCDate()).padStart(2, "0")}` }; }
function monthCells(month: string) { const [year, calendarMonth] = month.split("-").map(Number); const count = new Date(Date.UTC(year, calendarMonth, 0)).getUTCDate(); const offset = new Date(Date.UTC(year, calendarMonth - 1, 1)).getUTCDay(); return [...Array<string | null>(offset).fill(null), ...Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)]; }
function calendarTargetStatus(day: MarketingDay | undefined, target: string) {
  if (!target) return "NO_TARGET" as const;
  if (!day?.officialNetSales) return "NO_SALES" as const;
  const progress = Number(day.officialNetSales) / Number(target);
  return progress < .8 ? "BELOW" as const : progress < 1 ? "NEAR" as const : progress < 1.2 ? "MET" as const : "EXCEEDED" as const;
}
function targetStatusLabel(text: typeof copy[Language], status: ReturnType<typeof calendarTargetStatus>) {
  return status === "BELOW" ? text.targetBelow : status === "NEAR" ? text.targetNear : status === "MET" ? text.targetMet : status === "EXCEEDED" ? text.targetExceeded : status === "NO_SALES" ? text.targetNoSales : text.noTarget;
}

function TextMetricCard({ label, value }: { label: string; value: string }) { return <BaseerCard className="command-center__metric" padding="compact"><small>{label}</small><bdi className="command-center__money" dir="ltr">{value}</bdi></BaseerCard>; }
