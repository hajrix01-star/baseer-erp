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

export const hrEmployeeDetailQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(25),
}).strict();

export const hrEmployeesReceiptSchema = z.object({ companyId: companyIdSchema, employees: z.array(hrEmployeeSchema).max(500) }).strict();
export const hrEmployeeAdvancesReceiptSchema = z.object({ companyId: companyIdSchema, advances: z.array(hrEmployeeAdvanceSchema).max(500) }).strict();
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

export type CreateHrEmployeeRequest = z.infer<typeof createHrEmployeeRequestSchema>;
export type UpdateHrEmployeeRequest = z.infer<typeof updateHrEmployeeRequestSchema>;
export type CreateHrEmployeeServiceRequest = z.infer<typeof createHrEmployeeServiceRequestSchema>;
export type IssueHrEmployeeServiceCostRequest = z.infer<typeof issueHrEmployeeServiceCostRequestSchema>;
export type IssueHrEmployeeAdvanceRequest = z.infer<typeof issueHrEmployeeAdvanceRequestSchema>;
