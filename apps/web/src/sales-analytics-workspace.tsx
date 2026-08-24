import { useEffect, useMemo, useState, type ReactNode } from "react";
import { activeSession, api, monthRange, type Closing } from "./daily-sales-client";
import { presentBaseerApiError } from "./baseer-api-error";
import { formatNumber, formatPercent } from "./number-format";

type Language = "ar" | "en";
type ClosingsReceipt = { closings: Closing[]; hasMore: boolean };
type MonthValue = `${number}-${string}`;

const monthNamesAr = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const monthNamesEn = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function previousMonth(month: MonthValue): MonthValue {
  const [year, value] = month.split("-").map(Number);
  return `${value === 1 ? year - 1 : year}-${String(value === 1 ? 12 : value - 1).padStart(2, "0")}`;
}

function rangeForMonth(month: MonthValue) {
  const [year, value] = month.split("-").map(Number);
  return { from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(year, value, 0)).getUTCDate()).padStart(2, "0")}` };
}

function labelForMonth(month: MonthValue, language: Language) {
  const [year, value] = month.split("-").map(Number);
  return `${(language === "ar" ? monthNamesAr : monthNamesEn)[value - 1]} ${year}`;
}

function money(value: number, _language: Language) {
  return formatNumber(value);
}

function percent(current: number | null, comparison: number | null) {
  if (current === null || comparison === null || comparison === 0) return null;
  return ((current - comparison) / comparison) * 100;
}

function monthlyDailyAverages(closings: readonly Closing[], month: MonthValue) {
  const daily = new Map<string, number>();
  closings.filter((closing) => closing.status === "POSTED").forEach((closing) => daily.set(closing.businessDate, (daily.get(closing.businessDate) ?? 0) + Number(closing.grossAmount)));
  const total = [...daily.values()].reduce((sum, value) => sum + value, 0);
  return { month, total, days: daily.size, average: daily.size ? total / daily.size : null };
}

function weeklyDailyAverages(closings: readonly Closing[], month: MonthValue) {
  const daily = new Map<string, number>();
  closings.filter((closing) => closing.status === "POSTED").forEach((closing) => daily.set(closing.businessDate, (daily.get(closing.businessDate) ?? 0) + Number(closing.grossAmount)));
  const weeks = Array.from({ length: Math.ceil(Number(rangeForMonth(month).to.slice(8)) / 7) }, (_, index) => {
    const first = index * 7 + 1;
    const last = Math.min(first + 6, Number(rangeForMonth(month).to.slice(8)));
    const values = [...daily.entries()].filter(([date]) => { const day = Number(date.slice(8)); return day >= first && day <= last; }).map(([, value]) => value);
    return { first, last, average: values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null };
  });
  return weeks;
}

async function loadMonth(month: MonthValue) {
  const session = activeSession();
  if (!session) throw new Error("SESSION_EXPIRED");
  const range = rangeForMonth(month);
  return api<ClosingsReceipt>(session, `/finance/daily-sales/closings?fromBusinessDate=${range.from}&toBusinessDate=${range.to}&pageSize=100`);
}

export function SalesAnalyticsWorkspace({ language }: { language: Language }) {
  const currentMonth = monthRange().from.slice(0, 7) as MonthValue;
  const [primaryMonth, setPrimaryMonth] = useState<MonthValue>(currentMonth);
  const [comparisonMonth, setComparisonMonth] = useState<MonthValue>(previousMonth(currentMonth));
  const [year, setYear] = useState(Number(currentMonth.slice(0, 4)));
  const [primaryClosings, setPrimaryClosings] = useState<Closing[]>([]);
  const [comparisonClosings, setComparisonClosings] = useState<Closing[]>([]);
  const [yearClosings, setYearClosings] = useState<Record<string, Closing[]>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const ar = language === "ar";

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError("");
    void Promise.all([loadMonth(primaryMonth), loadMonth(comparisonMonth), ...Array.from({ length: 12 }, (_, index) => loadMonth(`${year}-${String(index + 1).padStart(2, "0")}` as MonthValue))])
      .then(([primary, comparison, ...annual]) => {
        if (cancelled) return;
        setPrimaryClosings(primary.closings);
        setComparisonClosings(comparison.closings);
        setYearClosings(Object.fromEntries(annual.map((receipt, index) => [`${year}-${String(index + 1).padStart(2, "0")}`, receipt.closings])));
      })
      .catch((reason) => !cancelled && setError(presentBaseerApiError(reason, language, ar ? "تعذر تحميل تحليلات المبيعات." : "Sales analytics could not be loaded.")))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [ar, comparisonMonth, language, primaryMonth, year]);

  const weeks = useMemo(() => {
    const primary = weeklyDailyAverages(primaryClosings, primaryMonth);
    const comparison = weeklyDailyAverages(comparisonClosings, comparisonMonth);
    return primary.map((item, index) => ({ ...item, comparison: comparison[index]?.average ?? null }));
  }, [comparisonClosings, comparisonMonth, primaryClosings, primaryMonth]);
  const monthly = useMemo(() => Array.from({ length: 12 }, (_, index) => monthlyDailyAverages(yearClosings[`${year}-${String(index + 1).padStart(2, "0")}`] ?? [], `${year}-${String(index + 1).padStart(2, "0")}` as MonthValue)), [year, yearClosings]);
  const months = Array.from({ length: 24 }, (_, index) => {
    const value = new Date(Date.UTC(Number(currentMonth.slice(0, 4)), Number(currentMonth.slice(5, 7)) - 1 - index, 1));
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}` as MonthValue;
  });

  return <section className="sales-analytics" dir={ar ? "rtl" : "ltr"}>
    <p className="sales-analytics__intro">{ar ? "قراءة المبيعات اليومية الشاملة للضريبة من تقفيلات المبيعات المثبتة فقط." : "Daily sales analysis, VAT inclusive, based only on posted sales closings."}</p>
    <div className="sales-analytics__grid">
      <article className="sales-analytics__card">
        <header><div><span className="sales-analytics__vat">{ar ? "شامل الضريبة" : "VAT inclusive"}</span><h2>{ar ? "متوسط المبيعات اليومية حسب أسبوع الشهر" : "Daily sales average by month week"}</h2></div></header>
        <div className="sales-analytics__filters"><label>{ar ? "الفترة الأولى" : "Primary period"}<select value={primaryMonth} onChange={(event) => setPrimaryMonth(event.target.value as MonthValue)}>{months.map((month) => <option key={month} value={month}>{labelForMonth(month, language)}</option>)}</select></label><label>{ar ? "فترة المقارنة" : "Comparison period"}<select value={comparisonMonth} onChange={(event) => setComparisonMonth(event.target.value as MonthValue)}>{months.map((month) => <option key={month} value={month}>{labelForMonth(month, language)}</option>)}</select></label></div>
        <AnalyticsTable headers={[ar ? "الفترة" : "Period", labelForMonth(primaryMonth, language), labelForMonth(comparisonMonth, language), ar ? "التغير" : "Change"]}>{weeks.map((week) => { const change = percent(week.average, week.comparison); return <tr key={week.first}><th scope="row">{ar ? `أسبوع ${Math.ceil(week.first / 7)} (${week.first}–${week.last})` : `Week ${Math.ceil(week.first / 7)} (${week.first}–${week.last})`}</th><td>{week.average === null ? "—" : money(week.average, language)}</td><td>{week.comparison === null ? "—" : money(week.comparison, language)}</td><td className={change === null ? "" : change >= 0 ? "is-positive" : "is-negative"}>{change === null ? "—" : `${change >= 0 ? "+" : "-"}${formatPercent(Math.abs(change))}`}</td></tr>; })}</AnalyticsTable>
      </article>
      <article className="sales-analytics__card">
        <header><div><span className="sales-analytics__vat">{ar ? "شامل الضريبة" : "VAT inclusive"}</span><h2>{ar ? `المعدل اليومي الشهري — ${year}` : `Monthly daily average — ${year}`}</h2></div><label>{ar ? "السنة" : "Year"}<select value={year} onChange={(event) => setYear(Number(event.target.value))}>{[year, year - 1, year - 2].map((value) => <option key={value} value={value}>{value}</option>)}</select></label></header>
        <AnalyticsTable headers={[ar ? "الشهر" : "Month", ar ? "المبيعات" : "Sales", ar ? "المعدل اليومي" : "Daily average", ar ? "التغير" : "Change"]}>{monthly.map((item, index) => { const prior = monthly[index - 1]?.average ?? null; const change = percent(item.average, prior); return <tr key={item.month}><th scope="row">{labelForMonth(item.month, language)}</th><td>{money(item.total, language)}</td><td>{item.average === null ? "—" : money(item.average, language)}</td><td className={change === null ? "" : change >= 0 ? "is-positive" : "is-negative"}>{change === null ? "—" : `${change >= 0 ? "+" : "-"}${formatPercent(Math.abs(change))}`}</td></tr>; })}</AnalyticsTable>
      </article>
    </div>
    {loading ? <p className="sales-analytics__status">{ar ? "جارٍ تحميل البيانات…" : "Loading data…"}</p> : null}{error ? <p className="sales-analytics__status is-error">{error}</p> : null}
  </section>;
}

function AnalyticsTable({ headers, children }: { headers: readonly string[]; children: ReactNode }) {
  return <div className="sales-analytics__table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
