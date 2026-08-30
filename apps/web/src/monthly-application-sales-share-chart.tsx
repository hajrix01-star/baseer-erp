import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

type Language = "ar" | "en";

function designFontSize(styles: CSSStyleDeclaration, token: "--font-caption" | "--font-label", fallback: number) {
  const value = styles.getPropertyValue(token).trim();
  const numeric = Number.parseFloat(value);
  if (!Number.isFinite(numeric)) return fallback;
  if (value.endsWith("rem")) return numeric * (Number.parseFloat(styles.fontSize) || 16);
  return numeric;
}

export type MonthlyApplicationSalesSharePoint = {
  label: string;
  monthLabel: string;
  shortLabel: string;
  sharePlotValue: number | null;
  shareDisplay: string | null;
  totalSalesDisplay: string | null;
  applicationSalesDisplay: string | null;
};

export function MonthlyApplicationSalesShareChart({ language, title, points }: { language: Language; title: string; points: readonly MonthlyApplicationSalesSharePoint[] }) {
  const element = useRef<HTMLDivElement | null>(null);
  const ar = language === "ar";

  useEffect(() => {
    if (!element.current) return;
    const chart = init(element.current, undefined, { renderer: "canvas" });
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const theme = getComputedStyle(document.body);
    const rootStyles = getComputedStyle(document.documentElement);
    const brand = theme.getPropertyValue("--brand").trim() || "#08744d";
    const captionFontSize = designFontSize(rootStyles, "--font-caption", 13);
    const labelFontSize = designFontSize(rootStyles, "--font-label", 14);
    const compact = element.current.clientWidth < 580;
    const description = ar ? `${title}. ${points.map((point) => `${point.label}: ${point.shareDisplay ?? "لا توجد مبيعات مكتملة"}`).join("، ")}` : `${title}. ${points.map((point) => `${point.label}: ${point.shareDisplay ?? "No complete sales data"}`).join(", ")}`;
    chart.setOption({
      animation: !reducedMotion,
      animationDuration: 820,
      animationDurationUpdate: 420,
      animationEasing: "cubicOut",
      animationEasingUpdate: "cubicInOut",
      aria: { enabled: true, description },
      tooltip: {
        trigger: "axis", confine: true, backgroundColor: "#fffdf8", borderColor: "#d7e5dd", borderWidth: 1, padding: [10, 12], textStyle: { color: "#173d32", fontFamily: "inherit" },
        axisPointer: { type: "shadow", shadowStyle: { color: "rgba(18, 121, 88, .08)" } },
        formatter: (items: unknown) => {
          const item = Array.isArray(items) ? items[0] : undefined;
          const index = item && typeof item === "object" && "dataIndex" in item ? Number(item.dataIndex) : -1;
          const point = points[index];
          if (!point) return "";
          const rows = point.shareDisplay === null ? [[ar ? "الحالة" : "Status", ar ? "بيانات غير مكتملة" : "Incomplete data"]] : [[ar ? "نسبة التطبيقات" : "Application share", point.shareDisplay], [ar ? "مبيعات التطبيقات" : "Application sales", point.applicationSalesDisplay ?? "—"], [ar ? "إجمالي المبيعات" : "Total sales", point.totalSalesDisplay ?? "—"]];
          return `<div dir="${ar ? "rtl" : "ltr"}" class="application-sales-share-tooltip"><strong>${point.label}</strong>${rows.map(([label, value]) => `<span><em>${label}</em><b>${value}</b></span>`).join("")}</div>`;
        },
      },
      grid: { left: 18, right: 22, top: 34, bottom: compact ? 34 : 40, containLabel: true },
      xAxis: { type: "category", data: points.map((point) => compact ? point.shortLabel : point.monthLabel), axisTick: { show: false }, axisLine: { lineStyle: { color: "#d8e3dc" } }, axisLabel: { color: "#45665a", fontSize: captionFontSize, fontWeight: 700, interval: 0, hideOverlap: false } },
      yAxis: { type: "value", min: 0, max: 100, interval: 25, name: ar ? "النسبة" : "Share", nameTextStyle: { color: "#45665a", fontSize: labelFontSize, fontWeight: 700, padding: ar ? [0, 0, 0, 10] : [0, 10, 0, 0] }, axisLabel: { color: "#45665a", fontSize: captionFontSize, fontWeight: 650, formatter: (value: number) => `${value}%` }, axisTick: { show: false }, axisLine: { show: false }, splitLine: { lineStyle: { color: "rgba(22, 83, 61, .10)", type: "dashed" } } },
      series: [{
        name: ar ? "نسبة مبيعات التطبيقات" : "Application sales share", type: "bar", data: points.map((point) => point.sharePlotValue), barMaxWidth: 38, animationDelay: (index: number) => index * 45,
        itemStyle: { color: brand },
        emphasis: { focus: "series", itemStyle: { color: brand } },
        label: { show: !compact, position: "top", distance: 9, color: brand, fontSize: labelFontSize, fontWeight: 800, formatter: (params: { dataIndex: number }) => points[params.dataIndex]?.shareDisplay ?? "" },
      }],
    });
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [ar, language, points, title]);

  return <div ref={element} className="application-sales-share-chart" role="img" aria-label={title} />;
}
