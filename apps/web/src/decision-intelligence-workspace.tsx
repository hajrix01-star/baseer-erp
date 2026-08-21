import { useCallback, useEffect, useMemo, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerPeriodFilter, defaultBaseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import { BaseerStatusBadge, type BaseerStatusTone } from "./baseer-status-badge";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { presentBaseerApiError } from "./baseer-api-error";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { hasActivePermission } from "./module-access";
import { formatMoney, formatNumber } from "./number-format";

type Language = "ar" | "en";
type Quality = "READY" | "NO_DATA" | "INCOMPLETE" | "STALE" | "UNAVAILABLE" | "CONFLICTED";
type SalesMetric = {
  metricDefinitionVersion: string;
  dataQuality: Quality;
  period: { fromBusinessDate: string; toBusinessDate: string; timezone: "Asia/Riyadh"; timeGrain: "DAY" | "MONTH" | "PERIOD" };
  sourceFreshAt: string | null;
  coverage: { requiredDays: number; availableDays: number; missingDays: string[]; excludedDays: Array<{ date: string; reason: string }> };
  payload: { currencyCode: "SAR"; netAmount: string; grossAmount: string; vatAmount: string; customerCount: number };
};
type SalesComparison = {
  metricDefinitionVersion: "finance.sales.net.period_comparison.v1" | "finance.sales.net.weekday_comparison.v1";
  comparisonPolicyCode: "PREVIOUS_EQUAL_PERIOD" | "MATCHED_WEEKDAYS";
  comparisonPolicyVersion: "previous_equal_period.v1" | "matched_weekdays.v1";
  dataQuality: Quality;
  current: SalesMetric;
  comparison: SalesMetric;
  payload: { currencyCode: "SAR"; currentNetAmount: string; comparisonNetAmount: string; differenceNetAmount: string; percentDifference: string | null; currentCustomerCount: number; comparisonCustomerCount: number };
};
type SalesChangePolicy = {
  enabled: boolean;
  comparisonPolicyCode: "PREVIOUS_EQUAL_PERIOD";
  comparisonPolicyVersion: "previous_equal_period.v1";
  decreaseThresholdBasisPoints: number | null;
  increaseThresholdBasisPoints: number | null;
  minimumBaselineAmount: string | null;
  minimumAbsoluteDifferenceAmount: string | null;
  cooldownHours: number | null;
  updatedAt: string | null;
};
type TimelineEvent = { id: string; scope: "GLOBAL" | "AREA" | "COMPANY"; eventKind: string; titleAr: string; startsOn: string; endsOn: string; verificationStatus: string; sourceReference: string | null; locationLabelAr: string | null };
type Alert = { id: string; ruleCode: string; ruleVersion: string; status: "OPEN" | "ACKNOWLEDGED" | "CLOSED"; titleAr: string; createdAt: string; acknowledgedAt: string | null; closedAt: string | null; evidenceSnapshotId: string | null };
type AlertEvidence = {
  alert: Alert;
  snapshot: { id: string; evidenceKind: string; verificationStatus: string; periodFrom: string; periodTo: string; timezone: string; checksum: string; checksumValid: boolean; createdAt: string; supersedesSnapshotId: string | null; payload: unknown };
  actions: Array<{ action: "ACKNOWLEDGED" | "CLOSED"; reason: string; createdAt: string }>;
};
type ContextCandidate = { id: string; eventKind: string; titleAr: string; startsOn: string; endsOn: string; scope: "TENANT_GLOBAL" | "AREA"; locationCode: string | null; locationLabelAr: string | null; relevanceReasonAr: string | null; status: "PENDING_REVIEW" | "APPROVED" | "DISMISSED" | "DUPLICATE"; sourceUpdatedAt: string | null; createdAt: string; source: { sourceCode: string; displayNameAr: string; sourceUrl: string } };
type ContextReview = { id: string; eventKind: string; scope: "TENANT_GLOBAL" | "AREA"; locationLabelAr: string | null; currentRevision: number; source: { sourceCode: string; displayNameAr: string }; revisions: Array<{ revision: number; titleAr: string; startsOn: string; endsOn: string; sourceUpdatedAt: string | null; sourceChecksum: string }> };
type ContextSourceHealth = { category: "PUBLIC_CONTEXT" | "RESEARCH"; sourceCode: string; displayNameAr: string; sourceUrl: string; scheduleCode: string; readiness: "NOT_REGISTERED" | "DISABLED" | "REQUIRES_APPROVED_ADAPTER" | "NOT_CONFIGURED" | "READY_TO_SYNC"; readinessReason: string; lastRun: { status: string; startedAt: string; finishedAt: string | null } | null };

const qualityCopy: Record<Language, Record<Quality, string>> = {
  ar: { READY: "جاهزة", NO_DATA: "لا توجد بيانات", INCOMPLETE: "غير مكتملة", STALE: "قديمة", UNAVAILABLE: "غير متاحة", CONFLICTED: "متعارضة" },
  en: { READY: "Ready", NO_DATA: "No data", INCOMPLETE: "Incomplete", STALE: "Stale", UNAVAILABLE: "Unavailable", CONFLICTED: "Conflicted" },
};
const qualityTone: Record<Quality, BaseerStatusTone> = { READY: "success", NO_DATA: "neutral", INCOMPLETE: "warning", STALE: "warning", UNAVAILABLE: "danger", CONFLICTED: "danger" };
const comparisonDirectionCopy: Record<Language, Record<"INCREASE" | "DECREASE" | "UNCHANGED", string>> = {
  ar: { INCREASE: "ارتفاع", DECREASE: "انخفاض", UNCHANGED: "لا تغير" },
  en: { INCREASE: "Increase", DECREASE: "Decrease", UNCHANGED: "No change" },
};
const alertStatusCopy: Record<Language, Record<Alert["status"], string>> = {
  ar: { OPEN: "مفتوح", ACKNOWLEDGED: "مُقَر", CLOSED: "مغلق" },
  en: { OPEN: "Open", ACKNOWLEDGED: "Acknowledged", CLOSED: "Closed" },
};
const salesChangePolicyCopy: Record<Language, Record<"title" | "description" | "enabled" | "decrease" | "increase" | "baseline" | "difference" | "cooldown" | "percent" | "hours" | "save" | "run" | "disabled" | "active", string>> = {
  ar: { title: "سياسة تنبيه تغير المبيعات", description: "لا يعمل التنبيه إلا بعد اعتماد النسب، الحد الأدنى للمبيعات، فرق المبلغ، وفترة التهدئة لهذه الشركة. المقارنة الحالية بالفترة السابقة المساوية ولا تثبت السبب.", enabled: "تفعيل التنبيه لهذه الشركة", decrease: "تنبيه عند انخفاض قدره", increase: "تنبيه عند ارتفاع قدره", baseline: "الحد الأدنى لمبيعات فترة المقارنة (ر.س)", difference: "الحد الأدنى للفرق النقدي (ر.س)", cooldown: "فترة تهدئة التنبيه", percent: "٪", hours: "ساعة", save: "حفظ السياسة", run: "تشغيل فحص التغير", disabled: "السياسة معطلة؛ لا ينشأ تنبيه تجاري.", active: "السياسة مفعلة بعد اعتمادك الصريح." },
  en: { title: "Sales-change alert policy", description: "The alert runs only after this company approves its percentages, baseline, cash difference and cooldown. The current equal-period comparison does not prove cause.", enabled: "Enable this company policy", decrease: "Alert for a decrease of", increase: "Alert for an increase of", baseline: "Minimum comparison-period sales (SAR)", difference: "Minimum cash difference (SAR)", cooldown: "Alert cooldown", percent: "%", hours: "hours", save: "Save policy", run: "Run change check", disabled: "The policy is disabled; no commercial alert is generated.", active: "The policy is active after your explicit approval." },
};

export function DecisionIntelligenceWorkspace({ language, section }: { language: Language; section: number }) {
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [period, setPeriod] = useState<BaseerPeriodRange>(defaultBaseerPeriodRange);
  const [metric, setMetric] = useState<SalesMetric | null>(null);
  const [comparison, setComparison] = useState<SalesComparison | null>(null);
  const [matchedWeekdayComparison, setMatchedWeekdayComparison] = useState<SalesComparison | null>(null);
  const [salesChangePolicy, setSalesChangePolicy] = useState<SalesChangePolicy | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [candidates, setCandidates] = useState<ContextCandidate[]>([]);
  const [reviews, setReviews] = useState<ContextReview[]>([]);
  const [sourceHealth, setSourceHealth] = useState<ContextSourceHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [eventBusy, setEventBusy] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventArchive, setEventArchive] = useState<TimelineEvent | null>(null);
  const [eventArchiveReason, setEventArchiveReason] = useState("");
  const [eventArchiveBusy, setEventArchiveBusy] = useState(false);
  const [eventArchiveError, setEventArchiveError] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<AlertEvidence | null>(null);
  const [evidenceBusy, setEvidenceBusy] = useState(false);
  const [alertAction, setAlertAction] = useState<{ alert: Alert; status: "ACKNOWLEDGED" | "CLOSED" } | null>(null);
  const [alertActionReason, setAlertActionReason] = useState("");
  const [alertActionBusy, setAlertActionBusy] = useState(false);
  const [alertActionError, setAlertActionError] = useState<string | null>(null);
  const [researchBusy, setResearchBusy] = useState(false);
  const [eventForm, setEventForm] = useState({ eventKind: "OPERATIONAL_EVENT", titleAr: "", startsOn: period.from, endsOn: period.to, sourceReference: "" });
  const canReadMetrics = hasActivePermission("decision.metrics.read");
  const canReadContext = hasActivePermission("decision.context.read");
  const canReadAlerts = hasActivePermission("decision.alerts.read");
  const canManageAlerts = hasActivePermission("decision.alerts.manage");
  const canManageCompanyContext = hasActivePermission("decision.context.company.manage");
  const canGiveFeedback = hasActivePermission("decision.feedback.write");
  const canManagePolicies = hasActivePermission("decision.policy.manage");
  const canManageGlobalContext = hasActivePermission("decision.context.global.manage");

  const load = useCallback(async () => {
    const current = activeSession();
    setSession(current);
    if (!current) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ from: period.from, to: period.to }).toString();
      const reads = await Promise.all([
        canReadMetrics ? api<SalesMetric>(current, `/decision-intelligence/metrics/sales-daily?${query}`) : Promise.resolve(null),
        canReadMetrics ? api<SalesComparison>(current, `/decision-intelligence/metrics/sales-comparison?${query}`) : Promise.resolve(null),
        canReadMetrics && period.from === period.to ? api<SalesComparison>(current, `/decision-intelligence/metrics/sales-matched-weekday?date=${encodeURIComponent(period.from)}`) : Promise.resolve(null),
        canReadContext ? api<TimelineEvent[]>(current, `/decision-intelligence/context/timeline?${query}`) : Promise.resolve([]),
        canReadAlerts ? api<Alert[]>(current, "/decision-intelligence/alerts?pageSize=50") : Promise.resolve([]),
        canManageGlobalContext ? api<ContextCandidate[]>(current, "/decision-intelligence/context/research/candidates?status=PENDING_REVIEW") : Promise.resolve([]),
        canManagePolicies ? api<SalesChangePolicy>(current, "/decision-intelligence/policies/sales-change") : Promise.resolve(null),
        canManageGlobalContext ? api<ContextReview[]>(current, "/decision-intelligence/context/reviews") : Promise.resolve([]),
        canManageGlobalContext ? api<ContextSourceHealth[]>(current, "/decision-intelligence/context/sources/health") : Promise.resolve([]),
      ]);
      setMetric(reads[0]);
      setComparison(reads[1]);
      setMatchedWeekdayComparison(reads[2]);
      setEvents(reads[3]);
      setAlerts(reads[4]);
      setCandidates(reads[5]);
      setSalesChangePolicy(reads[6]);
      setReviews(reads[7]);
      setSourceHealth(reads[8]);
      setError("");
    } catch (reason) {
      setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر تحميل قراءات مركز القرار. أعد المحاولة." : "Decision reads could not be loaded. Please try again."));
    } finally {
      setLoading(false);
    }
  }, [canManageGlobalContext, canManagePolicies, canReadAlerts, canReadContext, canReadMetrics, language, period.from, period.to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setEventForm((current) => ({ ...current, startsOn: period.from, endsOn: period.to })); }, [period.from, period.to]);
  const openAlerts = alerts.filter((alert) => alert.status === "OPEN");
  const companyEvents = events.filter((event) => event.scope === "COMPANY");
  const globalEvents = events.filter((event) => event.scope === "GLOBAL" || event.scope === "AREA");
  const sectionContent = useMemo(() => {
    if (section === 1) return <TimelinePanel language={language} events={events} companyEvents={companyEvents} globalEvents={globalEvents} canManage={canManageCompanyContext} onCreate={() => setEventDialogOpen(true)} onArchive={(event) => { setEventArchive(event); setEventArchiveReason(""); setEventArchiveError(null); }} />;
    if (section === 2) return <AlertsPanel language={language} alerts={alerts} canGiveFeedback={canGiveFeedback} canManage={canManageAlerts} onViewEvidence={async (alertId) => {
      const current = activeSession(); if (!current) return;
      setEvidenceBusy(true);
      try { setEvidence(await api<AlertEvidence>(current, `/decision-intelligence/alerts/${alertId}/evidence`)); } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر تحميل حزمة الأدلة." : "Evidence could not be loaded.")); } finally { setEvidenceBusy(false); }
    }} onChangeStatus={(alert, status) => { setAlertAction({ alert, status }); setAlertActionReason(""); setAlertActionError(null); }} onFeedback={async (alertId, kind) => {
      const current = activeSession(); if (!current) return;
      try { await api(current, "/decision-intelligence/alerts/feedback", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": requestId() }, body: JSON.stringify({ alertId, kind, idempotencyKey: requestId() }) }); await load(); } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر حفظ التغذية الراجعة." : "Feedback could not be saved.")); }
    }} />;
    if (section === 3) return <><QualityPanel language={language} metric={metric} canManagePolicies={canManagePolicies} onEvaluate={async () => {
      const current = activeSession(); if (!current) return;
      try { await api(current, "/decision-intelligence/evaluations/sales-quality", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": requestId() }, body: JSON.stringify({ from: period.from, to: period.to, idempotencyKey: requestId() }) }); await load(); } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر تشغيل فحص الجودة." : "The quality check could not be run.")); }
    }} />{canManagePolicies && <SalesChangePolicyCard language={language} policy={salesChangePolicy} onEvaluate={async () => {
      const current = activeSession(); if (!current) return;
      try { await api(current, "/decision-intelligence/evaluations/sales-change", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": requestId() }, body: JSON.stringify({ from: period.from, to: period.to, idempotencyKey: requestId() }) }); await load(); } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر تشغيل فحص تغير المبيعات." : "The sales-change check could not be run.")); }
    }} onSavePolicy={async (policy) => {
      const current = activeSession(); if (!current) return;
      try { await api(current, "/decision-intelligence/policies/sales-change", { method: "PUT", headers: { "Content-Type": "application/json", "X-Idempotency-Key": requestId() }, body: JSON.stringify({ ...policy, idempotencyKey: requestId() }) }); await load(); } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر حفظ سياسة التنبيه." : "The alert policy could not be saved.")); throw reason; }
    }} />}</>;
    if (section === 4) return <SourcesPolicyPanel language={language} candidates={candidates} reviews={reviews} sourceHealth={sourceHealth} canManage={canManageGlobalContext} researchBusy={researchBusy} onResearch={async () => {
      const current = activeSession(); if (!current) return;
      setResearchBusy(true);
      try {
        await api(current, "/decision-intelligence/context/research/sources/bootstrap", { method: "POST" });
        await Promise.all(["SA_NCM_WEATHER_FORECAST", "SA_SPL_FIXTURES"].map((sourceCode) => api(current, `/decision-intelligence/context/research/sources/${sourceCode}/sync`, { method: "POST" })));
        await load();
      } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر تشغيل باحث السياق." : "The context researcher could not run.")); } finally { setResearchBusy(false); }
    }} onResolve={async (candidateId, action) => {
      const current = activeSession(); if (!current) return;
      setResearchBusy(true);
      try {
        await api(current, "/decision-intelligence/context/research/candidates/resolve", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": requestId() }, body: JSON.stringify({ candidateId, action, idempotencyKey: requestId() }) });
        await load();
      } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر اعتماد المرشح أو تجاهله." : "The context candidate could not be resolved.")); } finally { setResearchBusy(false); }
    }} onResolveReview={async (eventId, revision, action) => {
      const current = activeSession(); if (!current) return;
      setResearchBusy(true);
      try {
        await api(current, "/decision-intelligence/context/reviews/resolve", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": requestId() }, body: JSON.stringify({ eventId, revision, action, reason: action === "APPROVE" ? "اعتماد مراجعة المصدر الرسمية" : "رفض مراجعة المصدر الرسمية", idempotencyKey: requestId() }) });
        await load();
      } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر اعتماد أو رفض مراجعة المصدر." : "The source review could not be resolved.")); } finally { setResearchBusy(false); }
    }} />;
    return <OverviewPanel language={language} metric={metric} comparison={comparison} matchedWeekdayComparison={matchedWeekdayComparison} events={events} openAlerts={openAlerts} />;
  }, [alerts, candidates, canGiveFeedback, canManageAlerts, canManageCompanyContext, canManageGlobalContext, canManagePolicies, companyEvents, comparison, events, globalEvents, language, load, matchedWeekdayComparison, metric, openAlerts, period.from, period.to, researchBusy, reviews, salesChangePolicy, section, sourceHealth]);

  async function createEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = activeSession(); if (!current) return;
    setEventBusy(true); setEventError(null);
    try {
      await api(current, "/decision-intelligence/context/company-events", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": requestId() }, body: JSON.stringify({ ...eventForm, sourceReference: eventForm.sourceReference.trim() || undefined, idempotencyKey: requestId() }) });
      setEventDialogOpen(false); setEventForm({ eventKind: "OPERATIONAL_EVENT", titleAr: "", startsOn: period.from, endsOn: period.to, sourceReference: "" }); await load();
    } catch (reason) { setEventError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر حفظ الحدث." : "The event could not be saved.")); } finally { setEventBusy(false); }
  }

  async function submitAlertAction(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!alertAction) return;
    const current = activeSession(); if (!current) return;
    setAlertActionBusy(true); setAlertActionError(null);
    try {
      await api(current, `/decision-intelligence/alerts/${alertAction.alert.id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": requestId() },
        body: JSON.stringify({ status: alertAction.status, reason: alertActionReason, idempotencyKey: requestId() }),
      });
      setAlertAction(null); await load();
    } catch (reason) { setAlertActionError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر تحديث حالة التنبيه." : "The alert status could not be updated.")); } finally { setAlertActionBusy(false); }
  }

  async function submitEventArchive(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!eventArchive) return;
    const current = activeSession(); if (!current) return;
    setEventArchiveBusy(true); setEventArchiveError(null);
    try {
      await api(current, `/decision-intelligence/context/company-events/${eventArchive.id}/archive`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": requestId() },
        body: JSON.stringify({ reason: eventArchiveReason, idempotencyKey: requestId() }),
      });
      setEventArchive(null); await load();
    } catch (reason) { setEventArchiveError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر سحب الحدث." : "The event could not be withdrawn.")); } finally { setEventArchiveBusy(false); }
  }

  if (!session) return <DailySalesSignIn language={language} />;
  return <section className="baseer-workspace decision-workspace" aria-busy={loading}>
    <header className="baseer-section-header">
      <div className="baseer-section-header__copy"><p className="baseer-section-header__eyebrow">Decision Intelligence &amp; Context</p><h2>{language === "ar" ? "قراءات موثقة قبل أي تفسير" : "Evidence before interpretation"}</h2><p>{language === "ar" ? "يجمع المركز حقائق النظام والسياق الزمني. لا يعدّل المبيعات أو الحملات، ولا يثبت السببية من التزامن وحده." : "The center joins official facts with time context. It never changes sales or campaigns, and temporal association is not causation."}</p></div>
      <div className="baseer-section-header__actions"><BaseerPeriodFilter language={language} value={period} onChange={setPeriod} /><BaseerButton type="button" variant="secondary" onClick={() => void load()}>{language === "ar" ? "تحديث" : "Refresh"}</BaseerButton></div>
    </header>
    {error ? <p className="daily-sales-message error" role="alert">{error}</p> : null}
    {sectionContent}
    <BaseerFormDialog open={eventDialogOpen} title={language === "ar" ? "إضافة حدث للشركة" : "Add company event"} language={language} formId="decision-company-event" submitLabel={language === "ar" ? "حفظ الحدث" : "Save event"} busy={eventBusy} error={eventError} onClose={() => !eventBusy && setEventDialogOpen(false)}>
      <form id="decision-company-event" className="decision-event-form" onSubmit={(event) => void createEvent(event)}>
        <label>{language === "ar" ? "نوع الحدث" : "Event kind"}<select value={eventForm.eventKind} onChange={(event) => setEventForm((value) => ({ ...value, eventKind: event.target.value }))}><option value="OPERATIONAL_EVENT">{language === "ar" ? "حدث تشغيلي" : "Operational event"}</option><option value="CLOSURE">{language === "ar" ? "إغلاق" : "Closure"}</option><option value="STOCK_SHORTAGE">{language === "ar" ? "نقص مخزون" : "Stock shortage"}</option><option value="HOURS_CHANGE">{language === "ar" ? "تغيير ساعات" : "Hours change"}</option><option value="PROMOTION">{language === "ar" ? "عرض أو مبادرة" : "Promotion"}</option></select></label>
        <label>{language === "ar" ? "العنوان" : "Title"}<input required minLength={2} maxLength={240} value={eventForm.titleAr} onChange={(event) => setEventForm((value) => ({ ...value, titleAr: event.target.value }))} /></label>
        <div className="decision-event-form__dates"><label>{language === "ar" ? "من" : "From"}<input required type="date" value={eventForm.startsOn} onChange={(event) => setEventForm((value) => ({ ...value, startsOn: event.target.value }))} /></label><label>{language === "ar" ? "إلى" : "To"}<input required min={eventForm.startsOn} type="date" value={eventForm.endsOn} onChange={(event) => setEventForm((value) => ({ ...value, endsOn: event.target.value }))} /></label></div>
        <label>{language === "ar" ? "مرجع أو ملاحظة المصدر (اختياري)" : "Source reference (optional)"}<input maxLength={500} value={eventForm.sourceReference} onChange={(event) => setEventForm((value) => ({ ...value, sourceReference: event.target.value }))} /></label>
      </form>
    </BaseerFormDialog>
    <BaseerFormDialog open={evidence !== null || evidenceBusy} title={language === "ar" ? "حزمة أدلة التنبيه" : "Alert evidence package"} language={language} formId="decision-alert-evidence" submitLabel={language === "ar" ? "إغلاق" : "Close"} busy={evidenceBusy} onClose={() => !evidenceBusy && setEvidence(null)}>
      <form id="decision-alert-evidence" className="decision-evidence" onSubmit={(event) => { event.preventDefault(); setEvidence(null); }}>
        {evidence ? <EvidenceDetails language={language} evidence={evidence} /> : <p>{language === "ar" ? "جارٍ تحميل الأدلة…" : "Loading evidence…"}</p>}
      </form>
    </BaseerFormDialog>
    <BaseerFormDialog open={alertAction !== null} title={alertAction?.status === "CLOSED" ? (language === "ar" ? "إغلاق التنبيه" : "Close alert") : (language === "ar" ? "إقرار التنبيه" : "Acknowledge alert")} language={language} formId="decision-alert-action" submitLabel={alertAction?.status === "CLOSED" ? (language === "ar" ? "تأكيد الإغلاق" : "Confirm close") : (language === "ar" ? "تأكيد الإقرار" : "Confirm acknowledgement")} busy={alertActionBusy} error={alertActionError} onClose={() => !alertActionBusy && setAlertAction(null)}>
      <form id="decision-alert-action" className="decision-event-form" onSubmit={(event) => void submitAlertAction(event)}>
        <p>{language === "ar" ? "هذا إجراء تشغيلي منفصل عن التغذية الراجعة. اكتب سبباً مختصراً للمراجعة اللاحقة." : "This operational action is separate from feedback. Add a brief reason for later review."}</p>
        <label>{language === "ar" ? "السبب" : "Reason"}<textarea required minLength={3} maxLength={500} value={alertActionReason} onChange={(event) => setAlertActionReason(event.target.value)} /></label>
      </form>
    </BaseerFormDialog>
    <BaseerFormDialog open={eventArchive !== null} title={language === "ar" ? "سحب حدث الشركة" : "Withdraw company event"} language={language} formId="decision-company-event-archive" submitLabel={language === "ar" ? "تأكيد السحب" : "Confirm withdrawal"} busy={eventArchiveBusy} error={eventArchiveError} onClose={() => !eventArchiveBusy && setEventArchive(null)}>
      <form id="decision-company-event-archive" className="decision-event-form" onSubmit={(event) => void submitEventArchive(event)}>
        <p>{language === "ar" ? `سيُسحب الحدث «${eventArchive?.titleAr ?? ""}» من خط الزمن ولا تُحذف سجلاته.` : `“${eventArchive?.titleAr ?? ""}” will be withdrawn from the timeline; its records are not deleted.`}</p>
        <label>{language === "ar" ? "سبب السحب" : "Withdrawal reason"}<textarea required minLength={3} maxLength={500} value={eventArchiveReason} onChange={(event) => setEventArchiveReason(event.target.value)} /></label>
      </form>
    </BaseerFormDialog>
  </section>;
}

function OverviewPanel({ language, metric, comparison, matchedWeekdayComparison, events, openAlerts }: { language: Language; metric: SalesMetric | null; comparison: SalesComparison | null; matchedWeekdayComparison: SalesComparison | null; events: TimelineEvent[]; openAlerts: Alert[] }) {
  return <div className="decision-workspace__stack">
    {metric ? <><BaseerSummaryMetricGrid ariaLabel={language === "ar" ? "ملخص الفترة" : "Period summary"}><BaseerSummaryMetric label={language === "ar" ? "صافي المبيعات المثبتة" : "Reconciled net sales"} value={formatMoney(metric.payload.netAmount)} /><BaseerSummaryMetric label={language === "ar" ? "عدد العملاء" : "Customer count"} value={formatNumber(metric.payload.customerCount)} /><BaseerSummaryMetric label={language === "ar" ? "تغطية الأيام" : "Day coverage"} value={`${metric.coverage.availableDays} / ${metric.coverage.requiredDays}`} /><BaseerSummaryMetric label={language === "ar" ? "جودة البيانات" : "Data quality"} value={<BaseerStatusBadge tone={qualityTone[metric.dataQuality]}>{qualityCopy[language][metric.dataQuality]}</BaseerStatusBadge>} /></BaseerSummaryMetricGrid>{metric.dataQuality !== "READY" && <BaseerCard className="decision-workspace__notice"><strong>{language === "ar" ? "لا تُفسّر هذه الفترة كتغير تجاري كامل." : "Do not interpret this period as a complete commercial change."}</strong><p>{language === "ar" ? `هناك ${metric.coverage.missingDays.length} يوم ناقص أو غير محسوم. تُعرض القيم المتاحة ولا تُحوّل الأيام الناقصة إلى صفر.` : `${metric.coverage.missingDays.length} days are missing or unsettled. Available values are shown; missing days are never zero-filled.`}</p></BaseerCard>}</> : <Empty language={language} message={language === "ar" ? "لا تملك صلاحية قراءة مؤشرات هذا المركز." : "You do not have access to the center metrics."} />}
    {comparison && <SalesComparisonCard language={language} comparison={comparison} />}
    {matchedWeekdayComparison && <SalesComparisonCard language={language} comparison={matchedWeekdayComparison} />}
    <div className="decision-workspace__columns"><BaseerCard><header className="decision-card__header"><div><h3>{language === "ar" ? "تنبيهات مفتوحة" : "Open alerts"}</h3><p>{language === "ar" ? "نتيجة قواعد موثقة، وليست استنتاج نموذج ذكاء." : "Results of documented rules, not model conclusions."}</p></div><BaseerStatusBadge tone={openAlerts.length ? "warning" : "success"}>{openAlerts.length}</BaseerStatusBadge></header>{openAlerts.length ? <ul className="decision-list">{openAlerts.slice(0, 4).map((alert) => <li key={alert.id}><strong>{alert.titleAr}</strong><small>{alert.createdAt.slice(0, 10)} · {alert.ruleVersion}</small></li>)}</ul> : <p className="decision-muted">{language === "ar" ? "لا توجد تنبيهات مفتوحة." : "No open alerts."}</p>}</BaseerCard><BaseerCard><header className="decision-card__header"><div><h3>{language === "ar" ? "السياق المتزامن" : "Concurrent context"}</h3><p>{language === "ar" ? "المناسبات والأحداث تساعد في المراجعة، ولا تثبت السبب." : "Events support review; they do not establish cause."}</p></div><BaseerStatusBadge tone="info">{events.length}</BaseerStatusBadge></header>{events.length ? <ul className="decision-list">{events.slice(0, 4).map((item) => <li key={item.id}><strong>{item.titleAr}</strong><small>{item.startsOn} — {item.endsOn} · {timelineScopeLabel(language, item.scope)}</small></li>)}</ul> : <p className="decision-muted">{language === "ar" ? "لا توجد أحداث مسجلة في الفترة." : "No events are recorded for this period."}</p>}</BaseerCard></div>
  </div>;
}

function SalesComparisonCard({ language, comparison }: { language: Language; comparison: SalesComparison }) {
  const ready = comparison.dataQuality === "READY";
  const directionKey = Number(comparison.payload.differenceNetAmount) > 0 ? "INCREASE" : Number(comparison.payload.differenceNetAmount) < 0 ? "DECREASE" : "UNCHANGED";
  const direction = comparisonDirectionCopy[language][directionKey];
  const weekday = comparison.comparisonPolicyCode === "MATCHED_WEEKDAYS";
  return <BaseerCard className="decision-workspace__notice decision-sales-comparison"><header className="decision-card__header"><div><h3>{weekday ? (language === "ar" ? "مقارنة اليوم نفسه من الأسبوع السابق" : "Same weekday, previous week") : (language === "ar" ? "مقارنة المبيعات بالفترة السابقة المماثلة" : "Sales compared with the previous equal period")}</h3><p>{weekday ? (language === "ar" ? "قراءة يومية فقط تقارن التاريخ المختار بالتاريخ نفسه قبل سبعة أيام. لا تثبت السبب." : "A daily-only read comparing the selected date with the same weekday seven days earlier. It does not prove cause.") : (language === "ar" ? "نفس عدد الأيام مباشرة قبل الفترة المحددة. هذه قراءة وصفية وليست إثباتاً للسبب." : "The same number of days immediately before the selected period. This is descriptive, not proof of cause.")}</p></div><BaseerStatusBadge tone={qualityTone[comparison.dataQuality]}>{qualityCopy[language][comparison.dataQuality]}</BaseerStatusBadge></header>{ready ? <BaseerSummaryMetricGrid ariaLabel={language === "ar" ? "مقارنة المبيعات" : "Sales comparison"}><BaseerSummaryMetric label={language === "ar" ? "الفترة الحالية" : "Current period"} value={formatMoney(comparison.payload.currentNetAmount)} /><BaseerSummaryMetric label={language === "ar" ? "الفترة السابقة" : "Previous period"} value={formatMoney(comparison.payload.comparisonNetAmount)} /><BaseerSummaryMetric label={language === "ar" ? `الفرق (${direction})` : `${direction} difference`} value={formatMoney(comparison.payload.differenceNetAmount)} /><BaseerSummaryMetric label={language === "ar" ? "نسبة التغير" : "Change rate"} value={comparison.payload.percentDifference === null ? "—" : `${comparison.payload.percentDifference}%`} /></BaseerSummaryMetricGrid> : <p>{language === "ar" ? "لا يصدر المركز حكماً عن التغير لأن إحدى الفترتين ناقصة أو غير متاحة. راجع جودة البيانات أولاً." : "The center does not judge the change because one period is incomplete or unavailable. Review data quality first."}</p>}</BaseerCard>;
}

function TimelinePanel({ language, events, companyEvents, globalEvents, canManage, onCreate, onArchive }: { language: Language; events: TimelineEvent[]; companyEvents: TimelineEvent[]; globalEvents: TimelineEvent[]; canManage: boolean; onCreate: () => void; onArchive: (event: TimelineEvent) => void }) {
  return <div className="decision-workspace__stack"><BaseerCard className="decision-timeline-intro"><div><h3>{language === "ar" ? "خط الزمن والسياق" : "Timeline and context"}</h3><p>{language === "ar" ? "تظهر أحداث المنطقة فقط للشركات التي حفظت رمز موقعها المطابق؛ أحداث الشركة لا تعدّل الحقيقة المالية ولا تتحول إلى سبب تلقائياً." : "Area events appear only to companies with a matching saved location code; company events never alter financial facts or become automatic causes."}</p></div>{canManage && <BaseerButton type="button" onClick={onCreate}>{language === "ar" ? "إضافة حدث للشركة" : "Add company event"}</BaseerButton>}</BaseerCard><BaseerSummaryMetricGrid><BaseerSummaryMetric label={language === "ar" ? "كل الأحداث" : "All events"} value={events.length} /><BaseerSummaryMetric label={language === "ar" ? "أحداث الشركة" : "Company events"} value={companyEvents.length} /><BaseerSummaryMetric label={language === "ar" ? "مناسبات عامة/منطقة" : "Public or area events"} value={globalEvents.length} /></BaseerSummaryMetricGrid>{events.length ? <ol className="decision-timeline">{events.map((item) => <li key={`${item.scope}-${item.id}`}><span className={`decision-timeline__scope is-${item.scope.toLowerCase()}`}>{timelineScopeLabel(language, item.scope)}</span><div><strong>{item.titleAr}</strong><small>{item.startsOn} — {item.endsOn} · {item.eventKind}{item.locationLabelAr ? ` · ${item.locationLabelAr}` : ""}</small></div><BaseerStatusBadge tone={item.verificationStatus === "SYSTEM_RECONCILED" ? "success" : "neutral"}>{item.verificationStatus === "SYSTEM_RECONCILED" ? (language === "ar" ? "موثق" : "Reconciled") : (language === "ar" ? "مسجل" : "Recorded")}</BaseerStatusBadge>{canManage && item.scope === "COMPANY" && <BaseerButton type="button" variant="quiet" onClick={() => onArchive(item)}>{language === "ar" ? "سحب" : "Withdraw"}</BaseerButton>}</li>)}</ol> : <Empty language={language} message={language === "ar" ? "لا توجد مناسبات أو أحداث ضمن الفترة المحددة." : "There are no events in the selected period."} />}</div>;
}

function timelineScopeLabel(language: Language, scope: TimelineEvent["scope"]) { if (scope === "GLOBAL") return language === "ar" ? "عام" : "Global"; if (scope === "AREA") return language === "ar" ? "منطقة" : "Area"; return language === "ar" ? "الشركة" : "Company"; }

function AlertsPanel({ language, alerts, canGiveFeedback, canManage, onFeedback, onViewEvidence, onChangeStatus }: { language: Language; alerts: Alert[]; canGiveFeedback: boolean; canManage: boolean; onFeedback: (alertId: string, kind: "USEFUL" | "DATA_INCOMPLETE") => Promise<void>; onViewEvidence: (alertId: string) => Promise<void>; onChangeStatus: (alert: Alert, status: "ACKNOWLEDGED" | "CLOSED") => void }) {
  const statusCopy = (status: Alert["status"]) => alertStatusCopy[language][status];
  return <div className="decision-workspace__stack"><BaseerCard className="decision-timeline-intro"><div><h3>{language === "ar" ? "تنبيهات قابلة للتدقيق" : "Auditable alerts"}</h3><p>{language === "ar" ? "كل تنبيه مرتبط بحزمة أدلة ثابتة عند إنشائه. التغذية الراجعة تحسن التقييمات ولا تدرب النظام تلقائياً." : "Every alert points to frozen evidence. Feedback improves evaluation; it never trains the system automatically."}</p></div></BaseerCard>{alerts.length ? <div className="decision-alert-grid">{alerts.map((alert) => <BaseerCard key={alert.id} className="decision-alert"><header><BaseerStatusBadge tone={alert.status === "OPEN" ? "warning" : "neutral"}>{statusCopy(alert.status)}</BaseerStatusBadge><small>{alert.createdAt.slice(0, 10)}</small></header><h3>{alert.titleAr}</h3><p>{alert.ruleCode} · {alert.ruleVersion}</p>{alert.evidenceSnapshotId && <small className="decision-alert__evidence">{language === "ar" ? "حزمة أدلة محفوظة" : "Evidence snapshot preserved"}</small>}<footer>{alert.evidenceSnapshotId && <BaseerButton type="button" variant="quiet" onClick={() => void onViewEvidence(alert.id)}>{language === "ar" ? "عرض الأدلة" : "View evidence"}</BaseerButton>}{canManage && alert.status === "OPEN" && <BaseerButton type="button" variant="quiet" onClick={() => onChangeStatus(alert, "ACKNOWLEDGED")}>{language === "ar" ? "إقرار" : "Acknowledge"}</BaseerButton>}{canManage && alert.status !== "CLOSED" && <BaseerButton type="button" variant="quiet" onClick={() => onChangeStatus(alert, "CLOSED")}>{language === "ar" ? "إغلاق" : "Close"}</BaseerButton>}{canGiveFeedback && <><BaseerButton type="button" variant="quiet" onClick={() => void onFeedback(alert.id, "USEFUL")}>{language === "ar" ? "مفيد" : "Useful"}</BaseerButton><BaseerButton type="button" variant="quiet" onClick={() => void onFeedback(alert.id, "DATA_INCOMPLETE")}>{language === "ar" ? "البيانات ناقصة" : "Data incomplete"}</BaseerButton></>}</footer></BaseerCard>)}</div> : <Empty language={language} message={language === "ar" ? "لا توجد تنبيهات محفوظة بعد." : "No alerts have been saved yet."} />}</div>;
}

function EvidenceDetails({ language, evidence }: { language: Language; evidence: AlertEvidence }) {
  const payload = evidence.snapshot.payload as { comparison?: SalesComparison; policy?: SalesChangePolicy; outcome?: string; coverage?: SalesMetric["coverage"] };
  const comparison = payload.comparison;
  return <div className="decision-evidence__content"><BaseerStatusBadge tone={evidence.snapshot.checksumValid ? "success" : "danger"}>{evidence.snapshot.checksumValid ? (language === "ar" ? "البصمة سليمة" : "Checksum valid") : (language === "ar" ? "فشل التحقق من البصمة" : "Checksum verification failed")}</BaseerStatusBadge><dl><div><dt>{language === "ar" ? "الفترة" : "Period"}</dt><dd>{evidence.snapshot.periodFrom} — {evidence.snapshot.periodTo}</dd></div><div><dt>{language === "ar" ? "نوع الدليل" : "Evidence kind"}</dt><dd>{evidence.snapshot.evidenceKind}</dd></div><div><dt>{language === "ar" ? "حالة التحقق" : "Verification"}</dt><dd>{evidence.snapshot.verificationStatus}</dd></div><div><dt>{language === "ar" ? "بصمة الدليل" : "Evidence checksum"}</dt><dd className="decision-evidence__checksum">{evidence.snapshot.checksum}</dd></div></dl>{comparison ? <BaseerSummaryMetricGrid ariaLabel={language === "ar" ? "أرقام حزمة الأدلة" : "Evidence figures"}><BaseerSummaryMetric label={language === "ar" ? "صافي الفترة الحالية" : "Current net sales"} value={formatMoney(comparison.payload.currentNetAmount)} /><BaseerSummaryMetric label={language === "ar" ? "صافي المقارنة" : "Comparison net sales"} value={formatMoney(comparison.payload.comparisonNetAmount)} /><BaseerSummaryMetric label={language === "ar" ? "الفرق" : "Difference"} value={formatMoney(comparison.payload.differenceNetAmount)} /><BaseerSummaryMetric label={language === "ar" ? "نسبة التغير" : "Change"} value={comparison.payload.percentDifference === null ? "—" : `${comparison.payload.percentDifference}%`} /></BaseerSummaryMetricGrid> : <p>{language === "ar" ? "تحمل هذه اللقطة حالة الجودة والمراجع المحفوظة عند إصدار التنبيه." : "This snapshot preserves quality and source references at alert creation."}</p>}{evidence.actions.length ? <div><h4>{language === "ar" ? "سجل المعالجة" : "Lifecycle"}</h4><ul className="decision-list">{evidence.actions.map((action, index) => <li key={`${action.createdAt}-${index}`}><strong>{action.action === "ACKNOWLEDGED" ? (language === "ar" ? "إقرار" : "Acknowledged") : (language === "ar" ? "إغلاق" : "Closed")}</strong><small>{action.reason} · {new Date(action.createdAt).toLocaleString(language === "ar" ? "ar-SA" : "en", { timeZone: "Asia/Riyadh" })}</small></li>)}</ul></div> : null}</div>;
}

function QualityPanel({ language, metric, canManagePolicies, onEvaluate }: { language: Language; metric: SalesMetric | null; canManagePolicies: boolean; onEvaluate: () => Promise<void> }) {
  if (!metric) return <Empty language={language} message={language === "ar" ? "لا تملك صلاحية عرض جودة البيانات." : "You do not have access to data quality."} />;
  return <div className="decision-workspace__stack"><BaseerCard className="decision-quality-card"><header className="decision-card__header"><div><h3>{language === "ar" ? "جودة قراءة المبيعات" : "Sales read quality"}</h3><p>{language === "ar" ? "المصدر هو الملخص المالي المتصالح مع القيود؛ لا تُقرأ أرقام من المتصفح." : "The source is the journal-reconciled financial summary; numbers are never read from the browser."}</p></div><BaseerStatusBadge tone={qualityTone[metric.dataQuality]}>{qualityCopy[language][metric.dataQuality]}</BaseerStatusBadge></header><dl><div><dt>{language === "ar" ? "الأيام المطلوبة" : "Required days"}</dt><dd>{metric.coverage.requiredDays}</dd></div><div><dt>{language === "ar" ? "الأيام المتاحة" : "Available days"}</dt><dd>{metric.coverage.availableDays}</dd></div><div><dt>{language === "ar" ? "الأيام الناقصة" : "Missing days"}</dt><dd>{metric.coverage.missingDays.length ? metric.coverage.missingDays.join("، ") : "—"}</dd></div><div><dt>{language === "ar" ? "آخر تسوية" : "Source freshness"}</dt><dd>{metric.sourceFreshAt ? new Date(metric.sourceFreshAt).toLocaleString(language === "ar" ? "ar-SA" : "en", { timeZone: "Asia/Riyadh" }) : "—"}</dd></div></dl>{canManagePolicies && <footer><BaseerButton type="button" onClick={() => void onEvaluate()}>{language === "ar" ? "تشغيل فحص الجودة" : "Run quality check"}</BaseerButton></footer>}</BaseerCard></div>;
}

function SalesChangePolicyCard({ language, policy, onSavePolicy, onEvaluate }: { language: Language; policy: SalesChangePolicy | null; onSavePolicy: (input: { enabled: boolean; decreaseThresholdBasisPoints: number | null; increaseThresholdBasisPoints: number | null; minimumBaselineAmount: string | null; minimumAbsoluteDifferenceAmount: string | null; cooldownHours: number | null }) => Promise<void>; onEvaluate: () => Promise<void> }) {
  const copy = salesChangePolicyCopy[language];
  const [enabled, setEnabled] = useState(policy?.enabled ?? false);
  const [decrease, setDecrease] = useState(String((policy?.decreaseThresholdBasisPoints ?? 1000) / 100));
  const [increase, setIncrease] = useState(String((policy?.increaseThresholdBasisPoints ?? 1000) / 100));
  const [baseline, setBaseline] = useState(policy?.minimumBaselineAmount ?? "");
  const [difference, setDifference] = useState(policy?.minimumAbsoluteDifferenceAmount ?? "");
  const [cooldownHours, setCooldownHours] = useState(policy?.cooldownHours === null || policy?.cooldownHours === undefined ? "" : String(policy.cooldownHours));
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setEnabled(policy?.enabled ?? false);
    setDecrease(String((policy?.decreaseThresholdBasisPoints ?? 1000) / 100));
    setIncrease(String((policy?.increaseThresholdBasisPoints ?? 1000) / 100));
    setBaseline(policy?.minimumBaselineAmount ?? "");
    setDifference(policy?.minimumAbsoluteDifferenceAmount ?? "");
    setCooldownHours(policy?.cooldownHours === null || policy?.cooldownHours === undefined ? "" : String(policy.cooldownHours));
  }, [policy]);
  const thresholds = { decreaseThresholdBasisPoints: Math.round(Number(decrease) * 100), increaseThresholdBasisPoints: Math.round(Number(increase) * 100) };
  const valid = Number.isInteger(thresholds.decreaseThresholdBasisPoints) && Number.isInteger(thresholds.increaseThresholdBasisPoints) && thresholds.decreaseThresholdBasisPoints >= 1 && thresholds.decreaseThresholdBasisPoints <= 10_000 && thresholds.increaseThresholdBasisPoints >= 1 && thresholds.increaseThresholdBasisPoints <= 10_000;
  const guardrailsValid = /^\d+(\.\d{1,4})?$/.test(baseline) && Number(baseline) > 0 && /^\d+(\.\d{1,4})?$/.test(difference) && Number(difference) > 0 && Number.isInteger(Number(cooldownHours)) && Number(cooldownHours) >= 1 && Number(cooldownHours) <= 720;
  const save = async () => {
    if (enabled && !valid) return;
    setBusy(true);
    try { await onSavePolicy({ enabled, decreaseThresholdBasisPoints: valid ? thresholds.decreaseThresholdBasisPoints : null, increaseThresholdBasisPoints: valid ? thresholds.increaseThresholdBasisPoints : null, minimumBaselineAmount: guardrailsValid ? baseline : null, minimumAbsoluteDifferenceAmount: guardrailsValid ? difference : null, cooldownHours: guardrailsValid ? Number(cooldownHours) : null }); } finally { setBusy(false); }
  };
  const evaluate = async () => { setBusy(true); try { await onEvaluate(); } finally { setBusy(false); } };
  return <BaseerCard className="decision-sales-policy"><header className="decision-card__header"><div><h3>{copy.title}</h3><p>{copy.description}</p></div><BaseerStatusBadge tone={enabled ? "success" : "neutral"}>{enabled ? copy.active : copy.disabled}</BaseerStatusBadge></header><label className="decision-sales-policy__toggle"><input checked={enabled} disabled={busy} type="checkbox" onChange={(event) => setEnabled(event.target.checked)} />{copy.enabled}</label><div className="decision-sales-policy__thresholds"><label>{copy.decrease}<span><input disabled={!enabled || busy} inputMode="decimal" max="100" min="0.01" step="0.01" type="number" value={decrease} onChange={(event) => setDecrease(event.target.value)} />{copy.percent}</span></label><label>{copy.increase}<span><input disabled={!enabled || busy} inputMode="decimal" max="100" min="0.01" step="0.01" type="number" value={increase} onChange={(event) => setIncrease(event.target.value)} />{copy.percent}</span></label><label>{copy.baseline}<input disabled={!enabled || busy} inputMode="decimal" min="0.0001" step="0.0001" type="number" value={baseline} onChange={(event) => setBaseline(event.target.value)} /></label><label>{copy.difference}<input disabled={!enabled || busy} inputMode="decimal" min="0.0001" step="0.0001" type="number" value={difference} onChange={(event) => setDifference(event.target.value)} /></label><label>{copy.cooldown}<span><input disabled={!enabled || busy} min="1" max="720" step="1" type="number" value={cooldownHours} onChange={(event) => setCooldownHours(event.target.value)} />{copy.hours}</span></label></div><footer><BaseerButton type="button" variant="secondary" disabled={busy || (enabled && (!valid || !guardrailsValid))} onClick={() => void save()}>{copy.save}</BaseerButton><BaseerButton type="button" disabled={busy || !enabled || !valid || !guardrailsValid} onClick={() => void evaluate()}>{copy.run}</BaseerButton></footer></BaseerCard>;
}

function SourcesPolicyPanel({ language, candidates, reviews, sourceHealth, canManage, researchBusy, onResearch, onResolve, onResolveReview }: { language: Language; candidates: ContextCandidate[]; reviews: ContextReview[]; sourceHealth: ContextSourceHealth[]; canManage: boolean; researchBusy: boolean; onResearch: () => Promise<void>; onResolve: (candidateId: string, action: "APPROVE" | "DISMISS") => Promise<void>; onResolveReview: (eventId: string, revision: number, action: "APPROVE" | "DISMISS") => Promise<void> }) {
  const readinessTone = (readiness: ContextSourceHealth["readiness"]): BaseerStatusTone => readiness === "READY_TO_SYNC" ? "success" : readiness === "NOT_CONFIGURED" || readiness === "REQUIRES_APPROVED_ADAPTER" ? "warning" : "neutral";
  const readinessCopy = (readiness: ContextSourceHealth["readiness"]) => language === "ar" ? ({ NOT_REGISTERED: "غير مسجل", DISABLED: "معطل", REQUIRES_APPROVED_ADAPTER: "يتطلب موصلاً معتمداً", NOT_CONFIGURED: "الموصل غير مهيأ", READY_TO_SYNC: "جاهز للفحص" }[readiness]) : ({ NOT_REGISTERED: "Not registered", DISABLED: "Disabled", REQUIRES_APPROVED_ADAPTER: "Approved adapter required", NOT_CONFIGURED: "Connector not configured", READY_TO_SYNC: "Ready to scan" }[readiness]);
  return <div className="decision-workspace__stack"><BaseerCard className="decision-policy"><h3>{language === "ar" ? "المصادر والسياسات المعتمدة" : "Approved sources and policies"}</h3><ul><li><strong>{language === "ar" ? "المالية" : "Finance"}</strong><span>{language === "ar" ? "قراءات خادمية متصالحة مع Journal." : "Server-side reads reconciled with the Journal."}</span></li><li><strong>{language === "ar" ? "السياق العام" : "Public context"}</strong><span>{language === "ar" ? "المستورد الدوري مقيد بمصادر حكومية مسجلة ووثائق أحداث قابلة للتحقق؛ الفشل أو التعارض يبقى للمراجعة ولا ينشر تكراراً." : "The scheduled importer accepts only registered government sources and verifiable event documents; failures and conflicts require review and never duplicate an event."}</span></li><li><strong>{language === "ar" ? "باحث السياق" : "Context researcher"}</strong><span>{language === "ar" ? "يفحص أسبوعياً موصلات الطقس والمباريات المعتمدة ويقترح مرشحات منفصلة. لا يبحث الويب المفتوح، ولا يضيف حدثاً إلى التحليل قبل الاعتماد." : "Weekly scans use approved weather and fixture connectors to propose separate candidates. It never searches the open web or adds an event before approval."}</span></li><li><strong>Google Ads</strong><span>{language === "ar" ? "قراءة وتحليل فقط عند اعتماد الموصل." : "Read and analysis only after connector approval."}</span></li><li><strong>Google Business Profile</strong><span>{language === "ar" ? "النشر اليدوي المؤكد فقط بعد اعتماد Google وسياسة الاحتفاظ." : "Confirmed manual publishing only after Google approval and retention policy."}</span></li><li><strong>{language === "ar" ? "بصيرة" : "Basira"}</strong><span>{language === "ar" ? "تفسّر الأدلة ولا تملك وصولاً حراً إلى الجداول أو صلاحية فعل خارجي." : "Explains evidence; it has no free database access or external action authority."}</span></li></ul></BaseerCard>{canManage ? <><BaseerCard className="decision-research"><header className="decision-card__header"><div><h3>{language === "ar" ? "صحة الموصلات والمصادر" : "Connector and source health"}</h3><p>{language === "ar" ? "حالة صريحة لكل مصدر؛ غياب المرشحات لا يعني غياب الأحداث، بل قد يعني أن الموصل غير مهيأ أو يحتاج مراجعة." : "Each source has an explicit state. No candidates does not prove there are no events; a connector can be unconfigured or require review."}</p></div></header>{sourceHealth.length ? <ol className="decision-timeline">{sourceHealth.map((source) => <li key={source.sourceCode}><span className={`decision-timeline__scope ${source.category === "RESEARCH" ? "is-company" : "is-global"}`}>{source.category === "RESEARCH" ? (language === "ar" ? "باحث" : "Research") : (language === "ar" ? "رسمي" : "Official")}</span><div><strong>{source.displayNameAr}</strong><small>{source.readinessReason}</small>{source.lastRun ? <small>{language === "ar" ? "آخر محاولة" : "Last attempt"}: {new Date(source.lastRun.startedAt).toLocaleString(language === "ar" ? "ar-SA" : "en", { timeZone: "Asia/Riyadh" })} · {source.lastRun.status}</small> : <small>{language === "ar" ? "لم تُسجل محاولة بعد." : "No attempt has been recorded yet."}</small>}</div><BaseerStatusBadge tone={readinessTone(source.readiness)}>{readinessCopy(source.readiness)}</BaseerStatusBadge></li>)}</ol> : <p className="decision-muted">{language === "ar" ? "لم تسجل المصادر بعد؛ شغّل الفحص أو فعّل الموصل المعتمد." : "Sources have not been registered yet; run a scan or configure an approved connector."}</p>}</BaseerCard><BaseerCard className="decision-research"><header className="decision-card__header"><div><h3>{language === "ar" ? "مراجعات المصادر العامة" : "Public source reviews"}</h3><p>{language === "ar" ? "لا تستبدل المراجعة الجديدة النسخة المنشورة حتى يعتمدها مسؤول مخول، والرفض يبقي النسخة السابقة." : "A changed record never replaces the published revision until a delegated reviewer approves it; dismissal keeps the prior revision."}</p></div></header>{reviews.length ? <ol className="decision-timeline">{reviews.flatMap((review) => review.revisions.map((revision) => <li key={`${review.id}-${revision.revision}`}><span className="decision-timeline__scope is-global">{language === "ar" ? "مراجعة" : "Review"}</span><div><strong>{revision.titleAr}</strong><small>{revision.startsOn.slice(0, 10)} — {revision.endsOn.slice(0, 10)} · {review.source.displayNameAr} · v{revision.revision}</small></div><footer><BaseerButton type="button" variant="quiet" disabled={researchBusy} onClick={() => void onResolveReview(review.id, revision.revision, "APPROVE")}>{language === "ar" ? "اعتماد النسخة" : "Approve revision"}</BaseerButton><BaseerButton type="button" variant="quiet" disabled={researchBusy} onClick={() => void onResolveReview(review.id, revision.revision, "DISMISS")}>{language === "ar" ? "رفض التغيير" : "Dismiss change"}</BaseerButton></footer></li>))}</ol> : <p className="decision-muted">{language === "ar" ? "لا توجد مراجعات معلقة للمصادر العامة." : "There are no pending public-source reviews."}</p>}</BaseerCard><BaseerCard className="decision-research"><header className="decision-card__header"><div><h3>{language === "ar" ? "مرشحات باحث السياق" : "Context researcher candidates"}</h3><p>{language === "ar" ? "لا يظهر المرشح في خط الزمن ولا يقرأه بصيرة قبل الاعتماد. المطابقة تمنع تكرار إجازة أو مناسبة منشورة." : "A candidate is excluded from the timeline and Basira until approved. Matching prevents a duplicate holiday or published event."}</p></div><BaseerButton type="button" variant="secondary" disabled={researchBusy} onClick={() => void onResearch()}>{language === "ar" ? "فحص المصادر الآن" : "Scan sources now"}</BaseerButton></header>{candidates.length ? <ol className="decision-timeline">{candidates.map((candidate) => <li key={candidate.id}><span className="decision-timeline__scope is-global">{language === "ar" ? "مرشح" : "Candidate"}</span><div><strong>{candidate.titleAr}</strong><small>{candidate.startsOn.slice(0, 10)} — {candidate.endsOn.slice(0, 10)} · {candidate.source.displayNameAr}{candidate.locationLabelAr ? ` · ${candidate.locationLabelAr}` : ""}</small>{candidate.relevanceReasonAr ? <small>{candidate.relevanceReasonAr}</small> : null}</div><footer><BaseerButton type="button" variant="quiet" disabled={researchBusy} onClick={() => void onResolve(candidate.id, "APPROVE")}>{language === "ar" ? "اعتماد" : "Approve"}</BaseerButton><BaseerButton type="button" variant="quiet" disabled={researchBusy} onClick={() => void onResolve(candidate.id, "DISMISS")}>{language === "ar" ? "تجاهل" : "Dismiss"}</BaseerButton></footer></li>)}</ol> : <p className="decision-muted">{language === "ar" ? "لا توجد مرشحات معلقة. راجع حالة الموصل أعلاه: الفحص يحتاج موصل الطقس أو المباريات المعتمد في بيئة الخادم." : "There are no pending candidates. Check the connector state above: scanning requires an approved weather or fixture connector on the server."}</p>}</BaseerCard></> : null}<BaseerCard className="decision-workspace__notice"><strong>{language === "ar" ? "قاعدة التحليل" : "Analysis rule"}</strong><p>{language === "ar" ? "تستخدم كل قراءة سياسة مقارنة مخصصة ومرقمة. يظهر الارتباط الزمني كفرضية، وليس كسبب مؤكد." : "Each read uses a dedicated, versioned comparison policy. Temporal association is shown as a hypothesis, never as confirmed cause."}</p></BaseerCard></div>;
}

function Empty({ language, message }: { language: Language; message: string }) { return <BaseerCard className="baseer-empty-state"><span className="baseer-empty-state__mark" aria-hidden="true">◌</span><div><strong>{language === "ar" ? "لا توجد قراءة متاحة" : "No read available"}</strong><p>{message}</p></div></BaseerCard>; }
