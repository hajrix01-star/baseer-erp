import { z } from 'zod';
import { companyIdSchema } from './identity.js';

const uuid = z.string().uuid();
const idempotencyKey = z.string().trim().min(8).max(255);

export const backupJobStatusSchema = z.enum([
  'QUEUED', 'PRECHECK', 'CONSISTENT_SNAPSHOT', 'EXPORT_DATA',
  'EXPORT_ATTACHMENTS', 'PACKAGE_COMPRESS_ENCRYPT', 'VERIFY_HASHES',
  'PUBLISHED', 'FAILED', 'CANCELLED',
]);

export const createCompanyArchiveBackupRequestSchema = z.object({
  idempotencyKey,
  reason: z.string().trim().min(3).max(500).optional(),
}).strict();

export const backupJobQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30),
}).strict();

export const backupPolicyFrequencySchema = z.enum(['MANUAL', 'DAILY', 'WEEKLY', 'MONTHLY']);

const backupScheduleClockSchema = z.object({
  timezone: z.string().trim().min(1).max(100),
  hour: z.number().int().min(0).max(23),
  minute: z.number().int().min(0).max(59),
}).strict();

export const backupPolicyScheduleSchema = z.union([
  z.object({ frequency: z.literal('MANUAL'), schedule: z.null() }).strict(),
  z.object({ frequency: z.literal('DAILY'), schedule: backupScheduleClockSchema }).strict(),
  z.object({ frequency: z.literal('WEEKLY'), schedule: backupScheduleClockSchema.extend({ weekday: z.number().int().min(0).max(6) }).strict() }).strict(),
  z.object({ frequency: z.literal('MONTHLY'), schedule: backupScheduleClockSchema.extend({ dayOfMonth: z.number().int().min(1).max(28) }).strict() }).strict(),
]);

export const upsertBackupPolicyRequestSchema = z.object({
  name: z.string().trim().min(1).max(80).default('default'),
  enabled: z.boolean(),
  schedule: backupPolicyScheduleSchema,
  retentionCount: z.number().int().min(1).max(3650),
}).strict();

export const backupPolicyReceiptSchema = z.object({
  id: uuid,
  companyId: companyIdSchema,
  name: z.string().min(1).max(80),
  enabled: z.boolean(),
  frequency: backupPolicyFrequencySchema,
  schedule: z.unknown().nullable(),
  retentionCount: z.number().int().min(1).max(3650),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const backupPolicyListReceiptSchema = z.object({
  companyId: companyIdSchema,
  policies: z.array(backupPolicyReceiptSchema).max(100),
}).strict();

/**
 * The present archive registry is deliberately a small, reviewed
 * configuration slice.  This is an API contract, not a marketing label: a
 * client must not treat a successfully verified artifact as a full recovery
 * point merely because it can be downloaded.
 */
export const companyArchiveCoverageSchema = z.literal('PARTIAL_CONFIGURATION_ONLY');

/** A verified encrypted artifact receipt. It deliberately excludes storage paths and key material. */
export const companyArchiveArtifactMetadataSchema = z.object({
  filename: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,200}\.bca$/i),
  byteSize: z.string().regex(/^\d+$/),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  format: z.literal('baseer-encrypted-company-archive/v1'),
  verifiedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
}).strict();

/**
 * A client may enable a direct-to-disk download only when `artifact` is
 * present.  Keeping the field optional during endpoint rollout preserves
 * compatibility with existing job receipts; absence is not proof that an
 * artifact exists and must render as unavailable.
 */
export const companyArchiveMetadataReceiptSchema = z.object({
  archiveCoverage: companyArchiveCoverageSchema,
  restoreEligible: z.literal(false),
  artifact: companyArchiveArtifactMetadataSchema.nullable(),
}).strict();

/**
 * `ARCHIVE_COMPLETE` is reserved for a future, independently reviewed
 * archive format and restore pipeline. The currently published contract is
 * intentionally limited to PARTIAL_CONFIGURATION_ONLY.
 */
export const restoreArchiveCoverageSchema = z.enum([
  'PARTIAL_CONFIGURATION_ONLY',
  'ARCHIVE_COMPLETE',
]);

export const createRestoreAsNewRequestSchema = z.object({
  archiveJobId: uuid,
  targetCompanyName: z.string().trim().min(1).max(160),
}).strict();

export const restoreAsNewStageSchema = z.enum([
  'RESTORE_REQUESTED',
  'ARCHIVE_COMPLETE',
  'DISCOVER_COMPANIES',
  'AWAITING_SOURCE_COMPANY_SELECTION',
  'PREPARE_TARGET_COMPANY',
  'VALIDATE',
  'APPLY',
  'VERIFY',
  'COMPLETED',
  'REJECTED',
  'FAILED',
  'CANCELLED',
]);

export const restoreAsNewProgressReceiptSchema = z.object({
  archiveJobId: uuid,
  targetCompanyName: z.string().trim().min(1).max(160),
  stage: restoreAsNewStageSchema,
  progressPercent: z.number().int().min(0).max(100),
  recordsProcessed: z.number().int().nonnegative(),
  recordsTotal: z.number().int().nonnegative().nullable(),
  bytesProcessed: z.string().regex(/^\d+$/),
  bytesTotal: z.string().regex(/^\d+$/).nullable(),
}).strict();

/** A source choice may only be constructed from the verified archive manifest. */
export const restoreAsNewManifestCompanyReceiptSchema = z.object({
  sourceCompanyId: companyIdSchema,
  nameAr: z.string().trim().min(1).max(500),
  nameEn: z.string().trim().min(1).max(500),
  recordCount: z.number().int().nonnegative(),
}).strict();

/**
 * This is a discovery plan, never proof that data has been imported or that a
 * target company has been created. The actual selection/apply worker is a
 * later gate.
 */
export const restoreAsNewDiscoveryReceiptSchema = restoreAsNewProgressReceiptSchema.extend({
  archiveCoverage: z.literal('ARCHIVE_COMPLETE'),
  restoreEligible: z.literal(true),
  sourceCompanies: z.array(restoreAsNewManifestCompanyReceiptSchema).min(1).max(100),
}).strict();

export const backupJobReceiptSchema = z.object({
  id: uuid,
  companyId: companyIdSchema,
  kind: z.literal('COMPANY_ARCHIVE_EXPORT'),
  status: backupJobStatusSchema,
  stage: z.string().min(1).max(80),
  progressPercent: z.number().int().min(0).max(100),
  recordsProcessed: z.number().int().nonnegative(),
  recordsTotal: z.number().int().nonnegative().nullable(),
  bytesProcessed: z.string().regex(/^\d+$/),
  bytesTotal: z.string().regex(/^\d+$/).nullable(),
  attemptCount: z.number().int().nonnegative(),
  lastErrorCode: z.string().max(120).nullable(),
  lastErrorMessage: z.string().max(1000).nullable(),
  correlationId: uuid,
  queuedAt: z.string().datetime(),
  startedAt: z.string().datetime().nullable(),
  completedAt: z.string().datetime().nullable(),
  updatedAt: z.string().datetime(),
  // Optional only while existing job endpoints roll out this new evidence.
  // Its absence never authorizes download or implies a recoverable archive.
  archiveCoverage: companyArchiveCoverageSchema.optional(),
  restoreEligible: z.literal(false).optional(),
  artifact: companyArchiveArtifactMetadataSchema.nullable().optional(),
}).strict();

export const backupJobListReceiptSchema = z.object({
  companyId: companyIdSchema,
  jobs: z.array(backupJobReceiptSchema).max(100),
}).strict();

/** Audit payloads and artifact locations stay server-side; this exposes only
 * the non-sensitive evidence needed to observe sequence and correlation. */
export const backupAuditEventReceiptSchema = z.object({
  id: uuid,
  action: z.string().min(1).max(120),
  actorUserId: uuid.nullable(),
  correlationId: uuid,
  previousHashPrefix: z.string().regex(/^[a-f0-9]{12}$/).nullable(),
  eventHashPrefix: z.string().regex(/^[a-f0-9]{12}$/),
  createdAt: z.string().datetime(),
}).strict();

export const backupAuditListReceiptSchema = z.object({
  companyId: companyIdSchema,
  events: z.array(backupAuditEventReceiptSchema).max(100),
}).strict();

export type CreateCompanyArchiveBackupRequest = z.infer<typeof createCompanyArchiveBackupRequestSchema>;
export type UpsertBackupPolicyRequest = z.infer<typeof upsertBackupPolicyRequestSchema>;
export type BackupJobReceipt = z.infer<typeof backupJobReceiptSchema>;
export type CompanyArchiveArtifactMetadata = z.infer<typeof companyArchiveArtifactMetadataSchema>;
export type CompanyArchiveMetadataReceipt = z.infer<typeof companyArchiveMetadataReceiptSchema>;
export type CreateRestoreAsNewRequest = z.infer<typeof createRestoreAsNewRequestSchema>;
export type RestoreAsNewProgressReceipt = z.infer<typeof restoreAsNewProgressReceiptSchema>;
export type RestoreAsNewDiscoveryReceipt = z.infer<typeof restoreAsNewDiscoveryReceiptSchema>;
