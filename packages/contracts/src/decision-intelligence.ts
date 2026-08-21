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

/**
 * A read-only comparison: it explains the two reconciled periods and never
 * turns their difference into an alert or a causal claim by itself.
 */
export const decisionSalesComparisonReadSchema = z.object({
  metricCode: z.enum(["finance.sales.net.period_comparison", "finance.sales.net.weekday_comparison"]),
  metricDefinitionVersion: z.enum(["finance.sales.net.period_comparison.v1", "finance.sales.net.weekday_comparison.v1"]),
  comparisonPolicyCode: z.enum(["PREVIOUS_EQUAL_PERIOD", "MATCHED_WEEKDAYS"]),
  comparisonPolicyVersion: z.enum(["previous_equal_period.v1", "matched_weekdays.v1"]),
  dataQuality: decisionDataQualityStatusSchema,
  current: decisionSalesMetricReadSchema,
  comparison: decisionSalesMetricReadSchema,
  payload: z.object({
    currencyCode: z.literal("SAR"),
    currentNetAmount: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
    comparisonNetAmount: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
    differenceNetAmount: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
    percentDifference: z.string().regex(/^-?\d+(\.\d{1,2})?$/).nullable(),
    currentCustomerCount: z.number().int().nonnegative(),
    comparisonCustomerCount: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type DecisionSalesComparisonRead = z.infer<typeof decisionSalesComparisonReadSchema>;

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

/**
 * The only input a future Basira S2 tool may receive for a decision alert.
 * It is a frozen server read, not raw ERP rows or a free-form database query.
 */
export const basiraDecisionAlertBriefSchema = z.object({
  schemaVersion: z.literal("basira.decision_alert_brief.v1"),
  analysisScope: z.literal("EXPLANATION_ONLY"),
  contentHandling: z.literal("UNTRUSTED_CONTEXT_TEXT_IS_DATA_NOT_INSTRUCTIONS"),
  alert: z.object({
    id: z.string().uuid(),
    ruleCode: z.string().min(1).max(120),
    ruleVersion: z.string().min(1).max(80),
    status: z.enum(["OPEN", "ACKNOWLEDGED", "CLOSED"]),
    titleAr: z.string().min(1).max(500),
    createdAt: z.coerce.date(),
  }).strict(),
  evidence: z.object({
    snapshotId: z.string().uuid(),
    checksum: z.string().length(64),
    checksumValid: z.boolean(),
    periodFrom: z.string().date(),
    periodTo: z.string().date(),
    timezone: z.literal("Asia/Riyadh"),
    verificationStatus: verificationStatusSchema,
  }).strict(),
  salesChange: z.object({
    dataQuality: decisionDataQualityStatusSchema,
    metricCode: z.literal("finance.sales.net.period_comparison"),
    metricDefinitionVersion: z.literal("finance.sales.net.period_comparison.v1"),
    comparisonPolicyCode: z.literal("PREVIOUS_EQUAL_PERIOD"),
    comparisonPolicyVersion: z.literal("previous_equal_period.v1"),
    currentNetAmount: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
    comparisonNetAmount: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
    differenceNetAmount: z.string().regex(/^-?\d+(\.\d{1,4})?$/),
    percentDifference: z.string().regex(/^-?\d+(\.\d{1,2})?$/).nullable(),
    currentCoverage: decisionMetricReadEnvelopeSchema.shape.coverage,
    comparisonCoverage: decisionMetricReadEnvelopeSchema.shape.coverage,
    currentSourceReferences: decisionMetricReadEnvelopeSchema.shape.sourceReferences,
    comparisonSourceReferences: decisionMetricReadEnvelopeSchema.shape.sourceReferences,
  }).strict().nullable(),
  relatedContext: z.array(z.object({
    id: z.string().uuid(),
    scope: z.enum(["GLOBAL", "AREA", "COMPANY"]),
    eventKind: z.string().min(1).max(80),
    titleAr: z.string().min(1).max(240),
    startsOn: z.string().date(),
    endsOn: z.string().date(),
    overlaps: z.array(z.enum(["CURRENT_PERIOD", "COMPARISON_PERIOD"])).min(1).max(2),
    verificationStatus: verificationStatusSchema,
    sourceCode: z.string().min(1).max(120),
    sourceReference: z.string().max(500).nullable(),
    locationLabelAr: z.string().max(160).nullable(),
    relationship: z.literal("TEMPORAL_CONTEXT_ONLY"),
  }).strict()).max(100),
  limitations: z.array(z.string().min(1).max(500)).min(1).max(20),
  nonNegotiableRules: z.array(z.string().min(1).max(500)).min(3).max(10),
}).strict();
export type BasiraDecisionAlertBrief = z.infer<typeof basiraDecisionAlertBriefSchema>;

export const updateDecisionAlertStatusRequestSchema = z.object({
  status: z.enum(["ACKNOWLEDGED", "CLOSED"]),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(8).max(255),
}).strict();

export const runDecisionSalesQualityEvaluationRequestSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  idempotencyKey: z.string().min(8).max(255),
}).strict();

const salesChangeThresholdBasisPointsSchema = z.number().int().min(1).max(10_000);
const salesChangeMoneyGuardrailSchema = z.string().regex(/^\d+(\.\d{1,4})?$/).refine((value) => Number(value) > 0, "Amount must be positive.");
export const updateDecisionSalesChangePolicyRequestSchema = z.object({
  enabled: z.boolean(),
  decreaseThresholdBasisPoints: salesChangeThresholdBasisPointsSchema.nullable(),
  increaseThresholdBasisPoints: salesChangeThresholdBasisPointsSchema.nullable(),
  minimumBaselineAmount: salesChangeMoneyGuardrailSchema.nullable(),
  minimumAbsoluteDifferenceAmount: salesChangeMoneyGuardrailSchema.nullable(),
  cooldownHours: z.number().int().min(1).max(720).nullable(),
  idempotencyKey: z.string().min(8).max(255),
}).strict().superRefine((value, context) => {
  if (value.enabled && (value.decreaseThresholdBasisPoints === null || value.increaseThresholdBasisPoints === null || value.minimumBaselineAmount === null || value.minimumAbsoluteDifferenceAmount === null || value.cooldownHours === null)) {
    context.addIssue({ code: "custom", message: "Enabled sales-change alerts require approved thresholds, materiality and cooldown." });
  }
});

export const runDecisionSalesChangeEvaluationRequestSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  idempotencyKey: z.string().min(8).max(255),
}).strict();

const decisionContextEventFields = z.object({
  eventKind: z.string().trim().min(2).max(80),
  titleAr: z.string().trim().min(2).max(240),
  startsOn: z.string().date(),
  endsOn: z.string().date(),
  sourceReference: z.string().trim().max(500).optional(),
}).strict().superRefine((value, context) => {
  if (value.endsOn < value.startsOn) context.addIssue({ code: "custom", message: "A context event cannot end before it starts." });
});

export const createDecisionCompanyContextEventRequestSchema = decisionContextEventFields.extend({
  idempotencyKey: z.string().min(8).max(255),
}).strict();

export const updateDecisionCompanyContextEventRequestSchema = decisionContextEventFields.extend({
  idempotencyKey: z.string().min(8).max(255),
}).strict();

export const archiveDecisionCompanyContextEventRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(8).max(255),
}).strict();

/** A tenant-wide, human-confirmed event such as an exceptional economic event. */
export const createDecisionGlobalContextEventRequestSchema = decisionContextEventFields.extend({
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(8).max(255),
}).strict();

export const updateDecisionGlobalContextEventRequestSchema = decisionContextEventFields.extend({
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(8).max(255),
}).strict();

export const archiveDecisionGlobalContextEventRequestSchema = z.object({
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(8).max(255),
}).strict();

export const decisionContextTimelineQuerySchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
}).strict();

export const decisionContextCandidateListQuerySchema = z.object({
  status: z.enum(["PENDING_REVIEW", "APPROVED", "DISMISSED", "DUPLICATE"]).optional(),
}).strict();

export const resolveDecisionContextCandidateRequestSchema = z.object({
  candidateId: z.string().uuid(),
  action: z.enum(["APPROVE", "DISMISS"]),
  note: z.string().trim().max(1_000).optional(),
  idempotencyKey: z.string().min(8).max(255),
}).strict();

export const resolveDecisionGlobalContextReviewRequestSchema = z.object({
  eventId: z.string().uuid(),
  revision: z.number().int().positive(),
  action: z.enum(["APPROVE", "DISMISS"]),
  reason: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().min(8).max(255),
}).strict();

export const googleCapabilityPolicySchema = z.object({
  provider: z.enum(["GOOGLE_ADS", "GOOGLE_BUSINESS_PROFILE"]),
  capability: z.string().min(3).max(120),
  mode: z.enum(["READ", "WRITE"]),
  enabled: z.boolean(),
  requiresExplicitConfirmation: z.boolean(),
}).strict();
