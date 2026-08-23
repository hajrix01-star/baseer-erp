import { BarChart, HeatmapChart, LineChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent, VisualMapComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

use([BarChart, HeatmapChart, LineChart, GridComponent, TooltipComponent, LegendComponent, VisualMapComponent, AriaComponent, SVGRenderer]);

type Language = "ar" | "en";
export type BaseerOperationalChartPoint = { label: string; value: number; displayValue?: string };
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

/** A local, accessible visualisation of server-provided operational totals. */
export function BaseerChart({ language, title, points, asOf }: { language: Language; title: string; points: readonly BaseerOperationalChartPoint[]; asOf: string }) {
  const element = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!element.current) return;
    const chart = init(element.current, undefined, { renderer: "svg" });
    const description = language === "ar" ? `${title}. ${points.map((point) => `${point.label}: ${point.value}`).join("، ")}` : `${title}. ${points.map((point) => `${point.label}: ${point.value}`).join(", ")}`;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    chart.setOption({ animation: !reducedMotion, aria: { enabled: true, description }, grid: { left: 24, right: 12, top: 20, bottom: 24, containLabel: true }, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: points.map((point) => point.label), axisLabel: { interval: 0 } }, yAxis: { type: "value", minInterval: 1 }, series: [{ type: "bar", data: points.map((point) => point.value), itemStyle: { color: "#236a8a" }, emphasis: { itemStyle: { color: "#164b62" } } }] });
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [language, points, title]);
  return <section className="baseer-chart" aria-label={title}>
    <header><h3>{title}</h3><small>{language === "ar" ? `حسب ملخص الخادم في ${asOf}` : `Server summary as of ${asOf}`}</small></header>
    <p>{points.map((point) => `${point.label}: ${point.displayValue ?? point.value}`).join(" · ")}</p>
    <div ref={element} className="baseer-chart__plot" role="img" aria-label={title} />
    <table><caption className="visually-hidden">{title}</caption><thead><tr><th>{language === "ar" ? "المؤشر" : "Metric"}</th><th>{language === "ar" ? "القيمة" : "Value"}</th></tr></thead><tbody>{points.map((point) => <tr key={point.label}><th scope="row">{point.label}</th><td dir="ltr">{point.displayValue ?? point.value}</td></tr>)}</tbody></table>
  </section>;
}

/**
 * Shared, server-read-only visualisation for Marketing. It renders both a
 * daily timeline and a heatmap without computing sales or spend in React.
 */
export function BaseerMarketingTimelineChart({ language, title, days, campaigns, context, asOf }: {
  language: Language;
  title: string;
  days: readonly BaseerMarketingTimelineDay[];
  campaigns: readonly BaseerMarketingTimelineCampaign[];
  context: readonly BaseerMarketingTimelineContext[];
  asOf: string;
}) {
  const timelineElement = useRef<HTMLDivElement | null>(null);
  const heatmapElement = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!timelineElement.current || !heatmapElement.current) return;
    const timeline = init(timelineElement.current, undefined, { renderer: "svg" });
    const heatmap = init(heatmapElement.current, undefined, { renderer: "svg" });
    const ar = language === "ar";
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const labels = days.map((item) => item.businessDate);
    const campaignsById = new Map(campaigns.map((campaign) => [campaign.id, campaign]));
    const qualityLabel = (quality: BaseerMarketingTimelineDay["salesDayQuality"]) => ar
      ? ({ READY: "مكتمل", PENDING: "بانتظار الإقفال", PARTIAL: "يوم جزئي", MISSING: "لا توجد قراءة" } as const)[quality]
      : ({ READY: "Ready", PENDING: "Pending close", PARTIAL: "Partial day", MISSING: "No read" } as const)[quality];
    const contextsForDay = (businessDate: string) => context.filter((item) => item.startsOn <= businessDate && item.endsOn >= businessDate);
    const tooltip = (params: readonly { axisValue?: string; seriesName?: string; data?: unknown }[]) => {
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
    const maxSales = Math.max(0, ...days.map((item) => item.officialNetSales === null ? 0 : Number(item.officialNetSales)));
    const contextAreas = context.slice(0, 40).map((item) => [{ name: item.titleAr, xAxis: item.startsOn }, { xAxis: item.endsOn }]);
    const description = ar
      ? `${title}. خط زمني يومي للمبيعات الرسمية والمصروف المرتبط والحملات. لا تُعرض الأيام الناقصة كصفر.`
      : `${title}. A daily timeline of official sales, linked spend, and campaigns. Missing days are not shown as zero.`;
    timeline.setOption({
      animation: !reducedMotion,
      aria: { enabled: true, description },
      grid: { left: 28, right: 30, top: 52, bottom: 42, containLabel: true },
      legend: { top: 8, data: [ar ? "المبيعات الرسمية" : "Official sales", ar ? "المصروف المثبت" : "Posted spend", ar ? "الحملات النشطة" : "Active campaigns"] },
      tooltip: { trigger: "axis", confine: true, formatter: tooltip },
      xAxis: { type: "category", data: labels, boundaryGap: false, axisLabel: { hideOverlap: true, formatter: (value: string) => value.slice(5) } },
      yAxis: [
        { type: "value", name: ar ? "ر.س" : "SAR", min: 0, axisLabel: { formatter: (value: number) => compactNumber(value, language) } },
        { type: "value", name: ar ? "حملات" : "Campaigns", minInterval: 1, min: 0 },
      ],
      series: [
        {
          name: ar ? "المبيعات الرسمية" : "Official sales", type: "line", smooth: true, connectNulls: false,
          data: days.map((item) => item.officialNetSales === null ? null : Number(item.officialNetSales)),
          itemStyle: { color: "#0c8a6a" }, areaStyle: { color: "rgba(12, 138, 106, .13)" },
          markArea: contextAreas.length ? { silent: true, itemStyle: { color: "rgba(193, 139, 31, .08)" }, data: contextAreas } : undefined,
        },
        {
          name: ar ? "المصروف المثبت" : "Posted spend", type: "bar", barMaxWidth: 16,
          data: days.map((item) => item.linkedFinancialDocumentCount ? Number(item.linkedActualSpend) : null),
          itemStyle: { color: "#d98c27" },
        },
        {
          name: ar ? "الحملات النشطة" : "Active campaigns", type: "line", yAxisIndex: 1, step: "middle", symbol: "none",
          data: days.map((item) => item.activeCampaignIds.length), itemStyle: { color: "#4968c8" }, lineStyle: { type: "dashed" },
        },
      ],
    });
    heatmap.setOption({
      animation: !reducedMotion,
      aria: { enabled: true, description: ar ? "خريطة حرارية يومية للمبيعات الرسمية. الأيام الناقصة أو الجزئية غير ملوّنة." : "A daily official-sales heatmap. Missing or partial days are uncoloured." },
      tooltip: { position: "top", formatter: tooltip },
      grid: { left: 28, right: 28, top: 22, bottom: 44, containLabel: true },
      xAxis: { type: "category", data: labels, splitArea: { show: true }, axisLabel: { hideOverlap: true, formatter: (value: string) => value.slice(5) } },
      yAxis: { type: "category", data: [ar ? "المبيعات" : "Sales"], splitArea: { show: true } },
      visualMap: { min: 0, max: maxSales || 1, calculable: true, orient: "horizontal", left: "center", bottom: 0, inRange: { color: ["#eaf5f1", "#76c7b2", "#0c8a6a"] }, text: ar ? ["أعلى", "أقل"] : ["High", "Low"] },
      series: [{ type: "heatmap", data: days.flatMap((item, index) => item.officialNetSales === null ? [] : [[index, 0, Number(item.officialNetSales)]]), emphasis: { itemStyle: { shadowBlur: 8, shadowColor: "rgba(0, 0, 0, .28)" } } }],
    });
    const timelineObserver = new ResizeObserver(() => timeline.resize());
    const heatmapObserver = new ResizeObserver(() => heatmap.resize());
    timelineObserver.observe(timelineElement.current);
    heatmapObserver.observe(heatmapElement.current);
    return () => { timelineObserver.disconnect(); heatmapObserver.disconnect(); timeline.dispose(); heatmap.dispose(); };
  }, [campaigns, context, days, language, title]);
  return <section className="baseer-chart baseer-marketing-timeline" aria-label={title}>
    <header><h3>{title}</h3><small>{language === "ar" ? `قراءة خادمية في ${asOf}` : `Server read as of ${asOf}`}</small></header>
    <p>{language === "ar" ? "المبيعات خط أخضر، والمصروف المثبت أعمدة، والخط المتقطع عدد الحملات. مرّر المؤشر على اليوم لعرض سياقه." : "Sales are green, posted spend is shown as bars, and the dashed line is active campaign count. Hover a day for context."}</p>
    <div ref={timelineElement} className="baseer-chart__plot baseer-marketing-timeline__plot" role="img" aria-label={title} />
    <h4>{language === "ar" ? "الخريطة الحرارية اليومية للمبيعات" : "Daily sales heatmap"}</h4>
    <div ref={heatmapElement} className="baseer-chart__plot baseer-marketing-timeline__heatmap" role="img" aria-label={language === "ar" ? "الخريطة الحرارية اليومية للمبيعات" : "Daily sales heatmap"} />
    <details><summary>{language === "ar" ? "عرض جدول الأيام وإتاحتها" : "Show day table and availability"}</summary><table><caption className="visually-hidden">{title}</caption><thead><tr><th>{language === "ar" ? "اليوم" : "Day"}</th><th>{language === "ar" ? "المبيعات الرسمية" : "Official sales"}</th><th>{language === "ar" ? "الحالة" : "State"}</th><th>{language === "ar" ? "المصروف المرتبط" : "Linked spend"}</th><th>{language === "ar" ? "الحملات" : "Campaigns"}</th></tr></thead><tbody>{days.map((item) => <tr key={item.businessDate}><th scope="row">{item.businessDate}</th><td>{item.officialNetSales ?? "—"}</td><td>{item.salesDayQuality}</td><td>{item.linkedFinancialDocumentCount ? item.linkedActualSpend : "—"}</td><td>{item.activeCampaignIds.length}</td></tr>)}</tbody></table></details>
  </section>;
}

function compactNumber(value: number, language: Language) {
  return new Intl.NumberFormat(language === "ar" ? "ar-SA" : "en", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character);
}
