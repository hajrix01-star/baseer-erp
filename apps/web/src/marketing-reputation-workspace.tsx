import { lazy, Suspense, useState } from "react";

import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerEmptyState } from "./baseer-workspace";
import { activeSession, api } from "./daily-sales-client";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { marketingIsArabic, type MarketingCopy, type MarketingLanguage, type MarketingWorkspaceRead } from "./marketing-shared";

const visible = (codes: readonly string[] | null, capability: string) => codes?.includes(capability) ?? false;
const LazyReputationReplyPolicyEditor = lazy(() => import("./marketing-reputation-reply-policy-editor").then((module) => ({ default: module.ReputationReplyPolicyEditor })));

const reputationCopy = (language: MarketingLanguage): MarketingCopy => language === "ar" ? {
  eyebrow: "التسويق والسمعة", refresh: "تحديث", title: "السمعة وGoogle", overview: "حالة الموصلات وسياسة الردود الداخلية. لا يوجد نشر تلقائي أو اتصال Google حي في هذه المرحلة.", fail: "تعذر تحميل بيانات السمعة.", noPermission: "لا تملك صلاحية عرض الأداء التسويقي", reputation: "السمعة وGoogle", notReady: "لا توجد حقائق موفر أو أرقام سمعة في هذه المرحلة.", notConnected: "غير متصل", noWrite: "لا يوجد نشر أو رد تلقائي أو اتصال Google الآن.", publisherUnavailable: "زر «نشر الآن» وطابور المراجعة سيظهران هنا بعد الربط؛ لا يوجد نشر فعلي الآن.", replyAutomation: "الردود التلقائية", replyAutomationHelp: "اضبط السياسة الآن؛ لن تنشر خارجياً قبل ربط Google Business واعتماد النشر.", automationStatus: "حالة الأتمتة", paused: "موقوف مؤقتاً", activeWhenConnected: "سيعمل عند اكتمال الربط", disabled: "متوقفة", automationOn: "تشغيل الردود عند الربط", autoFourFive: "رد تلقائي لتقييمات 4 و5 نجوم", autoThree: "رد تلقائي لتقييم 3 نجوم إذا كان آمناً", lowManual: "تقييمات 1 و2 نجمة: مسودة فقط ثم نشر يدوي", threeRule: "الثلاث نجوم تذهب للمراجعة عند وجود شكوى أو طلب استرجاع أو موضوع حساس.", method: "طريقة كتابة الرد", template: "قوالب آمنة", basira: "مسودة بصيرة بعد تفعيلها", tone: "نبرة الرد", warm: "ودودة", professional: "مهنية", formal: "رسمية", languageMode: "لغة الرد", matchReview: "نفس لغة التقييم", arabic: "العربية", english: "الإنجليزية", signature: "توقيع الرد (اختياري)", savePolicy: "حفظ سياسة الردود", policySaved: "تم حفظ سياسة الردود.", policyFail: "تعذر حفظ سياسة الردود.", enabled: "مفعلة عند الربط", configurePolicy: "إعداد سياسة الردود", editPolicy: "تعديل سياسة الردود", policyLoading: "جارٍ تحميل إعدادات سياسة الردود…"
} : {
  eyebrow: "Marketing & Reputation", refresh: "Refresh", title: "Reputation & Google", overview: "Provider status and the internal reply policy. There is no automated publishing or live Google connection at this stage.", fail: "Reputation data could not be loaded.", noPermission: "You cannot view marketing performance", reputation: "Reputation & Google", notReady: "No provider facts or reputation numbers exist at this stage.", notConnected: "Not connected", noWrite: "There is no Google publishing, reply automation, or connection now.", publisherUnavailable: "The review queue and Publish now action will appear here after connection; no live publishing exists now.", replyAutomation: "Automated replies", replyAutomationHelp: "Configure the policy now. It cannot publish until Google Business is connected and publishing is approved.", automationStatus: "Automation status", paused: "Paused", activeWhenConnected: "Will operate after connection", disabled: "Disabled", automationOn: "Enable replies after connection", autoFourFive: "Automatically reply to 4 and 5 star reviews", autoThree: "Automatically reply to safe 3 star reviews", lowManual: "1 and 2 star reviews: draft only, then manual publishing", threeRule: "Three-star reviews are held when they contain a complaint, refund request, or sensitive subject.", method: "Reply authoring", template: "Safe templates", basira: "Basira draft after activation", tone: "Reply tone", warm: "Warm", professional: "Professional", formal: "Formal", languageMode: "Reply language", matchReview: "Match review language", arabic: "Arabic", english: "English", signature: "Reply signature (optional)", savePolicy: "Save reply policy", policySaved: "Reply policy saved.", policyFail: "Reply policy could not be saved.", enabled: "Enabled after connection", configurePolicy: "Configure reply policy", editPolicy: "Edit reply policy", policyLoading: "Loading reply policy settings…"
};

export function MarketingReputationRoute({ language, permissionCodes }: { language: MarketingLanguage; permissionCodes: readonly string[] | null }) {
  const ar = marketingIsArabic(language);
  const session = activeSession();
  const copy = reputationCopy(language);
  const canRead = visible(permissionCodes, "marketing.insights.read");

  if (!session) return <DailySalesSignIn language={language} />;
  if (!canRead) return <section className="baseer-workspace"><BaseerEmptyState title={copy.noPermission} /></section>;

  return <BaseerCompanyReadQuery session={session} resource="marketing.reputation" scope={[language, [...(permissionCodes ?? [])].sort().join(",")]} load={(current, signal) => api<MarketingWorkspaceRead>(current, "/marketing", { signal })}>{({ data, loading, error, refetch }) => <section className="baseer-workspace marketing-workspace" dir={ar ? "rtl" : "ltr"}>
    <header className="baseer-section-header"><div className="baseer-section-header__copy"><p className="baseer-section-header__eyebrow">{copy.eyebrow}</p><h2>{copy.title}</h2><p>{copy.overview}</p></div><div className="baseer-section-header__actions"><BaseerButton type="button" variant="secondary" disabled={loading} onClick={() => void refetch()}>{copy.refresh}</BaseerButton></div></header>
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
    <header><h3>{copy.reputation}</h3><p>{copy.notReady}</p></header>
    <div className="baseer-card-grid">{(data?.readiness ?? []).map((item) => <BaseerCard key={item.provider}>
      <strong>{item.provider === "GOOGLE_ADS" ? "Google Ads" : "Google Business"}</strong>
      <span className="baseer-status-badge baseer-status-badge--warning"><i className="baseer-status-badge__dot" />{copy.notConnected}</span>
      <p>{ar ? item.messageAr : item.provider === "GOOGLE_ADS" ? "Google Ads is not connected at this stage; no spend, conversions, or spending decisions are available." : "Google Business is not connected; no reviews, posts, or publishing authority are available at this stage."}</p>
    </BaseerCard>)}</div>
    {data ? <BaseerCard className="marketing-reputation__automation"><header><div><strong>{copy.replyAutomation}</strong><p>{copy.replyAutomationHelp}</p></div><span className="baseer-status-badge baseer-status-badge--warning"><i className="baseer-status-badge__dot" />{data.replyPolicy.automationStatus === "PAUSED" ? copy.paused : data.replyPolicy.automationStatus === "ENABLED" ? copy.activeWhenConnected : copy.disabled}</span></header>{canManagePolicy ? <><BaseerButton type="button" variant="secondary" onClick={() => setPolicyEditorOpen(true)}>{policyEditorOpen ? copy.editPolicy : copy.configurePolicy}</BaseerButton>{policyEditorOpen ? <Suspense fallback={<p role="status">{copy.policyLoading}</p>}><LazyReputationReplyPolicyEditor language={language} policy={data.replyPolicy} copy={copy} canManage={canManagePolicy} onSaved={onSaved} /></Suspense> : null}</> : <p>{copy.replyAutomationHelp}</p>}</BaseerCard> : null}
    <BaseerCard tone="muted"><strong>{copy.noWrite}</strong><p>{copy.publisherUnavailable}</p></BaseerCard>
  </section>;
}
