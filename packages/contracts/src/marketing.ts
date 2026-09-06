import { z } from "zod";

import { decisionDataQualityStatusSchema, decisionSalesComparisonReadSchema, decisionSalesMetricReadSchema, verificationStatusSchema } from "./decision-intelligence.js";
import { financialReadContractSchema } from "./financial-read.js";
import { companyIdSchema } from "./identity.js";
import { idempotencyKeySchema } from "./finance.js";

const marketingIdSchema = z.string().uuid();
const marketingAmountSchema = z.string().regex(/^\d+(\.\d{1,4})?$/);
const marketingDateSchema = z.string().date();
export const marketingTargetMonthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

/**
 * The calendar is an operational read, not a financial report.  Every amount
 * it exposes is consequently VAT-inclusive and already formatted by the
 * server.  Keeping this envelope at the read boundary prevents React views
 * from silently choosing a tax basis, a currency label, or a rounding rule.
 */
export const marketingFinancialReadSchema = financialReadContractSchema;

/** A campaign is business context, never a financial posting or a provider action. */
export const marketingCampaignPlatformSchema = z.enum(["MANUAL", "GOOGLE_ADS", "META", "TIKTOK", "SNAPCHAT", "OTHER"]);
export const marketingCampaignStatusSchema = z.enum(["DRAFT", "PLANNED", "ACTIVE", "COMPLETED", "CANCELLED", "ARCHIVED"]);
export const marketingProviderSchema = z.enum(["GOOGLE_ADS", "GOOGLE_BUSINESS"]);
export const marketingProviderConnectionStatusSchema = z.enum(["NOT_CONNECTED", "SETUP_REQUESTED", "AUTHORIZING", "AUTHORIZED_AWAITING_SELECTION", "AUTHORIZED_READ_ONLY_SELECTED", "BLOCKED"]);
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
    status: z.enum(["NOT_CONNECTED", "AUTHORIZED_READ_ONLY_SELECTED"]),
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
  /** Server-computed availability for the tightly scoped ARZ Google Business pilot.
   * It exposes no credential, account, location, or OAuth state. */
  pilotAuthorizationAvailable: z.boolean(),
  allowedOperation: z.enum(["ADS_READ_ONLY", "BUSINESS_READ_AND_GOVERNED_PUBLISH"]),
  messageAr: z.string().min(1).max(600),
  messageEn: z.string().min(1).max(600),
}).strict();

export const marketingProviderConnectionsReadSchema = z.object({
  connections: z.array(marketingProviderConnectionSchema).length(2),
  liveOauthEnabled: z.literal(false),
}).strict();

/** A local credential-lifecycle receipt. It deliberately contains neither a
 * Google token nor a provider resource identifier. */
export const marketingGoogleBusinessPilotDisconnectReceiptSchema = z.object({
  status: z.literal("NOT_CONNECTED"),
}).strict();

/** Resource discovery is a transient, server-mediated read. It deliberately
 * exposes a small allowlisted display model rather than a Google payload. */
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
  plannedCampaignCostDisplay: z.string().min(1).max(80).nullable(),
  linkedActualSpend: marketingAmountSchema,
  linkedActualSpendDisplay: z.string().min(1).max(80),
  linkedPostedSpendOnly: z.literal(true),
  spendDataQuality: decisionDataQualityStatusSchema,
  excludedLinkedDocumentCount: z.number().int().nonnegative(),
  /** Campaign spend is compared with VAT-inclusive official sales. */
  officialGrossSales: marketingAmountSchema.nullable(),
  officialGrossSalesDisplay: z.string().min(1).max(80).nullable(),
  /** Rounded, currency-free compact label for a narrow calendar cell. */
  officialGrossSalesCalendarDisplay: z.string().min(1).max(80).nullable(),
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

/** Daily visual payload. An unread day has no comparable time-series value.
 * `null` means unavailable; the string value "0.0000" is reserved for a
 * completed day with a confirmed zero. This distinction prevents charts from
 * drawing future/unread financial activity on the zero baseline. */
export const marketingCalendarDaySchema = z.object({
  businessDate: marketingDateSchema,
  /** VAT-inclusive sales for collection-aligned operational summaries. */
  officialGrossSales: marketingAmountSchema.nullable(),
  officialGrossSalesDisplay: z.string().min(1).max(80).nullable(),
  /** Rounded, currency-free compact label for a narrow calendar cell. */
  officialGrossSalesCalendarDisplay: z.string().min(1).max(80).nullable(),
  officialNetSales: marketingAmountSchema.nullable(),
  /** Customer count is only available when the daily sales read is complete. */
  customerCount: z.number().int().nonnegative().nullable(),
  salesDayQuality: z.enum(["READY", "PENDING", "PARTIAL", "MISSING"]),
  dailySalesTarget: marketingAmountSchema.nullable(),
  dailySalesTargetDisplay: z.string().min(1).max(80).nullable(),
  targetStatus: z.enum(["NO_TARGET", "NO_SALES", "BELOW", "NEAR", "MET", "EXCEEDED"]),
  /** Posted campaign spend is unavailable when this daily read is unavailable. */
  linkedActualSpend: marketingAmountSchema.nullable(),
  linkedActualSpendDisplay: z.string().min(1).max(80).nullable(),
  linkedFinancialDocumentCount: z.number().int().nonnegative(),
  /** Posted financial spend grouped by the campaign explicitly linked to each document. */
  campaignSpend: z.array(z.object({ campaignId: marketingIdSchema, amount: marketingAmountSchema, documentCount: z.number().int().nonnegative() }).strict()).max(1_000),
  /** Uses the same sealed-vault scope as the financial movement report. */
  financialOutflows: marketingAmountSchema.nullable(),
  financialOutflowsDisplay: z.string().min(1).max(80).nullable(),
  financialOutflowDocumentCount: z.number().int().nonnegative(),
  /** Purchase movements from the same sealed financial-movement scope as the purchases card. */
  purchaseOutflows: marketingAmountSchema.nullable(),
  purchaseOutflowsDisplay: z.string().min(1).max(80).nullable(),
  purchaseOutflowDocumentCount: z.number().int().nonnegative(),
  activeCampaignIds: z.array(marketingIdSchema).max(1_000),
}).strict();

/** Server-owned weekday averages. Only calendar days with an eligible,
 * complete sales amount participate; pending or missing days never become a
 * misleading zero in the weekday header. Sunday is 0 through Saturday 6. */
export const marketingCalendarWeekdayAverageSchema = z.object({
  weekday: z.number().int().min(0).max(6),
  /** Server-owned VAT-inclusive daily average for completed days only. */
  averageOfficialGrossSales: marketingAmountSchema.nullable(),
  averageOfficialGrossSalesDisplay: z.string().min(1).max(80).nullable(),
  /** Rounded, currency-free compact label for a narrow calendar weekday header. */
  averageOfficialGrossSalesCalendarDisplay: z.string().min(1).max(80).nullable(),
  eligibleDayCount: z.number().int().nonnegative(),
}).strict();

/** Precomputed chart data. Values are derived in the Marketing read model so
 * the browser never parses, sums, divides, or rounds financial facts. */
const marketingTimelineAmountSchema = z.object({
  amount: marketingAmountSchema.nullable(),
  chartValue: z.number().finite().nonnegative().nullable(),
  /** Full, VAT-inclusive server display including the currency label. */
  display: z.string().min(1).max(80).nullable(),
}).strict();

const marketingTimelineCampaignAmountSchema = marketingTimelineAmountSchema.extend({
  campaignId: marketingIdSchema,
  documentCount: z.number().int().nonnegative(),
  barHeightPercent: z.number().int().min(0).max(100),
}).strict();

const marketingTimelineRowSchema = z.object({
  label: z.string().min(7).max(10),
  fromBusinessDate: marketingDateSchema,
  toBusinessDate: marketingDateSchema,
  sales: marketingTimelineAmountSchema,
  campaignSpend: marketingTimelineAmountSchema,
  purchases: marketingTimelineAmountSchema,
  customerCount: z.number().int().nonnegative().nullable(),
  salesDayQuality: z.enum(["READY", "PENDING", "PARTIAL", "MISSING"]),
  activeCampaignIds: z.array(marketingIdSchema).max(1_000),
  campaignSpendByCampaign: z.array(marketingTimelineCampaignAmountSchema).max(1_000),
}).strict();

const marketingTimelineCampaignLaneSchema = z.object({
  campaignId: marketingIdSchema,
  activeIndexes: z.array(z.number().int().nonnegative()).max(366),
  totalSpend: marketingTimelineAmountSchema,
  spendBars: z.array(marketingTimelineCampaignAmountSchema).max(366),
}).strict();

const marketingTimelineDatasetSchema = z.object({
  rows: z.array(marketingTimelineRowSchema).max(366),
  campaignLanes: z.array(marketingTimelineCampaignLaneSchema).max(1_000),
}).strict();

export const marketingCalendarTimelineSchema = z.object({
  daily: marketingTimelineDatasetSchema,
  monthly: marketingTimelineDatasetSchema,
}).strict();

/** A company-owned monthly sales target. Calendar days receive an explicit
 * server-calculated daily share; the client never derives targets itself. */
export const marketingSalesTargetSchema = z.object({
  periodMonth: marketingTargetMonthSchema,
  amount: marketingAmountSchema,
  amountDisplay: z.string().min(1).max(80),
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
  financialRead: marketingFinancialReadSchema,
  period: z.object({ fromBusinessDate: marketingDateSchema, toBusinessDate: marketingDateSchema, timezone: z.literal("Asia/Riyadh") }).strict(),
  sales: decisionSalesMetricReadSchema,
  campaigns: z.array(marketingCampaignSchema).max(1_000),
  days: z.array(marketingCalendarDaySchema).max(366),
  timeline: marketingCalendarTimelineSchema,
  weekdayAverages: z.array(marketingCalendarWeekdayAverageSchema).length(7),
  salesTargets: z.array(marketingSalesTargetSchema).max(13),
  context: z.array(marketingCalendarContextSchema).max(500),
  linkedActualGrossAmount: marketingAmountSchema,
  linkedActualGrossAmountDisplay: z.string().min(1).max(80),
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
export type MarketingGoogleBusinessPilotDisconnectReceipt = z.infer<typeof marketingGoogleBusinessPilotDisconnectReceiptSchema>;
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
export type MarketingFinancialRead = z.infer<typeof marketingFinancialReadSchema>;
export type UpsertMarketingSalesTargetRequest = z.infer<typeof upsertMarketingSalesTargetRequestSchema>;
export type UpdateMarketingReputationReplyPolicyRequest = z.infer<typeof updateMarketingReputationReplyPolicyRequestSchema>;
export type CreateMarketingCampaignAnalysisFeedbackRequest = z.infer<typeof createMarketingCampaignAnalysisFeedbackRequestSchema>;
