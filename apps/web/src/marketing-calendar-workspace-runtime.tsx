import { lazy, Suspense, useState } from "react";

import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerOutputActions } from "./baseer-output-actions";
import { BaseerEmptyState } from "./baseer-workspace";
import { BaseerPeriodFilter, defaultBaseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import { api, type ActiveSession } from "./daily-sales-client";
import { marketingIsArabic, type MarketingCalendarRead, type MarketingLanguage, type MarketingSpendResult } from "./marketing-shared";
import { formatPercent } from "./number-format";

const LazyMarketingTimelineChart = lazy(() => import("./baseer-chart").then((module) => ({ default: module.BaseerMarketingTimelineChart })));

export function MarketingCalendarWorkspaceRuntime({ language, session }: { language: MarketingLanguage; session: ActiveSession }) {
  const ar = marketingIsArabic(language);
  return <section className="baseer-workspace marketing-workspace" dir={ar ? "rtl" : "ltr"}><MarketingCalendarWorkspace language={language} session={session} /></section>;
}

function MarketingCalendarWorkspace({ language, session }: { language: MarketingLanguage; session: ActiveSession }) {
  const [period, setPeriod] = useState<BaseerPeriodRange>(() => defaultBaseerPeriodRange());
  const ar = marketingIsArabic(language);
  const copy = ar ? {
    title: "التقويم التسويقي", description: "خط زمني يومي للمبيعات الرسمية الشاملة للضريبة، الصرف على الحملات، المصروفات، والسياق المنشور. السياق يفسر التزامناً ولا يثبت سبباً.", error: "تعذر تحميل التقويم", officialSales: "المبيعات الرسمية الشاملة للضريبة", postedSpend: "الصرف على الحملات", campaigns: "الحملات في الفترة", salesQuality: "جودة المبيعات", chartLoading: "جارٍ تحميل الرسم التفاعلي…", chartTitle: "الحملات والمبيعات والمصروفات حسب اليوم", boundaryTitle: "حدود القراءة", boundary: "لا يلوّن الرسم اليوم الناقص أو الجزئي كمبيعات صفرية. الصرف على الحملات هو فقط المستندات المالية المثبتة المرتبطة بحملة، أما المصروفات فتستخدم نطاق الحركة المالية المختومة. لا يشمل أي منهما Google Ads قبل ربطه واعتماده.",
  } : {
    title: "Marketing calendar", description: "A daily timeline of VAT-inclusive official sales, campaign spend, all outflows, and published context. Context explains timing; it never proves cause.", error: "Calendar could not be loaded", officialSales: "VAT-inclusive official sales", postedSpend: "Campaign spend", campaigns: "Campaigns in period", salesQuality: "Sales data quality", chartLoading: "Loading the interactive chart…", chartTitle: "Daily campaigns, sales, and spend", boundaryTitle: "Read boundary", boundary: "A missing or partial day is not coloured as zero sales. Campaign spend is only posted Finance documents linked to a campaign; all outflows use the sealed financial-movement scope. Neither includes Google Ads until an approved connection exists.",
  };
  return <BaseerCompanyReadQuery session={session} resource="marketing.calendar" scope={[period.from, period.to, period.preset, period.months.join(",")]} load={(current, signal) => api<MarketingCalendarRead>(current, `/marketing/calendar?from=${period.from}&to=${period.to}`, { signal })}>{({ data, loading, error }) => <section className="marketing-calendar" aria-busy={loading}><BaseerCard><div className="baseer-section-header__actions"><BaseerPeriodFilter language={language} value={period} onChange={setPeriod} presets={["DAY", "MONTH", "QUARTER", "YEAR", "RANGE"]} allowNonContiguousMonths={false} /><BaseerOutputActions session={session} reportCode="marketing.performance-calendar" language={language} filters={{ from: period.from, to: period.to }} printLabel={ar ? "طباعة تقويم الأداء A4" : "Print performance calendar A4"} /></div><strong>{copy.title}</strong><p>{copy.description}</p></BaseerCard>{error ? <BaseerEmptyState title={copy.error} /> : <>{data ? <><div className="baseer-metric-grid"><Metric label={copy.officialSales} value={data.spendResult.officialGrossSalesDisplay ?? "—"} /><Metric label={copy.postedSpend} value={data.linkedActualGrossAmountDisplay} /><Metric label={copy.campaigns} value={data.campaigns.length} /><Metric label={copy.salesQuality} value={data.financialRead.quality} /></div><MarketingSpendResultCard result={data.spendResult} language={language} /><Suspense fallback={<BaseerCard>{copy.chartLoading}</BaseerCard>}><LazyMarketingTimelineChart language={language} title={copy.chartTitle} timeline={data.timeline} campaigns={data.campaigns} context={data.context} asOf={data.period.toBusinessDate} /></Suspense></> : null}</>}<BaseerCard tone="muted"><strong>{copy.boundaryTitle}</strong><p>{copy.boundary}</p></BaseerCard></section>}</BaseerCompanyReadQuery>;
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <BaseerCard className="baseer-metric"><small>{label}</small><strong>{value}</strong></BaseerCard>;
}

function MarketingSpendResultCard({ result, language }: { result: MarketingSpendResult; language: MarketingLanguage }) {
  const ar = marketingIsArabic(language);
  const copy = ar ? {
    title: "قراءة الصرف والنتيجة", planned: "التكلفة المخططة", notSet: "غير محددة", postedSpend: "الصرف على الحملات", officialSales: "المبيعات الرسمية", spendToSales: "الصرف من مبيعات الفترة", spendQuality: "حالة الصرف", spendBoundary: "هذا فقط مصروف مالي مثبت مرتبط بالحملة.", excluded: "مستند مرتبط خارج فترة الحملة لم يدخل النتيجة.", google: "Google Ads: غير متصل؛ لا توجد تكلفة أو تحويلات إعلانية يمكن ربطها حالياً.",
  } : {
    title: "Spend and result read", planned: "Planned cost", notSet: "Not set", postedSpend: "Campaign spend", officialSales: "Official sales", spendToSales: "Spend / period sales", spendQuality: "Spend quality", spendBoundary: "This is only posted Finance spend linked to the campaign.", excluded: "linked document(s) outside the campaign period were excluded.", google: "Google Ads: not connected; no advertising cost or conversions can be linked yet.",
  };
  return <BaseerCard className="marketing-workspace__boundary"><strong>{copy.title}</strong><div className="baseer-metric-grid"><Metric label={copy.planned} value={result.plannedCampaignCostDisplay ?? copy.notSet} /><Metric label={copy.postedSpend} value={result.linkedActualSpendDisplay} /><Metric label={copy.officialSales} value={result.officialGrossSalesDisplay ?? "—"} /><Metric label={copy.spendToSales} value={formatPercent(result.spendToSalesPercent, language)} /></div><p>{ar ? result.conclusionAr : result.conclusionEn}</p><small>{`${copy.spendQuality}: ${result.spendDataQuality}. ${copy.spendBoundary}`}</small>{result.excludedLinkedDocumentCount ? <small>{`${result.excludedLinkedDocumentCount} ${copy.excluded}`}</small> : null}<small>{copy.google}</small></BaseerCard>;
}
