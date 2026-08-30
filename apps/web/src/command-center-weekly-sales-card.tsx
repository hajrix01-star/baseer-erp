import { useEffect, useState } from "react";

import { BaseerCard } from "./baseer-card";
import { BaseerMonthPicker } from "./baseer-form-fields";
import type { BaseerPeriodRange } from "./baseer-period-filter";
import { api, type ActiveSession } from "./daily-sales-client";

type Language = "ar" | "en";
type DataQuality = "READY" | "INCOMPLETE" | "NOT_STARTED";
type Week = Readonly<{
  fromBusinessDate: string;
  toBusinessDate: string;
  dataQuality: DataQuality;
  coverage: { recordedSalesDays: number; requiredOperatingDays: number };
  display: { dailyAverageSalesAmount: string | null };
  changeFromComparison: { dailyAverageSalesPercent: string | null; dailyAverageSalesDirection: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | null };
}>;
type WeeklyAnalyticsRead = Readonly<{ primary: { weeks: readonly Week[] }; comparison: { weeks: readonly Omit<Week, "changeFromComparison">[] } }>;

function previousMonthValue(month: string) { const [year, value] = month.split("-").map(Number); const date = new Date(Date.UTC(year, value - 2, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
function quality(week: Pick<Week, "dataQuality" | "coverage">, ar: boolean) { return week.dataQuality === "NOT_STARTED" ? (ar ? "لم يبدأ" : "Not started") : `${week.coverage.recordedSalesDays}/${week.coverage.requiredOperatingDays} · ${week.dataQuality === "READY" ? (ar ? "مكتمل" : "Complete") : (ar ? "ناقص" : "Incomplete")}`; }

/** The server owns every money average, comparison, quality status and coverage. */
export function WeeklySalesAverageCard({ language, session, period }: { language: Language; session: ActiveSession; period: BaseerPeriodRange }) {
  const initialMonth = period.from.slice(0, 7); const [primaryMonth, setPrimaryMonth] = useState(initialMonth); const [comparisonMonth, setComparisonMonth] = useState(previousMonthValue(initialMonth)); const [read, setRead] = useState<WeeklyAnalyticsRead | null>(null);
  useEffect(() => { setPrimaryMonth(initialMonth); setComparisonMonth(previousMonthValue(initialMonth)); }, [initialMonth]);
  useEffect(() => { const controller = new AbortController(); const query = new URLSearchParams({ year: primaryMonth.slice(0, 4), primaryMonth, comparisonMonth }); void api<WeeklyAnalyticsRead>(session, `/finance/daily-sales/analytics?${query.toString()}`, { signal: controller.signal }).then((next) => !controller.signal.aborted && setRead(next)).catch(() => !controller.signal.aborted && setRead(null)); return () => controller.abort(); }, [comparisonMonth, primaryMonth, session]);
  const ar = language === "ar"; const weeks = read?.primary.weeks ?? [];
  return <BaseerCard className="command-center__weekly-sales" padding="compact"><header><div><h3>{ar ? "متوسط المبيعات اليومية حسب أسبوع الشهر" : "Daily sales average by month week"}</h3><small>{ar ? "شامل الضريبة · قراءة خادمية" : "VAT inclusive · server read"}</small></div></header><div className="command-center__weekly-sales-filters"><label>{ar ? "الفترة الأولى" : "Primary period"}<BaseerMonthPicker value={primaryMonth} onChange={(event) => event.target.value && setPrimaryMonth(event.target.value)} /></label><label>{ar ? "فترة المقارنة" : "Comparison period"}<BaseerMonthPicker value={comparisonMonth} onChange={(event) => event.target.value && setComparisonMonth(event.target.value)} /></label></div><div className="command-center__weekly-sales-table"><div className="is-head"><span>{ar ? "الفترة" : "Period"}</span><span dir="ltr">{primaryMonth}</span><span dir="ltr">{comparisonMonth}</span><span>{ar ? "التغير" : "Change"}</span></div>{weeks.map((week, index) => { const comparison = read?.comparison.weeks[index]; const change = week.changeFromComparison; return <div key={week.fromBusinessDate}><strong>{ar ? `أسبوع ${index + 1} (${Number(week.fromBusinessDate.slice(8))}–${Number(week.toBusinessDate.slice(8))})` : `Week ${index + 1} (${Number(week.fromBusinessDate.slice(8))}–${Number(week.toBusinessDate.slice(8))})`}</strong><bdi dir="ltr">{week.display.dailyAverageSalesAmount ?? "—"}<small>{quality(week, ar)}</small></bdi><bdi dir="ltr">{comparison?.display.dailyAverageSalesAmount ?? "—"}{comparison ? <small>{quality(comparison, ar)}</small> : null}</bdi><bdi className={change.dailyAverageSalesDirection === "POSITIVE" ? "is-positive" : change.dailyAverageSalesDirection === "NEGATIVE" ? "is-negative" : ""} dir="ltr">{change.dailyAverageSalesPercent ?? "—"}</bdi></div>; })}</div></BaseerCard>;
}
