import { z } from 'zod';

import { businessDateSchema } from './business-date.js';

/**
 * A report supplies this descriptor with every drillable amount.  The browser
 * never derives a ledger predicate from a visible label or amount.
 */
export const financialEvidenceDescriptorSchema = z.discriminatedUnion('reportCode', [
  z.object({
    reportCode: z.literal('personal_cash_performance'),
    metric: z.object({ kind: z.literal('CASH_ROW'), rowCode: z.string().regex(/^[A-Za-z][A-Za-z0-9:_-]{0,159}$/) }).strict(),
  }).strict(),
  z.object({
    reportCode: z.literal('accrual_profit_loss'),
    metric: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('STATEMENT_LINE'), statementLineId: z.string().uuid() }).strict(),
      z.object({ kind: z.literal('REVENUE_TOTAL') }).strict(),
      z.object({ kind: z.literal('EXPENSES_TOTAL') }).strict(),
      z.object({ kind: z.literal('NET_PROFIT') }).strict(),
    ]),
  }).strict(),
  z.object({
    reportCode: z.literal('ledger_trial_balance'),
    metric: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('TRIAL_ACCOUNT'), accountId: z.string().uuid(), scope: z.enum(['OPENING', 'PERIOD', 'CLOSING']), side: z.enum(['DEBIT', 'CREDIT']) }).strict(),
      /** A real ledger-wide predicate, not a client-side sum of account rows. */
      z.object({ kind: z.literal('TRIAL_TOTAL'), scope: z.enum(['OPENING', 'PERIOD', 'CLOSING']), side: z.enum(['DEBIT', 'CREDIT']) }).strict(),
    ]),
  }).strict(),
  z.object({
    reportCode: z.literal('internal_vat_report'),
    metric: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('VAT_ROW'), rowCode: z.enum(['output_vat', 'input_vat', 'vat_paid', 'vat_refunded']) }).strict(),
      /** Net VAT is backed only by output/input tax lines; settlements are excluded. */
      z.object({ kind: z.literal('VAT_NET') }).strict(),
    ]),
  }).strict(),
]);

const evidencePeriodSchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  months: z.array(z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)).min(2).max(24).optional(),
  vatInclusive: z.boolean(),
}).strict().refine((value) => value.from <= value.to, {
  path: ['to'], message: 'The report evidence start date must not be after the end date.',
});

/** The central live route accepts the descriptor plus the report period. */
export const financialEvidenceLiveRequestSchema = evidencePeriodSchema.extend({
  descriptor: financialEvidenceDescriptorSchema,
  cursor: z.string().regex(/^\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$/i).optional(),
}).strict();

export const financialEvidenceMoneySchema = z.object({
  raw: z.string().regex(/^-?\d+\.\d{4}$/),
  display: z.string().regex(/^\d+\.\d{2}$/),
  sign: z.enum(['positive', 'negative', 'zero']),
}).strict();

export const financialEvidenceReceiptSchema = z.object({
  descriptor: financialEvidenceDescriptorSchema,
  nextCursor: z.string().regex(/^\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$/i).nullable(),
  items: z.array(z.object({
    evidenceId: z.string().uuid(),
    businessDate: businessDateSchema,
    amount: financialEvidenceMoneySchema,
    source: z.object({
      journalEntryId: z.string().uuid(),
      labelAr: z.string().min(1).max(160),
      labelEn: z.string().min(1).max(160),
      reference: z.string().min(1).max(160),
      description: z.string().max(1_000).nullable(),
      counterparty: z.object({ labelAr: z.string().min(1).max(160), labelEn: z.string().min(1).max(160) }).nullable(),
    }).strict(),
  }).strict()).max(100),
}).strict();

export const financialEvidenceSourceReceiptSchema = z.object({
  journalEntry: z.object({
    id: z.string().uuid(),
    businessDate: businessDateSchema,
    labelAr: z.string().min(1).max(160),
    labelEn: z.string().min(1).max(160),
    sourceReference: z.string().min(1).max(160),
    description: z.string().max(1_000).nullable(),
    counterparty: z.object({ labelAr: z.string().min(1).max(160), labelEn: z.string().min(1).max(160) }).nullable(),
    status: z.enum(['POSTED', 'REVERSED']),
    lines: z.array(z.object({
      id: z.string().uuid(), lineNumber: z.number().int().positive(), accountCode: z.string().min(1).max(80),
      accountNameAr: z.string().min(1).max(160), accountNameEn: z.string().max(160),
      debit: financialEvidenceMoneySchema, credit: financialEvidenceMoneySchema, description: z.string().max(1_000).nullable(),
    }).strict()).min(2),
  }).strict(),
}).strict();

export type FinancialEvidenceDescriptor = z.infer<typeof financialEvidenceDescriptorSchema>;
export type FinancialEvidenceLiveRequest = z.infer<typeof financialEvidenceLiveRequestSchema>;
