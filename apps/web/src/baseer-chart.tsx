import { BarChart } from "echarts/charts";
import { AriaComponent, GridComponent, TooltipComponent } from "echarts/components";
import { init, use } from "echarts/core";
import { SVGRenderer } from "echarts/renderers";
import { useEffect, useRef } from "react";

use([BarChart, GridComponent, TooltipComponent, AriaComponent, SVGRenderer]);

type Language = "ar" | "en";
type Point = { label: string; value: number };

/** A local, accessible visualisation of server-provided operational totals. */
export function BaseerChart({ language, title, points, asOf }: { language: Language; title: string; points: readonly Point[]; asOf: string }) {
  const element = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!element.current) return;
    const chart = init(element.current, undefined, { renderer: "svg" });
    const description = language === "ar" ? `${title}. ${points.map((point) => `${point.label}: ${point.value}`).join("، ")}` : `${title}. ${points.map((point) => `${point.label}: ${point.value}`).join(", ")}`;
    chart.setOption({ aria: { enabled: true, description }, grid: { left: 24, right: 12, top: 20, bottom: 24, containLabel: true }, tooltip: { trigger: "axis" }, xAxis: { type: "category", data: points.map((point) => point.label), axisLabel: { interval: 0 } }, yAxis: { type: "value", minInterval: 1 }, series: [{ type: "bar", data: points.map((point) => point.value), itemStyle: { color: "#236a8a" }, emphasis: { itemStyle: { color: "#164b62" } } }] });
    const observer = new ResizeObserver(() => chart.resize()); observer.observe(element.current);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [language, points, title]);
  return <section className="baseer-chart" aria-label={title}>
    <header><h3>{title}</h3><small>{language === "ar" ? `حسب ملخص الخادم في ${asOf}` : `Server summary as of ${asOf}`}</small></header>
    <p>{language === "ar" ? points.map((point) => `${point.label}: ${point.value}`).join(" · ") : points.map((point) => `${point.label}: ${point.value}`).join(" · ")}</p>
    <div ref={element} className="baseer-chart__plot" role="img" aria-label={title} />
    <table><caption className="visually-hidden">{title}</caption><thead><tr><th>{language === "ar" ? "المؤشر" : "Metric"}</th><th>{language === "ar" ? "القيمة" : "Value"}</th></tr></thead><tbody>{points.map((point) => <tr key={point.label}><th scope="row">{point.label}</th><td dir="ltr">{point.value}</td></tr>)}</tbody></table>
  </section>;
}
