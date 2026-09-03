import { useEffect, useState } from "react";

import { BaseerCard } from "./baseer-card";
import { BaseerMonthPicker } from "./baseer-form-fields";
import type { BaseerPeriodRange } from "./baseer-period-filter";
import { BaseerStatusBadge, type BaseerStatusTone } from "./baseer-status-badge";
import { api, type ActiveSession } from "./daily-sales-client";
import { formatMonthYear, formatPercent } from "./number-format";

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

function isWeeklyAnalyticsRead(value: unknown): value is WeeklyAnalyticsRead {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { primary?: { weeks?: unknown }; comparison?: { weeks?: unknown } };
  return Array.isArray(candidate.primary?.weeks) && Array.isArray(candidate.comparison?.weeks);
}

function previousMonthValue(month: string) { const [year, value] = month.split("-").map(Number); const date = new Date(Date.UTC(year, value - 2, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
function status(week: Pick<Week, "dataQuality" | "coverage">): { label: string; tone: BaseerStatusTone } {
  const coverage = `${week.coverage.recordedSalesDays}/${week.coverage.requiredOperatingDays}`;
  if (week.dataQuality === "READY") return { label: coverage, tone: "success" };
  if (week.dataQuality === "INCOMPLETE") return { label: coverage, tone: "warning" };
  return { label: coverage, tone: "neutral" };
}
function CompactMonthPicker({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <span className="command-center__weekly-sales-month-picker" dir="ltr"><BaseerMonthPicker aria-label={label} value={value} onChange={(event) => event.target.value && onChange(event.target.value)} /><span aria-hidden="true">{formatMonthYear(value, "en", "short")}</span></span>;
}

/** The server owns every money average, comparison, quality status and coverage. */
export function WeeklySalesAverageCard({ language, session, period }: { language: Language; session: ActiveSession; period: BaseerPeriodRange }) {
  const initialMonth = period.from.slice(0, 7); const [primaryMonth, setPrimaryMonth] = useState(initialMonth); const [comparisonMonth, setComparisonMonth] = useState(previousMonthValue(initialMonth)); const [read, setRead] = useState<WeeklyAnalyticsRead | null>(null);
  useEffect(() => { setPrimaryMonth(initialMonth); setComparisonMonth(previousMonthValue(initialMonth)); }, [initialMonth]);
  useEffect(() => { const controller = new AbortController(); const query = new URLSearchParams({ year: primaryMonth.slice(0, 4), primaryMonth, comparisonMonth }); void api<WeeklyAnalyticsRead>(session, `/finance/daily-sales/analytics?${query.toString()}`, { signal: controller.signal }).then((next) => !controller.signal.aborted && setRead(isWeeklyAnalyticsRead(next) ? next : null)).catch(() => !controller.signal.aborted && setRead(null)); return () => controller.abort(); }, [comparisonMonth, primaryMonth, session]);
  const ar = language === "ar"; const weeks = read?.primary?.weeks ?? [];
  return <BaseerCard className="command-center__weekly-sales" padding="compact" variant="record"><header><h3>{ar ? "متوسط المبيعات اليومية حسب أسبوع الشهر" : "Daily sales average by month week"}</h3></header><div className="command-center__weekly-sales-table"><div className="is-head"><span>{ar ? "الفترة" : "Period"}</span><CompactMonthPicker label={ar ? "الفترة الأولى" : "Primary period"} value={primaryMonth} onChange={setPrimaryMonth} /><CompactMonthPicker label={ar ? "فترة المقارنة" : "Comparison period"} value={comparisonMonth} onChange={setComparisonMonth} /><span>{ar ? "التغير" : "Change"}</span><span>{ar ? "الحالة" : "Status"}</span></div>{weeks.map((week, index) => { const comparison = read?.comparison?.weeks[index]; const change = week.changeFromComparison; const weekStatus = status(week); return <div key={week.fromBusinessDate}><strong>{ar ? `أسبوع ${index + 1} (${Number(week.fromBusinessDate.slice(8))}–${Number(week.toBusinessDate.slice(8))})` : `Week ${index + 1} (${Number(week.fromBusinessDate.slice(8))}–${Number(week.toBusinessDate.slice(8))})`}</strong><bdi dir="ltr">{week.display.dailyAverageSalesAmount ?? "—"}</bdi><bdi dir="ltr">{comparison?.display.dailyAverageSalesAmount ?? "—"}</bdi><bdi className={change.dailyAverageSalesDirection === "POSITIVE" ? "is-positive" : change.dailyAverageSalesDirection === "NEGATIVE" ? "is-negative" : ""} dir="ltr">{formatPercent(change.dailyAverageSalesPercent, language)}</bdi><BaseerStatusBadge tone={weekStatus.tone}>{weekStatus.label}</BaseerStatusBadge></div>; })}</div></BaseerCard>;
}
