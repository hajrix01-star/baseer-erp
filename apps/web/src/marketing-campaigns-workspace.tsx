import { lazy, Suspense, useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerFilterSelect } from "./baseer-filter-controls";
import { BaseerOutputActions } from "./baseer-output-actions";
import { BaseerEmptyState } from "./baseer-workspace";
import { activeSession, api, requestId } from "./daily-sales-client";
import { DailySalesSignIn } from "./daily-sales-sign-in";
import type { MarketingCampaign, MarketingLanguage, MarketingWorkspaceRead as MarketingWorkspaceResponse } from "./marketing-shared";

const LazyCampaignMutationDialog = lazy(async () => ({ default: (await import("./marketing-campaign-mutation-dialog")).MarketingCampaignMutationDialog }));
const LazyCampaignDetailsDialog = lazy(async () => ({ default: (await import("./marketing-campaign-details-dialog")).MarketingCampaignDetailsDialog }));

export type Language = MarketingLanguage;
export type Campaign = MarketingCampaign;
export type MarketingWorkspaceRead = Pick<MarketingWorkspaceResponse, "companyId" | "campaigns">;
export type CampaignDraft = { titleAr: string; titleEn: string; platform: Campaign["platform"]; startsOn: string; endsOn: string; status: Exclude<Campaign["status"], "ARCHIVED">; objective: string; notes: string; externalReference: string; plannedCost: string };
export type CampaignCopy = Record<"refresh" | "newCampaign" | "title" | "overview" | "status" | "noData" | "noDataDetail" | "edit" | "archive" | "save" | "editTitle" | "createTitle" | "titleAr" | "titleEn" | "platform" | "from" | "to" | "lifecycle" | "objective" | "notes" | "ref" | "fail" | "archived" | "reason" | "archiveTitle" | "archiveText" | "archiveConfirm", string>;

const blank = (): CampaignDraft => ({ titleAr: "", titleEn: "", platform: "MANUAL", startsOn: "", endsOn: "", status: "DRAFT", objective: "", notes: "", externalReference: "", plannedCost: "" });
const visible = (codes: readonly string[] | null, capability: string) => !!codes?.includes(capability);
const statusValues: Campaign["status"][] = ["DRAFT", "PLANNED", "ACTIVE", "COMPLETED", "CANCELLED", "ARCHIVED"];

export function campaignStatusLabel(status: Campaign["status"], ar: boolean) {
  return ar ? ({ DRAFT: "مسودة", PLANNED: "مخططة", ACTIVE: "نشطة", COMPLETED: "مكتملة", CANCELLED: "ملغاة", ARCHIVED: "مؤرشفة" } as const)[status] : ({ DRAFT: "Draft", PLANNED: "Planned", ACTIVE: "Active", COMPLETED: "Completed", CANCELLED: "Cancelled", ARCHIVED: "Archived" } as const)[status];
}
export function campaignPlatformLabel(platform: Campaign["platform"], ar: boolean) {
  return ar ? ({ MANUAL: "يدوية", GOOGLE_ADS: "Google Ads", META: "Meta", TIKTOK: "TikTok", SNAPCHAT: "Snapchat", OTHER: "أخرى" } as const)[platform] : ({ MANUAL: "Manual", GOOGLE_ADS: "Google Ads", META: "Meta", TIKTOK: "TikTok", SNAPCHAT: "Snapchat", OTHER: "Other" } as const)[platform];
}
function campaignStatusTone(status: Campaign["status"]) { return status === "ACTIVE" || status === "COMPLETED" ? "success" : status === "CANCELLED" ? "danger" : status === "PLANNED" ? "info" : status === "ARCHIVED" ? "neutral" : "warning"; }

function copyFor(language: Language): CampaignCopy {
  return language === "ar" ? {
    refresh: "تحديث", newCampaign: "إضافة حملة", title: "الحملات المسجلة", overview: "سجل داخلي للحملات؛ لا يخلط بيانات Google أو الحقيقة المالية.", status: "الحالة", noData: "لا توجد حملة مسجلة بعد", noDataDetail: "ابدأ بتسجيل الحملة وسياقها. لن تُستنتج المبيعات أو التحويلات من هذا السجل.", edit: "تعديل", archive: "أرشفة", save: "حفظ الحملة", editTitle: "تعديل الحملة", createTitle: "إضافة حملة", titleAr: "اسم الحملة بالعربية", titleEn: "اسم الحملة بالإنجليزية (اختياري)", platform: "المنصة", from: "من", to: "إلى", lifecycle: "الحالة", objective: "الهدف (اختياري)", notes: "ملاحظة داخلية (اختيارية)", ref: "مرجع خارجي وصفي (اختياري)", fail: "تعذر إتمام طلب الحملة.", archived: "تمت الأرشفة.", reason: "سبب الأرشفة", archiveTitle: "أرشفة الحملة", archiveText: "لا يتم حذف السجل؛ تحفظ الأرشفة أثر الحملة وسجل التدقيق.", archiveConfirm: "أرشفة",
  } : {
    refresh: "Refresh", newCampaign: "Add campaign", title: "Registered campaigns", overview: "An internal campaign register. It never mixes Google data with financial truth.", status: "Status", noData: "No campaign is recorded yet", noDataDetail: "Start by recording campaign context. This register never infers sales or conversions.", edit: "Edit", archive: "Archive", save: "Save campaign", editTitle: "Edit campaign", createTitle: "Add campaign", titleAr: "Arabic campaign title", titleEn: "English campaign title (optional)", platform: "Platform", from: "From", to: "To", lifecycle: "Status", objective: "Objective (optional)", notes: "Internal note (optional)", ref: "Descriptive external reference (optional)", fail: "The campaign request could not be completed", archived: "Archived", reason: "Archive reason", archiveTitle: "Archive campaign", archiveText: "The record is not deleted. Archiving preserves campaign context and audit history.", archiveConfirm: "Archive",
  };
}

export function MarketingCampaignsWorkspace({ language, permissionCodes }: { language: Language; permissionCodes: readonly string[] | null }) {
  const ar = language === "ar";
  const copy = copyFor(language);
  const session = activeSession();
  const [dialog, setDialog] = useState<"create" | "edit" | "archive" | "stop" | "details" | null>(null);
  const [selected, setSelected] = useState<Campaign | null>(null);
  const [draft, setDraft] = useState<CampaignDraft>(blank);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const writable = visible(permissionCodes, "marketing.campaign.write");
  const canRead = visible(permissionCodes, "marketing.insights.read");
  const canUseBasira = canRead && visible(permissionCodes, "platform.ai.use");
  const canLinkFinancialDocuments = writable && visible(permissionCodes, "finance.purchase_expense.read");
  const canIssueCampaignInvoice = writable && visible(permissionCodes, "finance.purchase_expense.create") && visible(permissionCodes, "finance.purchase_expense.read");
  const scope = useMemo(() => [[...(permissionCodes ?? [])].sort().join(",")], [permissionCodes]);

  const openCreate = () => { setSelected(null); setDraft(blank()); setMessage(null); setDialog("create"); };
  const openEdit = (campaign: Campaign) => { setSelected(campaign); setDraft({ titleAr: campaign.titleAr, titleEn: campaign.titleEn ?? "", platform: campaign.platform, startsOn: campaign.startsOn ?? "", endsOn: campaign.endsOn ?? "", status: campaign.status === "ARCHIVED" ? "DRAFT" : campaign.status, objective: campaign.objective ?? "", notes: campaign.notes ?? "", externalReference: campaign.externalReference ?? "", plannedCost: campaign.plannedCost ?? "" }); setMessage(null); setDialog("edit"); };
  if (!session) return <DailySalesSignIn language={language} />;
  if (!canRead) return <section className="baseer-workspace"><BaseerEmptyState title={ar ? "لا تملك صلاحية عرض الحملات" : "You cannot view campaigns"} /></section>;

  return <BaseerCompanyReadQuery session={session} resource="marketing.workspace" scope={scope} load={(current, signal) => api<MarketingWorkspaceRead>(current, "/marketing", { signal })}>{({ data, loading, error, refetch }) => {
    const submit = async (values: CampaignDraft) => { if (!writable || busy) return; setBusy(true); setMessage(null); try { const body = { ...values, titleAr: values.titleAr.trim(), ...(values.titleEn.trim() ? { titleEn: values.titleEn.trim() } : {}), ...(values.startsOn ? { startsOn: values.startsOn } : {}), ...(values.endsOn ? { endsOn: values.endsOn } : {}), ...(values.objective.trim() ? { objective: values.objective.trim() } : {}), ...(values.notes.trim() ? { notes: values.notes.trim() } : {}), ...(values.externalReference.trim() ? { externalReference: values.externalReference.trim() } : {}), ...(values.plannedCost.trim() ? { plannedCost: values.plannedCost.trim() } : {}), idempotencyKey: requestId() }; await api(session, selected ? `/marketing/campaigns/${selected.id}` : "/marketing/campaigns", { method: selected ? "PUT" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); setDialog(null); await refetch(); } catch (reason) { setMessage(presentBaseerApiError(reason, language, copy.fail)); } finally { setBusy(false); } };
    const archive = async (reason: string) => { if (!writable || !selected || busy) return; setBusy(true); setMessage(null); try { await api(session, "/marketing/campaigns/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ campaignId: selected.id, reason: reason.trim(), idempotencyKey: requestId() }) }); setDialog(null); setMessage(copy.archived); await refetch(); } catch (reason) { setMessage(presentBaseerApiError(reason, language, copy.fail)); } finally { setBusy(false); } };
    const stop = async (values: { stoppedOn: string; reason: string }) => { if (!writable || !selected || busy) return; setBusy(true); setMessage(null); try { await api(session, `/marketing/campaigns/${selected.id}/stop`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stoppedOn: values.stoppedOn, reason: values.reason.trim(), idempotencyKey: requestId() }) }); setDialog(null); setMessage(ar ? "تم إيقاف الحملة وحفظ تاريخ وسبب الإيقاف للتحليل." : "The campaign was stopped and its date and reason were retained for analysis."); await refetch(); } catch (reason) { setMessage(presentBaseerApiError(reason, language, ar ? "تعذر إيقاف الحملة." : "The campaign could not be stopped.")); } finally { setBusy(false); } };
    return <section className="baseer-workspace marketing-workspace" dir={ar ? "rtl" : "ltr"}><header className="baseer-section-header"><div className="baseer-section-header__copy"><p className="baseer-section-header__eyebrow">Marketing & Reputation</p><h2>{copy.title}</h2><p>{copy.overview}</p></div><div className="baseer-section-header__actions"><BaseerButton type="button" variant="secondary" disabled={loading || busy} onClick={() => void refetch()}>{copy.refresh}</BaseerButton>{writable ? <BaseerButton type="button" disabled={busy} onClick={openCreate}>{copy.newCampaign}</BaseerButton> : null}</div></header>{message ? <BaseerCard className="marketing-workspace__message" padding="compact">{message}</BaseerCard> : null}{error ? <BaseerCard className="marketing-workspace__message" padding="compact">{copy.fail}</BaseerCard> : null}<CampaignRegister data={data} ar={ar} copy={copy} language={language} session={session} writable={writable} onEdit={openEdit} onDetails={(campaign) => { setSelected(campaign); setDialog("details"); }} onStop={(campaign) => { setSelected(campaign); setDialog("stop"); }} onArchive={(campaign) => { setSelected(campaign); setDialog("archive"); }} />{dialog && dialog !== "details" ? <Suspense fallback={null}><LazyCampaignMutationDialog dialog={dialog} language={language} busy={busy} editing={dialog === "edit"} initial={draft} copy={copy} campaign={selected} error={message} onClose={() => setDialog(null)} onSubmit={submit} onArchive={archive} onStop={stop} /></Suspense> : null}{dialog === "details" && selected ? <Suspense fallback={null}><LazyCampaignDetailsDialog campaign={selected} language={language} session={session} writable={writable} canLinkFinancialDocuments={canLinkFinancialDocuments} canUseBasira={canUseBasira} canIssueCampaignInvoice={canIssueCampaignInvoice} onClose={() => setDialog(null)} /></Suspense> : null}</section>;
  }}</BaseerCompanyReadQuery>;
}

function CampaignRegister({ data, ar, copy, language, session, writable, onEdit, onDetails, onStop, onArchive }: { data: MarketingWorkspaceRead | undefined; ar: boolean; copy: CampaignCopy; language: Language; session: NonNullable<ReturnType<typeof activeSession>>; writable: boolean; onEdit: (campaign: Campaign) => void; onDetails: (campaign: Campaign) => void; onStop: (campaign: Campaign) => void; onArchive: (campaign: Campaign) => void }) {
  const campaigns = data?.campaigns ?? [];
  const [status, setStatus] = useState<"ALL" | Campaign["status"]>("ALL");
  if (!campaigns.length) return <BaseerEmptyState title={copy.noData} description={copy.noDataDetail} />;
  const filtered = status === "ALL" ? campaigns : campaigns.filter((campaign) => campaign.status === status);
  return <section className="marketing-campaign-register"><div className="baseer-filter-bar marketing-campaign-register__filters"><BaseerFilterSelect label={copy.status} value={status} onChange={(event) => setStatus(event.target.value as "ALL" | Campaign["status"])}><option value="ALL">{ar ? "كل الحالات" : "All statuses"}</option>{statusValues.map((item) => <option key={item} value={item}>{campaignStatusLabel(item, ar)}</option>)}</BaseerFilterSelect><BaseerOutputActions session={session} reportCode="marketing.campaign-register" language={language} filters={status === "ALL" ? {} : { status }} printLabel={ar ? "طباعة سجل الحملات A4" : "Print campaign register A4"} /></div>{filtered.length ? <div className="marketing-campaign-list">{filtered.map((campaign) => <BaseerCard key={campaign.id} className="marketing-campaign"><header><div><strong>{ar ? campaign.titleAr : campaign.titleEn ?? campaign.titleAr}</strong><small>{campaignPlatformLabel(campaign.platform, ar)} · {campaign.startsOn ?? "—"} — {campaign.endsOn ?? "—"}</small></div><span className={`baseer-status-badge baseer-status-badge--${campaignStatusTone(campaign.status)}`}><i className="baseer-status-badge__dot" />{campaignStatusLabel(campaign.status, ar)}</span></header>{campaign.stoppedOn ? <p>{ar ? `أوقفت في ${campaign.stoppedOn}: ${campaign.stoppedReason}` : `Stopped on ${campaign.stoppedOn}: ${campaign.stoppedReason}`}</p> : null}{campaign.objective ? <p>{campaign.objective}</p> : null}{campaign.notes ? <small>{campaign.notes}</small> : null}<footer><BaseerButton type="button" variant="secondary" onClick={() => onDetails(campaign)}>{ar ? "التفاصيل والتحليل" : "Details & analysis"}</BaseerButton>{writable && campaign.status !== "ARCHIVED" ? <><BaseerButton type="button" variant="secondary" onClick={() => onEdit(campaign)}>{copy.edit}</BaseerButton>{(campaign.status === "ACTIVE" || campaign.status === "PLANNED") && campaign.startsOn ? <BaseerButton type="button" variant="quiet" onClick={() => onStop(campaign)}>{ar ? "إيقاف الحملة" : "Stop campaign"}</BaseerButton> : null}<BaseerButton type="button" variant="quiet" onClick={() => onArchive(campaign)}>{copy.archive}</BaseerButton></> : null}</footer></BaseerCard>)}</div> : <BaseerEmptyState title={ar ? "لا توجد حملات بهذه الحالة" : "No campaigns match this status"} description={ar ? "غيّر الحالة المختارة أو أضف حملة جديدة." : "Choose another status or add a campaign."} />}</section>;
}
