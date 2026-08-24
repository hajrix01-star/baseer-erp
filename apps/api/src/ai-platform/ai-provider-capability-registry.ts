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
  requiredActivationGates: readonly (
    | "PRIVACY_AND_REGION_DECISION"
    | "SERVER_ADAPTER"
    | "LOCAL_TOKEN_COUNTER"
    | "CURRENT_PRICE_REVISION"
    | "ARABIC_SKILL_EVALUATION"
    | "LIVE_CONNECTION_PROBE"
  )[];
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
      "تفسير اقتصادي منظّم للتنبيهات والحملات، بتكلفة موثقة وحد توكن محلي.",
    summaryEn:
      "Low-cost structured alert and campaign explanations with a local token limit and documented pre-egress price.",
    status: "AVAILABLE",
    activationReadiness: "READY_FOR_CONFIGURATION",
    requiredActivationGates: [],
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
  {
    provider: "GOOGLE_GENERATIVE_AI",
    model: "gemini-3.7-flash",
    displayNameAr: "Gemini Flash — مسار مستقبلي",
    displayNameEn: "Gemini Flash — future path",
    summaryAr:
      "غير متاح حتى اعتماد الخصوصية والمنطقة والمحوّل والتقييم العربي.",
    summaryEn:
      "Gemini remains blocked until privacy and region decisions, its adapter, cost counter and Arabic evaluation are approved.",
    status: "PLANNED",
    activationReadiness: "REQUIRES_ADAPTER_AND_EVALUATION",
    requiredActivationGates: [
      "PRIVACY_AND_REGION_DECISION",
      "SERVER_ADAPTER",
      "LOCAL_TOKEN_COUNTER",
      "CURRENT_PRICE_REVISION",
      "ARABIC_SKILL_EVALUATION",
      "LIVE_CONNECTION_PROBE",
    ],
    costTier: "MEDIUM",
    supportedSkillKeys: [
      "decision.command_center_analyst",
      "marketing.performance_analyst",
    ],
    runtimeProfile: null,
  },
  {
    provider: "DASHSCOPE_QWEN",
    model: "qwen3.7-flash",
    displayNameAr: "Qwen عبر DashScope — مسار مستقبلي",
    displayNameEn: "Qwen through DashScope — future path",
    summaryAr:
      "غير متاح حتى يكتمل المحول والحدود والتسعير والتقييم.",
    summaryEn:
      "Qwen remains blocked; protocol compatibility alone is insufficient without a server adapter, token limits, pricing and approved evaluation.",
    status: "PLANNED",
    activationReadiness: "REQUIRES_ADAPTER_AND_EVALUATION",
    requiredActivationGates: [
      "PRIVACY_AND_REGION_DECISION",
      "SERVER_ADAPTER",
      "LOCAL_TOKEN_COUNTER",
      "CURRENT_PRICE_REVISION",
      "ARABIC_SKILL_EVALUATION",
      "LIVE_CONNECTION_PROBE",
    ],
    costTier: "MEDIUM",
    supportedSkillKeys: [
      "decision.command_center_analyst",
      "marketing.performance_analyst",
    ],
    runtimeProfile: null,
  },
  {
    provider: "DEEPSEEK",
    model: "deepseek-v4-flash",
    displayNameAr: "DeepSeek Flash — مسار مستقبلي",
    displayNameEn: "DeepSeek Flash — future path",
    summaryAr:
      "غير متاح حتى توثيق السعر واختبار الإخراج العربي.",
    summaryEn:
      "DeepSeek remains blocked until its time-sensitive pricing and Arabic structured-output evaluation are verified.",
    status: "PLANNED",
    activationReadiness: "REQUIRES_ADAPTER_AND_EVALUATION",
    requiredActivationGates: [
      "PRIVACY_AND_REGION_DECISION",
      "SERVER_ADAPTER",
      "LOCAL_TOKEN_COUNTER",
      "CURRENT_PRICE_REVISION",
      "ARABIC_SKILL_EVALUATION",
      "LIVE_CONNECTION_PROBE",
    ],
    costTier: "LOW",
    supportedSkillKeys: [
      "decision.command_center_analyst",
      "marketing.performance_analyst",
    ],
    runtimeProfile: null,
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
    requiredActivationGates: [...capability.requiredActivationGates],
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
