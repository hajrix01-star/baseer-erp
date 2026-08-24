import { z } from "zod";

import { companyIdSchema } from "./identity.js";

const ownerDailyBriefAmountSchema = z.string().regex(/^\d{1,14}(?:\.\d{1,4})?$/);
const ownerDailyBriefDateSchema = z.string().date();
const ownerDailyBriefCurrencySchema = z.string().regex(/^[A-Z]{3}$/);

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
    yesterdayClosingCount: z.number().int().nonnegative(),
    monthToDateClosingCount: z.number().int().nonnegative(),
    yesterdayStatus: z.enum(["READY", "INCOMPLETE", "NO_DATA"]),
    monthToDateStatus: z.enum(["READY", "INCOMPLETE", "NO_DATA"]),
    eligibleMonthToDateDayCount: z.number().int().nonnegative(),
    incompleteMonthToDateDayCount: z.number().int().nonnegative(),
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
  }).strict(),
  companies: z.array(ownerDailyBriefCompanySchema).max(1_000),
  marketing: z.object({
    activeCampaignCount: z.number().int().nonnegative(),
    plannedCostAmount: ownerDailyBriefAmountSchema.nullable(),
    linkedPostedSpendMonthToDate: ownerDailyBriefAmountSchema.nullable(),
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
