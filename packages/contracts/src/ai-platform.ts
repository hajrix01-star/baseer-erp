import { z } from "zod";

import { companyIdSchema } from "./identity.js";

const aiIdempotencyKeySchema = z.string().trim().min(1).max(255);

export const aiProviderKindSchema = z.enum([
  "OPENAI_COMPATIBLE",
  "ANTHROPIC",
  "GOOGLE_GENERATIVE_AI",
]);

const moneyLimitSchema = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,4})?$/)
  .max(32)
  .optional();

export const configureAiProviderRequestSchema = z
  .object({
    provider: aiProviderKindSchema,
    model: z.string().trim().min(1).max(160),
    apiKey: z.string().min(1).max(20_000),
    dailyRequestLimit: z.number().int().min(1).max(100_000),
    dailyCostLimit: moneyLimitSchema,
    idempotencyKey: aiIdempotencyKeySchema,
  })
  .strict();

export const activateAiProviderConfigurationRequestSchema = z
  .object({
    idempotencyKey: aiIdempotencyKeySchema,
  })
  .strict();

export const createAiIdentityRequestSchema = z
  .object({
    displayNameAr: z.string().trim().min(1).max(160),
    displayNameEn: z.string().trim().min(1).max(160),
    defaultLanguage: z.enum(["ar", "en"]),
    toneInstructions: z.string().trim().min(1).max(2_000),
    safetyInstructions: z.string().trim().min(1).max(4_000),
    policyReference: z.string().trim().min(1).max(160).optional(),
    idempotencyKey: aiIdempotencyKeySchema,
  })
  .strict();
export const createAiSystemIdentityRequestSchema = z
  .object({
    assistantNameAr: z.string().trim().min(1).max(80),
    assistantNameEn: z.string().trim().min(1).max(80),
    defaultLanguage: z.enum(["ar", "en"]),
    toneInstructions: z.string().trim().min(1).max(2_000),
    safetyInstructions: z.string().trim().min(1).max(4_000),
    idempotencyKey: aiIdempotencyKeySchema,
  })
  .strict();

export const aiProviderConfigurationReceiptSchema = z
  .object({
    id: z.string().uuid(),
    provider: aiProviderKindSchema,
    model: z.string().min(1).max(160),
    status: z.enum(["ACTIVE", "DISABLED"]),
    isDefault: z.boolean(),
    dailyRequestLimit: z.number().int().positive(),
    dailyCostLimit: z.string().regex(/^\d+(?:\.\d{1,4})?$/).nullable(),
    configurationVersion: z.number().int().positive(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

/**
 * A live, credential-free probe of the configured provider. It is deliberately
 * not a model response and never includes an API key, prompt, or ERP data.
 */
export const aiProviderConnectionReceiptSchema = z
  .object({
    state: z.enum(["READY", "ERROR", "UNCONFIGURED"]),
    reason: z
      .enum([
        "PROVIDER_NOT_CONFIGURED",
        "CREDENTIAL_DECRYPTION_FAILED",
        "CREDENTIAL_REJECTED",
        "MODEL_UNAVAILABLE",
        "PROVIDER_RATE_LIMITED",
        "PROVIDER_UNREACHABLE",
        "PROVIDER_UNAVAILABLE",
      ])
      .nullable(),
    provider: aiProviderKindSchema.nullable(),
    model: z.string().min(1).max(160).nullable(),
    checkedAt: z.coerce.date(),
  })
  .strict();

export const aiSystemIdentityReceiptSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
    assistantNameAr: z.string().min(1).max(80),
    assistantNameEn: z.string().min(1).max(80),
    defaultLanguage: z.enum(["ar", "en"]),
    toneInstructions: z.string().min(1).max(2_000),
    safetyInstructions: z.string().min(1).max(4_000),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export const aiCompanyIdentityReceiptSchema = z
  .object({
    id: z.string().uuid(),
    version: z.number().int().positive(),
    status: z.enum(["ACTIVE", "ARCHIVED"]),
    displayNameAr: z.string().min(1).max(160),
    displayNameEn: z.string().min(1).max(160),
    defaultLanguage: z.enum(["ar", "en"]),
    toneInstructions: z.string().min(1).max(2_000),
    safetyInstructions: z.string().min(1).max(4_000),
    policyReference: z.string().max(160).nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .strict();

export const aiPlatformConfigurationReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    activeProvider: aiProviderConfigurationReceiptSchema.nullable(),
    providerConfigurations: z.array(aiProviderConfigurationReceiptSchema),
    activeSystemIdentity: aiSystemIdentityReceiptSchema.nullable(),
    activeIdentity: aiCompanyIdentityReceiptSchema.nullable(),
  })
  .strict();

export type ConfigureAiProviderRequest = z.infer<
  typeof configureAiProviderRequestSchema
>;
export type ActivateAiProviderConfigurationRequest = z.infer<
  typeof activateAiProviderConfigurationRequestSchema
>;
export type AiProviderConnectionReceipt = z.infer<
  typeof aiProviderConnectionReceiptSchema
>;
export type CreateAiIdentityRequest = z.infer<typeof createAiIdentityRequestSchema>;
export type CreateAiSystemIdentityRequest = z.infer<typeof createAiSystemIdentityRequestSchema>;
export const aiSkillRiskTierSchema = z.enum(["S1", "S2", "S3", "S4"]);
export const aiSkillStatusSchema = z.enum([
  "PLANNED",
  "VALIDATED",
  "PILOT",
  "ACTIVE",
  "SUSPENDED",
]);

export const aiSkillCatalogItemSchema = z
  .object({
    key: z.string().min(1).max(120),
    version: z.number().int().positive(),
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().min(1).max(160),
    allowedModules: z.array(z.string().min(1).max(80)).min(1),
    riskTier: aiSkillRiskTierSchema,
    status: aiSkillStatusSchema,
    policyVersion: z.number().int().positive(),
    requiredCapabilities: z.array(z.string().min(1).max(120)).min(1),
    purpose: z.string().min(1).max(1_000),
    activationCondition: z.string().min(1).max(1_000),
  })
  .strict();

export const aiRuntimePreflightRequestSchema = z
  .object({
    moduleKey: z.string().trim().min(1).max(80),
    skillKey: z.string().trim().min(1).max(120),
    idempotencyKey: aiIdempotencyKeySchema,
  })
  .strict();

export const aiRuntimePreflightReceiptSchema = z
  .object({
    receiptId: z.string().uuid(),
    skillKey: z.string().min(1).max(120),
    skillVersion: z.number().int().positive(),
    riskTier: aiSkillRiskTierSchema,
    status: aiSkillStatusSchema,
    policyVersion: z.number().int().positive(),
    requiredCapabilities: z.array(z.string().min(1).max(120)).min(1),
    outcome: z.literal("BLOCKED"),
    safeReasonCode: z.string().min(1).max(120),
    companyId: companyIdSchema,
    requestId: z.string().min(1).max(120),
    createdAt: z.coerce.date(),
    replayed: z.boolean(),
  })
  .strict();

/** The only live AI input initially permitted by the product: a frozen Decision alert. */
export const explainDecisionAlertRequestSchema = z
  .object({
    alertId: z.string().uuid(),
    language: z.enum(["ar", "en"]),
    idempotencyKey: aiIdempotencyKeySchema,
  })
  .strict();

export const decisionAlertExplanationSchema = z
  .object({
    summary: z.string().trim().min(1).max(1_200),
    evidence: z.array(z.string().trim().min(1).max(600)).min(1).max(3),
    limitations: z.array(z.string().trim().min(1).max(600)).min(1).max(2),
    reviewSteps: z.array(z.string().trim().min(1).max(400)).min(1).max(3),
  })
  .strict();
export type DecisionAlertExplanation = z.infer<typeof decisionAlertExplanationSchema>;

export const explainDecisionAlertReceiptSchema = z
  .object({
    receiptId: z.string().uuid(),
    alertId: z.string().uuid(),
    skillKey: z.literal("decision.command_center_analyst"),
    model: z.string().min(1).max(160),
    explanation: decisionAlertExplanationSchema,
    createdAt: z.coerce.date(),
    replayed: z.boolean(),
  })
  .strict();

export type AiSkillCatalogItem = z.infer<typeof aiSkillCatalogItemSchema>;
export type AiRuntimePreflightRequest = z.infer<
  typeof aiRuntimePreflightRequestSchema
>;
export type AiRuntimePreflightReceipt = z.infer<
  typeof aiRuntimePreflightReceiptSchema
>;
export type ExplainDecisionAlertRequest = z.infer<typeof explainDecisionAlertRequestSchema>;
export type ExplainDecisionAlertReceipt = z.infer<typeof explainDecisionAlertReceiptSchema>;

/** A campaign id is only a selector. The server builds and freezes the
 * evidence package before the model is ever invoked. */
export const explainMarketingCampaignRequestSchema = z
  .object({
    campaignId: z.string().uuid(),
    language: z.enum(["ar", "en"]),
    idempotencyKey: aiIdempotencyKeySchema,
  })
  .strict();

export const marketingCampaignExplanationSchema = z
  .object({
    summary: z.string().trim().min(1).max(1_200),
    evidence: z.array(z.string().trim().min(1).max(600)).min(1).max(4),
    limitations: z.array(z.string().trim().min(1).max(600)).min(1).max(3),
    reviewSteps: z.array(z.string().trim().min(1).max(400)).min(1).max(3),
  })
  .strict();
export type MarketingCampaignExplanation = z.infer<typeof marketingCampaignExplanationSchema>;

export const explainMarketingCampaignReceiptSchema = z
  .object({
    receiptId: z.string().uuid(),
    campaignId: z.string().uuid(),
    evidenceSnapshotId: z.string().uuid(),
    skillKey: z.literal("marketing.performance_analyst"),
    model: z.string().min(1).max(160),
    explanation: marketingCampaignExplanationSchema,
    createdAt: z.coerce.date(),
    replayed: z.boolean(),
  })
  .strict();

export type ExplainMarketingCampaignRequest = z.infer<typeof explainMarketingCampaignRequestSchema>;
export type ExplainMarketingCampaignReceipt = z.infer<typeof explainMarketingCampaignReceiptSchema>;

/** Owner-only, server-built Daily Brief question. The browser may supply no
 * financial rows, prompt template, company scope, provider setting or tool. */
export const ownerDailyBriefBasiraAnswerRequestSchema = z.object({
  reportDate: z.string().date(),
  question: z.string().trim().min(1).max(600),
  language: z.enum(["ar", "en"]),
  idempotencyKey: aiIdempotencyKeySchema,
}).strict();

export const ownerDailyBriefBasiraAnswerSchema = z.object({
  summary: z.string().trim().min(1).max(1_200),
  evidence: z.array(z.string().trim().min(1).max(600)).min(1).max(4),
  limitations: z.array(z.string().trim().min(1).max(600)).min(1).max(3),
  followupChips: z.array(z.string().trim().min(1).max(160)).min(1).max(3),
}).strict();

export const ownerDailyBriefBasiraAnswerReceiptSchema = z.object({
  skillKey: z.literal("owner.daily_brief_analyst"),
  model: z.string().trim().min(1).max(160),
  answer: ownerDailyBriefBasiraAnswerSchema,
  createdAt: z.coerce.date(),
}).strict();

export type OwnerDailyBriefBasiraAnswerRequest = z.infer<typeof ownerDailyBriefBasiraAnswerRequestSchema>;
export type OwnerDailyBriefBasiraAnswer = z.infer<typeof ownerDailyBriefBasiraAnswerSchema>;
export type OwnerDailyBriefBasiraAnswerReceipt = z.infer<typeof ownerDailyBriefBasiraAnswerReceiptSchema>;
