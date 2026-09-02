import { useMemo } from "react";

import { useBaseerChartPalette } from "./baseer-chart-theme";
import { formatPercent } from "./number-format";

type Language = "ar" | "en";

export type MonthlyApplicationSalesSharePoint = {
  label: string;
  monthLabel: string;
  shortLabel: string;
  totalSalesPlotValue: number | null;
  applicationSalesPlotValue: number | null;
  otherOfficialSalesPlotValue: number | null;
  sharePlotValue: number | null;
  shareDisplay: string | null;
  totalSalesDisplay: string | null;
  applicationSalesDisplay: string | null;
  otherOfficialSalesDisplay: string | null;
};

const width = 960;
const height = 360;
const edge = { top: 34, right: 52, bottom: 52, left: 52 };

function compactAmount(value: number, language: Language) {
  const ar = language === "ar";
  if (Math.abs(value) >= 1_000_000) return `${Math.round(value / 1_000_000)} ${ar ? "م" : "M"}`;
  if (Math.abs(value) >= 1_000) return `${Math.round(value / 1_000)} ${ar ? "ألف" : "k"}`;
  return String(Math.round(value));
}

/** A bounded SVG view keeps sales analysis independent of the ECharts runtime. */
export function MonthlyApplicationSalesShareChart({ language, title, points }: { language: Language; title: string; points: readonly MonthlyApplicationSalesSharePoint[] }) {
  const ar = language === "ar";
  const palette = useBaseerChartPalette();
  const copy = {
    application: ar ? "مبيعات التطبيقات" : "Application sales",
    other: ar ? "بقية المبيعات الرسمية" : "Other official sales",
    share: ar ? "نسبة التطبيقات" : "Application share",
    total: ar ? "إجمالي المبيعات الرسمية" : "Total official sales",
    incomplete: ar ? "بيانات غير مكتملة" : "Incomplete data",
  };
  const description = useMemo(() => `${title}. ${points.map((point) => `${point.label}: ${copy.total} ${point.totalSalesDisplay ?? copy.incomplete}; ${copy.application} ${point.applicationSalesDisplay ?? "—"}; ${copy.other} ${point.otherOfficialSalesDisplay ?? "—"}; ${copy.share} ${formatPercent(point.shareDisplay, language)}`).join(ar ? "؛ " : "; ")}`, [ar, copy.application, copy.incomplete, copy.other, copy.share, copy.total, language, points, title]);
  const plotWidth = width - edge.left - edge.right;
  const plotHeight = height - edge.top - edge.bottom;
  const maximum = Math.max(1, ...points.map((point) => Math.max(0, point.totalSalesPlotValue ?? 0)));
  const slot = plotWidth / Math.max(points.length, 1);
  const barWidth = Math.min(42, Math.max(10, slot * .56));
  const yForSales = (value: number) => edge.top + plotHeight - (Math.max(0, value) / maximum) * plotHeight;
  const xFor = (index: number) => edge.left + slot * index + slot / 2;
  const sharePath = points.flatMap((point, index) => point.sharePlotValue === null ? [] : [`${index === 0 || points[index - 1]?.sharePlotValue === null ? "M" : "L"}${xFor(index)} ${edge.top + plotHeight - (point.sharePlotValue / 100) * plotHeight}`]).join(" ");

  return <figure className="application-sales-share-chart" aria-label={description}>
    <figcaption className="visually-hidden">{description}</figcaption>
    <div className="application-sales-share-chart__legend" aria-hidden="true"><span><i style={{ background: palette.primary }} />{copy.application}</span><span><i style={{ background: palette.primary, opacity: .24 }} />{copy.other}</span><span><i className="application-sales-share-chart__line" style={{ background: palette.secondary === palette.primary ? palette.info : palette.secondary }} />{copy.share}</span></div>
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={description} preserveAspectRatio="none">
      {[0, .25, .5, .75, 1].map((ratio) => {
        const y = edge.top + plotHeight - ratio * plotHeight;
        return <g key={ratio}><line x1={edge.left} x2={width - edge.right} y1={y} y2={y} stroke={palette.grid} strokeDasharray="4 5" /><text x={edge.left - 8} y={y + 4} textAnchor="end" fill={palette.axis} fontSize="12">{compactAmount(maximum * ratio, language)}</text>{ratio < 1 ? <text x={width - edge.right + 8} y={y + 4} fill={palette.axis} fontSize="12">{Math.round(ratio * 100)}%</text> : null}</g>;
      })}
      {points.map((point, index) => {
        const application = Math.max(0, point.applicationSalesPlotValue ?? 0);
        const other = Math.max(0, point.otherOfficialSalesPlotValue ?? 0);
        const bottom = edge.top + plotHeight;
        const applicationTop = yForSales(application);
        const totalTop = yForSales(application + other);
        const label = `${point.label}: ${copy.total} ${point.totalSalesDisplay ?? copy.incomplete}; ${copy.application} ${point.applicationSalesDisplay ?? "—"}; ${copy.other} ${point.otherOfficialSalesDisplay ?? "—"}; ${copy.share} ${formatPercent(point.shareDisplay, language)}`;
        return <g key={point.label}><title>{label}</title><rect x={xFor(index) - barWidth / 2} y={applicationTop} width={barWidth} height={bottom - applicationTop} rx="3" fill={palette.primary} /><rect x={xFor(index) - barWidth / 2} y={totalTop} width={barWidth} height={applicationTop - totalTop} rx="3" fill={palette.primary} opacity=".24" /><text x={xFor(index)} y={height - 24} textAnchor="middle" fill={palette.axis} fontSize="12" fontWeight="700">{points.length > 8 ? point.shortLabel : point.monthLabel}</text></g>;
      })}
      {sharePath ? <path d={sharePath} fill="none" stroke={palette.secondary === palette.primary ? palette.info : palette.secondary} strokeWidth="3" vectorEffect="non-scaling-stroke" /> : null}
      {points.map((point, index) => point.sharePlotValue === null ? null : <circle key={`${point.label}-share`} cx={xFor(index)} cy={edge.top + plotHeight - (point.sharePlotValue / 100) * plotHeight} r="4" fill={palette.secondary === palette.primary ? palette.info : palette.secondary} stroke={palette.tooltipSurface} strokeWidth="2" vectorEffect="non-scaling-stroke" />)}
    </svg>
  </figure>;
}
