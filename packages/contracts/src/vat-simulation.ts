import { z } from 'zod';

const moneySchema = z.string().regex(/^-?\d{1,14}(?:\.\d{1,4})?$/, 'A monetary value with up to four decimals is required.');
const nullableMoneySchema = moneySchema.nullable();
const quarterSchema = z.number().int().min(1).max(4);
const yearSchema = z.number().int().min(2000).max(2100);

export const vatSimulationSaveSchema = z.object({
  year: yearSchema,
  quarter: quarterSchema,
  salesTaxableAmount: moneySchema,
  outputVatAmount: moneySchema,
  purchasesTaxableAmount: moneySchema,
  inputVatAmount: moneySchema,
  priorAdjustments: moneySchema,
  balanceCarried: moneySchema,
  paymentTarget: nullableMoneySchema,
  notes: z.string().trim().max(1_000).nullable(),
  sourceLedgerRevision: z.string().regex(/^\d+$/).nullable(),
}).strict();

export const vatSimulationQuerySchema = z.object({ year: z.coerce.number().int().min(2000).max(2100) }).strict();
export const vatSimulationIdSchema = z.string().uuid();
export const vatSimulationDeleteReceiptSchema = z.object({ id: vatSimulationIdSchema }).strict();

export const vatSimulationReceiptSchema = z.object({
  id: z.string().uuid(), year: yearSchema, quarter: quarterSchema,
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
  salesTaxableAmount: moneySchema, outputVatAmount: moneySchema,
  purchasesTaxableAmount: moneySchema, inputVatAmount: moneySchema,
  priorAdjustments: moneySchema, balanceCarried: moneySchema,
  paymentTarget: nullableMoneySchema, notes: z.string().nullable(),
  sourceLedgerRevision: z.string().regex(/^\d+$/).nullable(),
  sourceImportedAt: z.string().datetime().nullable(), updatedAt: z.string().datetime(),
}).strict();

export const vatSimulationListReceiptSchema = z.object({
  vatRateBasisPoints: z.number().int().min(0).max(10_000),
  simulations: z.array(vatSimulationReceiptSchema).max(4),
}).strict();

export type VatSimulationSave = z.infer<typeof vatSimulationSaveSchema>;
