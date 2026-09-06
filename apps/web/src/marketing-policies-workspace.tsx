import { useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerEmptyState } from "./baseer-workspace";
import { activeSession, api } from "./daily-sales-client";
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
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  if (!session) return null;
  const beginGoogleBusinessPilot = async () => {
    if (!canManage || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const authorization = await api<GoogleBusinessPilotAuthorization>(session, "/marketing/provider-connections/google-business/pilot/authorization", { method: "POST" });
      window.location.assign(authorization.authorizationUrl);
    } catch (error) {
      setMessage(presentBaseerApiError(error, language, ar ? "تعذر بدء موافقة Google Business. لم يُنشأ اتصال أو تُحفظ أي بيانات." : "Google Business consent could not start. No connection was created and no data was stored."));
      setBusy(false);
    }
  };
  return <BaseerCompanyReadQuery session={session} resource="marketing.provider-connections" scope={[String(canManage)]} load={(current, signal) => api<ProviderConnectionsRead>(current, "/marketing/provider-connections", { signal })}>{({ data, error, refetch }) => {
    const businessPilotReady = data?.connections.some((connection) => connection.provider === "GOOGLE_BUSINESS" && connection.pilotAuthorizationAvailable) ?? false;
    return <BaseerCard className="marketing-workspace__boundary">
      <header><div><strong>{ar ? "ربط Google Business" : "Connect Google Business"}</strong><p>{ar ? "خطوة واحدة: اضغط الزر ثم وافق في Google. Baseer يحفظ المورد الوحيد فقط للقراءة؛ لا تدخل أي مفتاح ولا تختار حساباً أو موقعاً." : "One action: select the button, then consent in Google. Baseer saves only one unambiguous resource for read-only use; you never enter a secret or choose an account or location."}</p></div><span className={`baseer-status-badge ${businessPilotReady ? "baseer-status-badge--info" : "baseer-status-badge--warning"}`}><i className="baseer-status-badge__dot" />{businessPilotReady ? (ar ? "متاح للشركة الحالية" : "Available for this company") : (ar ? "غير متاح لهذه الشركة بعد" : "Not available for this company yet")}</span></header>
      {error ? <BaseerEmptyState title={ar ? "تعذر قراءة حالة الربط" : "Connection status could not be read"} /> : (() => { const connection = data?.connections.find((item) => item.provider === "GOOGLE_BUSINESS"); if (!connection) return null; const selected = connection.status === "AUTHORIZED_READ_ONLY_SELECTED"; return <BaseerCard tone="muted"><strong>Google Business</strong><p>{ar ? connection.messageAr : connection.messageEn}</p><footer>{selected ? <span className="baseer-status-badge baseer-status-badge--info"><i className="baseer-status-badge__dot" />{ar ? "متصل للقراءة فقط" : "Connected read-only"}</span> : connection.status === "AUTHORIZING" ? <span className="baseer-status-badge baseer-status-badge--info"><i className="baseer-status-badge__dot" />{ar ? "بانتظار إتمام موافقة Google" : "Waiting for Google consent"}</span> : connection.pilotAuthorizationAvailable && canManage ? <BaseerButton type="button" variant="primary" disabled={busy} onClick={() => void beginGoogleBusinessPilot()}>{busy ? (ar ? "جارٍ فتح Google…" : "Opening Google…") : (ar ? "ربط Google Business" : "Connect Google Business")}</BaseerButton> : <small>{canManage ? (ar ? "يُفعّل هذا الزر للشركة بعد قبول بوابة التشغيل؛ لا توجد خطوة يدوية مطلوبة منك." : "This button is enabled for the company after the operating gate is approved; no manual setup is required from you.") : (ar ? "تحتاج صلاحية إدارة ربط Google للشركة." : "You need company Google-connection management permission.")}</small>}</footer></BaseerCard>; })()}
      <small>{ar ? "الربط لا يشغّل مزامنة التقييمات أو النشر أو الرد الآلي. Google Ads له صفحة قراءة مستقلة ولا يملك إجراء ربط في هذه المرحلة." : "Connection does not turn on review synchronization, publishing, or automated replies. Google Ads has its own read page and no connection action at this stage."}</small>
      {message ? <small role="status">{message}</small> : null}
    </BaseerCard>;
  }}</BaseerCompanyReadQuery>;
}
