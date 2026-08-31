import { BarChart, LineChart } from "echarts/charts";
import { GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";
import { chartAlpha, useBaseerChartPalette } from "./baseer-chart-theme";

use([BarChart, LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type Language = "ar" | "en";

function designFontSize(styles: CSSStyleDeclaration, token: "--font-caption" | "--font-label", fallback: number) {
  const value = styles.getPropertyValue(token).trim();
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (value.endsWith("rem")) return numeric * (Number.parseFloat(styles.fontSize) || 16);
  return numeric;
}

function compactAmount(value: number, language: Language) {
  const ar = language === "ar";
  if (Math.abs(value) >= 1_000_000) return `${Math.round(value / 1_000_000)} ${ar ? "م" : "M"}`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)} ${ar ? "ألف" : "k"}`;
  return String(Math.round(value));
}

export type MonthlyApplicationSalesSharePoint = {
  label: string;
  monthLabel: string;
  shortLabel: string;
  totalSalesPlotValue: number | null;
  applicationSalesPlotValue: number | null;
  sharePlotValue: number | null;
  shareDisplay: string | null;
  totalSalesDisplay: string | null;
  applicationSalesDisplay: string | null;
};

export function MonthlyApplicationSalesShareChart({ language, title, points }: { language: Language; title: string; points: readonly MonthlyApplicationSalesSharePoint[] }) {
  const element = useRef<HTMLDivElement | null>(null);
  const ar = language === "ar";
  const chartPalette = useBaseerChartPalette();

  useEffect(() => {
    if (!element.current) return;
    const chart = init(element.current, undefined, { renderer: "canvas" });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const rootStyles = getComputedStyle(document.documentElement);
    const brand = chartPalette.primary;
    // Theme 2 intentionally shares its brand and secondary hues. The application
    // bar must still remain distinguishable from total sales on a financial chart.
    const applicationBar = chartPalette.secondary === brand ? chartPalette.info : chartPalette.secondary;
    const shareLine = chartPalette.info === applicationBar ? chartPalette.danger : chartPalette.info;
    const captionFontSize = designFontSize(rootStyles, "--font-caption", 13);
    const labelFontSize = designFontSize(rootStyles, "--font-label", 14);
    const totalsLabel = ar ? "إجمالي المبيعات" : "Total sales";
    const applicationLabel = ar ? "مبيعات التطبيقات" : "Application sales";
    const shareLabel = ar ? "نسبة التطبيقات" : "Application share";
    const description = ar
      ? `${title}. ${points.map((point) => `${point.label}: ${totalsLabel} ${point.totalSalesDisplay ?? "بيانات غير مكتملة"}، ${applicationLabel} ${point.applicationSalesDisplay ?? "—"}، ${shareLabel} ${point.shareDisplay ?? "—"}`).join("؛ ")}`
      : `${title}. ${points.map((point) => `${point.label}: ${totalsLabel} ${point.totalSalesDisplay ?? "Incomplete data"}, ${applicationLabel} ${point.applicationSalesDisplay ?? "—"}, ${shareLabel} ${point.shareDisplay ?? "—"}`).join("; ")}`;
    const renderForAvailableSpace = () => {
      const compact = element.current!.clientWidth < 580;
      const axisFontSize = compact ? Math.min(captionFontSize, 10) : captionFontSize;
      const yAxisName = compact ? "" : ar ? "ر.س" : "SAR";
      chart.setOption({
      animation: !reducedMotion,
      animationDuration: 820,
      animationDurationUpdate: 420,
      animationEasing: "cubicOut",
      animationEasingUpdate: "cubicInOut",
      aria: { enabled: true, description },
      color: [brand, applicationBar, shareLine],
      legend: {
        top: 3,
        left: compact ? 2 : 4,
        right: compact ? 2 : 4,
        selectedMode: false,
        itemWidth: compact ? 8 : 10,
        itemHeight: compact ? 8 : 10,
        itemGap: compact ? 6 : 12,
        textStyle: { color: chartPalette.axis, fontFamily: "inherit", fontSize: compact ? Math.min(captionFontSize, 11) : captionFontSize, fontWeight: 700 },
      },
      tooltip: {
        trigger: "axis", confine: true, backgroundColor: chartPalette.tooltipSurface, borderColor: chartPalette.tooltipBorder, borderWidth: 1, padding: [10, 12], textStyle: { color: chartPalette.primaryDeep, fontFamily: "inherit" },
        axisPointer: { type: "shadow", shadowStyle: { color: chartAlpha(brand, .08) } },
        formatter: (items: unknown) => {
          const item = Array.isArray(items) ? items[0] : undefined;
          const index = item && typeof item === "object" && "dataIndex" in item ? Number(item.dataIndex) : -1;
          const point = points[index];
          if (!point) return "";
          const rows = point.shareDisplay === null
            ? [[ar ? "الحالة" : "Status", ar ? "بيانات غير مكتملة" : "Incomplete data"]]
            : [[totalsLabel, point.totalSalesDisplay ?? "—"], [applicationLabel, point.applicationSalesDisplay ?? "—"], [shareLabel, point.shareDisplay]];
          return `<div dir="${ar ? "rtl" : "ltr"}" class="application-sales-share-tooltip"><strong>${point.label}</strong>${rows.map(([label, value]) => `<span><em>${label}</em><b>${value}</b></span>`).join("")}</div>`;
        },
      },
      // `containLabel` reserves each axis label inside this box. Keeping the
      // outer offsets small lets the chart use the card width rather than
      // paying a second fixed margin for the two Y axes on narrow phones.
      grid: { left: compact ? 2 : 10, right: compact ? 2 : 20, top: compact ? 48 : 60, bottom: compact ? 30 : 40, containLabel: true },
      xAxis: {
        type: "category",
        data: points.map((point) => compact ? point.shortLabel : point.monthLabel),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: chartPalette.tooltipBorder } },
        axisLabel: { color: chartPalette.axis, fontSize: axisFontSize, fontWeight: 700, interval: compact ? 2 : 0, hideOverlap: true, margin: compact ? 5 : 8 },
      },
      yAxis: [
        {
          type: "value",
          min: 0,
          name: yAxisName,
          nameTextStyle: { color: chartPalette.axis, fontSize: compact ? axisFontSize : labelFontSize, fontWeight: 700, padding: [0, 0, 0, compact ? 0 : 5] },
          axisLabel: { color: chartPalette.axis, fontSize: axisFontSize, fontWeight: 650, margin: compact ? 4 : 8, formatter: (value: number) => compactAmount(value, language) },
          axisTick: { show: false },
          axisLine: { show: false },
          splitLine: { lineStyle: { color: chartPalette.grid, type: "dashed" } },
        },
        {
          type: "value",
          min: 0,
          max: 100,
          interval: 25,
          position: "right",
          name: compact ? "" : "%",
          nameTextStyle: { color: chartPalette.axis, fontSize: compact ? axisFontSize : labelFontSize, fontWeight: 700, padding: [0, 0, 0, compact ? 0 : 5] },
          axisLabel: { color: chartPalette.axis, fontSize: axisFontSize, fontWeight: 650, margin: compact ? 4 : 8, formatter: (value: number) => `${value}%` },
          axisTick: { show: false },
          axisLine: { show: false },
          splitLine: { show: false },
        },
      ],
      series: [
        {
          name: totalsLabel,
          type: "bar",
          data: points.map((point) => point.totalSalesPlotValue),
          yAxisIndex: 0,
          barMaxWidth: compact ? 20 : 30,
          barGap: "18%",
          animationDelay: (index: number) => index * 45,
          itemStyle: { color: brand, borderRadius: [4, 4, 0, 0] },
          emphasis: { focus: "series", itemStyle: { color: brand } },
        },
        {
          name: applicationLabel,
          type: "bar",
          data: points.map((point) => point.applicationSalesPlotValue),
          yAxisIndex: 0,
          barMaxWidth: compact ? 20 : 30,
          itemStyle: { color: applicationBar, borderRadius: [4, 4, 0, 0] },
          emphasis: { focus: "series", itemStyle: { color: applicationBar } },
        },
        {
          name: shareLabel,
          type: "line",
          data: points.map((point) => point.sharePlotValue),
          yAxisIndex: 1,
          smooth: .28,
          connectNulls: false,
          showSymbol: !compact,
          symbol: "circle",
          symbolSize: compact ? 5 : 7,
          lineStyle: { width: compact ? 2.5 : 3, color: shareLine },
          itemStyle: { color: shareLine, borderColor: chartPalette.tooltipSurface, borderWidth: 1.5 },
          emphasis: { focus: "series", scale: true },
        },
      ],
      });
    };
    renderForAvailableSpace();
    const observer = new ResizeObserver(() => {
      chart.resize();
      renderForAvailableSpace();
    });
    observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [ar, chartPalette.revision, language, points, title]);

  return <div ref={element} className="application-sales-share-chart" role="img" aria-label={title} />;
}
