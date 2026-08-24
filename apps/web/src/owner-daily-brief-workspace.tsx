import { useEffect, useMemo, useRef, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerSectionHeader, BaseerWorkspace } from "./baseer-workspace";
import { activeSession, api, requestId } from "./daily-sales-client";
import { formatMoney, formatPercent } from "./number-format";
import "./owner-daily-brief-workspace.css";

type Language = "ar" | "en";
type Numeric = string | number | null | undefined;
type DataStatus = "READY" | "PENDING" | "PARTIAL" | "MISSING" | string | null | undefined;

export type OwnerDailyBriefCompany = Readonly<{
  companyId: string;
  nameAr: string;
  nameEn?: string | null;
  currencyCode?: string | null;
  yesterdaySales: Numeric;
  yesterdayPurchases: Numeric;
  monthToDateSales: Numeric;
  monthToDatePurchases: Numeric;
  purchaseToSalesPercent: Numeric;
  salesStatus?: DataStatus;
  purchaseStatus?: DataStatus;
  marketing?: Readonly<{ activeCampaignCount?: number; linkedSpend?: Numeric; plannedSpend?: Numeric }> | null;
}>;

export type OwnerDailyBriefReport = Readonly<{
  id?: string;
  businessDate: string;
  generatedAt?: string | null;
  companies: readonly OwnerDailyBriefCompany[];
  totals?: Readonly<{
    yesterdaySales?: Numeric; yesterdayPurchases?: Numeric; monthToDateSales?: Numeric;
    monthToDatePurchases?: Numeric; purchaseToSalesPercent?: Numeric; currencyCode?: string | null;
  }> | null;
  marketingSummary?: Readonly<{
    activeCampaignCount?: number; linkedSpend?: Numeric; plannedSpend?: Numeric;
    insightAr?: string | null; insightEn?: string | null; recommendationsAr?: readonly string[] | null; recommendationsEn?: readonly string[] | null;
    dataStatus?: DataStatus;
  }> | null;
  mailSummary?: Readonly<{
    status?: "CONNECTED" | "NOT_CONNECTED" | "NO_DATA" | string | null; totalMessages?: number | null;
    unreadCount?: number | null; highlightsAr?: readonly string[] | null; highlightsEn?: readonly string[] | null;
    summaryAr?: string | null; summaryEn?: string | null;
  }> | null;
}>;

type DailyBriefReceipt = OwnerDailyBriefReport & { reports?: readonly OwnerDailyBriefReport[]; history?: readonly OwnerDailyBriefReport[] };
type OwnerDailyBriefApi = Readonly<{
  reportDate: string; generatedAt: string; currency?: { code: string | null }; totals: {
    activeCompanyCount: number; readyCompanyCount: number; incompleteCompanyCount: number; noDataCompanyCount: number;
    yesterdaySalesGrossAmount: Numeric; yesterdayPurchasesGrossAmount: Numeric; monthToDateSalesGrossAmount: Numeric;
    monthToDatePurchasesGrossAmount: Numeric; purchaseToSalesPercent: Numeric;
  };
  companies: readonly Readonly<{
    companyId: string; nameAr: string; nameEn: string; currencyCode: string | null; purchaseToSalesPercent: Numeric;
    sales: { yesterdayGrossAmount: Numeric; monthToDateGrossAmount: Numeric; yesterdayStatus: DataStatus };
    purchases: { yesterdayGrossAmount: Numeric; monthToDateGrossAmount: Numeric };
  }>[];
  marketing: { activeCampaignCount: number; plannedCostAmount: Numeric; linkedPostedSpendMonthToDate: Numeric };
  inboundEmail: { readiness: "NOT_CONFIGURED" | "RULES_CONFIGURED_NO_MAILBOX_CONNECTED"; labelCount: number; enabledRuleCount: number; importedMessageCount: number; note: string };
}>;
type OwnerDailyBriefHistoryApi = Readonly<{ reports: readonly OwnerDailyBriefApi[] }>;
type ChatMessage = Readonly<{ id: number; role: "assistant" | "user"; content: string }>;
type BasiraAnswerReceipt = Readonly<{ answer: { summary: string; evidence: readonly string[]; limitations: readonly string[]; followupChips: readonly string[] } }>;

const englishNumbers = (value: Numeric, currency?: string | null) => formatMoney(value, currency || "SAR");
const numeric = (value: Numeric) => { const result = Number(value); return Number.isFinite(result) ? result : null; };

function reportList(receipt: DailyBriefReceipt): OwnerDailyBriefReport[] {
  const source = receipt.reports ?? receipt.history ?? [];
  const reports = source.length ? [...source] : [receipt];
  return reports.sort((left, right) => right.businessDate.localeCompare(left.businessDate));
}

/** Keeps the workspace independent of generated contract output while mapping
 * the deliberately central, owner-only API receipt to presentation fields. */
function normalizeBrief(source: OwnerDailyBriefApi): OwnerDailyBriefReport {
  return {
    businessDate: source.reportDate,
    generatedAt: source.generatedAt,
    totals: {
      yesterdaySales: source.totals.yesterdaySalesGrossAmount,
      yesterdayPurchases: source.totals.yesterdayPurchasesGrossAmount,
      monthToDateSales: source.totals.monthToDateSalesGrossAmount,
      monthToDatePurchases: source.totals.monthToDatePurchasesGrossAmount,
      purchaseToSalesPercent: source.totals.purchaseToSalesPercent,
      currencyCode: source.currency?.code ?? null,
    },
    companies: source.companies.map((company) => ({
      companyId: company.companyId, nameAr: company.nameAr, nameEn: company.nameEn, currencyCode: company.currencyCode,
      yesterdaySales: company.sales.yesterdayGrossAmount, yesterdayPurchases: company.purchases.yesterdayGrossAmount,
      monthToDateSales: company.sales.monthToDateGrossAmount, monthToDatePurchases: company.purchases.monthToDateGrossAmount,
      purchaseToSalesPercent: company.purchaseToSalesPercent, salesStatus: company.sales.yesterdayStatus,
    })),
    marketingSummary: { activeCampaignCount: source.marketing.activeCampaignCount, plannedSpend: source.marketing.plannedCostAmount, linkedSpend: source.marketing.linkedPostedSpendMonthToDate },
    mailSummary: { status: source.inboundEmail.readiness === "NOT_CONFIGURED" ? "NOT_CONNECTED" : "NO_DATA", totalMessages: source.inboundEmail.importedMessageCount },
  };
}

function statusLabel(status: DataStatus, language: Language) {
  const value = status?.toUpperCase();
  if (value === "READY" || value === "RECORDED" || value === "COMPLETE") return language === "ar" ? "مكتمل" : "Ready";
  if (value === "PARTIAL") return language === "ar" ? "جزئي" : "Partial";
  if (value === "PENDING") return language === "ar" ? "بانتظار الإقفال" : "Pending close";
  return language === "ar" ? "بيانات غير مكتملة" : "Data incomplete";
}

function reportDate(value: string, language: Language) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(date);
}

function timestamp(value: string | null | undefined, language: Language) {
  if (!value) return language === "ar" ? "لقطة يومية محفوظة" : "Saved daily snapshot";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return language === "ar" ? "لقطة يومية محفوظة" : "Saved daily snapshot";
  return new Intl.DateTimeFormat(language === "ar" ? "ar-SA" : "en-US", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Riyadh" }).format(date);
}

function insightFor(report: OwnerDailyBriefReport, language: Language) {
  const insight = language === "ar" ? report.marketingSummary?.insightAr : report.marketingSummary?.insightEn;
  if (insight) return insight;
  const campaigns = report.marketingSummary?.activeCampaignCount ?? report.companies.reduce((sum, company) => sum + (company.marketing?.activeCampaignCount ?? 0), 0);
  const spend = report.marketingSummary?.linkedSpend ?? report.companies.reduce<number>((sum, company) => sum + (numeric(company.marketing?.linkedSpend) ?? 0), 0);
  if (campaigns === 0) return language === "ar" ? "لا توجد حملات نشطة مسجلة في هذه اللقطة. لا يمكن الاستنتاج عن أداء الإعلانات الخارجية قبل ربط مصدرها المعتمد." : "No active campaigns are recorded in this snapshot. External-ad performance cannot be inferred before an approved source is connected.";
  return language === "ar" ? `${campaigns} حملات نشطة وصرف مرتبط قدره ${englishNumbers(spend)}. القراءة تصف البيانات المسجلة ولا تثبت سببًا للمبيعات.` : `${campaigns} active campaigns with ${englishNumbers(spend)} in linked spend. This reading describes recorded data; it does not prove sales causation.`;
}

function recommendationsFor(report: OwnerDailyBriefReport, language: Language) {
  const stored = language === "ar" ? report.marketingSummary?.recommendationsAr : report.marketingSummary?.recommendationsEn;
  if (stored?.length) return stored;
  const incomplete = report.companies.filter((company) => company.salesStatus && company.salesStatus !== "READY");
  const highPurchase = report.companies.filter((company) => (numeric(company.purchaseToSalesPercent) ?? 0) >= 60);
  const recommendations: string[] = [];
  if (incomplete.length) recommendations.push(language === "ar" ? `راجع إقفال المبيعات لـ ${incomplete.map((company) => company.nameAr).join("، ")} قبل اتخاذ قرار مالي.` : `Review sales close for ${incomplete.map((company) => company.nameEn || company.nameAr).join(", ")} before making a financial decision.`);
  if (highPurchase.length) recommendations.push(language === "ar" ? `تابع نسبة المشتريات المرتفعة في ${highPurchase.map((company) => company.nameAr).join("، ")} مقارنة بالمبيعات المثبتة.` : `Follow up on the elevated purchase ratio in ${highPurchase.map((company) => company.nameEn || company.nameAr).join(", ")} against posted sales.`);
  return recommendations.length ? recommendations : [language === "ar" ? "استمر في متابعة الإقفال اليومي والصرف المرتبط بالحملات؛ لا توجد إشارة آلية تحتاج تصعيدًا في هذه اللقطة." : "Continue to monitor daily closes and campaign-linked spend; this snapshot has no automated escalation signal."];
}

function answerFor(question: string, report: OwnerDailyBriefReport, language: Language) {
  const query = question.toLowerCase();
  if (/(تسويق|حمل|advert|market)/.test(query)) return `${insightFor(report, language)} ${recommendationsFor(report, language)[0]}`;
  if (/(بريد|رسائل|mail|email)/.test(query)) return mailNarrative(report, language);
  return language === "ar" ? "أنا مختصة بتحليل الترويج والتسويق واتجاهات البيانات في التقرير، وليس في استرجاع أرقام يوم بعينه. اسألني عن فرص الحملات، الصرف المرتبط، الشركات التي تحتاج متابعة، أو اتجاهات الأداء." : "I specialize in promotion, marketing, and data-trend analysis for this report rather than retrieving a figure for a particular day. Ask about campaign opportunities, linked spend, companies needing attention, or performance trends.";
}

function mailNarrative(report: OwnerDailyBriefReport, language: Language) {
  const mail = report.mailSummary;
  const summary = language === "ar" ? mail?.summaryAr : mail?.summaryEn;
  if (summary) return summary;
  if (mail?.status === "CONNECTED") return language === "ar" ? `تم استيراد ${formatNumber(mail.totalMessages)} رسالة؛ غير المقروء ${formatNumber(mail.unreadCount)}.` : `${formatNumber(mail.totalMessages)} messages were imported; ${formatNumber(mail.unreadCount)} are unread.`;
  return language === "ar" ? "البريد غير متصل حاليًا؛ لن يُعرض ملخص أو توصية حتى يتم ربط مصدر البريد واستيراد الرسائل." : "Mail is not connected yet; no summary or recommendation is shown until a mail source is connected and messages are imported.";
}

function formatNumber(value: number | null | undefined) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(value ?? 0); }

export function OwnerDailyBriefWorkspace({ language }: { language: Language }) {
  const ar = language === "ar";
  const [receipt, setReceipt] = useState<DailyBriefReceipt | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const nextMessage = useRef(1);

  const load = async () => {
    const session = activeSession();
    if (!session) { setError(ar ? "انتهت الجلسة. سجّل الدخول ثم أعد المحاولة." : "Your session has ended. Sign in and try again."); setLoading(false); return; }
    setLoading(true); setError("");
    try {
      const [current, history] = await Promise.all([
        api<OwnerDailyBriefApi>(session, "/owner/daily-brief"),
        api<OwnerDailyBriefHistoryApi>(session, "/owner/daily-brief/history?limit=60").catch(() => null),
      ]);
      const latest = normalizeBrief(current);
      const archived = history?.reports.map(normalizeBrief) ?? [];
      setReceipt({ ...latest, reports: [latest, ...archived.filter((entry) => entry.businessDate !== latest.businessDate)] });
      setSelectedDate(null);
    }
    catch (reason) { setError(presentBaseerApiError(reason, language, ar ? "تعذر تحميل دفتر المالك اليومي." : "The owner's daily brief could not be loaded.")); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, [language]); // language only changes the safe error copy.

  const reports = useMemo(() => receipt ? reportList(receipt) : [], [receipt]);
  const report = reports.find((entry) => entry.businessDate === selectedDate) ?? reports[0] ?? null;
  useEffect(() => { if (!report) return; setMessages([{ id: 0, role: "assistant", content: ar ? `أنا بصيرة، محللة الترويج والتسويق والاتجاهات. أقرأ لقطة ${reportDate(report.businessDate, language)} فقط، وأربط أي توصية بأدلتها.` : `I am Basira, your promotion, marketing, and trend analyst. I read only the ${reportDate(report.businessDate, language)} snapshot and ground every recommendation in its evidence.` }]); }, [ar, language, report?.businessDate]);

  const submitQuestion = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = question.trim();
    if (!value || !report) return;
    const id = nextMessage.current++;
    const answerId = id + .1;
    const thinking = ar ? "أراجع لقطة الدفتر…" : "Reviewing the notebook snapshot…";
    setMessages((current) => [...current, { id, role: "user", content: value }, { id: answerId, role: "assistant", content: thinking }]);
    setQuestion("");
    const session = activeSession();
    if (!session) return;
    try {
      const receipt = await api<BasiraAnswerReceipt>(session, "/owner/daily-brief/basira-answers", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportDate: report.businessDate, question: value, language, idempotencyKey: requestId() }),
      });
      const response = [receipt.answer.summary, ...receipt.answer.evidence, ...receipt.answer.limitations.map((item) => `${ar ? "الحدود: " : "Limit: "}${item}`)].join("\n");
      setMessages((current) => current.map((message) => message.id === answerId ? { ...message, content: response } : message));
    } catch {
      // The local answer remains an explicit read-only fallback when the live
      // provider is temporarily unavailable or its pilot gate is disabled.
      const unavailable = ar ? "تعذر الاتصال ببصيرة الحية؛ هذه قراءة احتياطية من اللقطة فقط. " : "Basira live is unavailable; this is a snapshot-only fallback. ";
      setMessages((current) => current.map((message) => message.id === answerId ? { ...message, content: `${unavailable}${answerFor(value, report, language)}` } : message));
    }
  };

  if (loading) return <BaseerWorkspace className="owner-daily-brief"><div dir={ar ? "rtl" : "ltr"}><p className="owner-daily-brief__state">{ar ? "جارٍ فتح دفتر المالك…" : "Opening the owner’s notebook…"}</p></div></BaseerWorkspace>;
  if (error || !report) return <BaseerWorkspace className="owner-daily-brief"><div dir={ar ? "rtl" : "ltr"}><BaseerCard className="owner-daily-brief__failure"><strong>{error || (ar ? "لا توجد لقطة يومية متاحة." : "No daily snapshot is available.")}</strong><BaseerButton type="button" onClick={() => void load()}>{ar ? "إعادة المحاولة" : "Try again"}</BaseerButton></BaseerCard></div></BaseerWorkspace>;

  const totals = report.totals ?? {};
  const currency = totals.currencyCode ?? report.companies[0]?.currencyCode ?? "SAR";
  const readyCount = report.companies.filter((company) => company.salesStatus === "READY").length;
  return <BaseerWorkspace className="owner-daily-brief">
    <div className="owner-daily-brief__paper" dir={ar ? "rtl" : "ltr"}>
      <BaseerSectionHeader eyebrow={ar ? "مركز القيادة · للمالك فقط" : "Command center · owner only"} title={ar ? "دفتر المالك اليومي" : "Owner’s daily notebook"} description={ar ? "لقطة محفوظة تجمع قراءة الشركات والتسويق والبريد، وكل القيم المالية شاملة الضريبة." : "A saved snapshot of companies, marketing, and mail. All financial values include VAT."} />
      <header className="owner-daily-brief__report-head"><div><span>{ar ? "تقرير الأعمال" : "Business report"}</span><h3>{reportDate(report.businessDate, language)}</h3><p>{ar ? `تم التوليد ${timestamp(report.generatedAt, language)} · ${readyCount} من ${report.companies.length} شركات مكتملة` : `Generated ${timestamp(report.generatedAt, language)} · ${readyCount} of ${report.companies.length} companies ready`}</p></div><bdi className="owner-daily-brief__tax" dir="rtl">{ar ? "شامل الضريبة" : "VAT inclusive"}</bdi></header>
      <section className="owner-daily-brief__totals" aria-label={ar ? "إجمالي المجموعة" : "Group totals"}>
        <Metric label={ar ? "مبيعات أمس" : "Yesterday sales"} value={englishNumbers(totals.yesterdaySales, currency)} />
        <Metric label={ar ? "مشتريات أمس" : "Yesterday purchases"} value={englishNumbers(totals.yesterdayPurchases, currency)} />
        <Metric label={ar ? "مبيعات الشهر حتى أمس" : "Month-to-date sales"} value={englishNumbers(totals.monthToDateSales, currency)} />
        <Metric label={ar ? "نسبة المشتريات" : "Purchase ratio"} value={formatPercent(totals.purchaseToSalesPercent)} />
      </section>

      <section className="owner-daily-brief__section"><div className="owner-daily-brief__section-title"><span>{ar ? "الشركات" : "Companies"}</span><h3>{ar ? "قراءة الأمس والشهر حتى تاريخه" : "Yesterday and month-to-date read"}</h3></div><div className="owner-daily-brief__companies">{report.companies.map((company) => <CompanyCard key={company.companyId} company={company} language={language} />)}</div></section>
      <section className="owner-daily-brief__section owner-daily-brief__marketing"><div className="owner-daily-brief__section-title"><span>{ar ? "التسويق" : "Marketing"}</span><h3>{ar ? "قراءة ذكية منضبطة" : "A grounded smart read"}</h3></div><div className="owner-daily-brief__marketing-body"><div><p className="owner-daily-brief__insight">{insightFor(report, language)}</p><ul>{recommendationsFor(report, language).map((item) => <li key={item}>{item}</li>)}</ul></div><dl><div><dt>{ar ? "الحملات النشطة" : "Active campaigns"}</dt><dd dir="ltr">{formatNumber(report.marketingSummary?.activeCampaignCount ?? report.companies.reduce((sum, company) => sum + (company.marketing?.activeCampaignCount ?? 0), 0))}</dd></div><div><dt>{ar ? "الصرف المرتبط" : "Linked spend"}</dt><dd dir="ltr">{englishNumbers(report.marketingSummary?.linkedSpend, currency)}</dd></div></dl></div></section>
      <section className="owner-daily-brief__section owner-daily-brief__mail"><div className="owner-daily-brief__section-title"><span>{ar ? "البريد" : "Mail"}</span><h3>{ar ? "ملخص الرسائل" : "Message summary"}</h3></div><div className="owner-daily-brief__mail-body"><span className={`owner-daily-brief__mail-status is-${(report.mailSummary?.status ?? "NOT_CONNECTED").toLowerCase()}`}>{report.mailSummary?.status === "CONNECTED" ? (ar ? "متصل" : "Connected") : (ar ? "غير متصل" : "Not connected")}</span><p>{mailNarrative(report, language)}</p>{(ar ? report.mailSummary?.highlightsAr : report.mailSummary?.highlightsEn)?.length ? <ul>{(ar ? report.mailSummary?.highlightsAr : report.mailSummary?.highlightsEn)?.map((item) => <li key={item}>{item}</li>)}</ul> : null}</div></section>

      <BasiraChat language={language} messages={messages} question={question} onQuestionChange={setQuestion} onSubmit={submitQuestion} />
      {reports.length > 1 ? <section className="owner-daily-brief__history"><div className="owner-daily-brief__section-title"><span>{ar ? "الأرشيف اليومي" : "Daily archive"}</span><h3>{ar ? "تقارير سابقة" : "Earlier reports"}</h3></div><div>{reports.slice(1).map((entry) => <button className={`owner-daily-brief__history-entry${entry.businessDate === report.businessDate ? " is-selected" : ""}`} type="button" onClick={() => setSelectedDate(entry.businessDate)} key={entry.id ?? entry.businessDate}><span>{reportDate(entry.businessDate, language)}</span><small>{timestamp(entry.generatedAt, language)}</small><bdi dir="ltr">{englishNumbers(entry.totals?.yesterdaySales, entry.totals?.currencyCode ?? currency)}</bdi></button>)}</div></section> : null}
    </div>
  </BaseerWorkspace>;
}

function Metric({ label, value }: { label: string; value: string }) { return <BaseerCard className="owner-daily-brief__metric" padding="compact"><span>{label}</span><bdi dir="ltr">{value}</bdi></BaseerCard>; }

function CompanyCard({ company, language }: { company: OwnerDailyBriefCompany; language: Language }) {
  const ar = language === "ar"; const currency = company.currencyCode ?? "SAR"; const name = ar ? company.nameAr : company.nameEn || company.nameAr;
  return <BaseerCard className="owner-daily-brief__company" padding="compact"><header><div><span>{name}</span><small>{ar ? "شامل الضريبة" : "VAT inclusive"}</small></div><em className={`is-${(company.salesStatus ?? "MISSING").toLowerCase()}`}>{statusLabel(company.salesStatus, language)}</em></header><dl><div><dt>{ar ? "مبيعات أمس" : "Yesterday sales"}</dt><dd dir="ltr">{englishNumbers(company.yesterdaySales, currency)}</dd></div><div><dt>{ar ? "مشتريات أمس" : "Yesterday purchases"}</dt><dd dir="ltr">{englishNumbers(company.yesterdayPurchases, currency)}</dd></div><div><dt>{ar ? "مبيعات الشهر" : "Month-to-date sales"}</dt><dd dir="ltr">{englishNumbers(company.monthToDateSales, currency)}</dd></div><div><dt>{ar ? "نسبة المشتريات" : "Purchase ratio"}</dt><dd dir="ltr">{formatPercent(company.purchaseToSalesPercent)}</dd></div></dl></BaseerCard>;
}

function BasiraChat({ language, messages, question, onQuestionChange, onSubmit }: { language: Language; messages: readonly ChatMessage[]; question: string; onQuestionChange: (value: string) => void; onSubmit: (event: React.FormEvent<HTMLFormElement>) => void }) {
  const ar = language === "ar";
  return <section className="owner-daily-brief__chat" aria-label={ar ? "محادثة بصيرة التحليلية" : "Basira analytical conversation"}><header><div><span className="owner-daily-brief__basira-mark" aria-hidden="true">✦</span><div><h3>{ar ? "بصيرة · محللة الترويج والبيانات" : "Basira · Promotion & data analyst"}</h3><p>{ar ? "تحلل الاتجاهات والترويج من اللقطة المعروضة، وليست أداة استعلام أرقام" : "Analyzes promotion and trends from this snapshot; it is not a number lookup tool"}</p></div></div></header><div className="owner-daily-brief__messages" aria-live="polite">{messages.map((message) => <p className={`is-${message.role}`} key={message.id}>{message.content}</p>)}</div><div className="owner-daily-brief__suggestions">{(ar ? ["ما فرص الترويج التي تحتاج متابعة؟", "حلل الصرف المرتبط بالحملات", "ما الاتجاه الذي يحتاج قرارًا؟"] : ["Which promotion opportunities need attention?", "Analyze campaign-linked spend", "Which trend needs a decision?"]).map((item) => <button key={item} type="button" onClick={() => onQuestionChange(item)}>{item}</button>)}</div><form onSubmit={onSubmit}><input value={question} onChange={(event) => onQuestionChange(event.target.value)} placeholder={ar ? "اسأل عن الترويج أو الاتجاهات…" : "Ask about promotion or trends…"} /><BaseerButton type="submit" disabled={!question.trim()}>{ar ? "إرسال" : "Send"}</BaseerButton></form></section>;
}
