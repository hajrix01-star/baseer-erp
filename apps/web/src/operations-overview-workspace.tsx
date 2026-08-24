import { lazy, Suspense } from "react";

import { presentBaseerLoadError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerEmptyState, BaseerNotice, BaseerSectionHeader, BaseerWorkspace } from "./baseer-workspace";
import { activeSession, api } from "./daily-sales-client";
import "./operations-overview-workspace.css";

type Language = "ar" | "en";
type Overview = Readonly<{
  companyId: string;
  businessDate: string;
  period: { fromBusinessDate: string; toBusinessDate: string; timezone: "Asia/Riyadh" };
  sales: { grossAmount: string | null; closingCount: number; eligibleDayCount: number; incompleteDayCount: number; dataQuality: "READY" | "INCOMPLETE" | "NO_DATA"; days: readonly { businessDate: string; grossAmount: string | null }[] };
  purchases: { grossAmount: string; documentCount: number; days: readonly { businessDate: string; grossAmount: string; documentCount: number }[] };
}>;

const LazyOperationsMonthChart = lazy(async () => ({ default: (await import("./baseer-chart")).BaseerOperationsMonthChart }));

const copy = {
  ar: {
    eyebrow: "تشغيل الشهر", title: "المبيعات والمشتريات", refresh: "تحديث", loading: "جارٍ تحميل لوحة التشغيل…", retry: "إعادة المحاولة",
    sales: "المبيعات المثبتة", purchases: "فواتير المشتريات المثبتة", salesDetail: "تقفيلات مبيعات", purchasesDetail: "فواتير مشتريات", openSales: "فتح المبيعات", openPurchases: "فتح المشتريات", chart: "حركة المبيعات والمشتريات", noSales: "لا توجد مبيعات مكتملة", incomplete: "أيام مبيعات غير مكتملة", ready: "بيانات المبيعات مكتملة", monthToDate: "من بداية الشهر حتى", source: "تُقرأ المبيعات من تقفيلات اليوم المكتملة، والمشتريات من الفواتير المثبتة.",
  },
  en: {
    eyebrow: "Month-to-date operations", title: "Sales and purchases", refresh: "Refresh", loading: "Loading operations dashboard…", retry: "Try again",
    sales: "Posted sales", purchases: "Posted purchase invoices", salesDetail: "Sales closings", purchasesDetail: "Purchase invoices", openSales: "Open sales", openPurchases: "Open purchases", chart: "Sales and purchase movement", noSales: "No complete sales data", incomplete: "Incomplete sales days", ready: "Sales data is complete", monthToDate: "From month start through", source: "Sales come from complete daily closings; purchases come from posted purchase invoices.",
  },
} as const;

export function OperationsOverviewWorkspace({ language }: { language: Language }) {
  const session = activeSession();
  if (!session) return null;
  return <BaseerCompanyReadQuery session={session} resource="operations.overview" load={(current, signal) => api<Overview>(current, "/operations/overview", { signal })}>{({ data, loading, error, refetch }) => <OperationsOverviewContent language={language} data={data} loading={loading} error={error} onRefresh={() => void refetch().catch(() => undefined)} />}</BaseerCompanyReadQuery>;
}

function OperationsOverviewContent({ language, data, loading, error, onRefresh }: { language: Language; data: Overview | undefined; loading: boolean; error: unknown; onRefresh: () => void }) {
  const text = copy[language];
  if (error) return <BaseerWorkspace className="operations-overview"><BaseerSectionHeader eyebrow={text.eyebrow} title={text.title} actions={<BaseerButton type="button" variant="secondary" onClick={onRefresh}>{text.refresh}</BaseerButton>} /><BaseerEmptyState title={presentBaseerLoadError(error, language, { ar: "لوحة التشغيل", en: "the operations dashboard" })} action={<BaseerButton type="button" onClick={onRefresh}>{text.retry}</BaseerButton>} /></BaseerWorkspace>;
  if (loading || !data) return <BaseerWorkspace className="operations-overview"><BaseerSectionHeader eyebrow={text.eyebrow} title={text.title} /><BaseerCard className="operations-overview__loading">{text.loading}</BaseerCard></BaseerWorkspace>;
  const chartDays = data.sales.days.map((salesDay, index) => ({ businessDate: salesDay.businessDate, salesGrossAmount: salesDay.grossAmount, purchaseGrossAmount: data.purchases.days[index]?.grossAmount ?? "0.0000", purchaseDocumentCount: data.purchases.days[index]?.documentCount ?? 0 }));
  const salesHint = data.sales.dataQuality === "NO_DATA" ? text.noSales : data.sales.incompleteDayCount ? `${data.sales.incompleteDayCount} ${text.incomplete}` : text.ready;
  return <BaseerWorkspace className="operations-overview">
    <BaseerSectionHeader eyebrow={text.eyebrow} title={text.title} description={`${text.monthToDate} ${data.period.toBusinessDate}`} actions={<BaseerButton type="button" variant="secondary" onClick={onRefresh}>{text.refresh}</BaseerButton>} />
    <section className="operations-overview__hero" aria-label={text.title}>
      <button type="button" className="operations-overview__metric operations-overview__metric--sales" onClick={() => routeTo(1)}><span>{text.sales}</span><strong dir="ltr">{money(data.sales.grossAmount)}</strong><small>{data.sales.closingCount} {text.salesDetail} · {salesHint}</small><em>{text.openSales} ←</em></button>
      <button type="button" className="operations-overview__metric operations-overview__metric--purchases" onClick={() => routeTo(2)}><span>{text.purchases}</span><strong dir="ltr">{money(data.purchases.grossAmount)}</strong><small>{data.purchases.documentCount} {text.purchasesDetail}</small><em>{text.openPurchases} ←</em></button>
    </section>
    {data.sales.dataQuality !== "READY" ? <BaseerNotice tone="warning" title={text.incomplete}>{data.sales.dataQuality === "NO_DATA" ? text.noSales : `${data.sales.incompleteDayCount} ${text.incomplete}`}</BaseerNotice> : null}
    <Suspense fallback={<BaseerCard className="operations-overview__loading">{text.loading}</BaseerCard>}><LazyOperationsMonthChart language={language} title={text.chart} days={chartDays} asOf={data.businessDate} /></Suspense>
    <p className="operations-overview__source">{text.source}</p>
  </BaseerWorkspace>;
}

function routeTo(section: number) { window.location.hash = `#module=operations&section=${section}`; }
function money(value: string | null) { return value === null ? "—" : Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
