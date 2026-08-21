-- Assets & Warranty Gate A: operational register only. No finance journal,
-- capitalisation, depreciation, or automatic accounting classification.

CREATE TYPE "OperationsAssetWarrantyStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

ALTER TABLE "FinanceOutflowDocument"
  ADD COLUMN "assetWarrantyFollowUp" BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE "OperationsAssetWarrantyAsset" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "sourceDocumentId" UUID NOT NULL,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160),
  "serialNumber" VARCHAR(160),
  "location" VARCHAR(160),
  "supplierNameSnapshot" VARCHAR(160),
  "invoiceNumberSnapshot" VARCHAR(160),
  "invoiceDateSnapshot" DATE,
  "acquisitionAmount" DECIMAL(18,4) NOT NULL,
  "warrantyProvider" VARCHAR(160),
  "warrantyTerms" VARCHAR(2000),
  "warrantyStartsAt" DATE,
  "warrantyEndsAt" DATE,
  "status" "OperationsAssetWarrantyStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  CHECK ("acquisitionAmount" > 0),
  CHECK ("warrantyEndsAt" IS NULL OR "warrantyStartsAt" IS NULL OR "warrantyEndsAt" >= "warrantyStartsAt"),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("sourceDocumentId", "tenantId", "companyId") REFERENCES "FinanceOutflowDocument"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE TABLE "OperationsAssetWarrantyLine" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "assetId" UUID NOT NULL,
  "description" VARCHAR(500) NOT NULL,
  "serialNumber" VARCHAR(160),
  "warrantyEndsAt" DATE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("assetId", "tenantId", "companyId") REFERENCES "OperationsAssetWarrantyAsset"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE INDEX "OperationsAssetWarrantyAsset_tenant_company_status_end_idx" ON "OperationsAssetWarrantyAsset"("tenantId", "companyId", "status", "warrantyEndsAt");
CREATE INDEX "OperationsAssetWarrantyAsset_tenant_company_source_idx" ON "OperationsAssetWarrantyAsset"("tenantId", "companyId", "sourceDocumentId");
CREATE INDEX "OperationsAssetWarrantyLine_tenant_company_asset_idx" ON "OperationsAssetWarrantyLine"("tenantId", "companyId", "assetId");
CREATE INDEX "FinanceOutflowDocument_tenant_company_asset_followup_idx" ON "FinanceOutflowDocument"("tenantId", "companyId", "assetWarrantyFollowUp", "businessDate", "id");

ALTER TABLE "OperationsAssetWarrantyAsset" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperationsAssetWarrantyAsset" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsAssetWarrantyLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperationsAssetWarrantyLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "OperationsAssetWarrantyAsset_tenant_isolation" ON "OperationsAssetWarrantyAsset" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsAssetWarrantyLine_tenant_isolation" ON "OperationsAssetWarrantyLine" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode")
SELECT role."tenantId", role."id", permission.code
FROM "Role" role
CROSS JOIN (VALUES ('operations.assets.read'), ('operations.assets.manage')) AS permission(code)
WHERE role."code" = 'BASEER_COMPANY_MANAGER'
ON CONFLICT DO NOTHING;
