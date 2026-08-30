import { useEffect, useMemo, useState, type ReactNode } from "react";
import { activeSession, api, monthRange } from "./daily-sales-client";
import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerStaticSelect } from "./baseer-static-select";
import { MonthlyApplicationSalesShareChart } from "./monthly-application-sales-share-chart";

type Language = "ar" | "en";
type MonthValue = `${number}-${string}`;
type DataQuality = "READY" | "INCOMPLETE" | "NOT_STARTED";
type AnalyticsChange = Readonly<{ dailyAverageSalesPercent: string | null; dailyAverageSalesDirection: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | null }>;
type AnalyticsPeriod = Readonly<{
  fromBusinessDate: string; toBusinessDate: string; amountBasis: "GROSS_VAT_INCLUSIVE"; vatInclusive: true; dataQuality: DataQuality;
  coverage: { recordedSalesDays: number; requiredOperatingDays: number; scheduledClosedDays: number; missingDays: number; partialDays: number };
  display: { salesGrossAmount: string | null; applicationSalesGrossAmount: string | null; dailyAverageSalesAmount: string | null; recordedCustomerCount: string | null; dailyAverageCustomerCount: string | null; applicationSalesSharePercent: string | null; applicationSalesSharePlotValue: number | null };
}>;
type AnalyticsReceipt = Readonly<{
  annualMonths: ReadonlyArray<AnalyticsPeriod & { month: MonthValue; changeFromPreviousMonth: AnalyticsChange }>;
  primary: { month: MonthValue; weeks: ReadonlyArray<AnalyticsPeriod & { changeFromComparison: AnalyticsChange }> };
  comparison: { month: MonthValue; weeks: ReadonlyArray<AnalyticsPeriod> };
}>;

const monthNamesAr = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const monthNamesEn = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const shortMonthNamesAr = ["ينا", "فبر", "مار", "أبر", "ماي", "يون", "يول", "أغس", "سبت", "أكت", "نوف", "ديس"];
const shortMonthNamesEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function previousMonth(month: MonthValue): MonthValue {
  const [year, value] = month.split("-").map(Number);
  return `${value === 1 ? year - 1 : year}-${String(value === 1 ? 12 : value - 1).padStart(2, "0")}`;
}
function labelForMonth(month: MonthValue, language: Language) {
  const [year, value] = month.split("-").map(Number);
  return `${(language === "ar" ? monthNamesAr : monthNamesEn)[value - 1]} ${year}`;
}
function shortLabelForMonth(month: MonthValue, language: Language) { return (language === "ar" ? shortMonthNamesAr : shortMonthNamesEn)[Number(month.slice(5, 7)) - 1]!; }
function qualityLabel(quality: DataQuality, language: Language) {
  if (language === "ar") return quality === "READY" ? "مكتمل" : quality === "INCOMPLETE" ? "ناقص" : "لم يبدأ";
  return quality === "READY" ? "Complete" : quality === "INCOMPLETE" ? "Incomplete" : "Not started";
}
function coverage(period: AnalyticsPeriod, language: Language) {
  if (period.dataQuality === "NOT_STARTED") return qualityLabel(period.dataQuality, language);
  return `${period.coverage.recordedSalesDays}/${period.coverage.requiredOperatingDays} · ${qualityLabel(period.dataQuality, language)}`;
}

export function SalesAnalyticsWorkspace({ language }: { language: Language }) {
  const currentMonth = monthRange().from.slice(0, 7) as MonthValue;
  const [primaryMonth, setPrimaryMonth] = useState<MonthValue>(currentMonth);
  const [comparisonMonth, setComparisonMonth] = useState<MonthValue>(previousMonth(currentMonth));
  const [year, setYear] = useState(Number(currentMonth.slice(0, 4)));
  const [data, setData] = useState<AnalyticsReceipt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const ar = language === "ar";

  useEffect(() => {
    const session = activeSession();
    if (!session) { setError("SESSION_EXPIRED"); setLoading(false); return; }
    let cancelled = false;
    setLoading(true); setError("");
    const query = new URLSearchParams({ year: String(year), primaryMonth, comparisonMonth });
    void api<AnalyticsReceipt>(session, `/finance/daily-sales/analytics?${query.toString()}`)
      .then((receipt) => !cancelled && setData(receipt))
      .catch((reason) => !cancelled && setError(presentBaseerApiError(reason, language, ar ? "تعذر تحميل تحليلات المبيعات." : "Sales analytics could not be loaded.")))
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [ar, comparisonMonth, language, primaryMonth, year]);

  const weeks = useMemo(() => data?.primary.weeks.map((primary, index) => ({ primary, comparison: data.comparison.weeks[index] ?? null })) ?? [], [data]);
  const monthly = data?.annualMonths ?? [];
  const applicationSales = monthly;
  const months = Array.from({ length: 24 }, (_, index) => {
    const value = new Date(Date.UTC(Number(currentMonth.slice(0, 4)), Number(currentMonth.slice(5, 7)) - 1 - index, 1));
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}` as MonthValue;
  });

  return <section className="sales-analytics" dir={ar ? "rtl" : "ltr"}>
    <p className="sales-analytics__intro">{ar ? "قراءة خادمية للمبيعات المثبتة الشاملة للضريبة. لا يظهر المتوسط أو التغير قبل اكتمال تغطية أيام التشغيل." : "Server-owned, VAT-inclusive sales analysis. Averages and changes appear only after operating-day coverage is complete."}</p>
    <div className="sales-analytics__grid">
      <article className="sales-analytics__card">
        <header><div><span className="sales-analytics__vat">{ar ? "شامل الضريبة" : "VAT inclusive"}</span><h2>{ar ? "متوسط المبيعات اليومية حسب أسبوع الشهر" : "Daily sales average by month week"}</h2></div></header>
        <div className="sales-analytics__filters"><label>{ar ? "الفترة الأولى" : "Primary period"}<BaseerStaticSelect label={ar ? "الفترة الأولى" : "Primary period"} value={primaryMonth} onChange={(event) => setPrimaryMonth(event.target.value as MonthValue)}>{months.map((month) => <option key={month} value={month}>{labelForMonth(month, language)}</option>)}</BaseerStaticSelect></label><label>{ar ? "فترة المقارنة" : "Comparison period"}<BaseerStaticSelect label={ar ? "فترة المقارنة" : "Comparison period"} value={comparisonMonth} onChange={(event) => setComparisonMonth(event.target.value as MonthValue)}>{months.map((month) => <option key={month} value={month}>{labelForMonth(month, language)}</option>)}</BaseerStaticSelect></label></div>
        <AnalyticsTable headers={[ar ? "الفترة" : "Period", labelForMonth(primaryMonth, language), labelForMonth(comparisonMonth, language), ar ? "التغير" : "Change"]}>{weeks.map(({ primary, comparison }, index) => { const change = primary.changeFromComparison; return <tr key={primary.fromBusinessDate}><th scope="row">{ar ? `أسبوع ${index + 1} (${Number(primary.fromBusinessDate.slice(8))}–${Number(primary.toBusinessDate.slice(8))})` : `Week ${index + 1} (${Number(primary.fromBusinessDate.slice(8))}–${Number(primary.toBusinessDate.slice(8))})`}</th><td>{primary.display.dailyAverageSalesAmount ?? "—"}<small>{coverage(primary, language)}</small></td><td>{comparison ? comparison.display.dailyAverageSalesAmount ?? "—" : "—"}{comparison ? <small>{coverage(comparison, language)}</small> : null}</td><td className={change.dailyAverageSalesDirection === "POSITIVE" ? "is-positive" : change.dailyAverageSalesDirection === "NEGATIVE" ? "is-negative" : ""}>{change.dailyAverageSalesPercent ?? "—"}</td></tr>; })}</AnalyticsTable>
      </article>
      <article className="sales-analytics__card">
        <header><div><span className="sales-analytics__vat">{ar ? "شامل الضريبة" : "VAT inclusive"}</span><h2>{ar ? `المعدل اليومي الشهري — ${year}` : `Monthly daily average — ${year}`}</h2></div><label>{ar ? "السنة" : "Year"}<BaseerStaticSelect label={ar ? "السنة" : "Year"} value={year} onChange={(event) => setYear(Number(event.target.value))}>{[year, year - 1, year - 2].map((value) => <option key={value} value={value}>{value}</option>)}</BaseerStaticSelect></label></header>
        <AnalyticsTable headers={[ar ? "الشهر" : "Month", ar ? "المبيعات المثبتة" : "Posted sales", ar ? "المعدل اليومي" : "Daily average", ar ? "التغير" : "Change"]}>{monthly.map((item) => { const change = item.changeFromPreviousMonth; return <tr key={item.month}><th scope="row">{labelForMonth(item.month, language)}<small>{coverage(item, language)}</small></th><td>{item.display.salesGrossAmount ?? "—"}</td><td>{item.display.dailyAverageSalesAmount ?? "—"}</td><td className={change.dailyAverageSalesDirection === "POSITIVE" ? "is-positive" : change.dailyAverageSalesDirection === "NEGATIVE" ? "is-negative" : ""}>{change.dailyAverageSalesPercent ?? "—"}</td></tr>; })}</AnalyticsTable>
      </article>
      <article className="sales-analytics__card">
        <header><div><span className="sales-analytics__vat">{ar ? "شامل الضريبة" : "VAT inclusive"}</span><h2>{ar ? `نسبة مبيعات التطبيقات من إجمالي المبيعات — ${year}` : `Application sales share of total sales — ${year}`}</h2></div></header>
        <div className="sales-analytics__application-chart"><MonthlyApplicationSalesShareChart language={language} title={ar ? `نسبة مبيعات التطبيقات من إجمالي المبيعات خلال ${year}` : `Application sales share of total sales in ${year}`} points={applicationSales.map((item) => ({ label: labelForMonth(item.month, language), monthLabel: (language === "ar" ? monthNamesAr : monthNamesEn)[Number(item.month.slice(5, 7)) - 1]!, shortLabel: shortLabelForMonth(item.month, language), sharePlotValue: item.display.applicationSalesSharePlotValue, shareDisplay: item.display.applicationSalesSharePercent, totalSalesDisplay: item.display.salesGrossAmount, applicationSalesDisplay: item.display.applicationSalesGrossAmount }))} /><p>{ar ? "تظهر النسبة فقط للشهور مكتملة التغطية؛ مرّر المؤشر فوق أي شهر لقراءة تفاصيله." : "The share appears only for months with complete coverage; hover over a month for details."}</p></div>
      </article>
    </div>
    {loading ? <p className="sales-analytics__status">{ar ? "جارٍ تحميل البيانات…" : "Loading data…"}</p> : null}{error ? <p className="sales-analytics__status is-error">{error}</p> : null}
  </section>;
}

function AnalyticsTable({ headers, children }: { headers: readonly string[]; children: ReactNode }) {
  return <div className="sales-analytics__table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table></div>;
}
