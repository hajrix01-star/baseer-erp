import { z } from "zod";

const inboundEvidenceIdSchema = z.string().uuid();
const idempotencyKeySchema = z.string().trim().min(8).max(255);
const labelNameSchema = z.string().trim().min(1).max(80);
const ruleNameSchema = z.string().trim().min(1).max(120);
const containsSchema = z.string().trim().min(1).max(240);
const colorHexSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const inboundEvidenceAttachmentConditionSchema = z.enum(["ANY", "REQUIRED", "ABSENT"]);
export const inboundEvidenceConnectorStatusSchema = z.enum(["NOT_CONNECTED", "AUTHORIZING", "CONNECTED", "REAUTH_REQUIRED", "BLOCKED", "PLANNED"]);
export const inboundEvidenceAttachmentStatusSchema = z.enum(["STORED", "QUARANTINED", "UNSUPPORTED", "TOO_LARGE", "FAILED"]);
export const inboundEvidenceAnalysisStatusSchema = z.enum(["ANALYZED", "NEEDS_REVIEW", "FAILED"]);
export const inboundEvidenceDocumentKindSchema = z.enum(["INVOICE", "TRANSFER_CONFIRMATION", "TAX_NOTICE", "PLATFORM_NOTICE", "STATEMENT", "OTHER", "UNKNOWN"]);
export const inboundEvidenceMoneyDirectionSchema = z.enum(["INCOMING", "OUTGOING", "UNKNOWN"]);

export const inboundEvidenceLabelSchema = z.object({
  id: inboundEvidenceIdSchema,
  nameAr: labelNameSchema,
  nameEn: z.string().max(80).nullable(),
  colorHex: colorHexSchema,
  sortOrder: z.number().int().min(0).max(10_000),
  systemKey: z.string().max(80).nullable(),
  ruleCount: z.number().int().min(0),
}).strict();

export const inboundEvidenceRuleSchema = z.object({
  id: inboundEvidenceIdSchema,
  name: ruleNameSchema,
  enabled: z.boolean(),
  priority: z.number().int().min(1).max(10_000),
  labelId: inboundEvidenceIdSchema,
  senderContains: z.string().nullable(),
  subjectContains: z.string().nullable(),
  attachmentCondition: inboundEvidenceAttachmentConditionSchema,
}).strict();

export const inboundEvidenceHubWorkspaceSchema = z.object({
  labels: z.array(inboundEvidenceLabelSchema).max(200),
  rules: z.array(inboundEvidenceRuleSchema).max(500),
  connector: z.object({
    status: inboundEvidenceConnectorStatusSchema,
    messageAr: z.string(),
    messageEn: z.string(),
  }).strict(),
}).strict();

export const inboundEvidenceGmailConnectionSchema = z.object({
  status: inboundEvidenceConnectorStatusSchema,
  mailboxEmail: z.string().email().nullable(),
  lastSyncedAt: z.string().datetime().nullable(),
  messageCount: z.number().int().min(0),
  attachmentCount: z.number().int().min(0),
  messageAr: z.string(),
  messageEn: z.string(),
}).strict();

export const inboundEvidenceAuthorizationStartSchema = z.object({
  authorizationUrl: z.string().url(),
  expiresAt: z.string().datetime(),
}).strict();

/** Names only: no credential value or secret is ever returned to a browser. */
export const inboundEvidenceGmailReadinessSchema = z.object({
  ready: z.boolean(),
  missing: z.array(z.string().min(1).max(120)).max(20),
  redirectUri: z.string().url().nullable(),
}).strict();

export const inboundEvidenceSyncRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  maxMessages: z.number().int().min(1).max(100).default(25),
}).strict();

export const inboundEvidenceSyncReceiptSchema = z.object({
  importedMessages: z.number().int().min(0),
  downloadedAttachments: z.number().int().min(0),
  skippedAttachments: z.number().int().min(0),
  replayed: z.boolean(),
}).strict();

export const inboundEvidenceMessageSchema = z.object({
  id: inboundEvidenceIdSchema,
  sender: z.string().nullable(),
  subject: z.string().nullable(),
  snippet: z.string().nullable(),
  receivedAt: z.string().datetime().nullable(),
  hasAttachments: z.boolean(),
  labels: z.array(inboundEvidenceLabelSchema.pick({ id: true, nameAr: true, nameEn: true, colorHex: true })).max(20),
  attachments: z.array(z.object({
    id: inboundEvidenceIdSchema,
    fileName: z.string(),
    mimeType: z.string(),
    byteSize: z.string(),
    status: inboundEvidenceAttachmentStatusSchema,
  }).strict()).max(50),
}).strict();

export const inboundEvidenceMessagesReadSchema = z.object({
  messages: z.array(inboundEvidenceMessageSchema).max(100),
}).strict();

export const analyzeInboundEvidenceAttachmentRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
}).strict();

const inboundEvidenceAnalysisFieldSchema = z.object({
  key: z.string().min(1).max(80),
  value: z.string().max(500).nullable(),
  confidence: z.number().min(0).max(1),
  page: z.number().int().min(1).max(500).nullable(),
  evidenceExcerpt: z.string().max(300).nullable(),
}).strict();

export const inboundEvidenceDocumentAnalysisSchema = z.object({
  id: inboundEvidenceIdSchema,
  attachmentId: inboundEvidenceIdSchema,
  status: inboundEvidenceAnalysisStatusSchema,
  documentKind: inboundEvidenceDocumentKindSchema,
  summaryAr: z.string().min(1).max(1400),
  direction: inboundEvidenceMoneyDirectionSchema,
  supplierOrPlatform: z.string().max(240).nullable(),
  reference: z.string().max(240).nullable(),
  documentDate: z.string().date().nullable(),
  dueDate: z.string().date().nullable(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable(),
  netAmount: z.string().max(40).nullable(),
  taxAmount: z.string().max(40).nullable(),
  grossAmount: z.string().max(40).nullable(),
  overallConfidence: z.number().min(0).max(1),
  warnings: z.array(z.string().max(300)).max(12),
  suspectedPromptInjection: z.boolean(),
  fields: z.array(inboundEvidenceAnalysisFieldSchema).max(24),
  validationWarnings: z.array(z.string().max(300)).max(12),
  skillKey: z.string().max(120),
  skillVersion: z.number().int().min(1),
  model: z.string().max(160),
  createdAt: z.string().datetime(),
  replayed: z.boolean(),
}).strict();

export const inboundEvidenceAttachmentAnalysesReadSchema = z.object({
  analyses: z.array(inboundEvidenceDocumentAnalysisSchema).max(20),
}).strict();

const labelPayloadSchema = z.object({
  nameAr: labelNameSchema,
  nameEn: z.string().trim().max(80).optional(),
  colorHex: colorHexSchema,
  sortOrder: z.number().int().min(0).max(10_000),
}).strict();

export const createInboundEvidenceLabelRequestSchema = labelPayloadSchema.extend({ idempotencyKey: idempotencyKeySchema }).strict();
export const updateInboundEvidenceLabelRequestSchema = labelPayloadSchema.extend({ idempotencyKey: idempotencyKeySchema }).strict();
export const deleteInboundEvidenceLabelRequestSchema = z.object({ idempotencyKey: idempotencyKeySchema }).strict();

const rulePayloadSchema = z.object({
  name: ruleNameSchema,
  enabled: z.boolean(),
  priority: z.number().int().min(1).max(10_000),
  labelId: inboundEvidenceIdSchema,
  senderContains: containsSchema.optional(),
  subjectContains: containsSchema.optional(),
  attachmentCondition: inboundEvidenceAttachmentConditionSchema,
}).strict().refine((value) => Boolean(value.senderContains || value.subjectContains || value.attachmentCondition !== "ANY"), {
  message: "A rule needs at least one condition.",
});

export const createInboundEvidenceRuleRequestSchema = rulePayloadSchema.extend({ idempotencyKey: idempotencyKeySchema }).strict();
export const updateInboundEvidenceRuleRequestSchema = rulePayloadSchema.extend({ idempotencyKey: idempotencyKeySchema }).strict();
export const deleteInboundEvidenceRuleRequestSchema = z.object({ idempotencyKey: idempotencyKeySchema }).strict();
export const inboundEvidenceEntityReceiptSchema = z.object({ id: inboundEvidenceIdSchema, replayed: z.boolean() }).strict();

export type InboundEvidenceHubWorkspace = z.infer<typeof inboundEvidenceHubWorkspaceSchema>;
export type CreateInboundEvidenceLabelRequest = z.infer<typeof createInboundEvidenceLabelRequestSchema>;
export type UpdateInboundEvidenceLabelRequest = z.infer<typeof updateInboundEvidenceLabelRequestSchema>;
export type CreateInboundEvidenceRuleRequest = z.infer<typeof createInboundEvidenceRuleRequestSchema>;
export type UpdateInboundEvidenceRuleRequest = z.infer<typeof updateInboundEvidenceRuleRequestSchema>;
export type InboundEvidenceGmailConnection = z.infer<typeof inboundEvidenceGmailConnectionSchema>;
export type AnalyzeInboundEvidenceAttachmentRequest = z.infer<typeof analyzeInboundEvidenceAttachmentRequestSchema>;
export type InboundEvidenceDocumentAnalysis = z.infer<typeof inboundEvidenceDocumentAnalysisSchema>;
