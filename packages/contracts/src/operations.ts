import { z } from "zod";

import { companyIdSchema } from "./identity.js";
import { idempotencyKeySchema } from "./finance.js";

export const operationsUnitDimensionSchema = z.enum(["COUNT", "MASS", "VOLUME", "PACKAGE"]);
export const operationsItemKindSchema = z.enum(["RAW_MATERIAL", "MENU_PRODUCT"]);
export const operationsItemStatusSchema = z.enum(["ACTIVE", "ARCHIVED"]);
const operationsIdSchema = z.string().uuid();
const quantitySchema = z.string().trim().regex(/^\d{1,16}(?:\.\d{1,8})?$/).refine((value) => Number(value) > 0, "Quantity must be positive.");
const moneySchema = z.string().trim().regex(/^\d{1,14}(?:\.\d{1,4})?$/).refine((value) => Number(value) > 0, "Amount must be positive.");
const nullableAmountSchema = moneySchema.nullable();
const nullableNonNegativeMoneySchema = z.string().trim().regex(/^\d{1,14}(?:\.\d{1,4})?$/).nullable();
const operationsOverviewAmountSchema = z.string().trim().regex(/^\d{1,14}(?:\.\d{1,4})?$/);
const operationsOverviewDateSchema = z.string().date();

export const operationsUnitSchema = z.object({
  id: operationsIdSchema,
  code: z.string().min(1).max(40),
  nameAr: z.string().min(1).max(80),
  nameEn: z.string().max(80).nullable(),
  dimension: operationsUnitDimensionSchema,
  isActive: z.boolean(),
}).strict();

export const operationsSectionSchema = z.object({
  id: operationsIdSchema,
  code: z.string().min(1).max(80),
  nameAr: z.string().min(1).max(160),
  nameEn: z.string().max(160).nullable(),
  isActive: z.boolean(),
}).strict();

export const operationsItemUnitSchema = z.object({
  id: operationsIdSchema,
  unitId: operationsIdSchema,
  isBase: z.boolean(),
  isOrderEnabled: z.boolean(),
  isActive: z.boolean(),
  lastPurchaseUnitPrice: nullableAmountSchema,
  lastPurchasePriceAt: z.string().datetime().nullable(),
  menuSaleUnitPrice: nullableAmountSchema,
}).strict();

export const operationsConversionEdgeSchema = z.object({
  fromUnitId: operationsIdSchema,
  toUnitId: operationsIdSchema,
  factor: quantitySchema,
}).strict();

export const operationsConversionVersionSchema = z.object({
  id: operationsIdSchema,
  version: z.number().int().positive(),
  status: z.enum(["PUBLISHED", "SUPERSEDED"]),
  publishedAt: z.string().datetime(),
  edges: z.array(operationsConversionEdgeSchema).max(100),
}).strict();

export const operationsItemSchema = z.object({
  id: operationsIdSchema,
  code: z.string().min(1).max(80),
  nameAr: z.string().min(1).max(160),
  nameEn: z.string().max(160).nullable(),
  kind: operationsItemKindSchema,
  status: operationsItemStatusSchema,
  sectionId: operationsIdSchema.nullable(),
  baseUnitId: operationsIdSchema,
  itemUnits: z.array(operationsItemUnitSchema).min(1).max(30),
  conversionVersion: operationsConversionVersionSchema.nullable(),
  /** Current theoretical recipe cost per output unit. It is derived from the
   * latest published recipe and current raw-material weighted costs. */
  liveRecipeUnitCost: nullableNonNegativeMoneySchema,
  liveRecipeCostStatus: z.enum(["NO_RECIPE", "INCOMPLETE", "AVAILABLE"]),
}).strict();

export const operationsCatalogQuerySchema = z.object({
  kind: operationsItemKindSchema.optional(),
  status: operationsItemStatusSchema.optional(),
  search: z.string().trim().min(1).max(160).optional(),
  cursor: operationsIdSchema.optional(),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
}).strict();

export const operationsCatalogReceiptSchema = z.object({
  companyId: companyIdSchema,
  sections: z.array(operationsSectionSchema).max(1_000),
  units: z.array(operationsUnitSchema).max(1_000),
  metrics: z.object({
    activeRawMaterialCount: z.number().int().nonnegative(),
    needsConversionCount: z.number().int().nonnegative(),
    missingPurchasePriceCount: z.number().int().nonnegative(),
  }).strict(),
  items: z.array(operationsItemSchema).max(100),
  nextCursor: operationsIdSchema.nullable(),
  asOf: z.string().datetime(),
}).strict();

/** Current-month, server-owned execution read. Sales remain absent where a
 * day is missing or incomplete; the dashboard must never convert that to 0. */
export const operationsOverviewReadSchema = z.object({
  companyId: companyIdSchema,
  businessDate: operationsOverviewDateSchema,
  period: z.object({
    fromBusinessDate: operationsOverviewDateSchema,
    toBusinessDate: operationsOverviewDateSchema,
    timezone: z.literal("Asia/Riyadh"),
  }).strict(),
  sales: z.object({
    grossAmount: operationsOverviewAmountSchema.nullable(),
    closingCount: z.number().int().nonnegative(),
    eligibleDayCount: z.number().int().nonnegative(),
    incompleteDayCount: z.number().int().nonnegative(),
    dataQuality: z.enum(["READY", "INCOMPLETE", "NO_DATA"]),
    days: z.array(z.object({ businessDate: operationsOverviewDateSchema, grossAmount: operationsOverviewAmountSchema.nullable() }).strict()).max(31),
  }).strict(),
  purchases: z.object({
    grossAmount: operationsOverviewAmountSchema,
    documentCount: z.number().int().nonnegative(),
    days: z.array(z.object({ businessDate: operationsOverviewDateSchema, grossAmount: operationsOverviewAmountSchema, documentCount: z.number().int().nonnegative() }).strict()).max(31),
  }).strict(),
}).strict();

export const createOperationsUnitRequestSchema = z.object({
  nameAr: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().max(80).optional(),
  dimension: operationsUnitDimensionSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

/** Installs the standard restaurant unit library for the current company.
 * Existing codes are retained; the operation only creates missing units. */
export const installOperationsRestaurantUnitPresetsRequestSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const createOperationsSectionRequestSchema = z.object({
  code: z.string().trim().min(1).max(80),
  nameAr: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().max(160).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const createOperationsItemRequestSchema = z.object({
  code: z.string().trim().min(1).max(80),
  nameAr: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().max(160).optional(),
  kind: operationsItemKindSchema,
  sectionId: operationsIdSchema.optional(),
  baseUnitId: operationsIdSchema,
  unitPrices: z.array(z.object({
    unitId: operationsIdSchema,
    lastPurchaseUnitPrice: moneySchema.optional(),
    menuSaleUnitPrice: moneySchema.optional(),
  }).strict()).min(1).max(30),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const archiveOperationsItemRequestSchema = z.object({
  itemId: operationsIdSchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const updateOperationsItemUnitPriceRequestSchema = z.object({
  itemId: operationsIdSchema,
  unitId: operationsIdSchema,
  price: moneySchema,
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const updateOperationsUnitRequestSchema = z.object({
  unitId: operationsIdSchema,
  nameAr: z.string().trim().min(1).max(80),
  nameEn: z.string().trim().max(80).optional(),
  isActive: z.boolean(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const updateOperationsSectionRequestSchema = z.object({
  sectionId: operationsIdSchema,
  code: z.string().trim().min(1).max(80),
  nameAr: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().max(160).optional(),
  isActive: z.boolean(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const updateOperationsItemRequestSchema = z.object({
  itemId: operationsIdSchema,
  code: z.string().trim().min(1).max(80),
  nameAr: z.string().trim().min(1).max(160),
  nameEn: z.string().trim().max(160).optional(),
  sectionId: operationsIdSchema.nullable().optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

/**
 * Item-unit links are retained forever for document history. Configuration
 * therefore deactivates a link instead of deleting it; it never changes the
 * item's immutable base unit or dimension.
 */
export const configureOperationsItemUnitsRequestSchema = z.object({
  itemId: operationsIdSchema,
  units: z.array(z.object({
    unitId: operationsIdSchema,
    isActive: z.boolean(),
    isOrderEnabled: z.boolean(),
  }).strict()).min(1).max(30),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const publishOperationsConversionsRequestSchema = z.object({
  itemId: operationsIdSchema,
  edges: z.array(operationsConversionEdgeSchema).min(1).max(100),
  // A finer final unit may become the base only before this material has
  // operational history. The API enforces that safety boundary.
  baseUnitId: operationsIdSchema.optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const operationsEntityReceiptSchema = z.object({
  id: operationsIdSchema,
  replayed: z.boolean(),
}).strict();

const assetWarrantyLineSchema = z.object({
  description: z.string().trim().min(1).max(500),
  serialNumber: z.string().trim().max(160).optional(),
  warrantyEndsAt: z.string().date().optional(),
}).strict();

export const operationsAssetWarrantyWorkspaceSchema = z.object({
  companyId: companyIdSchema,
  queue: z.array(z.object({
    documentId: operationsIdSchema, documentNumber: z.string().min(1).max(80), kind: z.enum(["PURCHASE", "EXPENSE"]), businessDate: z.string().date(), grossAmount: z.string(), supplierNameAr: z.string().max(160).nullable(), supplierNameEn: z.string().max(160).nullable(), supplierInvoiceNumber: z.string().max(160).nullable(), supplierInvoiceDate: z.string().date().nullable(), assetCount: z.number().int().nonnegative(),
  }).strict()).max(1_000),
  assets: z.array(z.object({
    id: operationsIdSchema, sourceDocumentId: operationsIdSchema, nameAr: z.string().min(1).max(160), nameEn: z.string().max(160).nullable(), serialNumber: z.string().max(160).nullable(), location: z.string().max(160).nullable(), supplierNameSnapshot: z.string().max(160).nullable(), invoiceNumberSnapshot: z.string().max(160).nullable(), invoiceDateSnapshot: z.string().date().nullable(), acquisitionAmount: z.string(), warrantyProvider: z.string().max(160).nullable(), warrantyTerms: z.string().max(2_000).nullable(), warrantyStartsAt: z.string().date().nullable(), warrantyEndsAt: z.string().date().nullable(), status: z.enum(["ACTIVE", "ARCHIVED"]), lines: z.array(z.object({ id: operationsIdSchema, description: z.string().min(1).max(500), serialNumber: z.string().max(160).nullable(), warrantyEndsAt: z.string().date().nullable() }).strict()).max(100),
  }).strict()).max(10_000),
}).strict();

export const setOperationsAssetWarrantyFollowUpRequestSchema = z.object({ documentId: operationsIdSchema, enabled: z.boolean(), idempotencyKey: idempotencyKeySchema }).strict();
export const createOperationsAssetWarrantyAssetRequestSchema = z.object({
  sourceDocumentId: operationsIdSchema, nameAr: z.string().trim().min(1).max(160), nameEn: z.string().trim().max(160).optional(), serialNumber: z.string().trim().max(160).optional(), location: z.string().trim().max(160).optional(), warrantyProvider: z.string().trim().max(160).optional(), warrantyTerms: z.string().trim().max(2_000).optional(), warrantyStartsAt: z.string().date().optional(), warrantyEndsAt: z.string().date().optional(), lines: z.array(assetWarrantyLineSchema).max(100).optional(), idempotencyKey: idempotencyKeySchema,
}).strict().refine((value) => !value.warrantyStartsAt || !value.warrantyEndsAt || value.warrantyStartsAt <= value.warrantyEndsAt, { message: "Warranty end must not precede its start.", path: ["warrantyEndsAt"] });
export const archiveOperationsAssetWarrantyAssetRequestSchema = z.object({ assetId: operationsIdSchema, idempotencyKey: idempotencyKeySchema }).strict();

/** Price-free workstation contract. Never add menu prices or recipe cost here. */
export const operationsInternalRegistrationWorkspaceSchema = z.object({
  companyId: companyIdSchema,
  sections: z.array(operationsSectionSchema).max(1_000),
  products: z.array(z.object({ id: operationsIdSchema, sectionId: operationsIdSchema.nullable(), nameAr: z.string().min(1).max(160), nameEn: z.string().max(160).nullable(), units: z.array(z.object({ unitId: operationsIdSchema, nameAr: z.string().min(1).max(80), nameEn: z.string().max(80).nullable() }).strict()).min(1).max(30) }).strict()).max(10_000),
}).strict();

export const createOperationsInternalRegistrationRequestSchema = z.object({
  businessDate: z.string().date(),
  sectionId: operationsIdSchema,
  notes: z.string().trim().max(1_000).optional(),
  lines: z.array(z.object({ menuProductItemId: operationsIdSchema, unitId: operationsIdSchema, quantity: quantitySchema }).strict()).min(1).max(100),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const operationsInternalRegistrationReportQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, "Report start date must not be after end date.");

/** Management-only projection. Do not use this contract in the staff workstation. */
export const operationsInternalRegistrationReportReceiptSchema = z.object({
  pricingVisible: z.literal(true),
  totals: z.object({ registrationCount: z.number().int().nonnegative(), lineCount: z.number().int().nonnegative(), quantity: z.string(), amount: z.string() }).strict(),
  registrations: z.array(z.object({
    id: operationsIdSchema,
    registrationNumber: z.string().min(1).max(80),
    businessDate: z.string().date(),
    sectionNameAr: z.string().min(1).max(160),
    sectionNameEn: z.string().max(160).nullable(),
    notes: z.string().max(1_000).nullable(),
    lines: z.array(z.object({ lineNumber: z.number().int().positive(), productNameAr: z.string().min(1).max(160), productNameEn: z.string().max(160).nullable(), unitNameAr: z.string().min(1).max(80), unitNameEn: z.string().max(80).nullable(), quantity: quantitySchema, menuSaleUnitPrice: nullableAmountSchema, lineTotal: nullableAmountSchema }).strict()).max(100),
  }).strict()).max(10_000),
}).strict();

export type OperationsCatalogReceipt = z.infer<typeof operationsCatalogReceiptSchema>;
export type OperationsCatalogQuery = z.infer<typeof operationsCatalogQuerySchema>;
export type CreateOperationsUnitRequest = z.infer<typeof createOperationsUnitRequestSchema>;
export type CreateOperationsSectionRequest = z.infer<typeof createOperationsSectionRequestSchema>;
export type CreateOperationsItemRequest = z.infer<typeof createOperationsItemRequestSchema>;
export type UpdateOperationsUnitRequest = z.infer<typeof updateOperationsUnitRequestSchema>;
export type UpdateOperationsSectionRequest = z.infer<typeof updateOperationsSectionRequestSchema>;
export type UpdateOperationsItemRequest = z.infer<typeof updateOperationsItemRequestSchema>;
export type ConfigureOperationsItemUnitsRequest = z.infer<typeof configureOperationsItemUnitsRequestSchema>;
export type PublishOperationsConversionsRequest = z.infer<typeof publishOperationsConversionsRequestSchema>;
export type CreateOperationsInternalRegistrationRequest = z.infer<typeof createOperationsInternalRegistrationRequestSchema>;
export type OperationsInternalRegistrationReportQuery = z.infer<typeof operationsInternalRegistrationReportQuerySchema>;

export const publishOperationsRecipeRequestSchema = z.object({
  outputItemId: operationsIdSchema,
  outputUnitId: operationsIdSchema,
  outputQuantity: quantitySchema,
  lines: z.array(z.object({ rawMaterialItemId: operationsIdSchema, unitId: operationsIdSchema, quantity: quantitySchema }).strict()).min(1).max(100),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const previewOperationsRecipeRequestSchema = publishOperationsRecipeRequestSchema.omit({ idempotencyKey: true });

export const operationsRecipePreviewReceiptSchema = z.object({
  estimatedCost: z.string().nullable(),
  costPerOutputUnit: z.string().nullable(),
  missingMaterialIds: z.array(operationsIdSchema).max(100),
  lines: z.array(z.object({ rawMaterialItemId: operationsIdSchema, unitId: operationsIdSchema, quantity: quantitySchema, resolvedBaseQuantity: quantitySchema, weightedUnitCost: z.string().nullable(), estimatedLineCost: z.string().nullable() }).strict()).max(100),
}).strict();

export const createOperationsPurchaseRequestSchema = z.object({
  businessDate: z.string().date(),
  paymentChannel: z.enum(["CUSTODY", "CASH", "BANK_TRANSFER"]),
  custodyFundingAmount: moneySchema.optional(),
  representativeName: z.string().trim().min(1).max(160).optional(),
  notes: z.string().trim().max(1000).optional(),
  // A request is a priced purchasing plan. The received price remains a
  // separate actual value, but a blank plan must never masquerade as a total.
  lines: z.array(z.object({ rawMaterialItemId: operationsIdSchema, requestedUnitId: operationsIdSchema, requestedQuantity: quantitySchema, quotedUnitPrice: moneySchema }).strict()).min(1).max(100),
  idempotencyKey: idempotencyKeySchema,
}).strict().superRefine((value, context) => {
  if (value.paymentChannel === "CUSTODY" && (!value.custodyFundingAmount || !value.representativeName)) context.addIssue({ code: "custom", path: ["custodyFundingAmount"], message: "Custody requests need funding and the representative name." });
  if (value.paymentChannel !== "CUSTODY" && (value.custodyFundingAmount || value.representativeName)) context.addIssue({ code: "custom", path: ["paymentChannel"], message: "Cash and transfer requests cannot carry custody details." });
});

export const receiveOperationsPurchaseRequestSchema = z.object({
  requestId: operationsIdSchema,
  businessDate: z.string().date(),
  notes: z.string().trim().max(1000).optional(),
  paymentReference: z.string().trim().min(1).max(160).optional(),
  // A confirmed purchase may include an emergency material that was not part
  // of the original plan. Linked lines keep their request-line identity;
  // unplanned lines carry their raw-material identity only.
  lines: z.array(z.object({ requestLineId: operationsIdSchema.optional(), rawMaterialItemId: operationsIdSchema, receivedQuantity: quantitySchema, receivedUnitId: operationsIdSchema, actualUnitPrice: moneySchema }).strict()).min(1).max(100),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const cancelOperationsPurchaseRequestSchema = z.object({
  requestId: operationsIdSchema,
  reason: z.string().trim().min(1).max(1000),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const reverseOperationsPurchaseReceiptSchema = z.object({
  receiptId: operationsIdSchema,
  businessDate: z.string().date(),
  /** Owner reopen is a direct correction action. The server records a stable audit reason when none is supplied. */
  reason: z.string().trim().min(1).max(1000).optional(),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const returnOperationsCustodyRequestSchema = z.object({
  requestId: operationsIdSchema.optional(),
  businessDate: z.string().date(),
  amount: moneySchema,
  notes: z.string().trim().min(1).max(1000),
  idempotencyKey: idempotencyKeySchema,
}).strict();

export const operationsRecipeSummarySchema = z.object({
  outputItemId: operationsIdSchema,
  version: z.number().int().positive(),
  outputQuantity: quantitySchema,
  outputUnitId: operationsIdSchema,
  estimatedCost: z.string(),
  lines: z.array(z.object({ rawMaterialItemId: operationsIdSchema, unitId: operationsIdSchema, quantity: quantitySchema, resolvedBaseQuantity: quantitySchema }).strict()),
}).strict();

export const operationsRecipeWorkspaceReceiptSchema = z.object({
  units: z.array(operationsUnitSchema).max(1_000),
  menuProducts: z.array(z.object({ id: operationsIdSchema, nameAr: z.string().min(1).max(160), nameEn: z.string().max(160).nullable(), itemUnits: z.array(z.object({ unitId: operationsIdSchema, isActive: z.boolean() }).strict()).min(1).max(30) }).strict()).max(10_000),
  rawMaterials: z.array(z.object({ id: operationsIdSchema, nameAr: z.string().min(1).max(160), nameEn: z.string().max(160).nullable(), baseUnitId: operationsIdSchema, itemUnits: z.array(z.object({ unitId: operationsIdSchema, isActive: z.boolean() }).strict()).min(1).max(30), conversionVersion: operationsConversionVersionSchema.nullable(), weightedUnitCost: z.string() }).strict()).max(10_000),
  recipes: z.array(operationsRecipeSummarySchema).max(10_000),
}).strict();

export const operationsExecutionWorkspaceReceiptSchema = z.object({
  recipes: z.array(operationsRecipeSummarySchema),
  inventory: z.array(z.object({ rawMaterialItemId: operationsIdSchema, baseQuantity: z.string(), totalValue: z.string(), weightedUnitCost: z.string() }).strict()),
  requests: z.array(z.object({
    id: operationsIdSchema, requestNumber: z.string(), businessDate: z.string().date(), executionKind: z.enum(["LOCAL", "DELEGATED"]), plannedPaymentChannel: z.enum(["CUSTODY", "CASH", "BANK_TRANSFER"]), status: z.enum(["PENDING_RECEIPT", "PARTIALLY_RECEIVED", "RECEIVED", "CANCELLED", "REVERSED"]), custodyFundingAmount: z.string().nullable(), custodyBalance: z.string().nullable(), representativeName: z.string().nullable(), notes: z.string().nullable(), cancellationReason: z.string().nullable(), estimatedTotal: z.string(), actualTotal: z.string(), varianceTotal: z.string(),
    lines: z.array(z.object({ id: operationsIdSchema, rawMaterialItemId: operationsIdSchema, requestedUnitId: operationsIdSchema, requestedQuantity: z.string(), quotedUnitPrice: z.string(), quotedLineTotal: z.string() }).strict()),
    receipts: z.array(z.object({ id: operationsIdSchema, receiptNumber: z.string(), receiptSequence: z.number().int().positive(), businessDate: z.string().date(), actualPaymentChannel: z.enum(["CUSTODY", "CASH", "BANK_TRANSFER"]), paymentReference: z.string().nullable(), status: z.enum(["POSTED", "REVERSED"]), reversalReason: z.string().nullable(), lines: z.array(z.object({ requestLineId: operationsIdSchema.nullable(), rawMaterialItemId: operationsIdSchema, receivedUnitId: operationsIdSchema, receivedQuantity: z.string(), actualUnitPrice: z.string(), lineTotal: z.string() }).strict()) }).strict()),
  }).strict()),
  custody: z.object({ representativeName: z.string().nullable(), balance: z.string(), events: z.array(z.object({ id: operationsIdSchema, requestId: operationsIdSchema.nullable(), receiptId: operationsIdSchema.nullable(), eventNumber: z.string(), eventType: z.enum(["FUNDING", "PURCHASE", "RETURN", "REVERSAL"]), amountDelta: z.string(), balanceAfter: z.string(), businessDate: z.string().date(), notes: z.string().nullable() }).strict()) }).strict(),
}).strict();

export const operationsReportQuerySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  cursor: z.string().min(1).max(80).optional(),
  pageSize: z.coerce.number().int().min(10).max(100).default(50),
}).strict().refine((value) => !value.from || !value.to || value.from <= value.to, "Report start date must not be after end date.");

/** These reports intentionally use posted purchases only; a purchase plan is not a financial fact. */
export const operationsMaterialsReceivedReportReceiptSchema = z.object({
  totals: z.object({ materialCount: z.number().int().nonnegative(), quantity: z.string(), amount: z.string() }).strict(),
  materials: z.array(z.object({ rawMaterialItemId: operationsIdSchema, materialNameAr: z.string().min(1).max(160), materialNameEn: z.string().max(160).nullable(), unitId: operationsIdSchema, unitNameAr: z.string().min(1).max(80), unitNameEn: z.string().max(80).nullable(), quantity: z.string(), amount: z.string(), weightedActualUnitPrice: z.string() }).strict()).max(100),
  nextCursor: z.string().min(1).max(80).nullable(),
  asOf: z.string().datetime(),
}).strict();

export const operationsCustodyMonthlyReportReceiptSchema = z.object({
  representativeName: z.string().max(160).nullable(),
  months: z.array(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), openingBalance: z.string(), funding: z.string(), purchases: z.string(), returns: z.string(), reversals: z.string(), closingBalance: z.string() }).strict()).max(240),
}).strict();

export type PublishOperationsRecipeRequest = z.infer<typeof publishOperationsRecipeRequestSchema>;
export type PreviewOperationsRecipeRequest = z.infer<typeof previewOperationsRecipeRequestSchema>;
export type CreateOperationsPurchaseRequest = z.infer<typeof createOperationsPurchaseRequestSchema>;
export type ReceiveOperationsPurchaseRequest = z.infer<typeof receiveOperationsPurchaseRequestSchema>;
export type CancelOperationsPurchaseRequest = z.infer<typeof cancelOperationsPurchaseRequestSchema>;
export type ReverseOperationsPurchaseReceipt = z.infer<typeof reverseOperationsPurchaseReceiptSchema>;
export type OperationsReportQuery = z.infer<typeof operationsReportQuerySchema>;
