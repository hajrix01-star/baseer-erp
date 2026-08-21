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
  sourceFreshAt: string | null;
  coverage: { requiredDays: number; availableDays: number; missingDays: string[]; excludedDays: Array<{ date: string; reason: string }> };
  payload: { currencyCode: "SAR"; netAmount: string; grossAmount: string; vatAmount: string; customerCount: number };
};
type TimelineEvent = { id: string; scope: "GLOBAL" | "COMPANY"; eventKind: string; titleAr: string; startsOn: string; endsOn: string; verificationStatus: string; sourceReference: string | null };
type Alert = { id: string; ruleCode: string; ruleVersion: string; status: "OPEN" | "ACKNOWLEDGED" | "CLOSED"; titleAr: string; createdAt: string; evidenceSnapshotId: string | null };

const qualityCopy: Record<Language, Record<Quality, string>> = {
  ar: { READY: "جاهزة", NO_DATA: "لا توجد بيانات", INCOMPLETE: "غير مكتملة", STALE: "قديمة", UNAVAILABLE: "غير متاحة", CONFLICTED: "متعارضة" },
  en: { READY: "Ready", NO_DATA: "No data", INCOMPLETE: "Incomplete", STALE: "Stale", UNAVAILABLE: "Unavailable", CONFLICTED: "Conflicted" },
};
const qualityTone: Record<Quality, BaseerStatusTone> = { READY: "success", NO_DATA: "neutral", INCOMPLETE: "warning", STALE: "warning", UNAVAILABLE: "danger", CONFLICTED: "danger" };

export function DecisionIntelligenceWorkspace({ language, section }: { language: Language; section: number }) {
  const [session, setSession] = useState<ActiveSession | null>(activeSession);
  const [period, setPeriod] = useState<BaseerPeriodRange>(defaultBaseerPeriodRange);
  const [metric, setMetric] = useState<SalesMetric | null>(null);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [eventBusy, setEventBusy] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const [eventForm, setEventForm] = useState({ eventKind: "OPERATIONAL_EVENT", titleAr: "", startsOn: period.from, endsOn: period.to, sourceReference: "" });
  const canReadMetrics = hasActivePermission("decision.metrics.read");
  const canReadContext = hasActivePermission("decision.context.read");
  const canReadAlerts = hasActivePermission("decision.alerts.read");
  const canManageCompanyContext = hasActivePermission("decision.context.company.manage");
  const canGiveFeedback = hasActivePermission("decision.feedback.write");
  const canManagePolicies = hasActivePermission("decision.policy.manage");

  const load = useCallback(async () => {
    const current = activeSession();
    setSession(current);
    if (!current) return;
    setLoading(true);
    try {
      const query = new URLSearchParams({ from: period.from, to: period.to }).toString();
      const reads = await Promise.all([
        canReadMetrics ? api<SalesMetric>(current, `/decision-intelligence/metrics/sales-daily?${query}`) : Promise.resolve(null),
        canReadContext ? api<TimelineEvent[]>(current, `/decision-intelligence/context/timeline?${query}`) : Promise.resolve([]),
        canReadAlerts ? api<Alert[]>(current, "/decision-intelligence/alerts?pageSize=50") : Promise.resolve([]),
      ]);
      setMetric(reads[0]);
      setEvents(reads[1]);
      setAlerts(reads[2]);
      setError("");
    } catch (reason) {
      setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر تحميل قراءات مركز القرار. أعد المحاولة." : "Decision reads could not be loaded. Please try again."));
    } finally {
      setLoading(false);
    }
  }, [canReadAlerts, canReadContext, canReadMetrics, language, period.from, period.to]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setEventForm((current) => ({ ...current, startsOn: period.from, endsOn: period.to })); }, [period.from, period.to]);
  const openAlerts = alerts.filter((alert) => alert.status === "OPEN");
  const companyEvents = events.filter((event) => event.scope === "COMPANY");
  const globalEvents = events.filter((event) => event.scope === "GLOBAL");
  const sectionContent = useMemo(() => {
    if (section === 1) return <TimelinePanel language={language} events={events} companyEvents={companyEvents} globalEvents={globalEvents} canManage={canManageCompanyContext} onCreate={() => setEventDialogOpen(true)} />;
    if (section === 2) return <AlertsPanel language={language} alerts={alerts} canGiveFeedback={canGiveFeedback} onFeedback={async (alertId, kind) => {
      const current = activeSession(); if (!current) return;
      try { await api(current, "/decision-intelligence/alerts/feedback", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": requestId() }, body: JSON.stringify({ alertId, kind, idempotencyKey: requestId() }) }); await load(); } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر حفظ التغذية الراجعة." : "Feedback could not be saved.")); }
    }} />;
    if (section === 3) return <QualityPanel language={language} metric={metric} canManagePolicies={canManagePolicies} onEvaluate={async () => {
      const current = activeSession(); if (!current) return;
      try { await api(current, "/decision-intelligence/evaluations/sales-quality", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": requestId() }, body: JSON.stringify({ from: period.from, to: period.to, idempotencyKey: requestId() }) }); await load(); } catch (reason) { setError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر تشغيل فحص الجودة." : "The quality check could not be run.")); } }} />;
    if (section === 4) return <SourcesPolicyPanel language={language} />;
    return <OverviewPanel language={language} metric={metric} events={events} openAlerts={openAlerts} />;
  }, [alerts, canGiveFeedback, canManageCompanyContext, canManagePolicies, companyEvents, events, globalEvents, language, load, metric, openAlerts, period.from, period.to, section]);

  async function createEvent(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = activeSession(); if (!current) return;
    setEventBusy(true); setEventError(null);
    try {
      await api(current, "/decision-intelligence/context/company-events", { method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": requestId() }, body: JSON.stringify({ ...eventForm, sourceReference: eventForm.sourceReference.trim() || undefined, idempotencyKey: requestId() }) });
      setEventDialogOpen(false); setEventForm({ eventKind: "OPERATIONAL_EVENT", titleAr: "", startsOn: period.from, endsOn: period.to, sourceReference: "" }); await load();
    } catch (reason) { setEventError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر حفظ الحدث." : "The event could not be saved.")); } finally { setEventBusy(false); }
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
  </section>;
}

function OverviewPanel({ language, metric, events, openAlerts }: { language: Language; metric: SalesMetric | null; events: TimelineEvent[]; openAlerts: Alert[] }) {
  return <div className="decision-workspace__stack">
    {metric ? <><BaseerSummaryMetricGrid ariaLabel={language === "ar" ? "ملخص الفترة" : "Period summary"}><BaseerSummaryMetric label={language === "ar" ? "صافي المبيعات المثبتة" : "Reconciled net sales"} value={formatMoney(metric.payload.netAmount)} /><BaseerSummaryMetric label={language === "ar" ? "عدد العملاء" : "Customer count"} value={formatNumber(metric.payload.customerCount)} /><BaseerSummaryMetric label={language === "ar" ? "تغطية الأيام" : "Day coverage"} value={`${metric.coverage.availableDays} / ${metric.coverage.requiredDays}`} /><BaseerSummaryMetric label={language === "ar" ? "جودة البيانات" : "Data quality"} value={<BaseerStatusBadge tone={qualityTone[metric.dataQuality]}>{qualityCopy[language][metric.dataQuality]}</BaseerStatusBadge>} /></BaseerSummaryMetricGrid>{metric.dataQuality !== "READY" && <BaseerCard className="decision-workspace__notice"><strong>{language === "ar" ? "لا تُفسّر هذه الفترة كتغير تجاري كامل." : "Do not interpret this period as a complete commercial change."}</strong><p>{language === "ar" ? `هناك ${metric.coverage.missingDays.length} يوم ناقص أو غير محسوم. تُعرض القيم المتاحة ولا تُحوّل الأيام الناقصة إلى صفر.` : `${metric.coverage.missingDays.length} days are missing or unsettled. Available values are shown; missing days are never zero-filled.`}</p></BaseerCard>}</> : <Empty language={language} message={language === "ar" ? "لا تملك صلاحية قراءة مؤشرات هذا المركز." : "You do not have access to the center metrics."} />}
    <div className="decision-workspace__columns"><BaseerCard><header className="decision-card__header"><div><h3>{language === "ar" ? "تنبيهات مفتوحة" : "Open alerts"}</h3><p>{language === "ar" ? "نتيجة قواعد موثقة، وليست استنتاج نموذج ذكاء." : "Results of documented rules, not model conclusions."}</p></div><BaseerStatusBadge tone={openAlerts.length ? "warning" : "success"}>{openAlerts.length}</BaseerStatusBadge></header>{openAlerts.length ? <ul className="decision-list">{openAlerts.slice(0, 4).map((alert) => <li key={alert.id}><strong>{alert.titleAr}</strong><small>{alert.createdAt.slice(0, 10)} · {alert.ruleVersion}</small></li>)}</ul> : <p className="decision-muted">{language === "ar" ? "لا توجد تنبيهات مفتوحة." : "No open alerts."}</p>}</BaseerCard><BaseerCard><header className="decision-card__header"><div><h3>{language === "ar" ? "السياق المتزامن" : "Concurrent context"}</h3><p>{language === "ar" ? "المناسبات والأحداث تساعد في المراجعة، ولا تثبت السبب." : "Events support review; they do not establish cause."}</p></div><BaseerStatusBadge tone="info">{events.length}</BaseerStatusBadge></header>{events.length ? <ul className="decision-list">{events.slice(0, 4).map((item) => <li key={item.id}><strong>{item.titleAr}</strong><small>{item.startsOn} — {item.endsOn} · {item.scope === "GLOBAL" ? (language === "ar" ? "عام" : "Global") : (language === "ar" ? "الشركة" : "Company")}</small></li>)}</ul> : <p className="decision-muted">{language === "ar" ? "لا توجد أحداث مسجلة في الفترة." : "No events are recorded for this period."}</p>}</BaseerCard></div>
  </div>;
}

function TimelinePanel({ language, events, companyEvents, globalEvents, canManage, onCreate }: { language: Language; events: TimelineEvent[]; companyEvents: TimelineEvent[]; globalEvents: TimelineEvent[]; canManage: boolean; onCreate: () => void }) {
  return <div className="decision-workspace__stack"><BaseerCard className="decision-timeline-intro"><div><h3>{language === "ar" ? "خط الزمن والسياق" : "Timeline and context"}</h3><p>{language === "ar" ? "الأحداث العامة تصل من مصادر معتمدة لاحقاً؛ أحداث الشركة لا تعدّل الحقيقة المالية ولا تتحول إلى سبب تلقائياً." : "Public events will come from approved sources; company events never alter financial facts or become automatic causes."}</p></div>{canManage && <BaseerButton type="button" onClick={onCreate}>{language === "ar" ? "إضافة حدث للشركة" : "Add company event"}</BaseerButton>}</BaseerCard><BaseerSummaryMetricGrid><BaseerSummaryMetric label={language === "ar" ? "كل الأحداث" : "All events"} value={events.length} /><BaseerSummaryMetric label={language === "ar" ? "أحداث الشركة" : "Company events"} value={companyEvents.length} /><BaseerSummaryMetric label={language === "ar" ? "مناسبات عامة" : "Public events"} value={globalEvents.length} /></BaseerSummaryMetricGrid>{events.length ? <ol className="decision-timeline">{events.map((item) => <li key={`${item.scope}-${item.id}`}><span className={`decision-timeline__scope is-${item.scope.toLowerCase()}`}>{item.scope === "GLOBAL" ? (language === "ar" ? "عام" : "Global") : (language === "ar" ? "الشركة" : "Company")}</span><div><strong>{item.titleAr}</strong><small>{item.startsOn} — {item.endsOn} · {item.eventKind}</small></div><BaseerStatusBadge tone={item.verificationStatus === "SYSTEM_RECONCILED" ? "success" : "neutral"}>{item.verificationStatus === "SYSTEM_RECONCILED" ? (language === "ar" ? "موثق" : "Reconciled") : (language === "ar" ? "مسجل" : "Recorded")}</BaseerStatusBadge></li>)}</ol> : <Empty language={language} message={language === "ar" ? "لا توجد مناسبات أو أحداث ضمن الفترة المحددة." : "There are no events in the selected period."} />}</div>;
}

function AlertsPanel({ language, alerts, canGiveFeedback, onFeedback }: { language: Language; alerts: Alert[]; canGiveFeedback: boolean; onFeedback: (alertId: string, kind: "USEFUL" | "DATA_INCOMPLETE") => Promise<void> }) {
  return <div className="decision-workspace__stack"><BaseerCard className="decision-timeline-intro"><div><h3>{language === "ar" ? "تنبيهات قابلة للتدقيق" : "Auditable alerts"}</h3><p>{language === "ar" ? "كل تنبيه مرتبط بحزمة أدلة ثابتة عند إنشائه. التغذية الراجعة تحسن التقييمات ولا تدرب النظام تلقائياً." : "Every alert points to frozen evidence. Feedback improves evaluation; it never trains the system automatically."}</p></div></BaseerCard>{alerts.length ? <div className="decision-alert-grid">{alerts.map((alert) => <BaseerCard key={alert.id} className="decision-alert"><header><BaseerStatusBadge tone={alert.status === "OPEN" ? "warning" : "neutral"}>{alert.status === "OPEN" ? (language === "ar" ? "مفتوح" : "Open") : alert.status}</BaseerStatusBadge><small>{alert.createdAt.slice(0, 10)}</small></header><h3>{alert.titleAr}</h3><p>{alert.ruleCode} · {alert.ruleVersion}</p>{alert.evidenceSnapshotId && <small className="decision-alert__evidence">{language === "ar" ? "حزمة الأدلة محفوظة" : "Evidence snapshot preserved"}</small>}{canGiveFeedback && <footer><BaseerButton type="button" variant="quiet" onClick={() => void onFeedback(alert.id, "USEFUL")}>{language === "ar" ? "مفيد" : "Useful"}</BaseerButton><BaseerButton type="button" variant="quiet" onClick={() => void onFeedback(alert.id, "DATA_INCOMPLETE")}>{language === "ar" ? "البيانات ناقصة" : "Data incomplete"}</BaseerButton></footer>}</BaseerCard>)}</div> : <Empty language={language} message={language === "ar" ? "لا توجد تنبيهات محفوظة بعد." : "No alerts have been saved yet."} />}</div>;
}

function QualityPanel({ language, metric, canManagePolicies, onEvaluate }: { language: Language; metric: SalesMetric | null; canManagePolicies: boolean; onEvaluate: () => Promise<void> }) {
  if (!metric) return <Empty language={language} message={language === "ar" ? "لا تملك صلاحية عرض جودة البيانات." : "You do not have access to data quality."} />;
  return <div className="decision-workspace__stack"><BaseerCard className="decision-quality-card"><header className="decision-card__header"><div><h3>{language === "ar" ? "جودة قراءة المبيعات" : "Sales read quality"}</h3><p>{language === "ar" ? "المصدر هو الملخص المالي المتصالح مع القيود؛ لا تُقرأ أرقام من المتصفح." : "The source is the journal-reconciled financial summary; numbers are never read from the browser."}</p></div><BaseerStatusBadge tone={qualityTone[metric.dataQuality]}>{qualityCopy[language][metric.dataQuality]}</BaseerStatusBadge></header><dl><div><dt>{language === "ar" ? "الأيام المطلوبة" : "Required days"}</dt><dd>{metric.coverage.requiredDays}</dd></div><div><dt>{language === "ar" ? "الأيام المتاحة" : "Available days"}</dt><dd>{metric.coverage.availableDays}</dd></div><div><dt>{language === "ar" ? "الأيام الناقصة" : "Missing days"}</dt><dd>{metric.coverage.missingDays.length ? metric.coverage.missingDays.join("، ") : "—"}</dd></div><div><dt>{language === "ar" ? "آخر تسوية" : "Source freshness"}</dt><dd>{metric.sourceFreshAt ? new Date(metric.sourceFreshAt).toLocaleString(language === "ar" ? "ar-SA" : "en", { timeZone: "Asia/Riyadh" }) : "—"}</dd></div></dl>{canManagePolicies && <footer><BaseerButton type="button" onClick={() => void onEvaluate()}>{language === "ar" ? "تشغيل فحص الجودة" : "Run quality check"}</BaseerButton></footer>}</BaseerCard></div>;
}

function SourcesPolicyPanel({ language }: { language: Language }) {
  return <div className="decision-workspace__stack"><BaseerCard className="decision-policy"><h3>{language === "ar" ? "المصادر والسياسات المعتمدة" : "Approved sources and policies"}</h3><ul><li><strong>{language === "ar" ? "المالية" : "Finance"}</strong><span>{language === "ar" ? "قراءات خادمية متصالحة مع Journal." : "Server-side reads reconciled with the Journal."}</span></li><li><strong>{language === "ar" ? "السياق العام" : "Public context"}</strong><span>{language === "ar" ? "المستورد الدوري مقيد بمصادر حكومية مسجلة ووثائق أحداث قابلة للتحقق؛ الفشل أو التعارض يبقى للمراجعة ولا ينشر تكراراً." : "The scheduled importer accepts only registered government sources and verifiable event documents; failures and conflicts require review and never duplicate an event."}</span></li><li><strong>Google Ads</strong><span>{language === "ar" ? "قراءة وتحليل فقط عند اعتماد الموصل." : "Read and analysis only after connector approval."}</span></li><li><strong>Google Business Profile</strong><span>{language === "ar" ? "النشر اليدوي المؤكد فقط بعد اعتماد Google وسياسة الاحتفاظ." : "Confirmed manual publishing only after Google approval and retention policy."}</span></li><li><strong>{language === "ar" ? "بصيرة" : "Basira"}</strong><span>{language === "ar" ? "تفسّر الأدلة ولا تملك وصولاً حراً إلى الجداول أو صلاحية فعل خارجي." : "Explains evidence; it has no free database access or external action authority."}</span></li></ul></BaseerCard><BaseerCard className="decision-workspace__notice"><strong>{language === "ar" ? "قاعدة التحليل" : "Analysis rule"}</strong><p>{language === "ar" ? "تستخدم كل قراءة سياسة مقارنة مخصصة ومرقمة. يظهر الارتباط الزمني كفرضية، وليس كسبب مؤكد." : "Each read uses a dedicated, versioned comparison policy. Temporal association is shown as a hypothesis, never as confirmed cause."}</p></BaseerCard></div>;
}

function Empty({ language, message }: { language: Language; message: string }) { return <BaseerCard className="baseer-empty-state"><span className="baseer-empty-state__mark" aria-hidden="true">◌</span><div><strong>{language === "ar" ? "لا توجد قراءة متاحة" : "No read available"}</strong><p>{message}</p></div></BaseerCard>; }
