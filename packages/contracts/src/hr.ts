import { z } from "zod";

import { businessDateSchema } from "./business-date.js";
import { companyIdSchema } from "./identity.js";

const idempotencyKeySchema = z.string().trim().min(1).max(255);
const hrSearchSchema = z.string().trim().min(1).max(160);
const hrDateSchema = businessDateSchema.transform((value) => new Date(`${value}T00:00:00.000Z`));
export const hrEmployeeIdSchema = z.string().uuid();
const hrAmountSchema = z.string().trim().regex(/^\d+(?:\.\d{1,4})?$/).max(32);
const hrFactorSchema = z.string().trim().regex(/^\d+(?:\.\d{1,8})?$/).max(36);
const hrSignedAmountSchema = z.string().trim().regex(/^-?\d+(?:\.\d{1,4})?$/).max(33);

export const hrEmployeeStatusSchema = z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED", "ARCHIVED"]);
export const hrEmployeeServiceStatusSchema = z.enum(["DRAFT", "ISSUED", "CANCELLED"]);
export const hrEmployeeServiceCostStatusSchema = z.enum(["NOT_ISSUED", "POSTED", "REVERSED"]);
/** Financial issuing remains separate from operational compliance. Expiry is derived from the business date. */
export const hrEmployeeServiceComplianceStatusSchema = z.enum(["ACTIVE", "RENEWED", "CANCELLED"]);
export const hrEmployeeAdvanceStatusSchema = z.enum(["ISSUED", "PARTIALLY_SETTLED", "SETTLED", "REVERSED"]);
export const hrEmployeeAdministrativeDeductionStatusSchema = z.enum(["OPEN", "PARTIALLY_APPLIED", "APPLIED", "DEFERRED", "CANCELLED"]);
export const hrEmployeeLeaveTypeSchema = z.enum(["ANNUAL", "SICK", "UNPAID", "OTHER"]);
export const hrEmployeeLeaveStatusSchema = z.enum(["APPROVED", "RETURNED"]);
export const hrCompensationFormulaCodeSchema = z.enum(["STANDARD_MONTHLY_V1"]);
export const hrCompensationPolicyVersionStatusSchema = z.enum(["DRAFT", "APPROVED", "SUPERSEDED"]);
/** A fixed salary is entered as-is; an inclusive package derives the base and overtime. */
export const hrCompensationMethodSchema = z.enum(["FIXED_MONTHLY", "INCLUSIVE_OVERTIME"]);
export const hrPayrollLineEligibilityCodeSchema = z.enum(["FULL_MONTH_V1", "FULL_MONTH_ON_LEAVE_EXCEPTION_V1", "PRORATED_NEW_HIRE_V1"]);
export const hrEmployeeServiceTypeSchema = z.enum([
  "IQAMA_ISSUANCE",
  "IQAMA_RENEWAL",
  "SPONSORSHIP_TRANSFER",
  "EXIT_REENTRY_VISA",
  "FLIGHT_TICKET",
  "MEDICAL_INSURANCE",
  "HEALTH_CERTIFICATE",
  "OTHER",
]);
export const hrEmployeeDocumentTypeSchema = z.enum(["NATIONAL_ID", "IQAMA", "PASSPORT", "EMPLOYMENT_CONTRACT", "MEDICAL_INSURANCE", "HEALTH_CERTIFICATE", "QUALIFICATION", "OTHER"]);
export const hrEmployeeDocumentStatusSchema = z.enum(["ACTIVE", "REVOKED"]);
export const hrEmployeeDocumentBlobStatusSchema = z.enum(["STAGED", "READY", "QUARANTINED", "REVOKED"]);
export const hrEmployeeDocumentComplianceStatusSchema = z.enum(["NOT_APPLICABLE", "VALID", "EXPIRING", "EXPIRED"]);
export const hrEmployeeLetterTypeSchema = z.enum(["SALARY_CERTIFICATE", "SERVICE_CERTIFICATE"]);
export const hrEmployeeLetterStatusSchema = z.enum(["ISSUED", "REVOKED"]);
export const hrFinalSettlementStatusSchema = z.enum(["DRAFT", "APPROVED", "PARTIALLY_PAID", "PAID", "REVERSED", "CANCELLED"]);
export const hrFinalSettlementReasonSchema = z.enum(["EMPLOYER_TERMINATION", "RESIGNATION", "ARTICLE_80", "ARTICLE_81", "FORCE_MAJEURE", "MATERNITY", "OTHER_LEGAL_REVIEW"]);
export const hrFinalSettlementReasonVerificationStatusSchema = z.enum(["PENDING", "VERIFIED", "REJECTED"]);
const hrFinalSettlementRecoverySchema = z.object({ recoveryType: z.enum(["ADVANCE", "ADMINISTRATIVE_DEDUCTION"]), sourceId: z.string().uuid(), amount: hrAmountSchema }).strict();
const hrFinalSettlementAllocationSchema = z.object({ vaultId: z.string().uuid(), paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]), amount: hrAmountSchema }).strict();
export const previewHrFinalSettlementRequestSchema = z.object({ employeeId: hrEmployeeIdSchema, terminationDate: hrDateSchema, terminationReason: hrFinalSettlementReasonSchema, reasonEvidenceReference: z.string().trim().min(1).max(240), reasonEvidenceNote: z.string().trim().max(2_000).optional(), recoveries: z.array(hrFinalSettlementRecoverySchema).max(100).default([]) }).strict();
export const createHrFinalSettlementRequestSchema = previewHrFinalSettlementRequestSchema.extend({ idempotencyKey: idempotencyKeySchema }).strict();
export const approveHrFinalSettlementRequestSchema = z.object({ settlementId: z.string().uuid(), businessDate: hrDateSchema, idempotencyKey: idempotencyKeySchema }).strict();
export const verifyHrFinalSettlementReasonRequestSchema = z.object({ settlementId: z.string().uuid(), verificationNote: z.string().trim().min(1).max(2_000), idempotencyKey: idempotencyKeySchema }).strict();
export const payHrFinalSettlementRequestSchema = z.object({ settlementId: z.string().uuid(), businessDate: hrDateSchema, allocations: z.array(hrFinalSettlementAllocationSchema).min(1).max(20), idempotencyKey: idempotencyKeySchema }).strict();
export const reverseHrFinalSettlementRequestSchema = z.object({ settlementId: z.string().uuid(), businessDate: hrDateSchema, reason: z.string().trim().min(1).max(1_000), idempotencyKey: idempotencyKeySchema }).strict();
export const reverseHrFinalSettlementPaymentRequestSchema = z.object({ finalSettlementPaymentId: z.string().uuid(), businessDate: hrDateSchema, reason: z.string().trim().min(1).max(1_000), idempotencyKey: idempotencyKeySchema }).strict();
export const hrFinalSettlementsQuerySchema = z.object({ cursor: z.string().uuid().optional(), pageSize: z.coerce.number().int().min(1).max(100).optional().default(50), employeeId: hrEmployeeIdSchema.optional(), status: hrFinalSettlementStatusSchema.optional(), search: hrSearchSchema.optional() }).strict();
export const hrFinalSettlementDetailQuerySchema = z.object({ paymentCursor: z.string().uuid().optional(), pageSize: z.coerce.number().int().min(1).max(100).optional().default(50) }).strict();

const hrDocumentUploadSchema = z.object({
  fileName: z.string().trim().min(1).max(240),
  // 5 MiB binary payload has a <= 6.99 MiB base64 representation.
  contentBase64: z.string().trim().min(1).max(7_000_000).regex(/^[A-Za-z0-9+/]+={0,2}$/),
}).strict();
export const createHrEmployeeDocumentRequestSchema = z.object({
  documentType: hrEmployeeDocumentTypeSchema, title: z.string().trim().min(1).max(240),
  referenceNumber: z.string().trim().max(160).optional(), issueDate: hrDateSchema.optional(), expiryDate: hrDateSchema.optional(),
  notes: z.string().trim().max(2_000).optional(), linkedServiceId: z.string().uuid().optional(), retentionUntil: hrDateSchema.optional(), legalHold: z.boolean().optional(),
  upload: hrDocumentUploadSchema.optional(), idempotencyKey: idempotencyKeySchema,
}).strict();
export const replaceHrEmployeeDocumentRequestSchema = z.object({ upload: hrDocumentUploadSchema, idempotencyKey: idempotencyKeySchema }).strict();
export const revokeHrEmployeeDocumentRequestSchema = z.object({ reason: z.string().trim().min(1).max(1_000), idempotencyKey: idempotencyKeySchema }).strict();
export const hrEmployeeDocumentsQuerySchema = z.object({
  cursor: z.string().uuid().optional(), pageSize: z.coerce.number().int().min(1).max(100).optional().default(50), documentType: hrEmployeeDocumentTypeSchema.optional(), status: hrEmployeeDocumentStatusSchema.optional(),
  expiry: z.enum(["VALID", "EXPIRING", "EXPIRED", "NONE"]).optional(),
}).strict();
export const issueHrEmployeeLetterRequestSchema = z.object({ letterType: hrEmployeeLetterTypeSchema, locale: z.enum(["ar", "en"]), recipient: z.string().trim().max(240).optional(), idempotencyKey: idempotencyKeySchema }).strict();
export const revokeHrEmployeeLetterRequestSchema = z.object({ reason: z.string().trim().min(1).max(1_000), idempotencyKey: idempotencyKeySchema }).strict();
export const hrEmployeeLettersQuerySchema = z.object({ cursor: z.string().uuid().optional(), pageSize: z.coerce.number().int().min(1).max(100).optional().default(50) }).strict();

export const createHrEmployeeRequestSchema = z.object({
  nameAr: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().max(160).optional(),
  jobTitle: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(254).optional(),
  iqamaNumber: z.string().trim().max(160).optional(),
  workSchedule: z.string().trim().max(160).optional(),
  hireDate: hrDateSchema,
  notes: z.string().trim().max(2_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const updateHrEmployeeRequestSchema = z.object({
  employeeId: hrEmployeeIdSchema,
  nameAr: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().max(160).nullable().optional(),
  jobTitle: z.string().trim().max(160).nullable().optional(),
  phone: z.string().trim().max(30).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  iqamaNumber: z.string().trim().max(160).nullable().optional(),
  workSchedule: z.string().trim().max(160).nullable().optional(),
  status: hrEmployeeStatusSchema,
  terminatedAt: hrDateSchema.nullable().optional(),
  notes: z.string().trim().max(2_000).nullable().optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** A promotion is an immutable career-history event. It never changes a payroll snapshot. */
export const createHrEmployeePromotionRequestSchema = z.object({
  employeeId: hrEmployeeIdSchema,
  effectiveDate: hrDateSchema,
  newJobTitle: z.string().trim().min(1).max(160),
  decisionReference: z.string().trim().min(1).max(240),
  reason: z.string().trim().max(2_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const hrEmployeePromotionsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
}).strict();

export const createHrEmployeeServiceRequestSchema = z.object({
  employeeId: hrEmployeeIdSchema,
  serviceType: hrEmployeeServiceTypeSchema,
  referenceNumber: z.string().trim().max(160).optional(),
  issueDate: hrDateSchema.optional(),
  expiryDate: hrDateSchema.optional(),
  visaDurationMonths: z.coerce.number().int().min(1).max(5).optional(),
  supplierId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  notes: z.string().trim().max(2_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** A service can be corrected only until its separate financial cost is issued. */
export const updateHrEmployeeServiceRequestSchema = z.object({
  serviceId: z.string().uuid(),
  serviceType: hrEmployeeServiceTypeSchema.optional(),
  referenceNumber: z.string().trim().max(160).nullable().optional(),
  issueDate: hrDateSchema.nullable().optional(),
  expiryDate: hrDateSchema.nullable().optional(),
  visaDurationMonths: z.coerce.number().int().min(1).max(5).nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(2_000).nullable().optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const cancelHrEmployeeServiceRequestSchema = z.object({
  serviceId: z.string().uuid(),
  reason: z.string().trim().min(1).max(1_000),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** Renewal creates a new active record and preserves the previous one as history. */
export const renewHrEmployeeServiceRequestSchema = z.object({
  serviceId: z.string().uuid(),
  referenceNumber: z.string().trim().max(160).nullable().optional(),
  issueDate: hrDateSchema.nullable().optional(),
  expiryDate: hrDateSchema.nullable().optional(),
  visaDurationMonths: z.coerce.number().int().min(1).max(5).nullable().optional(),
  supplierId: z.string().uuid().nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(2_000).nullable().optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const hrEmployeeServicesQuerySchema = z.object({
  employeeId: hrEmployeeIdSchema.optional(),
  serviceType: hrEmployeeServiceTypeSchema.optional(),
  complianceStatus: hrEmployeeServiceComplianceStatusSchema.optional(),
  search: hrSearchSchema.optional(),
  expiryBefore: businessDateSchema.transform((value) => new Date(`${value}T00:00:00.000Z`)).optional(),
  expiryAfter: businessDateSchema.transform((value) => new Date(`${value}T00:00:00.000Z`)).optional(),
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
}).strict();

export const issueHrEmployeeServiceCostRequestSchema = z.object({
  serviceId: z.string().uuid(),
  businessDate: hrDateSchema,
  grossAmount: hrAmountSchema.refine((value) => Number(value) > 0),
  isTaxable: z.boolean(),
  allocations: z.array(z.object({ vaultId: z.string().uuid(), grossAmount: hrAmountSchema, paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]).optional() }).strict()).min(1).max(25),
  supplierInvoiceNumber: z.string().trim().max(160).optional(),
  supplierInvoiceMissingReason: z.string().trim().max(500).optional(),
  supplierInvoiceDate: hrDateSchema.optional(),
  notes: z.string().trim().max(2_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const reverseHrEmployeeServiceCostRequestSchema = z.object({
  serviceId: z.string().uuid(),
  businessDate: hrDateSchema,
  reason: z.string().trim().min(1).max(1_000),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** Records an employee service and posts its paid supplier invoice as one operation. */
export const recordHrEmployeeServiceAndIssueCostRequestSchema = z.object({
  employeeId: hrEmployeeIdSchema,
  serviceType: hrEmployeeServiceTypeSchema,
  referenceNumber: z.string().trim().max(160).optional(),
  issueDate: hrDateSchema.optional(),
  expiryDate: hrDateSchema.optional(),
  visaDurationMonths: z.coerce.number().int().min(1).max(5).optional(),
  supplierId: z.string().uuid(),
  categoryId: z.string().uuid(),
  businessDate: hrDateSchema,
  grossAmount: hrAmountSchema.refine((value) => Number(value) > 0),
  isTaxable: z.boolean(),
  allocations: z.array(z.object({ vaultId: z.string().uuid(), grossAmount: hrAmountSchema, paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]).optional() }).strict()).min(1).max(25),
  supplierInvoiceNumber: z.string().trim().max(160).optional(),
  supplierInvoiceMissingReason: z.string().trim().max(500).optional(),
  supplierInvoiceDate: hrDateSchema.optional(),
  notes: z.string().trim().max(2_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const recordHrEmployeeServiceAndIssueCostReceiptSchema = z.object({
  serviceId: z.string().uuid(),
  documentId: z.string().uuid(),
  documentNumber: z.string().max(80),
  journalEntryId: z.string().uuid(),
  replayed: z.boolean(),
}).strict();

/** Money paid before payroll. Allocations may split a single advance across vaults. */
export const issueHrEmployeeAdvanceRequestSchema = z.object({
  employeeId: hrEmployeeIdSchema,
  businessDate: hrDateSchema,
  amount: hrAmountSchema.refine((value) => Number(value) > 0),
  allocations: z.array(z.object({
    vaultId: z.string().uuid(),
    amount: hrAmountSchema.refine((value) => Number(value) > 0),
    paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]).optional(),
  }).strict()).min(1).max(25),
  notes: z.string().trim().max(2_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const reverseHrEmployeeAdvanceIssueRequestSchema = z.object({
  advanceId: z.string().uuid(),
  businessDate: hrDateSchema,
  reason: z.string().trim().min(1).max(1_000),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** A direct repayment is a receipt from the employee, never a payroll deduction. */
export const settleHrEmployeeAdvanceDirectlyRequestSchema = z.object({
  advanceId: z.string().uuid(),
  businessDate: hrDateSchema,
  amount: hrAmountSchema.refine((value) => Number(value) > 0),
  allocations: z.array(z.object({
    vaultId: z.string().uuid(),
    amount: hrAmountSchema.refine((value) => Number(value) > 0),
    paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]).optional(),
  }).strict()).min(1).max(25),
  deferRemainingUntil: hrDateSchema.optional(),
  notes: z.string().trim().max(2_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** Postpones the planned collection date only; it is not a payment or deduction. */
export const deferHrEmployeeAdvanceRequestSchema = z.object({
  advanceId: z.string().uuid(),
  businessDate: hrDateSchema,
  deferredUntil: hrDateSchema,
  reason: z.string().trim().min(1).max(1_000),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** A free-text deduction that remains pending until an approved payroll applies it. */
export const createHrEmployeeAdministrativeDeductionRequestSchema = z.object({
  employeeId: hrEmployeeIdSchema,
  businessDate: hrDateSchema,
  amount: hrAmountSchema.refine((value) => Number(value) > 0),
  description: z.string().trim().min(1).max(1_000),
  plannedPayrollDate: hrDateSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const deferHrEmployeeAdministrativeDeductionRequestSchema = z.object({
  deductionId: z.string().uuid(),
  businessDate: hrDateSchema,
  deferredUntil: hrDateSchema,
  reason: z.string().trim().min(1).max(1_000),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const cancelHrEmployeeAdministrativeDeductionRequestSchema = z.object({
  deductionId: z.string().uuid(),
  businessDate: hrDateSchema,
  reason: z.string().trim().min(1).max(1_000),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** Shared agreement values. The initial employee flow derives its effective
 * month from the hire date, while a later amendment supplies it explicitly. */
const hrEmployeeCompensationValuesSchema = z.object({
  /** Agreement may select an approved policy revision; absent selects the company default revision. */
  policyVersionId: z.string().uuid().optional(),
  monthlyGross: hrAmountSchema.refine((value) => Number(value) > 0),
  compensationMethod: hrCompensationMethodSchema.default("FIXED_MONTHLY"),
  foodAllowance: hrAmountSchema.default("0"),
  housingAllowance: hrAmountSchema.default("0"),
  transportAllowance: hrAmountSchema.default("0"),
  otherAllowance: hrAmountSchema.default("0"),
  scheduledHoursPerDay: z.coerce.number().int().min(1).max(12).optional(),
  scheduledWorkDays: z.coerce.number().int().min(1).max(31).optional(),
  notes: z.string().trim().max(1_000).optional(),
}).strict();

function validateInclusiveOvertime(value: { compensationMethod: "FIXED_MONTHLY" | "INCLUSIVE_OVERTIME"; scheduledHoursPerDay?: number | undefined; scheduledWorkDays?: number | undefined }, context: z.RefinementCtx) {
  if (value.compensationMethod !== "INCLUSIVE_OVERTIME") return;
  if (!value.scheduledHoursPerDay || !value.scheduledWorkDays) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Inclusive overtime requires agreed daily hours and working days." });
  }
  if (value.scheduledHoursPerDay !== undefined && value.scheduledHoursPerDay <= 8) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["scheduledHoursPerDay"], message: "Inclusive overtime requires more than eight daily hours." });
  }
}

/**
 * Effective-dated compensation agreement. For inclusive overtime, the agreed
 * total remains the payroll gross while the server derives the base and OT.
 */
export const setHrEmployeeCompensationRequestSchema = hrEmployeeCompensationValuesSchema.extend({
  employeeId: hrEmployeeIdSchema,
  effectiveFrom: hrDateSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict().superRefine(validateInclusiveOvertime);

/** Creates the employee and their first agreement as one atomic operation. */
export const onboardHrEmployeeRequestSchema = createHrEmployeeRequestSchema.omit({ idempotencyKey: true }).extend({
  initialCompensation: hrEmployeeCompensationValuesSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict().superRefine((value, context) => validateInclusiveOvertime(value.initialCompensation, context));

/** Policy formula is selected by the server; the client supplies no legal rates or coefficients. */
export const createHrCompensationPolicyRequestSchema = z.object({
  code: z.string().trim().min(1).max(80).regex(/^[A-Z0-9_\-]+$/),
  nameAr: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().max(160).optional(),
  effectiveFrom: hrDateSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const createHrCompensationPolicyVersionRequestSchema = z.object({
  policyId: z.string().uuid(),
  effectiveFrom: hrDateSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const approveHrCompensationPolicyVersionRequestSchema = z.object({
  policyVersionId: z.string().uuid(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

const payrollApplicationSchema = z.object({ id: z.string().uuid(), amount: hrAmountSchema.refine((value) => Number(value) > 0) }).strict();
const payrollLineRequestSchema = z.object({
  employeeId: hrEmployeeIdSchema,
  advances: z.array(payrollApplicationSchema).max(100).default([]),
  administrativeDeductions: z.array(payrollApplicationSchema).max(100).default([]),
}).strict();

/** The server snapshots compensation and validates every applied residual. */
export const createHrPayrollRunRequestSchema = z.object({
  payrollMonth: hrDateSchema,
  businessDate: hrDateSchema,
  notes: z.string().trim().max(2_000).optional(),
  /** @deprecated: ACTIVE employees are always server-selected. Retained for request compatibility. */
  includeAllEligible: z.boolean().default(true),
  /** ON_LEAVE employees are never implicit; this is the only way to include them. */
  includeOnLeaveEmployeeIds: z.array(hrEmployeeIdSchema).max(1_000).default([]),
  /** Applications attach to an employee already selected by the server; they never select employees. */
  lines: z.array(payrollLineRequestSchema).max(10_000).default([]),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** Recalculates an existing draft in place; the payroll month is immutable. */
export const updateHrPayrollDraftRequestSchema = createHrPayrollRunRequestSchema.extend({
  payrollRunId: z.string().uuid(),
}).strict();

/** Read-only, server-authored payroll population. Cursor pages are by employee id. */
export const previewHrPayrollRunRequestSchema = z.object({
  payrollMonth: hrDateSchema,
  businessDate: hrDateSchema,
  includeOnLeaveEmployeeIds: z.array(hrEmployeeIdSchema).max(1_000).default([]),
  /** Optional settlement choices are validated and summarized, never used for population selection. */
  lines: z.array(payrollLineRequestSchema).max(10_000).default([]),
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(50),
}).strict();

export const approveHrPayrollRunRequestSchema = z.object({
  payrollRunId: z.string().uuid(),
  businessDate: hrDateSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** A draft has no journal entry and may be discarded before approval. */
export const discardHrPayrollRunRequestSchema = z.object({
  payrollRunId: z.string().uuid(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const payHrPayrollRunRequestSchema = z.object({
  payrollRunId: z.string().uuid(),
  businessDate: hrDateSchema,
  allocations: z.array(z.object({
    vaultId: z.string().uuid(),
    amount: hrAmountSchema.refine((value) => Number(value) > 0),
    paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]).optional(),
  }).strict()).min(1).max(25),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const reverseHrPayrollRunRequestSchema = z.object({
  payrollRunId: z.string().uuid(),
  businessDate: hrDateSchema,
  reason: z.string().trim().min(1).max(1_000),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const reverseHrPayrollPaymentRequestSchema = z.object({
  payrollPaymentId: z.string().uuid(),
  businessDate: hrDateSchema,
  reason: z.string().trim().min(1).max(1_000),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** Leave is approved at creation and remains operational; it never posts a financial entry. */
export const createHrEmployeeLeaveRequestSchema = z.object({
  employeeId: hrEmployeeIdSchema,
  leaveType: hrEmployeeLeaveTypeSchema,
  startDate: hrDateSchema,
  endDate: hrDateSchema,
  notes: z.string().trim().max(2_000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** returnDate is the employee's actual first working day back. */
export const returnHrEmployeeLeaveRequestSchema = z.object({
  leaveId: z.string().uuid(),
  returnDate: hrDateSchema,
  notes: z.string().trim().max(2_000).nullable().optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const hrEmployeeSchema = z.object({
  id: hrEmployeeIdSchema,
  employeeNumber: z.string().min(1).max(80),
  nameAr: z.string().min(1).max(160),
  nameEn: z.string().max(160).nullable(),
  jobTitle: z.string().max(160).nullable(),
  phone: z.string().max(30).nullable(),
  email: z.string().max(254).nullable(),
  iqamaNumber: z.string().max(160).nullable(),
  workSchedule: z.string().max(160).nullable(),
  hireDate: businessDateSchema,
  currentMonthlyGross: hrAmountSchema.nullable(),
  /** An authenticated document-version reference; never a storage URL. */
  profilePhotoVersionId: z.string().uuid().nullable(),
  status: hrEmployeeStatusSchema,
  terminatedAt: businessDateSchema.nullable(),
  notes: z.string().max(2_000).nullable(),
}).strict();

export const hrEmployeePromotionSchema = z.object({
  id: z.string().uuid(),
  employeeId: hrEmployeeIdSchema,
  effectiveDate: businessDateSchema,
  previousJobTitle: z.string().max(160).nullable(),
  newJobTitle: z.string().max(160),
  decisionReference: z.string().max(240),
  reason: z.string().max(2_000).nullable(),
  createdAt: z.string().datetime(),
}).strict();

export const hrEmployeeServiceSchema = z.object({
  id: z.string().uuid(),
  employeeId: hrEmployeeIdSchema,
  serviceType: hrEmployeeServiceTypeSchema,
  referenceNumber: z.string().max(160).nullable(),
  issueDate: businessDateSchema.nullable(),
  expiryDate: businessDateSchema.nullable(),
  visaDurationMonths: z.number().int().min(1).max(5).nullable(),
  renewalOfServiceId: z.string().uuid().nullable(),
  supplier: z.object({ id: z.string().uuid(), nameAr: z.string(), nameEn: z.string().nullable() }).nullable(),
  category: z.object({ id: z.string().uuid(), nameAr: z.string(), nameEn: z.string() }).nullable(),
  outflowDocumentId: z.string().uuid().nullable(),
  costStatus: hrEmployeeServiceCostStatusSchema,
  status: hrEmployeeServiceStatusSchema,
  complianceStatus: hrEmployeeServiceComplianceStatusSchema,
  notes: z.string().max(2_000).nullable(),
  employee: z.object({ id: hrEmployeeIdSchema, employeeNumber: z.string().max(80), nameAr: z.string().max(160), nameEn: z.string().max(160).nullable() }).strict().optional(),
}).strict();

export const hrEmployeeFinancialMovementSchema = z.object({
  id: z.string().uuid(),
  journalEntryId: z.string().uuid(),
  movementType: z.enum(["SERVICE_COST", "PAYROLL_ACCRUAL", "PAYROLL_PAYMENT", "ADVANCE_ISSUED", "ADVANCE_SETTLEMENT", "FINAL_SETTLEMENT_ACCRUAL", "FINAL_SETTLEMENT_PAYMENT"]),
  businessDate: businessDateSchema,
  amount: hrSignedAmountSchema,
  sourceReference: z.string().max(160),
  description: z.string().max(1_000).nullable(),
}).strict();

export const hrEmployeeAdvanceSchema = z.object({
  id: z.string().uuid(),
  employeeId: hrEmployeeIdSchema,
  employeeNameAr: z.string().max(160),
  employeeNameEn: z.string().max(160).nullable(),
  advanceNumber: z.string().min(1).max(80),
  businessDate: businessDateSchema,
  originalAmount: hrAmountSchema,
  settledAmount: hrAmountSchema,
  remainingAmount: hrAmountSchema,
  status: hrEmployeeAdvanceStatusSchema,
  nextSettlementDate: businessDateSchema.nullable(),
  notes: z.string().max(2_000).nullable(),
  journalEntryId: z.string().uuid(),
  allocations: z.array(z.object({
    vaultId: z.string().uuid(),
    vaultNameAr: z.string().max(160),
    vaultNameEn: z.string().max(160),
    paymentMethod: z.enum(["CASH", "BANK_TRANSFER", "BANK_CARD", "BANK_PAYMENT", "APP"]),
    amount: hrAmountSchema,
  }).strict()).max(25),
}).strict();

export const hrEmployeeAdministrativeDeductionSchema = z.object({
  id: z.string().uuid(),
  employeeId: hrEmployeeIdSchema,
  employeeNameAr: z.string().max(160),
  employeeNameEn: z.string().max(160).nullable(),
  deductionNumber: z.string().min(1).max(80),
  businessDate: businessDateSchema,
  originalAmount: hrAmountSchema,
  appliedAmount: hrAmountSchema,
  remainingAmount: hrAmountSchema,
  status: hrEmployeeAdministrativeDeductionStatusSchema,
  plannedPayrollDate: businessDateSchema.nullable(),
  description: z.string().max(1_000),
  cancellationReason: z.string().max(1_000).nullable(),
}).strict();

export const hrEmployeeAdvanceDetailSchema = z.object({
  advance: hrEmployeeAdvanceSchema,
  settlements: z.array(z.object({ id: z.string().uuid(), source: z.enum(["PAYROLL", "MANUAL_RECEIPT", "FINAL_SETTLEMENT"]), businessDate: businessDateSchema, amount: hrAmountSchema, journalEntryId: z.string().uuid().nullable(), sourceReference: z.string().max(160).nullable() }).strict()).max(100),
  hasMoreSettlements: z.boolean(), nextSettlementCursor: z.string().uuid().nullable(),
  deferrals: z.array(z.object({ id: z.string().uuid(), businessDate: businessDateSchema, deferredUntil: businessDateSchema, reason: z.string().max(1_000) }).strict()).max(100),
  hasMoreDeferrals: z.boolean(), nextDeferralCursor: z.string().uuid().nullable(),
}).strict();

export const hrEmployeeAdministrativeDeductionDetailSchema = z.object({
  deduction: hrEmployeeAdministrativeDeductionSchema,
  actions: z.array(z.object({ id: z.string().uuid(), actionType: z.enum(["CREATED", "DEFERRED", "CANCELLED", "APPLIED", "REVERSED"]), businessDate: businessDateSchema, amount: hrAmountSchema.nullable(), plannedPayrollDate: businessDateSchema.nullable(), reason: z.string().max(1_000).nullable() }).strict()).max(100),
  hasMoreActions: z.boolean(), nextActionCursor: z.string().uuid().nullable(),
}).strict();

export const hrEmployeeCompensationProfileSchema = z.object({
  id: z.string().uuid(), employeeId: hrEmployeeIdSchema, effectiveFrom: businessDateSchema,
  effectiveTo: businessDateSchema.nullable(), monthlyGross: hrAmountSchema,
  policyVersionId: z.string().uuid().nullable(),
  compensationMethod: hrCompensationMethodSchema, foodAllowance: hrAmountSchema, housingAllowance: hrAmountSchema, transportAllowance: hrAmountSchema, otherAllowance: hrAmountSchema,
  scheduledHoursPerDay: z.number().int().nullable(), scheduledWorkDays: z.number().int().nullable(),
  notes: z.string().max(1_000).nullable(),
}).strict();

export const hrCompensationPolicyVersionSchema = z.object({
  id: z.string().uuid(), policyId: z.string().uuid(), policyCode: z.string().max(80), policyNameAr: z.string().max(160), policyNameEn: z.string().max(160).nullable(),
  versionNumber: z.number().int().positive(), effectiveFrom: businessDateSchema, effectiveTo: businessDateSchema.nullable(),
  status: hrCompensationPolicyVersionStatusSchema, formulaCode: hrCompensationFormulaCodeSchema,
}).strict();

export const hrCompensationPolicySchema = z.object({
  id: z.string().uuid(), code: z.string().max(80), nameAr: z.string().max(160), nameEn: z.string().max(160).nullable(),
  versions: z.array(hrCompensationPolicyVersionSchema).max(100),
}).strict();

const hrCompensationPolicySnapshotSchema = z.object({
  policyId: z.string().uuid(), policyVersionId: z.string().uuid(), policyCode: z.string().max(80), policyNameAr: z.string().max(160), policyNameEn: z.string().max(160).nullable(),
  versionNumber: z.number().int().positive(), effectiveFrom: businessDateSchema, formulaCode: hrCompensationFormulaCodeSchema,
}).strict();
const hrPayrollCalculationSnapshotSchema = z.object({
  formulaCode: z.enum(["FULL_MONTH_V1", "PRORATED_NEW_HIRE_V1"]),
  calculationPeriodStart: businessDateSchema,
  calculationPeriodEnd: businessDateSchema,
  eligibleDays: z.number().int().positive(),
  calendarDaysInMonth: z.number().int().positive(),
  prorationRatio: hrAmountSchema,
  monthlyGrossAmount: hrAmountSchema,
}).strict();

export const hrEmployeeLeaveSchema = z.object({
  id: z.string().uuid(),
  employeeId: hrEmployeeIdSchema,
  employeeNumber: z.string().max(80),
  employeeNameAr: z.string().max(160),
  employeeNameEn: z.string().max(160).nullable(),
  leaveType: hrEmployeeLeaveTypeSchema,
  status: hrEmployeeLeaveStatusSchema,
  startDate: businessDateSchema,
  endDate: businessDateSchema,
  actualReturnDate: businessDateSchema.nullable(),
  notes: z.string().max(2_000).nullable(),
}).strict();

const hrPayrollApplicationDetailSchema = z.object({
  /** Stable id of the payroll-line application record. */
  id: z.string().uuid(),
  /** Employee advance/deduction id accepted by preview/create/update inputs. */
  sourceId: z.string().uuid(),
  amount: hrAmountSchema,
  referenceNumber: z.string().max(80),
}).strict();
export const hrPaymentPostingStatusSchema = z.enum(["POSTED", "REVERSED"]);
export const hrPayrollPaymentSchema = z.object({
  id: z.string().uuid(), paymentNumber: z.string().max(80), businessDate: businessDateSchema, amount: hrAmountSchema, journalEntryId: z.string().uuid(),
  status: hrPaymentPostingStatusSchema, reversedAt: z.string().datetime().nullable(), reversalJournalEntryId: z.string().uuid().nullable(),
}).strict();
export const hrPayrollLineSchema = z.object({
  id: z.string().uuid(), employeeId: hrEmployeeIdSchema, employeeNumber: z.string().max(80), employeeNameAr: z.string().max(160), employeeNameEn: z.string().max(160).nullable(),
  grossSalary: hrAmountSchema, compensationMethod: hrCompensationMethodSchema,
  eligibilityCode: hrPayrollLineEligibilityCodeSchema,
  basicSalary: hrAmountSchema, foodAllowance: hrAmountSchema, housingAllowance: hrAmountSchema, transportAllowance: hrAmountSchema, otherAllowance: hrAmountSchema, overtimeAmount: hrAmountSchema, overtimeHours: hrAmountSchema,
  scheduledHoursPerDay: z.number().int().nullable(), scheduledWorkDays: z.number().int().nullable(),
  compensationPolicySnapshot: hrCompensationPolicySnapshotSchema.nullable(),
  payrollCalculationSnapshot: hrPayrollCalculationSnapshotSchema.nullable(),
  advanceSettlementAmount: hrAmountSchema, administrativeDeductionAmount: hrAmountSchema, netPayableAmount: hrAmountSchema, paidAmount: hrAmountSchema,
  advances: z.array(hrPayrollApplicationDetailSchema).max(100), administrativeDeductions: z.array(hrPayrollApplicationDetailSchema).max(100),
}).strict();
/** A payroll-line projection belonging to one employee, for the employee file. */
export const hrEmployeePayrollHistoryLineSchema = hrPayrollLineSchema.extend({
  payrollRunId: z.string().uuid(), runNumber: z.string().max(80), payrollMonth: businessDateSchema,
  businessDate: businessDateSchema, payrollStatus: z.enum(["DRAFT", "APPROVED", "PARTIALLY_PAID", "PAID", "REVERSED"]),
}).strict();
export const hrPayrollRunSchema = z.object({
  id: z.string().uuid(), runNumber: z.string().max(80), payrollMonth: businessDateSchema, businessDate: businessDateSchema,
  status: z.enum(["DRAFT", "APPROVED", "PARTIALLY_PAID", "PAID", "REVERSED"]), employeeCount: z.number().int().min(0),
  grossAmount: hrAmountSchema, advanceSettlementAmount: hrAmountSchema, administrativeDeductionAmount: hrAmountSchema, netPayableAmount: hrAmountSchema, paidAmount: hrAmountSchema,
  notes: z.string().max(2_000).nullable(), accrualJournalEntryId: z.string().uuid().nullable(),
}).strict();
export const hrPayrollRunDetailSchema = z.object({ payrollRun: hrPayrollRunSchema, lines: z.array(hrPayrollLineSchema).max(1_000), payments: z.array(hrPayrollPaymentSchema).max(500) }).strict();

export const hrEmployeeDetailQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
}).strict();

const hrPageQueryShape = { cursor: z.string().uuid().optional(), pageSize: z.coerce.number().int().min(1).max(100).optional().default(50) };
export const hrEmployeeAdvanceDetailQuerySchema = z.object({ settlementCursor: z.string().uuid().optional(), settlementPageSize: z.coerce.number().int().min(1).max(100).optional().default(50), deferralCursor: z.string().uuid().optional(), deferralPageSize: z.coerce.number().int().min(1).max(100).optional().default(50) }).strict();
export const hrEmployeeAdministrativeDeductionDetailQuerySchema = z.object({ actionCursor: z.string().uuid().optional(), actionPageSize: z.coerce.number().int().min(1).max(100).optional().default(50) }).strict();
export const hrEmployeeCompensationHistoryQuerySchema = z.object({ ...hrPageQueryShape }).strict();
export const hrEmployeesQuerySchema = z.object({ ...hrPageQueryShape, status: hrEmployeeStatusSchema.optional(), search: hrSearchSchema.optional() }).strict();
export const hrEmployeeAdvancesQuerySchema = z.object({ ...hrPageQueryShape, employeeId: hrEmployeeIdSchema.optional(), status: hrEmployeeAdvanceStatusSchema.optional(), search: hrSearchSchema.optional() }).strict();
export const hrEmployeeAdministrativeDeductionsQuerySchema = z.object({ ...hrPageQueryShape, employeeId: hrEmployeeIdSchema.optional(), status: hrEmployeeAdministrativeDeductionStatusSchema.optional(), search: hrSearchSchema.optional() }).strict();
export const hrEmployeeLeavesQuerySchema = z.object({ ...hrPageQueryShape, employeeId: hrEmployeeIdSchema.optional(), status: hrEmployeeLeaveStatusSchema.optional(), leaveType: hrEmployeeLeaveTypeSchema.optional(), periodFrom: businessDateSchema.transform((value) => new Date(`${value}T00:00:00.000Z`)).optional(), periodTo: businessDateSchema.transform((value) => new Date(`${value}T00:00:00.000Z`)).optional(), search: hrSearchSchema.optional(), sortDirection: z.enum(['asc', 'desc']).optional().default('desc') }).strict();
export const hrPayrollRunsQuerySchema = z.object({ ...hrPageQueryShape, status: z.enum(["DRAFT", "APPROVED", "PARTIALLY_PAID", "PAID", "REVERSED"]).optional(), periodFrom: businessDateSchema.transform((value) => new Date(`${value}T00:00:00.000Z`)).optional(), periodTo: businessDateSchema.transform((value) => new Date(`${value}T00:00:00.000Z`)).optional(), search: hrSearchSchema.optional() }).strict();
export const hrPayrollRunDetailQuerySchema = z.object({
  lineCursor: z.string().uuid().optional(),
  linePageSize: z.coerce.number().int().min(1).max(1_000).optional().default(1_000),
  paymentCursor: z.string().uuid().optional(),
  paymentPageSize: z.coerce.number().int().min(1).max(500).optional().default(500),
}).strict();
export const hrEmployeePayrollHistoryQuerySchema = z.object({ ...hrPageQueryShape }).strict();

export const hrEmployeesReceiptSchema = z.object({
  companyId: companyIdSchema,
  employees: z.array(hrEmployeeSchema).max(100),
  hasMore: z.boolean(),
  nextCursor: z.string().uuid().nullable(),
  summary: z.object({ activeEmployees: z.number().int().nonnegative(), employeesOnLeave: z.number().int().nonnegative(), openAdvances: z.number().int().nonnegative(), openAdministrativeDeductions: z.number().int().nonnegative() }).strict(),
}).strict();
export const hrEmployeeAdvancesReceiptSchema = z.object({ companyId: companyIdSchema, advances: z.array(hrEmployeeAdvanceSchema).max(100), hasMore: z.boolean(), nextCursor: z.string().uuid().nullable() }).strict();
export const hrEmployeeAdministrativeDeductionsReceiptSchema = z.object({ companyId: companyIdSchema, deductions: z.array(hrEmployeeAdministrativeDeductionSchema).max(100), hasMore: z.boolean(), nextCursor: z.string().uuid().nullable() }).strict();
export const hrEmployeeLeavesReceiptSchema = z.object({ companyId: companyIdSchema, leaves: z.array(hrEmployeeLeaveSchema).max(100), hasMore: z.boolean(), nextCursor: z.string().uuid().nullable(), summary: z.object({ count: z.number().int().nonnegative(), onLeaveNow: z.number().int().nonnegative(), upcoming: z.number().int().nonnegative(), returned: z.number().int().nonnegative() }).strict() }).strict();
export const hrEmployeeLeaveDetailReceiptSchema = z.object({ companyId: companyIdSchema, leave: hrEmployeeLeaveSchema }).strict();
export const hrEmployeeAdvanceDetailReceiptSchema = z.object({ companyId: companyIdSchema, ...hrEmployeeAdvanceDetailSchema.shape }).strict();
export const hrEmployeeAdministrativeDeductionDetailReceiptSchema = z.object({ companyId: companyIdSchema, ...hrEmployeeAdministrativeDeductionDetailSchema.shape }).strict();
export const hrEmployeeCompensationProfileReceiptSchema = z.object({ id: z.string().uuid(), replayed: z.boolean() }).strict();
export const hrEmployeeCompensationHistoryReceiptSchema = z.object({ companyId: companyIdSchema, compensationHistory: z.array(hrEmployeeCompensationProfileSchema).max(100), hasMore: z.boolean(), nextCursor: z.string().uuid().nullable() }).strict();
export const hrPayrollRunsReceiptSchema = z.object({ companyId: companyIdSchema, payrollRuns: z.array(hrPayrollRunSchema).max(100), hasMore: z.boolean(), nextCursor: z.string().uuid().nullable(), summary: z.object({ count: z.number().int().nonnegative(), cancelledCount: z.number().int().nonnegative(), grossAmount: hrAmountSchema, advanceSettlementAmount: hrAmountSchema, administrativeDeductionAmount: hrAmountSchema, netPayableAmount: hrAmountSchema }).strict() }).strict();
export const hrPayrollRunDetailReceiptSchema = z.object({
  companyId: companyIdSchema,
  ...hrPayrollRunDetailSchema.shape,
  hasMoreLines: z.boolean(),
  nextLineCursor: z.string().uuid().nullable(),
  hasMorePayments: z.boolean(),
  nextPaymentCursor: z.string().uuid().nullable(),
}).strict();
export const hrEmployeePayrollHistoryReceiptSchema = z.object({ companyId: companyIdSchema, lines: z.array(hrEmployeePayrollHistoryLineSchema).max(100), hasMore: z.boolean(), nextCursor: z.string().uuid().nullable() }).strict();
export const hrPayrollRunReceiptSchema = z.object({ id: z.string().uuid(), runNumber: z.string().max(80), replayed: z.boolean() }).strict();
export const hrPayrollPaymentReversalReceiptSchema = z.object({ id: z.string().uuid(), runNumber: z.string().max(80), paymentId: z.string().uuid(), reversalJournalEntryId: z.string().uuid(), replayed: z.boolean() }).strict();
const hrPayrollPreviewApplicationSchema = z.object({ id: z.string().uuid(), referenceNumber: z.string().max(80), remainingAmount: hrAmountSchema }).strict();
export const hrPayrollPreviewEmployeeSchema = z.object({
  id: hrEmployeeIdSchema, employeeNumber: z.string().max(80), nameAr: z.string().max(160), nameEn: z.string().max(160).nullable(),
  status: z.enum(["ACTIVE", "ON_LEAVE"]), included: z.boolean(),
  reason: z.enum(["ACTIVE_WITH_VALID_COMPENSATION", "ACTIVE_NEW_HIRE_PRORATED", "ACTIVE_MISSING_COMPENSATION", "COMPENSATION_DOES_NOT_COVER_PAYROLL_PERIOD", "HIRED_AFTER_BUSINESS_DATE", "ON_LEAVE_EXPLICITLY_INCLUDED", "ON_LEAVE_REQUIRES_EXPLICIT_INCLUSION", "ON_LEAVE_MISSING_COMPENSATION"]),
  eligibilityCode: hrPayrollLineEligibilityCodeSchema.nullable(),
  calculationPeriodStart: businessDateSchema.nullable(), calculationPeriodEnd: businessDateSchema.nullable(),
  eligibleDays: z.number().int().positive().nullable(), calendarDaysInMonth: z.number().int().positive().nullable(),
  prorationRatio: hrAmountSchema.nullable(), monthlyGrossAmount: hrAmountSchema.nullable(), estimatedGrossAmount: hrAmountSchema.nullable(),
  advances: z.array(hrPayrollPreviewApplicationSchema).max(100),
  advanceCount: z.number().int().nonnegative(), hasMoreAdvances: z.boolean(),
  administrativeDeductions: z.array(hrPayrollPreviewApplicationSchema).max(100),
  administrativeDeductionCount: z.number().int().nonnegative(), hasMoreAdministrativeDeductions: z.boolean(),
}).strict();
export const hrPayrollPreviewReceiptSchema = z.object({
  companyId: companyIdSchema,
  counts: z.object({ active: z.number().int().nonnegative(), onLeave: z.number().int().nonnegative(), included: z.number().int().nonnegative(), excluded: z.number().int().nonnegative(), exceptions: z.number().int().nonnegative() }).strict(),
  totals: z.object({ employeeCount: z.number().int().nonnegative(), grossAmount: hrAmountSchema, advanceSettlementAmount: hrAmountSchema, administrativeDeductionAmount: hrAmountSchema, netPayableAmount: hrAmountSchema }).strict(),
  exceptions: z.array(z.object({ employeeId: hrEmployeeIdSchema, employeeNumber: z.string().max(80), employeeNameAr: z.string().max(160), reason: z.enum(["ACTIVE_MISSING_COMPENSATION", "ON_LEAVE_MISSING_COMPENSATION", "COMPENSATION_DOES_NOT_COVER_PAYROLL_PERIOD", "HIRED_AFTER_BUSINESS_DATE"]) }).strict()).max(100),
  employees: z.array(hrPayrollPreviewEmployeeSchema).max(100), hasMore: z.boolean(), nextCursor: z.string().uuid().nullable(),
}).strict();
export const hrEmployeeDetailReceiptSchema = z.object({
  companyId: companyIdSchema,
  employee: hrEmployeeSchema,
  compensation: hrEmployeeCompensationProfileSchema.nullable(),
  /** Immutable salary history shown in the employee file; it never rewrites payroll snapshots. */
  compensationHistory: z.array(hrEmployeeCompensationProfileSchema).max(100),
  compensationHistoryCount: z.number().int().nonnegative(),
  services: z.array(hrEmployeeServiceSchema).max(500),
  serviceCount: z.number().int().nonnegative(),
  servicesHasMore: z.boolean(),
  movements: z.array(hrEmployeeFinancialMovementSchema).max(100),
  movementCount: z.number().int().nonnegative(),
  hasMoreMovements: z.boolean(),
  nextMovementCursor: z.string().uuid().nullable(),
}).strict();
export const hrEmployeeEntityReceiptSchema = z.object({ id: z.string().uuid(), replayed: z.boolean() }).strict();
export const hrEmployeeAdvanceIssueReceiptSchema = z.object({ id: z.string().uuid(), advanceNumber: z.string().min(1).max(80), journalEntryId: z.string().uuid(), replayed: z.boolean() }).strict();
export const hrEmployeeAdvanceReversalReceiptSchema = z.object({ id: z.string().uuid(), advanceNumber: z.string().min(1).max(80), reversalJournalEntryId: z.string().uuid(), replayed: z.boolean() }).strict();
export const hrEmployeeAdvanceSettlementReceiptSchema = z.object({ id: z.string().uuid(), settlementNumber: z.string().min(1).max(80), advanceId: z.string().uuid(), journalEntryId: z.string().uuid(), remainingAmount: hrAmountSchema, replayed: z.boolean() }).strict();
export const hrEmployeeAdvanceDeferralReceiptSchema = z.object({ id: z.string().uuid(), advanceId: z.string().uuid(), deferredUntil: businessDateSchema, replayed: z.boolean() }).strict();
export const hrEmployeeAdministrativeDeductionReceiptSchema = z.object({ id: z.string().uuid(), deductionNumber: z.string().min(1).max(80), replayed: z.boolean() }).strict();
export const hrEmployeeLeaveReceiptSchema = z.object({ id: z.string().uuid(), replayed: z.boolean() }).strict();
export const hrEmployeePromotionReceiptSchema = z.object({ id: z.string().uuid(), replayed: z.boolean() }).strict();
export const hrEmployeePromotionsReceiptSchema = z.object({ companyId: companyIdSchema, promotions: z.array(hrEmployeePromotionSchema).max(100), hasMore: z.boolean(), nextCursor: z.string().uuid().nullable() }).strict();
export const hrCompensationPoliciesReceiptSchema = z.object({ companyId: companyIdSchema, policies: z.array(hrCompensationPolicySchema).max(100) }).strict();
export const hrCompensationPolicyReceiptSchema = z.object({ id: z.string().uuid(), policyVersionId: z.string().uuid(), replayed: z.boolean() }).strict();
export const hrEmployeeServicesReceiptSchema = z.object({ companyId: companyIdSchema, services: z.array(hrEmployeeServiceSchema).max(100), hasMore: z.boolean(), nextCursor: z.string().uuid().nullable(), summary: z.object({ count: z.number().int().nonnegative(), expired: z.number().int().nonnegative(), due30: z.number().int().nonnegative(), due90: z.number().int().nonnegative() }).strict() }).strict();
export const hrEmployeeServiceDetailReceiptSchema = z.object({ companyId: companyIdSchema, service: hrEmployeeServiceSchema }).strict();
export const hrEmployeeServiceReceiptSchema = z.object({ id: z.string().uuid(), replayed: z.boolean() }).strict();
export const hrEmployeeServiceCostReversalReceiptSchema = z.object({ serviceId: z.string().uuid(), documentId: z.string().uuid(), documentNumber: z.string().max(80), reversalJournalEntryId: z.string().uuid(), replayed: z.boolean() }).strict();
export const hrEmployeeDocumentSchema = z.object({
  id: z.string().uuid(), employeeId: hrEmployeeIdSchema, documentType: hrEmployeeDocumentTypeSchema, status: hrEmployeeDocumentStatusSchema,
  title: z.string().max(240), referenceNumber: z.string().max(160).nullable(), issueDate: businessDateSchema.nullable(), expiryDate: businessDateSchema.nullable(),
  notes: z.string().max(2_000).nullable(), linkedServiceId: z.string().uuid().nullable(), retentionUntil: businessDateSchema.nullable(), legalHold: z.boolean(),
  complianceStatus: hrEmployeeDocumentComplianceStatusSchema,
  currentVersion: z.object({ id: z.string().uuid(), version: z.number().int().positive(), blobStatus: hrEmployeeDocumentBlobStatusSchema, mimeType: z.string().max(127), byteSize: z.string().regex(/^\d+$/), sha256: z.string().length(64), createdAt: z.string().datetime() }).nullable(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), revokedAt: z.string().datetime().nullable(), revokedReason: z.string().max(1_000).nullable(),
}).strict();
export const hrEmployeeDocumentsReceiptSchema = z.object({ companyId: companyIdSchema, documents: z.array(hrEmployeeDocumentSchema).max(100), hasMore: z.boolean(), nextCursor: z.string().uuid().nullable() }).strict();
export const hrEmployeeDocumentReceiptSchema = z.object({ id: z.string().uuid(), versionId: z.string().uuid(), replayed: z.boolean() }).strict();
export const hrEmployeeOnboardingReceiptSchema = z.object({ id: z.string().uuid(), compensationId: z.string().uuid(), replayed: z.boolean() }).strict();
export const hrEmployeeLetterSchema = z.object({ id: z.string().uuid(), employeeId: hrEmployeeIdSchema, letterType: hrEmployeeLetterTypeSchema, status: hrEmployeeLetterStatusSchema, letterNumber: z.string().max(80), locale: z.enum(["ar", "en"]), recipient: z.string().max(240).nullable(), issuedAt: z.string().datetime(), revokedAt: z.string().datetime().nullable(), revokedReason: z.string().max(1_000).nullable(), outputReportCode: z.literal("hr.employee-letter") }).strict();
export const hrEmployeeLettersReceiptSchema = z.object({ companyId: companyIdSchema, letters: z.array(hrEmployeeLetterSchema).max(100), hasMore: z.boolean(), nextCursor: z.string().uuid().nullable() }).strict();
export const hrEmployeeLetterReceiptSchema = z.object({ id: z.string().uuid(), letterNumber: z.string().max(80), outputReportCode: z.literal("hr.employee-letter"), replayed: z.boolean() }).strict();
export const hrFinalSettlementPreviewSchema = z.object({ employeeId: hrEmployeeIdSchema, terminationDate: businessDateSchema, terminationReason: hrFinalSettlementReasonSchema, reasonEvidenceReference: z.string().min(1).max(240), reasonVerificationStatus: hrFinalSettlementReasonVerificationStatusSchema, serviceDays: z.number().int().nonnegative(), eosWage: hrAmountSchema, fullAwardAmount: hrAmountSchema, entitlementFactor: hrFactorSchema, eosAmount: hrAmountSchema, otherCreditsAmount: hrAmountSchema, recoveryAmount: hrAmountSchema, netPayableAmount: hrAmountSchema, calculationPolicyVersion: z.literal("SA-EOS-V1") }).strict();
export const hrFinalSettlementSchema = hrFinalSettlementPreviewSchema.extend({ id: z.string().uuid(), settlementNumber: z.string().max(80), status: hrFinalSettlementStatusSchema, paidAmount: hrAmountSchema, createdAt: z.string().datetime(), approvedAt: z.string().datetime().nullable(), approvedByUserId: z.string().uuid().nullable(), reversedByUserId: z.string().uuid().nullable(), outputReportCode: z.literal("hr.final-settlement") }).strict();
export const hrFinalSettlementPaymentSchema = z.object({
  id: z.string().uuid(), paymentNumber: z.string().max(80), businessDate: businessDateSchema, amount: hrAmountSchema, journalEntryId: z.string().uuid(),
  status: hrPaymentPostingStatusSchema, reversedAt: z.string().datetime().nullable(), reversalJournalEntryId: z.string().uuid().nullable(),
}).strict();
export const hrFinalSettlementsReceiptSchema = z.object({ companyId: companyIdSchema, settlements: z.array(hrFinalSettlementSchema).max(100), hasMore: z.boolean(), nextCursor: z.string().uuid().nullable() }).strict();
export const hrFinalSettlementDetailReceiptSchema = z.object({ companyId: companyIdSchema, settlement: hrFinalSettlementSchema, payments: z.array(hrFinalSettlementPaymentSchema).max(100), hasMorePayments: z.boolean(), nextPaymentCursor: z.string().uuid().nullable() }).strict();
export const hrFinalSettlementReceiptSchema = z.object({ id: z.string().uuid(), settlementNumber: z.string().max(80), replayed: z.boolean() }).strict();
export const hrFinalSettlementPaymentReversalReceiptSchema = z.object({ id: z.string().uuid(), settlementNumber: z.string().max(80), paymentId: z.string().uuid(), reversalJournalEntryId: z.string().uuid(), replayed: z.boolean() }).strict();

const hrOverviewPayrollRunSchema = z.object({
  id: z.string().uuid(), runNumber: z.string().max(80), payrollMonth: businessDateSchema,
  status: z.enum(["DRAFT", "APPROVED", "PARTIALLY_PAID", "PAID", "REVERSED"]),
}).strict();
const hrOverviewServiceItemSchema = z.object({
  id: z.string().uuid(), employeeId: hrEmployeeIdSchema, employeeNameAr: z.string().max(160), employeeNameEn: z.string().max(160).nullable(),
  serviceType: hrEmployeeServiceTypeSchema, expiryDate: businessDateSchema,
}).strict();
const hrOverviewLeaveItemSchema = z.object({
  id: z.string().uuid(), employeeId: hrEmployeeIdSchema, employeeNameAr: z.string().max(160), employeeNameEn: z.string().max(160).nullable(),
  leaveType: hrEmployeeLeaveTypeSchema, startDate: businessDateSchema, endDate: businessDateSchema,
}).strict();
const hrOverviewFinalSettlementItemSchema = z.object({
  id: z.string().uuid(), settlementNumber: z.string().max(80), terminationDate: businessDateSchema, status: hrFinalSettlementStatusSchema,
}).strict();

/**
 * Company-scoped HR landing projection. A null section means the caller does
 * not hold that section's read capability; counts always come from full-scope
 * aggregates while action lists remain deliberately bounded.
 */
export const hrOverviewReceiptSchema = z.object({
  companyId: companyIdSchema,
  businessDate: businessDateSchema,
  workforce: z.object({ activeEmployees: z.number().int().nonnegative(), employeesOnLeave: z.number().int().nonnegative() }).strict().nullable(),
  financial: z.object({ openAdvances: z.number().int().nonnegative().nullable(), openAdministrativeDeductions: z.number().int().nonnegative().nullable() }).strict().nullable(),
  payroll: z.object({
    draftCount: z.number().int().nonnegative(), awaitingPaymentCount: z.number().int().nonnegative(),
    recentRuns: z.array(hrOverviewPayrollRunSchema).max(4),
  }).strict().nullable(),
  services: z.object({ expiredCount: z.number().int().nonnegative(), expiringCount: z.number().int().nonnegative(), attentionItems: z.array(hrOverviewServiceItemSchema).max(4) }).strict().nullable(),
  leaves: z.object({ openCount: z.number().int().nonnegative(), actionItems: z.array(hrOverviewLeaveItemSchema).max(4) }).strict().nullable(),
  finalSettlements: z.object({ openCount: z.number().int().nonnegative(), actionItems: z.array(hrOverviewFinalSettlementItemSchema).max(4) }).strict().nullable(),
}).strict();

export type CreateHrEmployeeRequest = z.infer<typeof createHrEmployeeRequestSchema>;
export type OnboardHrEmployeeRequest = z.infer<typeof onboardHrEmployeeRequestSchema>;
export type UpdateHrEmployeeRequest = z.infer<typeof updateHrEmployeeRequestSchema>;
export type CreateHrEmployeePromotionRequest = z.infer<typeof createHrEmployeePromotionRequestSchema>;
export type CreateHrEmployeeServiceRequest = z.infer<typeof createHrEmployeeServiceRequestSchema>;
export type UpdateHrEmployeeServiceRequest = z.infer<typeof updateHrEmployeeServiceRequestSchema>;
export type CancelHrEmployeeServiceRequest = z.infer<typeof cancelHrEmployeeServiceRequestSchema>;
export type RenewHrEmployeeServiceRequest = z.infer<typeof renewHrEmployeeServiceRequestSchema>;
export type IssueHrEmployeeServiceCostRequest = z.infer<typeof issueHrEmployeeServiceCostRequestSchema>;
export type RecordHrEmployeeServiceAndIssueCostRequest = z.infer<typeof recordHrEmployeeServiceAndIssueCostRequestSchema>;
export type ReverseHrEmployeeServiceCostRequest = z.infer<typeof reverseHrEmployeeServiceCostRequestSchema>;
export type HrEmployeeServiceCostStatus = z.infer<typeof hrEmployeeServiceCostStatusSchema>;
export type IssueHrEmployeeAdvanceRequest = z.infer<typeof issueHrEmployeeAdvanceRequestSchema>;
export type ReverseHrEmployeeAdvanceIssueRequest = z.infer<typeof reverseHrEmployeeAdvanceIssueRequestSchema>;
export type SettleHrEmployeeAdvanceDirectlyRequest = z.infer<typeof settleHrEmployeeAdvanceDirectlyRequestSchema>;
export type DeferHrEmployeeAdvanceRequest = z.infer<typeof deferHrEmployeeAdvanceRequestSchema>;
export type CreateHrEmployeeAdministrativeDeductionRequest = z.infer<typeof createHrEmployeeAdministrativeDeductionRequestSchema>;
export type DeferHrEmployeeAdministrativeDeductionRequest = z.infer<typeof deferHrEmployeeAdministrativeDeductionRequestSchema>;
export type CancelHrEmployeeAdministrativeDeductionRequest = z.infer<typeof cancelHrEmployeeAdministrativeDeductionRequestSchema>;
export type SetHrEmployeeCompensationRequest = z.infer<typeof setHrEmployeeCompensationRequestSchema>;
export type CreateHrCompensationPolicyRequest = z.infer<typeof createHrCompensationPolicyRequestSchema>;
export type CreateHrCompensationPolicyVersionRequest = z.infer<typeof createHrCompensationPolicyVersionRequestSchema>;
export type ApproveHrCompensationPolicyVersionRequest = z.infer<typeof approveHrCompensationPolicyVersionRequestSchema>;
export type CreateHrPayrollRunRequest = z.infer<typeof createHrPayrollRunRequestSchema>;
export type UpdateHrPayrollDraftRequest = z.infer<typeof updateHrPayrollDraftRequestSchema>;
export type PreviewHrPayrollRunRequest = z.infer<typeof previewHrPayrollRunRequestSchema>;
export type ApproveHrPayrollRunRequest = z.infer<typeof approveHrPayrollRunRequestSchema>;
export type DiscardHrPayrollRunRequest = z.infer<typeof discardHrPayrollRunRequestSchema>;
export type PayHrPayrollRunRequest = z.infer<typeof payHrPayrollRunRequestSchema>;
export type ReverseHrPayrollRunRequest = z.infer<typeof reverseHrPayrollRunRequestSchema>;
export type ReverseHrPayrollPaymentRequest = z.infer<typeof reverseHrPayrollPaymentRequestSchema>;
export type CreateHrEmployeeLeaveRequest = z.infer<typeof createHrEmployeeLeaveRequestSchema>;
export type ReturnHrEmployeeLeaveRequest = z.infer<typeof returnHrEmployeeLeaveRequestSchema>;
export type CreateHrEmployeeDocumentRequest = z.infer<typeof createHrEmployeeDocumentRequestSchema>;
export type ReplaceHrEmployeeDocumentRequest = z.infer<typeof replaceHrEmployeeDocumentRequestSchema>;
export type RevokeHrEmployeeDocumentRequest = z.infer<typeof revokeHrEmployeeDocumentRequestSchema>;
export type IssueHrEmployeeLetterRequest = z.infer<typeof issueHrEmployeeLetterRequestSchema>;
export type RevokeHrEmployeeLetterRequest = z.infer<typeof revokeHrEmployeeLetterRequestSchema>;
export type PreviewHrFinalSettlementRequest = z.infer<typeof previewHrFinalSettlementRequestSchema>;
export type CreateHrFinalSettlementRequest = z.infer<typeof createHrFinalSettlementRequestSchema>;
export type ApproveHrFinalSettlementRequest = z.infer<typeof approveHrFinalSettlementRequestSchema>;
export type VerifyHrFinalSettlementReasonRequest = z.infer<typeof verifyHrFinalSettlementReasonRequestSchema>;
export type PayHrFinalSettlementRequest = z.infer<typeof payHrFinalSettlementRequestSchema>;
export type ReverseHrFinalSettlementRequest = z.infer<typeof reverseHrFinalSettlementRequestSchema>;
export type ReverseHrFinalSettlementPaymentRequest = z.infer<typeof reverseHrFinalSettlementPaymentRequestSchema>;
export type HrFinalSettlementDetailQuery = z.infer<typeof hrFinalSettlementDetailQuerySchema>;
export type HrPaymentPostingStatus = z.infer<typeof hrPaymentPostingStatusSchema>;
export type HrPayrollPayment = z.infer<typeof hrPayrollPaymentSchema>;
export type HrFinalSettlementPayment = z.infer<typeof hrFinalSettlementPaymentSchema>;
export type HrFinalSettlementDetailReceipt = z.infer<typeof hrFinalSettlementDetailReceiptSchema>;
export type HrOverviewReceipt = z.infer<typeof hrOverviewReceiptSchema>;
