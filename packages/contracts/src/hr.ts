import { z } from "zod";

import { businessDateSchema } from "./business-date.js";
import { companyIdSchema } from "./identity.js";

const idempotencyKeySchema = z.string().trim().min(1).max(255);
const hrDateSchema = businessDateSchema.transform((value) => new Date(`${value}T00:00:00.000Z`));
export const hrEmployeeIdSchema = z.string().uuid();
const hrAmountSchema = z.string().trim().regex(/^\d+(?:\.\d{1,4})?$/).max(32);

export const hrEmployeeStatusSchema = z.enum(["ACTIVE", "ON_LEAVE", "TERMINATED", "ARCHIVED"]);
export const hrEmployeeServiceStatusSchema = z.enum(["DRAFT", "ISSUED", "CANCELLED"]);
export const hrEmployeeAdvanceStatusSchema = z.enum(["ISSUED", "PARTIALLY_SETTLED", "SETTLED", "REVERSED"]);
export const hrEmployeeAdministrativeDeductionStatusSchema = z.enum(["OPEN", "PARTIALLY_APPLIED", "APPLIED", "DEFERRED", "CANCELLED"]);
export const hrEmployeeServiceTypeSchema = z.enum([
  "IQAMA_RENEWAL",
  "SPONSORSHIP_TRANSFER",
  "EXIT_REENTRY_VISA",
  "FLIGHT_TICKET",
  "MEDICAL_INSURANCE",
  "HEALTH_CERTIFICATE",
  "OTHER",
]);

export const createHrEmployeeRequestSchema = z.object({
  employeeNumber: z.string().trim().min(1).max(80),
  nameAr: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().max(160).optional(),
  jobTitle: z.string().trim().max(160).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.string().trim().email().max(254).optional(),
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
  status: hrEmployeeStatusSchema,
  terminatedAt: hrDateSchema.nullable().optional(),
  notes: z.string().trim().max(2_000).nullable().optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const createHrEmployeeServiceRequestSchema = z.object({
  employeeId: hrEmployeeIdSchema,
  serviceType: hrEmployeeServiceTypeSchema,
  referenceNumber: z.string().trim().max(160).optional(),
  issueDate: hrDateSchema.optional(),
  expiryDate: hrDateSchema.optional(),
  supplierId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  notes: z.string().trim().max(2_000).optional(),
  idempotencyKey: idempotencyKeySchema,
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

/** Effective-dated monthly gross compensation. Payroll only reads this server record. */
export const setHrEmployeeCompensationRequestSchema = z.object({
  employeeId: hrEmployeeIdSchema,
  effectiveFrom: hrDateSchema,
  monthlyGross: hrAmountSchema.refine((value) => Number(value) > 0),
  notes: z.string().trim().max(1_000).optional(),
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
  lines: z.array(payrollLineRequestSchema).min(1).max(1_000),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const approveHrPayrollRunRequestSchema = z.object({
  payrollRunId: z.string().uuid(),
  businessDate: hrDateSchema,
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

export const hrEmployeeSchema = z.object({
  id: hrEmployeeIdSchema,
  employeeNumber: z.string().min(1).max(80),
  nameAr: z.string().min(1).max(160),
  nameEn: z.string().max(160).nullable(),
  jobTitle: z.string().max(160).nullable(),
  phone: z.string().max(30).nullable(),
  email: z.string().max(254).nullable(),
  hireDate: businessDateSchema,
  status: hrEmployeeStatusSchema,
  terminatedAt: businessDateSchema.nullable(),
  notes: z.string().max(2_000).nullable(),
}).strict();

export const hrEmployeeServiceSchema = z.object({
  id: z.string().uuid(),
  employeeId: hrEmployeeIdSchema,
  serviceType: hrEmployeeServiceTypeSchema,
  referenceNumber: z.string().max(160).nullable(),
  issueDate: businessDateSchema.nullable(),
  expiryDate: businessDateSchema.nullable(),
  supplier: z.object({ id: z.string().uuid(), nameAr: z.string(), nameEn: z.string().nullable() }).nullable(),
  category: z.object({ id: z.string().uuid(), nameAr: z.string(), nameEn: z.string() }).nullable(),
  outflowDocumentId: z.string().uuid().nullable(),
  status: hrEmployeeServiceStatusSchema,
  notes: z.string().max(2_000).nullable(),
}).strict();

export const hrEmployeeFinancialMovementSchema = z.object({
  id: z.string().uuid(),
  journalEntryId: z.string().uuid(),
  movementType: z.enum(["SERVICE_COST", "PAYROLL_ACCRUAL", "PAYROLL_PAYMENT", "ADVANCE_ISSUED", "ADVANCE_SETTLEMENT"]),
  businessDate: businessDateSchema,
  amount: hrAmountSchema,
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
  settlements: z.array(z.object({ id: z.string().uuid(), source: z.enum(["PAYROLL", "MANUAL_RECEIPT"]), businessDate: businessDateSchema, amount: hrAmountSchema, journalEntryId: z.string().uuid().nullable(), sourceReference: z.string().max(160).nullable() }).strict()).max(500),
  deferrals: z.array(z.object({ id: z.string().uuid(), businessDate: businessDateSchema, deferredUntil: businessDateSchema, reason: z.string().max(1_000) }).strict()).max(500),
}).strict();

export const hrEmployeeAdministrativeDeductionDetailSchema = z.object({
  deduction: hrEmployeeAdministrativeDeductionSchema,
  actions: z.array(z.object({ id: z.string().uuid(), actionType: z.enum(["CREATED", "DEFERRED", "CANCELLED", "APPLIED", "REVERSED"]), businessDate: businessDateSchema, amount: hrAmountSchema.nullable(), plannedPayrollDate: businessDateSchema.nullable(), reason: z.string().max(1_000).nullable() }).strict()).max(500),
}).strict();

export const hrEmployeeCompensationProfileSchema = z.object({
  id: z.string().uuid(), employeeId: hrEmployeeIdSchema, effectiveFrom: businessDateSchema,
  effectiveTo: businessDateSchema.nullable(), monthlyGross: hrAmountSchema, notes: z.string().max(1_000).nullable(),
}).strict();

const hrPayrollApplicationDetailSchema = z.object({ id: z.string().uuid(), amount: hrAmountSchema, referenceNumber: z.string().max(80) }).strict();
export const hrPayrollLineSchema = z.object({
  id: z.string().uuid(), employeeId: hrEmployeeIdSchema, employeeNumber: z.string().max(80), employeeNameAr: z.string().max(160), employeeNameEn: z.string().max(160).nullable(),
  grossSalary: hrAmountSchema, advanceSettlementAmount: hrAmountSchema, administrativeDeductionAmount: hrAmountSchema, netPayableAmount: hrAmountSchema, paidAmount: hrAmountSchema,
  advances: z.array(hrPayrollApplicationDetailSchema).max(100), administrativeDeductions: z.array(hrPayrollApplicationDetailSchema).max(100),
}).strict();
export const hrPayrollRunSchema = z.object({
  id: z.string().uuid(), runNumber: z.string().max(80), payrollMonth: businessDateSchema, businessDate: businessDateSchema,
  status: z.enum(["DRAFT", "APPROVED", "PARTIALLY_PAID", "PAID", "REVERSED"]), employeeCount: z.number().int().min(0),
  grossAmount: hrAmountSchema, advanceSettlementAmount: hrAmountSchema, administrativeDeductionAmount: hrAmountSchema, netPayableAmount: hrAmountSchema, paidAmount: hrAmountSchema,
  notes: z.string().max(2_000).nullable(), accrualJournalEntryId: z.string().uuid().nullable(),
}).strict();
export const hrPayrollRunDetailSchema = z.object({ payrollRun: hrPayrollRunSchema, lines: z.array(hrPayrollLineSchema).max(1_000), payments: z.array(z.object({ id: z.string().uuid(), paymentNumber: z.string().max(80), businessDate: businessDateSchema, amount: hrAmountSchema, journalEntryId: z.string().uuid() }).strict()).max(500) }).strict();

export const hrEmployeeDetailQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
}).strict();

export const hrEmployeesReceiptSchema = z.object({ companyId: companyIdSchema, employees: z.array(hrEmployeeSchema).max(500) }).strict();
export const hrEmployeeAdvancesReceiptSchema = z.object({ companyId: companyIdSchema, advances: z.array(hrEmployeeAdvanceSchema).max(500) }).strict();
export const hrEmployeeAdministrativeDeductionsReceiptSchema = z.object({ companyId: companyIdSchema, deductions: z.array(hrEmployeeAdministrativeDeductionSchema).max(500) }).strict();
export const hrEmployeeAdvanceDetailReceiptSchema = z.object({ companyId: companyIdSchema, ...hrEmployeeAdvanceDetailSchema.shape }).strict();
export const hrEmployeeAdministrativeDeductionDetailReceiptSchema = z.object({ companyId: companyIdSchema, ...hrEmployeeAdministrativeDeductionDetailSchema.shape }).strict();
export const hrEmployeeCompensationProfileReceiptSchema = z.object({ id: z.string().uuid(), replayed: z.boolean() }).strict();
export const hrPayrollRunsReceiptSchema = z.object({ companyId: companyIdSchema, payrollRuns: z.array(hrPayrollRunSchema).max(500) }).strict();
export const hrPayrollRunDetailReceiptSchema = z.object({ companyId: companyIdSchema, ...hrPayrollRunDetailSchema.shape }).strict();
export const hrPayrollRunReceiptSchema = z.object({ id: z.string().uuid(), runNumber: z.string().max(80), replayed: z.boolean() }).strict();
export const hrEmployeeDetailReceiptSchema = z.object({
  companyId: companyIdSchema,
  employee: hrEmployeeSchema,
  services: z.array(hrEmployeeServiceSchema).max(500),
  movements: z.array(hrEmployeeFinancialMovementSchema).max(100),
  hasMoreMovements: z.boolean(),
  nextMovementCursor: z.string().uuid().nullable(),
}).strict();
export const hrEmployeeEntityReceiptSchema = z.object({ id: z.string().uuid(), replayed: z.boolean() }).strict();
export const hrEmployeeAdvanceIssueReceiptSchema = z.object({ id: z.string().uuid(), advanceNumber: z.string().min(1).max(80), journalEntryId: z.string().uuid(), replayed: z.boolean() }).strict();
export const hrEmployeeAdvanceSettlementReceiptSchema = z.object({ id: z.string().uuid(), settlementNumber: z.string().min(1).max(80), advanceId: z.string().uuid(), journalEntryId: z.string().uuid(), remainingAmount: hrAmountSchema, replayed: z.boolean() }).strict();
export const hrEmployeeAdvanceDeferralReceiptSchema = z.object({ id: z.string().uuid(), advanceId: z.string().uuid(), deferredUntil: businessDateSchema, replayed: z.boolean() }).strict();
export const hrEmployeeAdministrativeDeductionReceiptSchema = z.object({ id: z.string().uuid(), deductionNumber: z.string().min(1).max(80), replayed: z.boolean() }).strict();

export type CreateHrEmployeeRequest = z.infer<typeof createHrEmployeeRequestSchema>;
export type UpdateHrEmployeeRequest = z.infer<typeof updateHrEmployeeRequestSchema>;
export type CreateHrEmployeeServiceRequest = z.infer<typeof createHrEmployeeServiceRequestSchema>;
export type IssueHrEmployeeServiceCostRequest = z.infer<typeof issueHrEmployeeServiceCostRequestSchema>;
export type IssueHrEmployeeAdvanceRequest = z.infer<typeof issueHrEmployeeAdvanceRequestSchema>;
export type SettleHrEmployeeAdvanceDirectlyRequest = z.infer<typeof settleHrEmployeeAdvanceDirectlyRequestSchema>;
export type DeferHrEmployeeAdvanceRequest = z.infer<typeof deferHrEmployeeAdvanceRequestSchema>;
export type CreateHrEmployeeAdministrativeDeductionRequest = z.infer<typeof createHrEmployeeAdministrativeDeductionRequestSchema>;
export type DeferHrEmployeeAdministrativeDeductionRequest = z.infer<typeof deferHrEmployeeAdministrativeDeductionRequestSchema>;
export type CancelHrEmployeeAdministrativeDeductionRequest = z.infer<typeof cancelHrEmployeeAdministrativeDeductionRequestSchema>;
export type SetHrEmployeeCompensationRequest = z.infer<typeof setHrEmployeeCompensationRequestSchema>;
export type CreateHrPayrollRunRequest = z.infer<typeof createHrPayrollRunRequestSchema>;
export type ApproveHrPayrollRunRequest = z.infer<typeof approveHrPayrollRunRequestSchema>;
export type PayHrPayrollRunRequest = z.infer<typeof payHrPayrollRunRequestSchema>;
export type ReverseHrPayrollRunRequest = z.infer<typeof reverseHrPayrollRunRequestSchema>;
