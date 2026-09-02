import { z } from 'zod';

import { businessDateSchema } from './business-date.js';
import { financialEvidenceDescriptorSchema } from './financial-evidence.js';

const moneySchema = z.object({
  raw: z.string().regex(/^-?\d+\.\d{4}$/),
  display: z.string().regex(/^\d+\.\d{2}$/),
  sign: z.enum(['positive', 'negative', 'zero']),
}).strict();

export const accrualProfitLossRequestSchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  months: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).min(2).max(24).optional(),
  vatInclusive: z.boolean().default(false),
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

/**
 * A drill-down always names the exact presented P&L target.  Totals are
 * server targets as well; the browser never re-sums statement lines.
 */
export const accrualProfitLossEvidenceTargetSchema = z.union([
  z.string().uuid(),
  z.literal('REVENUE'),
  z.literal('EXPENSE'),
  z.literal('NET_PROFIT'),
]);

export const accrualProfitLossEvidenceQuerySchema = accrualProfitLossRequestSchema.extend({
  target: accrualProfitLossEvidenceTargetSchema,
}).strict();

const accrualProfitLossEvidenceItemSchema = z.object({
  journalEntryId: z.string().uuid(),
  businessDate: businessDateSchema,
  amount: moneySchema,
  source: z.object({
    labelAr: z.string().min(1).max(160),
    labelEn: z.string().min(1).max(160),
    reference: z.string().min(1).max(160),
    description: z.string().max(1_000).nullable(),
    counterparty: z.object({
      labelAr: z.string().min(1).max(160),
      labelEn: z.string().min(1).max(160),
    }).strict().nullable(),
  }).strict(),
}).strict();

export const accrualProfitLossEvidenceReceiptSchema = z.object({
  target: accrualProfitLossEvidenceTargetSchema,
  items: z.array(accrualProfitLossEvidenceItemSchema).max(1_000),
}).strict();

export const accrualProfitLossSourceJournalSchema = z.object({
  journalEntry: z.object({
    id: z.string().uuid(),
    businessDate: businessDateSchema,
    labelAr: z.string().min(1).max(160),
    labelEn: z.string().min(1).max(160),
    sourceReference: z.string().min(1).max(160),
    description: z.string().max(1_000).nullable(),
    counterparty: z.object({
      labelAr: z.string().min(1).max(160),
      labelEn: z.string().min(1).max(160),
    }).strict().nullable(),
    status: z.enum(['POSTED', 'REVERSED']),
    lines: z.array(z.object({
      id: z.string().uuid(),
      lineNumber: z.number().int().positive(),
      accountCode: z.string().min(1).max(80),
      accountNameAr: z.string().min(1).max(160),
      accountNameEn: z.string().max(160),
      debitAmount: z.string().regex(/^\d+\.\d{4}$/),
      creditAmount: z.string().regex(/^\d+\.\d{4}$/),
    }).strict()).max(1_000),
  }).strict(),
}).strict();

const metadataSchema = z.object({
  reportCode: z.literal('accrual_profit_loss'),
  definitionVersion: z.literal('accrual_profit_loss_v1'),
  dataMode: z.literal('LIVE'),
  ledgerRevision: z.string().regex(/^\d+$/),
  company: z.object({
    displayName: z.string().min(1).max(160),
    functionalCurrency: z.string().regex(/^[A-Z]{3}$/),
  }).strict(),
  businessTimezone: z.string().min(1).max(64),
  selectedPeriod: z.object({ from: businessDateSchema, to: businessDateSchema, months: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).optional() }).strict(),
  vatInclusive: z.boolean(),
  vatPresentation: z.object({
    scope: z.literal('ALL_REVENUE_AND_EXPENSE'),
    state: z.enum(['COMPLETE', 'INCOMPLETE']),
    adjustedJournalCount: z.number().int().nonnegative(),
    unresolvedJournalCount: z.number().int().nonnegative(),
    warningAr: z.string().min(1).max(500).nullable(),
  }).strict(),
  salesByVault: z.object({
    sourceKind: z.literal('SEALED_SALES_VAULT_LINES'),
    grossTotal: moneySchema,
    netTotal: moneySchema,
    vatTotal: moneySchema,
    displayedTotal: moneySchema,
    shareOfRevenuePercent: z.string().regex(/^\d+\.\d{4}$/).nullable(),
    evidence: financialEvidenceDescriptorSchema,
    rows: z.array(z.object({
      vaultId: z.string().uuid(),
      vaultNameAr: z.string().min(1).max(160),
      vaultNameEn: z.string().max(160),
      eventCount: z.number().int().nonnegative(),
      grossAmount: moneySchema,
      netAmount: moneySchema,
      displayedAmount: moneySchema,
      shareOfRevenuePercent: z.string().regex(/^\d+\.\d{4}$/).nullable(),
      evidence: financialEvidenceDescriptorSchema,
    }).strict()).max(500),
  }).strict(),
  basisLabelAr: z.string().min(1).max(500),
  cancellationTreatmentAr: z.string().min(1).max(500),
  mappingVersion: z.object({
    id: z.string().uuid(),
    versionNumber: z.number().int().positive(),
    checksum: z.string().regex(/^[a-f0-9]{64}$/),
  }).strict(),
  dataCoverage: z.object({
    state: z.enum(['COMPLETE', 'APPROVED_HISTORICAL_EXCEPTION']),
    sourceKind: z.literal('sealed_ledger_revenue_expense_lines'),
    warningAr: z.string().min(1).max(500).nullable(),
    historicalCashBasisPayrollRuns: z.number().int().nonnegative(),
  }).strict(),
  roundingRule: z.string().min(1).max(500),
}).strict();

export const accrualProfitLossRowSchema = z.object({
  statementLineId: z.string().uuid(),
  code: z.string().min(1).max(80),
  nameAr: z.string().min(1).max(160),
  nameEn: z.string().min(1).max(160),
  section: z.enum(['REVENUE', 'EXPENSE']),
  presentationNature: z.enum(['REVENUE', 'COST_OF_SALES', 'OPERATING_INCOME', 'OPERATING_EXPENSE', 'INVESTING', 'FINANCING', 'INCOME_TAX', 'DISCONTINUED_OPERATIONS']),
  amount: moneySchema,
  shareOfRevenuePercent: z.string().regex(/^\d+\.\d{4}$/).nullable(),
  evidence: financialEvidenceDescriptorSchema,
}).strict();

const totalsSchema = z.object({
  revenue: moneySchema,
  expenses: moneySchema,
  netProfit: moneySchema,
  revenueShareOfRevenuePercent: z.string().regex(/^\d+\.\d{4}$/).nullable(),
  expensesShareOfRevenuePercent: z.string().regex(/^\d+\.\d{4}$/).nullable(),
  netProfitShareOfRevenuePercent: z.string().regex(/^\d+\.\d{4}$/).nullable(),
  revenueEvidence: financialEvidenceDescriptorSchema,
  expensesEvidence: financialEvidenceDescriptorSchema,
  netProfitEvidence: financialEvidenceDescriptorSchema,
}).strict();

const accrualProfitLossPeriodComparisonSchema = z.object({
  columns: z.array(z.object({ key: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }).strict()).min(2).max(24),
  rows: z.array(z.object({ statementLineId: z.string().uuid(), amounts: z.array(moneySchema).min(2).max(24) }).strict()).max(1_000),
  totals: z.object({
    revenue: z.array(moneySchema).min(2).max(24),
    expenses: z.array(moneySchema).min(2).max(24),
    netProfit: z.array(moneySchema).min(2).max(24),
    salesVat: z.array(moneySchema).min(2).max(24),
  }).strict(),
  salesByVaultTotals: z.array(moneySchema).min(2).max(24),
  salesByVault: z.array(z.object({ vaultId: z.string().uuid(), amounts: z.array(moneySchema).min(2).max(24) }).strict()).max(500),
}).strict();

export const accrualProfitLossResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('NOT_READY'), messageAr: z.string().min(1).max(500) }).strict(),
  metadataSchema.extend({ state: z.literal('NO_DATA'), messageAr: z.string().min(1).max(500), rows: z.array(z.never()).max(0), totals: totalsSchema }).strict(),
  metadataSchema.extend({ state: z.literal('READY'), rows: z.array(accrualProfitLossRowSchema).max(1_000), totals: totalsSchema, periodComparison: accrualProfitLossPeriodComparisonSchema.optional() }).strict(),
]);

export type AccrualProfitLossRequest = z.infer<typeof accrualProfitLossRequestSchema>;
export type AccrualProfitLossResult = z.infer<typeof accrualProfitLossResultSchema>;
export type AccrualProfitLossEvidenceQuery = z.infer<typeof accrualProfitLossEvidenceQuerySchema>;
