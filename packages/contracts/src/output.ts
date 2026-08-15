import { z } from 'zod';

export const outputFormatSchema = z.enum(['preview', 'xlsx']);
export const outputLocaleSchema = z.enum(['ar', 'en']);
export const outputReportCodeSchema = z.string().trim().min(1).max(120).regex(/^[a-z][a-z0-9._-]*$/);
export const outputIdempotencyKeySchema = z.string().trim().min(16).max(255);

export const outputRequestSchema = z.object({
  format: outputFormatSchema,
  locale: outputLocaleSchema,
  filters: z.record(z.string(), z.union([z.string().max(120), z.number().finite(), z.boolean(), z.null()])).default({}),
  idempotencyKey: outputIdempotencyKeySchema,
}).strict();

export const outputReceiptSchema = z.object({
  idempotencyReceiptId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  reportCode: outputReportCodeSchema,
  format: outputFormatSchema,
  mimeType: z.string().min(1).max(160),
  fileName: z.string().min(1).max(255).nullable(),
  contentEncoding: z.enum(['utf8', 'base64']),
  content: z.string().min(1).max(7_000_000),
  replayed: z.boolean(),
}).strict();

export const outputPrintIssuedRequestSchema = z.object({
  idempotencyReceiptId: z.string().uuid(),
}).strict();

export type OutputRequest = z.infer<typeof outputRequestSchema>;
export type OutputReceipt = z.infer<typeof outputReceiptSchema>;
export type OutputPrintIssuedRequest = z.infer<typeof outputPrintIssuedRequestSchema>;
