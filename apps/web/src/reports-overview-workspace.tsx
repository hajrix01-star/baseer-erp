import { useState } from "react";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, type ActiveSession } from "./daily-sales-client";
import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { pageRouteHash } from "./page-registry";

type Language = "ar" | "en";
type ReportCode = "ledger_trial_balance" | "personal_cash_performance" | "internal_vat_report";
type CatalogueReport = Readonly<{ code: ReportCode; titleAr: string; titleEn: string; basis: string; readiness: "READY" | "NOT_READY"; readinessMessageAr?: string }>;
type Catalogue = Readonly<{ companyId: string; reports: readonly CatalogueReport[] }>;

const copy = {
  ar: {
    title: "مركز التقارير",
    available: "التقارير المتاحة الآن",
    ready: "متاح الآن",
    loading: "يتم التحقق من جاهزية التقارير…",
    retry: "إعادة المحاولة",
    openTrial: "فتح ميزان المراجعة",
    openFinancial: "فتح الربح والخسارة المالي",
    openVat: "فتح التقرير الضريبي",
    unavailable: "غير متاح حالياً",
  },
  en: {
    title: "Reports center",
    available: "Available reports",
    ready: "Available now",
    loading: "Checking report availability…",
    retry: "Retry",
    openTrial: "Open trial balance",
    openFinancial: "Open financial profit and loss",
    openVat: "Open VAT report",
    unavailable: "Not available yet",
  },
} as const;

const reportCards: ReadonlyArray<{ code: ReportCode; target: string; icon: string; action: keyof typeof copy.ar }> = [
  { code: "ledger_trial_balance", target: pageRouteHash("reports-financial", "trial-balance"), icon: "⚖", action: "openTrial" },
  { code: "personal_cash_performance", target: pageRouteHash("reports-financial", "cash-performance"), icon: "↕", action: "openFinancial" },
  { code: "internal_vat_report", target: pageRouteHash("reports-vat"), icon: "٪", action: "openVat" },
];

export function ReportsOverviewWorkspace({ language }: { language: Language }) {
  const text = copy[language];
  const [session] = useState<ActiveSession | null>(activeSession);
  if (!session) return <DailySalesSignIn language={language} />;
  return <BaseerCompanyReadQuery session={session} resource="reports.catalogue" scope={[language]} load={(current, signal) => api<Catalogue>(current, "/reports/catalogue", { signal })}>
    {({ data: catalogue, loading, error, refetch }) => <ReportsOverviewContent language={language} catalogue={catalogue ?? null} loading={loading} message={error ? presentBaseerApiError(error, language, text.title) : ""} onRetry={() => { void refetch().catch(() => undefined); }} />}
  </BaseerCompanyReadQuery>;
}

function ReportsOverviewContent({ language, catalogue, loading, message, onRetry }: { language: Language; catalogue: Catalogue | null; loading: boolean; message: string; onRetry: () => void }) {
  const text = copy[language];
  return <section className="reports-overview" aria-label={text.title} dir={language === "ar" ? "rtl" : "ltr"}>
    <header className="reports-overview__intro"><span className="eyebrow">{text.available}</span><h2>{text.title}</h2></header>
    {loading ? <p className="reports-overview__notice">{text.loading}</p> : null}
    {message ? <div className="reports-overview__notice is-error"><p>{message}</p><BaseerButton type="button" variant="secondary" onClick={onRetry}>{text.retry}</BaseerButton></div> : null}
    <section className="reports-overview__cards" aria-label={text.available}>
      {reportCards.map((card) => {
        const report = catalogue?.reports.find((item) => item.code === card.code);
        const ready = report?.readiness === "READY";
        const status = ready ? text.ready : report?.readinessMessageAr ?? text.unavailable;
        return <BaseerCard variant="record" key={card.code} className="reports-overview__card"><header><span className="reports-overview__icon" aria-hidden="true">{card.icon}</span><div><span className={`reports-overview__status${ready ? " is-ready" : ""}`}>{status}</span><h3>{language === "ar" ? report?.titleAr ?? text[card.action] : report?.titleEn ?? text[card.action]}</h3></div></header><footer><BaseerButton type="button" variant="primary" disabled={!ready} onClick={() => { window.location.hash = card.target; }}>{text[card.action]}</BaseerButton></footer></BaseerCard>;
      })}
    </section>
  </section>;
}
