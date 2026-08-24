import { BarChart, LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef, useState, type CSSProperties } from "react";

use([BarChart, LineChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, SVGRenderer]);

type Language = "ar" | "en";
export type BaseerOperationalChartPoint = { id?: string; label: string; value: number; displayValue?: string; rank?: number; shareOfTotalPercent?: string };
export type BaseerMarketingTimelineDay = {
  businessDate: string;
  officialNetSales: string | null;
  salesDayQuality: "READY" | "PENDING" | "PARTIAL" | "MISSING";
  linkedActualSpend: string;
  linkedFinancialDocumentCount: number;
  activeCampaignIds: readonly string[];
};
export type BaseerMarketingTimelineCampaign = { id: string; titleAr: string; titleEn: string | null };
export type BaseerMarketingTimelineContext = { id: string; titleAr: string; startsOn: string; endsOn: string };
export type BaseerOperationsMonthDay = { businessDate: string; salesGrossAmount: string | null; purchaseGrossAmount: string; purchaseDocumentCount: number };

/** A local, accessible visualisation of server-provided operational totals. */
export function BaseerChart({ language, title, points, asOf, showSummary = true, presentation = "chart", onPointClick }: {
  language: Language;
  title: string;
  points: readonly BaseerOperationalChartPoint[];
  asOf: string;
  /** Keep provenance copy available by default, but allow focused dashboard charts. */
  showSummary?: boolean;
  /** A compact, non-duplicating chart rendered inside the data table. */
  presentation?: "chart" | "inlineRows";
  onPointClick?: (point: BaseerOperationalChartPoint) => void;
}) {
  const element = useRef<HTMLDivElement | null>(null);
  const maximum = Math.max(0, ...points.map((point) => point.value));
  useEffect(() => {
    if (presentation !== "chart" || !element.current) return;
    const chart = init(element.current, undefined, { renderer: "svg" });
    const description = language === "ar" ? `${title}. ${points.map((point) => `${point.label}: ${point.value}`).join("، ")}` : `${title}. ${points.map((point) => `${point.label}: ${point.value}`).join(", ")}`;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chart.setOption({
      animation: !reducedMotion,
      animationDuration: 1050,
      animationDurationUpdate: 620,
      animationEasing: "elasticOut",
      animationEasingUpdate: "cubicOut",
      aria: { enabled: true, description },
      grid: { left: 14, right: 126, top: 16, bottom: 18, containLabel: true },
      tooltip: { trigger: "axis" },
      xAxis: { type: "value", minInterval: 1, splitLine: { lineStyle: { color: "rgba(24, 74, 63, .13)" } } },
      yAxis: {
        type: "category",
        data: points.map((point) => point.label),
        inverse: true,
        position: language === "ar" ? "right" : "left",
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: { width: 112, overflow: "truncate", margin: 12, color: "#27463e" },
      },
      series: [{
        type: "bar",
        data: points.map((point) => point.value),
        barMaxWidth: 20,
        animationDelay: (index: number) => index * 85,
        animationDelayUpdate: (index: number) => index * 36,
        itemStyle: {
          borderRadius: language === "ar" ? [10, 0, 0, 10] : [0, 10, 10, 0],
          color: { type: "linear", x: 0, y: 0, x2: 1, y2: 0, colorStops: language === "ar" ? [{ offset: 0, color: "#23a982" }, { offset: 1, color: "#0b7658" }] : [{ offset: 0, color: "#0b7658" }, { offset: 1, color: "#23a982" }] },
        },
        label: {
          show: true,
          position: language === "ar" ? "left" : "right",
          distance: 9,
          color: "#173a31",
          fontWeight: 700,
          valueAnimation: !reducedMotion,
          formatter: (params: { dataIndex: number }) => points[params.dataIndex]?.displayValue ?? "",
        },
        emphasis: { itemStyle: { color: "#075943" } },
      }],
    });
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [language, points, presentation, title]);
  return <section className="baseer-chart" aria-label={title}>
    <header><h3>{title}</h3>{showSummary ? <small>{language === "ar" ? `حسب ملخص الخادم في ${asOf}` : `Server summary as of ${asOf}`}</small> : null}</header>
    {showSummary ? <p>{points.map((point) => `${point.label}: ${point.displayValue ?? point.value}`).join(" · ")}</p> : null}
    {presentation === "inlineRows" ? <table className="baseer-chart__inline-table" dir={language === "ar" ? "rtl" : "ltr"}><caption className="visually-hidden">{title}</caption><thead><tr><th>#</th><th>{language === "ar" ? "الفئة" : "Category"}</th><th>{language === "ar" ? "الحركة" : "Movement"}</th><th>{language === "ar" ? "من إجمالي الإنفاق" : "Share of spend"}</th><th>{language === "ar" ? "القيمة" : "Value"}</th></tr></thead><tbody>{points.map((point, index) => {
      const scale = maximum > 0 ? Math.max(0, Math.min(1, point.value / maximum)) : 0;
      const barStyle = { "--baseer-bar-scale": String(scale), "--baseer-bar-delay": `${index * 70}ms` } as CSSProperties;
      return <tr key={point.id ?? point.label}><td className="baseer-chart__rank" dir="ltr">{point.rank ?? index + 1}</td><th scope="row">{onPointClick ? <button type="button" className="baseer-chart__point-link" onClick={() => onPointClick(point)}>{point.label}</button> : point.label}</th><td><span className="baseer-chart__inline-bar" aria-hidden="true"><span className="baseer-chart__inline-bar-fill" style={barStyle} /></span></td><td className="baseer-chart__share" dir="ltr">{point.shareOfTotalPercent ?? "—"}{point.shareOfTotalPercent === undefined ? "" : "%"}</td><td dir="ltr">{point.displayValue ?? point.value}</td></tr>;
    })}</tbody></table> : <><div ref={element} className="baseer-chart__plot" style={{ minBlockSize: `${Math.max(15, points.length * 2.15)}rem` }} role="img" aria-label={title} /><table><caption className="visually-hidden">{title}</caption><thead><tr><th>{language === "ar" ? "المؤشر" : "Metric"}</th><th>{language === "ar" ? "القيمة" : "Value"}</th></tr></thead><tbody>{points.map((point) => <tr key={point.label}><th scope="row">{point.label}</th><td dir="ltr">{point.displayValue ?? point.value}</td></tr>)}</tbody></table></>}
  </section>;
}

/**
 * Shared, server-read-only marketing timeline. The selected view changes only
 * presentation; sales and linked-spend values remain server-provided.
 */
export function BaseerMarketingTimelineChart({ language, title, days, campaigns, context, asOf, mode = "daily" }: {
  language: Language;
  title: string;
  days: readonly BaseerMarketingTimelineDay[];
  campaigns: readonly BaseerMarketingTimelineCampaign[];
  context: readonly BaseerMarketingTimelineContext[];
  asOf: string;
  mode?: "daily" | "monthly" | "campaigns";
}) {
  const timelineElement = useRef<HTMLDivElement | null>(null);
  const [visibleSeries, setVisibleSeries] = useState({ sales: true, spend: true, campaigns: true });
  const ar = language === "ar";
  const displayedMonths = [...new Set(days.map((day) => day.businessDate.slice(0, 7)))];
  const periodLabel = formatTimelinePeriod(displayedMonths, language);
  const legendItems = [
    { id: "sales" as const, label: ar ? "المبيعات الرسمية" : "Official sales", kind: "line" },
    ...(mode === "campaigns" ? [] : [{ id: "spend" as const, label: ar ? "المصروف المثبت" : "Posted spend", kind: "bar" }]),
    { id: "campaigns" as const, label: ar ? "الحملات النشطة" : "Active campaigns", kind: "dashed" },
  ];
  useEffect(() => {
    if (!timelineElement.current) return;
    const timeline = init(timelineElement.current, undefined, { renderer: "svg" });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const campaignsById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
    const qualityLabel = (quality: BaseerMarketingTimelineDay["salesDayQuality"]) => ar
      ? ({ READY: "مكتمل", PENDING: "بانتظار الإقفال", PARTIAL: "يوم جزئي", MISSING: "لا توجد قراءة" } as const)[quality]
      : ({ READY: "Ready", PENDING: "Pending close", PARTIAL: "Partial day", MISSING: "No read" } as const)[quality];
    const contextsForDay = (businessDate: string) => context.filter((item) => item.startsOn <= businessDate && item.endsOn >= businessDate);
    const dailyTooltip = (params: readonly { axisValue?: string; seriesName?: string; data?: unknown }[]) => {
      const businessDate = params[0]?.axisValue;
      const item = days.find((day) => day.businessDate === businessDate);
      if (!item) return "";
      const activeCampaigns = item.activeCampaignIds.map((id) => campaignsById.get(id)).filter((campaign): campaign is BaseerMarketingTimelineCampaign => Boolean(campaign));
      const relatedContext = contextsForDay(item.businessDate);
      const lines = [
        item.businessDate,
        `${ar ? "المبيعات الرسمية" : "Official sales"}: ${item.officialNetSales === null ? (ar ? "غير متاحة" : "Unavailable") : `${item.officialNetSales} SAR`}`,
        `${ar ? "حالة المبيعات" : "Sales state"}: ${qualityLabel(item.salesDayQuality)}`,
        `${ar ? "المصروف المرتبط المثبت" : "Posted linked spend"}: ${item.linkedFinancialDocumentCount ? `${item.linkedActualSpend} SAR` : (ar ? "لا يوجد مستند مرتبط" : "No linked document")}`,
        activeCampaigns.length ? `${ar ? "الحملات" : "Campaigns"}: ${activeCampaigns.map((campaign) => ar ? campaign.titleAr : campaign.titleEn ?? campaign.titleAr).join("، ")}` : `${ar ? "الحملات" : "Campaigns"}: ${ar ? "لا توجد حملة بتاريخ محدد" : "No dated campaign"}`,
        relatedContext.length ? `${ar ? "السياق" : "Context"}: ${relatedContext.map((item) => item.titleAr).join("، ")}` : "",
      ].filter(Boolean);
      return lines.map(escapeHtml).join("<br/>");
    };
    const monthly = Array.from(days.reduce((byMonth, item) => {
      const key = item.businessDate.slice(0, 7); const current = byMonth.get(key) ?? { key, days: [] as BaseerMarketingTimelineDay[] };
      current.days.push(item); byMonth.set(key, current); return byMonth;
    }, new Map<string, { key: string; days: BaseerMarketingTimelineDay[] }>()).values()).map((bucket) => ({
      label: bucket.key,
      sales: bucket.days.every((item) => item.officialNetSales !== null) ? bucket.days.reduce((sum, item) => sum + Number(item.officialNetSales), 0) : null,
      spend: bucket.days.reduce((sum, item) => sum + Number(item.linkedActualSpend), 0),
      activeCampaigns: new Set(bucket.days.flatMap((item) => item.activeCampaignIds)).size,
    }));
    const timelineRows = mode === "monthly" ? monthly : days.map((item) => ({ label: item.businessDate, sales: item.officialNetSales === null ? null : Number(item.officialNetSales), spend: item.linkedFinancialDocumentCount ? Number(item.linkedActualSpend) : null, activeCampaigns: item.activeCampaignIds.length }));
    const labels = timelineRows.map((item) => item.label);
    const contextAreas = context.slice(0, 40).map((item) => [{ name: item.titleAr, xAxis: item.startsOn }, { xAxis: item.endsOn }]);
    const viewLabel = mode === "monthly" ? (ar ? "شهري" : "monthly") : mode === "campaigns" ? (ar ? "الحملات" : "campaigns") : (ar ? "يومي" : "daily");
    const description = ar ? `${title}. عرض ${viewLabel} للمبيعات الرسمية والصرف المثبت والحملات. لا تُعرض الأيام الناقصة كصفر.` : `${title}. A ${viewLabel} view of official sales, linked spend, and campaigns. Missing days are not shown as zero.`;
    const series = [
      {
        name: ar ? "المبيعات الرسمية" : "Official sales", type: "line" as const, smooth: true, connectNulls: false,
        data: timelineRows.map((item) => item.sales), itemStyle: { color: "#0c8a6a" }, lineStyle: { width: 3 }, symbolSize: 7,
        markArea: mode !== "monthly" && contextAreas.length ? { silent: true, itemStyle: { color: "rgba(193, 139, 31, .08)" }, data: contextAreas } : undefined,
      },
      ...(mode === "campaigns" ? [] : [{ name: ar ? "المصروف المثبت" : "Posted spend", type: "bar" as const, barMaxWidth: 22, data: timelineRows.map((item) => item.spend), itemStyle: { color: "#d98c27", borderRadius: [5, 5, 0, 0] } }]),
      { name: ar ? "الحملات النشطة" : "Active campaigns", type: "line" as const, yAxisIndex: 1, step: "middle" as const, symbol: "circle", symbolSize: 5, data: timelineRows.map((item) => item.activeCampaigns), itemStyle: { color: "#4968c8" }, lineStyle: { type: "dashed", width: 2 } },
    ];
    timeline.setOption({
      animation: !reducedMotion,
      animationDuration: 620,
      animationEasing: "cubicOut",
      aria: { enabled: true, description },
      grid: { left: 28, right: 30, top: 52, bottom: 42, containLabel: true },
      legend: { show: false },
      tooltip: { trigger: "axis", confine: true, formatter: mode === "monthly" ? undefined : dailyTooltip },
      xAxis: { type: "category", data: labels, boundaryGap: false, axisLabel: { hideOverlap: true, formatter: (value: string) => mode === "daily" || mode === "campaigns" ? value.slice(8) : value } },
      yAxis: [
        { type: "value", name: ar ? "ر.س" : "SAR", min: 0, axisLabel: { formatter: (value: number) => compactNumber(value, language) } },
        { type: "value", name: ar ? "حملات" : "Campaigns", minInterval: 1, min: 0 },
      ],
      series: series.filter((item) => item.name === (ar ? "المبيعات الرسمية" : "Official sales") ? visibleSeries.sales : item.name === (ar ? "المصروف المثبت" : "Posted spend") ? visibleSeries.spend : visibleSeries.campaigns),
    });
    const timelineObserver = new ResizeObserver(() => timeline.resize());
    timelineObserver.observe(timelineElement.current);
    return () => { timelineObserver.disconnect(); timeline.dispose(); };
  }, [campaigns, context, days, language, mode, title, visibleSeries]);
  return <section className="baseer-chart baseer-marketing-timeline" aria-label={title}>
    <header><div><h3>{title}</h3>{periodLabel ? <small>{periodLabel}</small> : null}</div><small>{language === "ar" ? `قراءة خادمية في ${asOf}` : `Server read as of ${asOf}`}</small></header>
    <div className="baseer-marketing-timeline__legend" aria-label={ar ? "مفاتيح الرسم" : "Chart legend"}>{legendItems.map((item) => <button key={item.id} type="button" className={`baseer-marketing-timeline__legend-button is-${item.kind}`} aria-pressed={visibleSeries[item.id]} onClick={() => setVisibleSeries((current) => ({ ...current, [item.id]: !current[item.id] }))}><span aria-hidden="true" /><strong>{item.label}</strong><small>{visibleSeries[item.id] ? (ar ? "ظاهر" : "Shown") : (ar ? "مخفي" : "Hidden")}</small></button>)}</div>
    <div ref={timelineElement} className="baseer-chart__plot baseer-marketing-timeline__plot" role="img" aria-label={title} />
  </section>;
}

/** A compact monthly operating view. Sales are intentionally null when the
 * day is incomplete; purchases have a true zero only when no posted purchase
 * invoice exists for that day. */
export function BaseerOperationsMonthChart({ language, title, days, asOf }: { language: Language; title: string; days: readonly BaseerOperationsMonthDay[]; asOf: string }) {
  const element = useRef<HTMLDivElement | null>(null);
  const [visibleSeries, setVisibleSeries] = useState({ sales: true, purchases: true });
  const ar = language === "ar";
  useEffect(() => {
    if (!element.current) return;
    const chart = init(element.current, undefined, { renderer: "svg" });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const description = ar ? `${title}. المبيعات المثبتة وفواتير المشتريات المثبتة خلال الشهر. الأيام غير المكتملة لا تظهر كمبيعات صفرية.` : `${title}. Posted sales and posted purchase invoices for the month. Incomplete sales days are not treated as zero.`;
    chart.setOption({
      animation: !reducedMotion,
      animationDuration: 850,
      animationDurationUpdate: 500,
      animationEasing: "cubicOut",
      aria: { enabled: true, description },
      grid: { left: 30, right: 22, top: 46, bottom: 30, containLabel: true },
      tooltip: {
        trigger: "axis",
        confine: true,
        formatter: (params: readonly { axisValue?: string; seriesName?: string; data?: unknown }[]) => {
          const date = params[0]?.axisValue ?? "";
          const item = days.find((day) => day.businessDate === date);
          if (!item) return "";
          const sales = item.salesGrossAmount === null ? (ar ? "غير مكتملة" : "Incomplete") : `${item.salesGrossAmount} SAR`;
          return [date, `${ar ? "المبيعات" : "Sales"}: ${sales}`, `${ar ? "المشتريات" : "Purchases"}: ${item.purchaseGrossAmount} SAR`, item.purchaseDocumentCount ? `${ar ? "فواتير المشتريات" : "Purchase invoices"}: ${item.purchaseDocumentCount}` : ""].filter(Boolean).map(escapeHtml).join("<br/>");
        },
      },
      xAxis: { type: "category", data: days.map((day) => day.businessDate), boundaryGap: false, axisLabel: { hideOverlap: true, formatter: (value: string) => value.slice(8) }, axisTick: { show: false } },
      yAxis: { type: "value", min: 0, axisLabel: { formatter: (value: number) => compactNumber(value, language) }, splitLine: { lineStyle: { color: "rgba(24, 74, 63, .12)" } } },
      series: [
        {
          name: ar ? "المبيعات" : "Sales", type: "line", smooth: true, connectNulls: false,
          data: days.map((day) => day.salesGrossAmount === null ? null : Number(day.salesGrossAmount)), symbolSize: 6,
          itemStyle: { color: "#078466" }, lineStyle: { width: 3 }, areaStyle: { color: "rgba(7, 132, 102, .12)" },
        },
        {
          name: ar ? "المشتريات" : "Purchases", type: "bar", barMaxWidth: 20,
          data: days.map((day) => Number(day.purchaseGrossAmount)), itemStyle: { color: "#d98c27", borderRadius: [5, 5, 0, 0] },
        },
      ].filter((series) => series.name === (ar ? "المبيعات" : "Sales") ? visibleSeries.sales : visibleSeries.purchases),
    });
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [ar, days, language, title, visibleSeries]);
  const legend = [{ id: "sales" as const, label: ar ? "المبيعات" : "Sales", color: "#078466" }, { id: "purchases" as const, label: ar ? "المشتريات" : "Purchases", color: "#d98c27" }];
  return <section className="baseer-chart baseer-operations-month-chart" aria-label={title}><header><div><h3>{title}</h3><small>{ar ? `حتى ${asOf}` : `Through ${asOf}`}</small></div></header><div className="baseer-marketing-timeline__legend" aria-label={ar ? "مفتاح الرسم" : "Chart legend"}>{legend.map((item) => <button key={item.id} type="button" className="baseer-marketing-timeline__legend-button" aria-pressed={visibleSeries[item.id]} onClick={() => setVisibleSeries((current) => ({ ...current, [item.id]: !current[item.id] }))}><span aria-hidden="true" style={{ background: item.color }} /><strong>{item.label}</strong><small>{visibleSeries[item.id] ? (ar ? "ظاهر" : "Shown") : (ar ? "مخفي" : "Hidden")}</small></button>)}</div><div ref={element} className="baseer-chart__plot baseer-operations-month-chart__plot" role="img" aria-label={title} /></section>;
}

function compactNumber(value: number, language: Language) {
  return new Intl.NumberFormat(language === "ar" ? "ar-SA" : "en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function formatTimelinePeriod(months: readonly string[], language: Language) {
  if (!months.length) return "";
  const formatter = new Intl.DateTimeFormat(language === "ar" ? "ar-SA-u-ca-gregory" : "en", { month: "long", year: "numeric", timeZone: "UTC" });
  const formatMonth = (month: string) => formatter.format(new Date(`${month}-01T00:00:00Z`));
  return months.length === 1 ? formatMonth(months[0]) : months.map(formatMonth).join(language === "ar" ? " – " : " – ");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
