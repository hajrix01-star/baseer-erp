import { z } from 'zod';

import { outputFormatSchema, outputLocaleSchema } from './output.js';

const reportDocumentIdSchema = z.string().uuid();
const reportDocumentCodeSchema = z.enum(['ledger_trial_balance', 'personal_cash_performance', 'internal_vat_report']);

export const createReportDocumentRequestSchema = z.object({
  reportRunId: reportDocumentIdSchema,
  locale: outputLocaleSchema,
}).strict();

export const renderReportRunRequestSchema = createReportDocumentRequestSchema.extend({
  format: outputFormatSchema,
}).strict();

export const renderReportDocumentRequestSchema = z.object({
  format: outputFormatSchema,
}).strict();

export const reportDocumentReceiptSchema = z.object({
  id: reportDocumentIdSchema,
  reportRunId: reportDocumentIdSchema,
  reportCode: reportDocumentCodeSchema,
  title: z.string().min(1).max(240),
  locale: outputLocaleSchema,
  createdAt: z.string().datetime(),
  reused: z.boolean(),
}).strict();

export const reportDocumentListSchema = z.object({
  documents: z.array(reportDocumentReceiptSchema).max(500),
}).strict();

export const reportDocumentArtifactSchema = z.object({
  snapshotId: reportDocumentIdSchema,
  reportCode: reportDocumentCodeSchema,
  format: outputFormatSchema,
  mimeType: z.string().min(1).max(160),
  fileName: z.string().min(1).max(255).nullable(),
  contentEncoding: z.enum(['utf8', 'base64']),
  content: z.string().min(1).max(7_000_000),
}).strict();

export type CreateReportDocumentRequest = z.infer<typeof createReportDocumentRequestSchema>;
