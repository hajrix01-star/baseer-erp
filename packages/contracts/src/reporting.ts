import { z } from 'zod';

import { businessDateSchema } from './business-date.js';
import { financialReadContractSchema } from './financial-read.js';
import { financialEvidenceDescriptorSchema } from './financial-evidence.js';

export const personalCashPerformanceCoverageRequestSchema = z.object({
  coverageStartBusinessDate: businessDateSchema,
}).strict();

export const personalCashPerformanceRequestSchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  // Explicit months permit non-contiguous month selection, including across
  // years. From/to remain the enclosing display and report-run boundary.
  months: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).min(2).max(24).optional(),
  vatInclusive: z.boolean().default(true),
}).strict().refine((value) => value.from <= value.to, {
  message: 'The report start date must not be after the end date.',
  path: ['to'],
}).refine((value) => !value.months || new Set(value.months).size === value.months.length, {
  message: 'Selected report months must be distinct.',
  path: ['months'],
}).refine((value) => !value.months || value.months.every((month) => `${month}-01` >= value.from && `${month}-01` <= value.to), {
  message: 'Selected report months must be within the selected period envelope.',
  path: ['months'],
});

export const reportMoneyDisplaySchema = z.object({
  raw: z.string().regex(/^-?\d+\.\d{4}$/),
  display: z.string().regex(/^\d+\.\d{2}$/),
  sign: z.enum(['positive', 'negative', 'zero']),
}).strict();

const reportPercentSchema = z.string().regex(/^\d+\.\d{4}$/);
/**
 * A server-owned operating-cost roll-up over the exact same sealed-ledger
 * movement scope as the financial report. Amounts are positive display
 * values because every included group is an outflow; raw financial rows keep
 * their signed amounts separately in `rows`.
 */
const personalCashPerformanceOperatingCostGroupSchema = z.object({
  code: z.enum(['purchases', 'recurring_expenses', 'expenses', 'payroll']),
  labelAr: z.string().min(1).max(160),
  labelEn: z.string().min(1).max(160),
  amount: reportMoneyDisplaySchema,
  evidence: financialEvidenceDescriptorSchema,
  eventCount: z.number().int().nonnegative(),
  shareOfCollectedSalesPercent: reportPercentSchema.nullable(),
  /** Only direct category rows; descendant hierarchy is intentionally omitted. */
  rows: z.array(z.object({
    code: z.string().min(1).max(160),
    /** Stable row code accepted by the live evidence endpoint. */
    evidenceRowCode: z.string().min(1).max(160),
    labelAr: z.string().min(1).max(160),
    labelEn: z.string().min(1).max(160),
    amount: reportMoneyDisplaySchema,
    evidence: financialEvidenceDescriptorSchema,
    eventCount: z.number().int().nonnegative(),
    shareOfParentPercent: reportPercentSchema.nullable(),
  }).strict()).max(500),
}).strict();

const personalCashPerformanceOperatingCostsSchema = z.object({
  /** This is a movement report, not an accrual/P&L reclassification. */
  basisLabelAr: z.literal('الحركات المالية المثبتة'),
  total: reportMoneyDisplaySchema,
  evidence: financialEvidenceDescriptorSchema,
  shareOfCollectedSalesPercent: reportPercentSchema.nullable(),
  /** Exactly one direct group per eligible movement: never parents + children. */
  groups: z.tuple([
    personalCashPerformanceOperatingCostGroupSchema,
    personalCashPerformanceOperatingCostGroupSchema,
    personalCashPerformanceOperatingCostGroupSchema,
    personalCashPerformanceOperatingCostGroupSchema,
  ]),
}).strict();

const personalCashPerformanceRowSchema = z.object({
  code: z.string().min(1).max(160), labelAr: z.string().min(1).max(160), labelEn: z.string().min(1).max(160),
  kind: z.enum(['SECTION', 'LINE']), parentCode: z.string().min(1).max(160).nullable(),
  direction: z.enum(['INFLOW', 'OUTFLOW']), eventCount: z.number().int().positive(), amount: reportMoneyDisplaySchema,
  evidence: financialEvidenceDescriptorSchema,
  shareOfCollectedSalesPercent: reportPercentSchema.nullable(),
  /** Presentation-ready category measures.  The client must not recompute
   * ranks or financial denominators from visible rows. */
  rankWithinParent: z.number().int().positive(),
  shareOfDirectionPercent: reportPercentSchema.nullable(),
  shareOfTotalOutflowPercent: reportPercentSchema.nullable(),
  shareOfParentPercent: reportPercentSchema.nullable(),
}).strict();

const personalCashPerformancePeriodComparisonSchema = z.object({
  /** Calendar-month columns in the exact user-selected order. */
  columns: z.array(z.object({ key: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict()).min(2).max(24),
  /** Amounts are server-calculated at the same ledger revision as the total. */
  rows: z.array(z.object({
    code: z.string().min(1).max(160),
    amounts: z.array(reportMoneyDisplaySchema).min(2).max(24),
  }).strict()).max(500),
  netCashResultAmounts: z.array(reportMoneyDisplaySchema).min(2).max(24),
}).strict();

const personalCashPerformanceVaultSchema = z.object({
  vaultId: z.string().uuid(), vaultNameAr: z.string().min(1).max(160), vaultNameEn: z.string().min(1).max(160),
  inflows: reportMoneyDisplaySchema, outflows: reportMoneyDisplaySchema, balance: reportMoneyDisplaySchema,
  inflowsEvidence: financialEvidenceDescriptorSchema, outflowsEvidence: financialEvidenceDescriptorSchema, balanceEvidence: financialEvidenceDescriptorSchema,
}).strict();

const personalCashPerformanceMetadataSchema = z.object({
  reportCode: z.literal('personal_cash_performance'),
  definitionVersion: z.string().min(1).max(80),
  /** An interactive report is deliberately live; a ReportRun is issued only for an official output. */
  dataMode: z.literal('LIVE'),
  ledgerRevision: z.string().regex(/^\d+$/),
  company: z.object({ displayName: z.string().min(1).max(160), functionalCurrency: z.string().regex(/^[A-Z]{3}$/) }).strict(),
  businessTimezone: z.string().min(1).max(64),
  selectedPeriod: z.object({ from: businessDateSchema, to: businessDateSchema, months: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).optional() }).strict(),
  basisLabelAr: z.string().min(1).max(200),
  vatInclusive: z.boolean(),
  /** Optional until all financial reads have adopted the common envelope. */
  financialRead: financialReadContractSchema.optional(),
  cancellationTreatmentAr: z.string().min(1).max(500),
  dataCoverage: z.object({
    state: z.literal('COMPLETE'),
    sourceKind: z.literal('sealed_ledger_vault_lines'),
  }).strict(),
  roundingRule: z.string().min(1).max(500),
  comparison: z.object({
    policy: z.literal('PREVIOUS_EQUAL_PERIOD'),
    state: z.enum(['READY', 'UNAVAILABLE']),
    previousNetCashResult: reportMoneyDisplaySchema.nullable(),
    netCashResultDifference: reportMoneyDisplaySchema.nullable(),
    netCashResultPercentChange: reportPercentSchema.nullable(),
  }).strict(),
});

export const personalCashPerformanceResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('NOT_READY'), messageAr: z.string().min(1).max(500) }).strict(),
  z.object({
    state: z.literal('COVERAGE_INCOMPLETE'), messageAr: z.string().min(1).max(500),
    coverageStartBusinessDate: businessDateSchema.optional(), ledgerRevision: z.string().regex(/^\d+$/).optional(),
  }).strict(),
  personalCashPerformanceMetadataSchema.extend({
    state: z.literal('NO_DATA'), messageAr: z.string().min(1).max(500),
    rows: z.array(z.never()).max(0),
    vaults: z.array(personalCashPerformanceVaultSchema).max(500),
    totals: z.object({ inflows: reportMoneyDisplaySchema, outflows: reportMoneyDisplaySchema, netCashResult: reportMoneyDisplaySchema, netCashResultShareOfCollectedSalesPercent: reportPercentSchema.nullable(), inflowsEvidence: financialEvidenceDescriptorSchema, outflowsEvidence: financialEvidenceDescriptorSchema, netCashResultEvidence: financialEvidenceDescriptorSchema }).strict(),
    operatingCosts: personalCashPerformanceOperatingCostsSchema,
  }).strict(),
  personalCashPerformanceMetadataSchema.extend({
    state: z.literal('READY'),
    rows: z.array(personalCashPerformanceRowSchema).max(500),
    vaults: z.array(personalCashPerformanceVaultSchema).max(500),
    totals: z.object({ inflows: reportMoneyDisplaySchema, outflows: reportMoneyDisplaySchema, netCashResult: reportMoneyDisplaySchema, netCashResultShareOfCollectedSalesPercent: reportPercentSchema.nullable(), inflowsEvidence: financialEvidenceDescriptorSchema, outflowsEvidence: financialEvidenceDescriptorSchema, netCashResultEvidence: financialEvidenceDescriptorSchema }).strict(),
    operatingCosts: personalCashPerformanceOperatingCostsSchema,
    periodComparison: personalCashPerformancePeriodComparisonSchema.optional(),
  }).strict(),
]);

export const personalCashPerformanceEvidenceQuerySchema = z.object({
  rowCode: z.string().regex(/^[A-Za-z][A-Za-z0-9:_-]{0,159}$/),
  cursor: z.string().regex(/^\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$/i).optional(),
}).strict();

const personalCashPerformanceEvidenceItemSchema = z.object({
    eventId: z.string().uuid(), businessDate: businessDateSchema, direction: z.enum(['INFLOW', 'OUTFLOW']), amount: reportMoneyDisplaySchema,
      source: z.object({
        journalEntryId: z.string().uuid(), labelAr: z.string().min(1).max(160), labelEn: z.string().min(1).max(160), reference: z.string().min(1).max(160),
        counterparty: z.object({ labelAr: z.string().min(1).max(160), labelEn: z.string().min(1).max(160) }).strict().nullable(),
        // Current workspaces use stable page hashes. Keep the legacy section
        // form valid for saved evidence created before the page registry.
        origin: z.object({ labelAr: z.string().min(1).max(160), labelEn: z.string().min(1).max(160), route: z.string().regex(/^#module=[a-z-]+&(page=[a-z][a-z0-9-]*|section=\d+)(?:&stage=[a-z][a-z0-9-]{0,31})?$/) }).strict(),
      }).strict(),
  }).strict();

const personalCashPerformanceEvidencePageSchema = z.object({
  rowCode: z.string().min(1).max(160), nextCursor: z.string().regex(/^\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$/i).nullable(),
  items: z.array(personalCashPerformanceEvidenceItemSchema).max(100),
}).strict();

export const personalCashPerformanceEvidenceReceiptSchema = personalCashPerformanceEvidencePageSchema.extend({
  reportRunId: z.string().uuid(),
}).strict();

/** Interactive evidence is deliberately live; only print/export/save create a report run. */
export const personalCashPerformanceLiveEvidenceReceiptSchema = personalCashPerformanceEvidencePageSchema;

export const personalCashPerformanceSourceReceiptSchema = z.object({
  journalEntry: z.object({
    id: z.string().uuid(), businessDate: businessDateSchema, sourceType: z.string().min(1).max(80), labelAr: z.string().min(1).max(160), labelEn: z.string().min(1).max(160), sourceReference: z.string().min(1).max(160), description: z.string().max(1000).nullable(),
    counterparty: z.object({ labelAr: z.string().min(1).max(160), labelEn: z.string().min(1).max(160) }).strict().nullable(),
    status: z.enum(['POSTED', 'REVERSED']), postedAt: z.string().datetime(),
    lines: z.array(z.object({
      id: z.string().uuid(), lineNumber: z.number().int().positive(), accountCode: z.string().min(1).max(80), accountNameAr: z.string().min(1).max(160), accountNameEn: z.string().max(160),
      /** Retained for existing API readers that need the exact stored scale. */
      debitAmount: z.string().regex(/^\d+\.\d{4}$/), creditAmount: z.string().regex(/^\d+\.\d{4}$/),
      /**
       * Server-owned visual amounts. Optional while the shared receipt is
       * still consumed by the legacy internal-VAT source endpoint.
       */
      debit: reportMoneyDisplaySchema.optional(), credit: reportMoneyDisplaySchema.optional(),
      description: z.string().max(1000).nullable(),
    }).strict()).min(2),
  }).strict(),
}).strict();

export type PersonalCashPerformanceCoverageRequest = z.infer<typeof personalCashPerformanceCoverageRequestSchema>;
export type PersonalCashPerformanceRequest = z.infer<typeof personalCashPerformanceRequestSchema>;
export type PersonalCashPerformanceResult = z.infer<typeof personalCashPerformanceResultSchema>;
export type PersonalCashPerformanceEvidenceQuery = z.infer<typeof personalCashPerformanceEvidenceQuerySchema>;
export type PersonalCashPerformanceEvidenceReceipt = z.infer<typeof personalCashPerformanceEvidenceReceiptSchema>;
export type PersonalCashPerformanceSourceReceipt = z.infer<typeof personalCashPerformanceSourceReceiptSchema>;
