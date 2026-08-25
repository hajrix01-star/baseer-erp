import { lazy, Suspense, useEffect, useMemo, useState } from "react";

import { AnalysisReadinessCard, type AnalysisReadiness } from "./analysis-readiness-card";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerEmptyState } from "./baseer-workspace";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, type ActiveSession } from "./daily-sales-client";
import { marketingIsArabic, type MarketingCopy, type MarketingLanguage, type MarketingWorkspaceRead } from "./marketing-shared";

const MarketingOverviewSpendRuntime = lazy(async () => ({ default: (await import("./marketing-overview-spend-runtime")).MarketingOverviewSpendRuntime }));

export function MarketingOverviewRoute({ language, permissionCodes }: { language: MarketingLanguage; permissionCodes: readonly string[] | null }) {
  const ar = marketingIsArabic(language);
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const canRead = permissionCodes?.includes("marketing.insights.read") ?? false;
  const scope = useMemo(() => [language, "0", [...(permissionCodes ?? [])].sort().join(",")], [language, permissionCodes]);
  const copy: MarketingCopy = ar ? {
    eyebrow: "Marketing & Reputation", refresh: "تحديث", title: "الأداء التسويقي والسمعة", overview: "سجل داخلي للحملات؛ لا يخلط بيانات Google أو الحقيقة المالية.", campaigns: "الحملات المسجلة", active: "نشطة", planned: "مخططة", completed: "مكتملة", quality: "حالة البيانات", dataBoundary: "غير متاح حتى الاتصال المعتمد", sectionHint: "تُعرض حالة الجاهزية بصدق ولا تُحوّل إلى صفر.", reputation: "السمعة وGoogle", notReady: "لا توجد حقائق موفر أو أرقام سمعة في هذه المرحلة.", notConnected: "غير متصل", noWrite: "لا يوجد نشر أو رد تلقائي أو اتصال Google الآن.", publisherUnavailable: "زر «نشر الآن» وطابور المراجعة سيظهران هنا بعد الربط؛ لا يوجد نشر فعلي الآن.", fail: "تعذر إتمام طلب الحملة.",
  } : {
    eyebrow: "Marketing & Reputation", refresh: "Refresh", title: "Marketing performance & reputation", overview: "An internal campaign register. It never mixes Google data with financial truth.", campaigns: "Registered campaigns", active: "Active", planned: "Planned", completed: "Completed", quality: "Data status", dataBoundary: "Unavailable until an approved connection", sectionHint: "Readiness is shown honestly and never converted to zero.", reputation: "Reputation & Google", notReady: "No provider facts or reputation numbers exist at this stage.", notConnected: "Not connected", noWrite: "There is no Google publishing, reply automation, or connection now.", publisherUnavailable: "The review queue and Publish now action will appear here after connection; no live publishing exists now.", fail: "The campaign request could not be completed.",
  };
  useEffect(() => setSession(activeSession()), []);

  if (!session) return <DailySalesSignIn language={language} />;
  if (!canRead) return <section className="baseer-workspace"><BaseerEmptyState title={ar ? "لا تملك صلاحية عرض الأداء التسويقي" : "You cannot view marketing performance"} /></section>;

  return <BaseerCompanyReadQuery session={session} resource="marketing.workspace" scope={scope} load={(current, signal) => api<MarketingWorkspaceRead>(current, "/marketing", { signal })}>{({ data, loading, error, refetch }) => <section className="baseer-workspace marketing-workspace" dir={ar ? "rtl" : "ltr"}>
    <header className="baseer-section-header"><div className="baseer-section-header__copy"><p className="baseer-section-header__eyebrow">{copy.eyebrow}</p><h2>{copy.title}</h2><p>{copy.overview}</p></div><div className="baseer-section-header__actions"><BaseerButton type="button" variant="secondary" disabled={loading} onClick={() => void refetch()}>{copy.refresh}</BaseerButton></div></header>
    {error ? <BaseerCard className="marketing-workspace__message" padding="compact">{copy.fail}</BaseerCard> : null}
    <MarketingOverviewWorkspace data={data} copy={copy} language={language} session={session} />
  </section>}</BaseerCompanyReadQuery>;
}

function MarketingOverviewWorkspace({ data, copy, language, session }: { data: MarketingWorkspaceRead | undefined; copy: MarketingCopy; language: MarketingLanguage; session: ActiveSession }) {
  const campaigns = data?.campaigns ?? [];
  const ar = marketingIsArabic(language);
  const [spendOpen, setSpendOpen] = useState(false);
  const manageSpend = ar ? "فتح قراءة الصرف والنتيجة" : "Open spend and result read";

  return <>
    <div className="baseer-metric-grid">
      <Metric label={copy.campaigns} value={campaigns.length} />
      <Metric label={copy.active} value={campaigns.filter((item) => item.status === "ACTIVE").length} />
      <Metric label={copy.planned} value={campaigns.filter((item) => item.status === "PLANNED").length} />
      <Metric label={copy.completed} value={campaigns.filter((item) => item.status === "COMPLETED").length} />
    </div>
    <BaseerCompanyReadQuery session={session} resource="marketing.basira.analysis-readiness" scope={[]} load={(current, signal) => api<AnalysisReadiness>(current, "/marketing/basira/analysis-readiness", { signal })}>
      {({ data: readiness }) => <AnalysisReadinessCard language={language} readiness={readiness} />}
    </BaseerCompanyReadQuery>
    {spendOpen ? <Suspense fallback={<BaseerCard aria-busy="true">{ar ? "جارٍ تحميل قراءة الصرف…" : "Loading spend read…"}</BaseerCard>}><MarketingOverviewSpendRuntime language={language} session={session} /></Suspense> : <BaseerCard className="marketing-workspace__boundary"><strong>{ar ? "قراءة الصرف والنتيجة" : "Spend and result read"}</strong><p>{ar ? "حمّل التحليل التفصيلي عند الحاجة؛ لا تظهر أرقام تقديرية مكان الحقائق المالية." : "Load detailed analysis when needed; estimated values never replace financial facts."}</p><BaseerButton type="button" variant="secondary" onClick={() => setSpendOpen(true)}>{manageSpend}</BaseerButton></BaseerCard>}
    <BaseerCard className="marketing-workspace__boundary"><strong>{copy.quality}</strong><p>{copy.sectionHint}</p><span>{copy.dataBoundary}</span></BaseerCard>
    <MarketingReputationSummary data={data} copy={copy} ar={ar} />
  </>;
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return <BaseerCard className="baseer-metric"><small>{label}</small><strong>{value}</strong></BaseerCard>;
}

function MarketingReputationSummary({ data, copy, ar }: { data: MarketingWorkspaceRead | undefined; copy: MarketingCopy; ar: boolean }) {
  const summaryCopy = ar ? {
    ads: "Google Ads", business: "Google Business", adsMessage: "Google Ads غير متصل في هذه المرحلة؛ لا تتوفر بيانات الصرف أو التحويلات أو قرارات الإنفاق.", businessMessage: "Google Business غير متصل؛ لا تتوفر مراجعات أو منشورات أو صلاحية نشر.",
  } : {
    ads: "Google Ads", business: "Google Business", adsMessage: "Google Ads is not connected at this stage; no spend, conversions, or spending decisions are available.", businessMessage: "Google Business is not connected; no reviews, posts, or publishing authority are available.",
  };
  return <section className="marketing-reputation"><header><h3>{copy.reputation}</h3><p>{copy.notReady}</p></header><div className="baseer-card-grid">{(data?.readiness ?? []).map((item) => <BaseerCard key={item.provider}><strong>{item.provider === "GOOGLE_ADS" ? summaryCopy.ads : summaryCopy.business}</strong><span className="baseer-status-badge baseer-status-badge--warning"><i className="baseer-status-badge__dot" />{copy.notConnected}</span><p>{ar ? item.messageAr : item.provider === "GOOGLE_ADS" ? summaryCopy.adsMessage : summaryCopy.businessMessage}</p></BaseerCard>)}</div><BaseerCard tone="muted"><strong>{copy.noWrite}</strong><p>{copy.publisherUnavailable}</p></BaseerCard></section>;
}
