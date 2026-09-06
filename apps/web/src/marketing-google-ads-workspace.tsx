import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerEmptyState } from "./baseer-workspace";
import { BaseerInfoHint } from "./baseer-info-hint";
import { activeSession, api } from "./daily-sales-client";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { marketingIsArabic, type MarketingLanguage, type MarketingWorkspaceRead } from "./marketing-shared";

const can = (codes: readonly string[] | null, permission: string) => codes?.includes(permission) ?? false;

function sourceStatus(connection: MarketingWorkspaceRead["readiness"][number] | undefined, ar: boolean) {
  if (connection?.status === "AUTHORIZED_READ_ONLY_SELECTED") {
    return {
      badge: "info",
      label: ar ? "متصل للقراءة فقط" : "Connected read-only",
      detail: ar
        ? `${connection.messageAr} لم تُفعّل بعد مزامنة حقائق Ads، لذلك لا تظهر تكلفة أو تحويلات أو قرار إنفاق.`
        : "The connection is read-only. Ads fact synchronization is not enabled yet, so cost, conversions, and spending decisions are unavailable.",
    };
  }
  return {
    badge: "warning",
    label: ar ? "غير متصل" : "Not connected",
    detail: ar
      ? `${connection?.messageAr ?? "لم يُربط Google Ads لهذه الشركة."} لا تتوفر تكلفة أو تحويلات أو قرارات إنفاق.`
      : "Google Ads is not connected for this company. Cost, conversions, and spending decisions are unavailable.",
  };
}

export function MarketingGoogleAdsRoute({ language, permissionCodes }: { language: MarketingLanguage; permissionCodes: readonly string[] | null }) {
  const session = activeSession();
  const ar = marketingIsArabic(language);
  if (!session) return <DailySalesSignIn language={language} />;
  if (!can(permissionCodes, "marketing.insights.read")) return <section className="baseer-workspace"><BaseerEmptyState title={ar ? "لا تملك صلاحية عرض الأداء التسويقي" : "You cannot view marketing performance"} /></section>;

  return <BaseerCompanyReadQuery session={session} resource="marketing.google-ads.status" scope={[language]} load={(current, signal) => api<MarketingWorkspaceRead>(current, "/marketing", { signal })}>{({ data, loading, error, refetch }) => {
    const connection = data?.readiness.find((item) => item.provider === "GOOGLE_ADS");
    const status = sourceStatus(connection, ar);
    return <section className="baseer-workspace marketing-workspace" dir={ar ? "rtl" : "ltr"}>
      <header className="baseer-section-header"><div className="baseer-section-header__copy"><p className="baseer-section-header__eyebrow">Marketing & Reputation</p><h2>Google Ads</h2><p>{ar ? "قراءة واضحة لبيانات الإعلانات عند ربطها. لا ينشئ Baseer حملة أو ميزانية أو كلمة مفتاحية." : "A clear read of advertising data once connected. Baseer never creates a campaign, budget, or keyword."}</p></div><div className="baseer-section-header__actions"><BaseerButton type="button" variant="secondary" disabled={loading} onClick={() => void refetch()}>{ar ? "تحديث" : "Refresh"}</BaseerButton></div></header>
      {error ? <BaseerCard className="marketing-workspace__message" padding="compact">{ar ? "تعذر تحميل حالة Google Ads." : "Google Ads status could not be loaded."}</BaseerCard> : <section className="marketing-reputation">
        <BaseerCard variant="record"><header><div><strong>{ar ? "حالة المصدر" : "Source status"}</strong><p>{ar ? "هذا الموضع يعرض حقائق Ads فقط بعد تفعيل اتصال القراءة والمزامنة الخادمية." : "This area shows Ads facts only after read-only connection and server-side synchronization are enabled."}</p></div><span className={`baseer-status-badge baseer-status-badge--${status.badge}`}><i className="baseer-status-badge__dot" />{status.label}</span></header><p>{status.detail}</p></BaseerCard>
        <BaseerCard tone="muted"><span className="marketing-reputation__label"><strong>{ar ? "كيف تُقرأ الأرقام؟" : "How are numbers read?"}</strong><BaseerInfoHint label={ar ? "شرح تحويلات Google Ads" : "Explain Google Ads conversions"}>{ar ? "التحويل في Google Ads إشارة إعلانية من Google، وليس فاتورة أو مبيعات مثبتة في Baseer. تعرض المبيعات من ERP فقط عندما تكون قراءة المبيعات الرسمية جاهزة." : "A Google Ads conversion is an advertising signal from Google, not an invoice or confirmed Baseer sale. Sales are shown only when the official ERP sales read is ready."}</BaseerInfoHint></span><p>{ar ? "عند التفعيل لاحقاً: يظهر المصدر والفترة ووقت آخر تحديث وجودة التغطية، مع فصل صريح بين تكلفة Ads والمصروف المالي المثبت." : "When enabled later, the page will show source, period, last update, and coverage quality, with an explicit separation between Ads cost and posted financial spend."}</p></BaseerCard>
      </section>}
    </section>;
  }}</BaseerCompanyReadQuery>;
}
