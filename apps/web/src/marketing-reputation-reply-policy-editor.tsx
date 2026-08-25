import { useMemo, useState } from "react";

import { presentBaseerApiError } from "./baseer-api-error";
import { BaseerButton } from "./baseer-button";
import { BaseerCombobox } from "./baseer-combobox";
import { BaseerFilterToggle } from "./baseer-filter-controls";
import { useBaseerForm, z } from "./baseer-form-state";
import { BaseerTextInput } from "./baseer-form-fields";
import { activeSession, api, requestId } from "./daily-sales-client";
import type { MarketingCopy, MarketingLanguage, MarketingReplyPolicy } from "./marketing-shared";

type ReputationReplyPolicyForm = Omit<MarketingReplyPolicy, "revision" | "executionReadiness"> & { signature: string };

export function ReputationReplyPolicyEditor({ language, policy, copy, canManage, onSaved }: { language: MarketingLanguage; policy: MarketingReplyPolicy; copy: MarketingCopy; canManage: boolean; onSaved?: () => Promise<void> }) {
  const session = activeSession();
  const initial = useMemo<ReputationReplyPolicyForm>(() => ({ automationStatus: policy.automationStatus, authoringMethod: policy.authoringMethod, tone: policy.tone, languageMode: policy.languageMode, autoFourFiveEnabled: policy.autoFourFiveEnabled, autoThreeIfSafe: policy.autoThreeIfSafe, signature: policy.signature ?? "" }), [policy]);
  const schema = useMemo(() => z.object({ automationStatus: z.enum(["DISABLED", "ENABLED", "PAUSED"]), authoringMethod: z.enum(["TEMPLATE", "BASIRA_DRAFT"]), tone: z.enum(["WARM", "PROFESSIONAL", "FORMAL"]), languageMode: z.enum(["MATCH_REVIEW", "ARABIC", "ENGLISH"]), autoFourFiveEnabled: z.boolean(), autoThreeIfSafe: z.boolean(), signature: z.string().max(160) }), []);
  const form = useBaseerForm<ReputationReplyPolicyForm>({ values: initial, schema, shouldFocusError: true });
  const values = form.watch();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const update = async (next: ReputationReplyPolicyForm) => {
    if (!session || !canManage || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await api(session, "/marketing/reputation/reply-policy", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...next, ...(next.signature.trim() ? { signature: next.signature.trim() } : {}), idempotencyKey: requestId() }) });
      setMessage(copy.policySaved);
      await onSaved?.();
    } catch (error) {
      setMessage(presentBaseerApiError(error, language, copy.policyFail));
    } finally {
      setBusy(false);
    }
  };
  const set = <Key extends keyof ReputationReplyPolicyForm>(key: Key, value: ReputationReplyPolicyForm[Key]) => form.setValue(key, value as never, { shouldDirty: true, shouldValidate: true });

  if (!session || !canManage) return null;
  return <form data-baseer-rhf-form="true" className="marketing-reputation__form" noValidate onSubmit={form.handleSubmit((next) => void update(next))}>
    <label>{copy.automationStatus}<BaseerCombobox label={copy.automationStatus} placeholder={copy.automationStatus} value={values.automationStatus} options={[{ id: "DISABLED", label: copy.disabled }, { id: "ENABLED", label: copy.enabled }, { id: "PAUSED", label: copy.paused }]} onChange={(next) => set("automationStatus", next as ReputationReplyPolicyForm["automationStatus"])} /></label>
    <fieldset><legend>{copy.automationOn}</legend><BaseerFilterToggle label={copy.autoFourFive} checked={values.autoFourFiveEnabled} onChange={(next) => set("autoFourFiveEnabled", next)} /><BaseerFilterToggle label={copy.autoThree} checked={values.autoThreeIfSafe} onChange={(next) => set("autoThreeIfSafe", next)} /><p>{copy.lowManual}</p><p>{copy.threeRule}</p></fieldset>
    <label>{copy.method}<BaseerCombobox label={copy.method} placeholder={copy.method} value={values.authoringMethod} options={[{ id: "TEMPLATE", label: copy.template }, { id: "BASIRA_DRAFT", label: copy.basira }]} onChange={(next) => set("authoringMethod", next as ReputationReplyPolicyForm["authoringMethod"])} /></label>
    <label>{copy.tone}<BaseerCombobox label={copy.tone} placeholder={copy.tone} value={values.tone} options={[{ id: "WARM", label: copy.warm }, { id: "PROFESSIONAL", label: copy.professional }, { id: "FORMAL", label: copy.formal }]} onChange={(next) => set("tone", next as ReputationReplyPolicyForm["tone"])} /></label>
    <label>{copy.languageMode}<BaseerCombobox label={copy.languageMode} placeholder={copy.languageMode} value={values.languageMode} options={[{ id: "MATCH_REVIEW", label: copy.matchReview }, { id: "ARABIC", label: copy.arabic }, { id: "ENGLISH", label: copy.english }]} onChange={(next) => set("languageMode", next as ReputationReplyPolicyForm["languageMode"])} /></label>
    <label>{copy.signature}<BaseerTextInput {...form.register("signature")} /></label>
    <footer><BaseerButton type="submit" disabled={busy}>{copy.savePolicy}</BaseerButton>{message ? <small role="status">{message}</small> : null}</footer>
  </form>;
}
