import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BaseerButton } from "./baseer-button";
import { downloadBaseerChartPng, printBaseerChartImage } from "./baseer-chart-output";
import { BaseerDialog } from "./baseer-dialog";
import { chartAlpha, useBaseerChartPalette } from "./baseer-chart-theme";
import { formatCompactNumber, formatCount, formatDate, formatMoney, formatMonthYear, formatNumber, formatPercent, formatYear } from "./number-format";

use([BarChart, LineChart, GridComponent, TooltipComponent, CanvasRenderer]);

type Language = "ar" | "en";

/**
 * The sole lifecycle boundary for ECharts canvases in the web application.
 * Feature charts supply server-owned series and presentation options, while
 * this primitive owns registration, resize handling and disposal.
 */
export type BaseerEChartsCanvasRenderer = (chart: ReturnType<typeof init>, element: HTMLDivElement) => void;

export function useBaseerEChartsCanvas(render: BaseerEChartsCanvasRenderer) {
  const element = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = element.current;
    if (!container) return;

    const chart = init(container, undefined, { renderer: "canvas" });
    const renderChart = () => {
      chart.resize();
      render(chart, container);
    };
    renderChart();
    const observer = new ResizeObserver(renderChart);
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.dispose();
    };
  }, [render]);

  return element;
}
export type BaseerOperationalChartPoint = { id?: string; label: string; value: number; displayValue?: string; rank?: number; shareOfTotalPercent?: string };
export type BaseerMarketingTimelineAmount = Readonly<{ amount: string | null; chartValue: number | null; display: string | null }>;
export type BaseerMarketingTimelineCampaignAmount = BaseerMarketingTimelineAmount & Readonly<{ campaignId: string; documentCount: number; barHeightPercent: number }>;
export type BaseerMarketingTimelineRow = Readonly<{
  label: string; fromBusinessDate: string; toBusinessDate: string;
  sales: BaseerMarketingTimelineAmount; campaignSpend: BaseerMarketingTimelineAmount; purchases: BaseerMarketingTimelineAmount;
  customerCount: number | null; salesDayQuality: "READY" | "PENDING" | "PARTIAL" | "MISSING";
  activeCampaignIds: readonly string[]; campaignSpendByCampaign: readonly BaseerMarketingTimelineCampaignAmount[];
}>;
export type BaseerMarketingTimelineDataset = Readonly<{
  rows: readonly BaseerMarketingTimelineRow[];
  campaignLanes: readonly Readonly<{ campaignId: string; activeIndexes: readonly number[]; totalSpend: BaseerMarketingTimelineAmount; spendBars: readonly BaseerMarketingTimelineCampaignAmount[] }>[];
}>;
export type BaseerMarketingTimeline = Readonly<{ daily: BaseerMarketingTimelineDataset; monthly: BaseerMarketingTimelineDataset }>;
export type BaseerMarketingTimelineCampaign = { id: string; titleAr: string; titleEn: string | null };
export type BaseerMarketingTimelineContext = { id: string; titleAr: string; startsOn: string; endsOn: string };
export type BaseerOperationsMonthDay = {
  businessDate: string;
  sales: { dataQuality: "READY" | "INCOMPLETE" | "NO_DATA"; displayGrossAmount: string | null; plotValue: number | null };
  purchases: { dataQuality: "READY"; displayGrossAmount: string; displayDocumentCount: string; plotValue: number };
};

/** A local, accessible visualisation of server-provided operational totals. */
export function BaseerChart({ language, title, points, asOf, showSummary = true, presentation = "chart", inlineShareLabel, headerActions, onPointClick }: {
  language: Language;
  title: string;
  points: readonly BaseerOperationalChartPoint[];
  asOf: string;
  /** Keep provenance copy available by default, but allow focused dashboard charts. */
  showSummary?: boolean;
  /** A compact, non-duplicating chart rendered inside the data table. */
  presentation?: "chart" | "inlineRows";
  /** The denominator label used by an inline share column. */
  inlineShareLabel?: string;
  /** Optional compact controls that change only the chart presentation. */
  headerActions?: ReactNode;
  onPointClick?: (point: BaseerOperationalChartPoint) => void;
}) {
  const element = useRef<HTMLDivElement | null>(null);
  const chartPalette = useBaseerChartPalette();
  const ar = language === "ar";
  const maximum = Math.max(0, ...points.map((point) => point.value));
  const pointDisplay = (point: BaseerOperationalChartPoint) => point.displayValue ?? formatNumber(point.value, language);
  useEffect(() => {
    if (presentation !== "chart" || !element.current) return;
    const chart = init(element.current, undefined, { renderer: "canvas" });
    const description = language === "ar" ? `${title}. ${points.map((point) => `${point.label}: ${pointDisplay(point)}`).join("، ")}` : `${title}. ${points.map((point) => `${point.label}: ${pointDisplay(point)}`).join(", ")}`;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chart.setOption({
      animation: !reducedMotion,
      animationDuration: 1050,
      animationDurationUpdate: 620,
      animationEasing: "elasticOut",
      animationEasingUpdate: "cubicOut",
      aria: { enabled: true, description },
      grid: { left: 18, right: 122, top: 22, bottom: 24, containLabel: true },
      xAxis: { type: "value", minInterval: 1, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: chartPalette.axis, fontSize: 10 }, splitLine: { lineStyle: { color: chartPalette.grid, width: 1 } } },
      yAxis: {
        type: "category",
        data: points.map((point) => point.label),
        inverse: true,
        position: language === "ar" ? "right" : "left",
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { width: 112, overflow: "truncate", margin: 12, color: chartPalette.axis },
      },
      series: [{
        type: "bar",
        data: points.map((point) => point.value),
        barMaxWidth: 18,
        animationDelay: (index: number) => index * 85,
        animationDelayUpdate: (index: number) => index * 36,
        itemStyle: { borderRadius: language === "ar" ? [8, 0, 0, 8] : [0, 8, 8, 0], color: chartPalette.primary },
        label: {
          show: true,
          position: language === "ar" ? "left" : "right",
          distance: 9,
          color: chartPalette.primaryDeep,
          fontWeight: 700,
          valueAnimation: !reducedMotion,
          formatter: (params: { dataIndex: number }) => { const point = points[params.dataIndex]; return point ? pointDisplay(point) : ""; },
        },
        emphasis: { itemStyle: { color: chartPalette.primaryDeep } },
      }],
    });
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [chartPalette.revision, language, points, presentation, title]);
  return <section className="baseer-chart" aria-label={title}>
    <header><div className="baseer-chart__heading"><h3>{title}</h3>{showSummary ? <small>{language === "ar" ? `حسب ملخص الخادم في ${formatDate(asOf, language)}` : `Server summary as of ${formatDate(asOf, language)}`}</small> : null}</div>{headerActions}</header>
    {showSummary ? <p>{points.map((point) => `${point.label}: ${pointDisplay(point)}`).join(" · ")}</p> : null}
    {presentation === "inlineRows" ? <table className="baseer-chart__inline-table" dir={language === "ar" ? "rtl" : "ltr"}><caption className="visually-hidden">{title}</caption><thead><tr><th>#</th><th>{language === "ar" ? "الفئة" : "Category"}</th><th>{language === "ar" ? "الحركة" : "Movement"}</th><th>{inlineShareLabel ?? (language === "ar" ? "من إجمالي الإنفاق" : "Share of spend")}</th><th>{language === "ar" ? "القيمة" : "Value"}</th></tr></thead><tbody>{points.map((point, index) => {
      const declaredShare = point.shareOfTotalPercent === undefined ? Number.NaN : Number(point.shareOfTotalPercent);
      // When a share is supplied, the bar represents that percentage of the
      // selected denominator instead of merely ranking rows against the largest row.
      const scale = Number.isFinite(declaredShare) ? Math.max(0, Math.min(1, declaredShare / 100)) : maximum > 0 ? Math.max(0, Math.min(1, point.value / maximum)) : 0;
      const barStyle = { "--baseer-bar-scale": String(scale), "--baseer-bar-delay": `${index * 70}ms` } as CSSProperties;
      return <tr key={point.id ?? point.label}><td className="baseer-chart__rank" dir="ltr">{formatCount(point.rank ?? index + 1, language)}</td><th scope="row">{onPointClick ? <button type="button" className="baseer-chart__point-link" onClick={() => onPointClick(point)}>{point.label}</button> : point.label}</th><td><span className="baseer-chart__inline-bar" aria-hidden="true"><span className="baseer-chart__inline-bar-fill" style={barStyle} /></span></td><td className="baseer-chart__share" dir="ltr">{point.shareOfTotalPercent === undefined ? "—" : formatPercent(point.shareOfTotalPercent, language)}</td><td dir="ltr">{pointDisplay(point)}</td></tr>;
    })}</tbody></table> : <><div ref={element} className="baseer-chart__plot" style={{ minBlockSize: `max(var(--baseer-chart-height-standard, 15rem), ${Math.max(10, points.length * 1.85)}rem)` }} role="img" aria-label={title} /><table><caption className="visually-hidden">{title}</caption><thead><tr><th>{language === "ar" ? "المؤشر" : "Metric"}</th><th>{language === "ar" ? "القيمة" : "Value"}</th></tr></thead><tbody>{points.map((point) => <tr key={point.label}><th scope="row">{point.label}</th><td dir="ltr">{pointDisplay(point)}</td></tr>)}</tbody></table></>}
  </section>;
}

/**
 * A focused dashboard visual for the HR overview. The underlying signals can
 * overlap (for example, an active employee can have a service to follow up),
 * so this is presented as a live status view rather than a percentage of one
 * employee total.
 */
export function HrWorkforceStatusChart({ language, title, points, asOf }: {
  language: Language;
  title: string;
  points: readonly BaseerOperationalChartPoint[];
  asOf: string;
}) {
  const ar = language === "ar";
  const chartPalette = useBaseerChartPalette();
  const maximum = Math.max(1, ...points.map((point) => Math.max(0, point.value)));
  const palette = [chartPalette.primary, chartPalette.info, chartPalette.secondary];
  return <section className="hr-workforce-chart" aria-label={title} dir={ar ? "rtl" : "ltr"}>
    <header className="hr-workforce-chart__header"><div><p>{ar ? "لقطة تشغيلية" : "Operational snapshot"}</p><h3>{title}</h3></div><small>{ar ? `محدّث في ${formatDate(asOf, language)}` : `Updated ${formatDate(asOf, language)}`}</small></header>
    <div className="hr-workforce-chart__body">
      <div className="hr-workforce-chart__insights" aria-label={ar ? "تفاصيل الحالة" : "Status details"}>{points.map((point, index) => <div key={point.id ?? point.label} className="hr-workforce-chart__insight"><span className="hr-workforce-chart__dot" style={{ backgroundColor: palette[index % palette.length] }} aria-hidden="true" /><span><strong>{point.label}</strong><small>{ar ? "إشارة مستقلة" : "Independent signal"}</small></span><b dir="ltr">{point.displayValue ?? formatCount(point.value, language)}</b><span className="hr-workforce-chart__bar" aria-hidden="true"><span style={{ inlineSize: `${Math.max(0, point.value) / maximum * 100}%`, backgroundColor: palette[index % palette.length] }} /></span></div>)}</div>
    </div>
    <footer className="hr-workforce-chart__footer"><span>{ar ? "المؤشرات قد تتداخل بين الموظفين، لذا تُقرأ منفصلة ولا تُجمع كإجمالي." : "Signals may overlap across employees, so they are read independently rather than summed."}</span></footer>
  </section>;
}

/**
 * One joined, server-read-only timeline. It is deliberately one visual: a
 * reader can compare sales, campaign cost, customers and active campaign
 * windows against the same date without implying causal attribution.
 */
export function BaseerMarketingTimelineChart({ language, title, timeline, campaigns, context, asOf, mode = "daily", showModeControls = false, onModeChange, headerMetrics, periodControl, expandedView = false }: {
  language: Language;
  title: string;
  timeline: BaseerMarketingTimeline;
  campaigns: readonly BaseerMarketingTimelineCampaign[];
  context: readonly BaseerMarketingTimelineContext[];
  asOf: string;
  mode?: "daily" | "monthly";
  showModeControls?: boolean;
  onModeChange?: (mode: "daily" | "monthly") => void;
  headerMetrics?: ReactNode;
  periodControl?: ReactNode;
  /** The print/expand host renders a second, fully interactive chart instance. */
  expandedView?: boolean;
}) {
  const timelineElement = useRef<HTMLDivElement | null>(null);
  const timelineChart = useRef<ReturnType<typeof init> | null>(null);
  const chartPalette = useBaseerChartPalette();
  const ar = language === "ar";
  // A dual-axis plot is valuable on desktop, but its numeric rails consume a
  // disproportionate share of a phone canvas.  On narrow screens the tooltip
  // remains the exact-reading surface and the plot gets that width back.
  const [isCompactTimeline, setIsCompactTimeline] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches);
  // A phone starts with the three monetary readings. Customer count remains
  // one tap away because it has a separate unit/axis and would otherwise make
  // a four-series mobile plot harder to read.
  const [visibleSeries, setVisibleSeries] = useState(() => {
    const compact = typeof window !== "undefined" && window.matchMedia("(max-width: 720px)").matches;
    return { sales: true, campaignSpend: true, purchases: true, customers: !compact };
  });
  const [showPointLabels, setShowPointLabels] = useState(false);
  const [expandedImage, setExpandedImage] = useState<string | null>(null);
  const [outputError, setOutputError] = useState<string | null>(null);
  const hasPlotControls = Boolean(periodControl || (showModeControls && onModeChange));
  const timelineRows = mode === "monthly" ? timeline.monthly.rows : timeline.daily.rows;
  const campaignLanes = mode === "monthly" ? timeline.monthly.campaignLanes : timeline.daily.campaignLanes;
  const displayedMonths = [...new Set(timelineRows.map((row) => row.fromBusinessDate.slice(0, 7)))];
  const periodLabel = formatTimelinePeriod(displayedMonths, language, mode === "monthly");
  const campaignsById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
  const modeItems = [{ id: "daily" as const, label: ar ? "يومي" : "Daily" }, { id: "monthly" as const, label: ar ? "شهري" : "Monthly" }];
  const metricItems = [
    { id: "sales" as const, label: ar ? "المبيعات الرسمية" : "Official sales", color: chartPalette.primary },
    { id: "campaignSpend" as const, label: ar ? "الصرف على الحملات" : "Campaign spend", color: chartPalette.secondary },
    { id: "purchases" as const, label: ar ? "المشتريات" : "Purchases", color: chartPalette.danger },
    { id: "customers" as const, label: ar ? "العملاء" : "Customers", color: chartPalette.info },
  ];
  const captureChart = useCallback(() => timelineChart.current?.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: chartPalette.tooltipSurface }) ?? null, [chartPalette.tooltipSurface]);
  const openExpanded = () => { if (expandedView) return; setOutputError(null); setExpandedImage(captureChart()); };
  const exportPng = () => { const image = expandedImage ?? captureChart(); if (image) downloadBaseerChartPng(image, "baseer-marketing-timeline.png"); };
  const printChart = () => { const image = expandedImage ?? captureChart(); if (!image) return; try { setOutputError(null); printBaseerChartImage({ dataUrl: image, title, language }); } catch { setOutputError(ar ? "اسمح للمتصفح بفتح نافذة الطباعة ثم أعد المحاولة." : "Allow the browser to open the print window, then try again."); } };
  const labels = timelineRows.map((row) => row.label);
  const hasData = timelineRows.some((row) => row.sales.chartValue !== null || row.customerCount !== null || (row.campaignSpend.chartValue !== null && row.campaignSpend.chartValue > 0) || (row.purchases.chartValue !== null && row.purchases.chartValue > 0) || row.activeCampaignIds.length > 0);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const sync = () => setIsCompactTimeline(media.matches);
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);
  const qualityLabel = (quality: BaseerMarketingTimelineRow["salesDayQuality"]) => ar
    ? ({ READY: "مكتمل", PENDING: "بانتظار الإقفال", PARTIAL: "يوم جزئي", MISSING: "لا توجد قراءة" } as const)[quality]
    : ({ READY: "Ready", PENDING: "Pending close", PARTIAL: "Partial day", MISSING: "No read" } as const)[quality];
  const moneyLabel = (value: BaseerMarketingTimelineAmount) => value.display === null ? (ar ? "غير متاحة" : "Unavailable") : value.display;
  const customerLabel = (value: number | null) => value === null ? (ar ? "غير متاح" : "Unavailable") : formatCount(value, language);
  useEffect(() => {
    if (!timelineElement.current) return;
    const timeline = init(timelineElement.current, undefined, { renderer: "canvas" });
    timelineChart.current = timeline;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const tooltipCard = (heading: string, lines: readonly [string, string][]) => `<div style="min-width:15rem;direction:${ar ? "rtl" : "ltr"};color:${chartPalette.primaryDeep};font-family:inherit"><div style="margin-bottom:.45rem;padding-bottom:.42rem;border-bottom:1px solid ${chartPalette.tooltipBorder};font-weight:850;font-size:.9rem">${escapeHtml(heading)}</div>${lines.map(([label, value]) => `<div style="display:flex;justify-content:space-between;gap:1rem;margin:.26rem 0;font-size:.78rem"><span style="color:${chartPalette.axis}">${escapeHtml(label)}</span><strong style="color:${chartPalette.primaryDeep};text-align:${ar ? "left" : "right"};font-weight:800">${escapeHtml(value)}</strong></div>`).join("")}</div>`;
    const tooltipForRow = (row: BaseerMarketingTimelineRow) => {
      const activeCampaigns = row.activeCampaignIds.map((id) => campaignsById.get(id)).filter((campaign): campaign is BaseerMarketingTimelineCampaign => Boolean(campaign));
      const relatedContext = context.filter((item) => item.startsOn <= row.toBusinessDate && item.endsOn >= row.fromBusinessDate);
      const saleState = qualityLabel(row.salesDayQuality);
      return tooltipCard(mode === "monthly" ? formatMonthYear(`${row.label}-01`, language) : formatDate(row.label, language), [
        [ar ? "المبيعات الرسمية الشاملة للضريبة" : "VAT-inclusive official sales", moneyLabel(row.sales)],
        [ar ? "الصرف المثبت على الحملات" : "Posted campaign spend", row.campaignSpend.display === null ? (ar ? "غير متاح" : "Unavailable") : row.campaignSpend.chartValue === 0 ? (ar ? "لا يوجد مستند مثبت" : "No posted document") : moneyLabel(row.campaignSpend)],
        [ar ? "المشتريات" : "Purchases", row.purchases.display === null ? (ar ? "غير متاحة" : "Unavailable") : row.purchases.chartValue === 0 ? (ar ? "لا توجد حركة مشتريات" : "No purchase movement") : moneyLabel(row.purchases)],
        [ar ? "العملاء" : "Customers", customerLabel(row.customerCount)],
        [ar ? "حالة المبيعات" : "Sales state", saleState],
        [ar ? "الحملات النشطة" : "Active campaigns", activeCampaigns.length ? activeCampaigns.map((campaign) => ar ? campaign.titleAr : campaign.titleEn ?? campaign.titleAr).join("، ") : (ar ? "لا توجد" : "None")],
        ...(relatedContext.length ? [[ar ? "السياق" : "Context", relatedContext.map((item) => item.titleAr).join("، ")] as [string, string]] : []),
      ]);
    };
    const contextAreas = mode === "daily" ? context.slice(0, 40).map((item) => [{ name: item.titleAr, xAxis: item.startsOn }, { xAxis: item.endsOn }]) : [];
    // Plot coordinates necessarily remain numeric for ECharts, but every
    // visible monetary label comes back from the Marketing read model.  The
    // browser must never apply a second rounding, compacting, or currency rule.
    const pointLabel = (params: { dataIndex?: number; seriesId?: string }) => {
      const row = timelineRows[params.dataIndex ?? -1];
      if (!row) return "";
      if (params.seriesId === "sales") return row.sales.display ?? "";
      if (params.seriesId === "purchases") return row.purchases.display ?? "";
      return params.seriesId === "customers" ? customerLabel(row.customerCount) : "";
    };
    const series = [
      // A null is an unverified or unavailable accounting reading, never a
      // zero and never a value we may interpolate across.  Keeping the gap is
      // more honest than a visually continuous trend.
      // The primary accounting amount is a column: it makes daily sales volume
      // and its zero baseline immediately legible. Supporting flows are lines.
      visibleSeries.sales ? { id: "sales", name: ar ? "المبيعات الرسمية الشاملة للضريبة" : "VAT-inclusive official sales", type: "bar" as const, yAxisIndex: 0, barMaxWidth: isCompactTimeline ? 14 : 20, z: 2, data: timelineRows.map((row) => row.sales.chartValue), label: { show: showPointLabels, position: "top", distance: 5, color: chartPalette.primaryDeep, fontSize: 9, fontWeight: 800, formatter: pointLabel }, labelLayout: { hideOverlap: true }, itemStyle: { color: chartPalette.primary, borderRadius: [5, 5, 0, 0] }, emphasis: { focus: "series" as const, itemStyle: { color: chartPalette.primaryDeep } }, markArea: contextAreas.length ? { silent: true, itemStyle: { color: chartAlpha(chartPalette.secondary, .08) }, data: contextAreas } : undefined } : null,
      visibleSeries.campaignSpend ? { id: "campaignSpend", name: ar ? "الصرف على الحملات" : "Campaign spend", type: "line" as const, yAxisIndex: 0, smooth: false, connectNulls: false, showSymbol: true, symbol: "circle", symbolSize: isCompactTimeline ? 4.5 : 6, z: 5, data: timelineRows.map((row) => row.campaignSpend.chartValue), label: { show: showPointLabels, position: "top", distance: 4, color: chartPalette.secondary, fontSize: 8, fontWeight: 800, formatter: pointLabel }, labelLayout: { hideOverlap: true }, itemStyle: { color: chartPalette.secondary, borderColor: chartPalette.tooltipSurface, borderWidth: 1.5 }, lineStyle: { width: isCompactTimeline ? 2.1 : 2.4, type: "solid", cap: "round" }, emphasis: { focus: "series" as const, symbolSize: isCompactTimeline ? 6.5 : 8, lineStyle: { width: 3.4, type: "solid" } } } : null,
      // A completed no-purchase day is a valid zero; an unread day is null
      // and must remain a gap instead of inventing a purchase result.
      visibleSeries.purchases ? { id: "purchases", name: ar ? "المشتريات" : "Purchases", type: "line" as const, yAxisIndex: 0, smooth: false, connectNulls: false, showSymbol: true, symbol: "circle", symbolSize: isCompactTimeline ? 4.5 : 6, z: 5, data: timelineRows.map((row) => row.purchases.chartValue), label: { show: showPointLabels, position: "top", distance: 4, color: chartPalette.danger, fontSize: 8, fontWeight: 800, formatter: pointLabel }, labelLayout: { hideOverlap: true }, itemStyle: { color: chartPalette.danger, borderColor: chartPalette.tooltipSurface, borderWidth: 1.5 }, lineStyle: { width: isCompactTimeline ? 2.1 : 2.4, type: "solid", cap: "round" }, emphasis: { focus: "series" as const, symbolSize: isCompactTimeline ? 6.5 : 8, lineStyle: { width: 3.4, type: "solid" } } } : null,
      visibleSeries.customers ? { id: "customers", name: ar ? "العملاء" : "Customers", type: "line" as const, yAxisIndex: 1, smooth: false, connectNulls: false, showSymbol: true, symbol: "circle", symbolSize: isCompactTimeline ? 4.25 : 5.5, z: 5, data: timelineRows.map((row) => row.customerCount), label: { show: showPointLabels, position: "top", distance: 5, color: chartPalette.info, fontSize: 8.5, fontWeight: 800, formatter: pointLabel }, labelLayout: { hideOverlap: true }, itemStyle: { color: chartPalette.info, borderColor: chartPalette.tooltipSurface, borderWidth: 1.5 }, lineStyle: { width: isCompactTimeline ? 2 : 2.35, type: "dashed", cap: "round" }, emphasis: { focus: "series" as const, symbolSize: isCompactTimeline ? 6 : 8, lineStyle: { width: 3.25, type: "dashed" } } } : null,
    ].filter((series): series is NonNullable<typeof series> => series !== null);
    const description = ar ? `${title}. مخطط زمني موحّد يقارن المبيعات والصرف المثبت والعملاء والحملات النشطة على المحور نفسه.` : `${title}. A joined timeline comparing sales, posted campaign spend, customers and active campaigns on one axis.`;
    timeline.setOption({
      animation: !reducedMotion,
      // The chart still draws from the first point, but it must settle before
      // the dashboard feels late after a cold read or period change.
      animationDuration: 620,
      animationDurationUpdate: 320,
      animationEasing: "cubicOut",
      animationEasingUpdate: "cubicInOut",
      animationThreshold: 2_000,
      stateAnimation: { duration: 360, easing: "cubicInOut" },
      aria: { enabled: true, description },
      // The read is intentionally opt-in: an incidental mouse move must not
      // cover the plot on desktop or immediately surface a card on touch.
      tooltip: { trigger: "axis", triggerOn: "click", confine: true, appendToBody: false, backgroundColor: chartPalette.tooltipSurface, borderColor: chartPalette.tooltipBorder, borderWidth: 1, padding: [11, 13], textStyle: { color: chartPalette.primaryDeep, fontFamily: "inherit" }, axisPointer: { type: "line", lineStyle: { color: chartAlpha(chartPalette.primary, .42), width: 1.4 } }, formatter: (params: unknown) => { const first = Array.isArray(params) ? params[0] : params; const value = first && typeof first === "object" ? first as { axisValue?: string } : {}; const row = timelineRows.find((item) => item.label === value.axisValue); return row ? tooltipForRow(row) : ""; } },
      grid: isCompactTimeline
        ? { left: 8, right: 8, top: 20, bottom: 32, containLabel: false }
        : { left: 16, right: 58, top: 30, bottom: 36, containLabel: true },
      xAxis: { type: "category", data: labels, boundaryGap: true, axisTick: { show: false }, axisLine: { lineStyle: { color: chartPalette.tooltipBorder } }, axisLabel: { hideOverlap: true, color: chartPalette.axis, fontSize: isCompactTimeline ? 9 : 10, margin: isCompactTimeline ? 9 : 12, formatter: (value: string) => mode === "daily" ? value.slice(8) : value } },
      yAxis: [
        { type: "value", name: isCompactTimeline ? "" : ar ? "ر.س" : "SAR", min: 0, axisLabel: { show: !isCompactTimeline, color: chartPalette.axis, fontSize: 10, formatter: (value: number) => compactNumber(value, language) }, nameTextStyle: { color: chartPalette.axis, fontSize: 10 }, splitLine: { lineStyle: { color: chartPalette.grid, width: 1 } } },
        { type: "value", name: isCompactTimeline ? "" : ar ? "عميل" : "Customers", min: 0, minInterval: 1, position: ar ? "right" : "right", axisLabel: { show: !isCompactTimeline, color: chartPalette.info, fontSize: 10, formatter: (value: number) => compactNumber(value, language) }, splitLine: { show: false } },
      ],
      series,
    });
    const container = timelineElement.current;
    const hideTooltip = () => timeline.dispatchAction({ type: "hideTip" });
    const hideTooltipOnExternalPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !container.contains(event.target)) hideTooltip();
    };
    // ECharts does not keep click-triggered details scoped to the user's
    // current reading area by default.  Clear it on either kind of exit.
    timeline.on("globalout", hideTooltip);
    container.addEventListener("pointerleave", hideTooltip);
    document.addEventListener("pointerdown", hideTooltipOnExternalPointerDown);
    const observer = new ResizeObserver(() => timeline.resize()); observer.observe(container);
    return () => {
      observer.disconnect();
      timeline.off("globalout", hideTooltip);
      container.removeEventListener("pointerleave", hideTooltip);
      document.removeEventListener("pointerdown", hideTooltipOnExternalPointerDown);
      if (timelineChart.current === timeline) timelineChart.current = null;
      timeline.dispose();
    };
  }, [ar, campaignsById, chartPalette.revision, context, hasPlotControls, isCompactTimeline, language, mode, showPointLabels, timelineRows, title, visibleSeries]);
  return <section className={`baseer-chart baseer-marketing-timeline${showModeControls ? " baseer-marketing-timeline--command" : ""}${expandedView ? " baseer-marketing-timeline--expanded" : ""}`} aria-label={title} data-chart-revision="cc-30904-chart-scale" data-chart-density={isCompactTimeline ? "compact" : "regular"}>
    <header className="baseer-marketing-timeline__header"><div>{showModeControls ? <p className="baseer-marketing-timeline__eyebrow">{ar ? "مركز القيادة" : "Command center"}</p> : null}<h3>{title}</h3>{periodLabel ? <small>{periodLabel}</small> : null}</div><div className="baseer-marketing-timeline__header-meta"><small className="baseer-marketing-timeline__as-of">{language === "ar" ? `قراءة خادمية في ${formatDate(asOf, language)}` : `Server read as of ${formatDate(asOf, language)}`}</small>{headerMetrics}</div></header>
    {hasPlotControls ? <div className="baseer-marketing-timeline__toolbar"><div className="baseer-marketing-timeline__metrics-toggle" role="group" aria-label={ar ? "إظهار المقاييس" : "Show metrics"}>{metricItems.map((item) => <button key={item.id} type="button" aria-pressed={visibleSeries[item.id]} onClick={() => setVisibleSeries((current) => ({ ...current, [item.id]: !current[item.id] }))}><span style={{ backgroundColor: item.color }} aria-hidden="true" />{item.label}</button>)}</div><div className="baseer-marketing-timeline__toolbar-controls">{periodControl}{showModeControls && onModeChange ? <div className="baseer-marketing-timeline__modes" role="group" aria-label={ar ? "تجميع الفترة" : "Period granularity"}>{modeItems.map((item) => <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => onModeChange(item.id)}>{item.label}</button>)}</div> : null}<button type="button" className="baseer-marketing-timeline__expand" aria-pressed={showPointLabels} onClick={() => setShowPointLabels((current) => !current)}>{showPointLabels ? (ar ? "إخفاء الأرقام" : "Hide numbers") : (ar ? "إظهار الأرقام" : "Show numbers")}</button>{!expandedView ? <button type="button" className="baseer-marketing-timeline__expand" onClick={openExpanded}>{ar ? "تكبير" : "Expand"}</button> : null}</div></div> : null}
    <div className="baseer-marketing-timeline__plot-shell">
      <div ref={timelineElement} className="baseer-chart__plot baseer-marketing-timeline__plot" role="img" aria-label={title} />
      <section className="baseer-marketing-timeline__campaign-lanes" aria-label={ar ? "المسار الزمني للحملات وتكلفتها" : "Campaign timeline and cost"}><header><strong>{ar ? "الحملات النشطة وتكلفتها المثبتة" : "Active campaigns and posted cost"}</strong><small>{ar ? "كل مسار يشارك الرسم المحور الزمني نفسه" : "Every lane shares the chart's time axis"}</small></header>{campaignLanes.filter((lane) => lane.activeIndexes.length > 0).length ? campaignLanes.filter((lane) => lane.activeIndexes.length > 0).map((lane, index) => { const first = lane.activeIndexes[0]!; const last = lane.activeIndexes.at(-1)!; const campaign = campaignsById.get(lane.campaignId); const label = campaign ? (ar ? campaign.titleAr : campaign.titleEn ?? campaign.titleAr) : lane.campaignId; const color = [chartPalette.primary, chartPalette.secondary, chartPalette.info, chartPalette.danger][index % 4]!; const totalLabel = moneyLabel(lane.totalSpend); return <div key={lane.campaignId} className="baseer-marketing-timeline__campaign-lane" style={{ "--baseer-lane-color": color, "--baseer-lane-points": String(Math.max(1, labels.length)) } as CSSProperties}><div className="baseer-marketing-timeline__campaign-label"><strong>{label}</strong><small dir="ltr">{lane.totalSpend.display === null ? (ar ? "غير متاح" : "Unavailable") : lane.totalSpend.chartValue === 0 ? (ar ? "لا يوجد صرف مثبت" : "No posted spend") : totalLabel}</small></div><div className="baseer-marketing-timeline__campaign-track" aria-label={`${label}: ${totalLabel}`}><span className="baseer-marketing-timeline__campaign-window" style={{ gridColumn: `${first + 1} / ${last + 2}` }} aria-hidden="true" />{lane.spendBars.map((value, barIndex) => value.chartValue !== null && value.chartValue > 0 ? <span key={barIndex} className="baseer-marketing-timeline__campaign-spend" style={{ gridColumn: String(barIndex + 1), "--baseer-spend-height": `${value.barHeightPercent}%` } as CSSProperties} title={moneyLabel(value)} aria-label={moneyLabel(value)} /> : null)}</div></div>; }) : <p className="baseer-marketing-timeline__campaigns-empty">{ar ? "لا توجد حملات نشطة ضمن الفترة المحددة." : "No active campaigns in the selected period."}</p>}</section>
      {!hasData ? <p className="baseer-marketing-timeline__empty" role="status">{ar ? "لا توجد بيانات مؤهلة ضمن الفترة المحددة." : "No eligible data in the selected period."}</p> : null}
    </div>
    {showModeControls ? <footer className="baseer-marketing-timeline__footer"><span>{ar ? "الربط الزمني يوضح السياق ولا يثبت السببية." : "Temporal alignment provides context; it does not prove causation."}</span><span>{ar ? "قراءة من النظام" : "System read"}</span></footer> : null}
    {!expandedView ? <BaseerDialog open={expandedImage !== null} title={title} language={language} size="wide" className="baseer-chart-output-dialog" error={outputError} onClose={() => { setExpandedImage(null); setOutputError(null); }} footer={<><BaseerButton type="button" variant="secondary" onClick={printChart}>{ar ? "طباعة" : "Print"}</BaseerButton><BaseerButton type="button" variant="secondary" onClick={exportPng}>{ar ? "تصدير PNG" : "Export PNG"}</BaseerButton><BaseerButton type="button" onClick={() => { setExpandedImage(null); setOutputError(null); }}>{ar ? "إغلاق" : "Close"}</BaseerButton></>}><div className="baseer-chart-output command-center"><BaseerMarketingTimelineChart language={language} title={title} timeline={timeline} campaigns={campaigns} context={context} asOf={asOf} mode={mode} showModeControls={showModeControls} onModeChange={onModeChange} headerMetrics={headerMetrics} periodControl={periodControl} expandedView /></div></BaseerDialog> : null}
  </section>;
}

/** A compact monthly operating view. Sales are intentionally null when the
 * day is incomplete; purchases have a true zero only when no posted purchase
 * invoice exists for that day. */
export function BaseerOperationsMonthChart({ language, title, days, asOf }: { language: Language; title: string; days: readonly BaseerOperationsMonthDay[]; asOf: string }) {
  const element = useRef<HTMLDivElement | null>(null);
  const [visibleSeries, setVisibleSeries] = useState({ sales: true, purchases: true });
  const chartPalette = useBaseerChartPalette();
  const ar = language === "ar";
  useEffect(() => {
    if (!element.current) return;
    const chart = init(element.current, undefined, { renderer: "canvas" });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const description = ar ? `${title}. المبيعات المثبتة وفواتير المشتريات المثبتة خلال الشهر. الأيام غير المكتملة لا تظهر كمبيعات صفرية.` : `${title}. Posted sales and posted purchase invoices for the month. Incomplete sales days are not treated as zero.`;
    chart.setOption({
      animation: !reducedMotion,
      animationDuration: 850,
      animationDurationUpdate: 500,
      animationEasing: "cubicOut",
      aria: { enabled: true, description },
      tooltip: {
        trigger: "axis",
        confine: true,
        formatter: (params: unknown) => {
          const first = Array.isArray(params) ? params[0] : params;
          const axisValue = first && typeof first === "object" ? (first as { axisValue?: string }).axisValue : undefined;
          const row = days.find((day) => day.businessDate === axisValue);
          if (!row) return "";
          const sales = row.sales.displayGrossAmount ?? (ar ? "غير مكتملة" : "Incomplete");
          return `<div style="direction:${ar ? "rtl" : "ltr"};min-width:10rem"><strong>${escapeHtml(row.businessDate)}</strong><br/><span>${ar ? "المبيعات" : "Sales"}: ${escapeHtml(sales)}</span><br/><span>${ar ? "المشتريات" : "Purchases"}: ${escapeHtml(row.purchases.displayGrossAmount)}</span><br/><span>${ar ? "فواتير الشراء" : "Purchase invoices"}: ${escapeHtml(row.purchases.displayDocumentCount)}</span></div>`;
        },
      },
      grid: { left: 30, right: 24, top: 34, bottom: 34, containLabel: true },
      xAxis: { type: "category", data: days.map((day) => day.businessDate), boundaryGap: false, axisLabel: { hideOverlap: true, color: chartPalette.axis, fontSize: 10, margin: 12, formatter: (value: string) => value.slice(8) }, axisTick: { show: false }, axisLine: { lineStyle: { color: chartPalette.tooltipBorder } } },
      yAxis: { type: "value", min: 0, axisLabel: { color: chartPalette.axis, fontSize: 10, formatter: (value: number) => compactNumber(value, language) }, splitLine: { lineStyle: { color: chartPalette.grid, width: 1 } } },
      series: [
        {
          name: ar ? "المبيعات" : "Sales", type: "bar", barMaxWidth: 18,
          data: days.map((day) => day.sales.plotValue), itemStyle: { color: chartPalette.primary, borderRadius: [5, 5, 0, 0] },
        },
        {
          name: ar ? "المشتريات" : "Purchases", type: "line", smooth: false, connectNulls: false, showSymbol: true, symbol: "circle", symbolSize: 5,
          data: days.map((day) => day.purchases.plotValue), itemStyle: { color: chartPalette.secondary, borderColor: chartPalette.tooltipSurface, borderWidth: 1.5 }, lineStyle: { width: 2.6, cap: "round" },
        },
      ].filter((series) => series.name === (ar ? "المبيعات" : "Sales") ? visibleSeries.sales : visibleSeries.purchases),
    });
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [ar, chartPalette.revision, days, language, title, visibleSeries]);
  const legend = [{ id: "sales" as const, label: ar ? "المبيعات" : "Sales", color: chartPalette.primary }, { id: "purchases" as const, label: ar ? "المشتريات" : "Purchases", color: chartPalette.secondary }];
  return <section className="baseer-chart baseer-operations-month-chart" aria-label={title}><header><div><h3>{title}</h3><small>{ar ? `حتى ${formatDate(asOf, language)}` : `Through ${formatDate(asOf, language)}`}</small></div></header><div className="baseer-marketing-timeline__legend" aria-label={ar ? "مفتاح الرسم" : "Chart legend"}>{legend.map((item) => <button key={item.id} type="button" className="baseer-marketing-timeline__legend-button" aria-pressed={visibleSeries[item.id]} onClick={() => setVisibleSeries((current) => ({ ...current, [item.id]: !current[item.id] }))}><span aria-hidden="true" style={{ background: item.color }} /><strong>{item.label}</strong><small>{visibleSeries[item.id] ? (ar ? "ظاهر" : "Shown") : (ar ? "مخفي" : "Hidden")}</small></button>)}</div><div ref={element} className="baseer-chart__plot baseer-operations-month-chart__plot" role="img" aria-label={title} /></section>;
}

function compactNumber(value: number, language: Language) {
  return formatCompactNumber(value, language);
}

function formatTimelinePeriod(months: readonly string[], language: Language, yearly = false) {
  if (!months.length) return "";
  if (yearly) {
    const years = [...new Set(months.map((month) => month.slice(0, 4)))];
    if (years.length === 1) return formatYear(years[0]!, language);
  }
  return months.length === 1 ? formatMonthYear(months[0], language) : months.map((month) => formatMonthYear(month, language)).join(" – ");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
