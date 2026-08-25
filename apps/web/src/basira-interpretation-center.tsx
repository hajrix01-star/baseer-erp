import { useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCard } from "./baseer-card";
import { BaseerCompanyReadQuery } from "./baseer-company-read-query";
import { BaseerFormDialog } from "./baseer-form-dialog";
import { BaseerFilterSelect } from "./baseer-filter-controls";
import { BaseerStaticSelect } from "./baseer-static-select";
import { BaseerStatusBadge } from "./baseer-status-badge";
import { BaseerTextArea } from "./baseer-form-fields";
import { activeSession, api, requestId, type ActiveSession } from "./daily-sales-client";
import { formatDateTime } from "./number-format";

import { pageRouteHash } from "./page-registry";

type Language = "ar" | "en";
type SubjectKind = "DECISION_ALERT" | "MARKETING_CAMPAIGN";
type HumanInsightKind = "NOTE" | "HYPOTHESIS" | "DECISION";
type HumanInsightStatus = "DRAFT" | "APPROVED" | "REVOKED";
type Explanation = { summary: string; evidence: string[]; limitations: string[]; reviewSteps: string[] };
type HumanInsight = { id: string; kind: HumanInsightKind; status: HumanInsightStatus; statement: string; supersedesInsightId: string | null; createdAt: string; approvedAt: string | null; revokedAt: string | null; revocationReason: string | null };
type InterpretationListItem = {
  id: string; subjectKind: SubjectKind; subjectId: string; moduleKey: "decision_intelligence" | "marketing";
  skillKey: string; language: "ar" | "en"; evidenceSnapshotId: string; createdAt: string; expiresAt: string | null;
  isExpired: boolean; placementCount: number; humanInsightCounts: { draft: number; approved: number }; summary: string;
};
type InterpretationDetail = InterpretationListItem & {
  sourceExecutionReceiptId: string; evidenceChecksum: string; outputChecksum: string; output: Explanation;
  placements: Array<{ id: string; kind: string; subjectId: string; moduleKey: string; createdAt: string }>;
  humanInsights: HumanInsight[];
};

const subjectLabel = (kind: SubjectKind, language: Language) => kind === "DECISION_ALERT"
  ? (language === "ar" ? "تنبيه مركز القرار" : "Decision alert")
  : (language === "ar" ? "حملة تسويقية" : "Marketing campaign");
const insightLabel = (kind: HumanInsightKind, language: Language) => ({
  NOTE: language === "ar" ? "ملاحظة" : "Note",
  HYPOTHESIS: language === "ar" ? "فرضية" : "Hypothesis",
  DECISION: language === "ar" ? "قرار" : "Decision",
})[kind];
const insightStatus = (status: HumanInsightStatus, language: Language) => ({
  DRAFT: language === "ar" ? "مسودة" : "Draft",
  APPROVED: language === "ar" ? "معتمد" : "Approved",
  REVOKED: language === "ar" ? "مسحوب" : "Revoked",
})[status];

export function BasiraInterpretationCenter({ language, canRead, canWrite }: { language: Language; canRead: boolean; canWrite: boolean }) {
  const session = activeSession();
  const [filter, setFilter] = useState<"ALL" | SubjectKind>("ALL");
  const [detail, setDetail] = useState<InterpretationDetail | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [insightTarget, setInsightTarget] = useState<InterpretationDetail | null>(null);
  const [insightKind, setInsightKind] = useState<HumanInsightKind>("NOTE");
  const [statement, setStatement] = useState("");
  const [supersedesInsight, setSupersedesInsight] = useState<HumanInsight | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<HumanInsight | null>(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandError, setCommandError] = useState<string | null>(null);

  if (!session) return null;
  if (!canRead) return <BaseerCard className="basira-interpretation-center__empty"><h3>{language === "ar" ? "التفسيرات المحفوظة" : "Saved interpretations"}</h3><p>{language === "ar" ? "تحتاج صلاحية عرض التفسيرات وصلاحية مصدرها. لا يفتح هذا القسم الذكاء ولا يطلب بيانات جديدة." : "You need saved-interpretation and source access. This section never invokes AI or fetches new provider data."}</p></BaseerCard>;

  const open = async (interpretationId: string) => {
    setDetailBusy(true); setDetailError(null); setDetail(null);
    try {
      setDetail(await api<InterpretationDetail>(session, `/administration/ai/interpretations/${interpretationId}`));
    } catch (reason) {
      setDetailError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر فتح التفسير المحفوظ." : "The saved interpretation could not be opened."));
    } finally { setDetailBusy(false); }
  };
  const refreshDetail = async (interpretationId: string) => {
    const next = await api<InterpretationDetail>(session, `/administration/ai/interpretations/${interpretationId}`);
    setDetail(next);
  };
  const createInsight = async () => {
    if (!insightTarget || statement.trim().length < 3) return;
    setCommandBusy(true); setCommandError(null);
    try {
      const idempotencyKey = requestId();
      await api(session, `/administration/ai/interpretations/${insightTarget.id}/human-insights`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ kind: insightKind, statement: statement.trim(), supersedesInsightId: supersedesInsight?.id, idempotencyKey }),
      });
      await refreshDetail(insightTarget.id); setStatement(""); setSupersedesInsight(null); setInsightTarget(null);
    } catch (reason) { setCommandError(presentBaseerApiError(reason, language, language === "ar" ? "تعذر حفظ المسودة البشرية." : "The human draft could not be saved.")); }
    finally { setCommandBusy(false); }
  };
  const approveInsight = async (insight: HumanInsight) => {
    if (!detail) return;
    setCommandBusy(true); setCommandError(null);
    try {
      const idempotencyKey = requestId();
      await api(session, `/administration/ai/human-insights/${insight.id}/approve`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ idempotencyKey }),
      });
      await refreshDetail(detail.id);
    } catch (reasonValue) { setCommandError(presentBaseerApiError(reasonValue, language, language === "ar" ? "تعذر تحديث السجل البشري." : "The human record could not be updated.")); }
    finally { setCommandBusy(false); }
  };
  const revokeInsight = async () => {
    if (!detail || !revokeTarget || revokeReason.trim().length < 3) return;
    setCommandBusy(true); setCommandError(null);
    try {
      const idempotencyKey = requestId();
      await api(session, `/administration/ai/human-insights/${revokeTarget.id}/revoke`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ reason: revokeReason.trim(), idempotencyKey }),
      });
      await refreshDetail(detail.id); setRevokeTarget(null); setRevokeReason("");
    } catch (reasonValue) { setCommandError(presentBaseerApiError(reasonValue, language, language === "ar" ? "تعذر سحب السجل البشري." : "The human record could not be withdrawn.")); }
    finally { setCommandBusy(false); }
  };

  const query = filter === "ALL" ? "" : `?subjectKind=${filter}`;
  return <section className="basira-interpretation-center" aria-busy={detailBusy || commandBusy}>
    <header className="basira-interpretation-center__header">
      <div><p className="baseer-section-header__eyebrow">Basira Interpretation Hub</p><h3>{language === "ar" ? "التفسيرات والقرارات البشرية" : "Interpretations & human decisions"}</h3><p>{language === "ar" ? "مكان واحد لقراءة التفسير المحفوظ نفسه من الحملة أو التنبيه. لا يُستدعى الذكاء عند فتح هذه الصفحة." : "One place to read the same saved explanation from a campaign or alert. Opening this page never invokes AI."}</p></div>
      <div className="basira-interpretation-center__filter"><span>{language === "ar" ? "المصدر" : "Source"}</span><BaseerFilterSelect label={language === "ar" ? "المصدر" : "Source"} value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="ALL">{language === "ar" ? "الكل" : "All"}</option><option value="DECISION_ALERT">{subjectLabel("DECISION_ALERT", language)}</option><option value="MARKETING_CAMPAIGN">{subjectLabel("MARKETING_CAMPAIGN", language)}</option></BaseerFilterSelect></div>
    </header>
    <BaseerCompanyReadQuery session={session} resource="administration.ai.interpretations" scope={[filter]} load={(current, signal) => api<InterpretationListItem[]>(current, `/administration/ai/interpretations${query}`, { signal })}>
      {({ data, loading, error, refetch }) => <>
        <div className="basira-interpretation-center__metrics"><BaseerStatusBadge tone="neutral">{language === "ar" ? `${data?.length ?? 0} تفسير محفوظ` : `${data?.length ?? 0} saved`}</BaseerStatusBadge><BaseerStatusBadge tone="warning">{language === "ar" ? `${data?.filter((item) => item.humanInsightCounts.draft > 0).length ?? 0} تحتاج مراجعة` : `${data?.filter((item) => item.humanInsightCounts.draft > 0).length ?? 0} need review`}</BaseerStatusBadge><BaseerButton type="button" variant="secondary" disabled={loading} onClick={() => void refetch()}>{language === "ar" ? "تحديث" : "Refresh"}</BaseerButton></div>
        {error ? <p className="daily-sales-message error" role="alert">{presentBaseerApiError(error, language, language === "ar" ? "تعذر تحميل التفسيرات المحفوظة." : "Saved interpretations could not be loaded.")}</p> : null}
        {loading ? <BaseerCard><p>{language === "ar" ? "جارٍ تحميل التفسيرات المحفوظة…" : "Loading saved interpretations…"}</p></BaseerCard> : null}
        {!loading && !error && !(data?.length) ? <BaseerCard className="basira-interpretation-center__empty"><h4>{language === "ar" ? "لا توجد تفسيرات محفوظة بعد" : "No saved interpretations yet"}</h4><p>{language === "ar" ? "افتح تنبيهاً أو حملة مكتملة ثم اختر «فسّر ببصيرة» يدوياً. لن ينشئ هذا المركز تفسيراً تلقائياً." : "Open an alert or completed campaign and explicitly choose “Explain with Basira”. This centre never generates automatically."}</p></BaseerCard> : null}
        <div className="basira-interpretation-center__list">{data?.map((item) => <BaseerCard key={item.id} className="basira-interpretation-center__item"><header><div><BaseerStatusBadge tone={item.isExpired ? "warning" : "success"}>{item.isExpired ? (language === "ar" ? "نسخة تاريخية" : "Historical") : (language === "ar" ? "محفوظ" : "Saved")}</BaseerStatusBadge><h4>{subjectLabel(item.subjectKind, language)}</h4><small>{formatDateTime(item.createdAt, language, "Asia/Riyadh")}</small></div><BaseerButton type="button" variant="secondary" onClick={() => void open(item.id)}>{language === "ar" ? "فتح" : "Open"}</BaseerButton></header><p>{item.summary}</p><footer><span>{language === "ar" ? `${item.placementCount} موضع عرض` : `${item.placementCount} placements`}</span><span>{language === "ar" ? `${item.humanInsightCounts.approved} قرار/ملاحظة معتمدة` : `${item.humanInsightCounts.approved} approved notes`}</span>{item.humanInsightCounts.draft ? <span>{language === "ar" ? `${item.humanInsightCounts.draft} مسودة` : `${item.humanInsightCounts.draft} drafts`}</span> : null}</footer></BaseerCard>)}</div>
      </>}
    </BaseerCompanyReadQuery>
    <BaseerFormDialog open={detail !== null || detailBusy || detailError !== null} title={language === "ar" ? "تفسير محفوظ من بصيرة" : "Saved Basira interpretation"} language={language} formId="basira-interpretation-detail" submitLabel={language === "ar" ? "إغلاق" : "Close"} busy={detailBusy} error={detailError} size="wide" onClose={() => { if (!detailBusy) { setDetail(null); setDetailError(null); } }}>
      <form id="basira-interpretation-detail" className="basira-interpretation-center__detail" onSubmit={(event) => { event.preventDefault(); setDetail(null); setDetailError(null); }}>
        {detail ? <><p className="basira-interpretation-center__notice">{language === "ar" ? "هذا تفسير محفوظ للدليل الظاهر أدناه. لا يثبت السبب ولا يغيّر أي سجل." : "This is a saved explanation for the evidence below. It proves no cause and changes no record."}</p><section><h4>{language === "ar" ? "الخلاصة" : "Summary"}</h4><p>{detail.output.summary}</p></section><section><h4>{language === "ar" ? "الدليل والقيود" : "Evidence and limits"}</h4><ul>{detail.output.evidence.map((item, index) => <li key={`e-${index}`}>{item}</li>)}</ul><ul>{detail.output.limitations.map((item, index) => <li key={`l-${index}`}>{item}</li>)}</ul></section><section><h4>{language === "ar" ? "الخطوات المقترحة" : "Suggested next steps"}</h4><ol>{detail.output.reviewSteps.map((item, index) => <li key={`s-${index}`}>{item}</li>)}</ol></section><details><summary>{language === "ar" ? "تفاصيل التدقيق" : "Audit details"}</summary><dl><div><dt>{language === "ar" ? "حزمة الأدلة" : "Evidence package"}</dt><dd dir="ltr">{detail.evidenceSnapshotId}</dd></div><div><dt>{language === "ar" ? "بصمة الدليل" : "Evidence checksum"}</dt><dd dir="ltr">{detail.evidenceChecksum}</dd></div><div><dt>{language === "ar" ? "المواضع الأصلية" : "Original placements"}</dt><dd>{detail.placements.map((placement) => placement.kind).join(" · ") || "—"}</dd></div></dl></details><section className="basira-interpretation-center__human"><header><div><h4>{language === "ar" ? "ملاحظات وقرارات بشرية" : "Human notes and decisions"}</h4><p>{language === "ar" ? "تُحفظ منفصلة عن بصيرة ولا تدخل أي prompt أو تغيّر الحقيقة." : "They are stored separately from Basira, never enter a prompt, and never change facts."}</p></div>{canWrite ? <BaseerButton type="button" onClick={() => { setInsightTarget(detail); setStatement(""); setSupersedesInsight(null); setInsightKind("NOTE"); setCommandError(null); }}>{language === "ar" ? "إضافة سجل بشري" : "Add human record"}</BaseerButton> : null}</header>{detail.humanInsights.length ? <ol>{detail.humanInsights.map((insight) => <li key={insight.id}><div><BaseerStatusBadge tone={insight.status === "APPROVED" ? "success" : insight.status === "REVOKED" ? "danger" : "warning"}>{insightStatus(insight.status, language)}</BaseerStatusBadge><strong>{insightLabel(insight.kind, language)}</strong><p>{insight.statement}</p>{insight.kind === "HYPOTHESIS" ? <small>{language === "ar" ? "فرضية بشرية وليست سبباً مثبتاً." : "A human hypothesis, not a proven cause."}</small> : null}{insight.revocationReason ? <small>{language === "ar" ? `سبب السحب: ${insight.revocationReason}` : `Withdrawal reason: ${insight.revocationReason}`}</small> : null}</div>{canWrite ? <BaseerButton type="button" variant="quiet" disabled={commandBusy} onClick={() => { setInsightTarget(detail); setSupersedesInsight(insight); setStatement(""); setInsightKind(insight.kind); setCommandError(null); }}>{language === "ar" ? "تصحيح بسجل جديد" : "Correct with a new record"}</BaseerButton> : null}{canWrite && insight.status === "DRAFT" ? <BaseerButton type="button" variant="secondary" disabled={commandBusy} onClick={() => void approveInsight(insight)}>{language === "ar" ? "اعتماد" : "Approve"}</BaseerButton> : null}{canWrite && insight.status !== "REVOKED" ? <BaseerButton type="button" variant="quiet" disabled={commandBusy} onClick={() => { setRevokeTarget(insight); setRevokeReason(""); setCommandError(null); }}>{language === "ar" ? "سحب" : "Revoke"}</BaseerButton> : null}</li>)}</ol> : <p>{language === "ar" ? "لا توجد ملاحظة أو قرار بشري بعد." : "No human note or decision yet."}</p>}</section><footer className="basira-interpretation-center__source"><BaseerButton type="button" variant="secondary" onClick={() => { window.location.hash = detail.subjectKind === "DECISION_ALERT" ? "#module=decision&section=2" : "#module=marketing&section=2"; }}>{language === "ar" ? "فتح المصدر" : "Open source"}</BaseerButton></footer></> : <p>{language === "ar" ? "جارٍ فتح التفسير…" : "Opening interpretation…"}</p>}
      </form>
    </BaseerFormDialog>
    <BaseerFormDialog open={insightTarget !== null} title={language === "ar" ? "إضافة ملاحظة أو قرار بشري" : "Add a human note or decision"} language={language} formId="basira-human-insight" submitLabel={language === "ar" ? "حفظ مسودة" : "Save draft"} busy={commandBusy} error={commandError} size="standard" onClose={() => !commandBusy && setInsightTarget(null)}>
      <form id="basira-human-insight" className="basira-interpretation-center__form" onSubmit={(event) => { event.preventDefault(); void createInsight(); }}><p>{supersedesInsight ? (language === "ar" ? "سيُحفظ هذا كتـصحيح جديد مرتبط بالسجل السابق؛ لن يعدّل السجل السابق." : "This will be saved as a new correction linked to the earlier record; it will not edit that record.") : (language === "ar" ? "هذا سجل بشري مستقل. لا يشغّل الذكاء ولا يعدّل الحملة أو التنبيه أو البيانات المالية." : "This is a separate human record. It does not invoke AI or change the campaign, alert, or financial data.")}</p><label>{language === "ar" ? "النوع" : "Kind"}<BaseerStaticSelect label={language === "ar" ? "النوع" : "Kind"} value={insightKind} onChange={(event) => setInsightKind(event.target.value as HumanInsightKind)}><option value="NOTE">{insightLabel("NOTE", language)}</option><option value="HYPOTHESIS">{insightLabel("HYPOTHESIS", language)}</option><option value="DECISION">{insightLabel("DECISION", language)}</option></BaseerStaticSelect></label><label>{language === "ar" ? "النص" : "Statement"}<BaseerTextArea required minLength={3} maxLength={2_000} value={statement} onValueChange={setStatement} /></label>{insightKind === "HYPOTHESIS" ? <small>{language === "ar" ? "ستظهر دائماً كفرضية بشرية، لا كسبب مثبت." : "It will always be shown as a human hypothesis, not a proven cause."}</small> : null}</form>
    </BaseerFormDialog>
    <BaseerFormDialog open={revokeTarget !== null} title={language === "ar" ? "سحب سجل بشري" : "Revoke human record"} language={language} formId="basira-human-insight-revoke" submitLabel={language === "ar" ? "تأكيد السحب" : "Confirm withdrawal"} busy={commandBusy} error={commandError} size="compact" onClose={() => !commandBusy && setRevokeTarget(null)}>
      <form id="basira-human-insight-revoke" className="basira-interpretation-center__form" onSubmit={(event) => { event.preventDefault(); void revokeInsight(); }}><p>{language === "ar" ? "لا يُحذف السجل؛ يظهر كسجل مسحوب مع سبب واضح." : "The record is not deleted; it remains visible as withdrawn with a clear reason."}</p><label>{language === "ar" ? "سبب السحب" : "Withdrawal reason"}<BaseerTextArea compact required minLength={3} maxLength={500} value={revokeReason} onValueChange={setRevokeReason} /></label></form>
    </BaseerFormDialog>
  </section>;
}
