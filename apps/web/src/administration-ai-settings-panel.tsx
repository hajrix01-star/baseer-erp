import { useCallback, useEffect, useState, type KeyboardEvent } from "react";

import { api, requestId, type ActiveSession } from "./daily-sales-client";
import { BaseerCard } from "./baseer-card";
import { BaseerButton } from "./baseer-button";
import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerValidatedFormField, type BaseerValidatedFormSchemaFactory } from "./baseer-validated-form-field";
import { formatCount, formatDateTime, formatMoney, normalizeBaseerNumericInput } from "./number-format";

type Language = "ar" | "en";
type ProviderKind = "OPENAI_COMPATIBLE" | "ANTHROPIC" | "GOOGLE_GENERATIVE_AI" | "DASHSCOPE_QWEN" | "DEEPSEEK";
type ProviderReceipt = {
  id: string;
  provider: ProviderKind;
  model: string;
  status: "DRAFT" | "VALIDATED" | "ACTIVE" | "DISABLED";
  isDefault: boolean;
  dailyRequestLimit: number;
  dailyCostLimit: string | null;
  configurationVersion: number;
  createdAt: string;
  updatedAt: string;
};
type ProviderCapability = {
  provider: ProviderKind;
  model: string;
  displayNameAr: string;
  displayNameEn: string;
  summaryAr: string;
  summaryEn: string;
  status: "AVAILABLE" | "PLANNED";
  activationReadiness: "READY_FOR_CONFIGURATION" | "REQUIRES_ADAPTER_AND_EVALUATION";
  requiredActivationGates: Array<"PRIVACY_AND_REGION_DECISION" | "SERVER_ADAPTER" | "LOCAL_TOKEN_COUNTER" | "CURRENT_PRICE_REVISION" | "ARABIC_SKILL_EVALUATION" | "LIVE_CONNECTION_PROBE">;
  costTier: "LOW" | "MEDIUM" | "HIGH";
  supportedSkillKeys: string[];
};
type SystemIdentity = { id: string; version: number; status: "ACTIVE" | "ARCHIVED"; assistantNameAr: string; assistantNameEn: string; defaultLanguage: Language; toneInstructions: string; safetyInstructions: string; createdAt: string; updatedAt: string };
type Configuration = { companyId: string; providerCapabilities: ProviderCapability[]; activeProvider: ProviderReceipt | null; providerConfigurations: ProviderReceipt[]; latestProviderConnectionCheck: ProviderConnection | null; activeSystemIdentity: SystemIdentity | null; activeIdentity: unknown | null };
type ProviderConnection = {
  configurationId: string | null;
  state: "READY" | "ERROR" | "UNCONFIGURED";
  reason: "PROVIDER_NOT_CONFIGURED" | "CREDENTIAL_DECRYPTION_FAILED" | "CREDENTIAL_REJECTED" | "MODEL_UNAVAILABLE" | "PROJECT_ACCESS_DENIED" | "BILLING_OR_QUOTA_REQUIRED" | "PROVIDER_RATE_LIMITED" | "PROVIDER_UNREACHABLE" | "PROVIDER_RESPONSE_REJECTED" | "PROVIDER_UNAVAILABLE" | null;
  provider: ProviderKind | null;
  model: string | null;
  upstreamStatus: number | null;
  checkedAt: string;
};
type FormValues = { apiKey: string; model: string; dailyRequestLimit: string; dailyCostLimit: string };
type ActivationBudget = { dailyRequestLimit: string; dailyCostLimit: string };
type VisibleProviderConfigurations = { items: ProviderReceipt[]; hiddenRevisionCount: number };
type BasiraTab = "overview" | "skills" | "context" | "records" | "settings";
type BasiraSettingsPanel = "connection" | "identity";
type IdentityValues = { assistantNameAr: string; assistantNameEn: string; defaultLanguage: Language; toneInstructions: string; safetyInstructions: string };

type OfflineEvaluation = { id: string; skillKey: string; skillVersion: number; policyVersion: number; suiteKey: string; suiteVersion: number; suiteChecksum: string; mode: "OFFLINE"; status: "PASSED" | "FAILED" | "BLOCKED"; totalCaseCount: number; passedCaseCount: number; failedCaseCount: number; createdAt: string };
type Governance = {
  companyId: string;
  catalogue: Array<{ key: string; version: number; policyVersion: number; nameAr: string; nameEn: string; riskTier: "S1" | "S2" | "S3" | "S4"; status: "PLANNED" | "VALIDATED" | "PILOT" | "ACTIVE" | "SUSPENDED"; purpose: string; activationCondition: string; requiredCapabilities: string[]; nonNegotiableRules: string[]; runtime: { state: "READY" | "SERVER_GATED" | "NOT_IMPLEMENTED"; nextRequirement: string }; latestOfflineEvaluation: OfflineEvaluation | null }>;
  companyContexts: Array<{ id: string; version: number; status: "DRAFT" | "APPROVED" | "SUPERSEDED" | "REVOKED"; kind: "TERMINOLOGY" | "BUSINESS_SCOPE" | "POLICY_REFERENCE"; moduleScope: string; presentationStyle: "CONCISE" | "DETAILED"; approvedTermsJson: unknown; policyReferencesJson: unknown; sourceReference: string | null; expiresAt: string | null; revocationReason: string | null; approvedAt: string | null; createdAt: string }>;
  activations: Array<{ id: string; skillKey: string; skillVersion: number; policyVersion: number; status: "PILOT" | "ACTIVE" | "SUSPENDED"; validFrom: string; validUntil: string | null; dailyRequestLimit: number | null; dailyCostLimit: string | null; approvedAt: string; suspendedAt: string | null; suspensionReason: string | null; createdAt: string; updatedAt: string }>;
  receipts: Array<{ id: string; moduleKey: string; skillKey: string | null; skillVersion: number | null; policyVersion: number | null; outcome: "SUCCEEDED" | "FAILED" | "BLOCKED"; providerSnapshot: string | null; modelSnapshot: string | null; evidenceSnapshotId: string | null; skillActivationId: string | null; safeErrorCode: string | null; createdAt: string }>;
  evaluations: Array<{ id: string; executionReceiptId: string; kind: "USEFUL" | "NOT_USEFUL" | "DATA_INCOMPLETE" | "COMPARISON_UNFAIR" | "CONTEXT_DIFFERENT" | "OTHER"; note: string | null; createdAt: string }>;
  evaluationRuns: OfflineEvaluation[];
  consumption: { dayStartAt: string; currency: "USD"; chargedCostUsd: string; providerCalls: number };
};
type ContextDraft = { kind: "TERMINOLOGY" | "BUSINESS_SCOPE" | "POLICY_REFERENCE"; moduleScope: string; presentationStyle: "CONCISE" | "DETAILED"; termAr: string; definitionAr: string; businessDomain: string; policyCode: string; policyVersion: string; policyTitleAr: string; sourceReference: string };
const initialContextDraft: ContextDraft = { kind: "TERMINOLOGY", moduleScope: "general", presentationStyle: "CONCISE", termAr: "", definitionAr: "", businessDomain: "", policyCode: "", policyVersion: "", policyTitleAr: "", sourceReference: "" };

const initialValues: FormValues = { apiKey: "", model: "gpt-5-mini", dailyRequestLimit: "10", dailyCostLimit: "0.25" };
const initialActivationBudget: ActivationBudget = { dailyRequestLimit: "10", dailyCostLimit: "0.10" };
const initialIdentityValues: IdentityValues = { assistantNameAr: "", assistantNameEn: "", defaultLanguage: "ar", toneInstructions: "", safetyInstructions: "" };

/**
 * Deliberately narrow UI: it stores an OpenAI key once through the existing
 * encrypted server endpoint. The key is never read back into this view.
 */
export function AdministrationAiSettingsPanel({ language, session, owner }: { language: Language; session: ActiveSession; owner: boolean }) {
  const [activeTab, setActiveTab] = useState<BasiraTab>("overview");
  const [settingsPanel, setSettingsPanel] = useState<BasiraSettingsPanel>("connection");
  const ar = language === "ar";
  const tabs: Array<{ id: BasiraTab; ar: string; en: string }> = [
    { id: "overview", ar: "الرئيسية", en: "Home" },
    { id: "skills", ar: "المهارات", en: "Skills" },
    { id: "context", ar: "معرفة الشركة", en: "Company knowledge" },
    { id: "records", ar: "السجل والجودة", en: "Record & quality" },
    { id: "settings", ar: "إعدادات متقدمة", en: "Advanced settings" },
  ];
  const navigate = (tab: BasiraTab, panel?: BasiraSettingsPanel) => {
    setActiveTab(tab);
    if (panel) setSettingsPanel(panel);
  };
  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const direction = event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "Home" ? -index : event.key === "End" ? tabs.length - index - 1 : 0;
    if (!direction) return;
    event.preventDefault();
    const nextIndex = Math.max(0, Math.min(tabs.length - 1, index + direction));
    navigate(tabs[nextIndex]!.id);
    requestAnimationFrame(() => document.getElementById(`basira-tab-${tabs[nextIndex]!.id}`)?.focus());
  };
  return <div className="basira-workspace administration-section">
    <header className="administration-section-heading basira-workspace__heading">
      <div><p className="eyebrow">Baseer / Basira</p><h3>{ar ? "مركز تشغيل بصيرة" : "Basira control center"}</h3></div>
      <span className="basira-workspace__mark" aria-hidden="true">ب</span>
    </header>
    <nav className="basira-workspace__tabs" role="tablist" aria-label={ar ? "أقسام بصيرة" : "Basira sections"}>{tabs.map((tab, index) => <button key={tab.id} id={`basira-tab-${tab.id}`} type="button" role="tab" aria-selected={activeTab === tab.id} aria-controls={`basira-panel-${tab.id}`} tabIndex={activeTab === tab.id ? 0 : -1} className={activeTab === tab.id ? "is-active" : undefined} onKeyDown={(event) => handleTabKeyDown(event, index)} onClick={() => navigate(tab.id)}>{ar ? tab.ar : tab.en}</button>)}</nav>
    <label className="basira-workspace__mobile-navigation"><span>{ar ? "انتقل إلى قسم" : "Go to section"}</span><select value={activeTab} onChange={(event) => navigate(event.target.value as BasiraTab)}>{tabs.map((tab) => <option key={tab.id} value={tab.id}>{ar ? tab.ar : tab.en}</option>)}</select></label>
    <BaseerCompanyReadQuery session={session} resource="administration.ai.configuration" load={(current, signal) => api<Configuration>(current, "/administration/ai/configuration", { signal })}>
      {({ data, loading, error, refetch }) => <AiSettingsContent language={language} session={session} owner={owner} configuration={data} loading={loading} loadError={error} refetch={refetch} activeTab={activeTab} settingsPanel={settingsPanel} onSettingsPanelChange={setSettingsPanel} onNavigate={navigate} />}
    </BaseerCompanyReadQuery>
    <BasiraGovernancePanel language={language} session={session} activeTab={activeTab} />
  </div>;
}

function AiSettingsContent({ language, session, owner, configuration, loading, loadError, refetch, activeTab, settingsPanel, onSettingsPanelChange, onNavigate }: { language: Language; session: ActiveSession; owner: boolean; configuration: Configuration | undefined; loading: boolean; loadError: unknown; refetch: () => Promise<void>; activeTab: BasiraTab; settingsPanel: BasiraSettingsPanel; onSettingsPanelChange: (panel: BasiraSettingsPanel) => void; onNavigate: (tab: BasiraTab, panel?: BasiraSettingsPanel) => void }) {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ProviderConnection | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const [identityValues, setIdentityValues] = useState<IdentityValues>(initialIdentityValues);
  const ar = language === "ar";
  const provider = configuration?.activeProvider ?? null;
  const systemIdentity = configuration?.activeSystemIdentity ?? null;
  const candidateProvider = configuration?.providerConfigurations.find((item) => item.status === "DRAFT" || item.status === "VALIDATED") ?? provider;
  const visibleProviderConfigurations = summarizeProviderConfigurations(configuration?.providerConfigurations ?? [], provider?.id ?? null);
  const configurableCapabilities = (configuration?.providerCapabilities ?? []).filter((capability) => capability.status === "AVAILABLE" && capability.activationReadiness === "READY_FOR_CONFIGURATION");
  const selectedCapability = configurableCapabilities.find((capability) => capability.model === values.model) ?? configurableCapabilities[0] ?? null;
  const schemaFactory = useCallback<BaseerValidatedFormSchemaFactory>(({ z }) => z.object({
    apiKey: z.string().trim().min(1, ar ? "أدخل مفتاح OpenAI." : "Enter the OpenAI key."),
    model: z.string().trim().min(1, ar ? "اختر ملف تشغيل معتمداً." : "Choose an approved runtime profile.").refine((value) => configurableCapabilities.some((capability) => capability.model === value), ar ? "هذا الملف غير معتمد للتشغيل." : "This profile is not approved for operation."),
    dailyRequestLimit: z.string().regex(/^\d+$/, ar ? "أدخل عدداً صحيحاً." : "Enter a whole number.").refine((value) => Number(value) >= 1 && Number(value) <= 100_000, ar ? "الحد بين 1 و100000." : "The limit must be between 1 and 100000."),
    dailyCostLimit: z.string().regex(/^\d+(?:\.\d{1,4})?$/, ar ? "أدخل مبلغاً بالدولار." : "Enter a USD amount.").refine((value) => Number(value) > 0 && Number(value) <= 100_000, ar ? "أدخل مبلغاً أكبر من صفر." : "Enter an amount above zero."),
  }), [ar, configurableCapabilities]);
  const identitySchemaFactory = useCallback<BaseerValidatedFormSchemaFactory>(({ z }) => z.object({
    assistantNameAr: z.string().trim().min(1, ar ? "أدخل الاسم العربي." : "Enter the Arabic name.").max(80),
    assistantNameEn: z.string().trim().min(1, ar ? "أدخل الاسم الإنجليزي." : "Enter the English name.").max(80),
    defaultLanguage: z.enum(["ar", "en"]),
    toneInstructions: z.string().trim().min(1, ar ? "اكتب أسلوب العرض." : "Describe the presentation style.").max(2_000),
    safetyInstructions: z.string().trim().min(1, ar ? "اكتب ضوابط السلامة." : "Describe the safety rules.").max(4_000),
  }), [ar]);
  useEffect(() => {
    if (!systemIdentity) return;
    setIdentityValues({ assistantNameAr: systemIdentity.assistantNameAr, assistantNameEn: systemIdentity.assistantNameEn, defaultLanguage: systemIdentity.defaultLanguage, toneInstructions: systemIdentity.toneInstructions, safetyInstructions: systemIdentity.safetyInstructions });
  }, [systemIdentity?.id, systemIdentity?.assistantNameAr, systemIdentity?.assistantNameEn, systemIdentity?.defaultLanguage, systemIdentity?.toneInstructions, systemIdentity?.safetyInstructions]);
  const checkConnection = useCallback(async (signal?: AbortSignal) => {
    if (!candidateProvider) { setConnection(null); setConnectionBusy(false); return; }
    setConnectionBusy(true); setConnectionError(null);
    try {
      const result = await api<ProviderConnection>(session, "/administration/ai/provider-connection", { method: "POST", signal });
      if (!signal?.aborted) {
        setConnection(result);
        await refetch();
      }
    } catch (reason) {
      if (!signal?.aborted) setConnectionError(presentBaseerApiError(reason, language, ar ? "تعذر الوصول إلى خادم بصير لفحص الاتصال." : "Baseer could not reach the connection-check service."));
    } finally {
      if (!signal?.aborted) setConnectionBusy(false);
    }
  }, [ar, candidateProvider?.id, candidateProvider?.model, candidateProvider?.provider, language, refetch, session]);
  const submit = async (next: FormValues) => {
    if (!owner) return;
    const capability = configurableCapabilities.find((item) => item.model === next.model);
    if (!capability) {
      setError(ar ? "لا يوجد ملف ذكاء معتمد قابل للتشغيل حالياً." : "No approved AI profile is currently available for configuration.");
      return;
    }
    setBusy(true); setError(null); setMessage(null);
    try {
      const idempotencyKey = requestId();
      await api<ProviderReceipt>(session, "/administration/ai/provider-configurations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ provider: capability.provider, model: capability.model, apiKey: next.apiKey, dailyRequestLimit: Number(next.dailyRequestLimit), dailyCostLimit: next.dailyCostLimit, idempotencyKey }),
      });
      setValues((current) => ({ ...current, apiKey: "" }));
      await refetch();
      setMessage(ar ? "تم حفظ الإعداد مشفراً كمسودة. افحص الاتصال ثم فعّل الملف صراحةً." : "The encrypted configuration was saved as a draft. Verify the connection, then activate it explicitly.");
  } catch (reason) {
      setError(presentBaseerApiError(reason, language, ar ? "تعذر حفظ إعداد بصيرة." : "The Basira configuration could not be saved."));
    } finally { setBusy(false); }
  };
  const submitSystemIdentity = async (next: IdentityValues) => {
    if (!owner) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const idempotencyKey = requestId();
      await api<SystemIdentity>(session, "/administration/ai/system-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ ...next, idempotencyKey }),
      });
      await refetch();
      setMessage(ar ? "تم حفظ إصدار جديد لهوية بصيرة المركزية." : "A new central Basira identity version was saved.");
    } catch (reason) {
      setError(presentBaseerApiError(reason, language, ar ? "تعذر حفظ هوية بصيرة." : "Basira identity could not be saved."));
    } finally { setBusy(false); }
  };
  const activateProfile = async (configurationId: string) => {
    if (!owner || configurationId === provider?.id) return;
    setActivatingId(configurationId); setError(null); setMessage(null);
    try {
      const idempotencyKey = requestId();
      await api<ProviderReceipt>(session, `/administration/ai/provider-configurations/${configurationId}/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ idempotencyKey }),
      });
      await refetch();
      setMessage(ar ? "تم تبديل ملف الذكاء النشط. سيُستخدم في التفسيرات القادمة فقط." : "The active AI profile was switched. It will be used for future explanations only.");
    } catch (reason) {
      setError(presentBaseerApiError(reason, language, ar ? "تعذر تبديل ملف الذكاء." : "The AI profile could not be switched."));
    } finally { setActivatingId(null); }
  };
  if (activeTab !== "overview" && activeTab !== "settings") return null;
  if (loading) return <section className="administration-section"><p className="administration-loading">{ar ? "جارٍ تحميل إعداد بصيرة…" : "Loading Basira settings…"}</p></section>;
  if (loadError && !configuration) return <section id={`basira-panel-${activeTab}`} role="tabpanel" aria-labelledby={`basira-tab-${activeTab}`} className="basira-tab-panel"><BaseerCard tone="muted" className="basira-load-error"><strong>{ar ? "تعذر قراءة إعداد بصيرة" : "Basira settings could not be read"}</strong><p>{presentBaseerApiError(loadError, language, ar ? "أعد المحاولة قبل اتخاذ أي قرار أو حفظ إعداد جديد." : "Retry before making a decision or saving a new configuration.")}</p><BaseerButton type="button" variant="secondary" onClick={() => void refetch()}>{ar ? "إعادة المحاولة" : "Try again"}</BaseerButton></BaseerCard></section>;
  // Provider configuration is owner-only. A missing read-only capability must
  // not prevent the owner from supplying a new key through the write route.
  const persistedConnection = configuration?.latestProviderConnectionCheck ?? null;
  const displayedConnection = connection?.configurationId === candidateProvider?.id ? connection : persistedConnection?.configurationId === candidateProvider?.id ? persistedConnection : null;
  const connectionText = connectionBusy
    ? (ar ? "جارٍ التحقق الفعلي…" : "Checking live connection…")
    : displayedConnection?.state === "READY"
      ? (ar ? "متصل ومتحقق الآن" : "Connected and verified now")
      : displayedConnection?.state === "UNCONFIGURED"
        ? (ar ? "لم يُحفظ مزود بعد" : "No provider is configured")
        : displayedConnection
          ? (ar ? "لم ينجح فحص الاتصال" : "Connection check did not pass")
          : candidateProvider
            ? (ar ? "لم يُفحص هذا الملف يدوياً بعد" : "This profile has not been checked manually yet")
            : (ar ? "لم يُحفظ مزود بعد" : "No provider is configured");
  const connectionReason = displayedConnection?.reason ? connectionReasonText(displayedConnection.reason, language) : null;
  const providerState = provider ? (ar ? "مزود نشط" : "Provider active") : candidateProvider ? (ar ? "مزود بانتظار التحقق" : "Provider pending verification") : (ar ? "لم يُحفظ مزود" : "No provider saved");
  const nextStep = !provider
    ? { text: ar ? "اربط نموذجاً وحدد سقف الإنفاق." : "Connect a model and set a spending cap.", label: ar ? "إعداد الربط والحدود" : "Set connection and limits", tab: "settings" as const, panel: "connection" as const }
    : displayedConnection?.state !== "READY"
      ? { text: ar ? "افحص الاتصال قبل بدء التجربة." : "Check the connection before the pilot.", label: ar ? "فحص الاتصال" : "Check connection", tab: "settings" as const, panel: "connection" as const }
      : !systemIdentity
        ? { text: ar ? "أنشئ شخصية مركزية لبصيرة." : "Create Basira’s central personality.", label: ar ? "إعداد شخصية بصيرة" : "Set Basira personality", tab: "settings" as const, panel: "identity" as const }
        : { text: ar ? "الربط والهوية جاهزان. اختر مهارة للتجربة." : "Connection and identity are ready. Choose a skill to pilot.", label: ar ? "استعراض المهارات" : "Browse skills", tab: "skills" as const };
  if (activeTab === "overview") return <section id="basira-panel-overview" role="tabpanel" aria-labelledby="basira-tab-overview" className="basira-tab-panel" aria-label={ar ? "الرئيسية" : "Basira home"}>
    <BaseerCard className="basira-overview__next"><p className="eyebrow">{ar ? "الخطوة التالية" : "Next step"}</p><strong>{nextStep.text}</strong><span>{ar ? "بصيرة تشرح ولا تنفذ." : "Basira explains; it does not execute."}</span><BaseerButton type="button" variant="secondary" onClick={() => onNavigate(nextStep.tab, nextStep.panel)}>{nextStep.label}</BaseerButton></BaseerCard>
    <div className="basira-overview__grid">
      <BaseerCard className="basira-overview__metric"><small>{ar ? "حالة بصيرة" : "Basira status"}</small><strong>{providerState}</strong><span className={`basira-overview__signal is-${displayedConnection?.state?.toLowerCase() ?? "unchecked"}`}>{connectionText}</span></BaseerCard>
      <BaseerCard className="basira-overview__metric"><small>{ar ? "نموذج الذكاء المستخدم" : "AI model in use"}</small><strong dir="ltr">{provider?.model ?? "—"}</strong><span>{provider ? `${formatCount(provider.dailyRequestLimit, language)} ${ar ? "طلب يومياً" : "requests/day"}` : (ar ? "لا يوجد نموذج نشط" : "No active model")}</span></BaseerCard>
      <BaseerCard className="basira-overview__metric"><small>{ar ? "حد الإنفاق اليومي" : "Daily spending limit"}</small><strong dir="ltr">{provider ? formatUsd(provider.dailyCostLimit, language) : "—"}</strong><span>{ar ? "سقف حازم قبل إرسال الطلب" : "Hard pre-send cap"}</span></BaseerCard>
      <BaseerCard className="basira-overview__metric"><small>{ar ? "هوية بصيرة" : "Basira identity"}</small><strong>{systemIdentity ? (ar ? systemIdentity.assistantNameAr : systemIdentity.assistantNameEn) : (ar ? "غير محفوظة" : "Not saved")}</strong><span>{systemIdentity ? `${ar ? "الإصدار" : "Version"} ${systemIdentity.version}` : (ar ? "أضف الهوية المركزية" : "Add the central identity")}</span></BaseerCard>
    </div>
  </section>;
  const settingsNavigation = <nav className="basira-settings-navigation" aria-label={ar ? "إعدادات بصيرة المتقدمة" : "Basira advanced settings"}><button type="button" className={settingsPanel === "connection" ? "is-active" : undefined} onClick={() => onSettingsPanelChange("connection")}>{ar ? "ربط الذكاء والحدود" : "AI connection & limits"}</button><button type="button" className={settingsPanel === "identity" ? "is-active" : undefined} onClick={() => onSettingsPanelChange("identity")}>{ar ? "شخصية بصيرة" : "Basira personality"}</button></nav>;
  if (settingsPanel === "identity") return <section id="basira-panel-settings" role="tabpanel" aria-labelledby="basira-tab-settings" className="basira-tab-panel basira-identity-panel" aria-label={ar ? "شخصية بصيرة" : "Basira personality"}>{settingsNavigation}
    <header className="basira-tab-panel__heading"><div><p className="eyebrow">{ar ? "شخصية بصيرة" : "Basira personality"}</p><h4>{ar ? "كيف تقدم بصيرة نفسها" : "How Basira presents itself"}</h4><p>{ar ? "هذه هوية مركزية مَرْجِعية لكل الشركات، وتُنشئ نسخة جديدة عند الحفظ. لا تضع فيها بيانات أعمال أو رسائل أو أوامر تنفيذ." : "This is a central reference identity for all companies. Saving creates a new version; never include business data, messages, or execution instructions."}</p></div><span className="basira-scope-badge">{ar ? "ينطبق على كل الشركات" : "Applies to all companies"}</span></header>
    <BaseerCard className="basira-identity-panel__current"><small>{ar ? "الهوية المعتمدة الآن" : "Current approved identity"}</small><strong>{systemIdentity ? (ar ? systemIdentity.assistantNameAr : systemIdentity.assistantNameEn) : (ar ? "لا توجد هوية مركزية محفوظة" : "No central identity is saved")}</strong>{systemIdentity ? <span>{ar ? `الإصدار ${systemIdentity.version} · اللغة الافتراضية ${systemIdentity.defaultLanguage === "ar" ? "العربية" : "English"}` : `Version ${systemIdentity.version} · Default language ${systemIdentity.defaultLanguage}`}</span> : <span>{ar ? "يمكن للمالك إنشاء النسخة الأولى من الأسفل." : "The owner can create the first version below."}</span>}</BaseerCard>
    {owner ? <BaseerCard className="basira-identity-panel__editor"><BaseerValidatedFormField<IdentityValues> id="basira-system-identity" className="administration-form basira-identity-panel__form" values={identityValues} schemaFactory={identitySchemaFactory} onValid={(next) => void submitSystemIdentity(next)} errorSummaryLabel={ar ? "تحقق من حقول هوية بصيرة." : "Check the Basira identity fields."}>{({ errors }) => <>
      <label>{ar ? "اسم بصيرة بالعربية" : "Basira name in Arabic"}<input value={identityValues.assistantNameAr} aria-invalid={Boolean(errors.assistantNameAr)} onChange={(event) => setIdentityValues((current) => ({ ...current, assistantNameAr: event.target.value }))} />{errors.assistantNameAr ? <small role="alert">{errors.assistantNameAr.message}</small> : null}</label>
      <label>{ar ? "اسم بصيرة بالإنجليزية" : "Basira name in English"}<input value={identityValues.assistantNameEn} dir="ltr" aria-invalid={Boolean(errors.assistantNameEn)} onChange={(event) => setIdentityValues((current) => ({ ...current, assistantNameEn: event.target.value }))} />{errors.assistantNameEn ? <small role="alert">{errors.assistantNameEn.message}</small> : null}</label>
      <label>{ar ? "لغة العرض الافتراضية" : "Default presentation language"}<select value={identityValues.defaultLanguage} onChange={(event) => setIdentityValues((current) => ({ ...current, defaultLanguage: event.target.value as Language }))}><option value="ar">العربية</option><option value="en">English</option></select></label>
      <label className="basira-identity-panel__form-full">{ar ? "أسلوب العرض" : "Presentation style"}<textarea value={identityValues.toneInstructions} aria-invalid={Boolean(errors.toneInstructions)} aria-describedby="basira-tone-help" onChange={(event) => setIdentityValues((current) => ({ ...current, toneInstructions: event.target.value }))} placeholder={ar ? "مثال: اشرح بلغة بسيطة، واذكر الدليل والقيود قبل الاقتراح." : "Example: explain simply and state evidence and limitations before a suggestion."} />{errors.toneInstructions ? <small role="alert">{errors.toneInstructions.message}</small> : <small id="basira-tone-help">{ar ? "أسلوب العرض فقط، وليس تعليمات حرة للتصرف أو مصادر معلومات." : "Presentation style only; never free action instructions or data sources."}</small>}</label>
      <label className="basira-identity-panel__form-full">{ar ? "ضوابط السلامة" : "Safety rules"}<textarea value={identityValues.safetyInstructions} aria-invalid={Boolean(errors.safetyInstructions)} aria-describedby="basira-safety-help" onChange={(event) => setIdentityValues((current) => ({ ...current, safetyInstructions: event.target.value }))} placeholder={ar ? "مثال: لا تخمّن، ولا تدّعِ السببية، ولا تنفذ أي إجراء." : "Example: do not guess, claim causation, or execute an action."} />{errors.safetyInstructions ? <small role="alert">{errors.safetyInstructions.message}</small> : <small id="basira-safety-help">{ar ? "تطبّق الحماية الخادمية هذه القواعد ولا تعتمد على النص وحده." : "Server-side safeguards enforce these rules; they do not rely on text alone."}</small>}</label>
      {error ? <p className="daily-sales-message error" role="alert">{error}</p> : null}{message ? <p className="daily-sales-message success" role="status">{message}</p> : null}
      <footer><BaseerButton type="submit" variant="primary" disabled={busy}>{busy ? (ar ? "جارٍ الحفظ…" : "Saving…") : (ar ? "حفظ إصدار هوية بصيرة" : "Save Basira identity version")}</BaseerButton></footer>
    </>}</BaseerValidatedFormField></BaseerCard> : <p className="daily-sales-message error">{ar ? "إنشاء هوية بصيرة المركزية للمالك فقط." : "Only the owner can create a central Basira identity."}</p>}
  </section>;
  return <section id="basira-panel-settings" role="tabpanel" aria-labelledby="basira-tab-settings" className="administration-section administration-ai-settings" aria-label={ar ? "إعدادات بصيرة المتقدمة" : "Basira advanced settings"}>
    {settingsNavigation}
    <header className="administration-section-heading"><div><p className="eyebrow">Baseer / Basira</p><h3>{ar ? "ربط الذكاء والحدود" : "AI connection and limits"}</h3><p>{ar ? "إعداد مركزي ومشفّر: احفظ، افحص الاتصال، ثم فعّل." : "Central and encrypted: save, check the connection, then activate."}</p></div><span className="basira-scope-badge">{ar ? "إعداد مركزي" : "Central setting"}</span></header>
    {loadError ? <p className="daily-sales-message error" role="status">{ar ? "تعذر تحديث قراءة الإعداد. لم يتم تغيير أي إعداد؛ أعد المحاولة قبل الحفظ." : "The settings refresh failed. Nothing was changed; retry before saving."}</p> : null}
    <BaseerCard tone="muted"><dl className="administration-ai-settings__status"><div><dt>{ar ? "الحالة الحالية" : "Current status"}</dt><dd>{provider ? (ar ? "مزود نشط" : "Provider active") : candidateProvider ? (ar ? "مزود بانتظار التحقق" : "Provider pending verification") : (ar ? "لا يوجد مزود محفوظ" : "No provider configured")}</dd></div><div className={`administration-ai-connection is-${connectionBusy ? "checking" : displayedConnection?.state?.toLowerCase() ?? "unchecked"}`}><dt>{ar ? "اتصال بصيرة" : "Basira connection"}</dt><dd><span className="administration-ai-connection__dot" aria-hidden="true" />{connectionText}</dd>{connectionReason ? <small>{connectionReason}</small> : null}{displayedConnection?.upstreamStatus ? <small dir="ltr">HTTP {displayedConnection.upstreamStatus}</small> : null}{displayedConnection?.checkedAt ? <small>{ar ? "آخر فحص يدوي: " : "Last manual check: "}{formatDateTime(displayedConnection.checkedAt, language, "Asia/Riyadh")}</small> : null}{connectionError ? <small role="alert">{connectionError}</small> : null}{owner && candidateProvider ? <button type="button" className="baseer-button baseer-button--quiet" disabled={connectionBusy} onClick={() => void checkConnection()}>{connectionBusy ? (ar ? "جارٍ الفحص…" : "Checking…") : (ar ? "فحص الاتصال الآن" : "Check connection now")}</button> : null}</div>{(provider ?? candidateProvider) ? <><div><dt>{ar ? "الموديل" : "Model"}</dt><dd dir="ltr">{(provider ?? candidateProvider)!.model}</dd></div><div><dt>{ar ? "حد الطلبات اليومي" : "Daily request limit"}</dt><dd><bdi dir="ltr">{formatCount((provider ?? candidateProvider)!.dailyRequestLimit, language)}</bdi></dd></div><div><dt>{ar ? "سقف التكلفة اليومي" : "Daily cost cap"}</dt><dd><bdi dir="ltr">{formatUsd((provider ?? candidateProvider)!.dailyCostLimit, language)}</bdi></dd></div><div><dt>{ar ? "الإصدار" : "Version"}</dt><dd><bdi dir="ltr">{formatCount((provider ?? candidateProvider)!.configurationVersion, language)}</bdi></dd></div></> : null}</dl></BaseerCard>
    {visibleProviderConfigurations.items.length ? <BaseerCard tone="muted"><section className="administration-ai-profile-switcher" aria-label={ar ? "النماذج الموصولة" : "Connected models"}><header><h4>{ar ? "النماذج الموصولة" : "Connected models"}</h4><p>{ar ? "حالة واحدة لكل نموذج؛ الإصدارات السابقة في السجل." : "One state per model; earlier revisions remain in the record."}</p></header><div className="administration-ai-profile-switcher__list">{visibleProviderConfigurations.items.map((item) => <article key={item.id} className={item.isDefault ? "is-active" : undefined}><div><strong>{providerLabel(item.provider)}</strong><span dir="ltr">{item.model}</span><small>{ar ? `الحالة: ${providerStatusLabel(item.status, language)} · الحد اليومي: ${item.dailyRequestLimit}` : `Status: ${providerStatusLabel(item.status, language)} · Daily limit: ${item.dailyRequestLimit}`}</small></div>{item.isDefault ? <span className="administration-ai-profile-switcher__active">{ar ? "النشط الآن" : "Active now"}</span> : item.status === "VALIDATED" ? <button type="button" className="baseer-button baseer-button--quiet" disabled={!owner || activatingId !== null} onClick={() => void activateProfile(item.id)}>{activatingId === item.id ? (ar ? "جارٍ التفعيل…" : "Activating…") : (ar ? "تفعيل هذا النموذج" : "Activate this model")}</button> : item.status === "DRAFT" ? <span className="administration-ai-profile-switcher__active">{ar ? "افحص الاتصال أولاً" : "Verify connection first"}</span> : <span className="administration-ai-profile-switcher__active">{providerStatusLabel(item.status, language)}</span>}</article>)}</div>{visibleProviderConfigurations.hiddenRevisionCount ? <small>{ar ? `${visibleProviderConfigurations.hiddenRevisionCount} إصدار سابق في السجل.` : `${visibleProviderConfigurations.hiddenRevisionCount} earlier revision${visibleProviderConfigurations.hiddenRevisionCount === 1 ? " is" : "s are"} in the record.`}</small> : null}<small>{ar ? "لا يظهر مسار مستقبلي قبل اجتياز الاعتماد." : "A future path appears only after approval."}</small></section></BaseerCard> : null}
    {configuration?.providerCapabilities.length ? <section className="administration-ai-capabilities" aria-label={ar ? "ملفات التشغيل المعتمدة" : "Approved runtime profiles"}><header className="administration-ai-capabilities__header"><div><h4>{ar ? "ملفات التشغيل المعتمدة" : "Approved runtime profiles"}</h4><p>{ar ? "قائمة مركزية؛ متطلبات التشغيل تظهر عند الحاجة." : "A central list; activation requirements appear when needed."}</p></div></header><div className="administration-ai-capabilities__list">{configuration.providerCapabilities.map((capability) => <BaseerCard key={`${capability.provider}:${capability.model}`} className="administration-ai-capability" padding="compact"><header><div><strong>{ar ? capability.displayNameAr : capability.displayNameEn}</strong><span dir="ltr">{capability.model}</span></div><span className={`administration-ai-capability__availability is-${capability.activationReadiness === "READY_FOR_CONFIGURATION" ? "ready" : "planned"}`}>{capability.activationReadiness === "READY_FOR_CONFIGURATION" ? (ar ? "متاح للإعداد" : "Available") : (ar ? "مسار مستقبلي" : "Future path")}</span></header><p>{ar ? capability.summaryAr : capability.summaryEn}</p><footer><span className="administration-ai-capability__cost">{ar ? `التكلفة: ${providerCostTierLabel(capability.costTier, language)}` : `Cost: ${providerCostTierLabel(capability.costTier, language)}`}</span>{capability.requiredActivationGates.length ? <details><summary>{ar ? "متطلبات الاعتماد" : "Approval requirements"}</summary><ul>{capability.requiredActivationGates.map((gate) => <li key={gate}>{ar ? providerActivationGateLabelAr(gate) : providerActivationGateLabelEn(gate)}</li>)}</ul></details> : null}</footer></BaseerCard>)}</div><p className="administration-ai-capabilities__note">{ar ? "إضافة نموذج تحتاج سجلاً وتقييماً موثقين." : "Adding a model requires a documented registry entry and evaluation."}</p></section> : null}
    {owner ? <BaseerValidatedFormField<FormValues> id="administration-ai-provider" className="administration-ai-settings__form" values={values} schemaFactory={schemaFactory} onValid={(next) => void submit(next)} errorSummaryLabel={ar ? "تحقق من الحقول المطلوبة." : "Check the required fields."}>{({ errors }) => <>
      <label>{ar ? "المزود" : "Provider"}<input value={selectedCapability ? providerLabel(selectedCapability.provider) : (ar ? "لا يوجد مزود معتمد" : "No approved provider")} disabled readOnly /></label>
      <label>{ar ? "مفتاح مزوّد الذكاء" : "AI provider API key"}<input type="password" autoComplete="new-password" value={values.apiKey} aria-invalid={Boolean(errors.apiKey)} aria-describedby={errors.apiKey ? "administration-ai-key-error" : undefined} onChange={(event) => setValues((current) => ({ ...current, apiKey: event.target.value }))} />{errors.apiKey ? <small id="administration-ai-key-error" role="alert">{errors.apiKey.message}</small> : <small>{ar ? "لن يظهر هذا المفتاح بعد الحفظ." : "This key is never displayed after saving."}</small>}</label>
      <label>{ar ? "نموذج الذكاء المستخدم" : "AI model in use"}<select value={selectedCapability?.model ?? ""} disabled={!selectedCapability} aria-invalid={Boolean(errors.model)} onChange={(event) => setValues((current) => ({ ...current, model: event.target.value }))}>{configurableCapabilities.map((capability) => <option key={`${capability.provider}:${capability.model}`} value={capability.model}>{ar ? capability.displayNameAr : capability.displayNameEn}</option>)}</select>{errors.model ? <small role="alert">{errors.model.message}</small> : selectedCapability ? <small>{ar ? selectedCapability.summaryAr : selectedCapability.summaryEn}</small> : <small>{ar ? "لا يوجد نموذج مؤهل؛ لا يمكن الحفظ حتى يكتمل سجل القدرات." : "No eligible model exists; saving is unavailable until the capability registry is complete."}</small>}</label>
      <label>{ar ? "حد التفسيرات اليومي" : "Daily explanation limit"}<input inputMode="numeric" dir="ltr" lang="en" value={values.dailyRequestLimit} aria-invalid={Boolean(errors.dailyRequestLimit)} onChange={(event) => setValues((current) => ({ ...current, dailyRequestLimit: normalizeBaseerNumericInput(event.target.value).replace(".", "") }))} />{errors.dailyRequestLimit ? <small role="alert">{errors.dailyRequestLimit.message}</small> : <small>{ar ? "ابدأ بـ10 للتجربة." : "Start with 10 for the pilot."}</small>}</label>
      <label>{ar ? "حد الإنفاق اليومي بالدولار" : "Daily spending limit (USD)"}<input inputMode="decimal" dir="ltr" lang="en" value={values.dailyCostLimit} aria-invalid={Boolean(errors.dailyCostLimit)} onChange={(event) => setValues((current) => ({ ...current, dailyCostLimit: normalizeBaseerNumericInput(event.target.value) }))} />{errors.dailyCostLimit ? <small role="alert">{errors.dailyCostLimit.message}</small> : <small>{ar ? "سقف حازم: يتوقف الطلب قبل إرساله عند تجاوزه." : "Hard stop: a request is blocked before sending if it would exceed this."}</small>}</label>
      {error ? <p className="daily-sales-message error" role="alert">{error}</p> : null}{message ? <p className="daily-sales-message success" role="status">{message}</p> : null}
      <footer><button className="daily-sales-primary" disabled={busy || !selectedCapability}>{busy ? (ar ? "جارٍ الحفظ…" : "Saving…") : (provider ? (ar ? "تحديث إعداد بصيرة" : "Update Basira configuration") : (ar ? "حفظ إعداد بصيرة" : "Save Basira configuration"))}</button></footer>
    </>}</BaseerValidatedFormField> : <p className="daily-sales-message error">{ar ? "هذه الصفحة للمالك فقط." : "Only the system owner can configure Basira."}</p>}
  </section>;
}

/** One capability-based surface for the tenant owner and company manager.
 * It deliberately manages structured reference data and governed switches,
 * never prompts, secrets, raw model output, or unrestricted chat memory. */
function BasiraGovernancePanel({ language, session, activeTab }: { language: Language; session: ActiveSession; activeTab: BasiraTab }) {
  return <BaseerCompanyReadQuery session={session} resource="administration.ai.governance" load={(current, signal) => api<Governance>(current, "/administration/ai/governance", { signal })}>
    {({ data, loading, error, refetch }) => <BasiraGovernanceContent language={language} session={session} governance={data} loading={loading} loadError={error} refetch={refetch} activeTab={activeTab} />}
  </BaseerCompanyReadQuery>;
}

function BasiraGovernanceContent({ language, session, governance, loading, loadError, refetch, activeTab }: { language: Language; session: ActiveSession; governance: Governance | undefined; loading: boolean; loadError: unknown; refetch: () => Promise<void>; activeTab: BasiraTab }) {
  const ar = language === "ar";
  const [draftOpen, setDraftOpen] = useState(false);
  const [feedbackReceipt, setFeedbackReceipt] = useState<Governance["receipts"][number] | null>(null);
  const [suspendActivation, setSuspendActivation] = useState<Governance["activations"][number] | null>(null);
  const [activationSkill, setActivationSkill] = useState<Governance["catalogue"][number] | null>(null);
  const [draft, setDraft] = useState<ContextDraft>(initialContextDraft);
  const [feedbackKind, setFeedbackKind] = useState<Governance["evaluations"][number]["kind"]>("USEFUL");
  const [feedbackNote, setFeedbackNote] = useState("");
  const [suspensionReason, setSuspensionReason] = useState("");
  const [activationBudget, setActivationBudget] = useState<ActivationBudget>(initialActivationBudget);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);
  const date = (value: string | null) => value ? formatDateTime(value, language, "Asia/Riyadh") : (ar ? "غير محدد" : "Not set");
  const notify = async (successAr: string, successEn: string, work: () => Promise<unknown>) => {
    setBusy(true); setCommandError(null); setMessage(null);
    try { await work(); await refetch(); setMessage(ar ? successAr : successEn); }
    catch (reason) { setCommandError(presentBaseerApiError(reason, language, ar ? "تعذر حفظ حوكمة بصيرة." : "Basira governance could not be saved.")); }
    finally { setBusy(false); }
  };
  const createContext = async () => {
    const terms = draft.termAr.trim() || draft.definitionAr.trim() ? [{ termAr: draft.termAr.trim(), definitionAr: draft.definitionAr.trim() }] : [];
    const policyReferences = draft.policyCode.trim() || draft.policyVersion.trim() || draft.policyTitleAr.trim()
      ? [{ code: draft.policyCode.trim(), version: draft.policyVersion.trim(), titleAr: draft.policyTitleAr.trim() }]
      : [];
    if ((terms.length && (!draft.termAr.trim() || !draft.definitionAr.trim())) || (policyReferences.length && (!draft.policyCode.trim() || !draft.policyVersion.trim() || !draft.policyTitleAr.trim()))) {
      setCommandError(ar ? "أكمل حقول المصطلح أو مرجع السياسة، أو اترك المجموعة فارغة." : "Complete the terminology or policy-reference fields, or leave that group empty.");
      return;
    }
    const idempotencyKey = requestId();
    await notify("تم حفظ السياق كمسودة للمراجعة.", "The context was saved as a review draft.", () => api(session, "/administration/ai/company-contexts", {
      method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ kind: draft.kind, moduleScope: draft.moduleScope.trim(), presentationStyle: draft.presentationStyle, terms, businessDomains: draft.businessDomain.trim() ? [draft.businessDomain.trim()] : [], policyReferences, sourceReference: draft.sourceReference.trim() || undefined, idempotencyKey }),
    }));
    setDraftOpen(false); setDraft(initialContextDraft);
  };
  const approveContext = (contextId: string) => notify("تم اعتماد السياق، وستستخدمه بصيرة كمرجع فقط.", "The context was approved as Basira reference data.", () => {
    const idempotencyKey = requestId();
    return api(session, `/administration/ai/company-contexts/${contextId}/approve`, { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ idempotencyKey }) });
  });
  const revokeContext = (contextId: string) => {
    const reason = ar ? "أُلغي من حوكمة بصيرة" : "Revoked from Basira governance";
    return notify("تم إلغاء السياق مع الاحتفاظ بسجله.", "The context was revoked and its history retained.", () => {
      const idempotencyKey = requestId();
      return api(session, `/administration/ai/company-contexts/${contextId}/revoke`, { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ reason, idempotencyKey }) });
    });
  };
  const activate = (skill: Governance["catalogue"][number], budget: ActivationBudget) => notify("تم تسجيل التفعيل التجريبي للشركة.", "The company pilot activation was recorded.", () => {
    const idempotencyKey = requestId();
    return api(session, "/administration/ai/skill-activations", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion, status: skill.status === "ACTIVE" ? "ACTIVE" : "PILOT", dailyRequestLimit: Number(budget.dailyRequestLimit), dailyCostLimit: budget.dailyCostLimit, idempotencyKey }) });
  });
  const submitActivation = async () => {
    if (!activationSkill) return;
    if (!/^\d+$/.test(activationBudget.dailyRequestLimit) || Number(activationBudget.dailyRequestLimit) < 1 || Number(activationBudget.dailyRequestLimit) > 100_000) {
      setCommandError(ar ? "أدخل حداً صحيحاً للطلبات." : "Enter a valid request limit.");
      return;
    }
    if (!/^\d+(?:\.\d{1,4})?$/.test(activationBudget.dailyCostLimit) || Number(activationBudget.dailyCostLimit) <= 0) {
      setCommandError(ar ? "أدخل سقف تكلفة يومي بالدولار أكبر من صفر." : "Enter a daily USD cost cap above zero.");
      return;
    }
    await activate(activationSkill, activationBudget);
    setActivationSkill(null);
  };
  const submitSuspension = async () => {
    if (!suspendActivation || !suspensionReason.trim()) return;
    const target = suspendActivation;
    await notify("تم إيقاف المهارة فوراً لهذه الشركة.", "The skill was suspended immediately for this company.", () => {
      const idempotencyKey = requestId();
      return api(session, `/administration/ai/skill-activations/${target.id}/suspend`, { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ reason: suspensionReason.trim(), idempotencyKey }) });
    });
    setSuspendActivation(null); setSuspensionReason("");
  };
  const submitFeedback = async () => {
    if (!feedbackReceipt) return;
    const target = feedbackReceipt;
    await notify("تم حفظ التقييم للمراجعة والتحسين المنضبط.", "The evaluation was saved for governed review.", () => {
      const idempotencyKey = requestId();
      return api(session, "/administration/ai/evaluation-feedback", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ executionReceiptId: target.id, kind: feedbackKind, note: feedbackNote.trim() || undefined, idempotencyKey }) });
    });
    setFeedbackReceipt(null); setFeedbackNote("");
  };
  const runOfflineEvaluation = (skill: Governance["catalogue"][number]) => notify(
    "تم فحص ضوابط المهارة العربية دون إرسال أي بيانات أو طلب إلى مزود الذكاء.",
    "The Arabic skill safeguards were checked without sending data or calling an AI provider.",
    () => {
      const idempotencyKey = requestId();
      return api(session, "/administration/ai/skill-evaluations/offline", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ skillKey: skill.key, skillVersion: skill.version, policyVersion: skill.policyVersion, idempotencyKey }),
      });
    },
  );

  if (activeTab !== "overview" && activeTab !== "skills" && activeTab !== "context" && activeTab !== "records") return null;
  if (loading) return <section className="administration-section"><p className="administration-loading">{ar ? "جارٍ تحميل حوكمة بصيرة…" : "Loading Basira governance…"}</p></section>;
  if (!governance) return <section className="administration-section"><BaseerCard tone="muted"><strong>{ar ? "حوكمة بصيرة غير متاحة لهذا الدور" : "Basira governance is unavailable for this role"}</strong><p>{loadError ? presentBaseerApiError(loadError, language, ar ? "تحتاج صلاحيات حوكمة بصيرة للشركة الحالية." : "You need Basira governance permissions for the active company.") : ""}</p></BaseerCard></section>;
  const activeActivations = new Map(governance.activations.filter((item) => item.status !== "SUSPENDED").map((item) => [`${item.skillKey}:${item.skillVersion}:${item.policyVersion}`, item]));
  return <section id={`basira-panel-${activeTab}`} role="tabpanel" aria-labelledby={`basira-tab-${activeTab}`} className="basira-tab-panel basira-governance" data-active-tab={activeTab} aria-label={ar ? "حوكمة بصيرة" : "Basira governance"}>
    {commandError ? <p className="daily-sales-message error" role="alert">{commandError}</p> : null}{message ? <p className="daily-sales-message success" role="status">{message}</p> : null}
    {activeTab === "overview" ? <><div className="baseer-metric-grid"><BaseerCard className="baseer-metric"><small>{ar ? "سياقات معتمدة" : "Approved context"}</small><strong>{governance.companyContexts.filter((item) => item.status === "APPROVED").length}</strong></BaseerCard><BaseerCard className="baseer-metric"><small>{ar ? "مهارات مفعلة" : "Active skills"}</small><strong>{governance.activations.filter((item) => item.status !== "SUSPENDED").length}</strong></BaseerCard><BaseerCard className="baseer-metric"><small>{ar ? "استهلاك اليوم" : "Today's usage"}</small><strong dir="ltr">{formatUsd(governance.consumption.chargedCostUsd, language)}</strong><small>{ar ? `${formatCount(governance.consumption.providerCalls, language)} طلب مزود اليوم` : `${formatCount(governance.consumption.providerCalls, language)} provider calls today`}</small></BaseerCard><BaseerCard className="baseer-metric"><small>{ar ? "تقييمات منظمة" : "Structured evaluations"}</small><strong>{governance.evaluations.length}</strong></BaseerCard></div><BaseerCard className="basira-governance__overview-note"><strong>{ar ? "حوكمة بصيرة" : "Basira governance"}</strong><p>{ar ? "بصيرة تستقبل حزمة أدلة جاهزة فقط. التفعيل لا يضيف صلاحيات ولا ينفذ إجراءً." : "Basira receives a prepared evidence package only. Activation adds neither permissions nor actions."}</p></BaseerCard></> : null}
    <BaseerCard className="basira-governance__card basira-governance__card--context"><section className="basira-governance__section"><header><div><p className="basira-scope-badge">{ar ? "الشركة الحالية" : "Current company"}</p><h4>{ar ? "معرفة الشركة" : "Company knowledge"}</h4><p>{ar ? "مصطلحات ومراجع عمل فقط؛ لا أرقام مالية متغيرة ولا محتوى بريد أو Google ولا تعليمات للنموذج." : "Business terms and references only; no changing financial facts, email/Google content, or model instructions."}</p></div><BaseerButton type="button" onClick={() => { setCommandError(null); setDraftOpen(true); }}>{ar ? "إضافة معلومة" : "Add knowledge"}</BaseerButton></header><div className="basira-governance__list">{governance.companyContexts.length ? governance.companyContexts.map((item) => <article key={item.id}><div><strong>{contextKindLabel(item.kind, language)} · {item.moduleScope}</strong><small>{contextStatusLabel(item.status, language)} · {ar ? `إصدار ${item.version}` : `Version ${item.version}`} · {date(item.createdAt)}</small><p>{contextSummary(item, language)}</p></div><footer>{item.status === "DRAFT" ? <><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => void approveContext(item.id)}>{ar ? "اعتماد" : "Approve"}</BaseerButton><BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => void revokeContext(item.id)}>{ar ? "سحب المسودة" : "Withdraw draft"}</BaseerButton></> : item.status === "APPROVED" ? <BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => void revokeContext(item.id)}>{ar ? "سحب الاعتماد" : "Withdraw approval"}</BaseerButton> : null}</footer></article>) : <p className="decision-muted">{ar ? "لا توجد معرفة معتمدة أو مسودة بعد." : "No approved knowledge or draft yet."}</p>}</div></section></BaseerCard>
    <BaseerCard className="basira-governance__card basira-governance__card--skills"><section className="basira-governance__section"><header><div><p className="basira-scope-badge">{ar ? "الشركة الحالية" : "Current company"}</p><h4>{ar ? "المهارات" : "Skills"}</h4><p>{ar ? "اختر مهارة بحسب فائدتها للشركة. تفاصيل الفحص والبوابات متاحة عند الحاجة ولا تمنح أي صلاحيات جديدة." : "Choose a skill for its company benefit. Check and gate details remain available when needed and never grant new permissions."}</p></div></header><div className="basira-governance__list">{governance.catalogue.map((skill) => {
      const activation = activeActivations.get(`${skill.key}:${skill.version}:${skill.policyVersion}`);
      const candidate = skill.status === "PILOT" || skill.status === "ACTIVE";
      const evaluationPassed = skill.latestOfflineEvaluation?.status === "PASSED";
      const runtimeReady = skill.runtime.state === "READY";
      return <article key={skill.key}><div><strong>{ar ? skill.nameAr : skill.nameEn}</strong><small>{skill.key} · {skill.riskTier} · {catalogueStatusLabel(skill.status, language)}</small><p>{skill.purpose}</p><small>{ar ? "حالة التشغيل: " : "Runtime: "}{runtimeStateLabel(skill.runtime.state, language)}{skill.runtime.nextRequirement ? ` · ${skill.runtime.nextRequirement}` : ""}</small><small>{skill.latestOfflineEvaluation ? `${ar ? "آخر فحص: " : "Latest check: "}${evaluationStatusLabel(skill.latestOfflineEvaluation.status, language)} · ${skill.latestOfflineEvaluation.passedCaseCount}/${skill.latestOfflineEvaluation.totalCaseCount}` : (ar ? "يلزم فحص ضوابط المهارة أولاً." : "Run the safeguard check first.")}</small><small>{ar ? "شرط التفعيل: " : "Activation condition: "}{skill.activationCondition}</small></div><footer>{activation ? <><span className="basira-governance__state">{activationStatusLabel(activation.status, language)} · {formatUsd(activation.dailyCostLimit, language)}</span><BaseerButton type="button" variant="quiet" disabled={busy || activation.status === "SUSPENDED"} onClick={() => { setSuspensionReason(""); setSuspendActivation(activation); }}>{ar ? "إيقاف" : "Suspend"}</BaseerButton></> : candidate && !evaluationPassed ? <BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => void runOfflineEvaluation(skill)}>{ar ? "فحص الجاهزية" : "Check readiness"}</BaseerButton> : candidate && !runtimeReady ? <><span className="basira-governance__state">{ar ? "الفحص مكتمل؛ بوابة الخادم مغلقة" : "Check passed; server gate is closed"}</span><BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => void runOfflineEvaluation(skill)}>{ar ? "إعادة الفحص" : "Recheck"}</BaseerButton></> : candidate ? <BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => { setCommandError(null); setActivationBudget(initialActivationBudget); setActivationSkill(skill); }}>{skill.status === "ACTIVE" ? (ar ? "تفعيل للشركة" : "Activate for company") : (ar ? "بدء تجربة للشركة" : "Start company pilot")}</BaseerButton> : <span className="basira-governance__state">{ar ? "غير مؤهلة للتفعيل" : "Not eligible for activation"}</span>}</footer></article>;
    })}</div></section></BaseerCard>
    <BaseerCard className="basira-governance__card basira-governance__card--records"><section className="basira-governance__section"><header><div><p className="basira-scope-badge">{ar ? "الشركة الحالية" : "Current company"}</p><h4>{ar ? "السجل والجودة" : "Record and quality"}</h4><p>{ar ? "يبقى الدليل وسجل المراجعة محفوظين، ولا يحتفظ السجل بالنص الكامل للطلب أو الجواب." : "Evidence and the audit record remain available; the log never keeps full prompts or responses."}</p></div></header><div className="basira-governance__list">{governance.receipts.length ? governance.receipts.slice(0, 12).map((receipt) => <article key={receipt.id}><div><strong>{receipt.skillKey ?? receipt.moduleKey}</strong><small>{receipt.outcome} · {date(receipt.createdAt)}{receipt.safeErrorCode ? ` · ${receipt.safeErrorCode}` : ""}</small><p>{receipt.evidenceSnapshotId ? (ar ? "مرتبط بحزمة أدلة متجمدة." : "Linked to frozen evidence.") : (ar ? "لا يحمل هذا الإيصال حزمة أدلة." : "This receipt has no evidence package.")}</p></div><footer>{receipt.outcome === "SUCCEEDED" ? <BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => { setFeedbackKind("USEFUL"); setFeedbackNote(""); setFeedbackReceipt(receipt); }}>{ar ? "تقييم" : "Evaluate"}</BaseerButton> : <span className="basira-governance__state">{ar ? "لا يحتاج تقييماً" : "No evaluation needed"}</span>}</footer></article>) : <p className="decision-muted">{ar ? "لا توجد سجلات تنفيذ بعد." : "No execution records yet."}</p>}</div>{governance.evaluations.length ? <div className="basira-governance__feedback"><strong>{ar ? "أحدث التقييمات" : "Latest evaluations"}</strong>{governance.evaluations.slice(0, 6).map((item) => <span key={item.id}>{evaluationLabel(item.kind, language)} · {date(item.createdAt)}</span>)}</div> : null}</section></BaseerCard>
    <BaseerFormDialog open={draftOpen} title={ar ? "إضافة معلومة للشركة" : "Add company knowledge"} language={language} formId="basira-context-draft" submitLabel={ar ? "حفظ مسودة" : "Save draft"} onClose={() => setDraftOpen(false)} busy={busy} error={commandError} size="wide"><form id="basira-context-draft" className="basira-governance__form" onSubmit={(event) => { event.preventDefault(); void createContext(); }}><p>{ar ? "اختر نوع المعلومة أولاً؛ تظهر فقط الحقول اللازمة. لا تكتب أرقاماً متغيرة أو رسائل أو تعليمات لتنفيذ إجراء." : "Choose the knowledge type first; only its necessary fields appear. Do not enter changing figures, messages, or execution instructions."}</p><label>{ar ? "نوع المعلومة" : "Knowledge type"}<select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...initialContextDraft, kind: event.target.value as ContextDraft["kind"] }))}><option value="TERMINOLOGY">{ar ? "مصطلح وتعريف" : "Term and definition"}</option><option value="BUSINESS_SCOPE">{ar ? "نطاق عمل" : "Business scope"}</option><option value="POLICY_REFERENCE">{ar ? "مرجع سياسة" : "Policy reference"}</option></select></label><label>{ar ? "القسم المرتبط" : "Related area"}<input required value={draft.moduleScope} onChange={(event) => setDraft((current) => ({ ...current, moduleScope: event.target.value }))} placeholder="marketing / finance / general" /></label>{draft.kind !== "POLICY_REFERENCE" ? <><label>{ar ? "العنوان أو المصطلح" : "Title or term"}<input required value={draft.termAr} onChange={(event) => setDraft((current) => ({ ...current, termAr: event.target.value }))} /></label><label>{ar ? "الوصف المختصر" : "Short definition"}<textarea required value={draft.definitionAr} onChange={(event) => setDraft((current) => ({ ...current, definitionAr: event.target.value }))} /></label></> : null}{draft.kind === "BUSINESS_SCOPE" ? <label className="basira-governance__form-full">{ar ? "مجال العمل" : "Business domain"}<input required value={draft.businessDomain} onChange={(event) => setDraft((current) => ({ ...current, businessDomain: event.target.value }))} /></label> : null}{draft.kind === "POLICY_REFERENCE" ? <><label>{ar ? "رمز السياسة" : "Policy code"}<input required value={draft.policyCode} onChange={(event) => setDraft((current) => ({ ...current, policyCode: event.target.value }))} /></label><label>{ar ? "إصدار السياسة" : "Policy version"}<input required value={draft.policyVersion} onChange={(event) => setDraft((current) => ({ ...current, policyVersion: event.target.value }))} /></label><label className="basira-governance__form-full">{ar ? "عنوان السياسة" : "Policy title"}<input required value={draft.policyTitleAr} onChange={(event) => setDraft((current) => ({ ...current, policyTitleAr: event.target.value }))} /></label></> : null}{draft.kind !== "POLICY_REFERENCE" ? <label>{ar ? "أسلوب العرض" : "Presentation style"}<select value={draft.presentationStyle} onChange={(event) => setDraft((current) => ({ ...current, presentationStyle: event.target.value as ContextDraft["presentationStyle"] }))}><option value="CONCISE">{ar ? "مختصر" : "Concise"}</option><option value="DETAILED">{ar ? "تفصيلي" : "Detailed"}</option></select></label> : null}<label className="basira-governance__form-full">{ar ? "مرجع المصدر اختياري" : "Optional source reference"}<input value={draft.sourceReference} onChange={(event) => setDraft((current) => ({ ...current, sourceReference: event.target.value }))} /></label></form></BaseerFormDialog>
    <BaseerFormDialog open={Boolean(activationSkill)} title={ar ? "بدء تجربة مهارة بصيرة" : "Start a Basira skill pilot"} language={language} formId="basira-activate-skill" submitLabel={ar ? "بدء التجربة" : "Start pilot"} onClose={() => setActivationSkill(null)} busy={busy} error={commandError} submitDisabled={!activationBudget.dailyRequestLimit || !activationBudget.dailyCostLimit} size="compact"><form id="basira-activate-skill" className="basira-governance__form" onSubmit={(event) => { event.preventDefault(); void submitActivation(); }}><p>{activationSkill ? (ar ? `ستعمل التجربة المحدودة لمهارة «${activationSkill.nameAr}» في الشركة الحالية فقط.` : `The limited pilot applies only to “${activationSkill.nameEn}” in the active company.`) : null}</p><label>{ar ? "حد الطلبات اليومي لهذه المهارة" : "Daily request limit for this skill"}<input autoFocus inputMode="numeric" dir="ltr" lang="en" value={activationBudget.dailyRequestLimit} onChange={(event) => setActivationBudget((current) => ({ ...current, dailyRequestLimit: normalizeBaseerNumericInput(event.target.value).replace(".", "") }))} /></label><label>{ar ? "سقف التكلفة اليومي بالدولار" : "Daily USD cost cap"}<input inputMode="decimal" dir="ltr" lang="en" value={activationBudget.dailyCostLimit} onChange={(event) => setActivationBudget((current) => ({ ...current, dailyCostLimit: normalizeBaseerNumericInput(event.target.value) }))} /><small>{ar ? "السقف حازم ويمنع الطلب قبل إرساله؛ استخدام تفسير محفوظ لا يستهلكه." : "This is a hard pre-send cap; reusing a saved explanation consumes none of it."}</small></label></form></BaseerFormDialog>
    <BaseerFormDialog open={Boolean(suspendActivation)} title={ar ? "إيقاف مهارة بصيرة" : "Suspend Basira skill"} language={language} formId="basira-suspend-skill" submitLabel={ar ? "إيقاف المهارة" : "Suspend skill"} onClose={() => setSuspendActivation(null)} busy={busy} error={commandError} submitDisabled={!suspensionReason.trim()} size="compact"><form id="basira-suspend-skill" className="basira-governance__form" onSubmit={(event) => { event.preventDefault(); void submitSuspension(); }}><p>{ar ? "يوقف هذا التفعيل للشركة الحالية فوراً مع الاحتفاظ بسجل التدقيق." : "This immediately stops the activation for the active company and preserves the audit record."}</p><label className="basira-governance__form-full">{ar ? "سبب الإيقاف" : "Suspension reason"}<textarea autoFocus value={suspensionReason} onChange={(event) => setSuspensionReason(event.target.value)} /></label></form></BaseerFormDialog>
    <BaseerFormDialog open={Boolean(feedbackReceipt)} title={ar ? "تقييم إجابة بصيرة" : "Evaluate a Basira answer"} language={language} formId="basira-feedback" submitLabel={ar ? "حفظ التقييم" : "Save evaluation"} onClose={() => setFeedbackReceipt(null)} busy={busy} error={commandError} size="compact"><form id="basira-feedback" className="basira-governance__form" onSubmit={(event) => { event.preventDefault(); void submitFeedback(); }}><p>{ar ? "التقييم يحسن النسخ القادمة بمراجعة بشرية؛ لا يغير الحقائق أو يتعلم تلقائياً." : "Evaluation improves future versions through human review; it never changes facts or learns automatically."}</p><label>{ar ? "التقييم" : "Evaluation"}<select value={feedbackKind} onChange={(event) => setFeedbackKind(event.target.value as typeof feedbackKind)}>{(["USEFUL", "NOT_USEFUL", "DATA_INCOMPLETE", "COMPARISON_UNFAIR", "CONTEXT_DIFFERENT", "OTHER"] as const).map((kind) => <option key={kind} value={kind}>{evaluationLabel(kind, language)}</option>)}</select></label><label className="basira-governance__form-full">{ar ? "ملاحظة اختيارية" : "Optional note"}<textarea value={feedbackNote} onChange={(event) => setFeedbackNote(event.target.value)} /></label></form></BaseerFormDialog>
  </section>;
}

function contextKindLabel(kind: Governance["companyContexts"][number]["kind"], language: Language) { return ({ TERMINOLOGY: language === "ar" ? "مصطلحات" : "Terminology", BUSINESS_SCOPE: language === "ar" ? "نطاق أعمال" : "Business scope", POLICY_REFERENCE: language === "ar" ? "مرجع سياسة" : "Policy reference" })[kind]; }
function contextStatusLabel(status: Governance["companyContexts"][number]["status"], language: Language) { return ({ DRAFT: language === "ar" ? "مسودة" : "Draft", APPROVED: language === "ar" ? "معتمد" : "Approved", SUPERSEDED: language === "ar" ? "استُبدل" : "Superseded", REVOKED: language === "ar" ? "ملغى" : "Revoked" })[status]; }
function activationStatusLabel(status: Governance["activations"][number]["status"], language: Language) { return ({ PILOT: language === "ar" ? "تجربة مفعلة" : "Pilot active", ACTIVE: language === "ar" ? "مفعلة" : "Active", SUSPENDED: language === "ar" ? "متوقفة" : "Suspended" })[status]; }
function catalogueStatusLabel(status: Governance["catalogue"][number]["status"], language: Language) { return ({ PLANNED: language === "ar" ? "مخططة" : "Planned", VALIDATED: language === "ar" ? "متحقق منها" : "Validated", PILOT: language === "ar" ? "تجربة" : "Pilot", ACTIVE: language === "ar" ? "نشطة" : "Active", SUSPENDED: language === "ar" ? "موقوفة" : "Suspended" })[status]; }
function evaluationLabel(kind: Governance["evaluations"][number]["kind"], language: Language) { return ({ USEFUL: language === "ar" ? "مفيد" : "Useful", NOT_USEFUL: language === "ar" ? "غير مناسب" : "Not useful", DATA_INCOMPLETE: language === "ar" ? "البيانات ناقصة" : "Data incomplete", COMPARISON_UNFAIR: language === "ar" ? "المقارنة غير عادلة" : "Comparison unfair", CONTEXT_DIFFERENT: language === "ar" ? "السياق مختلف" : "Context differs", OTHER: language === "ar" ? "أخرى" : "Other" })[kind]; }
function runtimeStateLabel(state: Governance["catalogue"][number]["runtime"]["state"], language: Language) { return ({ READY: language === "ar" ? "جاهز" : "Ready", SERVER_GATED: language === "ar" ? "يتطلب بوابة خادم" : "Server-gated", NOT_IMPLEMENTED: language === "ar" ? "غير مبني بعد" : "Not implemented" })[state]; }
function evaluationStatusLabel(status: OfflineEvaluation["status"], language: Language) { return ({ PASSED: language === "ar" ? "اجتاز" : "Passed", FAILED: language === "ar" ? "لم يجتز" : "Failed", BLOCKED: language === "ar" ? "محجوب" : "Blocked" })[status]; }
function contextSummary(context: Governance["companyContexts"][number], language: Language) {
  const terms = context.approvedTermsJson as { terms?: unknown[]; businessDomains?: unknown[] } | null;
  const policies = Array.isArray(context.policyReferencesJson) ? context.policyReferencesJson.length : 0;
  const count = Array.isArray(terms?.terms) ? terms.terms.length : 0;
  const domains = Array.isArray(terms?.businessDomains) ? terms.businessDomains.length : 0;
  return language === "ar" ? `${count} مصطلح، ${domains} مجال، ${policies} مرجع سياسة.${context.sourceReference ? ` المصدر: ${context.sourceReference}` : ""}` : `${count} terms, ${domains} business domains, and ${policies} policy references.${context.sourceReference ? ` Source: ${context.sourceReference}` : ""}`;
}

function providerLabel(provider: ProviderReceipt["provider"]) {
  if (provider === "OPENAI_COMPATIBLE") return "OpenAI";
  if (provider === "ANTHROPIC") return "Anthropic";
  if (provider === "GOOGLE_GENERATIVE_AI") return "Google Gemini";
  if (provider === "DASHSCOPE_QWEN") return "Alibaba DashScope / Qwen";
  return "DeepSeek";
}

/**
 * A provider configuration is immutable evidence: saving or activating a
 * later configuration must not erase its predecessor. The settings screen,
 * however, is an operational surface, so it shows one current card per
 * provider/model and leaves older revisions in the audit trail.
 */
function summarizeProviderConfigurations(configurations: readonly ProviderReceipt[], activeProviderId: string | null): VisibleProviderConfigurations {
  const groups = new Map<string, ProviderReceipt[]>();
  for (const configuration of configurations) {
    const key = `${configuration.provider}:${configuration.model}`;
    const group = groups.get(key) ?? [];
    group.push(configuration);
    groups.set(key, group);
  }
  const items: ProviderReceipt[] = [];
  let hiddenRevisionCount = 0;
  for (const group of groups.values()) {
    const current = [...group].sort((left, right) => providerConfigurationPriority(left, activeProviderId) - providerConfigurationPriority(right, activeProviderId) || right.configurationVersion - left.configurationVersion || right.updatedAt.localeCompare(left.updatedAt))[0];
    if (!current) continue;
    items.push(current);
    hiddenRevisionCount += group.length - 1;
  }
  return { items: items.sort((left, right) => providerConfigurationPriority(left, activeProviderId) - providerConfigurationPriority(right, activeProviderId) || right.updatedAt.localeCompare(left.updatedAt)), hiddenRevisionCount };
}

function providerConfigurationPriority(configuration: ProviderReceipt, activeProviderId: string | null) {
  if (configuration.id === activeProviderId) return 0;
  if (configuration.isDefault) return 1;
  if (configuration.status === "VALIDATED") return 2;
  if (configuration.status === "DRAFT") return 3;
  if (configuration.status === "ACTIVE") return 4;
  return 5;
}

function providerActivationGateLabelAr(gate: ProviderCapability["requiredActivationGates"][number]) {
  return ({ PRIVACY_AND_REGION_DECISION: "قرار الخصوصية والمنطقة", SERVER_ADAPTER: "محول خادمي", LOCAL_TOKEN_COUNTER: "عداد توكن محلي", CURRENT_PRICE_REVISION: "سعر موثق", ARABIC_SKILL_EVALUATION: "تقييم عربي", LIVE_CONNECTION_PROBE: "فحص اتصال حي" })[gate];
}

function providerActivationGateLabelEn(gate: ProviderCapability["requiredActivationGates"][number]) {
  return ({ PRIVACY_AND_REGION_DECISION: "privacy and region decision", SERVER_ADAPTER: "server adapter", LOCAL_TOKEN_COUNTER: "local token counter", CURRENT_PRICE_REVISION: "documented price", ARABIC_SKILL_EVALUATION: "Arabic evaluation", LIVE_CONNECTION_PROBE: "live connection probe" })[gate];
}

function providerCostTierLabel(costTier: ProviderCapability["costTier"], language: Language) {
  if (language === "ar") return ({ LOW: "منخفضة", MEDIUM: "متوسطة", HIGH: "مرتفعة" })[costTier];
  return ({ LOW: "Low", MEDIUM: "Medium", HIGH: "High" })[costTier];
}

function formatUsd(value: string | null, language: Language) {
  if (value === null) return language === "ar" ? "غير محدد" : "Not set";
  return formatMoney(value, "USD", language, 4);
}

function providerStatusLabel(status: ProviderReceipt["status"], language: Language) {
  const ar = language === "ar";
  return ({ DRAFT: ar ? "مسودة" : "Draft", VALIDATED: ar ? "تم التحقق" : "Validated", ACTIVE: ar ? "نشط" : "Active", DISABLED: ar ? "متوقف" : "Disabled" })[status];
}

function connectionReasonText(reason: NonNullable<ProviderConnection["reason"]>, language: Language) {
  const ar = language === "ar";
  return {
    PROVIDER_NOT_CONFIGURED: ar ? "احفظ إعداد مزود أولاً." : "Save a provider configuration first.",
    CREDENTIAL_DECRYPTION_FAILED: ar ? "المفتاح المحفوظ لا يطابق مفتاح تشفير الخادم الحالي؛ أعد حفظ إعداد OpenAI." : "The saved key does not match this server encryption key; save the OpenAI configuration again.",
    CREDENTIAL_REJECTED: ar ? "رفض OpenAI مفتاح API؛ تحقق من المفتاح والمشروع." : "OpenAI rejected the API key; verify the key and project.",
    MODEL_UNAVAILABLE: ar ? "النموذج المختار غير متاح لهذا المفتاح." : "The selected model is unavailable to this API key.",
    PROJECT_ACCESS_DENIED: ar ? "المفتاح محفوظ، لكن مشروع OpenAI لا يسمح باستخدام هذا النموذج. راجع مشروع المفتاح والصلاحيات." : "The API project does not permit this model. Review the key's project and permissions.",
    BILLING_OR_QUOTA_REQUIRED: ar ? "مشروع OpenAI يحتاج رصيداً أو فوترة صالحة، أو بلغ سقف الاستهلاك. عالج ذلك في OpenAI ثم أعد الفحص." : "The OpenAI project needs valid billing/credit or has reached its usage quota. Fix it in OpenAI, then check again.",
    PROVIDER_RATE_LIMITED: ar ? "OpenAI حدّ الطلبات مؤقتاً؛ أعد الفحص لاحقاً." : "OpenAI temporarily rate-limited the request; try again later.",
    PROVIDER_UNREACHABLE: ar ? "تعذر الوصول إلى OpenAI من الخادم." : "The server could not reach OpenAI.",
    PROVIDER_RESPONSE_REJECTED: ar ? "استجاب OpenAI بطلب مرفوض غير مصنّف. يظهر رمز HTTP أعلاه؛ راجع سجل الفحص الآمن قبل تغيير المفتاح." : "OpenAI rejected the probe with an unclassified response. Review the safe HTTP status above before changing the key.",
    PROVIDER_UNAVAILABLE: ar ? "خدمة OpenAI غير متاحة مؤقتاً من جهتها؛ أعد الفحص لاحقاً." : "OpenAI is temporarily unavailable; check again later.",
  }[reason];
}
