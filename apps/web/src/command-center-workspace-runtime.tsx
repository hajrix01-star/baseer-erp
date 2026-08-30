import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { BaseerApiError, presentBaseerLoadError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerMenu } from "./baseer-menu";
import { BaseerPeriodFilter, baseerPeriodRange, defaultBaseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import { BaseerEmptyState, BaseerSectionHeader, BaseerWorkspace } from "./baseer-workspace";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { formatCount, formatDate, formatMoney, formatMonthYear, formatNumber, formatPercent } from "./number-format";
import "./command-center-shell.css";

import { pageRouteHash } from "./page-registry";

// ECharts is useful only after the relevant server read is ready. Keeping its
// runtime out of the selected route's first paint preserves the textual read
// and accessible loading state without delaying the initial workspace shell.
const BaseerMarketingTimelineChart = lazy(async () => ({ default: (await import("./baseer-chart")).BaseerMarketingTimelineChart }));
const CommandCenterEvidenceDialog = lazy(async () => ({ default: (await import("./command-center-evidence-dialog")).CommandCenterEvidenceDialog }));
const CommandCenterDeferredStyles = lazy(async () => ({ default: (await import("./command-center-deferred-styles")).CommandCenterDeferredStyles }));
const WeeklySalesAverageCard = lazy(async () => ({ default: (await import("./command-center-weekly-sales-card")).WeeklySalesAverageCard }));
const DailySalesSignIn = lazy(async () => ({ default: (await import("./daily-sales-sign-in")).DailySalesSignIn }));
const BaseerMoneyInput = lazy(async () => ({ default: (await import("./baseer-form-fields")).BaseerMoneyInput }));
const BaseerMonthPicker = lazy(async () => ({ default: (await import("./baseer-form-fields")).BaseerMonthPicker }));

type Language = "ar" | "en";
type MoneyDisplay = Readonly<{ raw: string; display: string; sign: "positive" | "negative" | "zero" }>;
type FinancialRow = Readonly<{ code: string; labelAr: string; labelEn: string; kind: "SECTION" | "LINE"; parentCode: string | null; direction: "INFLOW" | "OUTFLOW"; eventCount: number; amount: MoneyDisplay; shareOfCollectedSalesPercent: string | null; rankWithinParent: number; shareOfDirectionPercent: string | null; shareOfParentPercent: string | null }>;
type FinancialEvidenceRow = Pick<FinancialRow, "code" | "labelAr" | "labelEn" | "kind" | "parentCode" | "direction">;
type FinancialTotals = Readonly<{ inflows: MoneyDisplay; outflows: MoneyDisplay; netCashResult: MoneyDisplay; netCashResultShareOfCollectedSalesPercent: string | null }>;
type VaultLedgerItem = Readonly<{ vaultId: string; vaultNameAr: string; vaultNameEn: string; inflows: MoneyDisplay; outflows: MoneyDisplay; balance: MoneyDisplay }>;
type FinancialEvidence = Readonly<{ rowCode: string; nextCursor: string | null; items: readonly Readonly<{ eventId: string; businessDate: string; amount: MoneyDisplay; source: { journalEntryId: string; labelAr: string; labelEn: string; reference: string; origin: { labelAr: string; labelEn: string; route: string } } }>[] }>;
type SourceJournal = Readonly<{ journalEntry: { businessDate: string; sourceType: string; sourceReference: string; description: string | null; status: "POSTED" | "REVERSED"; lines: readonly { id: string; lineNumber: number; accountCode: string; accountNameAr: string; accountNameEn: string; debitAmount: string; creditAmount: string }[] } }>;
type FinancialReport =
  | Readonly<{ state: "NOT_READY" | "COVERAGE_INCOMPLETE"; messageAr: string }>
  | Readonly<{ state: "NO_DATA"; messageAr: string; rows: readonly []; vaults: readonly []; totals: FinancialTotals }>
  | Readonly<{ state: "READY"; selectedPeriod: { from: string; to: string }; rows: readonly FinancialRow[]; vaults: readonly VaultLedgerItem[]; totals: FinancialTotals; comparison: { state: "READY" | "UNAVAILABLE"; netCashResultPercentChange: string | null } }>;

type MarketingCampaign = Readonly<{ id: string; titleAr: string; titleEn: string | null }>;
type MarketingDay = Readonly<{ businessDate: string; officialGrossSales: string | null; officialNetSales: string | null; customerCount: number | null; salesDayQuality: "READY" | "PENDING" | "PARTIAL" | "MISSING"; dailySalesTarget: string | null; targetStatus: "NO_TARGET" | "NO_SALES" | "BELOW" | "NEAR" | "MET" | "EXCEEDED"; linkedActualSpend: string | null; linkedFinancialDocumentCount: number; campaignSpend: readonly { campaignId: string; amount: string; documentCount: number }[]; financialOutflows: string | null; financialOutflowDocumentCount: number; purchaseOutflows: string | null; purchaseOutflowDocumentCount: number; activeCampaignIds: readonly string[] }>;
type MarketingTimelineAmount = Readonly<{ amount: string | null; chartValue: number | null; display: string | null }>;
type MarketingTimeline = Readonly<{ daily: { rows: readonly Readonly<{ label: string; fromBusinessDate: string; toBusinessDate: string; sales: MarketingTimelineAmount; campaignSpend: MarketingTimelineAmount; purchases: MarketingTimelineAmount; customerCount: number | null; salesDayQuality: "READY" | "PENDING" | "PARTIAL" | "MISSING"; activeCampaignIds: readonly string[]; campaignSpendByCampaign: readonly { campaignId: string; amount: string | null; chartValue: number | null; display: string | null; documentCount: number; barHeightPercent: number }[] }>[]; campaignLanes: readonly { campaignId: string; activeIndexes: readonly number[]; totalSpend: MarketingTimelineAmount; spendBars: readonly { campaignId: string; amount: string | null; chartValue: number | null; display: string | null; documentCount: number; barHeightPercent: number }[] }[] }; monthly: { rows: readonly Readonly<{ label: string; fromBusinessDate: string; toBusinessDate: string; sales: MarketingTimelineAmount; campaignSpend: MarketingTimelineAmount; purchases: MarketingTimelineAmount; customerCount: number | null; salesDayQuality: "READY" | "PENDING" | "PARTIAL" | "MISSING"; activeCampaignIds: readonly string[]; campaignSpendByCampaign: readonly { campaignId: string; amount: string | null; chartValue: number | null; display: string | null; documentCount: number; barHeightPercent: number }[] }>[]; campaignLanes: readonly { campaignId: string; activeIndexes: readonly number[]; totalSpend: MarketingTimelineAmount; spendBars: readonly { campaignId: string; amount: string | null; chartValue: number | null; display: string | null; documentCount: number; barHeightPercent: number }[] }[] } }>;
type MarketingRead = Readonly<{
  period: { fromBusinessDate: string; toBusinessDate: string; timezone: string };
  sales: { dataQuality: string; payload: { netAmount: string; customerCount: number }; coverage: { availableDays: number } };
  campaigns: readonly MarketingCampaign[];
  days: readonly MarketingDay[];
  timeline: MarketingTimeline;
  weekdayAverages: readonly { weekday: number; averageOfficialGrossSales: string | null; eligibleDayCount: number }[];
  salesTargets: readonly { periodMonth: string; amount: string }[];
  context: readonly { id: string; titleAr: string; startsOn: string; endsOn: string; verificationStatus: string }[];
  linkedActualGrossAmount: string;
  spendResult: { plannedCampaignCost: string | null; linkedActualSpend: string; officialGrossSales: string | null; spendToSalesPercent: string | null; campaignCount: number; salesDataQuality: string; conclusionAr: string; conclusionEn: string };
}>;
type MarketingTimelineReadResult = Readonly<{ current: MarketingRead; previous: MarketingRead }>;
type MarketingTimelineGranularity = "daily" | "monthly";
type MarketingTimelineLocalState = { granularity: MarketingTimelineGranularity; month: string; year: string };

const copy = {
  ar: {
    eyebrow: "مركز القيادة", title: "المال والتسويق",
    day: "اليوم", month: "الشهر", financial: "المال", vaultLedger: "دفتر الخزائن", vaultLedgerDescription: "حركة النقد عبر الخزائن والبنوك خلال الفترة المحددة.", cashIn: "إجمالي الداخل", cashOut: "إجمالي الخارج", netMovement: "صافي الحركة", comparedToPrevious: "مقارنة بالفترة المطابقة من الشهر السابق",
    share: "من المبيعات", financialChart: "الحركة المالية حسب البند", categoryChart: "تفصيل المشتريات والمصروفات حسب الفئة", shareBasis: "أساس النسبة", shareOfSpend: "من إجمالي الإنفاق", shareOfCollectedSales: "من إجمالي المبيعات", total: "المجموع", details: "تفصيل العمليات", sourceJournal: "العملية الأصلية", openSource: "فتح العملية الأصلية", openLocation: "فتحها في قسمها", back: "العودة للعمليات", loadingOperations: "جارٍ تحميل العمليات…", noOperations: "لا توجد عمليات ضمن هذا البند.", close: "إغلاق", debit: "مدين", credit: "دائن",
    marketing: "التسويق", marketingDescription: "الحملات المسجلة، المبيعات الرسمية، والصرف على الحملات.",
    campaigns: "الحملات في الفترة", plannedSpend: "التكلفة المخططة", linkedSpend: "الصرف على الحملات", officialSales: "المبيعات الرسمية", spendShare: "الصرف من المبيعات", marketingChart: "الخط الزمني للتسويق", marketingTimeline: "الخط الزمني", timelinePeriod: "فترة الخط الزمني", timelineMonth: "شهر الخط الزمني", timelineYear: "سنة الخط الزمني", calendar: "التقويم", daily: "يومي", monthly: "شهري", campaignsView: "الحملات", calendarMonth: "شهر التقويم", salesTarget: "هدف المبيعات", saveTarget: "حفظ الهدف", saving: "جارٍ الحفظ…", noTarget: "لا يوجد هدف لهذا الشهر", targetBelow: "أقل من 80٪", targetNear: "من 80٪ إلى أقل من 100٪", targetMet: "من 100٪ إلى أقل من 120٪", targetExceeded: "120٪ فأعلى", targetNoSales: "لا توجد قراءة مبيعات", event: "مناسبة", dayDetails: "تفاصيل اليوم", daySales: "مبيعات اليوم", dayTarget: "هدف اليوم", dayStatus: "حالة الهدف", noEvent: "لا توجد مناسبة مرتبطة بهذا اليوم", openContext: "فتح المناسبات والسياق",
    openMarketing: "فتح الأداء التسويقي", monthEvents: "مناسبات الشهر", loading: "جارٍ تحميل القراءة…", noData: "لا توجد بيانات مؤهلة للفترة المحددة.", noFinancialAccess: "لا تملك صلاحية قراءة التقرير المالي.", noMarketingAccess: "لا تملك صلاحية قراءة الأداء التسويقي.", retry: "إعادة المحاولة",
  },
  en: {
    eyebrow: "Command center", title: "Money and marketing",
    day: "Day", month: "Month", financial: "Money", vaultLedger: "Vault ledger", vaultLedgerDescription: "Cash movement across vaults and banks in the selected period.", cashIn: "Total inflow", cashOut: "Total outflow", netMovement: "Net movement", comparedToPrevious: "Compared with the matching prior-month period",
    share: "of sales", financialChart: "Financial movement by item", categoryChart: "Purchase and expense breakdown by category", shareBasis: "Share basis", shareOfSpend: "Of total spend", shareOfCollectedSales: "Of total sales", total: "Total", details: "Operation details", sourceJournal: "Original operation", openSource: "Open original operation", openLocation: "Open in its section", back: "Back to operations", loadingOperations: "Loading operations…", noOperations: "There are no operations for this item.", close: "Close", debit: "Debit", credit: "Credit",
    marketing: "Marketing", marketingDescription: "Recorded campaigns, official sales, and campaign spend.",
    campaigns: "Campaigns in period", plannedSpend: "Planned cost", linkedSpend: "Campaign spend", officialSales: "Official sales", spendShare: "Spend of sales", marketingChart: "Marketing timeline", marketingTimeline: "Timeline", timelinePeriod: "Timeline period", timelineMonth: "Timeline month", timelineYear: "Timeline year", calendar: "Calendar", daily: "Daily", monthly: "Monthly", campaignsView: "Campaigns", calendarMonth: "Calendar month", salesTarget: "Sales target", saveTarget: "Save target", saving: "Saving…", noTarget: "No target for this month", targetBelow: "Below 80%", targetNear: "80% to under 100%", targetMet: "100% to under 120%", targetExceeded: "120% or higher", targetNoSales: "No sales read", event: "Event", dayDetails: "Day details", daySales: "Day sales", dayTarget: "Day target", dayStatus: "Target status", noEvent: "No event is linked to this day", openContext: "Open events and context",
    openMarketing: "Open marketing performance", monthEvents: "Month events", loading: "Loading the read…", noData: "There is no eligible data for the selected period.", noFinancialAccess: "You cannot read the financial report.", noMarketingAccess: "You cannot read marketing performance.", retry: "Retry",
  },
} as const;

function hasCapability(codes: readonly string[] | null, capability: string) { return codes?.includes(capability) ?? false; }
function canRetryReadNow(error: unknown) {
  return !(error instanceof BaseerApiError && error.retry?.kind === "retry-after");
}
function moneyClass(money: MoneyDisplay) { return money.sign === "negative" ? "is-negative" : money.sign === "positive" ? "is-positive" : ""; }
function AnimatedMoney({ money, language: _language, showCurrency: _showCurrency = true }: { money: MoneyDisplay; language: Language; showCurrency?: boolean }) {
  // Financial display is sealed by the read model. The browser must not parse,
  // round, re-sign, or append currency to a raw financial amount.
  return <>{money.sign === "negative" ? "−" : ""}{money.display}</>;
}
function MoneyValue({ money, language, onClick, label }: { money: MoneyDisplay; language: Language; onClick?: () => void; label?: string }) {
  const value = <bdi className={`command-center__money ${moneyClass(money)}`} dir="ltr"><AnimatedMoney money={money} language={language} /></bdi>;
  return onClick ? <button type="button" className="command-center__amount-link" onClick={onClick} aria-label={label}>{value}</button> : value;
}
function PercentValue({ value }: { value: string | null }) { return <bdi className="command-center__share" dir="ltr">{value === null ? "—" : `${value}%`}</bdi>; }

/**
 * Command Center starts independent reads together. Keep their abort boundary
 * local to this route so opening it does not also pull the generic query
 * client into its first paint. The key includes the company and session
 * expiry, so a changed company/session can never render a previous read.
 */
function useCommandCenterRead<T>(session: ActiveSession, scope: readonly string[], load: (current: ActiveSession, signal: AbortSignal) => Promise<T>) {
  const scopeKey = scope.join("\u0001");
  const readKey = `${session.companyId}:${session.sessionExpiresAt}:${scopeKey}`;
  const loadRef = useRef(load); loadRef.current = load;
  const active = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ key: string; data: T | undefined; error: unknown; loading: boolean }>({ key: readKey, data: undefined, error: null, loading: true });
  const run = async () => {
    active.current?.abort();
    const controller = new AbortController(); active.current = controller;
    setState((current) => ({ key: readKey, data: current.key === readKey ? current.data : undefined, error: null, loading: true }));
    try {
      const data = await loadRef.current(session, controller.signal);
      if (!controller.signal.aborted) setState({ key: readKey, data, error: null, loading: false });
      return data;
    } catch (error) {
      if (!controller.signal.aborted) setState((current) => ({ key: readKey, data: current.key === readKey ? current.data : undefined, error, loading: false }));
      throw error;
    }
  };
  useEffect(() => { void run().catch(() => undefined); return () => active.current?.abort(); }, [readKey]);
  const matching = state.key === readKey;
  return { data: matching ? state.data : undefined, loading: matching ? state.loading : true, error: matching ? state.error : null, refetch: async () => { await run(); } };
}

export function CommandCenterWorkspaceRuntime({ language, permissionCodes, section = 0 }: { language: Language; permissionCodes: readonly string[] | null; section?: number }) {
  const [period, setPeriod] = useState<BaseerPeriodRange>(defaultBaseerPeriodRange);
  const session = activeSession(); const text = copy[language];
  if (!session) return <Suspense fallback={<BaseerCard aria-busy="true"><p role="status">{text.loading}</p></BaseerCard>}><DailySalesSignIn language={language} /></Suspense>;
  const financialAllowed = hasCapability(permissionCodes, "reports.read");
  const marketingAllowed = hasCapability(permissionCodes, "marketing.insights.read");
  const calendarSection = section === 1;
  const marketingSlot = marketingAllowed
    ? <MarketingPanel language={language} session={session} embedded />
    : <AccessCard title={text.marketing} message={text.noMarketingAccess} />;
  return <BaseerWorkspace className="command-center">
    <BaseerSectionHeader eyebrow={text.eyebrow} title={calendarSection ? text.calendar : text.title} actions={<div className="command-center__period-actions"><div className="command-center__period-shortcuts"><BaseerButton type="button" variant={period.preset === "DAY" ? "primary" : "secondary"} aria-pressed={period.preset === "DAY"} onClick={() => setPeriod(baseerPeriodRange("DAY"))}>{text.day}</BaseerButton><BaseerButton type="button" variant={period.preset === "MONTH" ? "primary" : "secondary"} aria-pressed={period.preset === "MONTH"} onClick={() => setPeriod(baseerPeriodRange("MONTH"))}>{text.month}</BaseerButton></div><div className="command-center__period-picker"><BaseerPeriodFilter language={language} value={period} onChange={setPeriod} presets={["DAY", "MONTH", "QUARTER", "YEAR", "RANGE"]} allowNonContiguousMonths={false} /></div></div>} />
    {permissionCodes === null ? <BaseerCard className="command-center__loading" aria-busy="true">{text.loading}</BaseerCard> : null}
    <section key={calendarSection ? "calendar" : "financial"} className={`command-center__sections${calendarSection ? " is-calendar" : " is-financial"}`}>
      {calendarSection ? marketingAllowed ? <MarketingCalendarPanel language={language} session={session} initialMonth={period.from.slice(0, 7)} canManageTarget={permissionCodes !== null && hasCapability(permissionCodes, "marketing.campaign.write")} /> : <AccessCard title={text.calendar} message={text.noMarketingAccess} /> : financialAllowed ? <FinancialPanel language={language} session={session} period={period} marketingSlot={marketingSlot} /> : <><AccessCard title={text.financial} message={text.noFinancialAccess} />{marketingSlot}</>}
    </section>
  </BaseerWorkspace>;
}

function AccessCard({ title, message }: { title: string; message: string }) { return <section className="command-center__section"><h2>{title}</h2><BaseerEmptyState title={message} /></section>; }

function FinancialPanel({ language, session, period, marketingSlot }: { language: Language; session: ActiveSession; period: BaseerPeriodRange; marketingSlot: ReactNode }) {
  const text = copy[language]; const query = useMemo(() => new URLSearchParams({ from: period.from, to: period.to, vatInclusive: "true" }), [period.from, period.to]);
  const [stableRead, setStableRead] = useState<{ data: FinancialReport; period: BaseerPeriodRange } | null>(null);
  const read = useCommandCenterRead(session, [period.preset, period.from, period.to], async (current, signal) => {
    return api<FinancialReport>(current, `/reports/personal-cash-performance?${query.toString()}`, { signal });
  });
  return <FinancialPanelRead language={language} session={session} period={period} marketingSlot={marketingSlot} data={read.data} loading={read.loading} error={read.error} refetch={read.refetch} stableRead={stableRead} onStableRead={setStableRead} />;
}

function FinancialPanelRead({ language, session, period, marketingSlot, data, loading, error, refetch, stableRead, onStableRead }: { language: Language; session: ActiveSession; period: BaseerPeriodRange; marketingSlot: ReactNode; data: FinancialReport | undefined; loading: boolean; error: unknown; refetch: () => Promise<void>; stableRead: { data: FinancialReport; period: BaseerPeriodRange } | null; onStableRead: (read: { data: FinancialReport; period: BaseerPeriodRange }) => void }) {
  const text = copy[language];
  useEffect(() => { if (data) onStableRead({ data, period }); }, [data, onStableRead, period]);
  const displayed = data ? { data, period } : stableRead;
  const report = displayed?.data.state === "READY" ? displayed.data : null;
  return <section className={`command-center__section${loading && displayed ? " is-refreshing" : ""}`} aria-busy={loading}>
    <FinancialRead language={language} session={session} period={displayed?.period ?? period} report={report} marketingSlot={marketingSlot} loading={loading && !displayed} error={error && !displayed ? error : null} onRetry={refetch} />
  </section>;
}

function FinancialRead({ language, session, period, report, marketingSlot, loading, error, onRetry }: { language: Language; session: ActiveSession; period: BaseerPeriodRange; report: Extract<FinancialReport, { state: "READY" }> | null; marketingSlot: ReactNode; loading: boolean; error: unknown | null; onRetry: () => Promise<void> }) {
  const text = copy[language];
  const [selectedRow, setSelectedRow] = useState<FinancialEvidenceRow | null>(null);
  const [evidence, setEvidence] = useState<FinancialEvidence | null>(null);
  const [source, setSource] = useState<SourceJournal | null>(null);
  const [sourceReference, setSourceReference] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  if (!report) {
    const financialContent = error
      ? <BaseerCard className="command-center__breakdown command-center__empty-card" padding="compact"><BaseerEmptyState title={presentBaseerLoadError(error, language, { ar: "القراءة المالية", en: "the financial read" })} action={canRetryReadNow(error) ? <BaseerButton type="button" variant="secondary" onClick={() => void onRetry().catch(() => undefined)}>{text.retry}</BaseerButton> : null} /></BaseerCard>
      : loading
        ? <BaseerCard className="command-center__breakdown command-center__loading" padding="compact" aria-busy>{text.loading}</BaseerCard>
        : <BaseerCard className="command-center__breakdown command-center__empty-card" padding="compact"><EmptyCardMessage language={language} /></BaseerCard>;
    // Keep the timeline mounted in the same grid position while financial data
    // loads. Both reads now start together, so the entire timeline does not
    // wait for the financial report before its cards and chart can render.
    const emptyRead = !loading && !error;
    return <><div className="command-center__financial-grid">{financialContent}{marketingSlot}</div>{emptyRead ? <><div className="command-center__money-support"><EmptySupportCard language={language} title={text.vaultLedger} /><EmptySupportCard language={language} title={language === "ar" ? "متوسط المبيعات اليومية" : "Daily sales average"} /><EmptySupportCard language={language} title={language === "ar" ? "متوسط المبيعات اليومية حسب أسبوع الشهر" : "Daily sales average by month week"} /></div><BaseerCard className="command-center__category-breakdown command-center__empty-card" padding="compact"><h3>{text.categoryChart}</h3><EmptyCardMessage language={language} /></BaseerCard></> : null}</>;
  }
  const topRows = report.rows.filter((row) => row.parentCode === null && row.code !== "sales_collections");
  // This chart deliberately shows only the operational category roots. Child
  // categories are drill-down detail and would make this high-level view noisy.
  // Outflows are shown as positive spend magnitudes; the signed result remains
  // exclusively in the financial-summary card beside it.
  const categoryRows = report.rows
    .filter((row) => row.parentCode === "purchases" || row.parentCode === "expenses" || row.parentCode === "recurring_expenses")
    .sort((left, right) => left.rankWithinParent - right.rankWithinParent);
  const openEvidence = async (row: FinancialEvidenceRow) => {
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller;
    setSelectedRow(row); setEvidence(null); setSource(null); setSourceReference(null); setSelectedEventId(null); setMessage(""); setBusy(true);
    try {
      const query = new URLSearchParams({ from: period.from, to: period.to, vatInclusive: "true", rowCode: row.code });
      const next = await api<FinancialEvidence>(session, `/reports/personal-cash-performance/live/evidence?${query.toString()}`, { signal: controller.signal });
      if (!controller.signal.aborted) setEvidence(next);
    } catch (error) { if (!controller.signal.aborted) setMessage(presentBaseerLoadError(error, language, { ar: "عمليات هذا البند", en: "this item's operations" })); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const openSource = async (eventId: string) => {
    abortRef.current?.abort(); const controller = new AbortController(); abortRef.current = controller;
    setMessage(""); setSourceReference(evidence?.items.find((item) => item.eventId === eventId)?.source.reference ?? null); setBusy(true);
    try {
      const query = new URLSearchParams({ from: period.from, to: period.to, vatInclusive: "true" });
      const next = await api<SourceJournal>(session, `/reports/personal-cash-performance/live/evidence/${eventId}/source?${query.toString()}`, { signal: controller.signal });
      if (!controller.signal.aborted) setSource(next);
    } catch (error) { if (!controller.signal.aborted) setMessage(presentBaseerLoadError(error, language, { ar: "العملية الأصلية", en: "the original operation" })); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  };
  const closeEvidence = () => { abortRef.current?.abort(); setSelectedRow(null); setEvidence(null); setSource(null); setSourceReference(null); setSelectedEventId(null); setMessage(""); setBusy(false); };
  const sourceTitle = source ? text.sourceJournal : selectedRow ? `${text.details} — ${financialRowLabel(selectedRow, language)}` : text.details;
  const categoryChart = categoryRows.length ? <BaseerCard className="command-center__category-breakdown command-center__breakdown" padding="compact"><h3>{text.categoryChart}</h3><div className="command-center__vault-ledger-table"><div className="command-center__vault-ledger-row is-head"><span>#</span><span>{text.details}</span><span>{text.shareOfSpend}</span><span>{text.shareOfCollectedSales}</span><span>{text.total}</span></div>{categoryRows.map((row) => <div className="command-center__vault-ledger-row" key={row.code}><span>{row.rankWithinParent}</span><strong><button type="button" className="command-center__amount-link" onClick={() => void openEvidence(row)}>{financialRowLabel(row, language)}</button></strong><PercentValue value={row.shareOfDirectionPercent} /><PercentValue value={row.shareOfCollectedSalesPercent} /><MoneyValue money={row.amount} language={language} label={`${text.details} — ${financialRowLabel(row, language)}`} onClick={() => void openEvidence(row)} /></div>)}</div></BaseerCard> : null;
  return <><Suspense fallback={null}><CommandCenterDeferredStyles /></Suspense><div className="command-center__financial-grid"><BaseerCard className="command-center__breakdown" padding="compact"><h3>{text.financialChart}</h3><ul>{topRows.map((row) => <li key={row.code}><span>{financialRowLabel(row, language)}</span><span><MoneyValue money={row.amount} language={language} label={`${text.details} — ${financialRowLabel(row, language)}`} onClick={() => void openEvidence(row)} /><small><PercentValue value={row.shareOfCollectedSalesPercent} /></small></span></li>)}</ul><footer className="command-center__breakdown-total"><span>{text.total}</span><MoneyValue money={report.totals.netCashResult} language={language} label={text.total} onClick={() => void openEvidence({ code: "net_cash_result", labelAr: text.total, labelEn: text.total, kind: "SECTION", parentCode: null, direction: report.totals.netCashResult.sign === "negative" ? "OUTFLOW" : "INFLOW" })} /></footer></BaseerCard>{marketingSlot}</div><div className="command-center__money-support"><VaultLedgerCard language={language} totals={report.totals} vaults={report.vaults} /><DailySalesAverageCard language={language} session={session} period={period} /><Suspense fallback={<BaseerCard aria-busy="true"><p role="status">{text.loading}</p></BaseerCard>}><WeeklySalesAverageCard language={language} session={session} period={period} /></Suspense></div>{categoryChart}{selectedRow ? <Suspense fallback={null}><CommandCenterEvidenceDialog open language={language} title={sourceTitle} busy={busy} onClose={closeEvidence} onRetry={() => void openEvidence(selectedRow)} message={message} selectedEventId={selectedEventId} onSelect={(eventId) => setSelectedEventId((current) => current === eventId ? null : eventId)} onOpenSource={openSource} onBack={() => { setSource(null); setSourceReference(null); }} evidence={evidence} source={source} reference={sourceReference} labels={{ retry: text.retry, close: text.close, loadingOperations: text.loadingOperations, noOperations: text.noOperations, details: text.details, openSource: text.openSource, openLocation: text.openLocation, back: text.back, debit: text.debit, credit: text.credit }} /></Suspense> : null}</>;
}

function EmptySupportCard({ language, title }: { language: Language; title: string }) {
  return <BaseerCard className="command-center__empty-card" padding="compact"><h3>{title}</h3><EmptyCardMessage language={language} /></BaseerCard>;
}

function EmptyCardMessage({ language }: { language: Language }) {
  return <p className="command-center__empty-message" role="status">{language === "ar" ? "لا توجد بيانات لهذه الفترة" : "No data for this period"}</p>;
}

function VaultLedgerCard({ language, totals, vaults }: { language: Language; totals: FinancialTotals; vaults: readonly VaultLedgerItem[] }) {
  const text = copy[language];
  return <BaseerCard className="command-center__vault-ledger command-center__breakdown" padding="compact"><header><div><h3>{text.vaultLedger}</h3><p>{text.vaultLedgerDescription}</p></div></header><div className="command-center__vault-ledger-table"><div className="command-center__vault-ledger-row is-head"><span>{language === "ar" ? "الخزينة" : "Vault"}</span><span>{text.cashIn}</span><span>{text.cashOut}</span><span>{language === "ar" ? "المتبقي" : "Balance"}</span></div>{vaults.map((vault) => <div className="command-center__vault-ledger-row" key={vault.vaultId}><strong>{language === "ar" ? vault.vaultNameAr : vault.vaultNameEn || vault.vaultNameAr}</strong><bdi className="is-inflow" dir="ltr"><AnimatedMoney money={vault.inflows} language={language} showCurrency={false} /></bdi><bdi className="is-outflow" dir="ltr"><AnimatedMoney money={vault.outflows} language={language} showCurrency={false} /></bdi><bdi className="is-balance" dir="ltr"><AnimatedMoney money={vault.balance} language={language} showCurrency={false} /></bdi></div>)}</div><footer className="command-center__breakdown-total"><span>{text.netMovement}</span><bdi className="command-center__vault-ledger-net" dir="ltr"><AnimatedMoney money={totals.netCashResult} language={language} showCurrency={false} /></bdi></footer></BaseerCard>;
}

type DailySalesAveragePeriod = Readonly<{ dataQuality: "READY" | "INCOMPLETE" | "NOT_STARTED"; coverage: { recordedSalesDays: number; requiredOperatingDays: number }; display: { dailyAverageSalesAmount: string | null; dailyAverageCustomerCount: string | null } }>;
type DailySalesAverageRead = Readonly<{ primary: { monthSummary: DailySalesAveragePeriod }; comparison: { monthSummary: DailySalesAveragePeriod } }>;

function DailySalesAverageCard({ language, session, period }: { language: Language; session: ActiveSession; period: BaseerPeriodRange }) {
  const month = period.from.slice(0, 7); const priorMonth = previousMonthValue(month); const [read, setRead] = useState<DailySalesAverageRead | null>(null);
  useEffect(() => { const controller = new AbortController(); const query = new URLSearchParams({ year: month.slice(0, 4), primaryMonth: month, comparisonMonth: priorMonth }); void api<DailySalesAverageRead>(session, `/finance/daily-sales/analytics?${query.toString()}`, { signal: controller.signal }).then((next) => !controller.signal.aborted && setRead(next)).catch(() => !controller.signal.aborted && setRead(null)); return () => controller.abort(); }, [month, priorMonth, session]);
  const ar = language === "ar";
  const averageRow = (label: string, note: string, value: DailySalesAveragePeriod | undefined) => <div className="command-center__daily-sales-average-row"><div><strong>{label}</strong><small>{note}{value ? ` · ${value.dataQuality === "READY" ? `${value.coverage.recordedSalesDays}/${value.coverage.requiredOperatingDays}` : (ar ? "بيانات ناقصة" : "Incomplete data")}` : ""}</small></div><bdi dir="ltr">{value?.display.dailyAverageSalesAmount ?? "—"}</bdi><bdi dir="ltr">{value?.display.dailyAverageCustomerCount ?? "—"}</bdi></div>;
  return <BaseerCard className="command-center__daily-sales-average" padding="compact"><header><div><h3>{ar ? "متوسط المبيعات اليومية" : "Daily sales average"}</h3><p>{ar ? "مبيعات شاملة الضريبة ومتوسط العملاء؛ القيم من قراءة خادمية مكتملة فقط" : "VAT-inclusive sales and customer averages from complete server reads only"}</p></div></header><div className="command-center__daily-sales-average-table" role="table" aria-label={ar ? "مقارنة متوسطات المبيعات اليومية" : "Daily sales average comparison"}><div className="command-center__daily-sales-average-row is-head" role="row"><span>{ar ? "الفترة" : "Period"}</span><span>{ar ? "متوسط المبيعات" : "Average sales"}</span><span>{ar ? "متوسط العملاء المسجلين" : "Average recorded customers"}</span></div>{averageRow(formatMonthYear(priorMonth, language), ar ? "الشهر السابق" : "Previous month", read?.comparison.monthSummary)}{averageRow(formatMonthYear(month, language), ar ? "الشهر المحدد" : "Selected month", read?.primary.monthSummary)}</div></BaseerCard>;
}

function financialRowLabel(row: FinancialEvidenceRow, language: Language) {
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

function MarketingPanel({ language, session, embedded = false }: { language: Language; session: ActiveSession; embedded?: boolean }) {
  const text = copy[language];
  return <section className={embedded ? "command-center__timeline-slot" : "command-center__section"}>
    {!embedded ? <header className="command-center__section-header"><div><h2>{text.marketing}</h2><p>{text.marketingDescription}</p></div><button type="button" className="command-center__link" onClick={() => { window.location.hash = pageRouteHash("marketing-calendar"); }}>{text.openMarketing}</button></header> : null}
    <MarketingTimelineRead language={language} session={session} />
  </section>;
}

function MarketingTimelineRead({ language, session }: { language: Language; session: ActiveSession }) {
  const storageKey = `baseer.command-center.marketing-timeline.${session.companyId}`;
  const initial = useState(() => readMarketingTimelineState(storageKey))[0];
  const [timelineGranularity, setTimelineGranularity] = useState<MarketingTimelineGranularity>(initial.granularity);
  const [month, setMonth] = useState(initial.month);
  const [year, setYear] = useState(initial.year);
  useEffect(() => { window.sessionStorage.setItem(storageKey, JSON.stringify({ granularity: timelineGranularity, month, year })); }, [month, storageKey, timelineGranularity, year]);
  const range = useMemo(() => timelineGranularity === "monthly" ? marketingYearRange(year) : marketingMonthRange(month), [month, timelineGranularity, year]);
  const comparisonRange = useMemo(() => previousMarketingTimelineRange(range, timelineGranularity), [range, timelineGranularity]);
  const query = useMemo(() => new URLSearchParams(range), [range]);
  const comparisonQuery = useMemo(() => new URLSearchParams(comparisonRange), [comparisonRange]);
  const text = copy[language];
  const updateYear = (nextYear: string) => { setYear(nextYear); setMonth((current) => `${nextYear}${current.slice(4)}`); };
  const [stableRead, setStableRead] = useState<{ data: MarketingTimelineReadResult; granularity: MarketingTimelineGranularity; month: string; year: string } | null>(null);
  const read = useCommandCenterRead(session, [timelineGranularity, month, year, range.from, range.to, comparisonRange.from, comparisonRange.to], async (current, signal) => {
    const [main, previous] = await Promise.all([
      api<MarketingRead>(current, `/marketing/calendar?${query.toString()}`, { signal }),
      api<MarketingRead>(current, `/marketing/calendar?${comparisonQuery.toString()}`, { signal }),
    ]);
    return { current: main, previous };
  });
  return <MarketingTimelineReadState language={language} text={text} data={read.data} loading={read.loading} error={read.error} refetch={read.refetch} granularity={timelineGranularity} onGranularityChange={setTimelineGranularity} month={month} onMonthChange={setMonth} year={year} onYearChange={updateYear} stableRead={stableRead} onStableRead={setStableRead} />;
}

function MarketingTimelineReadState({ language, text, data, loading, error, refetch, granularity, onGranularityChange, month, onMonthChange, year, onYearChange, stableRead, onStableRead }: { language: Language; text: typeof copy[Language]; data: MarketingTimelineReadResult | undefined; loading: boolean; error: unknown; refetch: () => Promise<void>; granularity: MarketingTimelineGranularity; onGranularityChange: (mode: MarketingTimelineGranularity) => void; month: string; onMonthChange: (month: string) => void; year: string; onYearChange: (year: string) => void; stableRead: { data: MarketingTimelineReadResult; granularity: MarketingTimelineGranularity; month: string; year: string } | null; onStableRead: (read: { data: MarketingTimelineReadResult; granularity: MarketingTimelineGranularity; month: string; year: string }) => void }) {
  useEffect(() => { if (data) onStableRead({ data, granularity, month, year }); }, [data, granularity, month, onStableRead, year]);
  const displayed = data ? { data, granularity, month, year } : stableRead;
  return <div className={loading && displayed ? "is-refreshing" : undefined} aria-busy={loading}>
    {loading && !displayed ? <MarketingTimelineSkeleton language={language} /> : null}
    {error && !displayed ? <BaseerEmptyState title={presentBaseerLoadError(error, language, { ar: "قراءة التسويق", en: "the marketing read" })} action={canRetryReadNow(error) ? <BaseerButton type="button" variant="secondary" onClick={() => void refetch().catch(() => undefined)}>{text.retry}</BaseerButton> : null} /> : null}
    {displayed ? <MarketingReadView language={language} data={displayed.data.current} previousData={displayed.data.previous} timelineGranularity={displayed.granularity} onTimelineGranularityChange={onGranularityChange} month={displayed.month} onMonthChange={onMonthChange} year={displayed.year} onYearChange={onYearChange} /> : null}
  </div>;
}

function MarketingTimelineSkeleton({ language }: { language: Language }) {
  const ar = language === "ar";
  return <section className="baseer-chart baseer-marketing-timeline baseer-marketing-timeline--command command-center__timeline-skeleton" aria-busy="true" aria-label={ar ? "جارٍ تجهيز الخط الزمني للتسويق" : "Preparing marketing timeline"}>
    <header className="baseer-marketing-timeline__header"><div><p className="baseer-marketing-timeline__eyebrow">{ar ? "مركز القيادة" : "Command center"}</p><h3>{ar ? "الخط الزمني للتسويق" : "Marketing timeline"}</h3><small>{ar ? "يُحمّل الرسم وبيانات الفترة معًا…" : "Loading the chart and period data together…"}</small></div><div className="command-center__marketing-summary" aria-hidden="true">{["sales", "spend", "customers"].map((key) => <div className="command-center__marketing-summary-card" key={key}><i /><i /><i /></div>)}</div></header>
    <div className="baseer-marketing-timeline__plot-shell"><div className="command-center__timeline-skeleton-toolbar" aria-hidden="true"><i /><i /><i /></div><div className="command-center__timeline-skeleton-plot" aria-hidden="true"><i /><i /><i /><i /><i /></div></div>
  </section>;
}

function MarketingReadView({ language, data, previousData, timelineGranularity, onTimelineGranularityChange, month, onMonthChange, year, onYearChange }: { language: Language; data: MarketingRead; previousData: MarketingRead | null; timelineGranularity: MarketingTimelineGranularity; onTimelineGranularityChange: (mode: MarketingTimelineGranularity) => void; month: string; onMonthChange: (month: string) => void; year: string; onYearChange: (year: string) => void }) {
  const text = copy[language];
  const headerMetrics = <MarketingSummaryCards language={language} data={data} previousData={previousData} />;
  const periodControl = <BaseerMenu label={text.timelinePeriod} trigger={<><strong>{timelineGranularity === "monthly" ? year : timelineMonthLabel(month, language)}</strong><span aria-hidden="true">⌄</span></>} triggerClassName="baseer-marketing-timeline__period-trigger" menuClassName="baseer-marketing-timeline__period-menu">{timelineGranularity === "monthly" ? timelineYearOptions(year).map((value) => <button key={value} type="button" role="menuitem" aria-current={value === year ? "true" : undefined} onClick={() => onYearChange(value)}>{value}</button>) : timelineMonthOptions(month).map((value) => <button key={value} type="button" role="menuitem" aria-current={value === month ? "true" : undefined} onClick={() => onMonthChange(value)}>{timelineMonthLabel(value, language)}</button>)}</BaseerMenu>;
  const fallback = <MarketingTimelineFallback language={language} title={text.marketingChart} headerMetrics={headerMetrics} />;
  return <><Suspense fallback={null}><CommandCenterDeferredStyles /></Suspense><Suspense fallback={fallback}><BaseerMarketingTimelineChart language={language} title={text.marketingChart} timeline={data.timeline} campaigns={data.campaigns} context={data.context} asOf={data.period.toBusinessDate} mode={timelineGranularity} showModeControls onModeChange={onTimelineGranularityChange} headerMetrics={headerMetrics} periodControl={periodControl} /></Suspense></>;
}

function MarketingTimelineFallback({ language, title, headerMetrics }: { language: Language; title: string; headerMetrics: ReactNode }) {
  const ar = language === "ar";
  return <section className="baseer-chart baseer-marketing-timeline baseer-marketing-timeline--command command-center__timeline-skeleton" aria-busy="true" aria-label={title}><header className="baseer-marketing-timeline__header"><div><p className="baseer-marketing-timeline__eyebrow">{ar ? "مركز القيادة" : "Command center"}</p><h3>{title}</h3><small>{ar ? "جارٍ تجهيز الرسم…" : "Preparing the chart…"}</small></div><div className="baseer-marketing-timeline__header-meta">{headerMetrics}</div></header><div className="baseer-marketing-timeline__plot-shell"><div className="command-center__timeline-skeleton-toolbar" aria-hidden="true"><i /><i /><i /></div><div className="command-center__timeline-skeleton-plot" aria-hidden="true"><i /><i /><i /><i /><i /></div></div></section>;
}

function MarketingSummaryCards({ language, data, previousData }: { language: Language; data: MarketingRead; previousData: MarketingRead | null }) {
  const text = copy[language];
  const items = [
    { id: "campaigns", label: text.campaigns, value: formatCount(data.campaigns.length, language) },
    { id: "planned", label: text.plannedSpend, value: formatMoney(data.spendResult.plannedCampaignCost, "SAR", language) },
    { id: "spend", label: text.linkedSpend, value: formatMoney(data.spendResult.linkedActualSpend, "SAR", language) },
    { id: "sales", label: text.officialSales, value: data.spendResult.officialGrossSales === null ? "—" : formatMoney(data.spendResult.officialGrossSales, "SAR", language) },
    { id: "share", label: text.spendShare, value: formatPercent(data.spendResult.spendToSalesPercent, 2, language) },
  ];
  return <div className="baseer-marketing-timeline__metrics command-center__metrics command-center__metrics--marketing" aria-label={language === "ar" ? "ملخص الأداء التسويقي" : "Marketing performance summary"}>{items.map((item) => <TextMetricCard key={item.id} label={item.label} value={item.value} />)}</div>;
}

function MarketingCalendarPanel({ language, session, initialMonth, canManageTarget }: { language: Language; session: ActiveSession; initialMonth: string; canManageTarget: boolean }) {
  const [month, setMonth] = useState(initialMonth);
  useEffect(() => setMonth(initialMonth), [initialMonth]);
  const { from, to } = marketingMonthRange(month);
  const query = useMemo(() => new URLSearchParams({ from, to }), [from, to]);
  const read = useCommandCenterRead(session, [month], (current, signal) => api<MarketingRead>(current, `/marketing/calendar?${query.toString()}`, { signal }));
  const text = copy[language];
  if (read.loading) return <BaseerCard className="command-center__loading">{text.loading}</BaseerCard>;
  if (read.error) return <BaseerEmptyState title={presentBaseerLoadError(read.error, language, { ar: "تقويم التسويق", en: "the marketing calendar" })} action={canRetryReadNow(read.error) ? <BaseerButton type="button" variant="secondary" onClick={() => void read.refetch().catch(() => undefined)}>{text.retry}</BaseerButton> : null} />;
  return read.data ? <Suspense fallback={<BaseerCard className="command-center__loading" aria-busy="true"><p role="status">{text.loading}</p></BaseerCard>}><CommandCenterDeferredStyles /><MarketingCalendarView language={language} session={session} month={month} data={read.data} canManageTarget={canManageTarget} onMonthChange={setMonth} onSaved={() => void read.refetch().catch(() => undefined)} /></Suspense> : null;
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
  const selectedStatus = calendarTargetStatus(selectedDay);
  const saveTarget = async () => {
    const normalizedTargetAmount = targetAmount.replaceAll(",", "");
    if (!canManageTarget || !/^\d+(\.\d{1,4})?$/.test(normalizedTargetAmount) || Number(normalizedTargetAmount) <= 0) return;
    setBusy(true); setMessage("");
    try { const idempotencyKey = requestId(); await api(session, `/marketing/sales-targets/${month}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ amount: normalizedTargetAmount, idempotencyKey }) }); onSaved(); }
    catch (error) { setMessage(presentBaseerLoadError(error, language, { ar: "هدف المبيعات", en: "the sales target" })); }
    finally { setBusy(false); }
  };
  return <BaseerCard className="command-center__calendar" padding="compact">
    <header className="command-center__calendar-header"><span>{text.calendarMonth}</span><BaseerMonthPicker aria-label={text.calendarMonth} value={month} onChange={(event) => event.target.value && onMonthChange(event.target.value)} /></header>
    <div className="command-center__target"><span>{text.salesTarget}</span>{canManageTarget ? <div><BaseerMoneyInput value={targetAmount} onValueChange={setTargetAmount} placeholder="0.00" aria-label={text.salesTarget} /><BaseerButton type="button" variant="secondary" disabled={busy || !targetAmount} onClick={() => void saveTarget()}>{busy ? text.saving : text.saveTarget}</BaseerButton></div> : <bdi dir="ltr">{storedTarget || text.noTarget}</bdi>}{monthEvents.length ? <section className="command-center__calendar-events" aria-label={text.monthEvents}><strong>{text.monthEvents}</strong><div>{monthEvents.map((event) => <button type="button" key={event.id} onClick={() => { window.location.hash = pageRouteHash("decision-timeline"); }}><span>{event.titleAr}</span><small dir="ltr">{event.startsOn} — {event.endsOn}</small></button>)}</div></section> : null}</div>
    {message ? <p className="command-center__calendar-message">{message}</p> : null}<div className="command-center__calendar-legend" aria-label={text.salesTarget}><span className="is-below">{text.targetBelow}</span><span className="is-near">{text.targetNear}</span><span className="is-met">{text.targetMet}</span><span className="is-exceeded">{text.targetExceeded}</span><span className="is-no-sales">{text.targetNoSales}</span></div>
    <div className="command-center__calendar-body"><div><div className="command-center__calendar-weekdays">{weekdayLabels.map((label, weekday) => { const average = averagesByWeekday.get(weekday); return <span key={label} className="command-center__calendar-weekday"><strong>{label}</strong>{average?.averageOfficialGrossSales ? <bdi dir="ltr">{formatNumber(average.averageOfficialGrossSales)}</bdi> : null}</span>; })}</div><div className="command-center__calendar-grid">{cells.map((date, index) => { if (!date) return <span key={`blank-${index}`} className="command-center__calendar-empty" aria-hidden="true" />; const day = daysByDate.get(date); const events = eventsByDate.get(date) ?? []; const status = calendarTargetStatus(day); const label = `${date}: ${day?.officialGrossSales ?? text.targetNoSales}${events.length ? ` · ${text.event}: ${events.map((event) => event.titleAr).join("، ")}` : ""}`; return <button type="button" key={date} className={`command-center__calendar-day${selectedDay?.businessDate === date ? " is-selected" : ""}${events.length ? " has-event" : ""} is-${status.toLowerCase().replaceAll("_", "-")}`} aria-label={label} title={label} onClick={() => setSelectedDate(date)}><bdi className="command-center__calendar-day-number" dir="ltr">{Number(date.slice(8))}</bdi><small className="command-center__calendar-day-sales" dir="ltr">{formatNumber(day?.officialGrossSales)}</small>{events.length ? <span className="command-center__calendar-day-event">{events[0]?.titleAr}{events.length > 1 ? ` +${events.length - 1}` : ""}</span> : null}</button>; })}</div></div>
      <aside className={`command-center__calendar-detail is-${selectedStatus.toLowerCase().replaceAll("_", "-")}`}><header><strong>{text.dayDetails}</strong><bdi dir="ltr">{selectedDay?.businessDate}</bdi></header><dl><div><dt>{text.daySales}</dt><dd dir="ltr">{formatNumber(selectedDay?.officialGrossSales)}</dd></div><div><dt>{text.dayTarget}</dt><dd dir="ltr">{formatNumber(selectedDay?.dailySalesTarget)}</dd></div><div><dt>{text.dayStatus}</dt><dd>{targetStatusLabel(text, selectedStatus)}</dd></div><div className="command-center__calendar-detail-events"><dt>{text.event}</dt><dd>{selectedEvents.length ? selectedEvents.map((event) => <button type="button" key={event.id} onClick={() => { window.location.hash = pageRouteHash("decision-timeline"); }}><strong>{event.titleAr}</strong><small dir="ltr">{event.startsOn} — {event.endsOn}</small></button>) : <span>{text.noEvent}</span>}</dd></div></dl></aside></div>
  </BaseerCard>;
}

function marketingMonthRange(month: string) { const [year, calendarMonth] = month.split("-").map(Number); const from = `${month}-01`; const to = new Date(Date.UTC(year, calendarMonth, 0)).toISOString().slice(0, 10); return { from, to }; }
function marketingYearRange(year: string) { return { from: `${year}-01-01`, to: `${year}-12-31` }; }
function previousMarketingTimelineRange(range: Readonly<{ from: string; to: string }>, granularity: MarketingTimelineGranularity) { return granularity === "monthly" ? marketingYearRange(String(Number(range.from.slice(0, 4)) - 1)) : marketingMonthRange(previousMonthValue(range.from.slice(0, 7))); }
function timelineYearOptions(selectedYear: string) { const currentYear = new Date().getUTCFullYear(); const start = Math.min(Number(selectedYear), currentYear - 5); const end = Math.max(Number(selectedYear), currentYear + 1); return Array.from({ length: end - start + 1 }, (_, index) => String(start + index)); }
function timelineMonthOptions(selectedMonth: string) { const year = selectedMonth.slice(0, 4); return Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`); }
function timelineMonthLabel(value: string, language: Language) { return formatMonthYear(value, language); }
function readMarketingTimelineState(storageKey: string): MarketingTimelineLocalState { const fallbackMonth = defaultBaseerPeriodRange().from.slice(0, 7); const fallback: MarketingTimelineLocalState = { granularity: "daily", month: fallbackMonth, year: fallbackMonth.slice(0, 4) }; try { const value = JSON.parse(window.sessionStorage.getItem(storageKey) ?? "null") as Partial<MarketingTimelineLocalState> & { mode?: string } | null; if (!value || typeof value.month !== "string" || !/^\d{4}-\d{2}$/.test(value.month) || typeof value.year !== "string" || !/^\d{4}$/.test(value.year)) return fallback; return { granularity: value.granularity === "monthly" || value.mode === "monthly" ? "monthly" : "daily", month: value.month, year: value.year }; } catch { return fallback; } }
function previousCalendarPeriod(from: string, to: string) { const shift = (value: string) => { const date = new Date(`${value}T00:00:00.000Z`); const day = date.getUTCDate(); const previousMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1)); const lastDay = new Date(Date.UTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth() + 1, 0)).getUTCDate(); return new Date(Date.UTC(previousMonth.getUTCFullYear(), previousMonth.getUTCMonth(), Math.min(day, lastDay))).toISOString().slice(0, 10); }; return { from: shift(from), to: shift(to) }; }
function previousMonthValue(month: string) { const [year, value] = month.split("-").map(Number); return `${value === 1 ? year - 1 : year}-${String(value === 1 ? 12 : value - 1).padStart(2, "0")}`; }
function monthPeriod(month: string) { const [year, value] = month.split("-").map(Number); return { from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(year, value, 0)).getUTCDate()).padStart(2, "0")}` }; }
function monthCells(month: string) { const [year, calendarMonth] = month.split("-").map(Number); const count = new Date(Date.UTC(year, calendarMonth, 0)).getUTCDate(); const offset = new Date(Date.UTC(year, calendarMonth - 1, 1)).getUTCDay(); return [...Array<string | null>(offset).fill(null), ...Array.from({ length: count }, (_, index) => `${month}-${String(index + 1).padStart(2, "0")}`)]; }
function calendarTargetStatus(day: MarketingDay | undefined) {
  return day?.targetStatus ?? "NO_TARGET" as const;
}
function targetStatusLabel(text: typeof copy[Language], status: ReturnType<typeof calendarTargetStatus>) {
  return status === "BELOW" ? text.targetBelow : status === "NEAR" ? text.targetNear : status === "MET" ? text.targetMet : status === "EXCEEDED" ? text.targetExceeded : status === "NO_SALES" ? text.targetNoSales : text.noTarget;
}

function TextMetricCard({ label, value }: { label: string; value: string }) { return <BaseerCard className="command-center__metric" padding="compact"><small>{label}</small><bdi className="command-center__money" dir="ltr">{value}</bdi></BaseerCard>; }
