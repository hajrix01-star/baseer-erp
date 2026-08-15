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
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const companyFinanceSetupReceiptSchema = z
  .object({
    periodId: z.string().uuid(),
    vaultIds: z.array(z.string().uuid()).min(1).max(5),
  })
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
    type: z.enum(["CASH", "BANK", "ELECTRONIC"]),
    isSalesChannel: z.boolean().optional(),
    isPaymentDestination: z.boolean().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const removeVaultRequestSchema = z
  .object({ vaultId: z.string().uuid(), idempotencyKey: idempotencyKeySchema })
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
    baseSeedVersion: z.string().min(1).max(80),
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
