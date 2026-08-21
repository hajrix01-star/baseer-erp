import { z } from "zod";

export const decisionDataQualityStatusSchema = z.enum([
  "READY",
  "NO_DATA",
  "INCOMPLETE",
  "STALE",
  "UNAVAILABLE",
  "CONFLICTED",
]);
export type DecisionDataQualityStatus = z.infer<typeof decisionDataQualityStatusSchema>;

export const evidenceKindSchema = z.enum([
  "OFFICIAL_FACT",
  "PROVIDER_FACT",
  "RECORDED_CONTEXT",
  "EXTRACTED_CLAIM",
  "HYPOTHESIS",
]);
export type EvidenceKind = z.infer<typeof evidenceKindSchema>;

export const verificationStatusSchema = z.enum([
  "UNVERIFIED",
  "HUMAN_CONFIRMED",
  "SYSTEM_RECONCILED",
  "REJECTED",
  "NOT_APPLICABLE",
]);
export type VerificationStatus = z.infer<typeof verificationStatusSchema>;

export const comparisonPolicyCodeSchema = z.enum([
  "PREVIOUS_EQUAL_PERIOD",
  "MATCHED_WEEKDAYS",
  "YEAR_OVER_YEAR",
  "EVENT_ALIGNED",
  "ROLLING_MEDIAN_BASELINE",
]);
export type ComparisonPolicyCode = z.infer<typeof comparisonPolicyCodeSchema>;

export const decisionMetricReadEnvelopeSchema = z.object({
  metricCode: z.string().min(3).max(120),
  metricDefinitionVersion: z.string().min(1).max(80),
  period: z.object({
    fromBusinessDate: z.string().date(),
    toBusinessDate: z.string().date(),
    timezone: z.literal("Asia/Riyadh"),
    timeGrain: z.enum(["DAY", "MONTH", "PERIOD"]),
  }).strict(),
  evidenceKind: evidenceKindSchema,
  verificationStatus: verificationStatusSchema,
  dataQuality: decisionDataQualityStatusSchema,
  calculatedAt: z.coerce.date(),
  sourceFreshAt: z.coerce.date().nullable(),
  coverage: z.object({
    requiredDays: z.number().int().nonnegative(),
    availableDays: z.number().int().nonnegative(),
    missingDays: z.array(z.string().date()).max(366),
    excludedDays: z.array(z.object({ date: z.string().date(), reason: z.string().min(1).max(240) }).strict()).max(366),
  }).strict(),
  sourceReferences: z.array(z.object({
    sourceType: z.string().min(1).max(80),
    sourceId: z.string().min(1).max(160),
    checksum: z.string().max(128).nullable(),
  }).strict()).max(100),
  payload: z.record(z.string(), z.unknown()),
}).strict();
export type DecisionMetricReadEnvelope = z.infer<typeof decisionMetricReadEnvelopeSchema>;

export const decisionSalesMetricReadSchema = decisionMetricReadEnvelopeSchema.extend({
  metricCode: z.literal("finance.sales.net.daily"),
  payload: z.object({
    currencyCode: z.literal("SAR"),
    netAmount: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
    grossAmount: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
    vatAmount: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
    customerCount: z.number().int().nonnegative(),
  }).strict(),
});
export type DecisionSalesMetricRead = z.infer<typeof decisionSalesMetricReadSchema>;

export const decisionAlertFeedbackRequestSchema = z.object({
  alertId: z.string().uuid(),
  kind: z.enum([
    "CORRECT",
    "PARTIALLY_CORRECT",
    "INCORRECT",
    "DATA_INCOMPLETE",
    "COMPARISON_INAPPROPRIATE",
    "EVENT_RELATED",
    "EVENT_NOT_RELATED",
    "USEFUL",
    "NOT_USEFUL",
  ]),
  note: z.string().trim().max(2_000).optional(),
  idempotencyKey: z.string().min(8).max(255),
}).strict();

export const decisionAlertListQuerySchema = z.object({
  status: z.enum(["OPEN", "ACKNOWLEDGED", "CLOSED"]).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).strict();

export const runDecisionSalesQualityEvaluationRequestSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  idempotencyKey: z.string().min(8).max(255),
}).strict();

export const createDecisionCompanyContextEventRequestSchema = z.object({
  eventKind: z.string().trim().min(2).max(80),
  titleAr: z.string().trim().min(2).max(240),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  sourceReference: z.string().trim().max(500).optional(),
  idempotencyKey: z.string().min(8).max(255),
}).strict();

export const decisionContextTimelineQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
}).strict();

export const googleCapabilityPolicySchema = z.object({
  provider: z.enum(["GOOGLE_ADS", "GOOGLE_BUSINESS_PROFILE"]),
  capability: z.string().min(3).max(120),
  mode: z.enum(["READ", "WRITE"]),
  enabled: z.boolean(),
  requiresExplicitConfirmation: z.boolean(),
}).strict();
