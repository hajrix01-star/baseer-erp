import { z } from 'zod';

import { companyIdSchema, userIdSchema } from './identity.js';

export const fileMetadataIdSchema = z.string().uuid();
export const fileMetadataSourceTypeSchema = z.string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9._-]*$/);
export const fileMetadataPurposeSchema = z.string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z][a-z0-9._-]*$/);
export const fileMetadataSourceIdSchema = z.string().uuid();
export const safeFileDisplayNameSchema = z.string()
  .trim()
  .min(1)
  .max(240)
  .refine((value) => !/[\\/\u0000-\u001F]/.test(value), 'Display name contains unsafe characters.');
export const declaredMimeTypeSchema = z.string()
  .trim()
  .min(3)
  .max(127)
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i);
export const declaredFileByteSizeSchema = z.number().int().min(1).max(10 * 1024 * 1024);
export const declaredSha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const fileMetadataIdempotencyKeySchema = z.string().trim().min(16).max(255);
export const fileMetadataStatusSchema = z.enum(['RESERVED', 'SUPERSEDED']);

export const createFileMetadataRequestSchema = z.object({
  sourceType: fileMetadataSourceTypeSchema,
  sourceId: fileMetadataSourceIdSchema,
  purpose: fileMetadataPurposeSchema,
  displayName: safeFileDisplayNameSchema,
  declaredMimeType: declaredMimeTypeSchema,
  declaredByteSize: declaredFileByteSizeSchema,
  declaredSha256: declaredSha256Schema,
  replacesFileMetadataId: fileMetadataIdSchema.optional(),
  idempotencyKey: fileMetadataIdempotencyKeySchema,
}).strict();

/**
 * This is deliberately a reservation receipt, not proof that file bytes were
 * uploaded, scanned, or can be downloaded. Storage keys remain server-only.
 */
export const fileMetadataReceiptSchema = z.object({
  id: fileMetadataIdSchema,
  sourceType: fileMetadataSourceTypeSchema,
  sourceId: fileMetadataSourceIdSchema,
  purpose: fileMetadataPurposeSchema,
  version: z.number().int().positive(),
  status: fileMetadataStatusSchema,
  displayName: safeFileDisplayNameSchema,
  declaredMimeType: declaredMimeTypeSchema,
  declaredByteSize: declaredFileByteSizeSchema,
  declaredSha256: declaredSha256Schema,
  replacesFileMetadataId: fileMetadataIdSchema.nullable(),
  createdByUserId: userIdSchema,
  createdAt: z.string().datetime({ offset: true }),
  replayed: z.boolean(),
}).strict();

export const fileMetadataReadRequestSchema = z.object({
  id: fileMetadataIdSchema,
  companyId: companyIdSchema,
}).strict();

export type CreateFileMetadataRequest = z.infer<typeof createFileMetadataRequestSchema>;
export type FileMetadataReceipt = z.infer<typeof fileMetadataReceiptSchema>;
export type FileMetadataReadRequest = z.infer<typeof fileMetadataReadRequestSchema>;
