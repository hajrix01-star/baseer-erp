import { useCallback, useEffect, useState } from "react";

import { api, requestId, type ActiveSession } from "./daily-sales-client";
import { BaseerCard } from "./baseer-card";
import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerValidatedFormField, type BaseerValidatedFormSchemaFactory } from "./baseer-validated-form-field";

type Language = "ar" | "en";
type ProviderReceipt = {
  id: string;
  provider: "OPENAI_COMPATIBLE" | "ANTHROPIC" | "GOOGLE_GENERATIVE_AI";
  model: string;
  status: "ACTIVE" | "DISABLED";
  isDefault: boolean;
  dailyRequestLimit: number;
  dailyCostLimit: string | null;
  configurationVersion: number;
  createdAt: string;
  updatedAt: string;
};
type Configuration = { companyId: string; activeProvider: ProviderReceipt | null; providerConfigurations: ProviderReceipt[]; activeSystemIdentity: unknown | null; activeIdentity: unknown | null };
type ProviderConnection = {
  state: "READY" | "ERROR" | "UNCONFIGURED";
  reason: "PROVIDER_NOT_CONFIGURED" | "CREDENTIAL_DECRYPTION_FAILED" | "CREDENTIAL_REJECTED" | "MODEL_UNAVAILABLE" | "PROVIDER_RATE_LIMITED" | "PROVIDER_UNREACHABLE" | "PROVIDER_UNAVAILABLE" | null;
  provider: "OPENAI_COMPATIBLE" | "ANTHROPIC" | "GOOGLE_GENERATIVE_AI" | null;
  model: string | null;
  checkedAt: string;
};
type FormValues = { apiKey: string; model: string; dailyRequestLimit: string };

const initialValues: FormValues = { apiKey: "", model: "gpt-5-mini", dailyRequestLimit: "10" };

/**
 * Deliberately narrow UI: it stores an OpenAI key once through the existing
 * encrypted server endpoint. The key is never read back into this view.
 */
export function AdministrationAiSettingsPanel({ language, session, owner }: { language: Language; session: ActiveSession; owner: boolean }) {
  return <BaseerCompanyReadQuery session={session} resource="administration.ai.configuration" load={(current, signal) => api<Configuration>(current, "/administration/ai/configuration", { signal })}>
    {({ data, loading, error, refetch }) => <AiSettingsContent language={language} session={session} owner={owner} configuration={data} loading={loading} loadError={error} refetch={refetch} />}
  </BaseerCompanyReadQuery>;
}

function AiSettingsContent({ language, session, owner, configuration, loading, loadError, refetch }: { language: Language; session: ActiveSession; owner: boolean; configuration: Configuration | undefined; loading: boolean; loadError: unknown; refetch: () => Promise<void> }) {
  const [values, setValues] = useState<FormValues>(initialValues);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connection, setConnection] = useState<ProviderConnection | null>(null);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [activatingId, setActivatingId] = useState<string | null>(null);
  const ar = language === "ar";
  const provider = configuration?.activeProvider ?? null;
  const schemaFactory = useCallback<BaseerValidatedFormSchemaFactory>(({ z }) => z.object({
    apiKey: z.string().trim().min(1, ar ? "أدخل مفتاح OpenAI." : "Enter the OpenAI key."),
    model: z.string().trim().min(1, ar ? "أدخل اسم الموديل." : "Enter the model name.").max(160),
    dailyRequestLimit: z.string().regex(/^\d+$/, ar ? "أدخل عدداً صحيحاً." : "Enter a whole number.").refine((value) => Number(value) >= 1 && Number(value) <= 100_000, ar ? "الحد بين 1 و100000." : "The limit must be between 1 and 100000."),
  }), [ar]);
  const checkConnection = useCallback(async (signal?: AbortSignal) => {
    if (!provider) { setConnection(null); setConnectionBusy(false); return; }
    setConnectionBusy(true);
    try {
      const result = await api<ProviderConnection>(session, "/administration/ai/provider-connection", { method: "POST", signal });
      if (!signal?.aborted) setConnection(result);
    } catch {
      if (!signal?.aborted) setConnection({ state: "ERROR", reason: "PROVIDER_UNAVAILABLE", provider: provider.provider, model: provider.model, checkedAt: new Date().toISOString() });
    } finally {
      if (!signal?.aborted) setConnectionBusy(false);
    }
  }, [provider?.id, provider?.model, provider?.provider, session]);
  useEffect(() => {
    const controller = new AbortController();
    void checkConnection(controller.signal);
    return () => controller.abort();
  }, [checkConnection]);
  const submit = async (next: FormValues) => {
    if (!owner) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const idempotencyKey = requestId();
      await api<ProviderReceipt>(session, "/administration/ai/provider-configurations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ provider: "OPENAI_COMPATIBLE", model: next.model.trim(), apiKey: next.apiKey, dailyRequestLimit: Number(next.dailyRequestLimit), idempotencyKey }),
      });
      setValues((current) => ({ ...current, apiKey: "" }));
      await refetch();
      setMessage(ar ? "تم حفظ إعداد OpenAI مشفراً. لا يمكن عرض المفتاح مرة أخرى." : "The OpenAI configuration was saved encrypted. The key cannot be shown again.");
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
  const connectionText = connection?.state === "READY"
    ? (ar ? "متصل ومتحقق الآن" : "Connected and verified now")
    : connection?.state === "UNCONFIGURED"
      ? (ar ? "لم يُحفظ مزود بعد" : "No provider is configured")
      : connectionBusy
        ? (ar ? "جارٍ التحقق الفعلي…" : "Checking live connection…")
        : (ar ? "تعذر التحقق من الاتصال" : "Connection could not be verified");
  const connectionReason = connection?.reason ? connectionReasonText(connection.reason, language) : null;
  return <section className="administration-section administration-ai-settings" aria-label={ar ? "إعداد بصيرة" : "Basira settings"}>
    <header className="administration-section-heading"><div><p className="eyebrow">Baseer / Basira</p><h3>{ar ? "إعداد تفسير التنبيهات" : "Alert-explanation setup"}</h3><p>{ar ? "يُخزّن المفتاح مشفراً في الخادم ولا يظهر مرة أخرى. لا يفعّل التفسير وحده؛ يحتاج الخادم إلى مفتاح تشغيل Pilot." : "The key is encrypted on the server and never displayed again. Saving it alone does not enable explanations; the API deployment still needs the pilot switch."}</p></div></header>
    {loadError ? <p className="daily-sales-message error" role="status">{ar ? "تعذر قراءة الإعداد الحالي، لكن يمكنك حفظ إعداد جديد إذا كنت مالك النظام." : "The current configuration could not be read. As the system owner, you can still save a new configuration."}</p> : null}
    <BaseerCard tone="muted"><dl className="administration-ai-settings__status"><div><dt>{ar ? "الحالة الحالية" : "Current status"}</dt><dd>{provider ? (ar ? "مزود محفوظ" : "Provider configured") : (ar ? "لا يوجد مزود محفوظ" : "No provider configured")}</dd></div><div className={`administration-ai-connection is-${connection?.state?.toLowerCase() ?? "checking"}`}><dt>{ar ? "اتصال بصيرة" : "Basira connection"}</dt><dd><span className="administration-ai-connection__dot" aria-hidden="true" />{connectionText}</dd>{connectionReason ? <small>{connectionReason}</small> : null}{connection?.checkedAt ? <small>{ar ? "آخر تحقق: " : "Checked: "}{new Date(connection.checkedAt).toLocaleTimeString(ar ? "ar-SA" : "en", { timeZone: "Asia/Riyadh" })}</small> : null}{owner && provider ? <button type="button" className="baseer-button baseer-button--quiet" disabled={connectionBusy} onClick={() => void checkConnection()}>{ar ? "إعادة الفحص" : "Check again"}</button> : null}</div>{provider ? <><div><dt>{ar ? "الموديل" : "Model"}</dt><dd dir="ltr">{provider.model}</dd></div><div><dt>{ar ? "الحد اليومي" : "Daily limit"}</dt><dd>{provider.dailyRequestLimit}</dd></div><div><dt>{ar ? "الإصدار" : "Version"}</dt><dd>{provider.configurationVersion}</dd></div></> : null}</dl></BaseerCard>
    {configuration?.providerConfigurations.length ? <BaseerCard tone="muted"><section className="administration-ai-profile-switcher" aria-label={ar ? "ملفات الذكاء" : "AI profiles"}><header><h4>{ar ? "محوّل الذكاء" : "AI switcher"}</h4><p>{ar ? "اختر ملفاً محفوظاً ومتحققاً منه. لا يرسل التبديل أي بيانات من بصيرة إلى المزود." : "Choose a saved, verified profile. Switching does not send Basira data to the provider."}</p></header><div className="administration-ai-profile-switcher__list">{configuration.providerConfigurations.map((item) => <article key={item.id} className={item.isDefault ? "is-active" : undefined}><div><strong>{providerLabel(item.provider)}</strong><span dir="ltr">{item.model}</span><small>{ar ? `الحد اليومي: ${item.dailyRequestLimit}` : `Daily limit: ${item.dailyRequestLimit}`}</small></div>{item.isDefault ? <span className="administration-ai-profile-switcher__active">{ar ? "النشط الآن" : "Active now"}</span> : <button type="button" className="baseer-button baseer-button--quiet" disabled={!owner || activatingId !== null} onClick={() => void activateProfile(item.id)}>{activatingId === item.id ? (ar ? "جارٍ التبديل…" : "Switching…") : (ar ? "تفعيل هذا الملف" : "Use this profile")}</button>}</article>)}</div><small>{ar ? "سيظهر Anthropic وGoogle هنا فقط بعد إضافة محولات خادمية آمنة ومفاتيحهما؛ لا يمكن تفعيلهما بشكل وهمي." : "Anthropic and Google will appear here only after secure server adapters and credentials are added; they cannot be activated deceptively."}</small></section></BaseerCard> : null}
    {owner ? <BaseerValidatedFormField<FormValues> id="administration-ai-provider" className="administration-ai-settings__form" values={values} schemaFactory={schemaFactory} onValid={(next) => void submit(next)} errorSummaryLabel={ar ? "تحقق من الحقول المطلوبة." : "Check the required fields."}>{({ errors }) => <>
      <label>{ar ? "المزود" : "Provider"}<input value="OpenAI" disabled readOnly /></label>
      <label>{ar ? "مفتاح OpenAI" : "OpenAI API key"}<input type="password" autoComplete="new-password" value={values.apiKey} aria-invalid={Boolean(errors.apiKey)} aria-describedby={errors.apiKey ? "administration-ai-key-error" : undefined} onChange={(event) => setValues((current) => ({ ...current, apiKey: event.target.value }))} />{errors.apiKey ? <small id="administration-ai-key-error" role="alert">{errors.apiKey.message}</small> : <small>{ar ? "لن يظهر هذا المفتاح بعد الحفظ." : "This key is never displayed after saving."}</small>}</label>
      <label>{ar ? "الموديل" : "Model"}<input value={values.model} aria-invalid={Boolean(errors.model)} onChange={(event) => setValues((current) => ({ ...current, model: event.target.value }))} />{errors.model ? <small role="alert">{errors.model.message}</small> : null}</label>
      <label>{ar ? "حد التفسيرات اليومي" : "Daily explanation limit"}<input inputMode="numeric" value={values.dailyRequestLimit} aria-invalid={Boolean(errors.dailyRequestLimit)} onChange={(event) => setValues((current) => ({ ...current, dailyRequestLimit: event.target.value }))} />{errors.dailyRequestLimit ? <small role="alert">{errors.dailyRequestLimit.message}</small> : <small>{ar ? "ابدأ بـ10 للتجربة." : "Start with 10 for the pilot."}</small>}</label>
      {error ? <p className="daily-sales-message error" role="alert">{error}</p> : null}{message ? <p className="daily-sales-message success" role="status">{message}</p> : null}
      <footer><button className="daily-sales-primary" disabled={busy}>{busy ? (ar ? "جارٍ الحفظ…" : "Saving…") : (provider ? (ar ? "تحديث إعداد OpenAI" : "Update OpenAI configuration") : (ar ? "حفظ إعداد OpenAI" : "Save OpenAI configuration"))}</button></footer>
    </>}</BaseerValidatedFormField> : <p className="daily-sales-message error">{ar ? "هذه الصفحة للمالك فقط." : "Only the system owner can configure Basira."}</p>}
  </section>;
}

function providerLabel(provider: ProviderReceipt["provider"]) {
  if (provider === "OPENAI_COMPATIBLE") return "OpenAI";
  if (provider === "ANTHROPIC") return "Anthropic";
  return "Google Gemini";
}

function connectionReasonText(reason: NonNullable<ProviderConnection["reason"]>, language: Language) {
  const ar = language === "ar";
  return {
    PROVIDER_NOT_CONFIGURED: ar ? "احفظ إعداد مزود أولاً." : "Save a provider configuration first.",
    CREDENTIAL_DECRYPTION_FAILED: ar ? "المفتاح المحفوظ لا يطابق مفتاح تشفير الخادم الحالي؛ أعد حفظ إعداد OpenAI." : "The saved key does not match this server encryption key; save the OpenAI configuration again.",
    CREDENTIAL_REJECTED: ar ? "رفض OpenAI مفتاح API؛ تحقق من المفتاح والمشروع." : "OpenAI rejected the API key; verify the key and project.",
    MODEL_UNAVAILABLE: ar ? "النموذج المختار غير متاح لهذا المفتاح." : "The selected model is unavailable to this API key.",
    PROVIDER_RATE_LIMITED: ar ? "OpenAI حدّ الطلبات مؤقتاً؛ أعد الفحص لاحقاً." : "OpenAI temporarily rate-limited the request; try again later.",
    PROVIDER_UNREACHABLE: ar ? "تعذر الوصول إلى OpenAI من الخادم." : "The server could not reach OpenAI.",
    PROVIDER_UNAVAILABLE: ar ? "تعذر التحقق من المزود حالياً." : "The provider could not be verified right now.",
  }[reason];
}
