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
    description: "اختر التقرير حسب السؤال الذي تريد الإجابة عنه.",
    available: "التقارير المتاحة الآن",
    ready: "متاح الآن",
    loading: "يتم التحقق من جاهزية التقارير…",
    retry: "إعادة المحاولة",
    trialQuestion: "هل الدفتر متوازن وما حركة الحسابات؟",
    trialDescription: "يعرض الأرصدة الافتتاحية وحركة الفترة والأرصدة الختامية من القيود المختومة.",
    trialBasis: "دفتر محاسبي",
    openTrial: "فتح ميزان المراجعة",
    financialQuestion: "كم دخل وخرج فعلياً؟",
    financialDescription: "يعرض الداخل والخارج عبر الخزائن والبنوك، ويستبعد التحويلات الداخلية.",
    financialBasis: "حركة مالية فعلية",
    openFinancial: "فتح الربح والخسارة المالي",
    vatQuestion: "ما ضريبة المخرجات والمدخلات وصافي الفترة؟",
    vatDescription: "تحليل داخلي من حسابات الضريبة في القيود المختومة، مع فصل السداد والاسترداد.",
    vatBasis: "تحليل ضريبي داخلي",
    openVat: "فتح التقرير الضريبي",
    unavailable: "غير متاح حالياً",
  },
  en: {
    title: "Reports center",
    description: "Choose the report that answers your question.",
    available: "Available reports",
    ready: "Available now",
    loading: "Checking report availability…",
    retry: "Retry",
    trialQuestion: "Is the ledger balanced, and how did accounts move?",
    trialDescription: "Opening balances, period movement, and closing balances from sealed journal entries.",
    trialBasis: "Accounting ledger",
    openTrial: "Open trial balance",
    financialQuestion: "What actually came in and went out?",
    financialDescription: "Actual inflows and outflows through treasury and banks, excluding internal transfers.",
    financialBasis: "Actual financial movements",
    openFinancial: "Open financial profit and loss",
    vatQuestion: "What were output VAT, input VAT, and the period net?",
    vatDescription: "Internal analysis from VAT control accounts in sealed entries; payments and refunds stay separate.",
    vatBasis: "Internal VAT analysis",
    openVat: "Open VAT report",
    unavailable: "Not available yet",
  },
} as const;

const reportCards: ReadonlyArray<{ code: ReportCode; target: string; icon: string; question: keyof typeof copy.ar; description: keyof typeof copy.ar; basis: keyof typeof copy.ar; action: keyof typeof copy.ar }> = [
  { code: "ledger_trial_balance", target: pageRouteHash("reports-financial", "trial-balance"), icon: "⚖", question: "trialQuestion", description: "trialDescription", basis: "trialBasis", action: "openTrial" },
  { code: "personal_cash_performance", target: pageRouteHash("reports-financial", "cash-performance"), icon: "↕", question: "financialQuestion", description: "financialDescription", basis: "financialBasis", action: "openFinancial" },
  { code: "internal_vat_report", target: pageRouteHash("reports-vat"), icon: "٪", question: "vatQuestion", description: "vatDescription", basis: "vatBasis", action: "openVat" },
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
    <header className="reports-overview__intro"><span className="eyebrow">{text.available}</span><h2>{text.title}</h2><p>{text.description}</p></header>
    {loading ? <p className="reports-overview__notice">{text.loading}</p> : null}
    {message ? <div className="reports-overview__notice is-error"><p>{message}</p><BaseerButton type="button" variant="secondary" onClick={onRetry}>{text.retry}</BaseerButton></div> : null}
    <section className="reports-overview__cards" aria-label={text.available}>
      {reportCards.map((card) => {
        const report = catalogue?.reports.find((item) => item.code === card.code);
        const ready = report?.readiness === "READY";
        const status = ready ? text.ready : report?.readinessMessageAr ?? text.unavailable;
        return <BaseerCard key={card.code} className="reports-overview__card"><header><span className="reports-overview__icon" aria-hidden="true">{card.icon}</span><div><span className={`reports-overview__status${ready ? " is-ready" : ""}`}>{status}</span><h3>{language === "ar" ? report?.titleAr ?? text[card.action] : report?.titleEn ?? text[card.action]}</h3></div></header><p className="reports-overview__question">{text[card.question]}</p><p>{text[card.description]}</p><footer><span>{text[card.basis]}</span><BaseerButton type="button" variant="primary" disabled={!ready} onClick={() => { window.location.hash = card.target; }}>{text[card.action]}</BaseerButton></footer></BaseerCard>;
      })}
    </section>
  </section>;
}
