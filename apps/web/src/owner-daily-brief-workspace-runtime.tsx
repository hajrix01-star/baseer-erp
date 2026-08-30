import { useEffect, useMemo, useRef, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerTextInput } from "./baseer-form-fields";
import { BaseerWorkspace } from "./baseer-workspace";
import { activeSession, api, requestId } from "./daily-sales-client";
import { formatCount, formatLongDate, formatTime } from "./number-format";
import "./owner-daily-brief-workspace.css";

type Language = "ar" | "en";
type NotebookPaperTone = "notebook-yellow" | "pure-white" | "soft-yellow";
type SalesStatus = "READY" | "INCOMPLETE" | "NO_DATA";

type OwnerDailyBriefApi = Readonly<{
  reportDate: string;
  generatedAt: string;
  currency: Readonly<{ code: string | null; status: "SINGLE_CURRENCY" | "MIXED_OR_UNCONFIGURED" }>;
  financialContract?: Readonly<{ amountBasis: "GROSS_VAT_INCLUSIVE"; dataAuthority: "BACKEND_DAILY_FINANCIAL_SUMMARY" }>;
  totals: Readonly<{
    activeCompanyCount: number; readyCompanyCount: number; incompleteCompanyCount: number; noDataCompanyCount: number;
    display?: Readonly<{ yesterdaySalesGrossAmount: string | null; yesterdayPurchasesGrossAmount: string | null; monthToDateSalesGrossAmount: string | null; monthToDatePurchasesGrossAmount: string | null; purchaseToSalesPercent: string | null }>;
  }>;
  companies: readonly Readonly<{
    companyId: string; nameAr: string; nameEn: string; currencyCode: string | null;
    sales: Readonly<{
      yesterdayStatus: SalesStatus; monthToDateStatus: SalesStatus;
      requiredMonthToDateOperatingDayCount?: number; recordedMonthToDateDayCount?: number; scheduledClosedMonthToDateDayCount?: number; partialMonthToDateDayCount?: number; missingMonthToDateDayCount?: number;
      display?: Readonly<{ yesterdayGrossAmount: string | null; monthToDateGrossAmount: string | null; dailyChangeGrossAmount: string | null; dailyAverageGrossAmount: string | null; monthEndForecastGrossAmount: string | null; priorPeriodTrendPercent: string | null; purchaseToSalesPercent: string | null }>;
      trend?: readonly Readonly<{ businessDate: string; grossAmountDisplay?: string | null; barHeightPercent?: number | null }>[];
    }>;
  }>[];
  marketing: Readonly<{
    activeCampaignCount: number;
    display?: Readonly<{ plannedCostAmount: string | null; linkedPostedSpendMonthToDate: string | null }>;
  }>;
  inboundEmail: Readonly<{ readiness: "NOT_CONFIGURED" | "RULES_CONFIGURED_NO_MAILBOX_CONNECTED"; labelCount: number; enabledRuleCount: number; importedMessageCount: number; note: string }>;
}>;

type OwnerDailyBriefHistoryApi = Readonly<{ reports: readonly OwnerDailyBriefApi[] }>;
type DailyBriefReceipt = OwnerDailyBriefApi & Readonly<{ reports?: readonly OwnerDailyBriefApi[] }>;
type ChatMessage = Readonly<{ id: number; role: "assistant" | "user"; content: string }>;
type BasiraAnswerReceipt = Readonly<{ answer: { summary: string; evidence: readonly string[]; limitations: readonly string[] } }>;

const notebookPaperToneStorageKey = "baseer-erp.owner-daily-brief.paper-tone.v1";

function readNotebookPaperTone(): NotebookPaperTone {
  const stored = localStorage.getItem(notebookPaperToneStorageKey);
  return stored === "pure-white" || stored === "soft-yellow" || stored === "notebook-yellow" ? stored : "notebook-yellow";
}

function reportList(receipt: DailyBriefReceipt): OwnerDailyBriefApi[] {
  const reports = receipt.reports?.length ? [...receipt.reports] : [receipt];
  return reports.sort((left, right) => right.reportDate.localeCompare(left.reportDate));
}

function statusLabel(status: SalesStatus, language: Language) {
  if (status === "READY") return language === "ar" ? "مكتمل" : "Ready";
  if (status === "NO_DATA") return language === "ar" ? "لا توجد أيام تشغيل" : "No operating days";
  return language === "ar" ? "بيانات غير مكتملة" : "Data incomplete";
}

function reportDate(value: string, language: Language) { return formatLongDate(value, language); }
function timestamp(value: string, language: Language) { return formatTime(value, language, "Asia/Riyadh"); }
function display(value: string | null | undefined) { return value ?? "—"; }

function marketingInsight(report: OwnerDailyBriefApi, language: Language) {
  const campaigns = report.marketing.activeCampaignCount;
  const spend = display(report.marketing.display?.linkedPostedSpendMonthToDate);
  if (campaigns === 0) return language === "ar"
    ? "لا توجد حملات نشطة مسجلة في هذه اللقطة. لا يمكن الاستنتاج عن أداء الإعلانات الخارجية قبل ربط مصدرها المعتمد."
    : "No active campaigns are recorded in this snapshot. External-ad performance cannot be inferred before an approved source is connected.";
  return language === "ar"
    ? `${formatCount(campaigns, language)} حملات نشطة وصرف مرتبط قدره ${spend}. القراءة تصف البيانات المسجلة ولا تثبت سببًا للمبيعات.`
    : `${formatCount(campaigns, language)} active campaigns with ${spend} in linked spend. This reading describes recorded data; it does not prove sales causation.`;
}

function recommendationsFor(report: OwnerDailyBriefApi, language: Language) {
  const incomplete = report.companies.filter((company) => company.sales.monthToDateStatus !== "READY");
  if (incomplete.length) return [language === "ar"
    ? `راجع إقفال المبيعات لـ ${incomplete.map((company) => company.nameAr).join("، ")} قبل اتخاذ قرار مالي.`
    : `Review sales close for ${incomplete.map((company) => company.nameEn).join(", ")} before making a financial decision.`];
  return [language === "ar"
    ? "استمر في متابعة الإقفال اليومي والصرف المرتبط بالحملات؛ لا توجد إشارة آلية تحتاج تصعيدًا في هذه اللقطة."
    : "Continue to monitor daily closes and campaign-linked spend; this snapshot has no automated escalation signal."];
}

function mailNarrative(report: OwnerDailyBriefApi, language: Language) {
  if (report.inboundEmail.readiness === "NOT_CONFIGURED") return language === "ar"
    ? "البريد غير متصل حاليًا؛ لن يُعرض ملخص أو توصية حتى يتم ربط مصدر البريد واستيراد الرسائل."
    : "Mail is not connected yet; no summary or recommendation is shown until a mail source is connected and messages are imported.";
  return language === "ar"
    ? "قواعد البريد مهيأة، لكن لا يوجد مصدر بريد متصل أو رسائل مستوردة بعد."
    : "Mail rules are configured, but no mailbox source or imported messages are available yet.";
}

export function OwnerDailyBriefWorkspaceRuntime({ language }: { language: Language }) {
  const ar = language === "ar";
  const [receipt, setReceipt] = useState<DailyBriefReceipt | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [paperTone, setPaperTone] = useState<NotebookPaperTone>(readNotebookPaperTone);
  const nextMessage = useRef(1);

  useEffect(() => { localStorage.setItem(notebookPaperToneStorageKey, paperTone); }, [paperTone]);
  const load = async () => {
    const session = activeSession();
    if (!session) { setError(ar ? "انتهت الجلسة. سجّل الدخول ثم أعد المحاولة." : "Your session has ended. Sign in and try again."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const [current, history] = await Promise.all([
        api<OwnerDailyBriefApi>(session, "/owner/daily-brief"),
        api<OwnerDailyBriefHistoryApi>(session, "/owner/daily-brief/history?limit=60").catch(() => null),
      ]);
      setReceipt({ ...current, reports: [current, ...(history?.reports ?? []).filter((entry) => entry.reportDate !== current.reportDate)] });
      setSelectedDate(null);
    } catch (reason) { setError(presentBaseerApiError(reason, language, ar ? "تعذر تحميل دفتر المالك اليومي." : "The owner's daily brief could not be loaded.")); }
    finally { setLoading(false); }
  };
  useEffect(() => { void load(); }, [language]);

  const reports = useMemo(() => receipt ? reportList(receipt) : [], [receipt]);
  const report = reports.find((entry) => entry.reportDate === selectedDate) ?? reports[0] ?? null;
  useEffect(() => {
    if (!report) return;
    setMessages([{ id: 0, role: "assistant", content: ar
      ? `أنا بصيرة. أقرأ لقطة ${reportDate(report.reportDate, language)} فقط، وأربط أي توصية بأدلتها.`
      : `I am Basira. I read only the ${reportDate(report.reportDate, language)} snapshot and ground every recommendation in its evidence.` }]);
  }, [ar, language, report?.reportDate]);

  const submitQuestion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = question.trim();
    if (!value || !report) return;
    const id = nextMessage.current++;
    const answerId = id + .1;
    setMessages((current) => [...current, { id, role: "user", content: value }, { id: answerId, role: "assistant", content: ar ? "أراجع لقطة الدفتر…" : "Reviewing the notebook snapshot…" }]);
    setQuestion("");
    const session = activeSession();
    if (!session) return;
    try {
      const response = await api<BasiraAnswerReceipt>(session, "/owner/daily-brief/basira-answers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportDate: report.reportDate, question: value, language, idempotencyKey: requestId() }),
      });
      const content = [response.answer.summary, ...response.answer.evidence, ...response.answer.limitations.map((item) => `${ar ? "الحدود: " : "Limit: "}${item}`)].join("\n");
      setMessages((current) => current.map((message) => message.id === answerId ? { ...message, content } : message));
    } catch {
      setMessages((current) => current.map((message) => message.id === answerId ? { ...message, content: ar ? "تعذر الاتصال ببصيرة الحية؛ راجع اللقطة وحالة التغطية المعروضة." : "Basira live is unavailable; review the displayed snapshot and coverage status." } : message));
    }
  };

  if (loading) return <BaseerWorkspace className="owner-daily-brief"><div dir={ar ? "rtl" : "ltr"}><p className="owner-daily-brief__state">{ar ? "جارٍ فتح دفتر المالك…" : "Opening the owner’s notebook…"}</p></div></BaseerWorkspace>;
  if (error || !report) return <BaseerWorkspace className="owner-daily-brief"><div dir={ar ? "rtl" : "ltr"}><BaseerCard className="owner-daily-brief__failure"><strong>{error || (ar ? "لا توجد لقطة يومية متاحة." : "No daily snapshot is available.")}</strong><BaseerButton type="button" onClick={() => void load()}>{ar ? "إعادة المحاولة" : "Try again"}</BaseerButton></BaseerCard></div></BaseerWorkspace>;

  return <BaseerWorkspace className="owner-daily-brief"><div className="owner-daily-brief__paper" data-paper-tone={paperTone} dir={ar ? "rtl" : "ltr"}>
    <header className="owner-daily-brief__notebook-intro"><div><span>{ar ? "مركز القيادة · للمالك فقط" : "Command center · owner only"}</span><p>{ar ? "لقطة خادمية محفوظة؛ كل القيم المالية إجمالية شاملة الضريبة." : "A server-owned saved snapshot; every financial value is gross and VAT inclusive."}</p></div><details className="owner-daily-brief__paper-tone"><summary aria-label={ar ? "تغيير لون الدفتر" : "Change notebook color"}><span aria-hidden="true">◐</span><span>{ar ? "لون الدفتر" : "Notebook color"}</span></summary><div role="group" aria-label={ar ? "ألوان الدفتر" : "Notebook colors"}>{([{ id: "notebook-yellow", ar: "أصفر الدفتر", en: "Notebook yellow" }, { id: "pure-white", ar: "أبيض ناصع", en: "Pure white" }, { id: "soft-yellow", ar: "أصفر فاتح", en: "Soft yellow" }] as const).map((tone) => <button key={tone.id} type="button" aria-pressed={paperTone === tone.id} onClick={(event) => { setPaperTone(tone.id); event.currentTarget.closest("details")?.removeAttribute("open"); }}><span className={`owner-daily-brief__paper-tone-swatch is-${tone.id}`} /><span>{ar ? tone.ar : tone.en}</span></button>)}</div></details></header>
    <section className="owner-daily-brief__company-summary" aria-label={ar ? "ملخص الشركات اليومي" : "Daily company summaries"}><div className="owner-daily-brief__companies">{report.companies.map((company) => <CompanyCard key={company.companyId} company={company} language={language} />)}</div></section>
    <section className="owner-daily-brief__section owner-daily-brief__marketing"><div className="owner-daily-brief__section-title"><span>{ar ? "التسويق" : "Marketing"}</span><h3>{ar ? "قراءة ذكية منضبطة" : "A grounded smart read"}</h3></div><div className="owner-daily-brief__marketing-body"><div><p className="owner-daily-brief__insight">{marketingInsight(report, language)}</p><ul>{recommendationsFor(report, language).map((item) => <li key={item}>{item}</li>)}</ul></div><dl><div><dt>{ar ? "الحملات النشطة" : "Active campaigns"}</dt><dd dir="ltr">{formatCount(report.marketing.activeCampaignCount, language)}</dd></div><div><dt>{ar ? "الصرف المرتبط" : "Linked spend"}</dt><dd dir="ltr">{display(report.marketing.display?.linkedPostedSpendMonthToDate)}</dd></div></dl></div></section>
    <section className="owner-daily-brief__section owner-daily-brief__mail"><div className="owner-daily-brief__section-title"><span>{ar ? "البريد" : "Mail"}</span><h3>{ar ? "ملخص الرسائل" : "Message summary"}</h3></div><div className="owner-daily-brief__mail-body"><span className={`owner-daily-brief__mail-status is-${report.inboundEmail.readiness.toLowerCase()}`}>{report.inboundEmail.readiness === "NOT_CONFIGURED" ? (ar ? "غير متصل" : "Not connected") : (ar ? "قواعد مهيأة" : "Rules configured")}</span><p>{mailNarrative(report, language)}</p></div></section>
    <BasiraChat language={language} messages={messages} question={question} onQuestionChange={setQuestion} onSubmit={submitQuestion} />
    {reports.length > 1 ? <section className="owner-daily-brief__history"><div className="owner-daily-brief__section-title"><span>{ar ? "الأرشيف اليومي" : "Daily archive"}</span><h3>{ar ? "تقارير سابقة" : "Earlier reports"}</h3></div><div>{reports.slice(1).map((entry) => <button className={`owner-daily-brief__history-entry${entry.reportDate === report.reportDate ? " is-selected" : ""}`} type="button" onClick={() => setSelectedDate(entry.reportDate)} key={entry.reportDate}><span>{reportDate(entry.reportDate, language)}</span><small>{timestamp(entry.generatedAt, language)}</small><bdi dir="ltr">{display(entry.totals.display?.yesterdaySalesGrossAmount)}</bdi></button>)}</div></section> : null}
  </div></BaseerWorkspace>;
}

function CompanyCard({ company, language }: { company: OwnerDailyBriefApi["companies"][number]; language: Language }) {
  const ar = language === "ar";
  const name = ar ? company.nameAr : company.nameEn;
  const values = company.sales.display;
  const coverage = company.sales.requiredMonthToDateOperatingDayCount === undefined || company.sales.recordedMonthToDateDayCount === undefined
    ? null
    : `${company.sales.recordedMonthToDateDayCount}/${company.sales.requiredMonthToDateOperatingDayCount}`;
  return <BaseerCard className="owner-daily-brief__company" padding="compact">
    <header><div><span>{name}</span><small>{ar ? "شامل الضريبة" : "VAT inclusive"}</small></div><em className={`is-${company.sales.monthToDateStatus.toLowerCase()}`}>{statusLabel(company.sales.monthToDateStatus, language)}</em></header>
    <div className="owner-daily-brief__company-sales"><span className="owner-daily-brief__company-sales-label">{ar ? "مبيعات أمس" : "Yesterday's sales"}</span><bdi dir="ltr">{display(values?.yesterdayGrossAmount)}</bdi><span>{ar ? "التغير اليومي: " : "Daily change: "}<strong dir="ltr">{display(values?.dailyChangeGrossAmount)}</strong></span></div>
    <div className="owner-daily-brief__trend" aria-label={ar ? `اتجاه مبيعات ${name}` : `${name} sales trend`}>{company.sales.trend?.length ? company.sales.trend.map((point) => <span key={point.businessDate} className={point.barHeightPercent === null || point.barHeightPercent === undefined ? "is-missing" : ""} style={{ height: `${point.barHeightPercent ?? 8}%` }} aria-label={`${point.businessDate}: ${display(point.grossAmountDisplay)}`} />) : <span className="is-empty">{ar ? "لا تتوفر بيانات اتجاه كافية" : "Trend data is unavailable"}</span>}</div>
    <dl><div><dt>{ar ? "الشهر حتى تاريخه" : "Month to date"}</dt><dd dir="ltr">{display(values?.monthToDateGrossAmount)}</dd></div><div><dt>{ar ? "المتوسط اليومي" : "Daily average"}</dt><dd dir="ltr">{display(values?.dailyAverageGrossAmount)}</dd></div><div><dt>{ar ? "توقع نهاية الشهر" : "Month-end forecast"}</dt><dd dir="ltr">{display(values?.monthEndForecastGrossAmount)}</dd></div><div><dt>{ar ? "مقابل الفترة السابقة" : "Prior period"}</dt><dd dir="ltr">{display(values?.priorPeriodTrendPercent)}</dd></div></dl>
    {coverage ? <small className="owner-daily-brief__coverage">{ar ? `تغطية أيام التشغيل: ${coverage}` : `Operating-day coverage: ${coverage}`}</small> : null}
  </BaseerCard>;
}

function BasiraChat({ language, messages, question, onQuestionChange, onSubmit }: { language: Language; messages: readonly ChatMessage[]; question: string; onQuestionChange: (value: string) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const ar = language === "ar";
  return <section className="owner-daily-brief__chat" aria-label={ar ? "محادثة بصيرة التحليلية" : "Basira analytical conversation"}><header><div><span className="owner-daily-brief__basira-mark" aria-hidden="true">✦</span><div><h3>{ar ? "بصيرة · محللة الترويج والبيانات" : "Basira · Promotion & data analyst"}</h3><p>{ar ? "تحلل الاتجاهات والترويج من اللقطة المعروضة، وليست أداة استعلام أرقام" : "Analyzes promotion and trends from this snapshot; it is not a number lookup tool"}</p></div></div></header><div className="owner-daily-brief__messages" aria-live="polite">{messages.map((message) => <p className={`is-${message.role}`} key={message.id}>{message.content}</p>)}</div><div className="owner-daily-brief__suggestions">{(ar ? ["ما فرص الترويج التي تحتاج متابعة؟", "حلل الصرف المرتبط بالحملات", "ما الاتجاه الذي يحتاج قرارًا؟"] : ["Which promotion opportunities need attention?", "Analyze campaign-linked spend", "Which trend needs a decision?"]).map((item) => <button key={item} type="button" onClick={() => onQuestionChange(item)}>{item}</button>)}</div><form onSubmit={onSubmit}><BaseerTextInput value={question} onChange={(event) => onQuestionChange(event.target.value)} placeholder={ar ? "اسأل عن الترويج أو الاتجاهات…" : "Ask about promotion or trends…"} /><BaseerButton type="submit" disabled={!question.trim()}>{ar ? "إرسال" : "Send"}</BaseerButton></form></section>;
}
