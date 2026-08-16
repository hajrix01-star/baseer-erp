import { z } from "zod";

import { companyIdSchema, userIdSchema } from "./identity.js";
import { businessDateSchema } from "./business-date.js";

export const financeSupplierIdSchema = z.string().uuid();
export const idempotencyKeySchema = z.string().trim().min(1).max(255);

export const supplierCopyCandidateSchema = z
  .object({
    sourceCompanyId: companyIdSchema,
    sourceCompanyNameAr: z.string().min(1).max(160),
    sourceSupplierId: financeSupplierIdSchema,
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().max(160).nullable(),
    phone: z.string().max(30).nullable(),
    taxNumber: z.string().max(32).nullable(),
    isTaxRegistered: z.boolean(),
    categoryCode: z.string().max(80).nullable(),
    categoryNameAr: z.string().max(160).nullable(),
  })
  .strict();

export const supplierCopyCandidatesReceiptSchema = z
  .object({
    targetCompanyId: companyIdSchema,
    candidates: z.array(supplierCopyCandidateSchema).max(1_000),
  })
  .strict();

export const copySupplierRequestSchema = z
  .object({
    sourceCompanyId: companyIdSchema,
    sourceSupplierId: financeSupplierIdSchema,
    confirmSameName: z.boolean().default(false),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const supplierCopyReceiptSchema = z
  .object({
    id: financeSupplierIdSchema,
    companyId: companyIdSchema,
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().max(160).nullable(),
    taxNumber: z.string().max(32).nullable(),
    categoryCode: z.string().max(80).nullable(),
    copiedFromCompanyId: companyIdSchema,
    copiedFromSupplierId: financeSupplierIdSchema,
    copiedByUserId: userIdSchema,
    replayed: z.boolean(),
  })
  .strict();

export type SupplierCopyCandidate = z.infer<typeof supplierCopyCandidateSchema>;
export type SupplierCopyCandidatesReceipt = z.infer<
  typeof supplierCopyCandidatesReceiptSchema
>;
export type CopySupplierRequest = z.infer<typeof copySupplierRequestSchema>;
export type SupplierCopyReceipt = z.infer<typeof supplierCopyReceiptSchema>;

const financeDateSchema = businessDateSchema.transform(
  (value) => new Date(`${value}T00:00:00.000Z`),
);
const financeAmountSchema = z
  .string()
  .trim()
  .regex(/^\d+(?:\.\d{1,4})?$/)
  .max(32);

export const createSupplierDueRequestSchema = z
  .object({
    supplierId: financeSupplierIdSchema,
    categoryId: z.string().uuid(),
    sourceDocumentNumber: z.string().trim().min(1).max(160),
    businessDate: financeDateSchema,
    dueDate: financeDateSchema.optional(),
    amount: financeAmountSchema,
    notes: z.string().trim().max(2_000).optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const recordSupplierDuePaymentRequestSchema = z
  .object({
    dueId: z.string().uuid(),
    vaultId: z.string().uuid(),
    businessDate: financeDateSchema,
    amount: financeAmountSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const reverseSupplierDuePaymentRequestSchema = z
  .object({
    paymentId: z.string().uuid(),
    businessDate: financeDateSchema,
    reason: z.string().trim().min(1).max(1_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export type CreateSupplierDueRequest = z.infer<
  typeof createSupplierDueRequestSchema
>;
export type RecordSupplierDuePaymentRequest = z.infer<
  typeof recordSupplierDuePaymentRequestSchema
>;
export type ReverseSupplierDuePaymentRequest = z.infer<
  typeof reverseSupplierDuePaymentRequestSchema
>;
export const standardSupplierKeySchema = z.enum(["SAUDI_ENERGY", "STC", "GOSI", "ZATCA", "MINISTRY_OF_COMMERCE", "SAUDI_BUSINESS_CENTER", "MUNICIPALITIES_HOUSING", "HRSD", "PASSPORTS", "CIVIL_DEFENSE", "SAUDI_CHAMBERS", "QIWA", "ABSHER_BUSINESS", "MUDAD", "MUQEEM", "BALADY"]);
export const companyFinanceSetupRequestSchema = z
  .object({
    fiscalPeriodNameAr: z.string().trim().min(1).max(160),
    fiscalPeriodNameEn: z.string().trim().min(1).max(160),
    fiscalPeriodStartDate: financeDateSchema,
    fiscalPeriodEndDate: financeDateSchema,
    selectedVaults: z
      .array(z.enum(["CASH", "BANK", "HUNGERSTATION", "JAHEZ", "KEETA"]))
      .min(1)
      .max(5),
    selectedStandardSupplierKeys: z.array(standardSupplierKeySchema).max(16).default([]),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const companyFinanceSetupReceiptSchema = z
  .object({
    periodId: z.string().uuid(),
    vaultIds: z.array(z.string().uuid()).min(1).max(5),
    supplierIds: z.array(z.string().uuid()).max(16),
  })
  .strict();
export const financeFoundationRefreshReceiptSchema = z
  .object({ initialized: z.boolean(), accountCount: z.number().int().nonnegative(), categoryCount: z.number().int().nonnegative(), baseSeedVersion: z.number().int().positive() })
  .strict();
export type CompanyFinanceSetupRequest = z.infer<
  typeof companyFinanceSetupRequestSchema
>;
export const createOpeningInclusiveLoanRequestSchema = z
  .object({
    sourceDocumentNumber: z.string().trim().min(1).max(160),
    originalAmount: financeAmountSchema,
    openingOutstandingAmount: financeAmountSchema,
    installmentAmount: financeAmountSchema,
    termMonths: z.number().int().min(1).max(600),
    firstInstallmentDueDate: financeDateSchema,
    openingBusinessDate: financeDateSchema,
    notes: z.string().trim().max(2_000).optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const recordInclusiveLoanRepaymentRequestSchema = z
  .object({
    loanId: z.string().uuid(),
    vaultId: z.string().uuid(),
    businessDate: financeDateSchema,
    amount: financeAmountSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const reverseInclusiveLoanRepaymentRequestSchema = z
  .object({
    paymentId: z.string().uuid(),
    businessDate: financeDateSchema,
    reason: z.string().trim().min(1).max(1_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const createVaultRequestSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(160),
    nameEn: z.string().trim().min(1).max(160),
    type: z.enum(["CASH", "BANK", "APP"]),
    isSalesChannel: z.boolean().optional(),
    isPaymentDestination: z.boolean().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const removeVaultRequestSchema = z
  .object({ vaultId: z.string().uuid(), idempotencyKey: idempotencyKeySchema })
  .strict();
const financeCategoryKindSchema = z.enum(["PURCHASE", "EXPENSE", "SALE"]);

export const createFinanceCategoryRequestSchema = z
  .object({
    code: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9_-]+$/),
    nameAr: z.string().trim().min(1).max(160),
    nameEn: z.string().trim().min(1).max(160),
    kind: financeCategoryKindSchema,
    parentId: z.string().uuid().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const archiveFinanceCategoryRequestSchema = z
  .object({ categoryId: z.string().uuid(), idempotencyKey: idempotencyKeySchema })
  .strict();

export const createFinanceSupplierRequestSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(160),
    nameEn: z.string().trim().max(160).optional(),
    phone: z.string().trim().max(30).optional(),
    taxNumber: z.string().trim().max(32).optional(),
    isTaxRegistered: z.boolean().default(false),
    categoryId: z.string().uuid().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const updateFinanceSupplierRequestSchema = z
  .object({
    supplierId: financeSupplierIdSchema,
    nameAr: z.string().trim().min(1).max(160),
    nameEn: z.string().trim().max(160).optional(),
    phone: z.string().trim().max(30).optional(),
    taxNumber: z.string().trim().max(32).optional(),
    isTaxRegistered: z.boolean(),
    categoryId: z.string().uuid().nullable().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const archiveFinanceSupplierRequestSchema = z
  .object({ supplierId: financeSupplierIdSchema, idempotencyKey: idempotencyKeySchema })
  .strict();

export const financeMasterDataEntityReceiptSchema = z
  .object({ id: z.string().uuid(), status: z.enum(["ACTIVE", "ARCHIVED"]), replayed: z.boolean() })
  .strict();
export const financePeriodActionRequestSchema = z
  .object({
    periodId: z.string().uuid(),
    reason: z.string().trim().min(1).max(500).optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const supplierDueCashProjectionQuerySchema = z
  .object({
    fromBusinessDate: businessDateSchema
      .optional()
      .transform((value) =>
        value ? new Date(`${value}T00:00:00.000Z`) : undefined,
      ),
    toBusinessDate: businessDateSchema
      .optional()
      .transform((value) =>
        value ? new Date(`${value}T00:00:00.000Z`) : undefined,
      ),
    vaultId: z.string().uuid().optional(),
  })
  .strict();
export const supplierDueCashProjectionItemSchema = z
  .object({
    paymentId: z.string().uuid(),
    dueId: z.string().uuid(),
    journalEntryId: z.string().uuid(),
    businessDate: z.date(),
    amount: financeAmountSchema,
    vaultId: z.string().uuid(),
    categoryCode: z.string().min(1).max(80),
    categoryNameAr: z.string().min(1).max(160),
    categoryKind: z.enum(["PURCHASE", "EXPENSE"]),
  })
  .strict();
export const supplierDueCashProjectionReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    payments: z.array(supplierDueCashProjectionItemSchema).max(10_000),
  })
  .strict();
export const financeVaultCreateReceiptSchema = z
  .object({ vaultId: z.string().uuid() })
  .strict();
export const financeVaultRemoveReceiptSchema = z
  .object({ result: z.enum(["deleted", "archived"]) })
  .strict();
export const financePeriodActionReceiptSchema = z
  .object({
    periodId: z.string().uuid(),
    status: z.enum(["OPEN", "CLOSED", "LOCKED"]),
  })
  .strict();
const financeDueStatusSchema = z.enum([
  "OPEN",
  "PARTIALLY_PAID",
  "PAID",
  "CANCELLED",
]);
export const supplierDueReceiptSchema = z
  .object({
    dueId: z.string().uuid(),
    journalEntryId: z.string().uuid(),
    supplierId: z.string().uuid(),
    categoryId: z.string().uuid(),
    sourceDocumentNumber: z.string().min(1).max(160),
    originalAmount: financeAmountSchema,
    remainingAmount: financeAmountSchema,
    status: financeDueStatusSchema,
  })
  .strict();
export const supplierDuePaymentReceiptSchema = z
  .object({
    paymentId: z.string().uuid(),
    dueId: z.string().uuid(),
    journalEntryId: z.string().uuid(),
    vaultId: z.string().uuid(),
    amount: financeAmountSchema,
    remainingAmount: financeAmountSchema,
    status: financeDueStatusSchema,
  })
  .strict();
export const supplierDuePaymentReversalReceiptSchema = z
  .object({
    reversalPaymentId: z.string().uuid(),
    originalPaymentId: z.string().uuid(),
    dueId: z.string().uuid(),
    journalEntryId: z.string().uuid(),
    remainingAmount: financeAmountSchema,
    status: financeDueStatusSchema,
  })
  .strict();
export const inclusiveLoanOpeningReceiptSchema = z
  .object({
    loanId: z.string().uuid(),
    journalEntryId: z.string().uuid(),
    originalAmount: financeAmountSchema,
    openingOutstandingAmount: financeAmountSchema,
    installmentAmount: financeAmountSchema,
    termMonths: z.number().int().min(1).max(600),
  })
  .strict();
export const inclusiveLoanRepaymentReceiptSchema = z
  .object({
    paymentId: z.string().uuid(),
    loanId: z.string().uuid(),
    journalEntryId: z.string().uuid(),
    amount: financeAmountSchema,
    remainingAmount: financeAmountSchema,
    status: z.enum(["ACTIVE", "SETTLED", "ARCHIVED"]),
  })
  .strict();
export const supplierDueHistoryQuerySchema = z
  .object({
    supplierId: z.string().uuid().optional(),
    status: financeDueStatusSchema.optional(),
  })
  .strict();
export const supplierDueHistoryPaymentSchema = z
  .object({
    id: z.string().uuid(),
    vaultId: z.string().uuid(),
    businessDate: z.date(),
    amount: financeAmountSchema,
    status: z.enum(["POSTED", "REVERSED"]),
    journalEntryId: z.string().uuid().nullable(),
  })
  .strict();
export const supplierDueHistoryItemSchema = z
  .object({
    id: z.string().uuid(),
    supplierId: z.string().uuid(),
    supplierNameAr: z.string().min(1).max(160),
    supplierNameEn: z.string().max(160).nullable(),
    categoryId: z.string().uuid(),
    categoryCode: z.string().min(1).max(80),
    categoryNameAr: z.string().min(1).max(160),
    sourceDocumentNumber: z.string().min(1).max(160),
    originalBusinessDate: z.date(),
    dueDate: z.date().nullable(),
    originalAmount: financeAmountSchema,
    paidAmount: financeAmountSchema,
    remainingAmount: financeAmountSchema,
    status: financeDueStatusSchema,
    payments: z.array(supplierDueHistoryPaymentSchema).max(10_000),
  })
  .strict();
export const supplierDueHistoryReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    dues: z.array(supplierDueHistoryItemSchema).max(10_000),
  })
  .strict();

const financeConfigurationProfileSchema = z
  .object({
    // Mirrors CompanyFinanceProfile.baseSeedVersion (Prisma Int), not a label.
    baseSeedVersion: z.number().int().positive(),
    accountingMode: z.string().min(1).max(80),
    vatAccountingEnabled: z.boolean(),
    initializedAt: z.date(),
  })
  .strict();
const financeConfigurationPeriodSchema = z
  .object({
    id: z.string().uuid(),
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().min(1).max(160),
    startDate: z.date(),
    endDate: z.date(),
    status: z.enum(["OPEN", "CLOSED", "LOCKED"]),
    closeReason: z.string().max(500).nullable(),
  })
  .strict();
const financeConfigurationVaultSchema = z
  .object({
    id: z.string().uuid(),
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().min(1).max(160),
    type: z.string().min(1).max(40),
    status: z.string().min(1).max(40),
    isSalesChannel: z.boolean(),
    isPaymentDestination: z.boolean(),
    account: z
      .object({
        id: z.string().uuid(),
        code: z.string().min(1).max(80),
        nameAr: z.string().min(1).max(160),
        nameEn: z.string().min(1).max(160),
        status: z.string().min(1).max(40),
      })
      .strict(),
  })
  .strict();
const financeConfigurationAccountSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string().min(1).max(80),
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().min(1).max(160),
    type: z.string().min(1).max(40),
    status: z.string().min(1).max(40),
    isSystem: z.boolean(),
    systemKey: z.string().max(80).nullable(),
  })
  .strict();
const financeConfigurationCategorySchema = z
  .object({
    id: z.string().uuid(),
    code: z.string().min(1).max(80),
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().min(1).max(160),
    kind: z.string().min(1).max(40),
    status: z.string().min(1).max(40),
    accountId: z.string().uuid().nullable(),
  })
  .strict();
const financeConfigurationSupplierSchema = z
  .object({
    id: z.string().uuid(),
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().max(160).nullable(),
    phone: z.string().max(30).nullable(),
    taxNumber: z.string().max(32).nullable(),
    isTaxRegistered: z.boolean(),
    status: z.string().min(1).max(40),
    categoryId: z.string().uuid().nullable(),
  })
  .strict();
export const financeConfigurationReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    profile: financeConfigurationProfileSchema.nullable(),
    periods: z.array(financeConfigurationPeriodSchema).max(120),
    vaults: z.array(financeConfigurationVaultSchema).max(100),
    accounts: z.array(financeConfigurationAccountSchema).max(500),
    categories: z.array(financeConfigurationCategorySchema).max(500),
    suppliers: z.array(financeConfigurationSupplierSchema).max(1_000),
  })
  .strict();

const dailySalesScopeSchema = z.enum(["MORNING", "EVENING", "ALL"]);
const operationalDayStatusSchema = z.enum(["OPEN", "CLOSED", "PARTIAL"]);
const operationalDaySourceSchema = z.enum(["MANUAL", "HOLIDAY", "MIGRATION"]);
const dailySalesClosingStatusSchema = z.enum(["POSTED", "REVERSED"]);
const dailySalesDataStatusSchema = z.enum(["RECORDED", "PENDING", "CLOSED"]);

const dailySalesAllocationRequestSchema = z
  .object({
    vaultId: z.string().uuid(),
    grossAmount: financeAmountSchema,
  })
  .strict();

const dailySalesClosingFieldsSchema = z
  .object({
    businessDate: financeDateSchema,
    scope: dailySalesScopeSchema,
    customerCount: z.number().int().min(0).max(10_000_000).default(0),
    allocations: z.array(dailySalesAllocationRequestSchema).min(1).max(25),
    cashHandoverAmount: financeAmountSchema.optional(),
    notes: z.string().trim().max(2_000).optional(),
  })
  .strict();

export const previewDailySalesClosingRequestSchema =
  dailySalesClosingFieldsSchema.strict();

export const createDailySalesClosingRequestSchema =
  dailySalesClosingFieldsSchema
    .extend({ idempotencyKey: idempotencyKeySchema })
    .strict();

const dailySalesBatchEntrySchema = dailySalesClosingFieldsSchema
  .omit({ businessDate: true })
  .strict();

export const createDailySalesClosingBatchRequestSchema = z
  .object({
    businessDate: financeDateSchema,
    entries: z.array(dailySalesBatchEntrySchema).min(1).max(2),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    const scopes = value.entries.map((entry) => entry.scope);
    if (new Set(scopes).size !== scopes.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Duplicate daily-sales scope.",
      });
    }
    if (scopes.includes("ALL") && scopes.length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "A full-day summary cannot be combined with shifts.",
      });
    }
    if (
      scopes.length === 2 &&
      !(scopes.includes("MORNING") && scopes.includes("EVENING"))
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only morning and evening may be saved together.",
      });
    }
  });
export const correctDailySalesClosingRequestSchema =
  dailySalesClosingFieldsSchema
    .omit({ businessDate: true, scope: true })
    .extend({
      closingId: z.string().uuid(),
      idempotencyKey: idempotencyKeySchema,
    })
    .strict();

export const reverseDailySalesClosingRequestSchema = z
  .object({
    closingId: z.string().uuid(),
    businessDate: financeDateSchema,
    reason: z.string().trim().min(1).max(1_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const setOperationalDayRequestSchema = z
  .object({
    businessDate: financeDateSchema,
    status: operationalDayStatusSchema,
    source: operationalDaySourceSchema.optional(),
    note: z.string().trim().max(1_000).optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

const businessMonthsQuerySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-(0[1-9]|1[0-2])(,\d{4}-(0[1-9]|1[0-2]))*$/)
  .max(95)
  .optional()
  .transform((value) => (value ? [...new Set(value.split(","))].sort() : []));

export const dailySalesCalendarQuerySchema = z
  .object({
    fromBusinessDate: businessDateSchema.transform(
      (value) => new Date(`${value}T00:00:00.000Z`),
    ),
    toBusinessDate: businessDateSchema.transform(
      (value) => new Date(`${value}T00:00:00.000Z`),
    ),
    businessMonths: businessMonthsQuerySchema,
  })
  .strict();
export const dailySalesClosingsQuerySchema = dailySalesCalendarQuerySchema;

const dailySalesAllocationReceiptSchema = z
  .object({ vaultId: z.string().uuid(), grossAmount: financeAmountSchema })
  .strict();

export const dailySalesClosingReceiptSchema = z
  .object({
    closingId: z.string().uuid(),
    documentNumber: z.string().min(1).max(160),
    businessDate: z.date(),
    scope: dailySalesScopeSchema,
    postingVersion: z.number().int().min(1),
    journalEntryId: z.string().uuid(),
    grossAmount: financeAmountSchema,
    netAmount: financeAmountSchema,
    vatAmount: financeAmountSchema,
    vatRateBasisPoints: z.number().int().min(0).max(10_000),
    customerCount: z.number().int().min(0),
    cashHandoverAmount: financeAmountSchema.nullable(),
    cashHandoverVaultId: z.string().uuid().nullable(),
    status: dailySalesClosingStatusSchema,
    allocations: z.array(dailySalesAllocationReceiptSchema).min(1).max(25),
  })
  .strict();

export const dailySalesClosingBatchReceiptSchema = z
  .object({ closings: z.array(dailySalesClosingReceiptSchema).min(1).max(2) })
  .strict();
export const dailySalesClosingPreviewReceiptSchema = z
  .object({
    grossAmount: financeAmountSchema,
    netAmount: financeAmountSchema,
    vatAmount: financeAmountSchema,
    vatRateBasisPoints: z.number().int().min(0).max(10_000),
  })
  .strict();
export const dailySalesClosingReversalReceiptSchema = z
  .object({
    closingId: z.string().uuid(),
    documentNumber: z.string().min(1).max(160),
    originalJournalEntryId: z.string().uuid(),
    reversalJournalEntryId: z.string().uuid(),
    status: z.literal("REVERSED"),
  })
  .strict();

export const operationalDayReceiptSchema = z
  .object({
    businessDate: z.date(),
    status: operationalDayStatusSchema,
    source: operationalDaySourceSchema,
    dataStatus: dailySalesDataStatusSchema,
  })
  .strict();

export const dailySalesCalendarItemSchema = z
  .object({
    businessDate: z.date(),
    operationalStatus: operationalDayStatusSchema,
    dataStatus: dailySalesDataStatusSchema,
    source: operationalDaySourceSchema.nullable(),
    hasActiveClosing: z.boolean(),
    salesGrossAmount: financeAmountSchema,
    customerCount: z.number().int().min(0),
  })
  .strict();

export const dailySalesCalendarReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    fromBusinessDate: z.date(),
    toBusinessDate: z.date(),
    days: z.array(dailySalesCalendarItemSchema).max(400),
  })
  .strict();

export const dailySalesChannelVaultSchema = z
  .object({
    id: z.string().uuid(),
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().min(1).max(160),
    type: z.enum(["CASH", "BANK", "APP"]),
    isSalesChannel: z.boolean(),
  })
  .strict();

export const dailySalesChannelVaultsReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    vaults: z.array(dailySalesChannelVaultSchema).max(100),
  })
  .strict();

export const dailySalesEntryDateReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    businessDate: businessDateSchema,
    timezone: z.literal("Asia/Riyadh"),
  })
  .strict();

export const dailySalesClosingHistoryItemSchema = dailySalesClosingReceiptSchema
  .extend({ notes: z.string().nullable() })
  .strict();

export const dailySalesClosingsReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    fromBusinessDate: z.date(),
    toBusinessDate: z.date(),
    historyLimit: z.number().int().min(1).max(400),
    closings: z.array(dailySalesClosingHistoryItemSchema).max(400),
  })
  .strict();

export const dailySalesCashHandoverItemSchema = z
  .object({
    closingId: z.string().uuid(),
    documentNumber: z.string().min(1).max(160),
    businessDate: z.date(),
    scope: dailySalesScopeSchema,
    cashHandoverAmount: financeAmountSchema,
    cashHandoverVaultId: z.string().uuid().nullable(),
    notes: z.string().nullable(),
  })
  .strict();

export const dailySalesCashHandoversReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    fromBusinessDate: z.date(),
    toBusinessDate: z.date(),
    totalCashHandoverAmount: financeAmountSchema,
    recordCount: z.number().int().min(0),
    hasMore: z.boolean(),
    handovers: z.array(dailySalesCashHandoverItemSchema).max(400),
  })
  .strict();

export const dailySalesShiftSummaryItemSchema = z
  .object({
    scope: dailySalesScopeSchema,
    closingCount: z.number().int().min(0),
    grossAmount: financeAmountSchema,
    customerCount: z.number().int().min(0),
    averageOrderAmount: financeAmountSchema.nullable(),
  })
  .strict();

export const dailySalesShiftSummaryReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    fromBusinessDate: z.date(),
    toBusinessDate: z.date(),
    shifts: z.array(dailySalesShiftSummaryItemSchema).length(3),
  })
  .strict();
/**
 * One bounded read-model for the native Daily Sales workspace. It prevents
 * the screen from fanning out into several independently-authorized HTTP
 * reads, while preserving the smaller endpoints for focused consumers.
 */
export const dailySalesWorkspaceReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    fromBusinessDate: z.date(),
    toBusinessDate: z.date(),
    permissionCodes: z.array(z.string().min(3).max(120)).max(250),
    entryDate: dailySalesEntryDateReceiptSchema.omit({ companyId: true }),
    vaults: z.array(dailySalesChannelVaultSchema).max(100),
    historyLimit: z.number().int().min(1).max(400),
    closings: z.array(dailySalesClosingHistoryItemSchema).max(400),
    cashHandovers: dailySalesCashHandoversReceiptSchema.omit({
      companyId: true,
      fromBusinessDate: true,
      toBusinessDate: true,
    }),
    shifts: z.array(dailySalesShiftSummaryItemSchema).max(3),
  })
  .strict();
export type CreateDailySalesClosingRequest = z.infer<
  typeof createDailySalesClosingRequestSchema
>;
export type CorrectDailySalesClosingRequest = z.infer<
  typeof correctDailySalesClosingRequestSchema
>;
export type ReverseDailySalesClosingRequest = z.infer<
  typeof reverseDailySalesClosingRequestSchema
>;
export type SetOperationalDayRequest = z.infer<
  typeof setOperationalDayRequestSchema
>;

const financeOutflowKindSchema = z.enum(["PURCHASE", "EXPENSE"]);
const financeOutflowSettlementSchema = z.enum(["PAID", "PAYABLE"]);
const financeOutflowStatusSchema = z.enum(["POSTED", "CANCELLED"]);

export const financeOutflowAllocationSchema = z.object({
  vaultId: z.string().uuid(),
  grossAmount: financeAmountSchema,
}).strict();

export const createFinanceOutflowDocumentRequestSchema = z.object({
  kind: financeOutflowKindSchema,
  settlementKind: financeOutflowSettlementSchema,
  categoryId: z.string().uuid(),
  supplierId: financeSupplierIdSchema.optional(),
  supplierInvoiceNumber: z.string().trim().min(1).max(160).optional(),
  supplierInvoiceMissingReason: z.string().trim().min(1).max(500).optional(),
  businessDate: financeDateSchema,
  supplierInvoiceDate: financeDateSchema.optional(),
  grossAmount: financeAmountSchema,
  isTaxable: z.boolean().default(false),
  allocations: z.array(financeOutflowAllocationSchema).max(20).default([]),
  notes: z.string().trim().max(2_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const financeOutflowDocumentReceiptSchema = z.object({
  documentId: z.string().uuid(),
  documentNumber: z.string().min(1).max(80),
  journalEntryId: z.string().uuid(),
  kind: financeOutflowKindSchema,
  settlementKind: financeOutflowSettlementSchema,
  status: financeOutflowStatusSchema,
  grossAmount: financeAmountSchema,
  netAmount: financeAmountSchema,
  vatAmount: financeAmountSchema,
  supplierDueId: z.string().uuid().nullable(),
}).strict();

export type CreateFinanceOutflowDocumentRequest = z.infer<typeof createFinanceOutflowDocumentRequestSchema>;

export const financeOutflowDocumentHistoryItemSchema = z.object({
  id: z.string().uuid(),
  documentNumber: z.string().min(1).max(80),
  kind: financeOutflowKindSchema,
  settlementKind: financeOutflowSettlementSchema,
  status: financeOutflowStatusSchema,
  businessDate: z.date(),
  grossAmount: financeAmountSchema,
  supplierNameAr: z.string().nullable(),
  categoryNameAr: z.string().min(1).max(160),
}).strict();

export const financeOutflowDocumentsReceiptSchema = z.object({
  companyId: companyIdSchema,
  documents: z.array(financeOutflowDocumentHistoryItemSchema).max(250),
}).strict();
export type FinanceOutflowDocumentReceipt = z.infer<typeof financeOutflowDocumentReceiptSchema>;
export type FinanceOutflowDocumentsReceipt = z.infer<typeof financeOutflowDocumentsReceiptSchema>;