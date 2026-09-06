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
type GoogleBusinessReviewReplyState = "ALL" | "REPLIED" | "UNREPLIED";
type GoogleBusinessReviewsRead = { sourceStatus: "NOT_CONNECTED" | "NO_DATA" | "READY"; asOf: string | null; summary: { averageRating: number | null; totalReviewCount: number | null; storedReviewCount: number; repliedReviewCount: number; unrepliedReviewCount: number; responseRatePercent: number | null; analysisAr: string; analysisEn: string }; distribution: Array<{ rating: number; reviewCount: number; sharePercent: number }>; filteredReviewCount: number; sync: { rowsRead: number; rowsWritten: number } | null; reviews: GoogleBusinessReview[]; nextCursor: string | null };
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
  const [rating, setRating] = useState<number | null>(null);
  const [replyState, setReplyState] = useState<GoogleBusinessReviewReplyState>("ALL");
  if (!session) return null;
  const query = new URLSearchParams();
  if (cursor) query.set("cursor", cursor);
  if (rating !== null) query.set("rating", String(rating));
  if (replyState !== "ALL") query.set("replyState", replyState);
  const reviewPath = `/marketing/reputation/reviews${query.size ? `?${query.toString()}` : ""}`;
  return <BaseerCompanyReadQuery<GoogleBusinessReviewsRead> session={session} resource="marketing.google-business-reviews" scope={[language, cursor ?? "first", String(rating ?? "all"), replyState]} load={(current, signal) => api<GoogleBusinessReviewsRead>(current, reviewPath, { signal })}>{({ data, loading, error, refetch }) => {
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
    return <ReputationReviewBoard language={language} data={data} loading={loading} syncing={syncing} message={message} statusLabel={statusLabel} canSynchronize={canSynchronize} cursor={cursor} rating={rating} replyState={replyState} onSynchronize={synchronize} onRefresh={refetch} onRatingChange={(value) => { setRating(value); setCursor(null); }} onReplyStateChange={(value) => { setReplyState(value); setCursor(null); }} onOlder={() => data?.nextCursor && setCursor(data.nextCursor)} onLatest={() => setCursor(null)} />;
  }}</BaseerCompanyReadQuery>;
}

function ReputationReviewBoard({ language, data, loading, syncing, message, statusLabel, canSynchronize, cursor, rating, replyState, onSynchronize, onRefresh, onRatingChange, onReplyStateChange, onOlder, onLatest }: {
  language: MarketingLanguage;
  data: GoogleBusinessReviewsRead | undefined;
  loading: boolean;
  syncing: boolean;
  message: string | null;
  statusLabel: string;
  canSynchronize: boolean;
  cursor: string | null;
  rating: number | null;
  replyState: GoogleBusinessReviewReplyState;
  onSynchronize: () => Promise<void>;
  onRefresh: () => Promise<void>;
  onRatingChange: (value: number | null) => void;
  onReplyStateChange: (value: GoogleBusinessReviewReplyState) => void;
  onOlder: () => void;
  onLatest: () => void;
}) {
  const ar = marketingIsArabic(language);
  const columns: readonly BaseerDataGridColumn<GoogleBusinessReview>[] = [
    { id: "reviewer", header: ar ? "صاحب التقييم" : "Reviewer", cell: (row) => <><strong>{row.reviewerDisplayName ?? (ar ? "حساب Google" : "Google account")}</strong><small>{formatDateTime(row.reviewUpdatedAt, language, "Asia/Riyadh")}</small></> },
    { id: "rating", header: ar ? "النجوم" : "Rating", numeric: true, align: "center", cell: (row) => <bdi dir="ltr">{"★".repeat(row.rating)} <span>{formatNumber(row.rating, language)} / 5</span></bdi> },
    { id: "review", header: ar ? "التعليق" : "Review", cell: (row) => row.reviewComment ?? (ar ? "لا يوجد نص في التقييم." : "No review text.") },
    { id: "reply", header: ar ? "رد Google" : "Google reply", cell: (row) => row.replyComment ? <><strong>{ar ? "تم الرد" : "Replied"}</strong><p>{row.replyComment}</p>{row.replyUpdatedAt ? <small>{formatDateTime(row.replyUpdatedAt, language, "Asia/Riyadh")}</small> : null}</> : <span className="baseer-status-badge baseer-status-badge--warning"><i className="baseer-status-badge__dot" />{ar ? "بانتظار رد" : "Awaiting reply"}</span> },
  ];
  const ready = data?.sourceStatus === "READY";
  return <section className="marketing-reputation__board" aria-label={ar ? "لوحة تقييمات Google Business" : "Google Business review board"}>
    <header className="marketing-reputation__board-header">
      <div>
        <p className="baseer-section-header__eyebrow">Google Business · {ar ? "السمعة" : "Reputation"}</p>
        <h2>{ar ? "لوحة التقييمات" : "Review dashboard"}</h2>
        <p>{ar ? "سجل التقييمات الكامل للموقع المرتبط، مع قراءة مبسطة للردود الموجودة." : "The full review record for the connected location, with a clear read of existing replies."}</p>
      </div>
      <div className="marketing-reputation__board-actions">
        <span className={`baseer-status-badge baseer-status-badge--${ready ? "info" : "warning"}`}><i className="baseer-status-badge__dot" />{statusLabel}</span>
        {canSynchronize ? <BaseerButton type="button" disabled={loading || syncing || data?.sourceStatus === "NOT_CONNECTED"} onClick={() => void onSynchronize()}>{syncing ? (ar ? "جارٍ المزامنة…" : "Synchronizing…") : (ar ? "مزامنة الآن" : "Sync now")}</BaseerButton> : <small>{ar ? "تحتاج صلاحية إدارة ربط Google لإجراء المزامنة." : "Google-connection management permission is required to synchronize."}</small>}
        <BaseerButton type="button" variant="secondary" disabled={loading || syncing} onClick={() => void onRefresh()}>{ar ? "تحديث العرض" : "Refresh view"}</BaseerButton>
      </div>
    </header>
    {message ? <p role="status" className="marketing-reputation__sync-message">{message}</p> : null}
    {!ready ? <BaseerCard><BaseerEmptyState title={(ar ? data?.summary.analysisAr : data?.summary.analysisEn) ?? (ar ? "جارٍ تحميل الحالة…" : "Loading status…")} /></BaseerCard> : <>
      <p className="marketing-reputation__source-line">{ar ? `المصدر: Google Business · آخر مزامنة: ${formatDateTime(data.asOf!, language, "Asia/Riyadh")} · السجل المحفوظ: ${formatNumber(data.summary.storedReviewCount, language)} تقييم` : `Source: Google Business · Last sync: ${formatDateTime(data.asOf!, language, "Asia/Riyadh")} · Stored record: ${formatNumber(data.summary.storedReviewCount, language)} reviews`}</p>
      <BaseerSummaryMetricGrid ariaLabel={ar ? "ملخص تقييمات Google" : "Google review summary"} role="list">
        <BaseerSummaryMetric role="listitem" label={ar ? "متوسط النجوم" : "Average rating"} value={<bdi dir="ltr">{data.summary.averageRating === null ? "—" : formatNumberFixed(data.summary.averageRating, 1, language)} / 5</bdi>} accent="info" />
        <BaseerSummaryMetric role="listitem" label={ar ? "إجمالي التقييمات" : "Total reviews"} value={<bdi dir="ltr">{data.summary.totalReviewCount === null ? "—" : formatNumber(data.summary.totalReviewCount, language)}</bdi>} />
        <BaseerSummaryMetric role="listitem" label={ar ? "تحتاج متابعة" : "Awaiting reply"} value={<bdi dir="ltr">{formatNumber(data.summary.unrepliedReviewCount, language)}</bdi>} accent="warning" />
        <BaseerSummaryMetric role="listitem" label={ar ? "نسبة الردود" : "Response rate"} value={<bdi dir="ltr">{data.summary.responseRatePercent === null ? "—" : `${formatNumber(data.summary.responseRatePercent, language)}%`}</bdi>} accent="success" />
      </BaseerSummaryMetricGrid>
      <div className="marketing-reputation__board-insights">
        <BaseerCard tone="muted"><strong>{ar ? "ماذا تعني الأرقام؟" : "What the numbers mean"}</strong><p>{ar ? data.summary.analysisAr : data.summary.analysisEn}</p><small>{ar ? "هذه قراءة لتقييمات Google وليست مبيعات أو قراراً مالياً." : "This describes Google reviews, not sales or a financial decision."}</small></BaseerCard>
        <BaseerCard><h3>{ar ? "توزيع النجوم" : "Rating distribution"}</h3><div className="marketing-reputation__distribution">{data.distribution.map((item) => <div key={item.rating} className="marketing-reputation__distribution-row"><span><bdi dir="ltr">{item.rating} ★</bdi></span><progress value={item.sharePercent} max={100} aria-label={ar ? `${item.rating} نجوم: ${item.sharePercent}%` : `${item.rating} stars: ${item.sharePercent}%`} /><bdi dir="ltr">{formatNumber(item.reviewCount, language)}</bdi></div>)}</div></BaseerCard>
      </div>
      <BaseerCard className="marketing-reputation__register">
        <header><div><h3>{ar ? "سجل التقييمات" : "Review record"}</h3><p>{ar ? `يعرض ${formatNumber(data.filteredReviewCount, language)} تقييمات وفق المرشحات الحالية.` : `${formatNumber(data.filteredReviewCount, language)} reviews match the current filters.`}</p></div></header>
        <div className="marketing-reputation__filters" aria-label={ar ? "فلاتر التقييمات" : "Review filters"}>
          <div role="group" aria-label={ar ? "حالة الرد" : "Reply state"}>{(["ALL", "UNREPLIED", "REPLIED"] as const).map((value) => <BaseerButton key={value} type="button" variant={replyState === value ? "primary" : "secondary"} disabled={loading || syncing} onClick={() => onReplyStateChange(value)}>{value === "ALL" ? (ar ? "كل التقييمات" : "All reviews") : value === "UNREPLIED" ? (ar ? "تحتاج ردًا" : "Awaiting reply") : (ar ? "تم الرد" : "Replied")}</BaseerButton>)}</div>
          <div role="group" aria-label={ar ? "فلتر النجوم" : "Rating filter"}><BaseerButton type="button" variant={rating === null ? "primary" : "secondary"} disabled={loading || syncing} onClick={() => onRatingChange(null)}>{ar ? "كل النجوم" : "All ratings"}</BaseerButton>{[5, 4, 3, 2, 1].map((value) => <BaseerButton key={value} type="button" variant={rating === value ? "primary" : "secondary"} disabled={loading || syncing} onClick={() => onRatingChange(value)}><bdi dir="ltr">{value} ★</bdi></BaseerButton>)}</div>
        </div>
        {data.reviews.length ? <><BaseerDataGrid ariaLabel={ar ? "سجل تقييمات Google" : "Google review record"} caption={ar ? "التقييمات المتزامنة من Google Business، من الأحدث إلى الأقدم" : "Synchronized Google Business reviews, newest first"} rows={data.reviews} columns={columns} rowKey={(row) => row.id} /><footer className="marketing-reputation__register-footer">{data.nextCursor ? <BaseerButton type="button" variant="secondary" disabled={loading || syncing} onClick={onOlder}>{ar ? "عرض تقييمات أقدم" : "Show older reviews"}</BaseerButton> : <small>{ar ? "وصلت إلى نهاية السجل المتاح." : "You reached the end of the available record."}</small>}{cursor ? <BaseerButton type="button" variant="secondary" disabled={loading || syncing} onClick={onLatest}>{ar ? "العودة للأحدث" : "Back to latest"}</BaseerButton> : null}</footer></> : <BaseerEmptyState title={ar ? "لا توجد تقييمات تطابق المرشحات الحالية." : "No reviews match the current filters."} />}
      </BaseerCard>
    </>}
  </section>;
}
