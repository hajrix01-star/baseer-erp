import { useEffect, useMemo, useState } from "react";

import { BaseerCard } from "./baseer-card";
import { BaseerMonthPicker } from "./baseer-form-fields";
import type { BaseerPeriodRange } from "./baseer-period-filter";
import { api, type ActiveSession } from "./daily-sales-client";
import { formatNumber, formatPercent } from "./number-format";

type Language = "ar" | "en";
type MarketingDay = Readonly<{ businessDate: string; officialNetSales: string | null; salesDayQuality: "READY" | "PENDING" | "PARTIAL" | "MISSING" }>;

function previousMonthValue(month: string) { const [year, value] = month.split("-").map(Number); const date = new Date(Date.UTC(year, value - 2, 1)); return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`; }
function monthPeriod(month: string) { const [year, value] = month.split("-").map(Number); return { from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(year, value, 0)).getUTCDate()).padStart(2, "0")}` }; }

function weeklySalesAverages(days: readonly MarketingDay[], from: string, to: string) {
  const daily = new Map<string, number>(); for (const day of days) if (day.officialNetSales !== null && day.salesDayQuality === "READY") daily.set(day.businessDate, Number(day.officialNetSales));
  const first = Number(from.slice(8)); const last = Number(to.slice(8)); const groups = Array.from({ length: Math.ceil((last - first + 1) / 7) }, (_, index) => ({ start: first + index * 7, end: Math.min(first + index * 7 + 6, last) }));
  return groups.map((group, index) => { const values = [...daily].filter(([date]) => { const day = Number(date.slice(8)); return day >= group.start && day <= group.end; }).map(([, amount]) => amount); return { label: `أسبوع ${index + 1} · ${group.start}–${group.end}`, average: values.length ? values.reduce((sum, amount) => sum + amount, 0) / values.length : null }; });
}

export function WeeklySalesAverageCard({ language, session, period }: { language: Language; session: ActiveSession; period: BaseerPeriodRange }) {
  const initialMonth = period.from.slice(0, 7); const [primaryMonth, setPrimaryMonth] = useState(initialMonth); const [comparisonMonth, setComparisonMonth] = useState(previousMonthValue(initialMonth)); const [salesDays, setSalesDays] = useState<MarketingDay[]>([]); const [previousSalesDays, setPreviousSalesDays] = useState<MarketingDay[]>([]);
  useEffect(() => { setPrimaryMonth(initialMonth); setComparisonMonth(previousMonthValue(initialMonth)); }, [initialMonth]);
  const primary = useMemo(() => monthPeriod(primaryMonth), [primaryMonth]); const comparison = useMemo(() => monthPeriod(comparisonMonth), [comparisonMonth]);
  useEffect(() => { const controller = new AbortController(); void Promise.all([api<{ days: readonly MarketingDay[] }>(session, `/marketing/calendar?from=${primary.from}&to=${primary.to}`, { signal: controller.signal }), api<{ days: readonly MarketingDay[] }>(session, `/marketing/calendar?from=${comparison.from}&to=${comparison.to}`, { signal: controller.signal })]).then(([current, prior]) => { setSalesDays([...current.days]); setPreviousSalesDays([...prior.days]); }).catch(() => { if (!controller.signal.aborted) { setSalesDays([]); setPreviousSalesDays([]); } }); return () => controller.abort(); }, [comparison.from, comparison.to, primary.from, primary.to, session]);
  const currentWeeks = weeklySalesAverages(salesDays, primary.from, primary.to); const priorWeeks = weeklySalesAverages(previousSalesDays, comparison.from, comparison.to); const ar = language === "ar";
  return <BaseerCard className="command-center__weekly-sales" padding="compact"><header><div><h3>{ar ? "متوسط المبيعات اليومية حسب أسبوع الشهر" : "Daily sales average by month week"}</h3><small>{ar ? "شامل الضريبة" : "VAT inclusive"}</small></div></header><div className="command-center__weekly-sales-filters"><label>{ar ? "الفترة الأولى" : "Primary period"}<BaseerMonthPicker value={primaryMonth} onChange={(event) => event.target.value && setPrimaryMonth(event.target.value)} /></label><label>{ar ? "فترة المقارنة" : "Comparison period"}<BaseerMonthPicker value={comparisonMonth} onChange={(event) => event.target.value && setComparisonMonth(event.target.value)} /></label></div><div className="command-center__weekly-sales-table"><div className="is-head"><span>{ar ? "الفترة" : "Period"}</span><span dir="ltr">{primaryMonth}</span><span dir="ltr">{comparisonMonth}</span><span>{ar ? "التغير" : "Change"}</span></div>{currentWeeks.map((week, index) => { const prior = priorWeeks[index]?.average ?? null; const change = week.average === null || prior === null || prior === 0 ? null : ((week.average - prior) / prior) * 100; return <div key={week.label}><strong>{week.label}</strong><bdi dir="ltr">{formatNumber(week.average)}</bdi><bdi dir="ltr">{formatNumber(prior)}</bdi><bdi className={change === null ? "" : change >= 0 ? "is-positive" : "is-negative"} dir="ltr">{change === null ? "—" : `${change >= 0 ? "+" : ""}${formatPercent(change, 1)}`}</bdi></div>; })}</div></BaseerCard>;
}
