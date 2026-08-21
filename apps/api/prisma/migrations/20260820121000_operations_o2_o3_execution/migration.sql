-- Operations O2/O3: immutable recipes, operational inventory/WAC, open
-- purchase requests, receipts, and the single purchasing-representative custody ledger.
-- This migration deliberately creates no finance journal, supplier invoice, or general-ledger record.

CREATE TYPE "OperationsRecipeVersionStatus" AS ENUM ('PUBLISHED', 'SUPERSEDED');
CREATE TYPE "OperationsPurchaseExecutionKind" AS ENUM ('LOCAL', 'DELEGATED');
CREATE TYPE "OperationsPurchaseRequestStatus" AS ENUM ('PENDING_RECEIPT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED', 'REVERSED');
CREATE TYPE "OperationsPurchaseReceiptStatus" AS ENUM ('POSTED', 'REVERSED');
CREATE TYPE "OperationsCustodyEventType" AS ENUM ('FUNDING', 'PURCHASE', 'RETURN', 'REVERSAL');
CREATE TYPE "OperationsInventoryMovementType" AS ENUM ('RECEIPT', 'REVERSAL');

ALTER TABLE "OperationsItemUnit"
  ADD COLUMN "isOrderEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "lastPurchasePriceAt" TIMESTAMPTZ(6);

-- Database guards complement the service-level validation and prevent two
-- current bases or two current published conversion versions for one item.
CREATE UNIQUE INDEX "OperationsItemUnit_one_base_per_item"
  ON "OperationsItemUnit"("itemId") WHERE "isBase" = TRUE;
CREATE UNIQUE INDEX "OperationsConversionVersion_one_published_per_item"
  ON "OperationsItemConversionVersion"("itemId") WHERE "status" = 'PUBLISHED';

CREATE TABLE "OperationsRecipeVersion" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "outputItemId" UUID NOT NULL,
  "outputUnitId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "outputQuantity" DECIMAL(24,8) NOT NULL,
  "status" "OperationsRecipeVersionStatus" NOT NULL DEFAULT 'PUBLISHED',
  "publishedBy" UUID NOT NULL,
  "publishedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"), UNIQUE ("outputItemId", "version"),
  CHECK ("version" > 0), CHECK ("outputQuantity" > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("outputItemId", "tenantId", "companyId") REFERENCES "OperationsItem"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("outputUnitId", "tenantId", "companyId") REFERENCES "OperationsUnit"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("publishedBy", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);
CREATE TABLE "OperationsRecipeLine" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
  "recipeVersionId" UUID NOT NULL, "rawMaterialItemId" UUID NOT NULL, "unitId" UUID NOT NULL, "baseUnitId" UUID NOT NULL,
  "conversionVersionId" UUID, "quantity" DECIMAL(24,8) NOT NULL, "resolvedBaseQuantity" DECIMAL(24,8) NOT NULL, "sortOrder" INTEGER NOT NULL DEFAULT 0,
  UNIQUE ("recipeVersionId", "rawMaterialItemId", "unitId"), CHECK ("quantity" > 0), CHECK ("resolvedBaseQuantity" > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("recipeVersionId", "tenantId", "companyId") REFERENCES "OperationsRecipeVersion"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("rawMaterialItemId", "tenantId", "companyId") REFERENCES "OperationsItem"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("unitId", "tenantId", "companyId") REFERENCES "OperationsUnit"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("baseUnitId", "tenantId", "companyId") REFERENCES "OperationsUnit"("id", "tenantId", "companyId") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "OperationsRecipeVersion_one_published_per_output"
  ON "OperationsRecipeVersion"("outputItemId") WHERE "status" = 'PUBLISHED';

CREATE TABLE "OperationsPurchaseRequest" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
  "requestNumber" VARCHAR(80) NOT NULL, "executionKind" "OperationsPurchaseExecutionKind" NOT NULL,
  "status" "OperationsPurchaseRequestStatus" NOT NULL DEFAULT 'PENDING_RECEIPT', "businessDate" DATE NOT NULL,
  "custodyFundingAmount" DECIMAL(18,4), "representativeName" VARCHAR(160), "notes" VARCHAR(1000), "requestedByUserId" UUID NOT NULL,
  "requestedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "receivedAt" TIMESTAMPTZ(6), "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"), UNIQUE ("companyId", "requestNumber"),
  CHECK (("executionKind" = 'LOCAL' AND "custodyFundingAmount" IS NULL AND "representativeName" IS NULL) OR ("executionKind" = 'DELEGATED' AND "custodyFundingAmount" > 0 AND "representativeName" IS NOT NULL)),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("requestedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);
CREATE TABLE "OperationsPurchaseRequestLine" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "requestId" UUID NOT NULL, "lineNumber" INTEGER NOT NULL,
  "rawMaterialItemId" UUID NOT NULL, "requestedUnitId" UUID NOT NULL, "requestedQuantity" DECIMAL(24,8) NOT NULL,
  "baseUnitId" UUID NOT NULL, "conversionVersionId" UUID, "requestedBaseQuantity" DECIMAL(24,8) NOT NULL,
  "quotedUnitPrice" DECIMAL(18,4), "quotedLineTotal" DECIMAL(18,4),
  UNIQUE ("requestId", "lineNumber"), CHECK ("lineNumber" > 0), CHECK ("requestedQuantity" > 0), CHECK ("requestedBaseQuantity" > 0), CHECK ("quotedUnitPrice" IS NULL OR "quotedUnitPrice" > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("requestId", "tenantId", "companyId") REFERENCES "OperationsPurchaseRequest"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("rawMaterialItemId", "tenantId", "companyId") REFERENCES "OperationsItem"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("requestedUnitId", "tenantId", "companyId") REFERENCES "OperationsUnit"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("baseUnitId", "tenantId", "companyId") REFERENCES "OperationsUnit"("id", "tenantId", "companyId") ON DELETE RESTRICT
);
CREATE TABLE "OperationsPurchaseReceipt" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "requestId" UUID NOT NULL,
  "receiptNumber" VARCHAR(80) NOT NULL, "receiptSequence" INTEGER NOT NULL, "businessDate" DATE NOT NULL,
  "status" "OperationsPurchaseReceiptStatus" NOT NULL DEFAULT 'POSTED', "notes" VARCHAR(1000), "receivedByUserId" UUID NOT NULL,
  "receivedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"), UNIQUE ("companyId", "receiptNumber"), UNIQUE ("requestId", "receiptSequence"), CHECK ("receiptSequence" > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("requestId", "tenantId", "companyId") REFERENCES "OperationsPurchaseRequest"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("receivedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);
CREATE TABLE "OperationsPurchaseReceiptLine" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "receiptId" UUID NOT NULL, "requestLineId" UUID,
  "rawMaterialItemId" UUID NOT NULL, "receivedUnitId" UUID NOT NULL, "receivedQuantity" DECIMAL(24,8) NOT NULL, "actualUnitPrice" DECIMAL(18,4) NOT NULL, "lineTotal" DECIMAL(18,4) NOT NULL,
  "baseUnitId" UUID NOT NULL, "baseQuantity" DECIMAL(24,8) NOT NULL, "baseUnitCost" DECIMAL(24,12) NOT NULL,
  CHECK ("receivedQuantity" > 0), CHECK ("actualUnitPrice" > 0), CHECK ("lineTotal" > 0), CHECK ("baseQuantity" > 0), CHECK ("baseUnitCost" > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("receiptId", "tenantId", "companyId") REFERENCES "OperationsPurchaseReceipt"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("requestLineId") REFERENCES "OperationsPurchaseRequestLine"("id") ON DELETE RESTRICT,
  FOREIGN KEY ("rawMaterialItemId", "tenantId", "companyId") REFERENCES "OperationsItem"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("receivedUnitId", "tenantId", "companyId") REFERENCES "OperationsUnit"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("baseUnitId", "tenantId", "companyId") REFERENCES "OperationsUnit"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE TABLE "OperationsCustodyProfile" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "representativeName" VARCHAR(160) NOT NULL, "representativePhone" VARCHAR(32),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"), UNIQUE ("companyId"), UNIQUE ("companyId", "tenantId"),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT
);
CREATE TABLE "OperationsCustodyEvent" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "requestId" UUID, "receiptId" UUID,
  "eventNumber" VARCHAR(80) NOT NULL, "eventType" "OperationsCustodyEventType" NOT NULL, "amountDelta" DECIMAL(18,4) NOT NULL, "balanceAfter" DECIMAL(18,4) NOT NULL,
  "businessDate" DATE NOT NULL, "effectiveAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "notes" VARCHAR(1000), "createdByUserId" UUID NOT NULL,
  UNIQUE ("id", "tenantId", "companyId"), UNIQUE ("companyId", "eventNumber"),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("requestId", "tenantId", "companyId") REFERENCES "OperationsPurchaseRequest"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("receiptId", "tenantId", "companyId") REFERENCES "OperationsPurchaseReceipt"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);
CREATE TABLE "OperationsInventoryBalance" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "rawMaterialItemId" UUID NOT NULL,
  "baseQuantity" DECIMAL(24,8) NOT NULL DEFAULT 0, "totalValue" DECIMAL(18,4) NOT NULL DEFAULT 0, "weightedUnitCost" DECIMAL(24,12) NOT NULL DEFAULT 0, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"), UNIQUE ("companyId", "rawMaterialItemId"), UNIQUE ("rawMaterialItemId", "tenantId", "companyId"),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("rawMaterialItemId", "tenantId", "companyId") REFERENCES "OperationsItem"("id", "tenantId", "companyId") ON DELETE RESTRICT
);
CREATE TABLE "OperationsInventoryMovement" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "rawMaterialItemId" UUID NOT NULL, "receiptId" UUID,
  "movementNumber" VARCHAR(80) NOT NULL, "movementType" "OperationsInventoryMovementType" NOT NULL,
  "baseQuantityDelta" DECIMAL(24,8) NOT NULL, "valueDelta" DECIMAL(18,4) NOT NULL, "quantityAfter" DECIMAL(24,8) NOT NULL, "valueAfter" DECIMAL(18,4) NOT NULL, "weightedUnitCostAfter" DECIMAL(24,12) NOT NULL,
  "businessDate" DATE NOT NULL, "effectiveAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "createdByUserId" UUID NOT NULL,
  UNIQUE ("id", "tenantId", "companyId"), UNIQUE ("companyId", "movementNumber"),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("rawMaterialItemId", "tenantId", "companyId") REFERENCES "OperationsItem"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("receiptId", "tenantId", "companyId") REFERENCES "OperationsPurchaseReceipt"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);

CREATE INDEX "OperationsRecipeVersion_tenant_company_output_status_idx" ON "OperationsRecipeVersion"("tenantId", "companyId", "outputItemId", "status");
CREATE INDEX "OperationsRecipeLine_tenant_company_material_idx" ON "OperationsRecipeLine"("tenantId", "companyId", "rawMaterialItemId");
CREATE INDEX "OperationsPurchaseRequest_tenant_company_status_date_idx" ON "OperationsPurchaseRequest"("tenantId", "companyId", "status", "businessDate");
CREATE INDEX "OperationsPurchaseRequestLine_tenant_company_material_idx" ON "OperationsPurchaseRequestLine"("tenantId", "companyId", "rawMaterialItemId");
CREATE INDEX "OperationsPurchaseReceipt_tenant_company_date_status_idx" ON "OperationsPurchaseReceipt"("tenantId", "companyId", "businessDate", "status");
CREATE INDEX "OperationsPurchaseReceiptLine_tenant_company_material_idx" ON "OperationsPurchaseReceiptLine"("tenantId", "companyId", "rawMaterialItemId");
CREATE INDEX "OperationsCustodyEvent_tenant_company_effective_idx" ON "OperationsCustodyEvent"("tenantId", "companyId", "effectiveAt");
CREATE INDEX "OperationsInventoryBalance_tenant_company_material_idx" ON "OperationsInventoryBalance"("tenantId", "companyId", "rawMaterialItemId");
CREATE INDEX "OperationsInventoryMovement_tenant_company_material_effective_idx" ON "OperationsInventoryMovement"("tenantId", "companyId", "rawMaterialItemId", "effectiveAt");

ALTER TABLE "OperationsRecipeVersion" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsRecipeVersion" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsRecipeLine" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsRecipeLine" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsPurchaseRequest" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsPurchaseRequest" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsPurchaseRequestLine" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsPurchaseRequestLine" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsPurchaseReceipt" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsPurchaseReceipt" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsPurchaseReceiptLine" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsPurchaseReceiptLine" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsCustodyProfile" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsCustodyProfile" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsCustodyEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsCustodyEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsInventoryBalance" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsInventoryBalance" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsInventoryMovement" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsInventoryMovement" FORCE ROW LEVEL SECURITY;

CREATE POLICY "OperationsRecipeVersion_tenant_isolation" ON "OperationsRecipeVersion" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsRecipeLine_tenant_isolation" ON "OperationsRecipeLine" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsPurchaseRequest_tenant_isolation" ON "OperationsPurchaseRequest" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsPurchaseRequestLine_tenant_isolation" ON "OperationsPurchaseRequestLine" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsPurchaseReceipt_tenant_isolation" ON "OperationsPurchaseReceipt" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsPurchaseReceiptLine_tenant_isolation" ON "OperationsPurchaseReceiptLine" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsCustodyProfile_tenant_isolation" ON "OperationsCustodyProfile" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsCustodyEvent_tenant_isolation" ON "OperationsCustodyEvent" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsInventoryBalance_tenant_isolation" ON "OperationsInventoryBalance" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsInventoryMovement_tenant_isolation" ON "OperationsInventoryMovement" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode")
SELECT role."tenantId", role."id", permission.code
FROM "Role" role CROSS JOIN (VALUES
  ('operations.recipe.read'), ('operations.recipe.publish'), ('operations.inventory.read'),
  ('operations.purchase_request.read'), ('operations.purchase_request.create'), ('operations.purchase_request.receive'),
  ('operations.custody.read'), ('operations.custody.return')
) AS permission(code)
WHERE role."code" = 'BASEER_COMPANY_MANAGER'
ON CONFLICT DO NOTHING;
