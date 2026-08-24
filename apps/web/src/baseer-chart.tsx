import { BarChart, LineChart, PieChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { formatCompactNumber, formatCount, formatDate, formatMoney, formatMonthYear, formatNumber, formatPercent } from "./number-format";

use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, AriaComponent, SVGRenderer]);

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
  const ar = language === "ar";
  const maximum = Math.max(0, ...points.map((point) => point.value));
  const pointDisplay = (point: BaseerOperationalChartPoint) => point.displayValue ?? formatNumber(point.value, language);
  useEffect(() => {
    if (presentation !== "chart" || !element.current) return;
    const chart = init(element.current, undefined, { renderer: "svg" });
    const description = language === "ar" ? `${title}. ${points.map((point) => `${point.label}: ${pointDisplay(point)}`).join("، ")}` : `${title}. ${points.map((point) => `${point.label}: ${pointDisplay(point)}`).join(", ")}`;
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
          formatter: (params: { dataIndex: number }) => { const point = points[params.dataIndex]; return point ? pointDisplay(point) : ""; },
        },
        emphasis: { itemStyle: { color: "#075943" } },
      }],
    });
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [language, points, presentation, title]);
  return <section className="baseer-chart" aria-label={title}>
    <header><div className="baseer-chart__heading"><h3>{title}</h3>{showSummary ? <small>{language === "ar" ? `حسب ملخص الخادم في ${formatDate(asOf, language)}` : `Server summary as of ${formatDate(asOf, language)}`}</small> : null}</div>{headerActions}</header>
    {showSummary ? <p>{points.map((point) => `${point.label}: ${pointDisplay(point)}`).join(" · ")}</p> : null}
    {presentation === "inlineRows" ? <table className="baseer-chart__inline-table" dir={language === "ar" ? "rtl" : "ltr"}><caption className="visually-hidden">{title}</caption><thead><tr><th>#</th><th>{language === "ar" ? "الفئة" : "Category"}</th><th>{language === "ar" ? "الحركة" : "Movement"}</th><th>{inlineShareLabel ?? (language === "ar" ? "من إجمالي الإنفاق" : "Share of spend")}</th><th>{language === "ar" ? "القيمة" : "Value"}</th></tr></thead><tbody>{points.map((point, index) => {
      const declaredShare = point.shareOfTotalPercent === undefined ? Number.NaN : Number(point.shareOfTotalPercent);
      // When a share is supplied, the bar represents that percentage of the
      // selected denominator instead of merely ranking rows against the largest row.
      const scale = Number.isFinite(declaredShare) ? Math.max(0, Math.min(1, declaredShare / 100)) : maximum > 0 ? Math.max(0, Math.min(1, point.value / maximum)) : 0;
      const barStyle = { "--baseer-bar-scale": String(scale), "--baseer-bar-delay": `${index * 70}ms` } as CSSProperties;
      return <tr key={point.id ?? point.label}><td className="baseer-chart__rank" dir="ltr">{formatCount(point.rank ?? index + 1, language)}</td><th scope="row">{onPointClick ? <button type="button" className="baseer-chart__point-link" onClick={() => onPointClick(point)}>{point.label}</button> : point.label}</th><td><span className="baseer-chart__inline-bar" aria-hidden="true"><span className="baseer-chart__inline-bar-fill" style={barStyle} /></span></td><td className="baseer-chart__share" dir="ltr">{point.shareOfTotalPercent === undefined ? "—" : formatPercent(point.shareOfTotalPercent, 2, language)}</td><td dir="ltr">{pointDisplay(point)}</td></tr>;
    })}</tbody></table> : <><div ref={element} className="baseer-chart__plot" style={{ minBlockSize: `${Math.max(15, points.length * 2.15)}rem` }} role="img" aria-label={title} /><table><caption className="visually-hidden">{title}</caption><thead><tr><th>{language === "ar" ? "المؤشر" : "Metric"}</th><th>{language === "ar" ? "القيمة" : "Value"}</th></tr></thead><tbody>{points.map((point) => <tr key={point.label}><th scope="row">{point.label}</th><td dir="ltr">{pointDisplay(point)}</td></tr>)}</tbody></table></>}
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
  const element = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof init> | null>(null);
  const ar = language === "ar";
  const palette = ["#159a79", "#4f7fd7", "#e2a238"];
  const primary = points[0];
  const [selectedKey, setSelectedKey] = useState(primary?.id ?? primary?.label ?? "");
  const selectedIndex = Math.max(0, points.findIndex((point) => (point.id ?? point.label) === selectedKey));
  const selectedPoint = points[selectedIndex] ?? primary;
  const selectPoint = (key: string) => setSelectedKey((current) => current === key ? current : key);
  const totalSignals = points.reduce((sum, point) => sum + Math.max(0, point.value), 0);
  const primaryDisplay = primary ? (primary.displayValue ?? formatCount(primary.value, language)) : "—";

  useEffect(() => {
    const fallbackKey = primary?.id ?? primary?.label ?? "";
    if (!points.some((point) => (point.id ?? point.label) === selectedKey)) setSelectedKey(fallbackKey);
  }, [points, primary, selectedKey]);

  useEffect(() => {
    if (!element.current) return;
    const chart = init(element.current, undefined, { renderer: "svg" });
    chartRef.current = chart;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const chartPoints = points.map((point, index) => ({
      name: point.label,
      value: Math.max(0, point.value),
      itemStyle: { color: palette[index % palette.length] },
    }));
    const description = ar
      ? `${title}. ${points.map((point) => `${point.label}: ${point.displayValue ?? formatCount(point.value, language)}`).join("، ")}`
      : `${title}. ${points.map((point) => `${point.label}: ${point.displayValue ?? formatCount(point.value, language)}`).join(", ")}`;
    chart.setOption({
      animation: !reducedMotion,
      animationDuration: 940,
      animationDurationUpdate: 360,
      animationEasing: "cubicOut",
      animationEasingUpdate: "cubicOut",
      aria: { enabled: true, description },
      tooltip: {
        trigger: "item",
        confine: true,
        borderWidth: 0,
        backgroundColor: "#113d32",
        textStyle: { color: "#ffffff", fontFamily: "inherit" },
        formatter: (params: { dataIndex?: number }) => {
          const point = points[params.dataIndex ?? 0];
          return point ? `${escapeHtml(point.label)}<br/><strong>${escapeHtml(point.displayValue ?? formatCount(point.value, language))}</strong>` : "";
        },
      },
      series: [
        {
          type: "pie",
          silent: true,
          radius: ["61%", "79%"],
          center: ["50%", "50%"],
          label: { show: false },
          tooltip: { show: false },
          data: [{ value: 1, itemStyle: { color: "rgba(16, 98, 78, .09)" } }],
        },
        {
          type: "pie",
          radius: ["61%", "79%"],
          center: ["50%", "50%"],
          minAngle: totalSignals ? 3 : 0,
          padAngle: totalSignals ? 2 : 0,
          stillShowZeroSum: false,
          selectedMode: "single",
          selectedOffset: 7,
          avoidLabelOverlap: true,
          label: { show: false },
          labelLine: { show: false },
          itemStyle: { borderColor: "#ffffff", borderWidth: 3, borderRadius: 12 },
          emphasis: { scale: true, scaleSize: 8, itemStyle: { shadowBlur: 15, shadowColor: "rgba(11, 78, 62, .25)" } },
          data: chartPoints,
        },
      ],
    });
    chart.on("mouseover", (params: { seriesIndex?: number; dataIndex?: number }) => {
      if (params.seriesIndex !== 1 || params.dataIndex === undefined) return;
      const point = points[params.dataIndex];
      if (point) selectPoint(point.id ?? point.label);
    });
    chart.on("click", (params: { seriesIndex?: number; dataIndex?: number }) => {
      if (params.seriesIndex !== 1 || params.dataIndex === undefined) return;
      const point = points[params.dataIndex];
      if (point) selectPoint(point.id ?? point.label);
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      if (chartRef.current === chart) chartRef.current = null;
    };
  }, [ar, language, points, title, totalSignals]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !points.length) return;
    points.forEach((_point, index) => chart.dispatchAction({ type: "unselect", seriesIndex: 1, dataIndex: index }));
    chart.dispatchAction({ type: "select", seriesIndex: 1, dataIndex: selectedIndex });
  }, [points, selectedIndex]);

  return <section className="hr-workforce-chart" aria-label={title} dir={ar ? "rtl" : "ltr"}>
    <header className="hr-workforce-chart__header">
      <div><p>{ar ? "لقطة تشغيلية" : "Operational snapshot"}</p><h3>{title}</h3></div>
      <small>{ar ? `محدّث في ${formatDate(asOf, language)}` : `Updated ${formatDate(asOf, language)}`}</small>
    </header>
    <div className="hr-workforce-chart__body">
      <div className="hr-workforce-chart__visual">
        <div ref={element} className="hr-workforce-chart__plot" role="img" aria-label={title} />
        <div className="hr-workforce-chart__center" aria-hidden="true"><strong dir="ltr">{primaryDisplay}</strong><span>{primary?.label ?? (ar ? "الموظفون" : "Employees")}</span></div>
      </div>
      <div className="hr-workforce-chart__insights" aria-label={ar ? "تفاصيل الحالة" : "Status details"}>
        {points.map((point, index) => {
          const key = point.id ?? point.label;
          const isSelected = key === (selectedPoint?.id ?? selectedPoint?.label);
          const display = point.displayValue ?? formatCount(point.value, language);
          return <button key={key} type="button" className="hr-workforce-chart__insight" aria-pressed={isSelected} onClick={() => selectPoint(key)}>
            <span className="hr-workforce-chart__dot" style={{ backgroundColor: palette[index % palette.length] }} aria-hidden="true" />
            <span><strong>{point.label}</strong><small>{isSelected ? (ar ? "الحالة المحددة" : "Selected status") : (ar ? "عرض التفاصيل" : "View detail")}</small></span>
            <b dir="ltr">{display}</b>
          </button>;
        })}
      </div>
    </div>
    <footer className="hr-workforce-chart__footer"><span>{ar ? "مرّر أو اضغط على أي مؤشر لاستكشافه" : "Hover or select a status to explore it"}</span><span>{ar ? "المؤشرات قد تتداخل بين الموظفين" : "Signals may overlap across employees"}</span></footer>
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
        formatDate(item.businessDate, language),
        `${ar ? "المبيعات الرسمية" : "Official sales"}: ${item.officialNetSales === null ? (ar ? "غير متاحة" : "Unavailable") : formatMoney(item.officialNetSales, ar ? "ر.س" : "SAR", language)}`,
        `${ar ? "حالة المبيعات" : "Sales state"}: ${qualityLabel(item.salesDayQuality)}`,
        `${ar ? "المصروف المرتبط المثبت" : "Posted linked spend"}: ${item.linkedFinancialDocumentCount ? formatMoney(item.linkedActualSpend, ar ? "ر.س" : "SAR", language) : (ar ? "لا يوجد مستند مرتبط" : "No linked document")}`,
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
    <header><div><h3>{title}</h3>{periodLabel ? <small>{periodLabel}</small> : null}</div><small>{language === "ar" ? `قراءة خادمية في ${formatDate(asOf, language)}` : `Server read as of ${formatDate(asOf, language)}`}</small></header>
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
          const sales = item.salesGrossAmount === null ? (ar ? "غير مكتملة" : "Incomplete") : formatMoney(item.salesGrossAmount, ar ? "ر.س" : "SAR", language);
          return [formatDate(date, language), `${ar ? "المبيعات" : "Sales"}: ${sales}`, `${ar ? "المشتريات" : "Purchases"}: ${formatMoney(item.purchaseGrossAmount, ar ? "ر.س" : "SAR", language)}`, item.purchaseDocumentCount ? `${ar ? "فواتير المشتريات" : "Purchase invoices"}: ${formatCount(item.purchaseDocumentCount, language)}` : ""].filter(Boolean).map(escapeHtml).join("<br/>");
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
  return <section className="baseer-chart baseer-operations-month-chart" aria-label={title}><header><div><h3>{title}</h3><small>{ar ? `حتى ${formatDate(asOf, language)}` : `Through ${formatDate(asOf, language)}`}</small></div></header><div className="baseer-marketing-timeline__legend" aria-label={ar ? "مفتاح الرسم" : "Chart legend"}>{legend.map((item) => <button key={item.id} type="button" className="baseer-marketing-timeline__legend-button" aria-pressed={visibleSeries[item.id]} onClick={() => setVisibleSeries((current) => ({ ...current, [item.id]: !current[item.id] }))}><span aria-hidden="true" style={{ background: item.color }} /><strong>{item.label}</strong><small>{visibleSeries[item.id] ? (ar ? "ظاهر" : "Shown") : (ar ? "مخفي" : "Hidden")}</small></button>)}</div><div ref={element} className="baseer-chart__plot baseer-operations-month-chart__plot" role="img" aria-label={title} /></section>;
}

function compactNumber(value: number, language: Language) {
  return formatCompactNumber(value, language);
}

function formatTimelinePeriod(months: readonly string[], language: Language) {
  if (!months.length) return "";
  return months.length === 1 ? formatMonthYear(months[0], language) : months.map((month) => formatMonthYear(month, language)).join(" – ");
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
