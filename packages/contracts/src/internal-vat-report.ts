import { z } from 'zod';

import { businessDateSchema } from './business-date.js';
import { reportMoneyDisplaySchema } from './reporting.js';

const uuidSchema = z.string().uuid();
const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

export const internalVatReportRequestSchema = z.object({
  from: businessDateSchema,
  to: businessDateSchema,
  months: z.array(monthSchema).min(2).max(24).optional(),
}).strict().refine((value) => value.from <= value.to, { path: ['to'], message: 'The report start date must not be after the end date.' });

const metadata = z.object({
  reportCode: z.literal('internal_vat_report'),
  definitionVersion: z.literal('internal_vat_report_v1'),
  reportRunId: uuidSchema,
  ledgerRevision: z.string().regex(/^\d+$/),
  runChecksum: z.string().regex(/^[a-f0-9]{64}$/),
  company: z.object({ displayName: z.string().min(1).max(160), functionalCurrency: z.string().regex(/^[A-Z]{3}$/) }).strict(),
  selectedPeriod: z.object({ from: businessDateSchema, to: businessDateSchema, months: z.array(monthSchema).optional() }).strict(),
  basisLabelAr: z.literal('دفتر الأستاذ — حسابات الضريبة'),
}).strict();

export const internalVatReportRowSchema = z.object({
  code: z.enum(['output_vat', 'input_vat', 'vat_paid', 'vat_refunded']),
  labelAr: z.string().min(1).max(160),
  labelEn: z.string().min(1).max(160),
  amount: reportMoneyDisplaySchema,
  eventCount: z.number().int().nonnegative(),
}).strict();

export const internalVatReportResultSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('NOT_READY'), messageAr: z.string().min(1).max(500) }).strict(),
  metadata.extend({ state: z.literal('NO_DATA'), messageAr: z.string().min(1).max(500), rows: z.array(z.never()).max(0), netVat: reportMoneyDisplaySchema }).strict(),
  metadata.extend({ state: z.literal('READY'), rows: z.array(internalVatReportRowSchema).max(4), netVat: reportMoneyDisplaySchema }).strict(),
]);

export const internalVatReportEvidenceQuerySchema = z.object({
  rowCode: z.enum(['output_vat', 'input_vat', 'vat_paid', 'vat_refunded']),
  cursor: z.string().regex(/^\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$/i).optional(),
}).strict();

export const internalVatReportEvidenceReceiptSchema = z.object({
  reportRunId: uuidSchema,
  rowCode: z.enum(['output_vat', 'input_vat', 'vat_paid', 'vat_refunded']),
  nextCursor: z.string().regex(/^\d{4}-\d{2}-\d{2}:[0-9a-f-]{36}$/i).nullable(),
  items: z.array(z.object({
    lineId: uuidSchema, businessDate: businessDateSchema, amount: reportMoneyDisplaySchema,
    reference: z.string().min(1).max(160), labelAr: z.string().min(1).max(160), labelEn: z.string().min(1).max(160),
  }).strict()).max(100),
}).strict();

export type InternalVatReportResult = z.infer<typeof internalVatReportResultSchema>;
