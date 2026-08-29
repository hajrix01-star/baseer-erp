import { z } from 'zod';

const runId = z.string().uuid();
const text = z.string().trim().min(3).max(500);

export const nurixMigrationDirectCandidateKindSchema = z.enum(['CATEGORY_DIRECT', 'ACCOUNT_CODE_TYPE']);
export const nurixMigrationExceptionSeveritySchema = z.enum(['BLOCKER', 'REVIEW', 'WARNING']);
export const nurixMigrationRunStatusSchema = z.enum(['DISCOVERY', 'DRY_RUN', 'READY_TO_STAGE', 'STAGED', 'RECONCILED', 'FAILED', 'CANCELLED']);
export const nurixMigrationCounterpartyCandidateKindSchema = z.enum(['EXPLICIT_ALIAS', 'REVIEW_REQUIRED']);
export const nurixMigrationCounterpartyKindSchema = z.enum(['COMMERCIAL_SUPPLIER', 'GOVERNMENT_AUTHORITY', 'GOVERNMENT_PLATFORM', 'UTILITY_PROVIDER', 'OTHER']);

export const nurixMigrationReviewActionSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(['APPROVE_DIRECT_CANDIDATES', 'APPROVE_COMPANY_MAPS', 'ACKNOWLEDGE_EXCEPTION']),
  actionKey: z.string().min(1).max(120),
  reason: text,
  createdAt: z.string().datetime(),
}).strict();

export const nurixMigrationExceptionSchema = z.object({
  id: z.string().uuid(),
  severity: nurixMigrationExceptionSeveritySchema,
  code: z.string().min(1).max(120),
  message: z.string().min(1).max(500),
  sourceEntity: z.string().min(1).max(120).nullable(),
  acknowledged: z.boolean(),
  createdAt: z.string().datetime(),
}).strict();

export const nurixMigrationDirectCandidateSchema = z.object({
  kind: nurixMigrationDirectCandidateKindSchema,
  count: z.number().int().nonnegative(),
  approved: z.boolean(),
}).strict();

export const nurixMigrationRunSummarySchema = z.object({
  id: runId,
  sourceSystem: z.literal('NOORIX_POSTGRES_ARCHIVE'),
  sourceFingerprintPrefix: z.string().regex(/^[a-f0-9]{12}$/),
  transformVersion: z.string().min(1).max(80),
  status: nurixMigrationRunStatusSchema,
  companyCount: z.number().int().nonnegative(),
  directCandidates: z.array(nurixMigrationDirectCandidateSchema).max(2),
  counterpartyResolutions: z.object({ explicitAlias: z.number().int().nonnegative(), manual: z.number().int().nonnegative() }).strict(),
  supplierReadiness: z.object({
    candidates: z.number().int().nonnegative(),
    resolved: z.number().int().nonnegative(),
    unresolved: z.number().int().nonnegative(),
    companyMaps: z.number().int().nonnegative(),
    approvedCompanyMaps: z.number().int().nonnegative(),
    categoryCandidatesApproved: z.boolean(),
    accountCandidatesApproved: z.boolean(),
    provisionalSuppliers: z.number().int().nonnegative(),
    provisionalVaults: z.number().int().nonnegative(),
    canCreateProvisionalSuppliers: z.boolean(),
    canStage: z.boolean(),
  }).strict(),
  exceptionCounts: z.object({ blockers: z.number().int().nonnegative(), review: z.number().int().nonnegative(), warnings: z.number().int().nonnegative() }).strict(),
  createdAt: z.string().datetime(),
}).strict();

export const nurixMigrationRunListReceiptSchema = z.object({ runs: z.array(nurixMigrationRunSummarySchema).max(50) }).strict();
export const nurixMigrationReviewReceiptSchema = z.object({
  run: nurixMigrationRunSummarySchema,
  exceptions: z.array(nurixMigrationExceptionSchema).max(250),
  actions: z.array(nurixMigrationReviewActionSchema).max(250),
}).strict();

export const approveNurixDirectCandidatesRequestSchema = z.object({
  kind: nurixMigrationDirectCandidateKindSchema,
  reason: text,
}).strict();
export const acknowledgeNurixMigrationExceptionRequestSchema = z.object({ reason: text }).strict();
export const approveNurixCompanyMapsRequestSchema = z.object({ reason: text }).strict();
/** Creates company-scoped supplier shells only; it never imports documents or balances. */
export const createNurixProvisionalSuppliersRequestSchema = z.object({ reason: text }).strict();
export const nurixProvisionalSuppliersReceiptSchema = z.object({
  created: z.number().int().nonnegative(),
  reused: z.number().int().nonnegative(),
  linkedToExistingIdentity: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
}).strict();
export const nurixMigrationRunIdSchema = runId;

export const nurixMigrationCounterpartyIdentityOptionSchema = z.object({
  id: runId,
  canonicalKey: z.string().min(1).max(100),
  canonicalNameAr: z.string().min(1).max(160),
  kind: nurixMigrationCounterpartyKindSchema,
}).strict();
export const nurixMigrationCounterpartyCandidateSchema = z.object({
  id: runId,
  sourceCompanyId: z.string().min(1).max(120),
  sourceSupplierId: z.string().min(1).max(160),
  nameAr: z.string().min(1).max(160),
  nameEn: z.string().max(160).nullable(),
  kind: nurixMigrationCounterpartyCandidateKindSchema,
  resolution: z.object({ kind: z.enum(['EXPLICIT_ALIAS', 'MANUAL']), identity: nurixMigrationCounterpartyIdentityOptionSchema }).strict().nullable(),
}).strict();
export const nurixMigrationCounterpartyQueueQuerySchema = z.object({
  cursor: runId.optional(),
  kind: nurixMigrationCounterpartyCandidateKindSchema.optional(),
}).strict();
export const nurixMigrationCounterpartyQueueReceiptSchema = z.object({
  candidates: z.array(nurixMigrationCounterpartyCandidateSchema).max(50),
  identities: z.array(nurixMigrationCounterpartyIdentityOptionSchema).max(250),
  nextCursor: runId.nullable(),
}).strict();
export const nurixMigrationCounterpartyReviewGroupSchema = z.object({
  key: z.string().regex(/^[a-f0-9]{64}$/),
  nameAr: z.string().min(1).max(160),
  count: z.number().int().positive(),
  companyCount: z.number().int().positive(),
}).strict();
export const nurixMigrationCounterpartyReviewGroupReceiptSchema = z.object({
  groups: z.array(nurixMigrationCounterpartyReviewGroupSchema).max(100),
  identities: z.array(nurixMigrationCounterpartyIdentityOptionSchema).max(250),
}).strict();
export const nurixMigrationCounterpartySuggestionActionSchema = z.enum(['MATCH_EXISTING_IDENTITY', 'CREATE_COMMERCIAL_GROUP', 'REVIEW_MANUALLY']);
export const nurixMigrationCounterpartySuggestionConfidenceSchema = z.enum(['HIGH', 'MEDIUM', 'LOW']);
export const nurixMigrationCounterpartySuggestionSchema = z.object({
  groupKey: z.string().regex(/^[a-f0-9]{64}$/),
  nameAr: z.string().min(1).max(160),
  count: z.number().int().positive(),
  companyCount: z.number().int().positive(),
  action: nurixMigrationCounterpartySuggestionActionSchema,
  confidence: nurixMigrationCounterpartySuggestionConfidenceSchema,
  reasonAr: z.string().min(3).max(500),
  identity: nurixMigrationCounterpartyIdentityOptionSchema.nullable(),
}).strict();
export const nurixMigrationCounterpartySuggestionsReceiptSchema = z.object({
  suggestions: z.array(nurixMigrationCounterpartySuggestionSchema).max(250),
  summary: z.object({ high: z.number().int().nonnegative(), medium: z.number().int().nonnegative(), low: z.number().int().nonnegative() }).strict(),
}).strict();
export const resolveNurixMigrationCounterpartyRequestSchema = z.object({ identityId: runId, reason: text }).strict();
export const createCommercialNurixMigrationCounterpartyRequestSchema = z.object({ reason: text }).strict();

export type ApproveNurixDirectCandidatesRequest = z.infer<typeof approveNurixDirectCandidatesRequestSchema>;
export type AcknowledgeNurixMigrationExceptionRequest = z.infer<typeof acknowledgeNurixMigrationExceptionRequestSchema>;
export type ApproveNurixCompanyMapsRequest = z.infer<typeof approveNurixCompanyMapsRequestSchema>;
export type CreateNurixProvisionalSuppliersRequest = z.infer<typeof createNurixProvisionalSuppliersRequestSchema>;
export type ResolveNurixMigrationCounterpartyRequest = z.infer<typeof resolveNurixMigrationCounterpartyRequestSchema>;
export type CreateCommercialNurixMigrationCounterpartyRequest = z.infer<typeof createCommercialNurixMigrationCounterpartyRequestSchema>;
