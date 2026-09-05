import { z } from "zod";

const uuidSchema = z.string().uuid();
const moneySchema = z.string().regex(/^-?\d{1,16}(?:\.\d{1,2})?$/);
const dateSchema = z.string().date();
const cursorSchema = uuidSchema;

export const whatsappInvoiceMonitoringExtractionStateSchema = z.enum(["NOT_REQUESTED", "QUEUED", "RUNNING", "SUCCEEDED", "FAILED"]);
export const whatsappInvoiceMonitoringQualityStateSchema = z.enum(["VALID", "INCOMPLETE", "CONFLICT"]);
export const whatsappInvoiceMonitoringApprovalStateSchema = z.enum(["APPROVED_MONITORING", "INCOMPLETE"]);
export const whatsappInvoiceMonitoringDuplicateStateSchema = z.enum(["UNCHECKED", "CLEAR", "SUSPECTED", "CONFIRMED", "DISMISSED"]);
export const whatsappInvoiceMonitoringArchiveStateSchema = z.enum(["ACTIVE", "ARCHIVED"]);
export const whatsappInvoiceMonitoringPurchaseStateSchema = z.enum(["NOT_LINKED", "PREPARING", "DRAFT_LINKED", "DOCUMENT_LINKED", "CANCELLED"]);
export const whatsappInvoiceMonitoringDateBasisSchema = z.enum(["RECEIVED_AT", "INVOICE_DATE"]);
export const whatsappInvoiceMonitoringTabSchema = z.enum(["assets", "invoices", "notes", "archive", "settings"]);

export const whatsappInvoiceMonitoringQuerySchema = z.object({
  dateBasis: whatsappInvoiceMonitoringDateBasisSchema.default("RECEIVED_AT"),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  tab: whatsappInvoiceMonitoringTabSchema.default("assets"),
  cursor: cursorSchema.optional(),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
  /** Temporary UI compatibility alias. The server always prefers pageSize. */
  limit: z.coerce.number().int().min(1).max(100).optional(),
  supplier: z.string().trim().min(1).max(160).optional(),
  /** UI-facing broad supplier/invoice search; server does not treat it as evidence. */
  search: z.string().trim().min(1).max(160).optional(),
  groupBindingId: uuidSchema.optional(),
  duplicateState: whatsappInvoiceMonitoringDuplicateStateSchema.optional(),
  archiveState: whatsappInvoiceMonitoringArchiveStateSchema.optional(),
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, {
  message: "The start date must not be after the end date.",
  path: ["to"],
});

const recordValuePatchSchema = z.object({
  supplierId: uuidSchema.nullable().optional(),
  supplierName: z.string().trim().min(1).max(240).nullable().optional(),
  supplierTaxNumber: z.string().trim().min(1).max(80).nullable().optional(),
  invoiceNumber: z.string().trim().min(1).max(160).nullable().optional(),
  invoiceDate: dateSchema.nullable().optional(),
  currencyCode: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  netAmount: moneySchema.nullable().optional(),
  vatAmount: moneySchema.nullable().optional(),
  grossAmount: moneySchema.nullable().optional(),
  approvalState: whatsappInvoiceMonitoringApprovalStateSchema.optional(),
  archiveState: whatsappInvoiceMonitoringArchiveStateSchema.optional(),
}).strict();

export const updateWhatsappInvoiceMonitoringRecordRequestSchema = recordValuePatchSchema.extend({
  expectedRowVersion: z.number().int().min(0),
  reason: z.string().trim().min(3).max(500),
}).strict().refine((value) => Object.keys(recordValuePatchSchema.shape).some((key) => key in value), {
  message: "At least one monitoring field must be changed.",
});

export const whatsappInvoiceMonitoringRecordSchema = z.object({
  id: uuidSchema,
  groupBindingId: uuidSchema.nullable(),
  supplierId: uuidSchema.nullable(),
  supplierName: z.string().nullable(),
  supplierTaxNumber: z.string().nullable(),
  invoiceNumber: z.string().nullable(),
  invoiceDate: dateSchema.nullable(),
  receivedAt: z.string().datetime(),
  currencyCode: z.string().nullable(),
  netAmount: z.string().nullable(),
  vatAmount: z.string().nullable(),
  grossAmount: z.string().nullable(),
  extractionState: whatsappInvoiceMonitoringExtractionStateSchema,
  qualityState: whatsappInvoiceMonitoringQualityStateSchema,
  approvalState: whatsappInvoiceMonitoringApprovalStateSchema,
  duplicateState: whatsappInvoiceMonitoringDuplicateStateSchema,
  archiveState: whatsappInvoiceMonitoringArchiveStateSchema,
  purchaseState: whatsappInvoiceMonitoringPurchaseStateSchema,
  rowVersion: z.number().int().min(0),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

export const whatsappInvoiceMonitoringRecordPageSchema = z.object({
  records: z.array(whatsappInvoiceMonitoringRecordSchema).max(100),
  nextCursor: cursorSchema.nullable(),
}).strict();

export const whatsappInvoiceMonitoringSummarySchema = z.object({
  countedInvoiceCount: z.string().regex(/^\d+$/),
  duplicateInvoiceCount: z.string().regex(/^\d+$/),
  needsAttentionCount: z.string().regex(/^\d+$/),
  grossTotals: z.array(z.object({
    currencyCode: z.string().regex(/^[A-Z]{3}$/),
    grossAmount: z.string(),
  }).strict()).max(100),
}).strict();

export const whatsappInvoiceMonitoringAssetPageSchema = z.object({
  id: uuidSchema,
  assetId: uuidSchema,
  pageNumber: z.number().int().min(1),
  assignedRecordId: uuidSchema.nullable(),
}).strict();

export const whatsappInvoiceMonitoringAssetSchema = z.object({
  id: uuidSchema,
  displayName: z.string(),
  receivedAt: z.string().datetime(),
  mediaKind: z.enum(["IMAGE", "PDF"]),
  invoiceRecordCount: z.number().int().min(0),
  extractionStatus: whatsappInvoiceMonitoringExtractionStateSchema,
  /** Safe lifecycle signal only. Private storage location and cryptographic
   * metadata are intentionally never part of a browser-facing contract. */
  storageState: z.enum(["PENDING", "READY", "QUARANTINED", "FAILED"]),
  scanStatus: z.enum(["NOT_REQUESTED", "PENDING", "CLEAN", "MALICIOUS", "UNAVAILABLE", "FAILED"]),
}).strict();

export const whatsappInvoiceMonitoringSettingsSchema = z.object({
  connection: z.object({
    id: uuidSchema.nullable(),
    status: z.enum(["NOT_CONFIGURED", "DISCONNECTED", "CONNECTED", "GAP_DETECTED", "BLOCKED"]),
    phoneNumberHint: z.string().nullable(),
    lastSyncedAt: z.string().datetime().nullable(),
  }).strict(),
  groupBindings: z.array(z.object({
    id: uuidSchema,
    groupJid: z.string(),
    displayName: z.string(),
    active: z.boolean(),
    bindingRevision: z.number().int().min(1),
  }).strict()).max(500),
}).strict();

/** Personal-pilot transport configuration. The browser never receives an
 * authentication secret, session envelope, or durable QR representation. */
export const configureWhatsappInvoiceConnectionRequestSchema = z.object({
  connectionKey: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{2,79}$/),
  phoneNumberHint: z.string().trim().min(3).max(80).nullable().optional(),
}).strict();

const whatsappInvoiceGroupJidSchema = z.string().trim().regex(/^\d{5,40}(?:-\d{1,40})?@g\.us$/);
const whatsappInvoiceGroupDisplayNameSchema = z.string().trim().min(1).max(240);

export const createWhatsappInvoiceGroupBindingRequestSchema = z.object({
  groupJid: whatsappInvoiceGroupJidSchema,
  displayName: whatsappInvoiceGroupDisplayNameSchema,
  active: z.boolean().default(true),
}).strict();

export const updateWhatsappInvoiceGroupBindingRequestSchema = z.object({
  displayName: whatsappInvoiceGroupDisplayNameSchema.optional(),
  active: z.boolean().optional(),
  expectedBindingRevision: z.number().int().min(1),
}).strict().refine((value) => value.displayName !== undefined || value.active !== undefined, {
  message: "At least one group binding field must be changed.",
});

export const deleteWhatsappInvoiceGroupBindingRequestSchema = z.object({
  expectedBindingRevision: z.number().int().min(1),
}).strict();

export const whatsappInvoiceConnectionControlReceiptSchema = z.object({
  connectionId: uuidSchema,
  status: z.enum(["NOT_CONFIGURED", "DISCONNECTED", "CONNECTED", "GAP_DETECTED", "BLOCKED"]),
}).strict();

/** QR is live process memory only. A null value means that pairing is not
 * currently awaiting a scan; clients must never persist it. */
export const whatsappInvoiceConnectionQrReceiptSchema = z.object({
  qr: z.string().min(1).max(8_000).nullable(),
  expiresAt: z.string().datetime().nullable(),
}).strict();

export const whatsappInvoiceMonitoringDetailSchema = z.object({
  record: whatsappInvoiceMonitoringRecordSchema,
  assets: z.array(whatsappInvoiceMonitoringAssetSchema).max(100),
  revisions: z.array(z.object({
    id: uuidSchema,
    revision: z.number().int().min(1),
    source: z.enum(["INITIAL", "MANUAL_CORRECTION", "AI_REEXTRACTION"]),
    createdAt: z.string().datetime(),
  }).strict()).max(200),
  reviews: z.array(z.object({
    id: uuidSchema,
    reason: z.string(),
    createdAt: z.string().datetime(),
  }).strict()).max(200),
}).strict();

export const whatsappInvoiceMonitoringWorkspaceSchema = z.object({
  asOf: z.string().datetime(),
  connection: z.object({
    status: z.enum(["NOT_CONFIGURED", "DISCONNECTED", "CONNECTED", "GAP_DETECTED", "BLOCKED"]),
    messageAr: z.string(),
    messageEn: z.string(),
    lastSyncedAt: z.string().datetime().nullable(),
  }).strict(),
  summary: whatsappInvoiceMonitoringSummarySchema,
  invoices: z.object({
    rows: z.array(whatsappInvoiceMonitoringRecordSchema.pick({
      id: true,
      supplierName: true,
      invoiceNumber: true,
      invoiceDate: true,
      currencyCode: true,
      netAmount: true,
      vatAmount: true,
      grossAmount: true,
    }).extend({
      approvalStatus: whatsappInvoiceMonitoringApprovalStateSchema,
      duplicateStatus: whatsappInvoiceMonitoringDuplicateStateSchema,
      extractionStatus: whatsappInvoiceMonitoringExtractionStateSchema,
    }).strict()).max(100),
    nextCursor: cursorSchema.nullable(),
  }).strict(),
  assets: z.array(whatsappInvoiceMonitoringAssetSchema).max(100),
  notes: z.array(z.object({
    id: uuidSchema,
    severity: z.enum(["INFO", "WARNING", "DANGER"]),
    titleAr: z.string(),
    titleEn: z.string(),
    detailAr: z.string(),
    detailEn: z.string(),
  }).strict()).max(100),
  archive: z.array(z.object({
    id: uuidSchema,
    supplierName: z.string().nullable(),
    invoiceNumber: z.string().nullable(),
    archivedAt: z.string().datetime(),
  }).strict()).max(100),
  settings: whatsappInvoiceMonitoringSettingsSchema,
  filterOptions: z.object({
    groupBindings: whatsappInvoiceMonitoringSettingsSchema.shape.groupBindings,
    currencies: z.array(z.string().regex(/^[A-Z]{3}$/)).max(100),
    /** Selection-safe master-data projection for this company only. */
    suppliers: z.array(z.object({
      id: uuidSchema,
      nameAr: z.string(),
      nameEn: z.string().nullable(),
      taxNumber: z.string().nullable(),
    }).strict()).max(1_000),
  }).strict(),
}).strict();

export type WhatsappInvoiceMonitoringQuery = z.infer<typeof whatsappInvoiceMonitoringQuerySchema>;
export type UpdateWhatsappInvoiceMonitoringRecordRequest = z.infer<typeof updateWhatsappInvoiceMonitoringRecordRequestSchema>;
export type ConfigureWhatsappInvoiceConnectionRequest = z.infer<typeof configureWhatsappInvoiceConnectionRequestSchema>;
export type CreateWhatsappInvoiceGroupBindingRequest = z.infer<typeof createWhatsappInvoiceGroupBindingRequestSchema>;
export type UpdateWhatsappInvoiceGroupBindingRequest = z.infer<typeof updateWhatsappInvoiceGroupBindingRequestSchema>;
export type DeleteWhatsappInvoiceGroupBindingRequest = z.infer<typeof deleteWhatsappInvoiceGroupBindingRequestSchema>;
