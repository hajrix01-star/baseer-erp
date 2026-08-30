import { z } from "zod";

import { companyIdSchema } from "./identity.js";

const ownerDailyBriefAmountSchema = z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/);
const ownerDailyBriefSignedAmountSchema = z.string().regex(/^-?\d{1,14}(?:\.\d{1,4})?$/);
const ownerDailyBriefDateSchema = z.string().date();
const ownerDailyBriefCurrencySchema = z.string().regex(/^[A-Z]{3}$/);
const ownerDailyBriefFinancialContractSchema = z.object({
  /** All displayed sales and purchase amounts are gross, VAT-inclusive SAR-style amounts. */
  amountBasis: z.literal("GROSS_VAT_INCLUSIVE"),
  /** The server owns aggregation; clients must render rather than recompute financial figures. */
  dataAuthority: z.literal("BACKEND_DAILY_FINANCIAL_SUMMARY"),
}).strict();

/** A central, owner-only read. Monetary totals are intentionally null when the
 * tenant includes more than one functional currency; no FX consolidation is
 * implied by this first version. */
export const ownerDailyBriefQuerySchema = z.object({
  reportDate: ownerDailyBriefDateSchema.optional(),
}).strict();

export const ownerDailyBriefHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(180).default(60),
}).strict();

export const ownerDailyBriefCompanySchema = z.object({
  companyId: companyIdSchema,
  nameAr: z.string().min(1).max(160),
  nameEn: z.string().min(1).max(160),
  currencyCode: ownerDailyBriefCurrencySchema.nullable(),
  sales: z.object({
    yesterdayGrossAmount: ownerDailyBriefAmountSchema.nullable(),
    monthToDateGrossAmount: ownerDailyBriefAmountSchema.nullable(),
    yesterdayClosingCount: z.number().int().nonnegative().nullable(),
    monthToDateClosingCount: z.number().int().nonnegative().nullable(),
    yesterdayStatus: z.enum(["READY", "INCOMPLETE", "NO_DATA"]),
    monthToDateStatus: z.enum(["READY", "INCOMPLETE", "NO_DATA"]),
    eligibleMonthToDateDayCount: z.number().int().nonnegative(),
    incompleteMonthToDateDayCount: z.number().int().nonnegative(),
    /** Explicit coverage. CLOSED days are intentionally outside the average/forecast denominator. */
    requiredMonthToDateOperatingDayCount: z.number().int().nonnegative().optional(),
    recordedMonthToDateDayCount: z.number().int().nonnegative().optional(),
    scheduledClosedMonthToDateDayCount: z.number().int().nonnegative().optional(),
    partialMonthToDateDayCount: z.number().int().nonnegative().optional(),
    missingMonthToDateDayCount: z.number().int().nonnegative().optional(),
    forecastOperatingMonthDayCount: z.number().int().nonnegative().optional(),
    dailyChangeGrossAmount: ownerDailyBriefSignedAmountSchema.nullable().optional(),
    dailyAverageGrossAmount: ownerDailyBriefAmountSchema.nullable().optional(),
    monthEndForecastGrossAmount: ownerDailyBriefAmountSchema.nullable().optional(),
    priorPeriodTrendPercent: ownerDailyBriefSignedAmountSchema.nullable().optional(),
    trend: z.array(z.object({
      businessDate: ownerDailyBriefDateSchema,
      grossAmount: ownerDailyBriefAmountSchema.nullable(),
      grossAmountDisplay: z.string().min(1).max(64).nullable().optional(),
      /** Server-owned relative chart height; null means the day is not displayable. */
      barHeightPercent: z.number().min(8).max(100).nullable().optional(),
    }).strict()).max(12).optional(),
    /** Final display fields. Clients render them without parsing or formatting money. */
    display: z.object({
      yesterdayGrossAmount: z.string().min(1).max(64).nullable(),
      monthToDateGrossAmount: z.string().min(1).max(64).nullable(),
      dailyChangeGrossAmount: z.string().min(1).max(64).nullable(),
      dailyAverageGrossAmount: z.string().min(1).max(64).nullable(),
      monthEndForecastGrossAmount: z.string().min(1).max(64).nullable(),
      priorPeriodTrendPercent: z.string().min(1).max(32).nullable(),
      purchaseToSalesPercent: z.string().min(1).max(32).nullable(),
    }).strict().optional(),
  }).strict(),
  purchases: z.object({
    yesterdayGrossAmount: ownerDailyBriefAmountSchema,
    monthToDateGrossAmount: ownerDailyBriefAmountSchema,
    yesterdayDocumentCount: z.number().int().nonnegative(),
    monthToDateDocumentCount: z.number().int().nonnegative(),
  }).strict(),
  purchaseToSalesPercent: ownerDailyBriefAmountSchema.nullable(),
}).strict();

export const ownerDailyBriefReceiptSchema = z.object({
  reportDate: ownerDailyBriefDateSchema,
  generatedAt: z.string().datetime(),
  timezone: z.literal("Asia/Riyadh"),
  period: z.object({
    fromBusinessDate: ownerDailyBriefDateSchema,
    toBusinessDate: ownerDailyBriefDateSchema,
  }).strict(),
  currency: z.object({
    code: ownerDailyBriefCurrencySchema.nullable(),
    status: z.enum(["SINGLE_CURRENCY", "MIXED_OR_UNCONFIGURED"]),
  }).strict(),
  /** Present on all newly generated receipts. Historical immutable snapshots can predate this contract. */
  financialContract: ownerDailyBriefFinancialContractSchema.optional(),
  totals: z.object({
    activeCompanyCount: z.number().int().nonnegative(),
    readyCompanyCount: z.number().int().nonnegative(),
    incompleteCompanyCount: z.number().int().nonnegative(),
    noDataCompanyCount: z.number().int().nonnegative(),
    yesterdaySalesGrossAmount: ownerDailyBriefAmountSchema.nullable(),
    yesterdayPurchasesGrossAmount: ownerDailyBriefAmountSchema.nullable(),
    monthToDateSalesGrossAmount: ownerDailyBriefAmountSchema.nullable(),
    monthToDatePurchasesGrossAmount: ownerDailyBriefAmountSchema.nullable(),
    purchaseToSalesPercent: ownerDailyBriefAmountSchema.nullable(),
    display: z.object({
      yesterdaySalesGrossAmount: z.string().min(1).max(64).nullable(),
      yesterdayPurchasesGrossAmount: z.string().min(1).max(64).nullable(),
      monthToDateSalesGrossAmount: z.string().min(1).max(64).nullable(),
      monthToDatePurchasesGrossAmount: z.string().min(1).max(64).nullable(),
      purchaseToSalesPercent: z.string().min(1).max(32).nullable(),
    }).strict().optional(),
  }).strict(),
  companies: z.array(ownerDailyBriefCompanySchema).max(1_000),
  marketing: z.object({
    activeCampaignCount: z.number().int().nonnegative(),
    plannedCostAmount: ownerDailyBriefAmountSchema.nullable(),
    linkedPostedSpendMonthToDate: ownerDailyBriefAmountSchema.nullable(),
    display: z.object({
      plannedCostAmount: z.string().min(1).max(64).nullable(),
      linkedPostedSpendMonthToDate: z.string().min(1).max(64).nullable(),
    }).strict().optional(),
    googleAdsConnectionCounts: z.object({
      notConnected: z.number().int().nonnegative(),
      setupRequested: z.number().int().nonnegative(),
      authorizing: z.number().int().nonnegative(),
      blocked: z.number().int().nonnegative(),
    }).strict(),
    analysisBoundary: z.literal("DESCRIPTIVE_INTERNAL_CAMPAIGN_DATA_ONLY_NOT_ROI_OR_CAUSATION"),
  }).strict(),
  inboundEmail: z.object({
    readiness: z.enum(["NOT_CONFIGURED", "RULES_CONFIGURED_NO_MAILBOX_CONNECTED"]),
    labelCount: z.number().int().nonnegative(),
    enabledRuleCount: z.number().int().nonnegative(),
    importedMessageCount: z.literal(0),
    note: z.literal("No mailbox connector or imported email messages are available in this release."),
  }).strict(),
}).strict();

export const ownerDailyBriefHistoryReceiptSchema = z.object({
  reports: z.array(ownerDailyBriefReceiptSchema).max(180),
}).strict();

export type OwnerDailyBriefQuery = z.infer<typeof ownerDailyBriefQuerySchema>;
export type OwnerDailyBriefReceipt = z.infer<typeof ownerDailyBriefReceiptSchema>;
export type OwnerDailyBriefHistoryQuery = z.infer<typeof ownerDailyBriefHistoryQuerySchema>;
