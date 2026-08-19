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
export const standardSupplierKeySchema = z.enum(["SAUDI_ENERGY", "STC", "MOBILY", "ZAIN_SAUDI", "SALAM", "GO_TELECOM", "NATIONAL_WATER_COMPANY", "GOSI", "ZATCA", "MINISTRY_OF_COMMERCE", "SAUDI_BUSINESS_CENTER", "MUNICIPALITIES_HOUSING", "HRSD", "PASSPORTS", "CIVIL_DEFENSE", "SAUDI_CHAMBERS", "QIWA", "ABSHER_BUSINESS", "MUDAD", "MUQEEM", "BALADY", "AJEER", "MUSANED", "WAFID", "MINISTRY_OF_FOREIGN_AFFAIRS", "SAUDI_POST_SPL"]);
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
    selectedStandardSupplierKeys: z.array(standardSupplierKeySchema).max(32).default([]),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const companyFinanceSetupReceiptSchema = z
  .object({
    periodId: z.string().uuid(),
    vaultIds: z.array(z.string().uuid()).min(1).max(5),
    supplierIds: z.array(z.string().uuid()).max(32),
  })
  .strict();
export const standardSupplierSyncRequestSchema = z.object({ selectedStandardSupplierKeys: z.array(standardSupplierKeySchema).min(1).max(32), idempotencyKey: idempotencyKeySchema }).strict();
export const standardSupplierSyncReceiptSchema = z.object({ supplierIds: z.array(z.string().uuid()).min(1).max(32), taxNumbersUpdated: z.number().int().nonnegative() }).strict();
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
export const inclusiveLoanRecordSchema = z
  .object({
    id: z.string().uuid(),
    sourceDocumentNumber: z.string(),
    originalAmount: z.string(),
    openingOutstandingAmount: z.string(),
    paidAmount: z.string(),
    remainingAmount: z.string(),
    installmentAmount: z.string(),
    termMonths: z.number().int().positive(),
    firstInstallmentDueDate: financeDateSchema,
    openingBusinessDate: financeDateSchema,
    status: z.enum(["ACTIVE", "SETTLED"]),
    notes: z.string().nullable(),
  })
  .strict();

export const inclusiveLoansReceiptSchema = z
  .object({ companyId: z.string().uuid(), loans: z.array(inclusiveLoanRecordSchema) })
  .strict();
export const createVaultRequestSchema = z
  .object({
    nameAr: z.string().trim().min(1).max(160),
    nameEn: z.string().trim().min(1).max(160),
    type: z.enum(["CASH", "BANK", "APP"]),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]).optional(),
    paymentMethods: z.array(z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"])).min(1).max(3).optional(),
    isSalesChannel: z.boolean().optional(),
    isPaymentDestination: z.boolean().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const updateVaultRequestSchema = z
  .object({
    vaultId: z.string().uuid(),
    nameAr: z.string().trim().min(1).max(160),
    nameEn: z.string().trim().min(1).max(160),
    type: z.enum(["CASH", "BANK", "APP"]),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]).optional(),
    paymentMethods: z.array(z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"])).min(1).max(3).optional(),
    isSalesChannel: z.boolean(),
    isPaymentDestination: z.boolean(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const reorderVaultsRequestSchema = z
  .object({ vaultIds: z.array(z.string().uuid()).min(1).max(100), idempotencyKey: idempotencyKeySchema })
  .strict();
export const financeVaultOrderReceiptSchema = z
  .object({ vaultIds: z.array(z.string().uuid()).min(1).max(100) })
  .strict();
export const removeVaultRequestSchema = z
  .object({ vaultId: z.string().uuid(), idempotencyKey: idempotencyKeySchema })
  .strict();
export const restoreVaultRequestSchema = z
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
    suggestedSupplierId: z.string().uuid().optional(),
    isPosting: z.boolean().default(true),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const updateFinanceCategoryRequestSchema = z
  .object({
    categoryId: z.string().uuid(),
    code: z.string().trim().min(2).max(80).regex(/^[A-Za-z0-9_-]+$/),
    nameAr: z.string().trim().min(1).max(160),
    nameEn: z.string().trim().min(1).max(160),
    kind: financeCategoryKindSchema,
    parentId: z.string().uuid().optional(),
    suggestedSupplierId: z.string().uuid().optional(),
    isPosting: z.boolean(),
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
    supplierType: z.enum(["PURCHASE", "EXPENSE"]),
    categoryId: z.string().uuid(),
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
    supplierType: z.enum(["PURCHASE", "EXPENSE"]),
    categoryId: z.string().uuid(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const archiveFinanceSupplierRequestSchema = z
  .object({ supplierId: financeSupplierIdSchema, idempotencyKey: idempotencyKeySchema })
  .strict();

export const setFinanceSupplierFavoriteRequestSchema = z
  .object({ supplierId: financeSupplierIdSchema, isFavorite: z.boolean(), idempotencyKey: idempotencyKeySchema })
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
    cursor: z.string().uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
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
    recognizedNetAmount: financeAmountSchema,
    categoryCode: z.string().min(1).max(80),
    categoryNameAr: z.string().min(1).max(160),
    categoryKind: z.enum(["PURCHASE", "EXPENSE"]),
  })
  .strict();
export const supplierDueCashProjectionReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    payments: z.array(supplierDueCashProjectionItemSchema).max(100),
    hasMore: z.boolean(),
    nextCursor: z.string().uuid().nullable(),
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
    cursor: z.string().uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
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
    paymentCount: z.number().int().nonnegative(),
  })
  .strict();
export const supplierDueHistoryReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    dues: z.array(supplierDueHistoryItemSchema).max(100),
    hasMore: z.boolean(),
    nextCursor: z.string().uuid().nullable(),
  })
  .strict();

export const supplierDuePaymentHistoryQuerySchema = z
  .object({
    cursor: z.string().uuid().optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
  })
  .strict();
export const supplierDuePaymentHistoryReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    dueId: z.string().uuid(),
    payments: z.array(supplierDueHistoryPaymentSchema).max(100),
    hasMore: z.boolean(),
    nextCursor: z.string().uuid().nullable(),
  })
  .strict();

const financeConfigurationProfileSchema = z
  .object({
    // Mirrors CompanyFinanceProfile.baseSeedVersion (Prisma Int), not a label.
    baseSeedVersion: z.number().int().positive(),
    accountingMode: z.string().min(1).max(80),
    vatAccountingEnabled: z.boolean(),
    vatRateBasisPoints: z.number().int().min(0).max(10_000),
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
    paymentMethod: z.string().min(1).max(40),
    paymentMethods: z.array(z.string().min(1).max(40)).min(1).max(3),
    status: z.string().min(1).max(40),
    isSalesChannel: z.boolean(),
    isPaymentDestination: z.boolean(),
    sortOrder: z.number().int().min(0).max(10_000),
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
    parentId: z.string().uuid().nullable(),
    suggestedSupplierId: z.string().uuid().nullable(),
    isPosting: z.boolean(),
  })
  .strict();
const financeConfigurationStandardSupplierSchema = z
  .object({ key: standardSupplierKeySchema, nameAr: z.string().min(1).max(160), nameEn: z.string().min(1).max(160) })
  .strict();

const financeConfigurationSupplierSchema = z
  .object({
    id: z.string().uuid(),
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().max(160).nullable(),
    phone: z.string().max(30).nullable(),
    taxNumber: z.string().max(32).nullable(),
    isTaxRegistered: z.boolean(),
    isFavorite: z.boolean(),
    supplierType: z.enum(["PURCHASE", "EXPENSE"]),
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
    standardSuppliers: z.array(financeConfigurationStandardSupplierSchema).max(32),
  })
  .strict();

/** Bounded server search used by long reference lists; results are never a financial aggregate. */
export const financeReferenceSearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(160).optional(),
    kind: z.enum(["PURCHASE", "EXPENSE", "SALE"]).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
  })
  .strict();
export const financeSupplierReferenceOptionSchema = z
  .object({
    id: z.string().uuid(),
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().max(160).nullable(),
    categoryId: z.string().uuid().nullable(),
    supplierType: z.enum(["PURCHASE", "EXPENSE"]),
    isFavorite: z.boolean(),
  })
  .strict();
export const financeSupplierReferenceSearchReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    suppliers: z.array(financeSupplierReferenceOptionSchema).max(100),
  })
  .strict();
export const financeCategoryReferenceOptionSchema = z
  .object({
    id: z.string().uuid(),
    code: z.string().min(1).max(80),
    nameAr: z.string().min(1).max(160),
    nameEn: z.string().max(160).nullable(),
    kind: z.enum(["PURCHASE", "EXPENSE", "SALE"]),
  })
  .strict();
export const financeCategoryReferenceSearchReceiptSchema = z
  .object({
    companyId: companyIdSchema,
    categories: z.array(financeCategoryReferenceOptionSchema).max(100),
  })
  .strict();

/** The company rate is authoritative for future documents only. Posted documents retain their own rate snapshot. */
export const updateCompanyVatRateRequestSchema = z.object({
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
  idempotencyKey: idempotencyKeySchema,
}).strict();
export const updateCompanyVatRateReceiptSchema = z.object({
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
  vatAccountingEnabled: z.literal(true),
}).strict();

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
  .max(959)
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
export const dailySalesClosingsQuerySchema = dailySalesCalendarQuerySchema.extend({
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
}).strict();

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
  sortOrder: z.number().int().min(0).max(10_000),
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
    historyLimit: z.number().int().min(1).max(100),
    closings: z.array(dailySalesClosingHistoryItemSchema).max(100),
    hasMore: z.boolean(),
    nextCursor: z.string().uuid().nullable(),
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
    historyLimit: z.number().int().min(1).max(100),
    closings: z.array(dailySalesClosingHistoryItemSchema).max(100),
    hasMore: z.boolean(),
    nextCursor: z.string().uuid().nullable(),
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
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]).optional(),
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

export const financeOutflowBatchItemSchema = z.object({
  kind: financeOutflowKindSchema,
  settlementKind: financeOutflowSettlementSchema,
  categoryId: z.string().uuid(),
  supplierId: financeSupplierIdSchema.optional(),
  supplierInvoiceNumber: z.string().trim().min(1).max(160).optional(),
  supplierInvoiceMissingReason: z.string().trim().min(1).max(500).optional(),
  supplierInvoiceDate: financeDateSchema.optional(),
  grossAmount: financeAmountSchema,
  isTaxable: z.boolean().default(false),
  allocations: z.array(financeOutflowAllocationSchema).max(20).default([]),
  notes: z.string().trim().max(2_000).optional(),
}).strict();

export const createFinanceOutflowBatchRequestSchema = z.object({
  businessDate: financeDateSchema,
  notes: z.string().trim().max(2_000).optional(),
  items: z.array(financeOutflowBatchItemSchema).min(1).max(25),
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
export const financeOutflowBatchReceiptSchema = z.object({
  batchId: z.string().uuid(),
  batchNumber: z.string().min(1).max(80),
  businessDate: z.date(),
  documentCount: z.number().int().positive(),
  grossAmount: financeAmountSchema,
  netAmount: financeAmountSchema,
  vatAmount: financeAmountSchema,
  documents: z.array(financeOutflowDocumentReceiptSchema).min(1).max(25),
}).strict();
export type CreateFinanceOutflowBatchRequest = z.infer<typeof createFinanceOutflowBatchRequestSchema>;

export const financeOutflowDocumentHistoryItemSchema = z.object({
  id: z.string().uuid(),
  documentNumber: z.string().min(1).max(80),
  kind: financeOutflowKindSchema,
  settlementKind: financeOutflowSettlementSchema,
  status: financeOutflowStatusSchema,
  businessDate: z.date(),
  grossAmount: financeAmountSchema,
  batchNumber: z.string().min(1).max(80).nullable(),
  supplierNameAr: z.string().nullable(),
  supplierNameEn: z.string().max(160).nullable(),
  categoryNameAr: z.string().min(1).max(160),
  categoryNameEn: z.string().max(160).nullable(),
}).strict();

export const financeCreditDueItemSchema = z.object({
  id: z.string().uuid(), documentNumber: z.string().min(1).max(160), kind: financeOutflowKindSchema, businessDate: z.date(), dueDate: z.date().nullable(), categoryNameAr: z.string().min(1).max(160).nullable(), categoryNameEn: z.string().max(160).nullable(), originalAmount: financeAmountSchema, paidAmount: financeAmountSchema, remainingAmount: financeAmountSchema,
}).strict();
export const financeCreditSupplierGroupSchema = z.object({
  supplierId: z.string().uuid(), supplierNameAr: z.string().min(1).max(160), supplierNameEn: z.string().max(160).nullable(), invoiceCount: z.number().int().positive(), originalAmount: financeAmountSchema, paidAmount: financeAmountSchema, remainingAmount: financeAmountSchema, dues: z.array(financeCreditDueItemSchema).min(1).max(500),
}).strict();
export const financeCreditWorkspaceQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
}).strict();
export const financeCreditWorkspaceReceiptSchema = z.object({
  companyId: companyIdSchema, asOfBusinessDate: businessDateSchema, openSupplierCount: z.number().int().nonnegative(), openInvoiceCount: z.number().int().nonnegative(), originalAmount: financeAmountSchema, paidAmount: financeAmountSchema, remainingAmount: financeAmountSchema, suppliers: z.array(financeCreditSupplierGroupSchema).max(100), hasMore: z.boolean(), nextCursor: z.string().uuid().nullable(),
}).strict();
export const financeOutflowDocumentsReceiptSchema = z.object({
  companyId: companyIdSchema,
  documents: z.array(financeOutflowDocumentHistoryItemSchema).max(100),
  hasMore: z.boolean(),
  nextCursor: z.string().uuid().nullable(),
}).strict();
export const financeOutflowDocumentsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
}).strict();
export type FinanceOutflowDocumentReceipt = z.infer<typeof financeOutflowDocumentReceiptSchema>;
export type FinanceOutflowDocumentsReceipt = z.infer<typeof financeOutflowDocumentsReceiptSchema>;

const recurringIntervalMonthsSchema = z.number().int().refine(
  (value) => [1, 2, 3, 4, 6, 12].includes(value),
  "Recurring interval must divide a calendar year.",
);

export const financeRecurringExpenseProfileSchema = z.object({
  id: z.string().uuid(),
  nameAr: z.string().min(1).max(160),
  nameEn: z.string().min(1).max(160),
  supplierId: z.string().uuid().nullable(),
  supplierNameAr: z.string().nullable(),
  categoryId: z.string().uuid(),
  categoryNameAr: z.string().min(1).max(160),
  serviceNumber: z.string().max(160).nullable(),
  expectedAmount: financeAmountSchema,
  intervalMonths: recurringIntervalMonthsSchema,
  nextReminderDate: financeDateSchema,
  defaultVaultId: z.string().uuid().nullable(),
  allowAmountOverride: z.boolean(),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  notes: z.string().max(2_000).nullable(),
}).strict();

export const financeRecurringExpenseProfilesReceiptSchema = z.object({
  companyId: companyIdSchema,
  profiles: z.array(financeRecurringExpenseProfileSchema).max(500),
}).strict();

export const createFinanceRecurringExpenseProfileRequestSchema = z.object({
  nameAr: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().min(1).max(160).optional(),
  categoryId: z.string().uuid(),
  supplierId: financeSupplierIdSchema.optional(),
  serviceNumber: z.string().trim().min(1).max(160).optional(),
  expectedAmount: financeAmountSchema,
  intervalMonths: recurringIntervalMonthsSchema,
  nextReminderDate: financeDateSchema,
  defaultVaultId: z.string().uuid().optional(),
  allowAmountOverride: z.boolean().default(true),
  notes: z.string().trim().max(2_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const archiveFinanceRecurringExpenseProfileRequestSchema = z.object({
  profileId: z.string().uuid(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const createFinanceRecurringExpensePaymentRequestSchema = z.object({
  profileId: z.string().uuid(),
  businessDate: financeDateSchema,
  coverageYear: z.number().int().min(2000).max(2100),
  coverageStartMonth: z.number().int().min(1).max(12),
  grossAmount: financeAmountSchema,
  isTaxable: z.boolean().default(false),
  // The legacy vaultId is accepted for older clients. New clients send one
  // or more allocations and record the exact payment method on each one.
  vaultId: z.string().uuid().optional(),
  allocations: z.array(financeOutflowAllocationSchema).min(1).max(20).default([]),
  supplierInvoiceNumber: z.string().trim().min(1).max(160).optional(),
  supplierInvoiceMissingReason: z.string().trim().min(1).max(500).optional(),
  supplierInvoiceDate: financeDateSchema.optional(),
  notes: z.string().trim().max(2_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const financeRecurringExpensePaymentReceiptSchema = financeOutflowDocumentReceiptSchema.extend({
  profileId: z.string().uuid(),
  coverageYear: z.number().int().min(2000).max(2100),
  coverageStartMonth: z.number().int().min(1).max(12),
  coverageMonths: z.number().int().min(1).max(12),
}).strict();

// A recurring-payment batch is one atomic command. Each row remains its own
// journal-backed document and coverage reservation, but the batch either posts
// completely or rolls back completely.
export const financeRecurringExpensePaymentBatchItemSchema = createFinanceRecurringExpensePaymentRequestSchema.omit({ businessDate: true, idempotencyKey: true });
export const createFinanceRecurringExpensePaymentBatchRequestSchema = z.object({
  businessDate: financeDateSchema,
  items: z.array(financeRecurringExpensePaymentBatchItemSchema).min(1).max(25),
  idempotencyKey: idempotencyKeySchema,
}).strict();
export const financeRecurringExpensePaymentBatchReceiptSchema = z.object({
  batchId: z.string().uuid(),
  batchNumber: z.string().min(1).max(80),
  businessDate: z.date(),
  documentCount: z.number().int().positive(),
  grossAmount: financeAmountSchema,
  netAmount: financeAmountSchema,
  vatAmount: financeAmountSchema,
  payments: z.array(financeRecurringExpensePaymentReceiptSchema).min(1).max(25),
}).strict();

export type CreateFinanceRecurringExpenseProfileRequest = z.infer<typeof createFinanceRecurringExpenseProfileRequestSchema>;
export type CreateFinanceRecurringExpensePaymentRequest = z.infer<typeof createFinanceRecurringExpensePaymentRequestSchema>;
export type CreateFinanceRecurringExpensePaymentBatchRequest = z.infer<typeof createFinanceRecurringExpensePaymentBatchRequestSchema>;
/** A bounded, server-authorized read model for the Operations expenses and obligations workspace. */
export const expensesObligationsWorkspaceReceiptSchema = z.object({
  companyId: companyIdSchema,
  businessDate: businessDateSchema,
  configuration: financeConfigurationReceiptSchema,
  loans: z.array(inclusiveLoanRecordSchema).max(500),
  recurringProfiles: z.array(financeRecurringExpenseProfileSchema).max(500),
  documents: z.array(financeOutflowDocumentHistoryItemSchema).max(100),
}).strict();
export type ExpensesObligationsWorkspaceReceipt = z.infer<typeof expensesObligationsWorkspaceReceiptSchema>;
export const treasuryTransferRequestSchema = z.object({
  fromVaultId: z.string().uuid(),
  toVaultId: z.string().uuid(),
  amount: financeAmountSchema,
  businessDate: financeDateSchema,
  notes: z.string().trim().max(1_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();
export const treasuryTransferReceiptSchema = z.object({
  transferReference: z.string().uuid(),
  journalEntryId: z.string().uuid(),
  fromVaultId: z.string().uuid(),
  toVaultId: z.string().uuid(),
  amount: financeAmountSchema,
}).strict();
export const treasuryWorkspaceQuerySchema = z.object({
  fromBusinessDate: businessDateSchema.optional(),
  toBusinessDate: businessDateSchema.optional(),
  includeArchived: z.coerce.boolean().optional().default(false),
}).strict();
const treasuryVaultSchema = z.object({
  id: z.string().uuid(),
  nameAr: z.string(),
  nameEn: z.string(),
  type: z.enum(["CASH", "BANK", "APP"]),
  paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]),
  paymentMethods: z.array(z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"])).min(1).max(3),
  status: z.enum(["ACTIVE", "ARCHIVED"]),
  isSalesChannel: z.boolean(),
  isPaymentDestination: z.boolean(),
  sortOrder: z.number().int().min(0).max(10_000),
  balanceAsOf: financeAmountSchema,
  inflow: financeAmountSchema,
  outflow: financeAmountSchema,
}).strict();
const treasuryGroupSchema = z.object({
  key: z.enum(["COLLECTION_CHANNELS", "OTHER_VAULTS", "ARCHIVED"]),
  count: z.number().int().min(0).max(500),
  balanceAsOf: financeAmountSchema,
  inflow: financeAmountSchema,
  outflow: financeAmountSchema,
}).strict();
export const treasuryWorkspaceReceiptSchema = z.object({
  companyId: companyIdSchema,
  businessDate: businessDateSchema,
  asOfBusinessDate: businessDateSchema,
  fromBusinessDate: businessDateSchema.nullable(),
  toBusinessDate: businessDateSchema.nullable(),
  summary: z.object({ balanceAsOf: financeAmountSchema, inflow: financeAmountSchema, outflow: financeAmountSchema, net: financeAmountSchema }).strict(),
  groups: z.array(treasuryGroupSchema).length(3),
  vaults: z.array(treasuryVaultSchema).max(500),
}).strict();
export const treasuryVaultActivityQuerySchema = z.object({
  fromBusinessDate: businessDateSchema.optional(),
  toBusinessDate: businessDateSchema.optional(),
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
}).strict();
export const treasuryVaultActivityReceiptSchema = z.object({
  vault: treasuryVaultSchema,
  asOfBusinessDate: businessDateSchema,
  fromBusinessDate: businessDateSchema.nullable(),
  toBusinessDate: businessDateSchema.nullable(),
  summary: z.object({ balanceAsOf: financeAmountSchema, inflow: financeAmountSchema, outflow: financeAmountSchema, net: financeAmountSchema }).strict(),
  items: z.array(z.object({
    id: z.string().uuid(),
    journalEntryId: z.string().uuid(),
    businessDate: businessDateSchema,
    sourceType: z.string(),
    sourceReference: z.string(),
    description: z.string().nullable(),
    counterpartNameAr: z.string().nullable(),
    counterpartNameEn: z.string().nullable(),
    inflow: financeAmountSchema,
    outflow: financeAmountSchema,
  }).strict()).max(100),
  nextCursor: z.string().uuid().nullable(),
}).strict();
const financeInvoiceRegisterKindSchema = z.enum(["SALE", "PURCHASE", "EXPENSE", "OBLIGATION", "OTHER"]);
const financeInvoiceRegisterStatusSchema = z.enum(["POSTED", "CANCELLED"]);

export const financeInvoiceRegisterQuerySchema = z.object({
  fromBusinessDate: businessDateSchema.optional(),
  toBusinessDate: businessDateSchema.optional(),
  businessMonths: z.string().trim().regex(/^\d{4}-\d{2}(,\d{4}-\d{2})*$/).optional(),
  kinds: z.string().trim().regex(/^(SALE|PURCHASE|EXPENSE|OBLIGATION|OTHER)(,(SALE|PURCHASE|EXPENSE|OBLIGATION|OTHER))*$/).optional(),
  supplierIds: z.string().trim().regex(/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}(,\w{8}-\w{4}-\w{4}-\w{4}-\w{12})*$/).optional(),
  categoryIds: z.string().trim().regex(/^\w{8}-\w{4}-\w{4}-\w{4}-\w{12}(,\w{8}-\w{4}-\w{4}-\w{4}-\w{12})*$/).optional(),
  statuses: z.string().trim().regex(/^(POSTED|CANCELLED)(,(POSTED|CANCELLED))*$/).optional(),
  q: z.string().trim().min(1).max(160).optional(),
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
}).strict();

const financeInvoiceRegisterOptionSchema = z.object({ id: z.string().uuid(), nameAr: z.string().min(1).max(160), nameEn: z.string().max(160).nullable() }).strict();
const financeInvoiceRegisterRecordSchema = z.object({
  id: z.string().uuid(),
  source: z.enum(["DAILY_SALES", "OUTFLOW_DOCUMENT", "SUPPLIER_DUE_PAYMENT", "LOAN_OPENING", "LOAN_REPAYMENT", "JOURNAL"]),
  sourceType: z.string().min(1).max(80),
  documentNumber: z.string().min(1).max(160),
  businessDate: businessDateSchema,
  supplierInvoiceDate: businessDateSchema.nullable(),
  kind: financeInvoiceRegisterKindSchema,
  settlementKind: financeOutflowSettlementSchema.nullable(),
  status: financeInvoiceRegisterStatusSchema,
  supplier: financeInvoiceRegisterOptionSchema.nullable(),
  category: financeInvoiceRegisterOptionSchema.nullable(),
  grossAmount: financeAmountSchema,
  netAmount: financeAmountSchema,
  vatAmount: financeAmountSchema,
  journalEntryId: z.string().uuid(),
  batchNumber: z.string().max(80).nullable(),
  notes: z.string().max(2_000).nullable(),
  recurring: z.boolean(),
  createdAt: z.date(),
}).strict();
export const financeInvoiceRegisterReceiptSchema = z.object({
  companyId: companyIdSchema,
  appliedPeriod: z.object({ fromBusinessDate: businessDateSchema.nullable(), toBusinessDate: businessDateSchema.nullable(), businessMonths: z.array(z.string().regex(/^\d{4}-\d{2}$/)).max(120) }).strict(),
  summary: z.object({ documentCount: z.number().int().nonnegative(), salesCount: z.number().int().nonnegative(), purchaseCount: z.number().int().nonnegative(), expenseCount: z.number().int().nonnegative(), obligationCount: z.number().int().nonnegative(), otherCount: z.number().int().nonnegative(), paidCount: z.number().int().nonnegative(), payableCount: z.number().int().nonnegative(), grossAmount: financeAmountSchema, netAmount: financeAmountSchema, vatAmount: financeAmountSchema }).strict(),
  filters: z.object({ suppliers: z.array(financeInvoiceRegisterOptionSchema).max(1000), categories: z.array(financeInvoiceRegisterOptionSchema).max(500) }).strict(),
  records: z.array(financeInvoiceRegisterRecordSchema).max(100),
  hasMore: z.boolean(),
  nextCursor: z.string().uuid().nullable(),
}).strict();
export type FinanceInvoiceRegisterReceipt = z.infer<typeof financeInvoiceRegisterReceiptSchema>;

export const financeInvoiceRegisterDetailSchema = z.object({
  movement: financeInvoiceRegisterRecordSchema,
  journal: z.object({
    id: z.string().uuid(),
    sourceType: z.string().min(1).max(80),
    sourceReference: z.string().min(1).max(160),
    businessDate: businessDateSchema,
    description: z.string().max(1_000).nullable(),
    status: z.enum(["POSTED", "REVERSED"]),
    postedAt: z.date(),
    reversalOfEntryId: z.string().uuid().nullable(),
    reversalEntryId: z.string().uuid().nullable(),
    lines: z.array(z.object({
      id: z.string().uuid(),
      lineNumber: z.number().int().positive(),
      accountCode: z.string().min(1).max(80),
      accountNameAr: z.string().min(1).max(160),
      accountNameEn: z.string().min(1).max(160),
      debitAmount: financeAmountSchema,
      creditAmount: financeAmountSchema,
      description: z.string().max(1_000).nullable(),
    }).strict()).min(2).max(100),
  }).strict(),
  allocations: z.array(z.object({
    vaultId: z.string().uuid(),
    vaultNameAr: z.string().min(1).max(160),
    vaultNameEn: z.string().min(1).max(160),
    paymentMethod: z.string().min(1).max(80),
    grossAmount: financeAmountSchema,
  }).strict()).max(25),
  batch: z.object({
    batchNumber: z.string().min(1).max(80),
    documentCount: z.number().int().positive(),
    grossAmount: financeAmountSchema,
    netAmount: financeAmountSchema,
    vatAmount: financeAmountSchema,
    notes: z.string().max(2_000).nullable(),
  }).strict().nullable(),
  sourceDetail: z.object({
    supplierInvoiceNumber: z.string().max(160).nullable(),
    supplierInvoiceMissingReason: z.string().max(500).nullable(),
    coverageLabel: z.string().max(160).nullable(),
  }).strict(),
}).strict();
export type FinanceInvoiceRegisterDetail = z.infer<typeof financeInvoiceRegisterDetailSchema>;

// Accounts are a drill-down into the same immutable journal that feeds the
// unified financial register. They are intentionally not a second document
// register and expose account balances plus account-scoped journal lines only.
const financeAccountTypeSchema = z.enum(["ASSET", "LIABILITY", "EQUITY", "REVENUE", "EXPENSE"]);
const financeAccountStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export const financeAccountsWorkspaceQuerySchema = z.object({
  fromBusinessDate: businessDateSchema.optional(),
  toBusinessDate: businessDateSchema.optional(),
  q: z.string().trim().min(1).max(160).optional(),
}).strict();
export const financeAccountMovementQuerySchema = z.object({
  fromBusinessDate: businessDateSchema.optional(),
  toBusinessDate: businessDateSchema.optional(),
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
}).strict();
const financeAccountRecordSchema = z.object({
  id: z.string().uuid(),
  code: z.string().min(1).max(80),
  nameAr: z.string().min(1).max(160),
  nameEn: z.string().min(1).max(160),
  type: financeAccountTypeSchema,
  status: financeAccountStatusSchema,
  isSystem: z.boolean(),
  balanceDebit: financeAmountSchema,
  balanceCredit: financeAmountSchema,
  periodDebit: financeAmountSchema,
  periodCredit: financeAmountSchema,
}).strict();
export const financeAccountsWorkspaceReceiptSchema = z.object({
  companyId: companyIdSchema,
  asOfBusinessDate: businessDateSchema,
  fromBusinessDate: businessDateSchema.nullable(),
  toBusinessDate: businessDateSchema.nullable(),
  accounts: z.array(financeAccountRecordSchema).max(500),
}).strict();
export const financeAccountMovementReceiptSchema = z.object({
  account: financeAccountRecordSchema,
  asOfBusinessDate: businessDateSchema,
  fromBusinessDate: businessDateSchema.nullable(),
  toBusinessDate: businessDateSchema.nullable(),
  summary: z.object({
    balanceDebit: financeAmountSchema,
    balanceCredit: financeAmountSchema,
    periodDebit: financeAmountSchema,
    periodCredit: financeAmountSchema,
  }).strict(),
  items: z.array(z.object({
    id: z.string().uuid(),
    journalEntryId: z.string().uuid(),
    businessDate: businessDateSchema,
    sourceType: z.string().min(1).max(80),
    sourceReference: z.string().min(1).max(160),
    description: z.string().max(1_000).nullable(),
    debitAmount: financeAmountSchema,
    creditAmount: financeAmountSchema,
  }).strict()).max(100),
  nextCursor: z.string().uuid().nullable(),
}).strict();
export const financeJournalEntryDetailSchema = z.object({
  id: z.string().uuid(),
  sourceType: z.string().min(1).max(80),
  sourceReference: z.string().min(1).max(160),
  businessDate: businessDateSchema,
  description: z.string().max(1_000).nullable(),
  status: z.enum(["POSTED", "REVERSED"]),
  postedAt: z.date(),
  reversalOfEntryId: z.string().uuid().nullable(),
  reversalEntryId: z.string().uuid().nullable(),
  lines: z.array(z.object({
    id: z.string().uuid(), lineNumber: z.number().int().positive(), accountCode: z.string().min(1).max(80),
    accountNameAr: z.string().min(1).max(160), accountNameEn: z.string().min(1).max(160),
    debitAmount: financeAmountSchema, creditAmount: financeAmountSchema, description: z.string().max(1_000).nullable(),
  }).strict()).min(2).max(100),
}).strict();
export type FinanceAccountsWorkspaceReceipt = z.infer<typeof financeAccountsWorkspaceReceiptSchema>;
export type FinanceAccountMovementReceipt = z.infer<typeof financeAccountMovementReceiptSchema>;
export type FinanceJournalEntryDetail = z.infer<typeof financeJournalEntryDetailSchema>;
