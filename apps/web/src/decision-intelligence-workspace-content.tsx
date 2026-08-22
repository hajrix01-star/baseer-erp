import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerValidatedFormField } from "./baseer-validated-form-field";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerFormGrid, BaseerFormSection } from "./baseer-form-section";
import { BaseerTextArea } from "./baseer-form-fields";
import { BaseerPeriodFilter, defaultBaseerPeriodRange, type BaseerPeriodRange } from "./baseer-period-filter";
import { BaseerStatusBadge, type BaseerStatusTone } from "./baseer-status-badge";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { presentBaseerApiError } from "./baseer-api-error";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { formatMoney, formatNumber } from "./number-format";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";

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
type TimelineEvent = { id: string; scope: "GLOBAL" | "AREA" | "COMPANY"; eventKind: string; titleAr: string; startsOn: string; endsOn: string; verificationStatus: string; sourceReference: string | null; locationLabelAr: string | null; isManual: boolean };
type Alert = { id: string; ruleCode: string; ruleVersion: string; status: "OPEN" | "ACKNOWLEDGED" | "CLOSED"; titleAr: string; createdAt: string; acknowledgedAt: string | null; closedAt: string | null; evidenceSnapshotId: string | null };
type AlertEvidence = {
  alert: Alert;
  snapshot: { id: string; evidenceKind: string; verificationStatus: string; periodFrom: string; periodTo: string; timezone: string; checksum: string; checksumValid: boolean; createdAt: string; supersedesSnapshotId: string | null; payload: unknown };
  actions: Array<{ action: "ACKNOWLEDGED" | "CLOSED"; reason: string; createdAt: string }>;
};
type ContextCandidate = { id: string; eventKind: string; titleAr: string; startsOn: string; endsOn: string; scope: "TENANT_GLOBAL" | "AREA"; locationCode: string | null; locationLabelAr: string | null; relevanceReasonAr: string | null; status: "PENDING_REVIEW" | "APPROVED" | "DISMISSED" | "DUPLICATE"; sourceUpdatedAt: string | null; createdAt: string; source: { sourceCode: string; displayNameAr: string; sourceUrl: string } };
type ContextReview = { id: string; eventKind: string; scope: "TENANT_GLOBAL" | "AREA"; locationLabelAr: string | null; currentRevision: number; source: { sourceCode: string; displayNameAr: string }; revisions: Array<{ revision: number; titleAr: string; startsOn: string; endsOn: string; sourceUpdatedAt: string | null; sourceChecksum: string }> };
type ContextSourceHealth = { category: "PUBLIC_CONTEXT" | "RESEARCH"; sourceCode: string; displayNameAr: string; sourceUrl: string; scheduleCode: string; readiness: "NOT_REGISTERED" | "DISABLED" | "READY_LOCAL_CATALOG" | "REQUIRES_APPROVED_ADAPTER" | "NOT_CONFIGURED" | "READY_TO_SYNC"; readinessReason: string; lastRun: { status: string; startedAt: string; finishedAt: string | null } | null };
type DecisionReads = { metric: SalesMetric | null; comparison: SalesComparison | null; matchedWeekdayComparison: SalesComparison | null; events: TimelineEvent[]; alerts: Alert[]; candidates: ContextCandidate[]; salesChangePolicy: SalesChangePolicy | null; reviews: ContextReview[]; sourceHealth: ContextSourceHealth[] };

function emptyDecisionReads(): DecisionReads { return { metric: null, comparison: null, matchedWeekdayComparison: null, events: [], alerts: [], candidates: [], salesChangePolicy: null, reviews: [], sourceHealth: [] }; }

async function loadDecisionReads(session: ActiveSession, signal: AbortSignal, { section, period, canReadMetrics, canReadContext, canReadAlerts, canManageGlobalContext, canManagePolicies }: { section: number; period: BaseerPeriodRange; canReadMetrics: boolean; canReadContext: boolean; canReadAlerts: boolean; canManageGlobalContext: boolean; canManagePolicies: boolean }): Promise<DecisionReads> {
  const query = new URLSearchParams({ from: period.from, to: period.to }).toString();
  const readMetric = canReadMetrics && (section === 0 || section === 3);
  const readComparisons = canReadMetrics && section === 0;
  const readContext = canReadContext && (section === 0 || section === 1);
  const readAlerts = canReadAlerts && (section === 0 || section === 2);
  const readGlobalContext = canManageGlobalContext && section === 4;
  const readPolicy = canManagePolicies && section === 3;
  const reads = await Promise.all([
    readMetric ? api<SalesMetric>(session, `/decision-intelligence/metrics/sales-daily?${query}`, { signal }) : Promise.resolve(null),
    readComparisons ? api<SalesComparison>(session, `/decision-intelligence/metrics/sales-comparison?${query}`, { signal }) : Promise.resolve(null),
    readComparisons && period.from === period.to ? api<SalesComparison>(session, `/decision-intelligence/metrics/sales-matched-weekday?date=${encodeURIComponent(period.from)}`, { signal }) : Promise.resolve(null),
    readContext ? api<TimelineEvent[]>(session, `/decision-intelligence/context/timeline?${query}`, { signal }) : Promise.resolve([]),
    readAlerts ? api<Alert[]>(session, "/decision-intelligence/alerts?pageSize=50", { signal }) : Promise.resolve([]),
    readGlobalContext ? api<ContextCandidate[]>(session, "/decision-intelligence/context/research/candidates?status=PENDING_REVIEW", { signal }) : Promise.resolve([]),
    readPolicy ? api<SalesChangePolicy>(session, "/decision-intelligence/policies/sales-change", { signal }) : Promise.resolve(null),
    readGlobalContext ? api<ContextReview[]>(session, "/decision-intelligence/context/reviews", { signal }) : Promise.resolve([]),
    readGlobalContext ? api<ContextSourceHealth[]>(session, "/decision-intelligence/context/sources/health", { signal }) : Promise.resolve([]),
  ]);
  return { ...emptyDecisionReads(), metric: reads[0], comparison: reads[1], matchedWeekdayComparison: reads[2], events: reads[3], alerts: reads[4], candidates: reads[5], salesChangePolicy: reads[6], reviews: reads[7], sourceHealth: reads[8] };
}

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
const evidenceCopy: Record<Language, Record<"checksumValid" | "checksumInvalid" | "period" | "evidenceKind" | "verification" | "checksum" | "figures" | "currentSales" | "comparisonSales" | "difference" | "change" | "fallback" | "relatedContext" | "relatedContextDescription" | "noRelatedContext" | "bothPeriods" | "currentPeriod" | "comparisonPeriod" | "lifecycle" | "acknowledged" | "closed", string>> = {
  ar: { checksumValid: "البصمة سليمة", checksumInvalid: "فشل التحقق من البصمة", period: "الفترة", evidenceKind: "نوع الدليل", verification: "حالة التحقق", checksum: "بصمة الدليل", figures: "أرقام حزمة الأدلة", currentSales: "صافي الفترة الحالية", comparisonSales: "صافي المقارنة", difference: "الفرق", change: "نسبة التغير", fallback: "تحمل هذه اللقطة حالة الجودة والمراجع المحفوظة عند إصدار التنبيه.", relatedContext: "السياق المتزامن", relatedContextDescription: "هذه أحداث تداخلت زمنياً مع فترة القياس أو المقارنة؛ لا تثبت أن أياً منها هو سبب تغير المبيعات.", noRelatedContext: "لا يوجد حدث منشور متداخل مع هاتين الفترتين عند إنشاء التنبيه.", bothPeriods: "تداخل مع الفترتين", currentPeriod: "تداخل مع الفترة الحالية", comparisonPeriod: "تداخل مع فترة المقارنة", lifecycle: "سجل المعالجة", acknowledged: "إقرار", closed: "إغلاق" },
  en: { checksumValid: "Checksum valid", checksumInvalid: "Checksum verification failed", period: "Period", evidenceKind: "Evidence kind", verification: "Verification", checksum: "Evidence checksum", figures: "Evidence figures", currentSales: "Current net sales", comparisonSales: "Comparison net sales", difference: "Difference", change: "Change", fallback: "This snapshot preserves quality and source references at alert creation.", relatedContext: "Concurrent context", relatedContextDescription: "These events overlap the measured or comparison period in time; none proves a cause of the sales change.", noRelatedContext: "No published context event overlapped either period when this alert was created.", bothPeriods: "Overlaps both periods", currentPeriod: "Overlaps current period", comparisonPeriod: "Overlaps comparison period", lifecycle: "Lifecycle", acknowledged: "Acknowledged", closed: "Closed" },
};

export function DecisionIntelligenceWorkspaceContent({ language, section, permissionCodes }: { language: Language; section: number; permissionCodes: readonly string[] | null }) {
  const session = activeSession();
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
  const [companyEventEditing, setCompanyEventEditing] = useState<TimelineEvent | null>(null);
  const [eventBusy, setEventBusy] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventArchive, setEventArchive] = useState<{ event: TimelineEvent; scope: "COMPANY" | "GLOBAL" } | null>(null);
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
  const [globalEventDialogOpen, setGlobalEventDialogOpen] = useState(false);
  const [globalEventEditing, setGlobalEventEditing] = useState<TimelineEvent | null>(null);
  const [globalEventBusy, setGlobalEventBusy] = useState(false);
  const [globalEventError, setGlobalEventError] = useState<string | null>(null);
  const [globalEventForm, setGlobalEventForm] = useState({ eventKind: "PUBLIC_EVENT", titleAr: "", startsOn: period.from, endsOn: period.to, sourceReference: "", reason: "" });
  const refetchReads = useRef<() => Promise<void>>(async () => undefined);
  const evidenceAbort = useRef<AbortController | null>(null);
  const evidenceEpoch = useRef(0);
  const hasPermission = (code: string) => permissionCodes?.includes(code) ?? false;
  const canReadMetrics = hasPermission("decision.metrics.read");
  const canReadContext = hasPermission("decision.context.read");
  const canReadAlerts = hasPermission("decision.alerts.read");
  const canManageAlerts = hasPermission("decision.alerts.manage");
  const canManageCompanyContext = hasPermission("decision.context.company.manage");
  const canGiveFeedback = hasPermission("decision.feedback.write");
  const canManagePolicies = hasPermission("decision.policy.manage");
  const canManageGlobalContext = hasPermission("decision.context.global.manage");

  const load = useCallback(async () => { await refetchReads.current().catch(() => undefined); }, []);
  const applyReads = useCallback((reads: DecisionReads) => {
    setMetric(reads.metric); setComparison(reads.comparison); setMatchedWeekdayComparison(reads.matchedWeekdayComparison);
    setEvents(reads.events); setAlerts(reads.alerts); setCandidates(reads.candidates); setSalesChangePolicy(reads.salesChangePolicy);
    setReviews(reads.reviews); setSourceHealth(reads.sourceHealth); setError("");
  }, []);
  const presentReadError = useCallback((reason: unknown) => {
    const fallback = language === "ar" ? "تعذر تحميل قراءات مركز القرار. أعد المحاولة." : "Decision reads could not be loaded. Please try again.";
    const diagnostic = import.meta.env.DEV && reason instanceof Error ? ` [${reason.name}: ${reason.message}]` : "";
    setError(`${presentBaseerApiError(reason, language, fallback)}${diagnostic}`);
  }, [language]);

  useEffect(() => {
    evidenceEpoch.current += 1;
    evidenceAbort.current?.abort();
    setEvidence(null); setEvidenceBusy(false);
    return () => evidenceAbort.current?.abort();
  }, [period.from, period.to, session?.companyId, session?.sessionExpiresAt]);
  useEffect(() => { setEventForm((current) => ({ ...current, startsOn: period.from, endsOn: period.to })); }, [period.from, period.to]);
  const openAlerts = alerts.filter((alert) => alert.status === "OPEN");
  const companyEvents = events.filter((event) => event.scope === "COMPANY");
  const globalEvents = events.filter((event) => event.scope === "GLOBAL" || event.scope === "AREA");
  const sectionContent = useMemo(() => {
    if (section === 1) return <TimelinePanel language={language} events={events} companyEvents={companyEvents} globalEvents={globalEvents} canManage={canManageCompanyContext} canManageGlobal={canManageGlobalContext} onCreate={() => { setCompanyEventEditing(null); setEventForm({ eventKind: "OPERATIONAL_EVENT", titleAr: "", startsOn: period.from, endsOn: period.to, sourceReference: "" }); setEventDialogOpen(true); }} onEditCompany={(event) => { setCompanyEventEditing(event); setEventForm({ eventKind: event.eventKind, titleAr: event.titleAr, startsOn: event.startsOn, endsOn: event.endsOn, sourceReference: event.sourceReference ?? "" }); setEventDialogOpen(true); }} onCreateGlobal={() => { setGlobalEventEditing(null); setGlobalEventForm({ eventKind: "PUBLIC_EVENT", titleAr: "", startsOn: period.from, endsOn: period.to, sourceReference: "", reason: "" }); setGlobalEventError(null); setGlobalEventDialogOpen(true); }} onEditGlobal={(event) => { setGlobalEventEditing(event); setGlobalEventForm({ eventKind: event.eventKind, titleAr: event.titleAr, startsOn: event.startsOn, endsOn: event.endsOn, sourceReference: event.sourceReference ?? "", reason: "" }); setGlobalEventError(null); setGlobalEventDialogOpen(true); }} onArchive={(event, scope) => { setEventArchive({ event, scope }); setEventArchiveReason(""); setEventArchiveError(null); }} />;
    if (section === 2) return <AlertsPanel language={language} alerts={alerts} canGiveFeedback={canGiveFeedback} canManage={canManageAlerts} onViewEvidence={async (alertId) => {
      if (!session) return;
      const epoch = ++evidenceEpoch.current; evidenceAbort.current?.abort(); const controller = new AbortController(); evidenceAbort.current = controller;
      setEvidenceBusy(true);
      try { const next = await api<AlertEvidence>(session, `/decision-intelligence/alerts/${alertId}/evidence`, { signal: controller.signal }); if (!controller.signal.aborted && epoch === evidenceEpoch.current && activeSession()?.companyId === session.companyId && activeSession()?.sessionExpiresAt === session.sessionExpiresAt) setEvidence(next); } catch (reason) { if (!controller.signal.aborted) setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر تحميل حزمة الأدلة." : "Evidence could not be loaded.")); } finally { if (epoch === evidenceEpoch.current) setEvidenceBusy(false); }
    }} onChangeStatus={(alert, status) => { setAlertAction({ alert, status }); setAlertActionReason(""); setAlertActionError(null); }} onFeedback={async (alertId, kind) => {
      const current = activeSession(); if (!current) return;
      try { const idempotencyKey = requestId(); await api(current, "/decision-intelligence/alerts/feedback", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ alertId, kind, idempotencyKey }) }); await load(); } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر حفظ التغذية الراجعة." : "Feedback could not be saved.")); }
    }} />;
    if (section === 3) return <><QualityPanel language={language} metric={metric} canManagePolicies={canManagePolicies} onEvaluate={async () => {
      const current = activeSession(); if (!current) return;
      try { const idempotencyKey = requestId(); await api(current, "/decision-intelligence/evaluations/sales-quality", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ from: period.from, to: period.to, idempotencyKey }) }); await load(); } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر تشغيل فحص الجودة." : "The quality check could not be run.")); }
    }} />{canManagePolicies && <SalesChangePolicyCard language={language} policy={salesChangePolicy} onEvaluate={async () => {
      const current = activeSession(); if (!current) return;
      try { const idempotencyKey = requestId(); await api(current, "/decision-intelligence/evaluations/sales-change", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ from: period.from, to: period.to, idempotencyKey }) }); await load(); } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر تشغيل فحص تغير المبيعات." : "The sales-change check could not be run.")); }
    }} onSavePolicy={async (policy) => {
      const current = activeSession(); if (!current) return;
      try { const idempotencyKey = requestId(); await api(current, "/decision-intelligence/policies/sales-change", { method: "PUT", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ ...policy, idempotencyKey }) }); await load(); } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر حفظ سياسة التنبيه." : "The alert policy could not be saved.")); throw reason; }
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
        const idempotencyKey = requestId(); await api(current, "/decision-intelligence/context/research/candidates/resolve", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ candidateId, action, idempotencyKey }) });
        await load();
      } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر اعتماد المرشح أو تجاهله." : "The context candidate could not be resolved.")); } finally { setResearchBusy(false); }
    }} onResolveReview={async (eventId, revision, action) => {
      const current = activeSession(); if (!current) return;
      setResearchBusy(true);
      try {
        const idempotencyKey = requestId(); await api(current, "/decision-intelligence/context/reviews/resolve", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ eventId, revision, action, reason: action === "APPROVE" ? "اعتماد مراجعة المصدر الرسمية" : "رفض مراجعة المصدر الرسمية", idempotencyKey }) });
        await load();
      } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر اعتماد أو رفض مراجعة المصدر." : "The source review could not be resolved.")); } finally { setResearchBusy(false); }
    }} />;
    return <OverviewPanel language={language} metric={metric} comparison={comparison} matchedWeekdayComparison={matchedWeekdayComparison} events={events} openAlerts={openAlerts} />;
  }, [alerts, candidates, canGiveFeedback, canManageAlerts, canManageCompanyContext, canManageGlobalContext, canManagePolicies, companyEvents, comparison, events, globalEvents, language, load, matchedWeekdayComparison, metric, openAlerts, period.from, period.to, researchBusy, reviews, salesChangePolicy, section, sourceHealth]);

  async function createEvent(values: typeof eventForm) {
    const current = activeSession(); if (!current) return;
    setEventBusy(true); setEventError(null);
    try {
      const path = companyEventEditing ? `/decision-intelligence/context/company-events/${companyEventEditing.id}` : "/decision-intelligence/context/company-events";
      const idempotencyKey = requestId();
      await api(current, path, { method: companyEventEditing ? "PUT" : "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ ...values, sourceReference: values.sourceReference.trim() || undefined, idempotencyKey }) });
      setEventDialogOpen(false); setCompanyEventEditing(null); setEventForm({ eventKind: "OPERATIONAL_EVENT", titleAr: "", startsOn: period.from, endsOn: period.to, sourceReference: "" }); await load();
    } catch (reason) { setEventError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر حفظ الحدث." : "The event could not be saved.")); } finally { setEventBusy(false); }
  }

  async function submitGlobalEvent(values: typeof globalEventForm) {
    const current = activeSession(); if (!current) return;
    setGlobalEventBusy(true); setGlobalEventError(null);
    try {
      const path = globalEventEditing ? `/decision-intelligence/context/global-events/${globalEventEditing.id}` : "/decision-intelligence/context/global-events";
      const idempotencyKey = requestId();
      await api(current, path, { method: globalEventEditing ? "PUT" : "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey }, body: JSON.stringify({ ...values, sourceReference: values.sourceReference.trim() || undefined, idempotencyKey }) });
      setGlobalEventDialogOpen(false); setGlobalEventEditing(null); await load();
    } catch (reason) { setGlobalEventError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر حفظ المناسبة العامة." : "The global context event could not be saved.")); } finally { setGlobalEventBusy(false); }
  }

  async function submitAlertAction(values: { reason: string }) {
    if (!alertAction) return;
    const current = activeSession(); if (!current) return;
    setAlertActionBusy(true); setAlertActionError(null);
    try {
      const idempotencyKey = requestId();
      await api(current, `/decision-intelligence/alerts/${alertAction.alert.id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ status: alertAction.status, reason: values.reason, idempotencyKey }),
      });
      setAlertAction(null); await load();
    } catch (reason) { setAlertActionError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر تحديث حالة التنبيه." : "The alert status could not be updated.")); } finally { setAlertActionBusy(false); }
  }

  async function submitEventArchive(values: { reason: string }) {
    if (!eventArchive) return;
    const current = activeSession(); if (!current) return;
    setEventArchiveBusy(true); setEventArchiveError(null);
    try {
      const path = eventArchive.scope === "GLOBAL" ? `/decision-intelligence/context/global-events/${eventArchive.event.id}/archive` : `/decision-intelligence/context/company-events/${eventArchive.event.id}/archive`;
      const idempotencyKey = requestId();
      await api(current, path, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ reason: values.reason, idempotencyKey }),
      });
      setEventArchive(null); await load();
    } catch (reason) { setEventArchiveError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر سحب الحدث." : "The event could not be withdrawn.")); } finally { setEventArchiveBusy(false); }
  }

  if (!session) return <DailySalesSignIn language={language} />;
  return <section className="baseer-workspace decision-workspace" aria-busy={loading}>
    <DecisionReadCoordinator session={session} language={language} section={section} period={period} permissionScope={permissionCodes ?? []} canReadMetrics={canReadMetrics} canReadContext={canReadContext} canReadAlerts={canReadAlerts} canManageGlobalContext={canManageGlobalContext} canManagePolicies={canManagePolicies} onData={applyReads} onLoading={setLoading} onError={presentReadError} onRefetch={(refetch) => { refetchReads.current = refetch; }} />
    <header className="baseer-section-header">
      <div className="baseer-section-header__copy"><p className="baseer-section-header__eyebrow">Decision Intelligence &amp; Context</p><h2>{language === "ar" ? "قراءات موثقة قبل أي تفسير" : "Evidence before interpretation"}</h2><p>{language === "ar" ? "يجمع المركز حقائق النظام والسياق الزمني. لا يعدّل المبيعات أو الحملات، ولا يثبت السببية من التزامن وحده." : "The center joins official facts with time context. It never changes sales or campaigns, and temporal association is not causation."}</p></div>
      <div className="baseer-section-header__actions"><BaseerPeriodFilter language={language} value={period} onChange={setPeriod} /><BaseerButton type="button" variant="secondary" onClick={() => void load()}>{language === "ar" ? "تحديث" : "Refresh"}</BaseerButton></div>
    </header>
    {error ? <p className="daily-sales-message error" role="alert">{error}</p> : null}
    {sectionContent}
    <BaseerFormDialog open={eventDialogOpen} title={companyEventEditing ? (language === "ar" ? "تعديل حدث الشركة" : "Edit company event") : (language === "ar" ? "إضافة حدث للشركة" : "Add company event")} language={language} formId="decision-company-event" submitLabel={language === "ar" ? "حفظ الحدث" : "Save event"} busy={eventBusy} error={eventError} size="standard" className="decision-context-dialog" onClose={() => !eventBusy && setEventDialogOpen(false)}>
      <BaseerValidatedFormField id="decision-company-event" className="baseer-form" values={eventForm} schemaFactory={({ z }) => z.object({ eventKind: z.string().min(1), titleAr: z.string().trim().min(2, language === "ar" ? "أدخل عنواناً من حرفين على الأقل." : "Enter a title of at least two characters.").max(240), startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, language === "ar" ? "اختر تاريخاً صحيحاً." : "Choose a valid date."), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, language === "ar" ? "اختر تاريخاً صحيحاً." : "Choose a valid date."), sourceReference: z.string().max(500) }).refine((value) => value.endsOn >= value.startsOn, { path: ["endsOn"], message: language === "ar" ? "يجب ألا يسبق تاريخ النهاية تاريخ البداية." : "End date cannot precede start date." })} onValid={(values) => void createEvent(values)} errorSummaryLabel={language === "ar" ? "راجع الحقول المطلوبة." : "Review the required fields."}>
        {({ errors }) => <>
        <BaseerFormSection title={language === "ar" ? "تفاصيل حدث الشركة" : "Company event details"} description={language === "ar" ? "يظهر لهذا الكيان فقط كسياق للمراجعة، ولا يعدّل المبيعات." : "Visible to this company only as review context; it never changes sales."}><BaseerFormGrid>
          <label>{language === "ar" ? "نوع الحدث" : "Event kind"}<select aria-invalid={Boolean(errors.eventKind)} value={eventForm.eventKind} onChange={(event) => setEventForm((value) => ({ ...value, eventKind: event.target.value }))}><option value="OPERATIONAL_EVENT">{language === "ar" ? "حدث تشغيلي" : "Operational event"}</option><option value="CLOSURE">{language === "ar" ? "إغلاق" : "Closure"}</option><option value="STOCK_SHORTAGE">{language === "ar" ? "نقص مخزون" : "Stock shortage"}</option><option value="HOURS_CHANGE">{language === "ar" ? "تغيير ساعات" : "Hours change"}</option><option value="PROMOTION">{language === "ar" ? "عرض أو مبادرة" : "Promotion"}</option></select>{errors.eventKind ? <small role="alert">{errors.eventKind.message}</small> : null}</label>
          <label className="baseer-form-field--full">{language === "ar" ? "العنوان" : "Title"}<input required aria-invalid={Boolean(errors.titleAr)} minLength={2} maxLength={240} value={eventForm.titleAr} onChange={(event) => setEventForm((value) => ({ ...value, titleAr: event.target.value }))} />{errors.titleAr ? <small role="alert">{errors.titleAr.message}</small> : null}</label>
          <label>{language === "ar" ? "من" : "From"}<BaseerDatePicker language={language} label={language === "ar" ? "من" : "From"} value={eventForm.startsOn} onChange={(startsOn) => setEventForm((value) => ({ ...value, startsOn }))} />{errors.startsOn ? <small role="alert">{errors.startsOn.message}</small> : null}</label><label>{language === "ar" ? "إلى" : "To"}<BaseerDatePicker language={language} label={language === "ar" ? "إلى" : "To"} min={eventForm.startsOn} value={eventForm.endsOn} onChange={(endsOn) => setEventForm((value) => ({ ...value, endsOn }))} />{errors.endsOn ? <small role="alert">{errors.endsOn.message}</small> : null}</label>
          <label className="baseer-form-field--full">{language === "ar" ? "مرجع أو ملاحظة المصدر" : "Source reference or note"}<input aria-invalid={Boolean(errors.sourceReference)} maxLength={500} value={eventForm.sourceReference} onChange={(event) => setEventForm((value) => ({ ...value, sourceReference: event.target.value }))} />{errors.sourceReference ? <small role="alert">{errors.sourceReference.message}</small> : null}</label>
        </BaseerFormGrid></BaseerFormSection>
        </>}
      </BaseerValidatedFormField>
    </BaseerFormDialog>
    <BaseerFormDialog open={globalEventDialogOpen} title={globalEventEditing ? (language === "ar" ? "تعديل مناسبة عامة" : "Edit global event") : (language === "ar" ? "إضافة مناسبة عامة" : "Add global event")} language={language} formId="decision-global-event" submitLabel={language === "ar" ? "حفظ المناسبة" : "Save event"} busy={globalEventBusy} error={globalEventError} size="standard" className="decision-context-dialog" onClose={() => !globalEventBusy && setGlobalEventDialogOpen(false)}>
      <BaseerValidatedFormField id="decision-global-event" className="baseer-form" values={globalEventForm} schemaFactory={({ z }) => z.object({ eventKind: z.string().min(1), titleAr: z.string().trim().min(2, language === "ar" ? "أدخل عنواناً من حرفين على الأقل." : "Enter a title of at least two characters.").max(240), startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, language === "ar" ? "اختر تاريخاً صحيحاً." : "Choose a valid date."), endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, language === "ar" ? "اختر تاريخاً صحيحاً." : "Choose a valid date."), sourceReference: z.string().max(500), reason: z.string().trim().min(3, language === "ar" ? "أدخل سبباً من ثلاثة أحرف على الأقل." : "Enter a reason of at least three characters.").max(500) }).refine((value) => value.endsOn >= value.startsOn, { path: ["endsOn"], message: language === "ar" ? "يجب ألا يسبق تاريخ النهاية تاريخ البداية." : "End date cannot precede start date." })} onValid={(values) => void submitGlobalEvent(values)} errorSummaryLabel={language === "ar" ? "راجع الحقول المطلوبة." : "Review the required fields."}>
        {({ errors }) => <>
        <BaseerFormSection title={language === "ar" ? "تفاصيل المناسبة العامة" : "Global event details"} description={language === "ar" ? "تظهر لكل الشركات كسياق زمني، ولا تثبت سبباً للمبيعات." : "Shown to every company as time context; it does not prove a sales cause."}><BaseerFormGrid>
          <label>{language === "ar" ? "نوع المناسبة" : "Event kind"}<select aria-invalid={Boolean(errors.eventKind)} value={globalEventForm.eventKind} onChange={(event) => setGlobalEventForm((value) => ({ ...value, eventKind: event.target.value }))}><option value="PUBLIC_EVENT">{language === "ar" ? "مناسبة عامة" : "Public event"}</option><option value="ECONOMIC_EVENT">{language === "ar" ? "حدث اقتصادي" : "Economic event"}</option><option value="EXCEPTIONAL_EVENT">{language === "ar" ? "حدث استثنائي" : "Exceptional event"}</option></select>{errors.eventKind ? <small role="alert">{errors.eventKind.message}</small> : null}</label>
          <label className="baseer-form-field--full">{language === "ar" ? "العنوان" : "Title"}<input required aria-invalid={Boolean(errors.titleAr)} minLength={2} maxLength={240} value={globalEventForm.titleAr} onChange={(event) => setGlobalEventForm((value) => ({ ...value, titleAr: event.target.value }))} />{errors.titleAr ? <small role="alert">{errors.titleAr.message}</small> : null}</label>
          <label>{language === "ar" ? "من" : "From"}<BaseerDatePicker language={language} label={language === "ar" ? "من" : "From"} value={globalEventForm.startsOn} onChange={(startsOn) => setGlobalEventForm((value) => ({ ...value, startsOn }))} />{errors.startsOn ? <small role="alert">{errors.startsOn.message}</small> : null}</label><label>{language === "ar" ? "إلى" : "To"}<BaseerDatePicker language={language} label={language === "ar" ? "إلى" : "To"} min={globalEventForm.startsOn} value={globalEventForm.endsOn} onChange={(endsOn) => setGlobalEventForm((value) => ({ ...value, endsOn }))} />{errors.endsOn ? <small role="alert">{errors.endsOn.message}</small> : null}</label>
          <label className="baseer-form-field--full">{language === "ar" ? "مرجع أو ملاحظة" : "Reference or note"}<input aria-invalid={Boolean(errors.sourceReference)} maxLength={500} value={globalEventForm.sourceReference} onChange={(event) => setGlobalEventForm((value) => ({ ...value, sourceReference: event.target.value }))} />{errors.sourceReference ? <small role="alert">{errors.sourceReference.message}</small> : null}</label>
        </BaseerFormGrid></BaseerFormSection>
        <BaseerFormSection title={language === "ar" ? "سجل القرار" : "Decision record"} description={language === "ar" ? "يحفظ السبب مع إصدار المناسبة للمراجعة المستقبلية." : "The reason is retained with this event revision for later review."}><BaseerFormGrid columns="one"><label>{language === "ar" ? "سبب التسجيل أو التعديل" : "Reason for this change"}<BaseerTextArea required aria-invalid={Boolean(errors.reason)} minLength={3} maxLength={500} compact value={globalEventForm.reason} onValueChange={(reason) => setGlobalEventForm((value) => ({ ...value, reason }))} />{errors.reason ? <small role="alert">{errors.reason.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection>
        </>}
      </BaseerValidatedFormField>
    </BaseerFormDialog>
    <BaseerFormDialog open={evidence !== null || evidenceBusy} title={language === "ar" ? "حزمة أدلة التنبيه" : "Alert evidence package"} language={language} formId="decision-alert-evidence" submitLabel={language === "ar" ? "إغلاق" : "Close"} busy={evidenceBusy} onClose={() => !evidenceBusy && setEvidence(null)}>
      <form id="decision-alert-evidence" className="decision-evidence" onSubmit={(event) => { event.preventDefault(); setEvidence(null); }}>
        {evidence ? <EvidenceDetails language={language} evidence={evidence} /> : <p>{language === "ar" ? "جارٍ تحميل الأدلة…" : "Loading evidence…"}</p>}
      </form>
    </BaseerFormDialog>
    <BaseerFormDialog open={alertAction !== null} title={alertAction?.status === "CLOSED" ? (language === "ar" ? "إغلاق التنبيه" : "Close alert") : (language === "ar" ? "إقرار التنبيه" : "Acknowledge alert")} language={language} formId="decision-alert-action" submitLabel={alertAction?.status === "CLOSED" ? (language === "ar" ? "تأكيد الإغلاق" : "Confirm close") : (language === "ar" ? "تأكيد الإقرار" : "Confirm acknowledgement")} busy={alertActionBusy} error={alertActionError} size="compact" onClose={() => !alertActionBusy && setAlertAction(null)}>
      <BaseerValidatedFormField id="decision-alert-action" className="baseer-form" values={{ reason: alertActionReason }} schemaFactory={({ z }) => z.object({ reason: z.string().trim().min(3, language === "ar" ? "أدخل سبباً من ثلاثة أحرف على الأقل." : "Enter a reason of at least three characters.").max(500) })} onValid={(values) => void submitAlertAction(values)} errorSummaryLabel={language === "ar" ? "راجع الحقول المطلوبة." : "Review the required fields."}>{({ errors }) => <BaseerFormSection title={language === "ar" ? "سجل المعالجة" : "Lifecycle record"} description={language === "ar" ? "هذا الإجراء منفصل عن التغذية الراجعة ويحفظ للمراجعة اللاحقة." : "This action is separate from feedback and is retained for later review."}><BaseerFormGrid columns="one"><label>{language === "ar" ? "السبب" : "Reason"}<BaseerTextArea required aria-invalid={Boolean(errors.reason)} minLength={3} maxLength={500} compact value={alertActionReason} onValueChange={setAlertActionReason} />{errors.reason ? <small role="alert">{errors.reason.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection>}</BaseerValidatedFormField>
    </BaseerFormDialog>
    <BaseerFormDialog open={eventArchive !== null} title={eventArchive?.scope === "GLOBAL" ? (language === "ar" ? "سحب مناسبة عامة" : "Withdraw global event") : (language === "ar" ? "سحب حدث الشركة" : "Withdraw company event")} language={language} formId="decision-company-event-archive" submitLabel={language === "ar" ? "تأكيد السحب" : "Confirm withdrawal"} busy={eventArchiveBusy} error={eventArchiveError} size="compact" onClose={() => !eventArchiveBusy && setEventArchive(null)}>
      <BaseerValidatedFormField id="decision-company-event-archive" className="baseer-form" values={{ reason: eventArchiveReason }} schemaFactory={({ z }) => z.object({ reason: z.string().trim().min(3, language === "ar" ? "أدخل سبباً من ثلاثة أحرف على الأقل." : "Enter a reason of at least three characters.").max(500) })} onValid={(values) => void submitEventArchive(values)} errorSummaryLabel={language === "ar" ? "راجع الحقول المطلوبة." : "Review the required fields."}>{({ errors }) => <BaseerFormSection title={language === "ar" ? "تأكيد السحب" : "Confirm withdrawal"} description={language === "ar" ? `سيُسحب الحدث «${eventArchive?.event.titleAr ?? ""}» من خط الزمن ولا تُحذف سجلاته.` : `“${eventArchive?.event.titleAr ?? ""}” will be withdrawn from the timeline; its records are not deleted.`}><BaseerFormGrid columns="one"><label>{language === "ar" ? "سبب السحب" : "Withdrawal reason"}<BaseerTextArea required aria-invalid={Boolean(errors.reason)} minLength={3} maxLength={500} compact value={eventArchiveReason} onValueChange={setEventArchiveReason} />{errors.reason ? <small role="alert">{errors.reason.message}</small> : null}</label></BaseerFormGrid></BaseerFormSection>}</BaseerValidatedFormField>
    </BaseerFormDialog>
  </section>;
}

function DecisionReadCoordinator({ session, language, section, period, permissionScope, canReadMetrics, canReadContext, canReadAlerts, canManageGlobalContext, canManagePolicies, onData, onLoading, onError, onRefetch }: { session: ActiveSession; language: Language; section: number; period: BaseerPeriodRange; permissionScope: readonly string[]; canReadMetrics: boolean; canReadContext: boolean; canReadAlerts: boolean; canManageGlobalContext: boolean; canManagePolicies: boolean; onData: (reads: DecisionReads) => void; onLoading: (loading: boolean) => void; onError: (reason: unknown) => void; onRefetch: (refetch: () => Promise<void>) => void }) {
  const scope = [language, String(section), period.preset, period.from, period.to, period.months.join(","), [...permissionScope].sort().join(",")];
  return <BaseerCompanyReadQuery session={session} resource="decision-intelligence.workspace" scope={scope} load={(current, signal) => loadDecisionReads(current, signal, { section, period, canReadMetrics, canReadContext, canReadAlerts, canManageGlobalContext, canManagePolicies })}>
    {({ data, loading, error, refetch }) => <DecisionReadState data={data} loading={loading} error={error} refetch={refetch} onData={onData} onLoading={onLoading} onError={onError} onRefetch={onRefetch} />}
  </BaseerCompanyReadQuery>;
}

function DecisionReadState({ data, loading, error, refetch, onData, onLoading, onError, onRefetch }: { data: DecisionReads | undefined; loading: boolean; error: unknown; refetch: () => Promise<void>; onData: (reads: DecisionReads) => void; onLoading: (loading: boolean) => void; onError: (reason: unknown) => void; onRefetch: (refetch: () => Promise<void>) => void }) {
  useEffect(() => { onLoading(loading); }, [loading, onLoading]);
  useEffect(() => { onRefetch(refetch); }, [onRefetch, refetch]);
  useEffect(() => { if (data) onData(data); else if (loading) onData(emptyDecisionReads()); }, [data, loading, onData]);
  useEffect(() => { if (error) onError(error); }, [error, onError]);
  return null;
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
  const differenceHasValue = /[1-9]/.test(comparison.payload.differenceNetAmount.replace(/^[+-]/, ""));
  const directionKey = !differenceHasValue ? "UNCHANGED" : comparison.payload.differenceNetAmount.startsWith("-") ? "DECREASE" : "INCREASE";
  const direction = comparisonDirectionCopy[language][directionKey];
  const weekday = comparison.comparisonPolicyCode === "MATCHED_WEEKDAYS";
  return <BaseerCard className="decision-workspace__notice decision-sales-comparison"><header className="decision-card__header"><div><h3>{weekday ? (language === "ar" ? "مقارنة اليوم نفسه من الأسبوع السابق" : "Same weekday, previous week") : (language === "ar" ? "مقارنة المبيعات بالفترة السابقة المماثلة" : "Sales compared with the previous equal period")}</h3><p>{weekday ? (language === "ar" ? "قراءة يومية فقط تقارن التاريخ المختار بالتاريخ نفسه قبل سبعة أيام. لا تثبت السبب." : "A daily-only read comparing the selected date with the same weekday seven days earlier. It does not prove cause.") : (language === "ar" ? "نفس عدد الأيام مباشرة قبل الفترة المحددة. هذه قراءة وصفية وليست إثباتاً للسبب." : "The same number of days immediately before the selected period. This is descriptive, not proof of cause.")}</p></div><BaseerStatusBadge tone={qualityTone[comparison.dataQuality]}>{qualityCopy[language][comparison.dataQuality]}</BaseerStatusBadge></header>{ready ? <BaseerSummaryMetricGrid ariaLabel={language === "ar" ? "مقارنة المبيعات" : "Sales comparison"}><BaseerSummaryMetric label={language === "ar" ? "الفترة الحالية" : "Current period"} value={formatMoney(comparison.payload.currentNetAmount)} /><BaseerSummaryMetric label={language === "ar" ? "الفترة السابقة" : "Previous period"} value={formatMoney(comparison.payload.comparisonNetAmount)} /><BaseerSummaryMetric label={language === "ar" ? `الفرق (${direction})` : `${direction} difference`} value={formatMoney(comparison.payload.differenceNetAmount)} /><BaseerSummaryMetric label={language === "ar" ? "نسبة التغير" : "Change rate"} value={comparison.payload.percentDifference === null ? "—" : `${comparison.payload.percentDifference}%`} /></BaseerSummaryMetricGrid> : <p>{language === "ar" ? "لا يصدر المركز حكماً عن التغير لأن إحدى الفترتين ناقصة أو غير متاحة. راجع جودة البيانات أولاً." : "The center does not judge the change because one period is incomplete or unavailable. Review data quality first."}</p>}</BaseerCard>;
}

function TimelinePanel({ language, events, companyEvents, globalEvents, canManage, canManageGlobal, onCreate, onEditCompany, onCreateGlobal, onEditGlobal, onArchive }: { language: Language; events: TimelineEvent[]; companyEvents: TimelineEvent[]; globalEvents: TimelineEvent[]; canManage: boolean; canManageGlobal: boolean; onCreate: () => void; onEditCompany: (event: TimelineEvent) => void; onCreateGlobal: () => void; onEditGlobal: (event: TimelineEvent) => void; onArchive: (event: TimelineEvent, scope: "COMPANY" | "GLOBAL") => void }) {
  return <div className="decision-workspace__stack"><BaseerCard className="decision-timeline-intro"><div><h3>{language === "ar" ? "خط الزمن والسياق" : "Timeline and context"}</h3><p>{language === "ar" ? "تظهر أحداث المنطقة فقط للشركات التي حفظت رمز موقعها المطابق؛ أحداث الشركة لا تعدّل الحقيقة المالية ولا تتحول إلى سبب تلقائياً." : "Area events appear only to companies with a matching saved location code; company events never alter financial facts or become automatic causes."}</p></div><footer>{canManage && <BaseerButton type="button" onClick={onCreate}>{language === "ar" ? "إضافة حدث للشركة" : "Add company event"}</BaseerButton>}{canManageGlobal && <BaseerButton type="button" variant="secondary" onClick={onCreateGlobal}>{language === "ar" ? "إضافة مناسبة عامة" : "Add global event"}</BaseerButton>}</footer></BaseerCard><BaseerSummaryMetricGrid><BaseerSummaryMetric label={language === "ar" ? "كل الأحداث" : "All events"} value={events.length} /><BaseerSummaryMetric label={language === "ar" ? "أحداث الشركة" : "Company events"} value={companyEvents.length} /><BaseerSummaryMetric label={language === "ar" ? "مناسبات عامة/منطقة" : "Public or area events"} value={globalEvents.length} /></BaseerSummaryMetricGrid>{events.length ? <ol className="decision-timeline">{events.map((item) => <li key={`${item.scope}-${item.id}`}><span className={`decision-timeline__scope is-${item.scope.toLowerCase()}`}>{timelineScopeLabel(language, item.scope)}</span><div><strong>{item.titleAr}</strong><small>{item.startsOn} — {item.endsOn} · {item.eventKind}{item.locationLabelAr ? ` · ${item.locationLabelAr}` : ""}</small></div><BaseerStatusBadge tone={item.verificationStatus === "SYSTEM_RECONCILED" ? "success" : "neutral"}>{item.verificationStatus === "SYSTEM_RECONCILED" ? (language === "ar" ? "موثق" : "Reconciled") : (language === "ar" ? "مسجل" : "Recorded")}</BaseerStatusBadge>{canManage && item.scope === "COMPANY" && <footer><BaseerButton type="button" variant="quiet" onClick={() => onEditCompany(item)}>{language === "ar" ? "تعديل" : "Edit"}</BaseerButton><BaseerButton type="button" variant="quiet" onClick={() => onArchive(item, "COMPANY")}>{language === "ar" ? "سحب" : "Withdraw"}</BaseerButton></footer>}{canManageGlobal && item.scope === "GLOBAL" && item.isManual && <footer><BaseerButton type="button" variant="quiet" onClick={() => onEditGlobal(item)}>{language === "ar" ? "تعديل" : "Edit"}</BaseerButton><BaseerButton type="button" variant="quiet" onClick={() => onArchive(item, "GLOBAL")}>{language === "ar" ? "سحب" : "Withdraw"}</BaseerButton></footer>}</li>)}</ol> : <Empty language={language} message={language === "ar" ? "لا توجد مناسبات أو أحداث ضمن الفترة المحددة." : "There are no events in the selected period."} />}</div>;
}

function timelineScopeLabel(language: Language, scope: TimelineEvent["scope"]) { if (scope === "GLOBAL") return language === "ar" ? "عام" : "Global"; if (scope === "AREA") return language === "ar" ? "منطقة" : "Area"; return language === "ar" ? "الشركة" : "Company"; }

function AlertsPanel({ language, alerts, canGiveFeedback, canManage, onFeedback, onViewEvidence, onChangeStatus }: { language: Language; alerts: Alert[]; canGiveFeedback: boolean; canManage: boolean; onFeedback: (alertId: string, kind: "USEFUL" | "DATA_INCOMPLETE") => Promise<void>; onViewEvidence: (alertId: string) => Promise<void>; onChangeStatus: (alert: Alert, status: "ACKNOWLEDGED" | "CLOSED") => void }) {
  const statusCopy = (status: Alert["status"]) => alertStatusCopy[language][status];
  return <div className="decision-workspace__stack"><BaseerCard className="decision-timeline-intro"><div><h3>{language === "ar" ? "تنبيهات قابلة للتدقيق" : "Auditable alerts"}</h3><p>{language === "ar" ? "كل تنبيه مرتبط بحزمة أدلة ثابتة عند إنشائه. التغذية الراجعة تحسن التقييمات ولا تدرب النظام تلقائياً." : "Every alert points to frozen evidence. Feedback improves evaluation; it never trains the system automatically."}</p></div></BaseerCard>{alerts.length ? <div className="decision-alert-grid">{alerts.map((alert) => <BaseerCard key={alert.id} className="decision-alert"><header><BaseerStatusBadge tone={alert.status === "OPEN" ? "warning" : "neutral"}>{statusCopy(alert.status)}</BaseerStatusBadge><small>{alert.createdAt.slice(0, 10)}</small></header><h3>{alert.titleAr}</h3><p>{alert.ruleCode} · {alert.ruleVersion}</p>{alert.evidenceSnapshotId && <small className="decision-alert__evidence">{language === "ar" ? "حزمة أدلة محفوظة" : "Evidence snapshot preserved"}</small>}<footer>{alert.evidenceSnapshotId && <BaseerButton type="button" variant="quiet" className="decision-alert__evidence-action" style={{ position: "relative", zIndex: 1, minBlockSize: "2.75rem" }} onClick={() => void onViewEvidence(alert.id)}>{language === "ar" ? "عرض الأدلة" : "View evidence"}</BaseerButton>}{canManage && alert.status === "OPEN" && <BaseerButton type="button" variant="quiet" onClick={() => onChangeStatus(alert, "ACKNOWLEDGED")}>{language === "ar" ? "إقرار" : "Acknowledge"}</BaseerButton>}{canManage && alert.status !== "CLOSED" && <BaseerButton type="button" variant="quiet" onClick={() => onChangeStatus(alert, "CLOSED")}>{language === "ar" ? "إغلاق" : "Close"}</BaseerButton>}{canGiveFeedback && <><BaseerButton type="button" variant="quiet" onClick={() => void onFeedback(alert.id, "USEFUL")}>{language === "ar" ? "مفيد" : "Useful"}</BaseerButton><BaseerButton type="button" variant="quiet" onClick={() => void onFeedback(alert.id, "DATA_INCOMPLETE")}>{language === "ar" ? "البيانات ناقصة" : "Data incomplete"}</BaseerButton></>}</footer></BaseerCard>)}</div> : <Empty language={language} message={language === "ar" ? "لا توجد تنبيهات محفوظة بعد." : "No alerts have been saved yet."} />}</div>;
}

function EvidenceDetails({ language, evidence }: { language: Language; evidence: AlertEvidence }) {
  const copy = evidenceCopy[language];
  const payload = evidence.snapshot.payload as { comparison?: SalesComparison; policy?: SalesChangePolicy; outcome?: string; coverage?: SalesMetric["coverage"]; relatedContext?: Array<{ id: string; scope: "GLOBAL" | "AREA" | "COMPANY"; eventKind: string; titleAr: string; startsOn: string; endsOn: string; overlaps: Array<"CURRENT_PERIOD" | "COMPARISON_PERIOD">; verificationStatus: string; sourceCode: string; sourceReference: string | null; locationLabelAr: string | null; relationship: "TEMPORAL_CONTEXT_ONLY" }> };
  const comparison = payload.comparison;
  const relatedContext = payload.relatedContext ?? [];
  const overlapLabel = (overlaps: readonly ("CURRENT_PERIOD" | "COMPARISON_PERIOD")[]) => overlaps.length === 2 ? copy.bothPeriods : overlaps[0] === "CURRENT_PERIOD" ? copy.currentPeriod : copy.comparisonPeriod;
  return <div className="decision-evidence__content">
    <BaseerStatusBadge tone={evidence.snapshot.checksumValid ? "success" : "danger"}>{evidence.snapshot.checksumValid ? copy.checksumValid : copy.checksumInvalid}</BaseerStatusBadge>
    <dl><div><dt>{copy.period}</dt><dd>{evidence.snapshot.periodFrom} — {evidence.snapshot.periodTo}</dd></div><div><dt>{copy.evidenceKind}</dt><dd>{evidence.snapshot.evidenceKind}</dd></div><div><dt>{copy.verification}</dt><dd>{evidence.snapshot.verificationStatus}</dd></div><div><dt>{copy.checksum}</dt><dd className="decision-evidence__checksum">{evidence.snapshot.checksum}</dd></div></dl>
    {comparison ? <BaseerSummaryMetricGrid ariaLabel={copy.figures}><BaseerSummaryMetric label={copy.currentSales} value={formatMoney(comparison.payload.currentNetAmount)} /><BaseerSummaryMetric label={copy.comparisonSales} value={formatMoney(comparison.payload.comparisonNetAmount)} /><BaseerSummaryMetric label={copy.difference} value={formatMoney(comparison.payload.differenceNetAmount)} /><BaseerSummaryMetric label={copy.change} value={comparison.payload.percentDifference === null ? "—" : `${comparison.payload.percentDifference}%`} /></BaseerSummaryMetricGrid> : <p>{copy.fallback}</p>}
    <div className="decision-evidence__context"><h4>{copy.relatedContext}</h4><p>{copy.relatedContextDescription}</p>{relatedContext.length ? <ul className="decision-list">{relatedContext.map((item) => <li key={`${item.scope}-${item.id}`}><strong>{item.titleAr}</strong><small>{item.startsOn} — {item.endsOn} · {overlapLabel(item.overlaps)} · {item.scope} · {item.sourceCode}{item.locationLabelAr ? ` · ${item.locationLabelAr}` : ""}</small></li>)}</ul> : <p className="decision-muted">{copy.noRelatedContext}</p>}</div>
    {evidence.actions.length ? <div><h4>{copy.lifecycle}</h4><ul className="decision-list">{evidence.actions.map((action, index) => <li key={`${action.createdAt}-${index}`}><strong>{action.action === "ACKNOWLEDGED" ? copy.acknowledged : copy.closed}</strong><small>{action.reason} · {new Date(action.createdAt).toLocaleString(language === "ar" ? "ar-SA" : "en", { timeZone: "Asia/Riyadh" })}</small></li>)}</ul></div> : null}
  </div>;
}

function QualityPanel({ language, metric, canManagePolicies, onEvaluate }: { language: Language; metric: SalesMetric | null; canManagePolicies: boolean; onEvaluate: () => Promise<void> }) {
  if (!metric) return <Empty language={language} message={language === "ar" ? "لا تملك صلاحية عرض جودة البيانات." : "You do not have access to data quality."} />;
  return <div className="decision-workspace__stack"><BaseerCard className="decision-quality-card"><header className="decision-card__header"><div><h3>{language === "ar" ? "جودة قراءة المبيعات" : "Sales read quality"}</h3><p>{language === "ar" ? "المصدر هو الملخص المالي المتصالح مع القيود؛ لا تُقرأ أرقام من المتصفح." : "The source is the journal-reconciled financial summary; numbers are never read from the browser."}</p></div><BaseerStatusBadge tone={qualityTone[metric.dataQuality]}>{qualityCopy[language][metric.dataQuality]}</BaseerStatusBadge></header><dl><div><dt>{language === "ar" ? "الأيام المطلوبة" : "Required days"}</dt><dd>{metric.coverage.requiredDays}</dd></div><div><dt>{language === "ar" ? "الأيام المتاحة" : "Available days"}</dt><dd>{metric.coverage.availableDays}</dd></div><div><dt>{language === "ar" ? "الأيام الناقصة" : "Missing days"}</dt><dd>{metric.coverage.missingDays.length ? metric.coverage.missingDays.join("، ") : "—"}</dd></div><div><dt>{language === "ar" ? "آخر تسوية" : "Source freshness"}</dt><dd>{metric.sourceFreshAt ? new Date(metric.sourceFreshAt).toLocaleString(language === "ar" ? "ar-SA" : "en", { timeZone: "Asia/Riyadh" }) : "—"}</dd></div></dl>{canManagePolicies && <footer><BaseerButton type="button" onClick={() => void onEvaluate()}>{language === "ar" ? "تشغيل فحص الجودة" : "Run quality check"}</BaseerButton></footer>}</BaseerCard></div>;
}

function exactPositiveDecimal(value: string) { return /^\d+(?:\.\d{1,4})?$/.test(value) && /[1-9]/.test(value.replace(".", "")); }
function exactBasisPoints(value: string) { const match = /^(100|[1-9]?\d)(?:\.(\d{1,2}))?$/.exec(value); if (!match) return null; const basisPoints = parseInt(`${match[1]}${(match[2] ?? "").padEnd(2, "0")}`, 10); return basisPoints >= 1 && basisPoints <= 10_000 ? basisPoints : null; }
function exactHours(value: string) { if (!/^\d+$/.test(value)) return null; const hours = parseInt(value, 10); return hours >= 1 && hours <= 720 ? hours : null; }

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
  const save = async (values: { enabled: boolean; decrease: string; increase: string; baseline: string; difference: string; cooldownHours: string }) => {
    const decreaseThresholdBasisPoints = exactBasisPoints(values.decrease);
    const increaseThresholdBasisPoints = exactBasisPoints(values.increase);
    const cooldown = exactHours(values.cooldownHours);
    if (values.enabled && (!decreaseThresholdBasisPoints || !increaseThresholdBasisPoints || !exactPositiveDecimal(values.baseline) || !exactPositiveDecimal(values.difference) || !cooldown)) return;
    setBusy(true);
    try { await onSavePolicy({ enabled: values.enabled, decreaseThresholdBasisPoints: values.enabled ? decreaseThresholdBasisPoints : null, increaseThresholdBasisPoints: values.enabled ? increaseThresholdBasisPoints : null, minimumBaselineAmount: values.enabled ? values.baseline : null, minimumAbsoluteDifferenceAmount: values.enabled ? values.difference : null, cooldownHours: values.enabled ? cooldown : null }); } finally { setBusy(false); }
  };
  const evaluate = async () => { setBusy(true); try { await onEvaluate(); } finally { setBusy(false); } };
  const values = { enabled, decrease, increase, baseline, difference, cooldownHours };
  const invalidPolicy = enabled && (!exactBasisPoints(decrease) || !exactBasisPoints(increase) || !exactPositiveDecimal(baseline) || !exactPositiveDecimal(difference) || !exactHours(cooldownHours));
  return <BaseerCard className="decision-sales-policy"><BaseerValidatedFormField id="decision-sales-policy" className="decision-sales-policy__form" values={values} schemaFactory={({ z }) => z.object({ enabled: z.boolean(), decrease: z.string(), increase: z.string(), baseline: z.string(), difference: z.string(), cooldownHours: z.string() }).superRefine((value, context) => { if (!value.enabled) return; if (!exactBasisPoints(value.decrease)) context.addIssue({ code: "custom", path: ["decrease"], message: language === "ar" ? "أدخل نسبة بين 0.01 و100 بدقتين عشريتين كحد أقصى." : "Enter a percentage from 0.01 to 100 with up to two decimals." }); if (!exactBasisPoints(value.increase)) context.addIssue({ code: "custom", path: ["increase"], message: language === "ar" ? "أدخل نسبة بين 0.01 و100 بدقتين عشريتين كحد أقصى." : "Enter a percentage from 0.01 to 100 with up to two decimals." }); if (!exactPositiveDecimal(value.baseline)) context.addIssue({ code: "custom", path: ["baseline"], message: language === "ar" ? "أدخل مبلغاً موجباً حتى أربع خانات عشرية." : "Enter a positive amount with up to four decimals." }); if (!exactPositiveDecimal(value.difference)) context.addIssue({ code: "custom", path: ["difference"], message: language === "ar" ? "أدخل مبلغاً موجباً حتى أربع خانات عشرية." : "Enter a positive amount with up to four decimals." }); if (!exactHours(value.cooldownHours)) context.addIssue({ code: "custom", path: ["cooldownHours"], message: language === "ar" ? "أدخل عدداً صحيحاً من 1 إلى 720." : "Enter an integer from 1 to 720." }); })} onValid={(next) => void save(next)} errorSummaryLabel={language === "ar" ? "راجع قيم سياسة التنبيه." : "Review the alert-policy values."}>{({ errors }) => <><header className="decision-card__header"><div><h3>{copy.title}</h3><p>{copy.description}</p></div><BaseerStatusBadge tone={enabled ? "success" : "neutral"}>{enabled ? copy.active : copy.disabled}</BaseerStatusBadge></header><label className="decision-sales-policy__toggle"><input checked={enabled} disabled={busy} type="checkbox" onChange={(event) => setEnabled(event.target.checked)} />{copy.enabled}</label><div className="decision-sales-policy__thresholds"><label>{copy.decrease}<span><input aria-invalid={Boolean(errors.decrease)} disabled={!enabled || busy} inputMode="decimal" value={decrease} onChange={(event) => setDecrease(event.target.value)} />{copy.percent}</span>{errors.decrease ? <small role="alert">{errors.decrease.message}</small> : null}</label><label>{copy.increase}<span><input aria-invalid={Boolean(errors.increase)} disabled={!enabled || busy} inputMode="decimal" value={increase} onChange={(event) => setIncrease(event.target.value)} />{copy.percent}</span>{errors.increase ? <small role="alert">{errors.increase.message}</small> : null}</label><label>{copy.baseline}<input aria-invalid={Boolean(errors.baseline)} disabled={!enabled || busy} inputMode="decimal" dir="ltr" value={baseline} onChange={(event) => setBaseline(event.target.value)} />{errors.baseline ? <small role="alert">{errors.baseline.message}</small> : null}</label><label>{copy.difference}<input aria-invalid={Boolean(errors.difference)} disabled={!enabled || busy} inputMode="decimal" dir="ltr" value={difference} onChange={(event) => setDifference(event.target.value)} />{errors.difference ? <small role="alert">{errors.difference.message}</small> : null}</label><label>{copy.cooldown}<span><input aria-invalid={Boolean(errors.cooldownHours)} disabled={!enabled || busy} inputMode="numeric" value={cooldownHours} onChange={(event) => setCooldownHours(event.target.value)} />{copy.hours}</span>{errors.cooldownHours ? <small role="alert">{errors.cooldownHours.message}</small> : null}</label></div><footer><BaseerButton type="submit" variant="secondary" disabled={busy || invalidPolicy}>{copy.save}</BaseerButton><BaseerButton type="button" disabled={busy || invalidPolicy} onClick={() => void evaluate()}>{copy.run}</BaseerButton></footer></>}</BaseerValidatedFormField></BaseerCard>;
}

function SourcesPolicyPanel({ language, candidates, reviews, sourceHealth, canManage, researchBusy, onResearch, onResolve, onResolveReview }: { language: Language; candidates: ContextCandidate[]; reviews: ContextReview[]; sourceHealth: ContextSourceHealth[]; canManage: boolean; researchBusy: boolean; onResearch: () => Promise<void>; onResolve: (candidateId: string, action: "APPROVE" | "DISMISS") => Promise<void>; onResolveReview: (eventId: string, revision: number, action: "APPROVE" | "DISMISS") => Promise<void> }) {
  const readinessTone = (readiness: ContextSourceHealth["readiness"]): BaseerStatusTone => readiness === "READY_TO_SYNC" || readiness === "READY_LOCAL_CATALOG" ? "success" : readiness === "NOT_CONFIGURED" || readiness === "REQUIRES_APPROVED_ADAPTER" ? "warning" : "neutral";
  const readinessCopy = (readiness: ContextSourceHealth["readiness"]) => language === "ar" ? ({ NOT_REGISTERED: "غير مسجل", DISABLED: "معطل", READY_LOCAL_CATALOG: "كتالوج محلي", REQUIRES_APPROVED_ADAPTER: "يتطلب موصلاً معتمداً", NOT_CONFIGURED: "الموصل غير مهيأ", READY_TO_SYNC: "جاهز للفحص" }[readiness]) : ({ NOT_REGISTERED: "Not registered", DISABLED: "Disabled", READY_LOCAL_CATALOG: "Local catalogue", REQUIRES_APPROVED_ADAPTER: "Approved adapter required", NOT_CONFIGURED: "Connector not configured", READY_TO_SYNC: "Ready to scan" }[readiness]);
  return <div className="decision-workspace__stack"><BaseerCard className="decision-policy"><h3>{language === "ar" ? "المصادر والسياسات المعتمدة" : "Approved sources and policies"}</h3><ul><li><strong>{language === "ar" ? "المالية" : "Finance"}</strong><span>{language === "ar" ? "قراءات خادمية متصالحة مع Journal." : "Server-side reads reconciled with the Journal."}</span></li><li><strong>{language === "ar" ? "السياق العام" : "Public context"}</strong><span>{language === "ar" ? "المستورد الدوري مقيد بمصادر حكومية مسجلة ووثائق أحداث قابلة للتحقق؛ الفشل أو التعارض يبقى للمراجعة ولا ينشر تكراراً." : "The scheduled importer accepts only registered government sources and verifiable event documents; failures and conflicts require review and never duplicate an event."}</span></li><li><strong>{language === "ar" ? "باحث السياق" : "Context researcher"}</strong><span>{language === "ar" ? "يفحص صفحات الطقس الرسمية للمدن المعتمدة يومياً، وموصل المباريات أسبوعياً، ويقترح مرشحات منفصلة. لا يبحث الويب المفتوح، ولا يضيف حدثاً إلى التحليل قبل الاعتماد." : "Daily scans read fixed official weather pages for approved cities; fixture connectors are scanned weekly. Both only propose candidates and never add an event before approval."}</span></li><li><strong>Google Ads</strong><span>{language === "ar" ? "قراءة وتحليل فقط عند اعتماد الموصل." : "Read and analysis only after connector approval."}</span></li><li><strong>Google Business Profile</strong><span>{language === "ar" ? "النشر اليدوي المؤكد فقط بعد اعتماد Google وسياسة الاحتفاظ." : "Confirmed manual publishing only after Google approval and retention policy."}</span></li><li><strong>{language === "ar" ? "بصيرة" : "Basira"}</strong><span>{language === "ar" ? "تفسّر الأدلة ولا تملك وصولاً حراً إلى الجداول أو صلاحية فعل خارجي." : "Explains evidence; it has no free database access or external action authority."}</span></li></ul></BaseerCard>{canManage ? <><BaseerCard className="decision-research"><header className="decision-card__header"><div><h3>{language === "ar" ? "صحة الموصلات والمصادر" : "Connector and source health"}</h3><p>{language === "ar" ? "حالة صريحة لكل مصدر؛ غياب المرشحات لا يعني غياب الأحداث، بل قد يعني أن الموصل غير مهيأ أو يحتاج مراجعة." : "Each source has an explicit state. No candidates does not prove there are no events; a connector can be unconfigured or require review."}</p></div></header>{sourceHealth.length ? <ol className="decision-timeline">{sourceHealth.map((source) => <li key={source.sourceCode}><span className={`decision-timeline__scope ${source.category === "RESEARCH" ? "is-company" : "is-global"}`}>{source.category === "RESEARCH" ? (language === "ar" ? "باحث" : "Research") : (language === "ar" ? "رسمي" : "Official")}</span><div><strong>{source.displayNameAr}</strong><small>{source.readinessReason}</small>{source.lastRun ? <small>{language === "ar" ? "آخر محاولة" : "Last attempt"}: {new Date(source.lastRun.startedAt).toLocaleString(language === "ar" ? "ar-SA" : "en", { timeZone: "Asia/Riyadh" })} · {source.lastRun.status}</small> : <small>{language === "ar" ? "لم تُسجل محاولة بعد." : "No attempt has been recorded yet."}</small>}</div><BaseerStatusBadge tone={readinessTone(source.readiness)}>{readinessCopy(source.readiness)}</BaseerStatusBadge></li>)}</ol> : <p className="decision-muted">{language === "ar" ? "لم تسجل المصادر بعد؛ شغّل الفحص أو فعّل الموصل المعتمد." : "Sources have not been registered yet; run a scan or configure an approved connector."}</p>}</BaseerCard><BaseerCard className="decision-research"><header className="decision-card__header"><div><h3>{language === "ar" ? "مراجعات المصادر العامة" : "Public source reviews"}</h3><p>{language === "ar" ? "لا تستبدل المراجعة الجديدة النسخة المنشورة حتى يعتمدها مسؤول مخول، والرفض يبقي النسخة السابقة." : "A changed record never replaces the published revision until a delegated reviewer approves it; dismissal keeps the prior revision."}</p></div></header>{reviews.length ? <ol className="decision-timeline">{reviews.flatMap((review) => review.revisions.map((revision) => <li key={`${review.id}-${revision.revision}`}><span className="decision-timeline__scope is-global">{language === "ar" ? "مراجعة" : "Review"}</span><div><strong>{revision.titleAr}</strong><small>{revision.startsOn.slice(0, 10)} — {revision.endsOn.slice(0, 10)} · {review.source.displayNameAr} · v{revision.revision}</small></div><footer><BaseerButton type="button" variant="quiet" disabled={researchBusy} onClick={() => void onResolveReview(review.id, revision.revision, "APPROVE")}>{language === "ar" ? "اعتماد النسخة" : "Approve revision"}</BaseerButton><BaseerButton type="button" variant="quiet" disabled={researchBusy} onClick={() => void onResolveReview(review.id, revision.revision, "DISMISS")}>{language === "ar" ? "رفض التغيير" : "Dismiss change"}</BaseerButton></footer></li>))}</ol> : <p className="decision-muted">{language === "ar" ? "لا توجد مراجعات معلقة للمصادر العامة." : "There are no pending public-source reviews."}</p>}</BaseerCard><BaseerCard className="decision-research"><header className="decision-card__header"><div><h3>{language === "ar" ? "مرشحات باحث السياق" : "Context researcher candidates"}</h3><p>{language === "ar" ? "لا يظهر المرشح في خط الزمن ولا يقرأه بصيرة قبل الاعتماد. المطابقة تمنع تكرار إجازة أو مناسبة منشورة." : "A candidate is excluded from the timeline and Basira until approved. Matching prevents a duplicate holiday or published event."}</p></div><BaseerButton type="button" variant="secondary" disabled={researchBusy} onClick={() => void onResearch()}>{language === "ar" ? "فحص المصادر الآن" : "Scan sources now"}</BaseerButton></header>{candidates.length ? <ol className="decision-timeline">{candidates.map((candidate) => <li key={candidate.id}><span className="decision-timeline__scope is-global">{language === "ar" ? "مرشح" : "Candidate"}</span><div><strong>{candidate.titleAr}</strong><small>{candidate.startsOn.slice(0, 10)} — {candidate.endsOn.slice(0, 10)} · {candidate.source.displayNameAr}{candidate.locationLabelAr ? ` · ${candidate.locationLabelAr}` : ""}</small>{candidate.relevanceReasonAr ? <small>{candidate.relevanceReasonAr}</small> : null}</div><footer><BaseerButton type="button" variant="quiet" disabled={researchBusy} onClick={() => void onResolve(candidate.id, "APPROVE")}>{language === "ar" ? "اعتماد" : "Approve"}</BaseerButton><BaseerButton type="button" variant="quiet" disabled={researchBusy} onClick={() => void onResolve(candidate.id, "DISMISS")}>{language === "ar" ? "تجاهل" : "Dismiss"}</BaseerButton></footer></li>)}</ol> : <p className="decision-muted">{language === "ar" ? "لا توجد مرشحات معلقة. الطقس يعمل من صفحات الأرصاد الرسمية؛ أما المباريات فتحتاج الموصل المعتمد في بيئة الخادم." : "There are no pending candidates. Weather uses the fixed official NCM pages; fixtures still need their approved server connector."}</p>}</BaseerCard></> : null}<BaseerCard className="decision-workspace__notice"><strong>{language === "ar" ? "قاعدة التحليل" : "Analysis rule"}</strong><p>{language === "ar" ? "تستخدم كل قراءة سياسة مقارنة مخصصة ومرقمة. يظهر الارتباط الزمني كفرضية، وليس كسبب مؤكد." : "Each read uses a dedicated, versioned comparison policy. Temporal association is shown as a hypothesis, never as confirmed cause."}</p></BaseerCard></div>;
}

function Empty({ language, message }: { language: Language; message: string }) { return <BaseerCard className="baseer-empty-state"><span className="baseer-empty-state__mark" aria-hidden="true">◌</span><div><strong>{language === "ar" ? "لا توجد قراءة متاحة" : "No read available"}</strong><p>{message}</p></div></BaseerCard>; }
