import { z } from "zod";

import { companyIdSchema } from "./identity.js";

const dateSchema = z.string().date();
const currencySchema = z.string().regex(/^[A-Z]{3}$/);
const signedAmountSchema = z.string().regex(/^-?\d{1,14}(?:\.\d{1,4})?$/);
const percentSchema = z.string().regex(/^\d{1,5}(?:\.\d{1,4})?$/);
const financialMovementContractSchema = z.object({
  amountBasis: z.literal("GROSS_VAT_INCLUSIVE_CASH_MOVEMENT"),
  dataAuthority: z.literal("BACKEND_SEALED_JOURNAL_VAULT_LINES"),
  dataQuality: z.literal("SEALED_POSTED_OR_REVERSED_ONLY"),
}).strict();

export const ownerFinancialMovementRowCodeSchema = z.enum([
  "SALES",
  "PURCHASES",
  "EXPENSES",
  "RECURRING_EXPENSES",
  "EMPLOYEE_PAYMENTS",
  "VAT",
  "TOTAL",
]);

/** Owner-only month-to-date cash movement. Each company remains in its own
 * functional currency; the receipt deliberately never consolidates FX. */
export const ownerFinancialMovementDashboardReceiptSchema = z.object({
  generatedAt: z.string().datetime(),
  timezone: z.literal("Asia/Riyadh"),
  period: z.object({
    fromBusinessDate: dateSchema,
    toBusinessDate: dateSchema,
  }).strict(),
  financialContract: financialMovementContractSchema,
  companies: z.array(z.object({
    companyId: companyIdSchema,
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().min(1).max(160),
    currencyCode: currencySchema.nullable(),
    rows: z.array(z.object({
      code: ownerFinancialMovementRowCodeSchema,
      amount: signedAmountSchema,
      /** Final, backend-owned display text. Browsers must not parse financial decimals. */
      amountDisplay: z.string().min(1).max(64),
      direction: z.enum(["INFLOW", "OUTFLOW", "NEUTRAL"]),
      percentOfSales: percentSchema.nullable(),
      percentOfSalesDisplay: z.string().min(1).max(32).nullable(),
    }).strict()).length(7),
  }).strict()).max(1_000),
}).strict();

export type OwnerFinancialMovementDashboardReceipt = z.infer<typeof ownerFinancialMovementDashboardReceiptSchema>;
