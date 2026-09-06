import { lazy, Suspense, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerDataGrid, type BaseerDataGridColumn } from "./baseer-data-grid";
import { BaseerEmptyState } from "./baseer-workspace";
import { BaseerInfoHint } from "./baseer-info-hint";
import { BaseerSummaryMetric, BaseerSummaryMetricGrid } from "./baseer-summary-metric";
import { activeSession, api } from "./daily-sales-client";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { marketingIsArabic, type MarketingCopy, type MarketingLanguage, type MarketingWorkspaceRead } from "./marketing-shared";
import { formatDateTime, formatNumber, formatNumberFixed } from "./number-format";

const visible = (codes: readonly string[] | null, capability: string) => codes?.includes(capability) ?? false;
const LazyReputationReplyPolicyEditor = lazy(() => import("./marketing-reputation-reply-policy-editor").then((module) => ({ default: module.ReputationReplyPolicyEditor })));

type GoogleBusinessReview = { id: string; rating: number; reviewerDisplayName: string | null; reviewComment: string | null; reviewCreatedAt: string; reviewUpdatedAt: string; replyComment: string | null; replyUpdatedAt: string | null };
type GoogleBusinessReviewsRead = { sourceStatus: "NOT_CONNECTED" | "NO_DATA" | "READY"; asOf: string | null; summary: { averageRating: number | null; totalReviewCount: number | null; storedReviewCount: number; repliedReviewCount: number; responseRatePercent: number | null; analysisAr: string; analysisEn: string }; sync: { rowsRead: number; rowsWritten: number } | null; reviews: GoogleBusinessReview[]; nextCursor: string | null };
type GoogleBusinessReviewSyncReceipt = { status: "COMPLETED"; rowsRead: number; rowsWritten: number; sourceFreshAt: string; totalReviewCount: number | null };

const reputationCopy = (language: MarketingLanguage): MarketingCopy => language === "ar" ? {
  eyebrow: "التسويق والسمعة", refresh: "تحديث", title: "السمعة وGoogle", overview: "مزامنة تقييمات Google Business وتحليلها المبسط وحالة الردود الموجودة. لا يمثل ذلك مبيعات أو قراراً مالياً.", fail: "تعذر تحميل بيانات السمعة.", noPermission: "لا تملك صلاحية عرض الأداء التسويقي", reputation: "السمعة وGoogle", notReady: "راجع حالة Google Business ثم اضغط «مزامنة الآن» لجلب التقييمات.", notConnected: "غير متصل", noWrite: "لا يوجد نشر أو رد تلقائي الآن.", publisherUnavailable: "تُعرض الردود الموجودة في Google بعد المزامنة. إنشاء أو نشر رد جديد يحتاج شريحة حوكمة مستقلة؛ لا يوجد نشر فعلي الآن.", replyAutomation: "الردود التلقائية", replyAutomationHelp: "اضبط السياسة الآن؛ لن تنشر خارجياً قبل ربط Google Business واعتماد النشر.", automationStatus: "حالة الأتمتة", paused: "موقوف مؤقتاً", activeWhenConnected: "سيعمل عند اكتمال الربط", disabled: "متوقفة", automationOn: "تشغيل الردود عند الربط", autoFourFive: "رد تلقائي لتقييمات 4 و5 نجوم", autoThree: "رد تلقائي لتقييم 3 نجوم إذا كان آمناً", lowManual: "تقييمات 1 و2 نجمة: مسودة فقط ثم نشر يدوي", threeRule: "الثلاث نجوم تذهب للمراجعة عند وجود شكوى أو طلب استرجاع أو موضوع حساس.", method: "طريقة كتابة الرد", template: "قوالب آمنة", basira: "مسودة بصيرة بعد تفعيلها", tone: "نبرة الرد", warm: "ودودة", professional: "مهنية", formal: "رسمية", languageMode: "لغة الرد", matchReview: "نفس لغة التقييم", arabic: "العربية", english: "الإنجليزية", signature: "توقيع الرد (اختياري)", savePolicy: "حفظ سياسة الردود", policySaved: "تم حفظ سياسة الردود.", policyFail: "تعذر حفظ سياسة الردود.", enabled: "مفعلة عند الربط", configurePolicy: "إعداد سياسة الردود", editPolicy: "تعديل سياسة الردود", policyLoading: "جارٍ تحميل إعدادات سياسة الردود…"
} : {
  eyebrow: "Marketing & Reputation", refresh: "Refresh", title: "Reputation & Google", overview: "Synchronize Google Business reviews, read their plain-language analysis, and see existing replies. This is not sales or a financial decision.", fail: "Reputation data could not be loaded.", noPermission: "You cannot view marketing performance", reputation: "Reputation & Google", notReady: "Review the Google Business status, then choose Sync now to retrieve reviews.", notConnected: "Not connected", noWrite: "There is no Google publishing or automated reply now.", publisherUnavailable: "Existing Google replies appear after synchronization. Creating or publishing a new reply needs a separate governed slice; there is no live publishing now.", replyAutomation: "Automated replies", replyAutomationHelp: "Configure the policy now. It cannot publish until Google Business is connected and publishing is approved.", automationStatus: "Automation status", paused: "Paused", activeWhenConnected: "Will operate after connection", disabled: "Disabled", automationOn: "Enable replies after connection", autoFourFive: "Automatically reply to 4 and 5 star reviews", autoThree: "Automatically reply to safe 3 star reviews", lowManual: "1 and 2 star reviews: draft only, then manual publishing", threeRule: "Three-star reviews are held when they contain a complaint, refund request, or sensitive subject.", method: "Reply authoring", template: "Safe templates", basira: "Basira draft after activation", tone: "Reply tone", warm: "Warm", professional: "Professional", formal: "Formal", languageMode: "Reply language", matchReview: "Match review language", arabic: "Arabic", english: "English", signature: "Reply signature (optional)", savePolicy: "Save reply policy", policySaved: "Reply policy saved.", policyFail: "Reply policy could not be saved.", enabled: "Enabled after connection", configurePolicy: "Configure reply policy", editPolicy: "Edit reply policy", policyLoading: "Loading reply policy settings…"
};

export function MarketingReputationRoute({ language, permissionCodes }: { language: MarketingLanguage; permissionCodes: readonly string[] | null }) {
  const ar = marketingIsArabic(language);
  const session = activeSession();
  const copy = reputationCopy(language);
  const canRead = visible(permissionCodes, "marketing.insights.read");

  if (!session) return <DailySalesSignIn language={language} />;
  if (!canRead) return <section className="baseer-workspace"><BaseerEmptyState title={copy.noPermission} /></section>;

  return <BaseerCompanyReadQuery session={session} resource="marketing.reputation" scope={[language, [...(permissionCodes ?? [])].sort().join(",")]} load={(current, signal) => api<MarketingWorkspaceRead>(current, "/marketing", { signal })}>{({ data, loading, error, refetch }) => <section className="baseer-workspace marketing-workspace" dir={ar ? "rtl" : "ltr"}>
    <header className="baseer-section-header"><div className="baseer-section-header__copy"><p className="baseer-section-header__eyebrow">{copy.eyebrow}</p><p>{copy.overview}</p></div><div className="baseer-section-header__actions"><BaseerButton type="button" variant="secondary" disabled={loading} onClick={() => void refetch()}>{copy.refresh}</BaseerButton></div></header>
    {error ? <BaseerCard className="marketing-workspace__message" padding="compact">{copy.fail}</BaseerCard> : <MarketingReputationWorkspace language={language} data={data} copy={copy} permissionCodes={permissionCodes} onSaved={refetch} />}
  </section>}</BaseerCompanyReadQuery>;
}

/**
 * سمعة Google لا تفترض وجود الصلاحية أو الاتصال: أي قيمة غائبة تعني عرضاً
 * للقراءة فقط. لا توجد هنا عملية نشر أو بدء OAuth.
 */
export function MarketingReputationWorkspace({ language, data, copy, permissionCodes, onSaved }: {
  language: MarketingLanguage;
  data: MarketingWorkspaceRead | undefined;
  copy: MarketingCopy;
  permissionCodes: readonly string[] | null;
  onSaved?: () => Promise<void>;
}) {
  const ar = marketingIsArabic(language);
  const session = activeSession();
  const canManagePolicy = visible(permissionCodes, "marketing.reputation.policy.manage");
  const [policyEditorOpen, setPolicyEditorOpen] = useState(false);

  if (!session) {
    return null;
  }

  return <section className="marketing-reputation">
    <header><p>{copy.notReady}</p></header>
    <div className="baseer-card-grid">{(data?.readiness ?? []).map((item) => <BaseerCard key={item.provider}>
      <strong>{item.provider === "GOOGLE_ADS" ? "Google Ads" : "Google Business"}</strong>
      <span className={`baseer-status-badge ${item.status === "AUTHORIZED_READ_ONLY_SELECTED" ? "baseer-status-badge--info" : "baseer-status-badge--warning"}`}><i className="baseer-status-badge__dot" />{item.status === "AUTHORIZED_READ_ONLY_SELECTED" ? (ar ? "اختيار محفوظ للقراءة فقط" : "Read-only selection saved") : copy.notConnected}</span>
      <p>{ar ? item.messageAr : item.status === "AUTHORIZED_READ_ONLY_SELECTED" ? "Google Business is connected with a location selected for read-only review synchronization. Publishing and automated replies remain governed separately." : item.provider === "GOOGLE_ADS" ? "Google Ads is not connected at this stage; no spend, conversions, or spending decisions are available." : "Google Business is not connected; reviews cannot be synchronized yet."}</p>
    </BaseerCard>)}</div>
    <GoogleBusinessReviewsPanel language={language} canSynchronize={visible(permissionCodes, "marketing.google-connection.manage")} />
    {data ? <BaseerCard className="marketing-reputation__automation"><header><div><span className="marketing-reputation__label"><strong>{copy.replyAutomation}</strong><BaseerInfoHint label={ar ? "شرح سياسة الردود التلقائية" : "Explain the automated reply policy"}>{ar ? "ترد السياسة تلقائياً على تقييمات 4 و5 نجوم عند اكتمال ربط Google Business واجتياز الحارس. تقييمات 3 نجوم لا ترد تلقائياً إلا عندما تكون آمنة، أما 1 و2 نجمة فتحتاج مراجعة ونشراً يدوياً." : "The policy automatically replies to 4- and 5-star reviews only after Google Business is connected and the guard passes. A 3-star review must be safe; 1- and 2-star reviews always need human review and manual publishing."}</BaseerInfoHint></span><p>{copy.replyAutomationHelp}</p></div><span className="baseer-status-badge baseer-status-badge--warning"><i className="baseer-status-badge__dot" />{data.replyPolicy.automationStatus === "PAUSED" ? copy.paused : data.replyPolicy.automationStatus === "ENABLED" ? copy.activeWhenConnected : copy.disabled}</span></header>{canManagePolicy ? <><BaseerButton type="button" variant="secondary" onClick={() => setPolicyEditorOpen(true)}>{policyEditorOpen ? copy.editPolicy : copy.configurePolicy}</BaseerButton>{policyEditorOpen ? <Suspense fallback={<p role="status">{copy.policyLoading}</p>}><LazyReputationReplyPolicyEditor language={language} policy={data.replyPolicy} copy={copy} canManage={canManagePolicy} onSaved={onSaved} /></Suspense> : null}</> : <p>{copy.replyAutomationHelp}</p>}</BaseerCard> : null}
    <BaseerCard tone="muted"><strong>{copy.noWrite}</strong><p>{copy.publisherUnavailable}</p></BaseerCard>
  </section>;
}

function GoogleBusinessReviewsPanel({ language, canSynchronize }: { language: MarketingLanguage; canSynchronize: boolean }) {
  const ar = marketingIsArabic(language);
  const session = activeSession();
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  if (!session) return null;
  const columns: readonly BaseerDataGridColumn<GoogleBusinessReview>[] = [
    { id: "reviewer", header: ar ? "صاحب التقييم" : "Reviewer", cell: (row) => <><strong>{row.reviewerDisplayName ?? (ar ? "حساب Google" : "Google account")}</strong><small>{formatDateTime(row.reviewUpdatedAt, language, "Asia/Riyadh")}</small></> },
    { id: "rating", header: ar ? "النجوم" : "Rating", numeric: true, align: "center", cell: (row) => <bdi dir="ltr">{formatNumber(row.rating, language)} / 5</bdi> },
    { id: "review", header: ar ? "التعليق" : "Review", cell: (row) => row.reviewComment ?? (ar ? "لا يوجد نص في التقييم." : "No review text.") },
    { id: "reply", header: ar ? "رد Google" : "Google reply", cell: (row) => row.replyComment ? <><strong>{ar ? "تم الرد" : "Replied"}</strong><p>{row.replyComment}</p>{row.replyUpdatedAt ? <small>{formatDateTime(row.replyUpdatedAt, language, "Asia/Riyadh")}</small> : null}</> : <span className="baseer-status-badge baseer-status-badge--warning"><i className="baseer-status-badge__dot" />{ar ? "بانتظار رد" : "Awaiting reply"}</span> },
  ];
  return <BaseerCompanyReadQuery session={session} resource="marketing.google-business-reviews" scope={[language, cursor ?? "first"]} load={(current, signal) => api<GoogleBusinessReviewsRead>(current, `/marketing/reputation/reviews${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { signal })}>{({ data, loading, error, refetch }) => {
    const synchronize = async () => {
      if (!canSynchronize || syncing) return;
      setSyncing(true); setMessage(null);
      try {
        const receipt = await api<GoogleBusinessReviewSyncReceipt>(session, "/marketing/reputation/reviews/sync", { method: "POST" });
        setCursor(null);
        setMessage(ar ? `تمت مزامنة ${formatNumber(receipt.rowsWritten, language)} تقييمات. لا يتم نشر أي رد من هذه العملية.` : `${formatNumber(receipt.rowsWritten, language)} reviews synchronized. This action does not publish replies.`);
        await refetch();
      } catch {
        setMessage(ar ? "تعذرت مزامنة Google Business. لم يُنشر أي رد ولم تتغير سياسة الردود." : "Google Business synchronization could not complete. No reply was published and the reply policy was not changed.");
      } finally { setSyncing(false); }
    };
    if (error) return <BaseerCard><strong>{ar ? "تعذر تحميل تقييمات Google Business" : "Google Business reviews could not be loaded"}</strong><BaseerButton type="button" variant="secondary" onClick={() => void refetch()}>{ar ? "إعادة المحاولة" : "Retry"}</BaseerButton></BaseerCard>;
    const statusLabel = data?.sourceStatus === "READY" ? (ar ? "بيانات Google جاهزة للقراءة" : "Google data ready to read") : data?.sourceStatus === "NO_DATA" ? (ar ? "لا توجد مزامنة بعد" : "No synchronization yet") : (ar ? "Google Business غير متصل" : "Google Business is not connected");
    return <BaseerCard className="marketing-reputation__reviews">
      <header><div><h3>{ar ? "تقييمات Google Business" : "Google Business reviews"}</h3><p>{ar ? "المصدر هو Google Business. القراءة والتحليل هنا لا يمثلان مبيعات أو قراراً مالياً." : "The source is Google Business. This read and analysis do not represent sales or a financial decision."}</p></div><span className={`baseer-status-badge baseer-status-badge--${data?.sourceStatus === "READY" ? "info" : "warning"}`}><i className="baseer-status-badge__dot" />{statusLabel}</span></header>
      <div className="baseer-inline-actions">{canSynchronize ? <BaseerButton type="button" disabled={loading || syncing || data?.sourceStatus === "NOT_CONNECTED"} onClick={() => void synchronize()}>{syncing ? (ar ? "جارٍ المزامنة…" : "Synchronizing…") : (ar ? "مزامنة الآن" : "Sync now")}</BaseerButton> : <small>{ar ? "تحتاج صلاحية إدارة ربط Google لإجراء المزامنة." : "Google-connection management permission is required to synchronize."}</small>}<BaseerButton type="button" variant="secondary" disabled={loading || syncing} onClick={() => void refetch()}>{ar ? "تحديث العرض" : "Refresh view"}</BaseerButton></div>
      {message ? <p role="status">{message}</p> : null}
      {data?.sourceStatus === "READY" ? <><BaseerSummaryMetricGrid ariaLabel={ar ? "ملخص تقييمات Google" : "Google review summary"} role="list"><BaseerSummaryMetric role="listitem" label={ar ? "متوسط النجوم" : "Average rating"} value={<bdi dir="ltr">{data.summary.averageRating === null ? "—" : formatNumberFixed(data.summary.averageRating, 1, language)} / 5</bdi>} accent="info" /><BaseerSummaryMetric role="listitem" label={ar ? "إجمالي التقييمات" : "Total reviews"} value={<bdi dir="ltr">{data.summary.totalReviewCount === null ? "—" : formatNumber(data.summary.totalReviewCount, language)}</bdi>} /><BaseerSummaryMetric role="listitem" label={ar ? "تقييمات عليها رد" : "Reviews with replies"} value={<bdi dir="ltr">{formatNumber(data.summary.repliedReviewCount, language)}</bdi>} accent="success" /><BaseerSummaryMetric role="listitem" label={ar ? "نسبة الردود" : "Response rate"} value={<bdi dir="ltr">{data.summary.responseRatePercent === null ? "—" : `${formatNumber(data.summary.responseRatePercent, language)}%`}</bdi>} accent="warning" /></BaseerSummaryMetricGrid><BaseerCard tone="muted"><strong>{ar ? "تحليل مبسط" : "Plain-language analysis"}</strong><p>{ar ? data.summary.analysisAr : data.summary.analysisEn}</p><small>{ar ? `آخر مزامنة: ${formatDateTime(data.asOf!, language, "Asia/Riyadh")}. الردود المعروضة هي الردود الموجودة في Google فقط.` : `Last sync: ${formatDateTime(data.asOf!, language, "Asia/Riyadh")}. Shown replies are the replies already present in Google.`}</small></BaseerCard>{data.reviews.length ? <><BaseerDataGrid ariaLabel={ar ? "قائمة تقييمات Google" : "Google reviews list"} caption={ar ? "أحدث تقييمات Google Business المتزامنة" : "Latest synchronized Google Business reviews"} rows={data.reviews} columns={columns} rowKey={(row) => row.id} />{data.nextCursor ? <div className="baseer-inline-actions"><BaseerButton type="button" variant="secondary" disabled={loading || syncing} onClick={() => setCursor(data.nextCursor)}>{ar ? "عرض تقييمات أقدم" : "Show older reviews"}</BaseerButton>{cursor ? <BaseerButton type="button" variant="secondary" disabled={loading || syncing} onClick={() => setCursor(null)}>{ar ? "العودة لأحدث التقييمات" : "Back to latest reviews"}</BaseerButton> : null}</div> : null}</> : <BaseerEmptyState title={ar ? "لم تعد Google أي تقييمات لهذا الموقع." : "Google returned no reviews for this location."} />}</> : <BaseerEmptyState title={data?.summary.analysisAr ?? (ar ? "جارٍ تحميل الحالة…" : "Loading status…")} />}
    </BaseerCard>;
  }}</BaseerCompanyReadQuery>;
}
