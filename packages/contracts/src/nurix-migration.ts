import { z } from 'zod';

const runId = z.string().uuid();
const text = z.string().trim().min(3).max(500);

export const nurixMigrationDirectCandidateKindSchema = z.enum(['CATEGORY_DIRECT', 'ACCOUNT_CODE_TYPE']);
export const nurixMigrationExceptionSeveritySchema = z.enum(['BLOCKER', 'REVIEW', 'WARNING']);
export const nurixMigrationRunStatusSchema = z.enum(['DISCOVERY', 'DRY_RUN', 'READY_TO_STAGE', 'STAGED', 'RECONCILED', 'FAILED', 'CANCELLED']);
export const nurixMigrationCounterpartyCandidateKindSchema = z.enum(['EXPLICIT_ALIAS', 'REVIEW_REQUIRED']);
export const nurixMigrationCounterpartyKindSchema = z.enum(['COMMERCIAL_SUPPLIER', 'GOVERNMENT_AUTHORITY', 'GOVERNMENT_PLATFORM', 'UTILITY_PROVIDER', 'OTHER']);

/**
 * Version two carries Baseer category codes directly in invoice rows.  The
 * Noorix category is normalized before import, leaving no category decision
 * for the financial writer to make later.
 */
export const nurixExcelImportTemplateVersionSchema = z.literal('nurix-excel-package/v3');
export const nurixExcelImportWorkbookSheetSchema = z.object({
  name: z.string().trim().min(1).max(80),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  rowCount: z.number().int().nonnegative(),
}).strict();
export const nurixExcelImportWorkbookSchema = z.object({
  fileName: z.string().trim().min(1).max(180),
  mimeType: z.string().trim().min(1).max(160),
  /** Browser clients are not trusted to derive this. The API parser will make it mandatory before a row dry-run. */
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  byteSize: z.number().int().positive().max(100 * 1024 * 1024),
  exportedAt: z.string().datetime(),
  /** Optional at metadata intake; the server parser will discover and hash workbook sheets itself. */
  sheets: z.array(nurixExcelImportWorkbookSheetSchema).min(1).max(30).optional(),
  /** Only accepted with Baseer’s dedicated content type and bounded before decode. */
  contentsBase64: z.string().min(4).max(8 * 1024 * 1024).optional(),
}).strict();
export const nurixExcelImportDryRunRequestSchema = z.object({
  targetCompanyId: runId,
  sourceCompanyId: z.string().trim().min(1).max(120),
  templateVersion: nurixExcelImportTemplateVersionSchema,
  workbook: nurixExcelImportWorkbookSchema,
}).strict();
export const nurixExcelImportCheckSchema = z.object({
  code: z.string().min(1).max(120),
  passed: z.boolean(),
  messageAr: z.string().min(1).max(300),
}).strict();
/** Source-declared control counts and totals, recomputed from the parsed file
 * before the package can be considered for a later reconciliation gate. */
export const nurixExcelImportReconciliationSchema = z.object({
  passed: z.boolean(),
  counts: z.array(z.object({
    key: z.string().min(1).max(120),
    sheet: z.string().min(1).max(80),
    declaredRows: z.number().int().nonnegative(),
    parsedRows: z.number().int().nonnegative(),
    matches: z.boolean(),
  }).strict()).max(10),
  totals: z.array(z.object({
    key: z.string().min(1).max(120),
    sheet: z.string().min(1).max(80),
    column: z.string().min(1).max(80),
    declaredAmount: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/),
    parsedAmount: z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/),
    matches: z.boolean(),
  }).strict()).max(20),
}).strict();
/**
 * Read-only comparison of source master rows against the selected Baseer
 * company.  A candidate is never a write instruction: unresolved vaults in
 * particular require an approved account relationship before creation.
 */
export const nurixExcelImportMasterDataReadinessSchema = z.object({
  availability: z.enum(['READ_ONLY_ANALYZED', 'PENDING_TARGET_READ']),
  exactMatches: z.object({
    suppliers: z.number().int().nonnegative(),
    accounts: z.number().int().nonnegative(),
    categories: z.number().int().nonnegative(),
    vaults: z.number().int().nonnegative(),
    employees: z.number().int().nonnegative(),
  }).strict(),
  createCandidates: z.object({
    suppliers: z.number().int().nonnegative(),
    accounts: z.number().int().nonnegative(),
    categories: z.number().int().nonnegative(),
    vaults: z.number().int().nonnegative(),
    employees: z.number().int().nonnegative(),
  }).strict(),
  reviewRequired: z.object({
    suppliers: z.number().int().nonnegative(),
    accounts: z.number().int().nonnegative(),
    categories: z.number().int().nonnegative(),
    vaults: z.number().int().nonnegative(),
    employees: z.number().int().nonnegative(),
  }).strict(),
  canWrite: z.literal(false),
}).strict();
export const nurixExcelImportDryRunReceiptSchema = z.object({
  mode: z.literal('PREFLIGHT_DRY_RUN'),
  status: z.enum(['PENDING_WORKBOOK_PARSER', 'PARSED_DRY_RUN', 'REJECTED']),
  templateVersion: nurixExcelImportTemplateVersionSchema,
  sourceCompanyId: z.string().min(1).max(120),
  targetCompanyId: runId,
  financialWrites: z.literal(0),
  parsedRows: z.number().int().nonnegative(),
  acceptedRows: z.number().int().nonnegative(),
  rejectedRows: z.number().int().nonnegative(),
  canStage: z.literal(false),
  stagingPackageId: runId.nullable(),
  checks: z.array(nurixExcelImportCheckSchema).max(20),
  reconciliation: nurixExcelImportReconciliationSchema,
  masterDataReadiness: nurixExcelImportMasterDataReadinessSchema,
  rowIssues: z.array(z.object({ sheet: z.string().min(1).max(80), rowNumber: z.number().int().positive(), code: z.string().min(1).max(120) }).strict()).max(100),
}).strict();
/**
 * Durable package/batch/row shapes for the next parser gate.  They exclude
 * raw cell data and therefore remain safe to keep in audit-facing APIs.
 */
export const nurixExcelImportPackageStatusSchema = z.enum(['RECEIVED', 'PREFLIGHT_REJECTED', 'ROW_DRY_RUN', 'READY_FOR_OWNER_REVIEW', 'FAILED']);
export const nurixExcelImportBatchStatusSchema = z.enum(['PENDING', 'PARSING', 'VALIDATED', 'FAILED', 'CANCELLED']);
export const nurixExcelImportRowStatusSchema = z.enum(['ACCEPTED', 'REJECTED', 'SKIPPED']);
export const nurixExcelImportPackageSchema = z.object({
  id: runId,
  targetCompanyId: runId,
  sourceCompanyId: z.string().min(1).max(120),
  templateVersion: nurixExcelImportTemplateVersionSchema,
  workbookSha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: nurixExcelImportPackageStatusSchema,
  createdAt: z.string().datetime(),
}).strict();
export const nurixExcelImportBatchSchema = z.object({
  id: runId,
  packageId: runId,
  sequence: z.number().int().positive(),
  status: nurixExcelImportBatchStatusSchema,
  rowsDeclared: z.number().int().nonnegative(),
  rowsAccepted: z.number().int().nonnegative(),
  rowsRejected: z.number().int().nonnegative(),
}).strict();
export const nurixExcelImportRowResultSchema = z.object({
  batchId: runId,
  sheet: z.string().min(1).max(80),
  rowNumber: z.number().int().positive(),
  sourceEntity: z.string().min(1).max(120),
  sourceId: z.string().min(1).max(160).nullable(),
  rowSha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: nurixExcelImportRowStatusSchema,
  code: z.string().min(1).max(120),
}).strict();
/** Starts or resumes only safe company master data from a verified encrypted
 * package. Suppliers and vaults stay out of this command; financial writers
 * are structurally excluded. */
export const executeNurixExcelMasterDataRequestSchema = z.object({
  reason: z.string().trim().max(500).optional(),
  waveSize: z.number().int().min(25).max(500).default(500),
}).strict();
const nurixExcelMasterDataCountsSchema = z.object({
  accounts: z.number().int().nonnegative(),
  categories: z.number().int().nonnegative(),
  employees: z.number().int().nonnegative(),
}).strict();
export const nurixExcelMasterDataExecutionReceiptSchema = z.object({
  executionId: runId,
  status: z.enum(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']),
  created: nurixExcelMasterDataCountsSchema,
  reused: nurixExcelMasterDataCountsSchema,
  reviewRequired: nurixExcelMasterDataCountsSchema,
  processed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  completed: z.boolean(),
  waves: z.number().int().positive(),
  financialWrites: z.literal(0),
}).strict();
export const nurixExcelImportTemplateReceiptSchema = z.object({
  templateVersion: nurixExcelImportTemplateVersionSchema,
  sourceSystem: z.literal('NOORIX_EXCEL_EXPORT'),
  sheets: z.array(z.object({
    name: z.string().min(1).max(80),
    requiredColumns: z.array(z.string().min(1).max(80)).min(1).max(30),
  }).strict()).min(1).max(30),
}).strict();

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
export const createNurixProvisionalSuppliersRequestSchema = z.object({
  reason: text,
  /** A committed wave is the resume checkpoint; keep it bounded and visible. */
  waveSize: z.number().int().min(25).max(500).default(500),
}).strict();
export const nurixProvisionalSuppliersReceiptSchema = z.object({
  created: z.number().int().nonnegative(),
  reused: z.number().int().nonnegative(),
  linkedToExistingIdentity: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  processed: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative(),
  completed: z.boolean(),
  waves: z.number().int().positive(),
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

const nurixHistoricalPayrollMoneySchema = z.string().regex(/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,4})?$/);
export const nurixHistoricalPayrollEvidenceReceiptSchema = z.object({
  companyId: runId,
  runs: z.array(z.object({
    sourceRunNumber: z.string().min(1).max(80),
    payrollMonth: z.string().datetime(),
    sourceAccruedAt: z.string().datetime(),
    employeeCount: z.number().int().positive(),
    lineCount: z.number().int().positive(),
    grossAmount: nurixHistoricalPayrollMoneySchema,
    deductionsAmount: nurixHistoricalPayrollMoneySchema,
    sourceAdvancesAmount: nurixHistoricalPayrollMoneySchema,
    appliedAdvancesAmount: nurixHistoricalPayrollMoneySchema,
    advanceCarryoverEvidenceAmount: nurixHistoricalPayrollMoneySchema,
    netAmount: nurixHistoricalPayrollMoneySchema,
    paymentEvidenceKind: z.enum(['NONE', 'AMOUNT_ONLY']),
    paymentEvidenceAmount: nurixHistoricalPayrollMoneySchema.nullable(),
    status: z.literal('EVIDENCE_ONLY'),
  }).strict()).max(120),
}).strict();

export type ApproveNurixDirectCandidatesRequest = z.infer<typeof approveNurixDirectCandidatesRequestSchema>;
export type AcknowledgeNurixMigrationExceptionRequest = z.infer<typeof acknowledgeNurixMigrationExceptionRequestSchema>;
export type ApproveNurixCompanyMapsRequest = z.infer<typeof approveNurixCompanyMapsRequestSchema>;
export type CreateNurixProvisionalSuppliersRequest = z.infer<typeof createNurixProvisionalSuppliersRequestSchema>;
export type ResolveNurixMigrationCounterpartyRequest = z.infer<typeof resolveNurixMigrationCounterpartyRequestSchema>;
export type CreateCommercialNurixMigrationCounterpartyRequest = z.infer<typeof createCommercialNurixMigrationCounterpartyRequestSchema>;
export type NurixExcelImportDryRunRequest = z.infer<typeof nurixExcelImportDryRunRequestSchema>;
export type NurixExcelImportPackage = z.infer<typeof nurixExcelImportPackageSchema>;
export type NurixExcelImportBatch = z.infer<typeof nurixExcelImportBatchSchema>;
export type NurixExcelImportRowResult = z.infer<typeof nurixExcelImportRowResultSchema>;
export type ExecuteNurixExcelMasterDataRequest = z.infer<typeof executeNurixExcelMasterDataRequestSchema>;
export type NurixExcelMasterDataExecutionReceipt = z.infer<typeof nurixExcelMasterDataExecutionReceiptSchema>;
export type NurixHistoricalPayrollEvidenceReceipt = z.infer<typeof nurixHistoricalPayrollEvidenceReceiptSchema>;
