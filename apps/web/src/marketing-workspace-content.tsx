import { useEffect, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCombobox } from "./baseer-combobox";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerDatePicker } from "./baseer-date-picker";
import { BaseerEmptyState } from "./baseer-workspace";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { useBaseerForm, z } from "./baseer-form-state";
import { BaseerFilterSelect, BaseerFilterToggle } from "./baseer-filter-controls";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";

type Language = "ar" | "en";
type Campaign = { id: string; titleAr: string; titleEn: string | null; platform: "MANUAL" | "GOOGLE_ADS" | "META" | "TIKTOK" | "SNAPCHAT" | "OTHER"; externalReference: string | null; startsOn: string | null; endsOn: string | null; status: "DRAFT" | "PLANNED" | "ACTIVE" | "COMPLETED" | "CANCELLED" | "ARCHIVED"; objective: string | null; notes: string | null; createdAt: string; updatedAt: string };
type ReplyPolicy = { automationStatus: "DISABLED" | "ENABLED" | "PAUSED"; authoringMethod: "TEMPLATE" | "BASIRA_DRAFT"; tone: "WARM" | "PROFESSIONAL" | "FORMAL"; languageMode: "MATCH_REVIEW" | "ARABIC" | "ENGLISH"; autoFourFiveEnabled: boolean; autoThreeIfSafe: boolean; signature: string | null; revision: number; executionReadiness: "NOT_CONNECTED" };
type ReplyPolicyDraft = Omit<ReplyPolicy, "revision" | "executionReadiness">;
type Workspace = { companyId: string; campaigns: Campaign[]; readiness: Array<{ provider: "GOOGLE_ADS" | "GOOGLE_BUSINESS"; status: "NOT_CONNECTED"; messageAr: string }>; replyPolicy: ReplyPolicy };
type Draft = { titleAr: string; titleEn: string; platform: Campaign["platform"]; startsOn: string; endsOn: string; status: Exclude<Campaign["status"], "ARCHIVED">; objective: string; notes: string; externalReference: string };

const blank = (): Draft => ({ titleAr: "", titleEn: "", platform: "MANUAL", startsOn: "", endsOn: "", status: "DRAFT", objective: "", notes: "", externalReference: "" });
const visible = (codes: readonly string[] | null, capability: string) => codes === null || codes.includes(capability);
const campaignStatuses: Campaign["status"][] = ["DRAFT", "PLANNED", "ACTIVE", "COMPLETED", "CANCELLED", "ARCHIVED"];
const campaignPlatforms: Campaign["platform"][] = ["MANUAL", "GOOGLE_ADS", "META", "TIKTOK", "SNAPCHAT", "OTHER"];
function campaignStatusLabel(status: Campaign["status"], ar: boolean) {
  return ar ? ({ DRAFT: "مسودة", PLANNED: "مخططة", ACTIVE: "نشطة", COMPLETED: "مكتملة", CANCELLED: "ملغاة", ARCHIVED: "مؤرشفة" } as const)[status] : ({ DRAFT: "Draft", PLANNED: "Planned", ACTIVE: "Active", COMPLETED: "Completed", CANCELLED: "Cancelled", ARCHIVED: "Archived" } as const)[status];
}
function campaignPlatformLabel(platform: Campaign["platform"], ar: boolean) {
  return ar ? ({ MANUAL: "يدوية", GOOGLE_ADS: "Google Ads", META: "Meta", TIKTOK: "TikTok", SNAPCHAT: "Snapchat", OTHER: "أخرى" } as const)[platform] : ({ MANUAL: "Manual", GOOGLE_ADS: "Google Ads", META: "Meta", TIKTOK: "TikTok", SNAPCHAT: "Snapchat", OTHER: "Other" } as const)[platform];
}
function campaignStatusTone(status: Campaign["status"]) { return status === "ACTIVE" || status === "COMPLETED" ? "success" : status === "CANCELLED" ? "danger" : status === "PLANNED" ? "info" : status === "ARCHIVED" ? "neutral" : "warning"; }

export function MarketingWorkspaceContent({ language, section, permissionCodes }: { language: Language; section: number; permissionCodes: readonly string[] | null }) {
  const ar = language === "ar";
  const copy = ar ? {
    eyebrow: "Marketing & Reputation", refresh: "تحديث", newCampaign: "إضافة حملة", title: "الأداء التسويقي والسمعة", overview: "سجل داخلي للحملات؛ لا يخلط بيانات Google أو الحقيقة المالية.", campaigns: "الحملات المسجلة", active: "نشطة", planned: "مخططة", completed: "مكتملة", reputation: "السمعة وGoogle", provider: "الموصل", status: "الحالة", noData: "لا توجد حملة مسجلة بعد", noDataDetail: "ابدأ بتسجيل الحملة وسياقها. لن تُستنتج المبيعات أو التحويلات من هذا السجل.", sources: "حدود المصدر والسياسة", sourcesDetail: "Google Ads قراءة وتحليل فقط لاحقاً. Google Business يمر لاحقاً عبر ناشر يدوي مؤكد، وليس نشرًا آليًا.", edit: "تعديل", archive: "أرشفة", save: "حفظ الحملة", editTitle: "تعديل الحملة", createTitle: "إضافة حملة", titleAr: "اسم الحملة بالعربية", titleEn: "اسم الحملة بالإنجليزية (اختياري)", platform: "المنصة", from: "من", to: "إلى", lifecycle: "الحالة", objective: "الهدف (اختياري)", notes: "ملاحظة داخلية (اختيارية)", ref: "مرجع خارجي وصفي (اختياري)", cancel: "إلغاء", fail: "تعذر إتمام طلب الحملة.", archived: "تمت الأرشفة.", reason: "سبب الأرشفة", archiveTitle: "أرشفة الحملة", archiveText: "لا يتم حذف السجل؛ تحفظ الأرشفة أثر الحملة وسجل التدقيق.", archiveConfirm: "أرشفة", notConnected: "غير متصل", notReady: "لا توجد حقائق موفر أو أرقام سمعة في هذه المرحلة.", noWrite: "لا يوجد نشر أو رد تلقائي أو اتصال Google الآن.", quality: "حالة البيانات", dataBoundary: "غير متاح حتى الاتصال المعتمد", sectionHint: "تُعرض حالة الجاهزية بصدق ولا تُحوّل إلى صفر.", replyAutomation: "الردود التلقائية", replyAutomationHelp: "اضبط السياسة الآن؛ لن تنشر خارجياً قبل ربط Google Business واعتماد النشر.", automationOn: "تشغيل الردود عند الربط", autoFourFive: "رد تلقائي لتقييمات 4 و5 نجوم", autoThree: "رد تلقائي لتقييم 3 نجوم إذا كان آمناً", lowManual: "تقييمات 1 و2 نجمة: مسودة فقط ثم نشر يدوي", threeRule: "الثلاث نجوم تذهب للمراجعة عند وجود شكوى أو طلب استرجاع أو موضوع حساس.", method: "طريقة كتابة الرد", template: "قوالب آمنة", basira: "مسودة بصيرة بعد تفعيلها", tone: "نبرة الرد", warm: "ودودة", professional: "مهنية", formal: "رسمية", languageMode: "لغة الرد", matchReview: "نفس لغة التقييم", arabic: "العربية", english: "الإنجليزية", signature: "توقيع الرد (اختياري)", savePolicy: "حفظ سياسة الردود", policySaved: "تم حفظ سياسة الردود.", policyFail: "تعذر حفظ سياسة الردود.", paused: "موقوف مؤقتاً", activeWhenConnected: "سيعمل عند اكتمال الربط", publisherUnavailable: "زر «نشر الآن» وطابور المراجعة سيظهران هنا بعد الربط؛ لا يوجد نشر فعلي الآن.", automationStatus: "حالة الأتمتة", disabled: "متوقفة", enabled: "مفعلة عند الربط" } : {
    eyebrow: "Marketing & Reputation", refresh: "Refresh", newCampaign: "Add campaign", title: "Marketing performance & reputation", overview: "An internal campaign register. It never mixes Google data with financial truth.", campaigns: "Registered campaigns", active: "Active", planned: "Planned", completed: "Completed", reputation: "Reputation & Google", provider: "Provider", status: "Status", noData: "No campaign is recorded yet", noDataDetail: "Start by recording campaign context. This register never infers sales or conversions.", sources: "Source and policy boundary", sourcesDetail: "Google Ads will be read and analysed only. Google Business will later use a manually confirmed publisher, never automation.", edit: "Edit", archive: "Archive", save: "Save campaign", editTitle: "Edit campaign", createTitle: "Add campaign", titleAr: "Arabic campaign title", titleEn: "English campaign title (optional)", platform: "Platform", from: "From", to: "To", lifecycle: "Status", objective: "Objective (optional)", notes: "Internal note (optional)", ref: "Descriptive external reference (optional)", cancel: "Cancel", fail: "The campaign request could not be completed.", archived: "Archived.", reason: "Archive reason", archiveTitle: "Archive campaign", archiveText: "The record is not deleted. Archiving preserves campaign context and audit history.", archiveConfirm: "Archive", notConnected: "Not connected", notReady: "No provider facts or reputation numbers exist at this stage.", noWrite: "There is no Google publishing, reply automation, or connection now.", quality: "Data status", dataBoundary: "Unavailable until an approved connection", sectionHint: "Readiness is shown honestly and never converted to zero.", replyAutomation: "Automated replies", replyAutomationHelp: "Configure the policy now. It cannot publish until Google Business is connected and publishing is approved.", automationOn: "Enable replies after connection", autoFourFive: "Automatically reply to 4 and 5 star reviews", autoThree: "Automatically reply to safe 3 star reviews", lowManual: "1 and 2 star reviews: draft only, then manual publishing", threeRule: "Three-star reviews are held when they contain a complaint, refund request, or sensitive subject.", method: "Reply authoring", template: "Safe templates", basira: "Basira draft after activation", tone: "Reply tone", warm: "Warm", professional: "Professional", formal: "Formal", languageMode: "Reply language", matchReview: "Match review language", arabic: "Arabic", english: "English", signature: "Reply signature (optional)", savePolicy: "Save reply policy", policySaved: "Reply policy saved.", policyFail: "The reply policy could not be saved.", paused: "Paused", activeWhenConnected: "Will operate after connection", publisherUnavailable: "The review queue and Publish now action will appear here after connection; no live publishing exists now.", automationStatus: "Automation status", disabled: "Disabled", enabled: "Enabled after connection" };
  const [session, setSession] = useState<ActiveSession | null>(activeSession());
  const [dialog, setDialog] = useState<"create" | "edit" | "archive" | null>(null);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [draft, setDraft] = useState<Draft>(blank);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const writable = visible(permissionCodes, "marketing.campaign.write");
  const canManageReplyPolicy = visible(permissionCodes, "marketing.reputation.policy.manage");
  const canRead = visible(permissionCodes, "marketing.insights.read");
  useEffect(() => setSession(activeSession()), []);
  const scope = useMemo(() => [language, String(section), [...(permissionCodes ?? [])].sort().join(",")], [language, section, permissionCodes]);
  const openCreate = () => { setSelected(null); setDraft(blank()); setMessage(null); setDialog("create"); };
  const openEdit = (campaign: Campaign) => { setSelected(campaign); setDraft({ titleAr: campaign.titleAr, titleEn: campaign.titleEn ?? "", platform: campaign.platform, startsOn: campaign.startsOn ?? "", endsOn: campaign.endsOn ?? "", status: campaign.status === "ARCHIVED" ? "DRAFT" : campaign.status, objective: campaign.objective ?? "", notes: campaign.notes ?? "", externalReference: campaign.externalReference ?? "" }); setMessage(null); setDialog("edit"); };
  const submit = async (values: Draft, reload: () => Promise<void>) => { if (!session || busy) return; setBusy(true); setMessage(null); try { const body = { ...values, titleAr: values.titleAr.trim(), ...(values.titleEn.trim() ? { titleEn: values.titleEn.trim() } : {}), ...(values.startsOn ? { startsOn: values.startsOn } : {}), ...(values.endsOn ? { endsOn: values.endsOn } : {}), ...(values.objective.trim() ? { objective: values.objective.trim() } : {}), ...(values.notes.trim() ? { notes: values.notes.trim() } : {}), ...(values.externalReference.trim() ? { externalReference: values.externalReference.trim() } : {}), idempotencyKey: requestId() }; await api(session, selected ? `/marketing/campaigns/${selected.id}` : "/marketing/campaigns", { method: selected ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); setDialog(null); await reload(); } catch (error) { setMessage(presentBaseerApiError(error, language, copy.fail)); } finally { setBusy(false); } };
  const archive = async (reason: string, reload: () => Promise<void>) => { if (!session || !selected || busy) return; setBusy(true); setMessage(null); try { await api(session, "/marketing/campaigns/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: selected.id, reason: reason.trim(), idempotencyKey: requestId() }) }); setDialog(null); setMessage(copy.archived); await reload(); } catch (error) { setMessage(presentBaseerApiError(error, language, copy.fail)); } finally { setBusy(false); } };
  if (!session) return <DailySalesSignIn language={language} />;
  if (!canRead) return <section className="baseer-workspace"><BaseerEmptyState title={ar ? "لا تملك صلاحية عرض الأداء التسويقي" : "You cannot view marketing performance"} /></section>;
  return <BaseerCompanyReadQuery session={session} resource="marketing.workspace" scope={scope} load={(current, signal) => api<Workspace>(current, "/marketing", { signal })}>{({ data, loading, error, refetch }) => <section className="baseer-workspace marketing-workspace" dir={ar ? "rtl" : "ltr"}>
    <header className="baseer-section-header"><div className="baseer-section-header__copy"><p className="baseer-section-header__eyebrow">{copy.eyebrow}</p><h2>{copy.title}</h2><p>{copy.overview}</p></div><div className="baseer-section-header__actions"><BaseerButton type="button" variant="secondary" disabled={loading || busy} onClick={() => void refetch()}>{copy.refresh}</BaseerButton>{writable && section <= 1 ? <BaseerButton type="button" disabled={busy} onClick={openCreate}>{copy.newCampaign}</BaseerButton> : null}</div></header>
    {message ? <BaseerCard className="marketing-workspace__message" padding="compact">{message}</BaseerCard> : null}
    {error ? <BaseerCard className="marketing-workspace__message" padding="compact">{copy.fail}</BaseerCard> : null}
    {section === 0 ? <Overview data={data} copy={copy} ar={ar} /> : null}
    {section === 1 ? <CampaignRegister data={data} copy={copy} ar={ar} writable={writable} onEdit={openEdit} onArchive={(campaign) => { setSelected(campaign); setDialog("archive"); }} /> : null}
    {section === 2 ? <Reputation data={data} copy={copy} ar={ar} language={language} session={session} canManagePolicy={canManageReplyPolicy} onSaved={refetch} /> : null}
    {section === 3 ? <Policies copy={copy} /> : null}
    <CampaignDialog open={dialog === "create" || dialog === "edit"} language={language} busy={busy} editing={dialog === "edit"} initial={draft} copy={copy} error={message} onClose={() => setDialog(null)} onSubmit={(values) => void submit(values, refetch)} />
    <ArchiveDialog open={dialog === "archive"} language={language} busy={busy} copy={copy} error={message} onClose={() => setDialog(null)} onSubmit={(reason) => void archive(reason, refetch)} />
  </section>}</BaseerCompanyReadQuery>;
}

function Overview({ data, copy, ar }: { data: Workspace | undefined; copy: Record<string, string>; ar: boolean }) { const campaigns = data?.campaigns ?? []; return <><div className="baseer-metric-grid"><Metric label={copy.campaigns} value={campaigns.length} /><Metric label={copy.active} value={campaigns.filter((item) => item.status === "ACTIVE").length} /><Metric label={copy.planned} value={campaigns.filter((item) => item.status === "PLANNED").length} /><Metric label={copy.completed} value={campaigns.filter((item) => item.status === "COMPLETED").length} /></div><BaseerCard className="marketing-workspace__boundary"><strong>{copy.quality}</strong><p>{copy.sectionHint}</p><span>{copy.dataBoundary}</span></BaseerCard><Reputation data={data} copy={copy} ar={ar} /></>; }
function Metric({ label, value }: { label: string; value: number }) { return <BaseerCard className="baseer-metric"><small>{label}</small><strong>{value}</strong></BaseerCard>; }
function CampaignRegister({ data, copy, ar, writable, onEdit, onArchive }: { data: Workspace | undefined; copy: Record<string, string>; ar: boolean; writable: boolean; onEdit: (campaign: Campaign) => void; onArchive: (campaign: Campaign) => void }) {
  const campaigns = data?.campaigns ?? [];
  const [status, setStatus] = useState<"ALL" | Campaign["status"]>("ALL");
  if (!campaigns.length) return <BaseerEmptyState title={copy.noData} description={copy.noDataDetail} />;
  const filtered = status === "ALL" ? campaigns : campaigns.filter((campaign) => campaign.status === status);
  return <section className="marketing-campaign-register">
    <div className="baseer-filter-bar marketing-campaign-register__filters"><BaseerFilterSelect label={copy.status} value={status} onChange={(event) => setStatus(event.target.value as "ALL" | Campaign["status"])}><option value="ALL">{ar ? "كل الحالات" : "All statuses"}</option>{campaignStatuses.map((item) => <option key={item} value={item}>{campaignStatusLabel(item, ar)}</option>)}</BaseerFilterSelect></div>
    {filtered.length ? <div className="marketing-campaign-list">{filtered.map((campaign) => <BaseerCard key={campaign.id} className="marketing-campaign"><header><div><strong>{ar ? campaign.titleAr : campaign.titleEn ?? campaign.titleAr}</strong><small>{campaignPlatformLabel(campaign.platform, ar)} · {campaign.startsOn ?? "—"} — {campaign.endsOn ?? "—"}</small></div><span className={`baseer-status-badge baseer-status-badge--${campaignStatusTone(campaign.status)}`}><i className="baseer-status-badge__dot" />{campaignStatusLabel(campaign.status, ar)}</span></header>{campaign.objective ? <p>{campaign.objective}</p> : null}{campaign.notes ? <small>{campaign.notes}</small> : null}{writable && campaign.status !== "ARCHIVED" ? <footer><BaseerButton type="button" variant="secondary" onClick={() => onEdit(campaign)}>{copy.edit}</BaseerButton><BaseerButton type="button" variant="quiet" onClick={() => onArchive(campaign)}>{copy.archive}</BaseerButton></footer> : null}</BaseerCard>)}</div> : <BaseerEmptyState title={ar ? "لا توجد حملات بهذه الحالة" : "No campaigns match this status"} description={ar ? "غيّر الحالة المختارة أو أضف حملة جديدة." : "Choose another status or add a campaign."} />}
  </section>;
}
function Reputation({ data, copy, ar, language, session, canManagePolicy = false, onSaved }: { data: Workspace | undefined; copy: Record<string, string>; ar: boolean; language?: Language; session?: ActiveSession; canManagePolicy?: boolean; onSaved?: () => Promise<void> }) { return <section className="marketing-reputation"><header><h3>{copy.reputation}</h3><p>{copy.notReady}</p></header><div className="baseer-card-grid">{(data?.readiness ?? []).map((item) => <BaseerCard key={item.provider}><strong>{item.provider === "GOOGLE_ADS" ? "Google Ads" : "Google Business"}</strong><span className="baseer-status-badge baseer-status-badge--warning"><i className="baseer-status-badge__dot" />{copy.notConnected}</span><p>{ar ? item.messageAr : item.provider === "GOOGLE_ADS" ? "Google Ads is not connected at this stage; no spend, conversions, or spending decisions are available." : "Google Business is not connected; no reviews, posts, or publishing authority are available at this stage."}</p></BaseerCard>)}</div>{language && session && data ? <ReputationReplyPolicyForm language={language} session={session} policy={data.replyPolicy} copy={copy} canManage={canManagePolicy} onSaved={onSaved} /> : null}<BaseerCard tone="muted"><strong>{copy.noWrite}</strong><p>{copy.publisherUnavailable}</p></BaseerCard></section>; }

type ReputationReplyPolicyForm = ReplyPolicyDraft & { signature: string };

function ReputationReplyPolicyForm({ language, session, policy, copy, canManage, onSaved }: { language: Language; session: ActiveSession; policy: ReplyPolicy; copy: Record<string, string>; canManage: boolean; onSaved?: () => Promise<void> }) {
  const initial = useMemo<ReputationReplyPolicyForm>(() => ({ automationStatus: policy.automationStatus, authoringMethod: policy.authoringMethod, tone: policy.tone, languageMode: policy.languageMode, autoFourFiveEnabled: policy.autoFourFiveEnabled, autoThreeIfSafe: policy.autoThreeIfSafe, signature: policy.signature ?? "" }), [policy]);
  const schema = useMemo(() => z.object({ automationStatus: z.enum(["DISABLED", "ENABLED", "PAUSED"]), authoringMethod: z.enum(["TEMPLATE", "BASIRA_DRAFT"]), tone: z.enum(["WARM", "PROFESSIONAL", "FORMAL"]), languageMode: z.enum(["MATCH_REVIEW", "ARABIC", "ENGLISH"]), autoFourFiveEnabled: z.boolean(), autoThreeIfSafe: z.boolean(), signature: z.string().max(160) }), []);
  const form = useBaseerForm<ReputationReplyPolicyForm>({ values: initial, schema, shouldFocusError: true });
  const values = form.watch();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const update = async (next: ReputationReplyPolicyForm) => { if (busy || !canManage) return; setBusy(true); setMessage(null); try { await api(session, "/marketing/reputation/reply-policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...next, ...(next.signature.trim() ? { signature: next.signature.trim() } : {}), idempotencyKey: requestId() }) }); setMessage(copy.policySaved); await onSaved?.(); } catch (error) { setMessage(presentBaseerApiError(error, language, copy.policyFail)); } finally { setBusy(false); } };
  const set = <Key extends keyof ReputationReplyPolicyForm>(key: Key, value: ReputationReplyPolicyForm[Key]) => form.setValue(key, value as never, { shouldDirty: true, shouldValidate: true });
  return <BaseerCard className="marketing-reputation__automation"><header><div><strong>{copy.replyAutomation}</strong><p>{copy.replyAutomationHelp}</p></div><span className="baseer-status-badge baseer-status-badge--warning"><i className="baseer-status-badge__dot" />{policy.automationStatus === "PAUSED" ? copy.paused : policy.automationStatus === "ENABLED" ? copy.activeWhenConnected : copy.disabled}</span></header>{canManage ? <form data-baseer-rhf-form="true" className="marketing-reputation__form" noValidate onSubmit={form.handleSubmit((next) => void update(next))}><label>{copy.automationStatus}<BaseerCombobox label={copy.automationStatus} placeholder={copy.automationStatus} value={values.automationStatus} options={[{ id: "DISABLED", label: copy.disabled }, { id: "ENABLED", label: copy.enabled }, { id: "PAUSED", label: copy.paused }]} onChange={(next) => set("automationStatus", next as ReputationReplyPolicyForm["automationStatus"])} /></label><fieldset><legend>{copy.automationOn}</legend><BaseerFilterToggle label={copy.autoFourFive} checked={values.autoFourFiveEnabled} onChange={(next) => set("autoFourFiveEnabled", next)} /><BaseerFilterToggle label={copy.autoThree} checked={values.autoThreeIfSafe} onChange={(next) => set("autoThreeIfSafe", next)} /><p>{copy.lowManual}</p><p>{copy.threeRule}</p></fieldset><label>{copy.method}<BaseerCombobox label={copy.method} placeholder={copy.method} value={values.authoringMethod} options={[{ id: "TEMPLATE", label: copy.template }, { id: "BASIRA_DRAFT", label: copy.basira }]} onChange={(next) => set("authoringMethod", next as ReputationReplyPolicyForm["authoringMethod"])} /></label><label>{copy.tone}<BaseerCombobox label={copy.tone} placeholder={copy.tone} value={values.tone} options={[{ id: "WARM", label: copy.warm }, { id: "PROFESSIONAL", label: copy.professional }, { id: "FORMAL", label: copy.formal }]} onChange={(next) => set("tone", next as ReputationReplyPolicyForm["tone"])} /></label><label>{copy.languageMode}<BaseerCombobox label={copy.languageMode} placeholder={copy.languageMode} value={values.languageMode} options={[{ id: "MATCH_REVIEW", label: copy.matchReview }, { id: "ARABIC", label: copy.arabic }, { id: "ENGLISH", label: copy.english }]} onChange={(next) => set("languageMode", next as ReputationReplyPolicyForm["languageMode"])} /></label><label>{copy.signature}<input {...form.register("signature")} /></label><footer><BaseerButton type="submit" disabled={busy}>{copy.savePolicy}</BaseerButton>{message ? <small role="status">{message}</small> : null}</footer></form> : <p>{copy.replyAutomationHelp}</p>}</BaseerCard>;
}
function Policies({ copy }: { copy: Record<string, string> }) { return <BaseerCard className="marketing-workspace__boundary"><strong>{copy.sources}</strong><p>{copy.sourcesDetail}</p><ul><li>Google Ads: read-only after a separate provider decision.</li><li>Google Business: manual publisher after explicit confirmation.</li><li>Campaign context is not a finance fact and proves no sales impact.</li></ul></BaseerCard>; }

function campaignSchema(ar: boolean) {
  return z.object({
    titleAr: z.string().trim().min(1, ar ? "اسم الحملة بالعربية مطلوب." : "Arabic campaign title is required.").max(160),
    titleEn: z.string().max(160),
    platform: z.enum(["MANUAL", "GOOGLE_ADS", "META", "TIKTOK", "SNAPCHAT", "OTHER"]),
    startsOn: z.string(),
    endsOn: z.string(),
    status: z.enum(["DRAFT", "PLANNED", "ACTIVE", "COMPLETED", "CANCELLED"]),
    objective: z.string().max(500),
    notes: z.string().max(2000),
    externalReference: z.string().max(160),
  }).refine((value) => !value.startsOn || !value.endsOn || value.startsOn <= value.endsOn, {
    path: ["endsOn"],
    message: ar ? "تاريخ النهاية لا يسبق البداية." : "Campaign end cannot precede its start.",
  });
}

function CampaignDialog({ open, language, busy, editing, initial, copy, error, onClose, onSubmit }: { open: boolean; language: Language; busy: boolean; editing: boolean; initial: Draft; copy: Record<string, string>; error: string | null; onClose: () => void; onSubmit: (values: Draft) => void }) {
  const ar = language === "ar";
  const schema = useMemo(() => campaignSchema(ar), [ar]);
  const form = useBaseerForm<Draft>({ values: initial, schema, shouldFocusError: true });
  const value = form.watch();
  const set = (key: keyof Draft, next: string) => form.setValue(key, next as never, { shouldDirty: true, shouldValidate: true });
  const fieldError = (name: keyof Draft) => form.formState.errors[name]?.message;
  return <BaseerFormDialog open={open} title={editing ? copy.editTitle : copy.createTitle} language={language} formId="marketing-campaign-form" submitLabel={copy.save} onClose={onClose} busy={busy} error={error} size="wide">
    <form id="marketing-campaign-form" data-baseer-rhf-form="true" className="marketing-campaign-form" noValidate onSubmit={form.handleSubmit((values) => onSubmit(values))}>
      <label>{copy.titleAr}<input aria-invalid={Boolean(fieldError("titleAr"))} {...form.register("titleAr")} autoFocus /></label>{fieldError("titleAr") ? <small className="baseer-field-error" role="alert">{fieldError("titleAr")}</small> : null}
      <label>{copy.titleEn}<input {...form.register("titleEn")} /></label>
      <label>{copy.platform}<BaseerCombobox label={copy.platform} placeholder={ar ? "اختر المنصة" : "Select platform"} value={value.platform} options={campaignPlatforms.map((item) => ({ id: item, label: campaignPlatformLabel(item, ar) }))} onChange={(next) => set("platform", next)} /></label>
      <div className="marketing-campaign-form__dates"><label>{copy.from}<BaseerDatePicker language={language} label={copy.from} value={value.startsOn} onChange={(next) => set("startsOn", next)} /></label><label>{copy.to}<BaseerDatePicker language={language} label={copy.to} value={value.endsOn} onChange={(next) => set("endsOn", next)} /></label></div>{fieldError("endsOn") ? <small className="baseer-field-error" role="alert">{fieldError("endsOn")}</small> : null}
      <label>{copy.lifecycle}<BaseerCombobox label={copy.lifecycle} placeholder={ar ? "اختر الحالة" : "Select status"} value={value.status} options={campaignStatuses.filter((item) => item !== "ARCHIVED").map((item) => ({ id: item, label: campaignStatusLabel(item, ar) }))} onChange={(next) => set("status", next)} /></label>
      <label>{copy.objective}<textarea {...form.register("objective")} /></label>{fieldError("objective") ? <small className="baseer-field-error" role="alert">{fieldError("objective")}</small> : null}
      <label>{copy.notes}<textarea {...form.register("notes")} /></label>{fieldError("notes") ? <small className="baseer-field-error" role="alert">{fieldError("notes")}</small> : null}
      <label>{copy.ref}<input {...form.register("externalReference")} /></label>{fieldError("externalReference") ? <small className="baseer-field-error" role="alert">{fieldError("externalReference")}</small> : null}
    </form>
  </BaseerFormDialog>;
}

function ArchiveDialog({ open, language, busy, copy, error, onClose, onSubmit }: { open: boolean; language: Language; busy: boolean; copy: Record<string, string>; error: string | null; onClose: () => void; onSubmit: (reason: string) => void }) {
  const ar = language === "ar";
  const schema = useMemo(() => z.object({ reason: z.string().trim().min(1, ar ? "سبب الأرشفة مطلوب." : "An archive reason is required.").max(500) }), [ar]);
  const form = useBaseerForm<{ reason: string }>({ defaultValues: { reason: "" }, schema, shouldFocusError: true });
  useEffect(() => { if (open) form.reset({ reason: "" }); }, [form, open]);
  const reasonError = form.formState.errors.reason?.message;
  return <BaseerFormDialog open={open} title={copy.archiveTitle} language={language} formId="marketing-archive-form" submitLabel={copy.archiveConfirm} onClose={onClose} busy={busy} error={error} size="compact">
    <form id="marketing-archive-form" data-baseer-rhf-form="true" className="marketing-campaign-form" noValidate onSubmit={form.handleSubmit(({ reason }) => onSubmit(reason))}>
      <p>{copy.archiveText}</p><label>{copy.reason}<textarea aria-invalid={Boolean(reasonError)} {...form.register("reason")} autoFocus /></label>{reasonError ? <small className="baseer-field-error" role="alert">{reasonError}</small> : null}
    </form>
  </BaseerFormDialog>;
}
