import type { AiProviderModelCapabilityReceipt } from "@baseer-erp/contracts";

import type { AiProviderKind } from "../generated/prisma/client.js";
import {
  BASIRA_S2_TOKENIZER_MODEL,
  BASIRA_S2_TOKENIZER_VERSION,
} from "./ai-token-counter.js";

/**
 * The provider capability registry is deliberately code-owned. A credential
 * alone never makes an arbitrary provider or model eligible to receive ERP
 * evidence. Enabling another model requires a reviewed registry entry, a
 * matching local tokenizer, a current price revision, a provider adapter and
 * model-specific evaluation evidence.
 */
export type AiProviderModelCapability = Readonly<{
  provider: AiProviderKind;
  model: string;
  displayNameAr: string;
  displayNameEn: string;
  summaryAr: string;
  summaryEn: string;
  status: "AVAILABLE" | "PLANNED";
  activationReadiness:
    | "READY_FOR_CONFIGURATION"
    | "REQUIRES_ADAPTER_AND_EVALUATION";
  costTier: "LOW" | "MEDIUM" | "HIGH";
  supportedSkillKeys: readonly string[];
  runtimeProfile: Readonly<{
    key: string;
    capabilityVersion: number;
    tokenizerModel: string;
    tokenizerVersion: string;
    tokenSafetyMargin: number;
    maxInputTokens: number;
    maxOutputTokens: number;
    reasoning: "low";
    structuredOutput: true;
    tools: "none";
  }> | null;
}>;

const REGISTRY: readonly AiProviderModelCapability[] = [
  {
    provider: "OPENAI_COMPATIBLE",
    model: "gpt-5-mini",
    displayNameAr: "ملف بصيرة الاقتصادي المعتمد",
    displayNameEn: "Approved economical Basira profile",
    summaryAr:
      "تفسير منظّم منخفض التكلفة للتنبيهات والحملات، مع حدّ محلي للتوكن وسعر موثّق قبل الإرسال.",
    summaryEn:
      "Low-cost structured alert and campaign explanations with a local token limit and documented pre-egress price.",
    status: "AVAILABLE",
    activationReadiness: "READY_FOR_CONFIGURATION",
    costTier: "LOW",
    supportedSkillKeys: [
      "decision.command_center_analyst",
      "marketing.performance_analyst",
    ],
    runtimeProfile: {
      key: "s2.interpretation.low_cost.v1",
      capabilityVersion: 1,
      tokenizerModel: BASIRA_S2_TOKENIZER_MODEL,
      tokenizerVersion: BASIRA_S2_TOKENIZER_VERSION,
      tokenSafetyMargin: 256,
      maxInputTokens: 12_000,
      maxOutputTokens: 600,
      reasoning: "low",
      structuredOutput: true,
      tools: "none",
    },
  },
] as const;

function matches(
  capability: AiProviderModelCapability,
  provider: AiProviderKind,
  model: string,
) {
  return capability.provider === provider && capability.model === model.trim();
}

export function listAiProviderModelCapabilities(): readonly AiProviderModelCapabilityReceipt[] {
  return REGISTRY.map((capability) => ({
    provider: capability.provider,
    model: capability.model,
    displayNameAr: capability.displayNameAr,
    displayNameEn: capability.displayNameEn,
    summaryAr: capability.summaryAr,
    summaryEn: capability.summaryEn,
    status: capability.status,
    activationReadiness: capability.activationReadiness,
    costTier: capability.costTier,
    supportedSkillKeys: [...capability.supportedSkillKeys],
  }));
}

export function findAiProviderModelCapability(
  provider: AiProviderKind,
  model: string,
): AiProviderModelCapability | null {
  return REGISTRY.find((capability) => matches(capability, provider, model)) ?? null;
}

/** A configuration may be saved only when the complete operating path exists. */
export function canConfigureAiProviderModel(
  provider: AiProviderKind,
  model: string,
): boolean {
  const capability = findAiProviderModelCapability(provider, model);
  return (
    capability?.status === "AVAILABLE" &&
    capability.activationReadiness === "READY_FOR_CONFIGURATION" &&
    capability.runtimeProfile !== null
  );
}

/**
 * Resolves the exact profile used for one skill. This is intentionally not a
 * generic provider fallback: a model must opt in to the requested skill.
 */
export function liveAiModelProfileForSkill(input: Readonly<{
  provider: AiProviderKind;
  model: string;
  skillKey: string;
}>): AiProviderModelCapability["runtimeProfile"] {
  const capability = findAiProviderModelCapability(input.provider, input.model);
  if (
    !capability ||
    !canConfigureAiProviderModel(input.provider, input.model) ||
    !capability.supportedSkillKeys.includes(input.skillKey)
  ) {
    return null;
  }
  return capability.runtimeProfile;
}
