import { z } from 'zod';

import { businessDateSchema } from './business-date.js';
import { reportMoneyDisplaySchema } from './reporting.js';
import { financialEvidenceDescriptorSchema } from './financial-evidence.js';

const uuidSchema = z.string().uuid();
const amountColumnsSchema = z.object({
  openingDebit: reportMoneyDisplaySchema,
  openingCredit: reportMoneyDisplaySchema,
  periodDebit: reportMoneyDisplaySchema,
  periodCredit: reportMoneyDisplaySchema,
  closingDebit: reportMoneyDisplaySchema,
  closingCredit: reportMoneyDisplaySchema,
}).strict();
const evidenceColumnsSchema = z.object({
  openingDebit: financialEvidenceDescriptorSchema,
  openingCredit: financialEvidenceDescriptorSchema,
  periodDebit: financialEvidenceDescriptorSchema,
  periodCredit: financialEvidenceDescriptorSchema,
  closingDebit: financialEvidenceDescriptorSchema,
  closingCredit: financialEvidenceDescriptorSchema,
}).strict();

export const ledgerTrialBalanceRequestSchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  includeZeroRows: z.boolean().default(false),
}).strict().refine((value) => value.from <= value.to, {
  message: 'The report start date must not be after the end date.', path: ['to'],
});

const ledgerTrialBalanceMetadataSchema = z.object({
  reportCode: z.literal('ledger_trial_balance'),
  definitionVersion: z.literal('ledger_trial_balance_v1'),
  dataMode: z.literal('LIVE'),
  ledgerRevision: z.string().regex(/^\d+$/),
  company: z.object({
    displayName: z.string().min(1).max(160),
    functionalCurrency: z.string().regex(/^[A-Z]{3}$/),
  }).strict(),
  businessTimezone: z.string().min(1).max(64),
  selectedPeriod: z.object({ from: businessDateSchema, to: businessDateSchema }).strict(),
  economicAsOfDate: businessDateSchema,
  basisLabelAr: z.literal('دفتر الأستاذ — القيود المختومة'),
  sourceKindAr: z.literal('قيود دفتر مختومة'),
  cancellationTreatmentAr: z.string().min(1).max(500),
  dataCoverage: z.object({ state: z.literal('COMPLETE') }).strict(),
  reconciliation: z.object({ state: z.literal('RECONCILED'), messageAr: z.string().min(1).max(500) }).strict(),
  roundingRule: z.string().min(1).max(500),
}).strict();

export const ledgerTrialBalanceRowSchema = z.object({
  accountId: uuidSchema,
  code: z.string().min(1).max(80),
  nameAr: z.string().min(1).max(160),
  nameEn: z.string().min(1).max(160),
  type: z.enum(['ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE']),
  isSystem: z.boolean(),
  amounts: amountColumnsSchema,
  /** One server-owned predicate per visible amount cell. */
  evidence: evidenceColumnsSchema,
}).strict();

export const ledgerTrialBalanceResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('NOT_READY'), messageAr: z.string().min(1).max(500) }).strict(),
  z.object({ state: z.literal('RANGE_EXCEEDS_INTERACTIVE_LIMIT'), messageAr: z.string().min(1).max(500) }).strict(),
  ledgerTrialBalanceMetadataSchema.extend({
    state: z.literal('NO_DATA'), messageAr: z.string().min(1).max(500),
    rows: z.array(z.never()).max(0),
    totals: amountColumnsSchema,
    totalsEvidence: evidenceColumnsSchema,
  }).strict(),
  ledgerTrialBalanceMetadataSchema.extend({
    state: z.literal('READY'),
    rows: z.array(ledgerTrialBalanceRowSchema).max(1_000),
    totals: amountColumnsSchema,
    totalsEvidence: evidenceColumnsSchema,
  }).strict(),
]);

export const ledgerTrialBalanceEvidenceQuerySchema = z.object({
  accountId: uuidSchema,
  scope: z.enum(['OPENING', 'PERIOD', 'CLOSING']),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/).optional(),
}).strict();

export const ledgerTrialBalanceEvidenceReceiptSchema = z.object({
  reportRunId: uuidSchema,
  accountId: uuidSchema,
  scope: z.enum(['OPENING', 'PERIOD', 'CLOSING']),
  nextCursor: z.string().regex(/^[A-Za-z0-9_-]{1,512}$/).nullable(),
  items: z.array(z.object({
    lineId: uuidSchema,
    journalEntryId: uuidSchema,
    businessDate: businessDateSchema,
    reference: z.string().min(1).max(160),
    labelAr: z.string().min(1).max(160),
    labelEn: z.string().min(1).max(160),
    description: z.string().max(1_000).nullable(),
    debit: reportMoneyDisplaySchema,
    credit: reportMoneyDisplaySchema,
    cancellationLabelAr: z.string().max(200).nullable(),
  }).strict()).max(100),
}).strict();

export const ledgerTrialBalanceSourceReceiptSchema = z.object({
  journalEntry: z.object({
    id: uuidSchema,
    businessDate: businessDateSchema,
    sourceReference: z.string().min(1).max(160),
    labelAr: z.string().min(1).max(160),
    labelEn: z.string().min(1).max(160),
    description: z.string().max(1_000).nullable(),
    cancellationLabelAr: z.string().max(200).nullable(),
    lines: z.array(z.object({
      id: uuidSchema, lineNumber: z.number().int().positive(), accountCode: z.string().min(1).max(80), accountNameAr: z.string().min(1).max(160), accountNameEn: z.string().max(160), debit: reportMoneyDisplaySchema, credit: reportMoneyDisplaySchema, description: z.string().max(1_000).nullable(),
    }).strict()).min(2),
  }).strict(),
}).strict();

export type LedgerTrialBalanceRequest = z.infer<typeof ledgerTrialBalanceRequestSchema>;
export type LedgerTrialBalanceResult = z.infer<typeof ledgerTrialBalanceResultSchema>;
