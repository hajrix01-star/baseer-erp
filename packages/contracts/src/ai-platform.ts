import { z } from "zod";

import { companyIdSchema } from "./identity.js";

const aiIdempotencyKeySchema = z.string().trim().min(1).max(255);

export const aiProviderKindSchema = z.enum([
  "OPENAI_COMPATIBLE",
  "ANTHROPIC",
  "GOOGLE_GENERATIVE_AI",
  "DASHSCOPE_QWEN",
  "DEEPSEEK",
]);

export const aiProviderActivationGateSchema = z.enum([
  "PRIVACY_AND_REGION_DECISION",
  "SERVER_ADAPTER",
  "LOCAL_TOKEN_COUNTER",
  "CURRENT_PRICE_REVISION",
  "ARABIC_SKILL_EVALUATION",
  "LIVE_CONNECTION_PROBE",
]);

/**
 * A safe, product-facing description of a provider/model capability. The
 * server owns the actual adapter, tokenizer and pricing checks; clients use
 * this receipt only to present choices that may be configured.
 */
export const aiProviderModelCapabilityReceiptSchema = z
  .object({
    provider: aiProviderKindSchema,
    model: z.string().min(1).max(160),
    displayNameAr: z.string().min(1).max(160),
    displayNameEn: z.string().min(1).max(160),
    summaryAr: z.string().min(1).max(500),
    summaryEn: z.string().min(1).max(500),
    status: z.enum(["AVAILABLE", "PLANNED"]),
    activationReadiness: z.enum([
      "READY_FOR_CONFIGURATION",
      "REQUIRES_ADAPTER_AND_EVALUATION",
    ]),
    requiredActivationGates: z.array(aiProviderActivationGateSchema),
    costTier: z.enum(["LOW", "MEDIUM", "HIGH"]),
    supportedSkillKeys: z.array(z.string().min(1).max(160)),
  })
  .strict();

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
    status: z.enum(["DRAFT", "VALIDATED", "ACTIVE", "DISABLED"]),
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
    /** The checked encrypted configuration; never exposes its credential. */
    configurationId: z.string().uuid().nullable(),
    state: z.enum(["READY", "ERROR", "UNCONFIGURED"]),
    reason: z
      .enum([
        "PROVIDER_NOT_CONFIGURED",
        "CREDENTIAL_DECRYPTION_FAILED",
        "CREDENTIAL_REJECTED",
        "MODEL_UNAVAILABLE",
        "PROJECT_ACCESS_DENIED",
        "BILLING_OR_QUOTA_REQUIRED",
        "PROVIDER_RATE_LIMITED",
        "PROVIDER_UNREACHABLE",
        "PROVIDER_RESPONSE_REJECTED",
        "PROVIDER_UNAVAILABLE",
      ])
      .nullable(),
    provider: aiProviderKindSchema.nullable(),
    model: z.string().min(1).max(160).nullable(),
    /** Safe HTTP status only; no upstream body, request id, or credential data. */
    upstreamStatus: z.number().int().min(100).max(599).nullable(),
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
    providerCapabilities: z.array(aiProviderModelCapabilityReceiptSchema),
    activeProvider: aiProviderConfigurationReceiptSchema.nullable(),
    providerConfigurations: z.array(aiProviderConfigurationReceiptSchema),
    latestProviderConnectionCheck: aiProviderConnectionReceiptSchema.nullable(),
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
export type AiProviderModelCapabilityReceipt = z.infer<
  typeof aiProviderModelCapabilityReceiptSchema
>;
export type CreateAiIdentityRequest = z.infer<typeof createAiIdentityRequestSchema>;
export type CreateAiSystemIdentityRequest = z.infer<typeof createAiSystemIdentityRequestSchema>;

export const aiCompanyPolicyModeSchema = z.enum(["DISABLED", "ENABLED", "PAUSED"]);
export const aiCompanyPolicyPilotSkillSchema = z.object({
  skillKey: z.enum(["decision.command_center_analyst", "marketing.performance_analyst"]),
  skillVersion: z.number().int().positive(),
  policyVersion: z.number().int().positive(),
}).strict();

/** The human budget is whole USD cents so no browser floating-point value is
 * ever used to authorize spend. It is required only while starting Basira. */
export const putAiCompanyPolicyRequestSchema = z.object({
  expectedVersion: z.number().int().min(0),
  mode: aiCompanyPolicyModeSchema,
  monthlyBudgetUsdCents: z.string().regex(/^\d{1,18}$/).optional(),
  providerConfigurationIds: z.array(z.string().uuid()).max(10),
  pilotSkills: z.array(aiCompanyPolicyPilotSkillSchema).max(8),
  autoEnrollStable: z.boolean().default(false),
  changeReason: z.string().trim().min(1).max(500),
  idempotencyKey: aiIdempotencyKeySchema,
}).strict().superRefine((value, context) => {
  if (value.mode === "ENABLED") {
    if (!value.monthlyBudgetUsdCents || BigInt(value.monthlyBudgetUsdCents) <= 0n) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["monthlyBudgetUsdCents"], message: "A positive monthly USD budget is required when Basira is enabled." });
    }
    if (!value.providerConfigurationIds.length) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["providerConfigurationIds"], message: "Choose an approved provider configuration." });
    }
  } else if (value.monthlyBudgetUsdCents !== undefined) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["monthlyBudgetUsdCents"], message: "A monthly budget is stored only for an enabled policy." });
  }
});

export const aiCompanyPolicyReceiptSchema = z.object({
  companyId: companyIdSchema,
  policyId: z.string().uuid().nullable(),
  version: z.number().int().min(0),
  mode: aiCompanyPolicyModeSchema,
  monthlyBudgetUsdCents: z.string().regex(/^\d+$/).nullable(),
  billingTimeZone: z.literal("Asia/Riyadh"),
  providerConfigurationIds: z.array(z.string().uuid()),
  pilotSkills: z.array(aiCompanyPolicyPilotSkillSchema),
  autoEnrollStable: z.boolean(),
  canManage: z.boolean(),
  updatedAt: z.coerce.date().nullable(),
}).strict();
export type PutAiCompanyPolicyRequest = z.infer<typeof putAiCompanyPolicyRequestSchema>;
export type AiCompanyPolicyReceipt = z.infer<typeof aiCompanyPolicyReceiptSchema>;

export const aiSkillRiskTierSchema = z.enum(["S1", "S2", "S3", "S4"]);
export const aiSkillStatusSchema = z.enum([
  "PLANNED",
  "VALIDATED",
  "PILOT",
  "ACTIVE",
  "SUSPENDED",
]);

export const aiCompanyContextStatusSchema = z.enum([
  "DRAFT",
  "APPROVED",
  "SUPERSEDED",
  "REVOKED",
]);
export const aiCompanyPresentationStyleSchema = z.enum(["CONCISE", "DETAILED"]);
export const aiCompanyContextKindSchema = z.enum([
  "TERMINOLOGY",
  "BUSINESS_SCOPE",
  "POLICY_REFERENCE",
]);
export const aiSkillActivationStatusSchema = z.enum(["PILOT", "ACTIVE", "SUSPENDED"]);
export const aiEvaluationFeedbackKindSchema = z.enum([
  "USEFUL",
  "NOT_USEFUL",
  "DATA_INCOMPLETE",
  "COMPARISON_UNFAIR",
  "CONTEXT_DIFFERENT",
  "OTHER",
]);
export const aiSkillEvaluationRunModeSchema = z.enum(["OFFLINE"]);
export const aiSkillEvaluationRunStatusSchema = z.enum(["PASSED", "FAILED", "BLOCKED"]);

const aiCompanyTermSchema = z.object({
  termAr: z.string().trim().min(1).max(120),
  termEn: z.string().trim().min(1).max(120).optional(),
  definitionAr: z.string().trim().min(1).max(500),
  definitionEn: z.string().trim().min(1).max(500).optional(),
}).strict();
const aiCompanyPolicyReferenceSchema = z.object({
  code: z.string().trim().min(1).max(120),
  version: z.string().trim().min(1).max(80),
  titleAr: z.string().trim().min(1).max(160),
  sourceUrl: z.string().url().max(1_000).optional(),
}).strict();

/** Structured business context only. No persona, prompt, safety text, raw
 * mail/Google content, secrets or financial facts are accepted here. */
export const createAiCompanyContextDraftRequestSchema = z.object({
  kind: aiCompanyContextKindSchema,
  moduleScope: z.string().trim().min(1).max(80),
  presentationStyle: aiCompanyPresentationStyleSchema,
  terms: z.array(aiCompanyTermSchema).max(80),
  businessDomains: z.array(z.string().trim().min(1).max(120)).max(30),
  policyReferences: z.array(aiCompanyPolicyReferenceSchema).max(40),
  sourceReference: z.string().trim().min(1).max(500).optional(),
  expiresAt: z.coerce.date().optional(),
  idempotencyKey: aiIdempotencyKeySchema,
}).strict();

export const approveAiCompanyContextRequestSchema = z.object({
  idempotencyKey: aiIdempotencyKeySchema,
}).strict();
export const revokeAiCompanyContextRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: aiIdempotencyKeySchema,
}).strict();

export const createAiSkillActivationRequestSchema = z.object({
  skillKey: z.string().trim().min(1).max(120),
  skillVersion: z.number().int().positive(),
  policyVersion: z.number().int().positive(),
  status: z.enum(["PILOT", "ACTIVE"]).default("PILOT"),
  validFrom: z.coerce.date().optional(),
  validUntil: z.coerce.date().optional(),
  dailyRequestLimit: z.number().int().positive().max(100_000).optional(),
  dailyCostLimit: moneyLimitSchema,
  idempotencyKey: aiIdempotencyKeySchema,
}).strict();
export const suspendAiSkillActivationRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: aiIdempotencyKeySchema,
}).strict();

export const createAiEvaluationFeedbackRequestSchema = z.object({
  executionReceiptId: z.string().uuid(),
  kind: aiEvaluationFeedbackKindSchema,
  note: z.string().trim().min(1).max(1_000).optional(),
  idempotencyKey: aiIdempotencyKeySchema,
}).strict();

/** Starts only code-owned, de-identified safety/rubric checks. It never
 * invokes a model provider or sends company evidence. */
export const runAiSkillOfflineEvaluationRequestSchema = z.object({
  skillKey: z.string().trim().min(1).max(120),
  skillVersion: z.number().int().positive(),
  policyVersion: z.number().int().positive(),
  idempotencyKey: aiIdempotencyKeySchema,
}).strict();

export const aiSkillEvaluationRunReceiptSchema = z.object({
  id: z.string().uuid(),
  skillKey: z.string().min(1).max(120),
  skillVersion: z.number().int().positive(),
  policyVersion: z.number().int().positive(),
  suiteKey: z.string().min(1).max(160),
  suiteVersion: z.number().int().positive(),
  suiteChecksum: z.string().regex(/^[0-9a-f]{64}$/),
  mode: aiSkillEvaluationRunModeSchema,
  status: aiSkillEvaluationRunStatusSchema,
  totalCaseCount: z.number().int().nonnegative(),
  passedCaseCount: z.number().int().nonnegative(),
  failedCaseCount: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  replayed: z.boolean(),
}).strict();

export type CreateAiCompanyContextDraftRequest = z.infer<typeof createAiCompanyContextDraftRequestSchema>;
export type ApproveAiCompanyContextRequest = z.infer<typeof approveAiCompanyContextRequestSchema>;
export type RevokeAiCompanyContextRequest = z.infer<typeof revokeAiCompanyContextRequestSchema>;
export type CreateAiSkillActivationRequest = z.infer<typeof createAiSkillActivationRequestSchema>;
export type SuspendAiSkillActivationRequest = z.infer<typeof suspendAiSkillActivationRequestSchema>;
export type CreateAiEvaluationFeedbackRequest = z.infer<typeof createAiEvaluationFeedbackRequestSchema>;
export type RunAiSkillOfflineEvaluationRequest = z.infer<typeof runAiSkillOfflineEvaluationRequestSchema>;
export type AiSkillEvaluationRunReceipt = z.infer<typeof aiSkillEvaluationRunReceiptSchema>;

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
    interpretationId: z.string().uuid(),
    disposition: z.enum(["GENERATED", "REUSED"]),
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
    interpretationId: z.string().uuid(),
    disposition: z.enum(["GENERATED", "REUSED"]),
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

/**
 * A server-owned answer to the question "may Basira interpret this now?".
 * It deliberately contains only actionable, non-financial status text. The
 * evidence and calculations remain in their owning read models.
 */
export const analysisReadinessStatusSchema = z.enum(["READY", "BLOCKED", "NEEDS_REVIEW"]);
export const analysisReadinessScopeSchema = z.enum(["DECISION_ALERT", "DECISION_WORKSPACE", "MARKETING_CAMPAIGN", "MARKETING_WORKSPACE"]);
export const analysisReadinessReasonSchema = z.object({
  code: z.enum([
    "NO_VERIFIED_ALERT",
    "ALERT_NOT_OPEN",
    "EVIDENCE_CHECKSUM_INVALID",
    "SALES_COMPARISON_NOT_READY",
    "NO_CAMPAIGN",
    "CAMPAIGN_DATES_MISSING",
    "CAMPAIGN_SALES_NOT_READY",
    "CAMPAIGN_SPEND_NOT_READY",
    "READY_FOR_INTERPRETATION",
  ]),
  messageAr: z.string().min(1).max(600),
  nextActionAr: z.string().min(1).max(600),
}).strict();
export const analysisReadinessReceiptSchema = z.object({
  scope: analysisReadinessScopeSchema,
  subjectId: z.string().uuid().nullable(),
  status: analysisReadinessStatusSchema,
  reasons: z.array(analysisReadinessReasonSchema).min(1).max(3),
  checkedAt: z.coerce.date(),
}).strict();
export type AnalysisReadinessReceipt = z.infer<typeof analysisReadinessReceiptSchema>;

/** Read-only centre for one saved, evidence-bound explanation. Opening it
 * never plans or triggers a provider request. */
export const aiInterpretationSubjectKindSchema = z.enum([
  "DECISION_ALERT",
  "MARKETING_CAMPAIGN",
]);
export const aiHumanInsightKindSchema = z.enum(["NOTE", "HYPOTHESIS", "DECISION"]);
export const aiHumanInsightStatusSchema = z.enum(["DRAFT", "APPROVED", "REVOKED"]);

export const aiStoredInterpretationOutputSchema = z.object({
  summary: z.string().trim().min(1).max(1_200),
  evidence: z.array(z.string().trim().min(1).max(600)).min(1).max(4),
  limitations: z.array(z.string().trim().min(1).max(600)).min(1).max(3),
  reviewSteps: z.array(z.string().trim().min(1).max(400)).min(1).max(3),
}).strict();

export const aiInterpretationListQuerySchema = z.object({
  subjectKind: aiInterpretationSubjectKindSchema.optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
}).strict();

export const aiHumanInsightSchema = z.object({
  id: z.string().uuid(),
  kind: aiHumanInsightKindSchema,
  status: aiHumanInsightStatusSchema,
  statement: z.string().trim().min(1).max(2_000),
  supersedesInsightId: z.string().uuid().nullable(),
  createdAt: z.coerce.date(),
  approvedAt: z.coerce.date().nullable(),
  revokedAt: z.coerce.date().nullable(),
  revocationReason: z.string().min(1).max(500).nullable(),
}).strict();

export const aiInterpretationListItemSchema = z.object({
  id: z.string().uuid(),
  subjectKind: aiInterpretationSubjectKindSchema,
  subjectId: z.string().uuid(),
  moduleKey: z.enum(["decision_intelligence", "marketing"]),
  skillKey: z.string().min(1).max(120),
  language: z.enum(["ar", "en"]),
  evidenceSnapshotId: z.string().uuid(),
  createdAt: z.coerce.date(),
  expiresAt: z.coerce.date().nullable(),
  isExpired: z.boolean(),
  placementCount: z.number().int().nonnegative(),
  humanInsightCounts: z.object({ draft: z.number().int().nonnegative(), approved: z.number().int().nonnegative() }).strict(),
  summary: z.string().trim().min(1).max(1_200),
}).strict();

export const aiInterpretationDetailSchema = aiInterpretationListItemSchema.extend({
  sourceExecutionReceiptId: z.string().uuid(),
  evidenceChecksum: z.string().regex(/^[0-9a-f]{64}$/),
  outputChecksum: z.string().regex(/^[0-9a-f]{64}$/),
  output: aiStoredInterpretationOutputSchema,
  placements: z.array(z.object({
    id: z.string().uuid(),
    kind: z.enum(["DECISION_ALERT", "MARKETING_CAMPAIGN", "COMMAND_CENTER", "REPORT"]),
    subjectId: z.string().uuid(),
    moduleKey: z.string().min(1).max(80),
    createdAt: z.coerce.date(),
  }).strict()),
  humanInsights: z.array(aiHumanInsightSchema),
}).strict();

export const createAiHumanInsightRequestSchema = z.object({
  kind: aiHumanInsightKindSchema,
  statement: z.string().trim().min(3).max(2_000),
  supersedesInsightId: z.string().uuid().optional(),
  idempotencyKey: aiIdempotencyKeySchema,
}).strict();
export const approveAiHumanInsightRequestSchema = z.object({
  idempotencyKey: aiIdempotencyKeySchema,
}).strict();
export const revokeAiHumanInsightRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: aiIdempotencyKeySchema,
}).strict();

export type AiInterpretationListQuery = z.infer<typeof aiInterpretationListQuerySchema>;
export type AiInterpretationListItem = z.infer<typeof aiInterpretationListItemSchema>;
export type AiInterpretationDetail = z.infer<typeof aiInterpretationDetailSchema>;
export type CreateAiHumanInsightRequest = z.infer<typeof createAiHumanInsightRequestSchema>;
export type ApproveAiHumanInsightRequest = z.infer<typeof approveAiHumanInsightRequestSchema>;
export type RevokeAiHumanInsightRequest = z.infer<typeof revokeAiHumanInsightRequestSchema>;

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
