import { z } from "zod";

import { decisionDataQualityStatusSchema, decisionSalesComparisonReadSchema, decisionSalesMetricReadSchema, verificationStatusSchema } from "./decision-intelligence.js";
import { companyIdSchema } from "./identity.js";
import { idempotencyKeySchema } from "./finance.js";

const marketingIdSchema = z.string().uuid();
const marketingAmountSchema = z.string().regex(/^\d+(\.\d{1,4})?$/);
const marketingDateSchema = z.string().date();
export const marketingTargetMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/** A campaign is business context, never a financial posting or a provider action. */
export const marketingCampaignPlatformSchema = z.enum(["MANUAL", "GOOGLE_ADS", "META", "TIKTOK", "SNAPCHAT", "OTHER"]);
export const marketingCampaignStatusSchema = z.enum(["DRAFT", "PLANNED", "ACTIVE", "COMPLETED", "CANCELLED", "ARCHIVED"]);
export const marketingProviderSchema = z.enum(["GOOGLE_ADS", "GOOGLE_BUSINESS"]);
export const marketingProviderConnectionStatusSchema = z.enum(["NOT_CONNECTED", "SETUP_REQUESTED", "AUTHORIZING", "BLOCKED"]);
export const marketingReputationReplyAutomationStatusSchema = z.enum(["DISABLED", "ENABLED", "PAUSED"]);
export const marketingReputationReplyAuthoringMethodSchema = z.enum(["TEMPLATE", "BASIRA_DRAFT"]);
export const marketingReputationReplyToneSchema = z.enum(["WARM", "PROFESSIONAL", "FORMAL"]);
export const marketingReputationReplyLanguageModeSchema = z.enum(["MATCH_REVIEW", "ARABIC", "ENGLISH"]);

/** Configuration only. It has no provider credential or authority to publish. */
export const marketingReputationReplyPolicySchema = z.object({
  automationStatus: marketingReputationReplyAutomationStatusSchema,
  authoringMethod: marketingReputationReplyAuthoringMethodSchema,
  tone: marketingReputationReplyToneSchema,
  languageMode: marketingReputationReplyLanguageModeSchema,
  autoFourFiveEnabled: z.boolean(),
  autoThreeIfSafe: z.boolean(),
  signature: z.string().max(160).nullable(),
  revision: z.number().int().positive(),
  executionReadiness: z.literal("NOT_CONNECTED"),
}).strict();

export const marketingCampaignSchema = z.object({
  id: marketingIdSchema,
  titleAr: z.string().min(1).max(160),
  titleEn: z.string().max(160).nullable(),
  platform: marketingCampaignPlatformSchema,
  externalReference: z.string().max(160).nullable(),
  startsOn: z.string().date().nullable(),
  endsOn: z.string().date().nullable(),
  status: marketingCampaignStatusSchema,
  stoppedOn: z.string().date().nullable(),
  stoppedReason: z.string().max(500).nullable(),
  objective: z.string().max(500).nullable(),
  notes: z.string().max(2_000).nullable(),
  plannedCost: marketingAmountSchema.nullable(),
  plannedCurrencyCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const marketingWorkspaceSchema = z.object({
  companyId: companyIdSchema,
  campaigns: z.array(marketingCampaignSchema).max(1_000),
  readiness: z.array(z.object({
    provider: z.enum(["GOOGLE_ADS", "GOOGLE_BUSINESS"]),
    status: z.literal("NOT_CONNECTED"),
    messageAr: z.string().min(1).max(500),
  }).strict()).length(2),
  replyPolicy: marketingReputationReplyPolicySchema,
}).strict();

/** No credentials, Google account identifiers, location identifiers or OAuth
 * state are represented here. This is only the company-visible control plane. */
export const marketingProviderPlatformReadinessSchema = z.enum(["PLATFORM_SETUP_REQUIRED", "PLATFORM_READY_AWAITING_OAUTH_IMPLEMENTATION"]);
export const marketingProviderConnectionSchema = z.object({
  provider: marketingProviderSchema,
  status: marketingProviderConnectionStatusSchema,
  setupRequestedAt: z.string().datetime().nullable(),
  platformReadiness: marketingProviderPlatformReadinessSchema,
  allowedOperation: z.enum(["ADS_READ_ONLY", "BUSINESS_READ_AND_GOVERNED_PUBLISH"]),
  messageAr: z.string().min(1).max(600),
  messageEn: z.string().min(1).max(600),
}).strict();

export const marketingProviderConnectionsReadSchema = z.object({
  connections: z.array(marketingProviderConnectionSchema).length(2),
  liveOauthEnabled: z.literal(false),
}).strict();

export const requestMarketingProviderConnectionSetupSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
}).strict();

const campaignPayloadSchema = z.object({
  titleAr: z.string().trim().min(1).max(160),
  titleEn: z.string().trim().max(160).optional(),
  platform: marketingCampaignPlatformSchema,
  externalReference: z.string().trim().max(160).optional(),
  startsOn: z.string().date().optional(),
  endsOn: z.string().date().optional(),
  // Cancellation must use the dedicated stop command so a date and a reason
  // are always retained for the analysis timeline.
  status: marketingCampaignStatusSchema.exclude(["ARCHIVED", "CANCELLED"]),
  objective: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(2_000).optional(),
  plannedCost: marketingAmountSchema.optional(),
}).strict().refine((value) => !value.startsOn || !value.endsOn || value.startsOn <= value.endsOn, { path: ["endsOn"], message: "Campaign end must not precede its start." });

export const createMarketingCampaignRequestSchema = campaignPayloadSchema.extend({ idempotencyKey: idempotencyKeySchema }).strict();
export const updateMarketingCampaignRequestSchema = campaignPayloadSchema.extend({ idempotencyKey: idempotencyKeySchema }).strict();
export const archiveMarketingCampaignRequestSchema = z.object({
  campaignId: marketingIdSchema,
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
}).strict();
/** Stops a live/planned campaign without deleting its history. The stop date
 * becomes the effective campaign end used by the official read model. */
export const stopMarketingCampaignRequestSchema = z.object({
  stoppedOn: marketingDateSchema,
  reason: z.string().trim().min(1).max(500),
  idempotencyKey: idempotencyKeySchema,
}).strict();
export const marketingEntityReceiptSchema = z.object({ id: marketingIdSchema, replayed: z.boolean() }).strict();

export const linkMarketingCampaignFinancialDocumentRequestSchema = z.object({
  financialDocumentId: z.string().uuid(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const linkMarketingCampaignContextRequestSchema = z.union([
  z.object({ globalEventId: z.string().uuid(), idempotencyKey: idempotencyKeySchema }).strict(),
  z.object({ companyEventId: z.string().uuid(), idempotencyKey: idempotencyKeySchema }).strict(),
]);

/** Posted Finance documents that may be referenced by a campaign. The list
 * deliberately exposes no supplier, tax or journal internals to Marketing. */
export const marketingLinkableFinancialDocumentsSchema = z.object({
  documents: z.array(z.object({
    id: marketingIdSchema,
    documentNumber: z.string().min(1).max(80),
    businessDate: marketingDateSchema,
    kind: z.enum(["PURCHASE", "EXPENSE"]),
    grossAmount: marketingAmountSchema,
  }).strict()).max(100),
}).strict();

/** A descriptive measurement read. It intentionally cannot be named ROI or
 * attribution: Ads facts are a separate source and may be unavailable. */
export const marketingSpendResultSchema = z.object({
  plannedCampaignCost: marketingAmountSchema.nullable(),
  linkedActualSpend: marketingAmountSchema,
  linkedPostedSpendOnly: z.literal(true),
  spendDataQuality: decisionDataQualityStatusSchema,
  excludedLinkedDocumentCount: z.number().int().nonnegative(),
  officialNetSales: marketingAmountSchema.nullable(),
  spendToSalesPercent: z.string().regex(/^\d+(\.\d{1,2})?$/).nullable(),
  campaignCount: z.number().int().nonnegative(),
  salesDataQuality: decisionDataQualityStatusSchema,
  googleAdsStatus: z.literal("NOT_CONNECTED"),
  conclusionAr: z.string().min(1).max(600),
  conclusionEn: z.string().min(1).max(600),
  analysisBoundary: z.literal("DESCRIPTIVE_SPEND_SALES_ONLY_NOT_ROI_OR_CAUSATION"),
}).strict();

export const marketingCampaignAnalysisSchema = z.object({
  schemaVersion: z.literal("marketing.campaign_analysis_read.v2"),
  metricDefinitionVersion: z.literal("marketing.campaign.performance.v1"),
  comparisonPolicyCode: z.literal("PREVIOUS_EQUAL_PERIOD"),
  comparisonPolicyVersion: z.literal("previous_equal_period.v1"),
  campaign: marketingCampaignSchema,
  period: z.object({ fromBusinessDate: marketingDateSchema, toBusinessDate: marketingDateSchema, timezone: z.literal("Asia/Riyadh") }).nullable(),
  sales: decisionSalesMetricReadSchema.nullable(),
  salesComparison: decisionSalesComparisonReadSchema.nullable(),
  linkedFinancialDocuments: z.array(z.object({
    linkId: marketingIdSchema,
    documentId: marketingIdSchema,
    documentNumber: z.string().min(1).max(80),
    businessDate: marketingDateSchema,
    kind: z.enum(["PURCHASE", "EXPENSE"]),
    grossAmount: marketingAmountSchema,
    netAmount: marketingAmountSchema,
    vatAmount: marketingAmountSchema,
    status: z.literal("POSTED"),
    includedInCampaignPeriod: z.boolean(),
  }).strict()).max(500),
  linkedActualGrossAmount: marketingAmountSchema,
  spendResult: marketingSpendResultSchema,
  relatedContext: z.array(z.object({
    id: marketingIdSchema,
    scope: z.enum(["GLOBAL", "AREA", "COMPANY"]),
    eventKind: z.string().min(1).max(80),
    titleAr: z.string().min(1).max(240),
    startsOn: marketingDateSchema,
    endsOn: marketingDateSchema,
    verificationStatus: verificationStatusSchema,
    explicitlyLinked: z.boolean(),
  }).strict()).max(100),
  managerSummaryAr: z.string().min(1).max(1_000),
  limitations: z.array(z.string().min(1).max(500)).min(1).max(12),
  analysisBoundary: z.literal("TEMPORAL_CONTEXT_ONLY_NOT_CAUSATION"),
}).strict();

export const marketingCalendarQuerySchema = z.object({
  from: marketingDateSchema,
  to: marketingDateSchema,
}).strict()
  .refine((value) => value.from <= value.to, { path: ["to"], message: "Calendar end must not precede its start." })
  .refine((value) => Date.parse(`${value.to}T00:00:00.000Z`) - Date.parse(`${value.from}T00:00:00.000Z`) <= 365 * 24 * 60 * 60 * 1_000, { path: ["to"], message: "Calendar range cannot exceed 366 days." });

/** Daily visual payload. A missing, pending, or partial sales day has no
 * amount. This makes it impossible for a chart consumer to draw it as zero. */
export const marketingCalendarDaySchema = z.object({
  businessDate: marketingDateSchema,
  officialNetSales: marketingAmountSchema.nullable(),
  salesDayQuality: z.enum(["READY", "PENDING", "PARTIAL", "MISSING"]),
  dailySalesTarget: marketingAmountSchema.nullable(),
  targetStatus: z.enum(["NO_TARGET", "NO_SALES", "BELOW", "NEAR", "MET", "EXCEEDED"]),
  linkedActualSpend: marketingAmountSchema,
  linkedFinancialDocumentCount: z.number().int().nonnegative(),
  activeCampaignIds: z.array(marketingIdSchema).max(1_000),
}).strict();

/** Server-owned weekday averages. Only calendar days with an eligible,
 * complete sales amount participate; pending or missing days never become a
 * misleading zero in the weekday header. Sunday is 0 through Saturday 6. */
export const marketingCalendarWeekdayAverageSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  averageOfficialNetSales: marketingAmountSchema.nullable(),
  eligibleDayCount: z.number().int().nonnegative(),
}).strict();

/** A company-owned monthly sales target. Calendar days receive an explicit
 * server-calculated daily share; the client never derives targets itself. */
export const marketingSalesTargetSchema = z.object({
  periodMonth: marketingTargetMonthSchema,
  amount: marketingAmountSchema,
}).strict();

export const upsertMarketingSalesTargetRequestSchema = z.object({
  amount: marketingAmountSchema.refine((value) => Number(value) > 0, { message: "Target must be greater than zero." }),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const marketingCalendarContextSchema = z.object({
  id: marketingIdSchema,
  scope: z.enum(["GLOBAL", "AREA", "COMPANY"]),
  eventKind: z.string().min(1).max(80),
  titleAr: z.string().min(1).max(240),
  startsOn: marketingDateSchema,
  endsOn: marketingDateSchema,
  verificationStatus: verificationStatusSchema,
}).strict();

export const marketingCalendarReadSchema = z.object({
  period: z.object({ fromBusinessDate: marketingDateSchema, toBusinessDate: marketingDateSchema, timezone: z.literal("Asia/Riyadh") }).strict(),
  sales: decisionSalesMetricReadSchema,
  campaigns: z.array(marketingCampaignSchema).max(1_000),
  days: z.array(marketingCalendarDaySchema).max(366),
  weekdayAverages: z.array(marketingCalendarWeekdayAverageSchema).length(7),
  salesTargets: z.array(marketingSalesTargetSchema).max(13),
  context: z.array(marketingCalendarContextSchema).max(500),
  linkedActualGrossAmount: marketingAmountSchema,
  spendResult: marketingSpendResultSchema,
  dataQuality: decisionDataQualityStatusSchema,
  analysisBoundary: z.literal("TEMPORAL_CONTEXT_ONLY_NOT_CAUSATION"),
}).strict();
export const updateMarketingReputationReplyPolicyRequestSchema = z.object({
  automationStatus: marketingReputationReplyAutomationStatusSchema,
  authoringMethod: marketingReputationReplyAuthoringMethodSchema,
  tone: marketingReputationReplyToneSchema,
  languageMode: marketingReputationReplyLanguageModeSchema,
  autoFourFiveEnabled: z.boolean(),
  autoThreeIfSafe: z.boolean(),
  signature: z.string().trim().max(160).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** Feedback is deliberately categorical first so it can improve evaluation
 * without treating an open-ended note as a training instruction. */
export const marketingCampaignAnalysisFeedbackKindSchema = z.enum([
  "USEFUL",
  "NOT_RELEVANT",
  "DATA_INCOMPLETE",
  "COMPARISON_UNFAIR",
  "DIFFERENT_CONTEXT",
]);
export const createMarketingCampaignAnalysisFeedbackRequestSchema = z.object({
  evidenceSnapshotId: marketingIdSchema,
  kind: marketingCampaignAnalysisFeedbackKindSchema,
  note: z.string().trim().min(1).max(1_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export type MarketingWorkspace = z.infer<typeof marketingWorkspaceSchema>;
export type MarketingProviderConnectionsRead = z.infer<typeof marketingProviderConnectionsReadSchema>;
export type RequestMarketingProviderConnectionSetup = z.infer<typeof requestMarketingProviderConnectionSetupSchema>;
export type CreateMarketingCampaignRequest = z.infer<typeof createMarketingCampaignRequestSchema>;
export type UpdateMarketingCampaignRequest = z.infer<typeof updateMarketingCampaignRequestSchema>;
export type ArchiveMarketingCampaignRequest = z.infer<typeof archiveMarketingCampaignRequestSchema>;
export type StopMarketingCampaignRequest = z.infer<typeof stopMarketingCampaignRequestSchema>;
export type LinkMarketingCampaignFinancialDocumentRequest = z.infer<typeof linkMarketingCampaignFinancialDocumentRequestSchema>;
export type LinkMarketingCampaignContextRequest = z.infer<typeof linkMarketingCampaignContextRequestSchema>;
export type MarketingLinkableFinancialDocuments = z.infer<typeof marketingLinkableFinancialDocumentsSchema>;
export type MarketingCampaignAnalysis = z.infer<typeof marketingCampaignAnalysisSchema>;
export type MarketingCalendarRead = z.infer<typeof marketingCalendarReadSchema>;
export type UpsertMarketingSalesTargetRequest = z.infer<typeof upsertMarketingSalesTargetRequestSchema>;
export type UpdateMarketingReputationReplyPolicyRequest = z.infer<typeof updateMarketingReputationReplyPolicyRequestSchema>;
export type CreateMarketingCampaignAnalysisFeedbackRequest = z.infer<typeof createMarketingCampaignAnalysisFeedbackRequestSchema>;
