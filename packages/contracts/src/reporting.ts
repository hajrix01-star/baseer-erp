import { z } from 'zod';

import { businessDateSchema } from './business-date.js';

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
const personalCashPerformanceRowSchema = z.object({
  code: z.string().min(1).max(160), labelAr: z.string().min(1).max(160), labelEn: z.string().min(1).max(160),
  kind: z.enum(['SECTION', 'LINE']), parentCode: z.string().min(1).max(160).nullable(),
  direction: z.enum(['INFLOW', 'OUTFLOW']), eventCount: z.number().int().positive(), amount: reportMoneyDisplaySchema,
  shareOfCollectedSalesPercent: reportPercentSchema.nullable(),
}).strict();

const personalCashPerformanceVaultSchema = z.object({
  vaultId: z.string().uuid(), vaultNameAr: z.string().min(1).max(160), vaultNameEn: z.string().min(1).max(160),
  inflows: reportMoneyDisplaySchema, outflows: reportMoneyDisplaySchema, balance: reportMoneyDisplaySchema,
}).strict();

const personalCashPerformanceMetadataSchema = z.object({
  reportCode: z.literal('personal_cash_performance'),
  definitionVersion: z.string().min(1).max(80),
  reportRunId: z.string().uuid(),
  ledgerRevision: z.string().regex(/^\d+$/),
  runChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  company: z.object({ displayName: z.string().min(1).max(160), functionalCurrency: z.string().regex(/^[A-Z]{3}$/) }).strict(),
  businessTimezone: z.string().min(1).max(64),
  selectedPeriod: z.object({ from: businessDateSchema, to: businessDateSchema, months: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).optional() }).strict(),
  basisLabelAr: z.string().min(1).max(200),
  vatInclusive: z.boolean(),
  cancellationTreatmentAr: z.string().min(1).max(500),
  dataCoverage: z.object({
    state: z.literal('COMPLETE'),
    sourceKind: z.literal('sealed_ledger_vault_lines'),
  }).strict(),
  roundingRule: z.string().min(1).max(500),
});

export const personalCashPerformanceResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('NOT_READY'), messageAr: z.string().min(1).max(500) }).strict(),
  z.object({
    state: z.literal('COVERAGE_INCOMPLETE'), messageAr: z.string().min(1).max(500),
    coverageStartBusinessDate: businessDateSchema.optional(), reportRunId: z.string().uuid().optional(), ledgerRevision: z.string().regex(/^\d+$/).optional(),
  }).strict(),
  personalCashPerformanceMetadataSchema.extend({
    state: z.literal('NO_DATA'), messageAr: z.string().min(1).max(500),
    rows: z.array(z.never()).max(0),
    vaults: z.array(personalCashPerformanceVaultSchema).max(500),
    totals: z.object({ inflows: reportMoneyDisplaySchema, outflows: reportMoneyDisplaySchema, netCashResult: reportMoneyDisplaySchema, netCashResultShareOfCollectedSalesPercent: reportPercentSchema.nullable() }).strict(),
  }).strict(),
  personalCashPerformanceMetadataSchema.extend({
    state: z.literal('READY'),
    rows: z.array(personalCashPerformanceRowSchema).max(500),
    vaults: z.array(personalCashPerformanceVaultSchema).max(500),
    totals: z.object({ inflows: reportMoneyDisplaySchema, outflows: reportMoneyDisplaySchema, netCashResult: reportMoneyDisplaySchema, netCashResultShareOfCollectedSalesPercent: reportPercentSchema.nullable() }).strict(),
  }).strict(),
]);

export const personalCashPerformanceEvidenceQuerySchema = z.object({
  rowCode: z.string().regex(/^[A-Za-z][A-Za-z0-9:_-]{0,159}$/),
  cursor: z.string().regex(/^\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$/i).optional(),
}).strict();

export const personalCashPerformanceEvidenceReceiptSchema = z.object({
  reportRunId: z.string().uuid(), rowCode: z.string().min(1).max(160), nextCursor: z.string().regex(/^\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$/i).nullable(),
  items: z.array(z.object({
    eventId: z.string().uuid(), businessDate: businessDateSchema, direction: z.enum(['INFLOW', 'OUTFLOW']), amount: reportMoneyDisplaySchema,
      source: z.object({
        journalEntryId: z.string().uuid(), labelAr: z.string().min(1).max(160), labelEn: z.string().min(1).max(160), reference: z.string().min(1).max(160),
        origin: z.object({ labelAr: z.string().min(1).max(160), labelEn: z.string().min(1).max(160), route: z.string().regex(/^#module=[a-z]+&section=\d+(?:&stage=[a-z-]+)?$/) }).strict(),
      }).strict(),
  }).strict()).max(100),
}).strict();

export const personalCashPerformanceSourceReceiptSchema = z.object({
  journalEntry: z.object({
    id: z.string().uuid(), businessDate: businessDateSchema, sourceType: z.string().min(1).max(80), sourceReference: z.string().min(1).max(160), description: z.string().max(1000).nullable(),
    status: z.enum(['POSTED', 'REVERSED']), postedAt: z.string().datetime(),
    lines: z.array(z.object({ id: z.string().uuid(), lineNumber: z.number().int().positive(), accountCode: z.string().min(1).max(80), accountNameAr: z.string().min(1).max(160), accountNameEn: z.string().min(1).max(160), debitAmount: z.string().regex(/^\d+\.\d{4}$/), creditAmount: z.string().regex(/^\d+\.\d{4}$/), description: z.string().max(1000).nullable() }).strict()).min(2),
  }).strict(),
}).strict();

export type PersonalCashPerformanceCoverageRequest = z.infer<typeof personalCashPerformanceCoverageRequestSchema>;
export type PersonalCashPerformanceRequest = z.infer<typeof personalCashPerformanceRequestSchema>;
export type PersonalCashPerformanceResult = z.infer<typeof personalCashPerformanceResultSchema>;
export type PersonalCashPerformanceEvidenceQuery = z.infer<typeof personalCashPerformanceEvidenceQuerySchema>;
export type PersonalCashPerformanceEvidenceReceipt = z.infer<typeof personalCashPerformanceEvidenceReceiptSchema>;
export type PersonalCashPerformanceSourceReceipt = z.infer<typeof personalCashPerformanceSourceReceiptSchema>;
