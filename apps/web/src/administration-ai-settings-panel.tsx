import { useCallback, useState } from "react";

import { api, requestId, type ActiveSession } from "./daily-sales-client";
import { BaseerCard } from "./baseer-card";
import { BaseerButton } from "./baseer-button";
import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerValidatedFormField, type BaseerValidatedFormSchemaFactory } from "./baseer-validated-form-field";
import { formatCount, formatDateTime, formatMoney, normalizeBaseerNumericInput } from "./number-format";

type Language = "ar" | "en";
type ProviderReceipt = {
  id: string;
  provider: "OPENAI_COMPATIBLE" | "ANTHROPIC" | "GOOGLE_GENERATIVE_AI";
  model: string;
  status: "DRAFT" | "VALIDATED" | "ACTIVE" | "DISABLED";
  isDefault: boolean;
  dailyRequestLimit: number;
  dailyCostLimit: string | null;
  configurationVersion: number;
  createdAt: string;
  updatedAt: string;
};
type Configuration = { companyId: string; activeProvider: ProviderReceipt | null; providerConfigurations: ProviderReceipt[]; latestProviderConnectionCheck: ProviderConnection | null; activeSystemIdentity: unknown | null; activeIdentity: unknown | null };
type ProviderConnection = {
  configurationId: string | null;
  state: "READY" | "ERROR" | "UNCONFIGURED";
  reason: "PROVIDER_NOT_CONFIGURED" | "CREDENTIAL_DECRYPTION_FAILED" | "CREDENTIAL_REJECTED" | "MODEL_UNAVAILABLE" | "PROJECT_ACCESS_DENIED" | "BILLING_OR_QUOTA_REQUIRED" | "PROVIDER_RATE_LIMITED" | "PROVIDER_UNREACHABLE" | "PROVIDER_RESPONSE_REJECTED" | "PROVIDER_UNAVAILABLE" | null;
  provider: "OPENAI_COMPATIBLE" | "ANTHROPIC" | "GOOGLE_GENERATIVE_AI" | null;
  model: string | null;
  upstreamStatus: number | null;
  checkedAt: string;
};
type FormValues = { apiKey: string; model: string; dailyRequestLimit: string; dailyCostLimit: string };
type ActivationBudget = { dailyRequestLimit: string; dailyCostLimit: string };

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

/**
 * Deliberately narrow UI: it stores an OpenAI key once through the existing
 * encrypted server endpoint. The key is never read back into this view.
 */
export function AdministrationAiSettingsPanel({ language, session, owner }: { language: Language; session: ActiveSession; owner: boolean }) {
  return <div className="administration-basira-governance">
    <BaseerCompanyReadQuery session={session} resource="administration.ai.configuration" load={(current, signal) => api<Configuration>(current, "/administration/ai/configuration", { signal })}>
      {({ data, loading, error, refetch }) => <AiSettingsContent language={language} session={session} owner={owner} configuration={data} loading={loading} loadError={error} refetch={refetch} />}
    </BaseerCompanyReadQuery>
    <BasiraGovernancePanel language={language} session={session} />
  </div>;
}

function AiSettingsContent({ language, session, owner, configuration, loading, loadError, refetch }: { language: Language; session: ActiveSession; owner: boolean; configuration: Configuration | undefined; loading: boolean; loadError: unknown; refetch: () => Promise<void> }) {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ProviderConnection | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const ar = language === "ar";
  const provider = configuration?.activeProvider ?? null;
  const candidateProvider = configuration?.providerConfigurations.find((item) => item.status === "DRAFT" || item.status === "VALIDATED") ?? provider;
  const schemaFactory = useCallback<BaseerValidatedFormSchemaFactory>(({ z }) => z.object({
    apiKey: z.string().trim().min(1, ar ? "أدخل مفتاح OpenAI." : "Enter the OpenAI key."),
    model: z.string().trim().min(1, ar ? "أدخل اسم الموديل." : "Enter the model name.").max(160),
    dailyRequestLimit: z.string().regex(/^\d+$/, ar ? "أدخل عدداً صحيحاً." : "Enter a whole number.").refine((value) => Number(value) >= 1 && Number(value) <= 100_000, ar ? "الحد بين 1 و100000." : "The limit must be between 1 and 100000."),
    dailyCostLimit: z.string().regex(/^\d+(?:\.\d{1,4})?$/, ar ? "أدخل مبلغاً بالدولار." : "Enter a USD amount.").refine((value) => Number(value) > 0 && Number(value) <= 100_000, ar ? "أدخل مبلغاً أكبر من صفر." : "Enter an amount above zero."),
  }), [ar]);
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
    setBusy(true); setError(null); setMessage(null);
    try {
      const idempotencyKey = requestId();
      await api<ProviderReceipt>(session, "/administration/ai/provider-configurations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ provider: "OPENAI_COMPATIBLE", model: next.model.trim(), apiKey: next.apiKey, dailyRequestLimit: Number(next.dailyRequestLimit), dailyCostLimit: next.dailyCostLimit, idempotencyKey }),
      });
      setValues((current) => ({ ...current, apiKey: "" }));
      await refetch();
      setMessage(ar ? "تم حفظ الإعداد مشفراً كمسودة. افحص الاتصال ثم فعّل الملف صراحةً." : "The encrypted configuration was saved as a draft. Verify the connection, then activate it explicitly.");
  } catch (reason) {
      setError(presentBaseerApiError(reason, language, ar ? "تعذر حفظ إعداد بصيرة." : "The Basira configuration could not be saved."));
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
  if (loading) return <section className="administration-section"><p className="administration-loading">{ar ? "جارٍ تحميل إعداد بصيرة…" : "Loading Basira settings…"}</p></section>;
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
  return <section className="administration-section administration-ai-settings" aria-label={ar ? "إعداد بصيرة" : "Basira settings"}>
    <header className="administration-section-heading"><div><p className="eyebrow">Baseer / Basira</p><h3>{ar ? "إعداد تفسير التنبيهات" : "Alert-explanation setup"}</h3><p>{ar ? "يُخزّن المفتاح مشفراً في الخادم ولا يظهر مرة أخرى. لا يفعّل التفسير وحده؛ يحتاج الخادم إلى مفتاح تشغيل Pilot." : "The key is encrypted on the server and never displayed again. Saving it alone does not enable explanations; the API deployment still needs the pilot switch."}</p></div></header>
    {loadError ? <p className="daily-sales-message error" role="status">{ar ? "تعذر قراءة الإعداد الحالي، لكن يمكنك حفظ إعداد جديد إذا كنت مالك النظام." : "The current configuration could not be read. As the system owner, you can still save a new configuration."}</p> : null}
    <BaseerCard tone="muted"><dl className="administration-ai-settings__status"><div><dt>{ar ? "الحالة الحالية" : "Current status"}</dt><dd>{provider ? (ar ? "مزود نشط" : "Provider active") : candidateProvider ? (ar ? "مزود بانتظار التحقق" : "Provider pending verification") : (ar ? "لا يوجد مزود محفوظ" : "No provider configured")}</dd></div><div className={`administration-ai-connection is-${connectionBusy ? "checking" : displayedConnection?.state?.toLowerCase() ?? "unchecked"}`}><dt>{ar ? "اتصال بصيرة" : "Basira connection"}</dt><dd><span className="administration-ai-connection__dot" aria-hidden="true" />{connectionText}</dd>{connectionReason ? <small>{connectionReason}</small> : null}{displayedConnection?.upstreamStatus ? <small dir="ltr">HTTP {displayedConnection.upstreamStatus}</small> : null}{displayedConnection?.checkedAt ? <small>{ar ? "آخر فحص يدوي: " : "Last manual check: "}{formatDateTime(displayedConnection.checkedAt, language, "Asia/Riyadh")}</small> : null}{connectionError ? <small role="alert">{connectionError}</small> : null}{owner && candidateProvider ? <button type="button" className="baseer-button baseer-button--quiet" disabled={connectionBusy} onClick={() => void checkConnection()}>{connectionBusy ? (ar ? "جارٍ الفحص…" : "Checking…") : (ar ? "فحص الاتصال الآن" : "Check connection now")}</button> : null}</div>{(provider ?? candidateProvider) ? <><div><dt>{ar ? "الموديل" : "Model"}</dt><dd dir="ltr">{(provider ?? candidateProvider)!.model}</dd></div><div><dt>{ar ? "حد الطلبات اليومي" : "Daily request limit"}</dt><dd><bdi dir="ltr">{formatCount((provider ?? candidateProvider)!.dailyRequestLimit, language)}</bdi></dd></div><div><dt>{ar ? "سقف التكلفة اليومي" : "Daily cost cap"}</dt><dd><bdi dir="ltr">{formatUsd((provider ?? candidateProvider)!.dailyCostLimit, language)}</bdi></dd></div><div><dt>{ar ? "الإصدار" : "Version"}</dt><dd><bdi dir="ltr">{formatCount((provider ?? candidateProvider)!.configurationVersion, language)}</bdi></dd></div></> : null}</dl></BaseerCard>
    {configuration?.providerConfigurations.length ? <BaseerCard tone="muted"><section className="administration-ai-profile-switcher" aria-label={ar ? "ملفات الذكاء" : "AI profiles"}><header><h4>{ar ? "ملفات الذكاء" : "AI profiles"}</h4><p>{ar ? "التسلسل آمن: مسودة → فحص اتصال → تفعيل صريح. حفظ المفتاح وحده لا يشغّل بصيرة." : "The safe sequence is: draft → verify connection → explicit activation. Saving a key never enables Basira by itself."}</p></header><div className="administration-ai-profile-switcher__list">{configuration.providerConfigurations.map((item) => <article key={item.id} className={item.isDefault ? "is-active" : undefined}><div><strong>{providerLabel(item.provider)}</strong><span dir="ltr">{item.model}</span><small>{ar ? `الحالة: ${providerStatusLabel(item.status, language)} · الحد اليومي: ${item.dailyRequestLimit}` : `Status: ${providerStatusLabel(item.status, language)} · Daily limit: ${item.dailyRequestLimit}`}</small></div>{item.isDefault ? <span className="administration-ai-profile-switcher__active">{ar ? "النشط الآن" : "Active now"}</span> : item.status === "VALIDATED" ? <button type="button" className="baseer-button baseer-button--quiet" disabled={!owner || activatingId !== null} onClick={() => void activateProfile(item.id)}>{activatingId === item.id ? (ar ? "جارٍ التفعيل…" : "Activating…") : (ar ? "تفعيل هذا الملف" : "Activate this profile")}</button> : item.status === "DRAFT" ? <span className="administration-ai-profile-switcher__active">{ar ? "افحص الاتصال أولاً" : "Verify connection first"}</span> : <span className="administration-ai-profile-switcher__active">{providerStatusLabel(item.status, language)}</span>}</article>)}</div><small>{ar ? "سيظهر Anthropic وGoogle هنا فقط بعد إضافة محولات خادمية آمنة ومفاتيحهما؛ لا يمكن تفعيلهما بشكل وهمي." : "Anthropic and Google will appear here only after secure server adapters and credentials are added; they cannot be activated deceptively."}</small></section></BaseerCard> : null}
    {owner ? <BaseerValidatedFormField<FormValues> id="administration-ai-provider" className="administration-ai-settings__form" values={values} schemaFactory={schemaFactory} onValid={(next) => void submit(next)} errorSummaryLabel={ar ? "تحقق من الحقول المطلوبة." : "Check the required fields."}>{({ errors }) => <>
      <label>{ar ? "المزود" : "Provider"}<input value="OpenAI" disabled readOnly /></label>
      <label>{ar ? "مفتاح OpenAI" : "OpenAI API key"}<input type="password" autoComplete="new-password" value={values.apiKey} aria-invalid={Boolean(errors.apiKey)} aria-describedby={errors.apiKey ? "administration-ai-key-error" : undefined} onChange={(event) => setValues((current) => ({ ...current, apiKey: event.target.value }))} />{errors.apiKey ? <small id="administration-ai-key-error" role="alert">{errors.apiKey.message}</small> : <small>{ar ? "لن يظهر هذا المفتاح بعد الحفظ." : "This key is never displayed after saving."}</small>}</label>
      <label>{ar ? "الموديل" : "Model"}<input value={values.model} aria-invalid={Boolean(errors.model)} onChange={(event) => setValues((current) => ({ ...current, model: event.target.value }))} />{errors.model ? <small role="alert">{errors.model.message}</small> : null}</label>
      <label>{ar ? "حد التفسيرات اليومي" : "Daily explanation limit"}<input inputMode="numeric" dir="ltr" lang="en" value={values.dailyRequestLimit} aria-invalid={Boolean(errors.dailyRequestLimit)} onChange={(event) => setValues((current) => ({ ...current, dailyRequestLimit: normalizeBaseerNumericInput(event.target.value).replace(".", "") }))} />{errors.dailyRequestLimit ? <small role="alert">{errors.dailyRequestLimit.message}</small> : <small>{ar ? "ابدأ بـ10 للتجربة." : "Start with 10 for the pilot."}</small>}</label>
      <label>{ar ? "سقف التكلفة اليومي بالدولار" : "Daily USD cost cap"}<input inputMode="decimal" dir="ltr" lang="en" value={values.dailyCostLimit} aria-invalid={Boolean(errors.dailyCostLimit)} onChange={(event) => setValues((current) => ({ ...current, dailyCostLimit: normalizeBaseerNumericInput(event.target.value) }))} />{errors.dailyCostLimit ? <small role="alert">{errors.dailyCostLimit.message}</small> : <small>{ar ? "سقف حازم: يتوقف الطلب قبل إرساله عند تجاوزه." : "Hard stop: a request is blocked before sending if it would exceed this."}</small>}</label>
      {error ? <p className="daily-sales-message error" role="alert">{error}</p> : null}{message ? <p className="daily-sales-message success" role="status">{message}</p> : null}
      <footer><button className="daily-sales-primary" disabled={busy}>{busy ? (ar ? "جارٍ الحفظ…" : "Saving…") : (provider ? (ar ? "تحديث إعداد OpenAI" : "Update OpenAI configuration") : (ar ? "حفظ إعداد OpenAI" : "Save OpenAI configuration"))}</button></footer>
    </>}</BaseerValidatedFormField> : <p className="daily-sales-message error">{ar ? "هذه الصفحة للمالك فقط." : "Only the system owner can configure Basira."}</p>}
  </section>;
}

/** One capability-based surface for the tenant owner and company manager.
 * It deliberately manages structured reference data and governed switches,
 * never prompts, secrets, raw model output, or unrestricted chat memory. */
function BasiraGovernancePanel({ language, session }: { language: Language; session: ActiveSession }) {
  return <BaseerCompanyReadQuery session={session} resource="administration.ai.governance" load={(current, signal) => api<Governance>(current, "/administration/ai/governance", { signal })}>
    {({ data, loading, error, refetch }) => <BasiraGovernanceContent language={language} session={session} governance={data} loading={loading} loadError={error} refetch={refetch} />}
  </BaseerCompanyReadQuery>;
}

function BasiraGovernanceContent({ language, session, governance, loading, loadError, refetch }: { language: Language; session: ActiveSession; governance: Governance | undefined; loading: boolean; loadError: unknown; refetch: () => Promise<void> }) {
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

  if (loading) return <section className="administration-section"><p className="administration-loading">{ar ? "جارٍ تحميل حوكمة بصيرة…" : "Loading Basira governance…"}</p></section>;
  if (!governance) return <section className="administration-section"><BaseerCard tone="muted"><strong>{ar ? "حوكمة بصيرة غير متاحة لهذا الدور" : "Basira governance is unavailable for this role"}</strong><p>{loadError ? presentBaseerApiError(loadError, language, ar ? "تحتاج صلاحيات حوكمة بصيرة للشركة الحالية." : "You need Basira governance permissions for the active company.") : ""}</p></BaseerCard></section>;
  const activeActivations = new Map(governance.activations.filter((item) => item.status !== "SUSPENDED").map((item) => [`${item.skillKey}:${item.skillVersion}:${item.policyVersion}`, item]));
  return <section className="administration-section basira-governance" aria-label={ar ? "حوكمة بصيرة" : "Basira governance"}>
    <header className="administration-section-heading"><div><p className="eyebrow">Baseer / Basira</p><h3>{ar ? "حوكمة بصيرة للشركة الحالية" : "Basira governance for the active company"}</h3><p>{ar ? "تستخدم بصيرة سياقاً منظماً ومهارات معتمدة وإيصالات قابلة للتدقيق. لا توجد شخصيات متعددة أو تعليمات حرة هنا." : "Basira uses structured context, approved skills, and auditable receipts. There are no multiple personas or free-form prompts here."}</p></div></header>
    {commandError ? <p className="daily-sales-message error" role="alert">{commandError}</p> : null}{message ? <p className="daily-sales-message success" role="status">{message}</p> : null}
    <div className="baseer-metric-grid"><BaseerCard className="baseer-metric"><small>{ar ? "سياقات معتمدة" : "Approved context"}</small><strong>{governance.companyContexts.filter((item) => item.status === "APPROVED").length}</strong></BaseerCard><BaseerCard className="baseer-metric"><small>{ar ? "مهارات مفعلة" : "Active skills"}</small><strong>{governance.activations.filter((item) => item.status !== "SUSPENDED").length}</strong></BaseerCard><BaseerCard className="baseer-metric"><small>{ar ? "استهلاك اليوم" : "Today's usage"}</small><strong dir="ltr">{formatUsd(governance.consumption.chargedCostUsd, language)}</strong><small>{ar ? `${formatCount(governance.consumption.providerCalls, language)} طلب مزود منذ بداية يوم الرياض` : `${formatCount(governance.consumption.providerCalls, language)} provider calls since Riyadh day start`}</small></BaseerCard><BaseerCard className="baseer-metric"><small>{ar ? "تقييمات منظمة" : "Structured evaluations"}</small><strong>{governance.evaluations.length}</strong></BaseerCard></div>
    <BaseerCard><section className="basira-governance__section"><header><div><h4>{ar ? "سياق الشركة المعتمد" : "Approved company context"}</h4><p>{ar ? "مصطلحات ومراجع عمل فقط؛ لا أرقام مالية متغيرة ولا محتوى بريد أو Google ولا تعليمات للنموذج." : "Business terms and references only; no changing financial facts, email/Google content, or model instructions."}</p></div><BaseerButton type="button" onClick={() => { setCommandError(null); setDraftOpen(true); }}>{ar ? "إضافة سياق" : "Add context"}</BaseerButton></header><div className="basira-governance__list">{governance.companyContexts.length ? governance.companyContexts.map((item) => <article key={item.id}><div><strong>{contextKindLabel(item.kind, language)} · {item.moduleScope}</strong><small>{contextStatusLabel(item.status, language)} · {ar ? `إصدار ${item.version}` : `Version ${item.version}`} · {date(item.createdAt)}</small><p>{contextSummary(item, language)}</p></div><footer>{item.status === "DRAFT" ? <><BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => void approveContext(item.id)}>{ar ? "اعتماد" : "Approve"}</BaseerButton><BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => void revokeContext(item.id)}>{ar ? "إلغاء المسودة" : "Revoke draft"}</BaseerButton></> : item.status === "APPROVED" ? <BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => void revokeContext(item.id)}>{ar ? "إلغاء" : "Revoke"}</BaseerButton> : null}</footer></article>) : <p className="decision-muted">{ar ? "لا يوجد سياق معتمد أو مسودة بعد." : "No approved context or draft yet."}</p>}</div></section></BaseerCard>
    <BaseerCard><section className="basira-governance__section"><header><div><h4>{ar ? "كتالوج المهارات والتجربة" : "Skill catalogue and pilot"}</h4><p>{ar ? "المسار واضح: فحص ضوابط بلا تكلفة → فتح بوابة الخادم → تجربة بشرية محدودة. لا يوسّع التفعيل صلاحيات المهارة أو يمنحها أفعالاً خارجية." : "The path is explicit: no-cost safeguard check → server gate → limited human-click pilot. Activation never broadens permissions or grants external actions."}</p></div></header><div className="basira-governance__list">{governance.catalogue.map((skill) => {
      const activation = activeActivations.get(`${skill.key}:${skill.version}:${skill.policyVersion}`);
      const candidate = skill.status === "PILOT" || skill.status === "ACTIVE";
      const evaluationPassed = skill.latestOfflineEvaluation?.status === "PASSED";
      const runtimeReady = skill.runtime.state === "READY";
      return <article key={skill.key}><div><strong>{ar ? skill.nameAr : skill.nameEn}</strong><small>{skill.key} · {skill.riskTier} · {catalogueStatusLabel(skill.status, language)}</small><p>{skill.purpose}</p><small>{ar ? "حالة التشغيل: " : "Runtime: "}{runtimeStateLabel(skill.runtime.state, language)}{skill.runtime.nextRequirement ? ` · ${skill.runtime.nextRequirement}` : ""}</small><small>{skill.latestOfflineEvaluation ? `${ar ? "آخر فحص: " : "Latest check: "}${evaluationStatusLabel(skill.latestOfflineEvaluation.status, language)} · ${skill.latestOfflineEvaluation.passedCaseCount}/${skill.latestOfflineEvaluation.totalCaseCount}` : (ar ? "يلزم فحص ضوابط المهارة أولاً." : "Run the safeguard check first.")}</small><small>{ar ? "شرط التفعيل: " : "Activation condition: "}{skill.activationCondition}</small></div><footer>{activation ? <><span className="basira-governance__state">{activationStatusLabel(activation.status, language)} · {formatUsd(activation.dailyCostLimit, language)}</span><BaseerButton type="button" variant="quiet" disabled={busy || activation.status === "SUSPENDED"} onClick={() => { setSuspensionReason(""); setSuspendActivation(activation); }}>{ar ? "إيقاف" : "Suspend"}</BaseerButton></> : candidate && !evaluationPassed ? <BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => void runOfflineEvaluation(skill)}>{ar ? "فحص الجاهزية" : "Check readiness"}</BaseerButton> : candidate && !runtimeReady ? <><span className="basira-governance__state">{ar ? "الفحص مكتمل؛ بوابة الخادم مغلقة" : "Check passed; server gate is closed"}</span><BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => void runOfflineEvaluation(skill)}>{ar ? "إعادة الفحص" : "Recheck"}</BaseerButton></> : candidate ? <BaseerButton type="button" variant="secondary" disabled={busy} onClick={() => { setCommandError(null); setActivationBudget(initialActivationBudget); setActivationSkill(skill); }}>{skill.status === "ACTIVE" ? (ar ? "تفعيل للشركة" : "Activate for company") : (ar ? "بدء تجربة للشركة" : "Start company pilot")}</BaseerButton> : <span className="basira-governance__state">{ar ? "غير مؤهلة للتفعيل" : "Not eligible for activation"}</span>}</footer></article>;
    })}</div></section></BaseerCard>
    <BaseerCard><section className="basira-governance__section"><header><div><h4>{ar ? "الإيصالات والتقييم" : "Receipts and evaluation"}</h4><p>{ar ? "يبقى الدليل والإيصال محفوظين للتدقيق، ولا يحتفظ السجل بالنص الكامل للطلب أو الجواب." : "Evidence and receipts remain auditable; the log does not retain full prompts or responses."}</p></div></header><div className="basira-governance__list">{governance.receipts.length ? governance.receipts.slice(0, 12).map((receipt) => <article key={receipt.id}><div><strong>{receipt.skillKey ?? receipt.moduleKey}</strong><small>{receipt.outcome} · {date(receipt.createdAt)}{receipt.safeErrorCode ? ` · ${receipt.safeErrorCode}` : ""}</small><p>{receipt.evidenceSnapshotId ? (ar ? "مرتبط بحزمة أدلة متجمدة." : "Linked to frozen evidence.") : (ar ? "لا يحمل هذا الإيصال حزمة أدلة." : "This receipt has no evidence package.")}</p></div><footer>{receipt.outcome === "SUCCEEDED" ? <BaseerButton type="button" variant="quiet" disabled={busy} onClick={() => { setFeedbackKind("USEFUL"); setFeedbackNote(""); setFeedbackReceipt(receipt); }}>{ar ? "تقييم" : "Evaluate"}</BaseerButton> : <span className="basira-governance__state">{ar ? "لا يحتاج تقييماً" : "No evaluation needed"}</span>}</footer></article>) : <p className="decision-muted">{ar ? "لا توجد إيصالات تنفيذ بعد." : "No execution receipts yet."}</p>}</div>{governance.evaluations.length ? <div className="basira-governance__feedback"><strong>{ar ? "أحدث التقييمات" : "Latest evaluations"}</strong>{governance.evaluations.slice(0, 6).map((item) => <span key={item.id}>{evaluationLabel(item.kind, language)} · {date(item.createdAt)}</span>)}</div> : null}</section></BaseerCard>
    <BaseerFormDialog open={draftOpen} title={ar ? "إضافة سياق منظم لبصيرة" : "Add structured Basira context"} language={language} formId="basira-context-draft" submitLabel={ar ? "حفظ مسودة" : "Save draft"} onClose={() => setDraftOpen(false)} busy={busy} error={commandError} size="wide"><form id="basira-context-draft" className="basira-governance__form" onSubmit={(event) => { event.preventDefault(); void createContext(); }}><p>{ar ? "أضف معلومة ثابتة ومختصرة تساعد على فهم المصطلحات أو أسلوب العرض. لا تكتب تعليمات أو أرقاماً أو رسائل." : "Add a short, stable business reference. Do not enter instructions, changing figures, or messages."}</p><label>{ar ? "نوع السياق" : "Context kind"}<select value={draft.kind} onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as ContextDraft["kind"] }))}><option value="TERMINOLOGY">{ar ? "مصطلحات" : "Terminology"}</option><option value="BUSINESS_SCOPE">{ar ? "نطاق أعمال" : "Business scope"}</option><option value="POLICY_REFERENCE">{ar ? "مرجع سياسة" : "Policy reference"}</option></select></label><label>{ar ? "النطاق" : "Scope"}<input required value={draft.moduleScope} onChange={(event) => setDraft((current) => ({ ...current, moduleScope: event.target.value }))} placeholder="marketing / finance / general" /></label><label>{ar ? "أسلوب العرض" : "Presentation style"}<select value={draft.presentationStyle} onChange={(event) => setDraft((current) => ({ ...current, presentationStyle: event.target.value as ContextDraft["presentationStyle"] }))}><option value="CONCISE">{ar ? "مختصر" : "Concise"}</option><option value="DETAILED">{ar ? "تفصيلي" : "Detailed"}</option></select></label><label>{ar ? "مصطلح عربي" : "Arabic term"}<input value={draft.termAr} onChange={(event) => setDraft((current) => ({ ...current, termAr: event.target.value }))} /></label><label>{ar ? "تعريف المصطلح" : "Term definition"}<textarea value={draft.definitionAr} onChange={(event) => setDraft((current) => ({ ...current, definitionAr: event.target.value }))} /></label><label>{ar ? "مجال أعمال اختياري" : "Optional business domain"}<input value={draft.businessDomain} onChange={(event) => setDraft((current) => ({ ...current, businessDomain: event.target.value }))} /></label><label>{ar ? "رمز مرجع السياسة" : "Policy reference code"}<input value={draft.policyCode} onChange={(event) => setDraft((current) => ({ ...current, policyCode: event.target.value }))} /></label><label>{ar ? "إصدار السياسة" : "Policy version"}<input value={draft.policyVersion} onChange={(event) => setDraft((current) => ({ ...current, policyVersion: event.target.value }))} /></label><label>{ar ? "عنوان السياسة" : "Policy title"}<input value={draft.policyTitleAr} onChange={(event) => setDraft((current) => ({ ...current, policyTitleAr: event.target.value }))} /></label><label className="basira-governance__form-full">{ar ? "مرجع المصدر اختياري" : "Optional source reference"}<input value={draft.sourceReference} onChange={(event) => setDraft((current) => ({ ...current, sourceReference: event.target.value }))} /></label></form></BaseerFormDialog>
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
  return "Google Gemini";
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
