import { useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerEmptyState } from "./baseer-workspace";
import { activeSession, api, requestId } from "./daily-sales-client";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { marketingIsArabic, type MarketingCopy, type MarketingLanguage } from "./marketing-shared";

type ProviderConnection = { provider: "GOOGLE_ADS" | "GOOGLE_BUSINESS"; status: "NOT_CONNECTED" | "SETUP_REQUESTED" | "AUTHORIZING" | "AUTHORIZED_AWAITING_SELECTION" | "AUTHORIZED_READ_ONLY_SELECTED" | "BLOCKED"; setupRequestedAt: string | null; platformReadiness: "PLATFORM_SETUP_REQUIRED" | "PLATFORM_READY_AWAITING_OAUTH_IMPLEMENTATION"; pilotAuthorizationAvailable: boolean; allowedOperation: "ADS_READ_ONLY" | "BUSINESS_READ_AND_GOVERNED_PUBLISH"; messageAr: string; messageEn: string };
type ProviderConnectionsRead = { connections: ProviderConnection[]; liveOauthEnabled: false };
type GoogleBusinessPilotAuthorization = { authorizationUrl: string; expiresAt: string };
const visible = (codes: readonly string[] | null, capability: string) => codes?.includes(capability) ?? false;

const policyCopy = (language: MarketingLanguage): MarketingCopy => language === "ar" ? {
  sources: "حدود المصدر والسياسة",
  sourcesDetail: "Google Ads قراءة وتحليل فقط لاحقاً. Google Business يمر لاحقاً عبر ناشر يدوي مؤكد، وليس نشرًا آليًا."
} : {
  sources: "Source and policy boundary",
  sourcesDetail: "Google Ads will be read and analysed only. Google Business will later use a manually confirmed publisher, never automation."
};

export function MarketingPoliciesWorkspace({ language, permissionCodes }: { language: MarketingLanguage; permissionCodes: readonly string[] | null }) {
  const session = activeSession();
  const canRead = visible(permissionCodes, "marketing.insights.read");
  const canManageGoogleConnection = visible(permissionCodes, "marketing.google-connection.manage");
  const copy = policyCopy(language);
  if (!session) return <DailySalesSignIn language={language} />;
  if (!canRead) return <section className="baseer-workspace"><BaseerEmptyState title={language === "ar" ? "لا تملك صلاحية عرض سياسات التسويق" : "You cannot view marketing policies"} /></section>;
  return <section className="marketing-reputation">
    <BaseerCard className="marketing-workspace__boundary"><strong>{copy.sources}</strong><p>{copy.sourcesDetail}</p><ul><li>Google Ads: read-only after a separate provider decision.</li><li>Google Business: governed publisher after explicit confirmation and a provider gate.</li><li>Campaign context is not a finance fact and proves no sales impact.</li></ul></BaseerCard>
    <GoogleConnectionCenter language={language} canManage={canManageGoogleConnection} />
  </section>;
}
function GoogleConnectionCenter({ language, canManage }: { language: MarketingLanguage; canManage: boolean }) {
  const ar = marketingIsArabic(language);
  const session = activeSession();
  const [busyProvider, setBusyProvider] = useState<ProviderConnection["provider"] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  if (!session) return null;
  const requestSetup = async (provider: ProviderConnection["provider"], refetch: () => Promise<void>) => {
    if (!canManage || busyProvider) return;
    setBusyProvider(provider);
    setMessage(null);
    try {
      await api(session, `/marketing/provider-connections/${provider}/setup-requests`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ idempotencyKey: requestId() }) });
      setMessage(ar ? "تم تسجيل طلب التهيئة للشركة. لا يبدأ أي اتصال Google قبل اكتمال إعداد المنصة واعتماد الموصل." : "The company setup request was recorded. No Google connection starts before platform setup and provider approval are complete.");
      await refetch();
    } catch (error) {
      setMessage(presentBaseerApiError(error, language, ar ? "تعذر تسجيل طلب التهيئة." : "The setup request could not be recorded."));
    } finally {
      setBusyProvider(null);
    }
  };
  const beginGoogleBusinessPilot = async () => {
    if (!canManage || busyProvider) return;
    setBusyProvider("GOOGLE_BUSINESS");
    setMessage(null);
    try {
      const authorization = await api<GoogleBusinessPilotAuthorization>(session, "/marketing/provider-connections/google-business/pilot/authorization", { method: "POST" });
      window.location.assign(authorization.authorizationUrl);
    } catch (error) {
      setMessage(presentBaseerApiError(error, language, ar ? "تعذر بدء موافقة Google Business. لم يُنشأ اتصال أو تُحفظ أي بيانات." : "Google Business consent could not start. No connection was created and no data was stored."));
      setBusyProvider(null);
    }
  };
  return <BaseerCompanyReadQuery session={session} resource="marketing.provider-connections" scope={[String(canManage)]} load={(current, signal) => api<ProviderConnectionsRead>(current, "/marketing/provider-connections", { signal })}>{({ data, error, refetch }) => {
    const businessPilotReady = data?.connections.some((connection) => connection.provider === "GOOGLE_BUSINESS" && connection.pilotAuthorizationAvailable) ?? false;
    return <BaseerCard className="marketing-workspace__boundary">
      <header><div><strong>{ar ? "اتصالات Google" : "Google connections"}</strong><p>{ar ? "إجراء واحد للمسؤول: الربط ثم موافقة Google. لا يدخل المستخدم أي مفتاح أو يختار فرعاً يدوياً." : "One administrator action: connect, then grant Google consent. Users never enter secrets or manually choose a branch."}</p></div><span className={`baseer-status-badge ${businessPilotReady ? "baseer-status-badge--info" : "baseer-status-badge--warning"}`}><i className="baseer-status-badge__dot" />{businessPilotReady ? (ar ? "تجربة Google Business جاهزة لـ ARZ" : "ARZ Google Business pilot ready") : (ar ? "إعداد المنصة مطلوب" : "Platform setup required")}</span></header>
      <BaseerCard tone="muted"><strong>{ar ? "كيف سيعمل الربط؟" : "How connection will work"}</strong><ol><li>{ar ? "إعداد منصة Google مرة واحدة: المشروع والسياسات والأسرار الخادمية." : "One-time platform setup: project, policies, and server-side secrets."}</li><li>{ar ? "مسؤول ARZ يضغط «ربط Google Business» ويمنح الموافقة في Google." : "The ARZ manager selects Connect Google Business and grants consent in Google."}</li><li>{ar ? "عند العودة يحفظ النظام المورد الوحيد تلقائياً للقراءة فقط. لا تبدأ مزامنة أو نشر أو ردود." : "On return, the system saves the only available resource for read-only preparation. No sync, publishing, or replies start."}</li></ol><small>{businessPilotReady ? (ar ? "عند تعدد الحسابات أو المواقع لا يختار النظام بالتخمين؛ تظهر حالة إدارية واضحة." : "When accounts or locations are multiple, the system does not guess; it shows a clear administrative status.") : (ar ? "إعداد المنصة لم يُعتمد بعد." : "Platform setup has not been approved yet.")}</small></BaseerCard>
      {error ? <BaseerEmptyState title={ar ? "تعذر قراءة حالة الموصلات" : "Provider status could not be read"} /> : <div className="baseer-card-grid">{(data?.connections ?? []).map((connection) => <BaseerCard key={connection.provider} tone="muted"><strong>{connection.provider === "GOOGLE_ADS" ? "Google Ads" : "Google Business"}</strong><p>{ar ? connection.messageAr : connection.messageEn}</p><small>{connection.provider === "GOOGLE_ADS" ? (ar ? "المسموح لاحقاً: قراءة وتحليل فقط؛ لا حملات أو إنفاق أو تعديل." : "Later scope: read and analysis only; no campaigns, spending, or changes.") : (ar ? "المسموح الآن: حفظ ربط قراءة فقط؛ لا مزامنة تقييمات أو ردود أو نشر." : "Current scope: save a read-only connection only; no review sync, replies, or publishing.")}</small><footer>{connection.provider === "GOOGLE_BUSINESS" && connection.status === "AUTHORIZED_READ_ONLY_SELECTED" ? <span className="baseer-status-badge baseer-status-badge--info"><i className="baseer-status-badge__dot" />{ar ? "تم الربط للقراءة فقط" : "Connected for read-only preparation"}</span> : connection.provider === "GOOGLE_BUSINESS" && connection.status === "AUTHORIZED_AWAITING_SELECTION" ? <span className="baseer-status-badge baseer-status-badge--warning"><i className="baseer-status-badge__dot" />{ar ? "لم يُحفظ مورد تلقائياً" : "A resource was not saved automatically"}</span> : connection.provider === "GOOGLE_BUSINESS" && connection.status !== "AUTHORIZING" && connection.pilotAuthorizationAvailable && canManage ? <BaseerButton type="button" variant="primary" disabled={busyProvider !== null} onClick={() => void beginGoogleBusinessPilot()}>{busyProvider === "GOOGLE_BUSINESS" ? (ar ? "جارٍ فتح Google…" : "Opening Google…") : (ar ? "ربط Google Business — تجربة ARZ" : "Connect Google Business — ARZ pilot")}</BaseerButton> : connection.status === "SETUP_REQUESTED" ? <span className="baseer-status-badge baseer-status-badge--info"><i className="baseer-status-badge__dot" />{ar ? "طلب التهيئة مسجل — بانتظار تجهيز المنصة" : "Setup requested — awaiting platform preparation"}</span> : canManage ? <BaseerButton type="button" variant="secondary" disabled={busyProvider !== null} onClick={() => void requestSetup(connection.provider, refetch)}>{ar ? "طلب تهيئة الربط" : "Request connection setup"}</BaseerButton> : <small>{ar ? "تحتاج صلاحية إدارة ربط Google للشركة." : "You need company Google-connection management permission."}</small>}</footer></BaseerCard>)}</div>}
      <small>{ar ? "لا يظهر أي رمز OAuth أو سر في Baseer. الربط لا يفعّل مزامنة التقييمات أو النشر أو الرد الآلي." : "No OAuth token or secret is shown in Baseer. The connection does not enable review synchronization, publishing, or automated replies."}</small>
      {message ? <small role="status">{message}</small> : null}
    </BaseerCard>;
  }}</BaseerCompanyReadQuery>;
}
