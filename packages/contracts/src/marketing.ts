import { z } from "zod";

import { decisionDataQualityStatusSchema, decisionSalesMetricReadSchema, verificationStatusSchema } from "./decision-intelligence.js";
import { companyIdSchema } from "./identity.js";
import { idempotencyKeySchema } from "./finance.js";

const marketingIdSchema = z.string().uuid();
const marketingAmountSchema = z.string().regex(/^\d+(\.\d{1,4})?$/);
const marketingDateSchema = z.string().date();

/** A campaign is business context, never a financial posting or a provider action. */
export const marketingCampaignPlatformSchema = z.enum(["MANUAL", "GOOGLE_ADS", "META", "TIKTOK", "SNAPCHAT", "OTHER"]);
export const marketingCampaignStatusSchema = z.enum(["DRAFT", "PLANNED", "ACTIVE", "COMPLETED", "CANCELLED", "ARCHIVED"]);
export const marketingProviderSchema = z.enum(["GOOGLE_ADS", "GOOGLE_BUSINESS"]);
export const marketingProviderConnectionStatusSchema = z.enum(["NOT_CONNECTED", "SETUP_REQUESTED", "BLOCKED"]);
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
export const marketingProviderConnectionSchema = z.object({
  provider: marketingProviderSchema,
  status: marketingProviderConnectionStatusSchema,
  setupRequestedAt: z.string().datetime().nullable(),
  platformReadiness: z.literal("PLATFORM_SETUP_REQUIRED"),
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
  status: marketingCampaignStatusSchema.exclude(["ARCHIVED"]),
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
  plannedCampaignCost: marketingAmountSchema,
  linkedActualSpend: marketingAmountSchema,
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
  campaign: marketingCampaignSchema,
  period: z.object({ fromBusinessDate: marketingDateSchema, toBusinessDate: marketingDateSchema, timezone: z.literal("Asia/Riyadh") }).nullable(),
  sales: decisionSalesMetricReadSchema.nullable(),
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
  linkedActualSpend: marketingAmountSchema,
  linkedFinancialDocumentCount: z.number().int().nonnegative(),
  activeCampaignIds: z.array(marketingIdSchema).max(1_000),
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

export type MarketingWorkspace = z.infer<typeof marketingWorkspaceSchema>;
export type MarketingProviderConnectionsRead = z.infer<typeof marketingProviderConnectionsReadSchema>;
export type RequestMarketingProviderConnectionSetup = z.infer<typeof requestMarketingProviderConnectionSetupSchema>;
export type CreateMarketingCampaignRequest = z.infer<typeof createMarketingCampaignRequestSchema>;
export type UpdateMarketingCampaignRequest = z.infer<typeof updateMarketingCampaignRequestSchema>;
export type ArchiveMarketingCampaignRequest = z.infer<typeof archiveMarketingCampaignRequestSchema>;
export type LinkMarketingCampaignFinancialDocumentRequest = z.infer<typeof linkMarketingCampaignFinancialDocumentRequestSchema>;
export type LinkMarketingCampaignContextRequest = z.infer<typeof linkMarketingCampaignContextRequestSchema>;
export type MarketingLinkableFinancialDocuments = z.infer<typeof marketingLinkableFinancialDocumentsSchema>;
export type MarketingCampaignAnalysis = z.infer<typeof marketingCampaignAnalysisSchema>;
export type MarketingCalendarRead = z.infer<typeof marketingCalendarReadSchema>;
export type UpdateMarketingReputationReplyPolicyRequest = z.infer<typeof updateMarketingReputationReplyPolicyRequestSchema>;
