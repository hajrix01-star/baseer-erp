import { useState } from "react";

import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerEmptyState } from "./baseer-workspace";
import { BaseerPeriodFilter, defaultBaseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import { api, type ActiveSession } from "./daily-sales-client";
import { marketingIsArabic, type MarketingCalendarRead, type MarketingLanguage, type MarketingSpendResult } from "./marketing-shared";

function Metric({ label, value }: { label: string; value: number | string }) {
  return <BaseerCard className="baseer-metric"><small>{label}</small><strong>{value}</strong></BaseerCard>;
}

function MarketingSpendResultCard({ result, language }: { result: MarketingSpendResult; language: MarketingLanguage }) {
  const ar = marketingIsArabic(language);
  const copy = ar
    ? { title: "قراءة الصرف والنتيجة", planned: "التكلفة المخططة", notSet: "غير محددة", postedSpend: "الصرف على الحملات", officialSales: "المبيعات الرسمية الشاملة للضريبة", spendToSales: "الصرف من مبيعات الفترة", spendQuality: "حالة الصرف", spendBoundary: "هذا فقط مصروف مالي مثبت مرتبط بالحملة.", excluded: "مستند مرتبط خارج فترة الحملة لم يدخل النتيجة.", google: "Google Ads: غير متصل؛ لا توجد تكلفة أو تحويلات إعلانية يمكن ربطها حالياً." }
    : { title: "Spend and result read", planned: "Planned cost", notSet: "Not set", postedSpend: "Campaign spend", officialSales: "VAT-inclusive official sales", spendToSales: "Spend / period sales", spendQuality: "Spend quality", spendBoundary: "This is only posted Finance spend linked to the campaign.", excluded: "linked document(s) outside the campaign period were excluded.", google: "Google Ads: not connected; no advertising cost or conversions can be linked yet." };
  return <BaseerCard className="marketing-workspace__boundary"><strong>{copy.title}</strong><div className="baseer-metric-grid"><Metric label={copy.planned} value={result.plannedCampaignCost ? `${result.plannedCampaignCost} ر.س` : copy.notSet} /><Metric label={copy.postedSpend} value={`${result.linkedActualSpend} ر.س`} /><Metric label={copy.officialSales} value={result.officialGrossSales ? `${result.officialGrossSales} ر.س` : "—"} /><Metric label={copy.spendToSales} value={result.spendToSalesPercent ? `${result.spendToSalesPercent}%` : "—"} /></div><p>{ar ? result.conclusionAr : result.conclusionEn}</p><small>{`${copy.spendQuality}: ${result.spendDataQuality}. ${copy.spendBoundary}`}</small>{result.excludedLinkedDocumentCount ? <small>{`${result.excludedLinkedDocumentCount} ${copy.excluded}`}</small> : null}<small>{copy.google}</small></BaseerCard>;
}

export function MarketingOverviewSpendRuntime({ language, session }: { language: MarketingLanguage; session: ActiveSession }) {
  const [period, setPeriod] = useState<BaseerPeriodRange>(() => defaultBaseerPeriodRange());
  const ar = marketingIsArabic(language);
  const copy = ar ? { error: "تعذر تحميل قراءة الصرف" } : { error: "Spend read could not be loaded" };
  return <BaseerCompanyReadQuery session={session} resource="marketing.overview.spend" scope={[period.from, period.to]} load={(current, signal) => api<MarketingCalendarRead>(current, `/marketing/calendar?from=${period.from}&to=${period.to}`, { signal })}>{({ data, loading, error }) => <section className="marketing-calendar" aria-busy={loading}><div className="baseer-section-header__actions"><BaseerPeriodFilter language={language} value={period} onChange={setPeriod} presets={["DAY", "MONTH", "QUARTER", "YEAR", "RANGE"]} allowNonContiguousMonths={false} /></div>{error ? <BaseerEmptyState title={copy.error} /> : data ? <MarketingSpendResultCard result={data.spendResult} language={language} /> : null}</section>}</BaseerCompanyReadQuery>;
}
