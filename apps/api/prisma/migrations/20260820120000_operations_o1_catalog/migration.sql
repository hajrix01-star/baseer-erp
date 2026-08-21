-- Operations O1: company-scoped catalogue for raw materials, menu products,
-- internal sections, and immutable published unit-conversion versions.
-- It is intentionally independent from finance journals and supplier invoices.

CREATE TYPE "OperationsUnitDimension" AS ENUM ('COUNT', 'MASS', 'VOLUME', 'PACKAGE');
CREATE TYPE "OperationsItemKind" AS ENUM ('RAW_MATERIAL', 'MENU_PRODUCT');
CREATE TYPE "OperationsItemStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "OperationsConversionVersionStatus" AS ENUM ('PUBLISHED', 'SUPERSEDED');

CREATE TABLE "OperationsSection" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160),
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("companyId", "code"),
  CHECK (length(trim("code")) > 0),
  CHECK (length(trim("nameAr")) > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT
);

CREATE TABLE "OperationsUnit" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "code" VARCHAR(40) NOT NULL,
  "nameAr" VARCHAR(80) NOT NULL,
  "nameEn" VARCHAR(80),
  "dimension" "OperationsUnitDimension" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("companyId", "code"),
  CHECK (length(trim("code")) > 0),
  CHECK (length(trim("nameAr")) > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT
);

CREATE TABLE "OperationsItem" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "sectionId" UUID,
  "baseUnitId" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160),
  "kind" "OperationsItemKind" NOT NULL,
  "status" "OperationsItemStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("companyId", "code"),
  CHECK (length(trim("code")) > 0),
  CHECK (length(trim("nameAr")) > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("sectionId", "tenantId", "companyId") REFERENCES "OperationsSection"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("baseUnitId", "tenantId", "companyId") REFERENCES "OperationsUnit"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE TABLE "OperationsItemUnit" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "itemId" UUID NOT NULL,
  "unitId" UUID NOT NULL,
  "isBase" BOOLEAN NOT NULL DEFAULT FALSE,
  "lastPurchaseUnitPrice" DECIMAL(18,4),
  "menuSaleUnitPrice" DECIMAL(18,4),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("itemId", "unitId"),
  CHECK ("lastPurchaseUnitPrice" IS NULL OR "lastPurchaseUnitPrice" > 0),
  CHECK ("menuSaleUnitPrice" IS NULL OR "menuSaleUnitPrice" > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("itemId", "tenantId", "companyId") REFERENCES "OperationsItem"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("unitId", "tenantId", "companyId") REFERENCES "OperationsUnit"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE TABLE "OperationsItemConversionVersion" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "itemId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "OperationsConversionVersionStatus" NOT NULL DEFAULT 'PUBLISHED',
  "publishedBy" UUID NOT NULL,
  "publishedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("itemId", "version"),
  CHECK ("version" > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("itemId", "tenantId", "companyId") REFERENCES "OperationsItem"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("publishedBy", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);

CREATE TABLE "OperationsItemConversionEdge" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "versionId" UUID NOT NULL,
  "fromUnitId" UUID NOT NULL,
  "toUnitId" UUID NOT NULL,
  "factor" DECIMAL(24,8) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("versionId", "fromUnitId"),
  CHECK ("factor" > 0),
  CHECK ("fromUnitId" <> "toUnitId"),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("versionId", "tenantId", "companyId") REFERENCES "OperationsItemConversionVersion"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("fromUnitId", "tenantId", "companyId") REFERENCES "OperationsUnit"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("toUnitId", "tenantId", "companyId") REFERENCES "OperationsUnit"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE INDEX "OperationsSection_tenant_company_active_sort_idx" ON "OperationsSection"("tenantId", "companyId", "isActive", "sortOrder");
CREATE INDEX "OperationsUnit_tenant_company_dimension_active_idx" ON "OperationsUnit"("tenantId", "companyId", "dimension", "isActive");
CREATE INDEX "OperationsItem_tenant_company_kind_status_idx" ON "OperationsItem"("tenantId", "companyId", "kind", "status");
CREATE INDEX "OperationsItem_tenant_company_section_idx" ON "OperationsItem"("tenantId", "companyId", "sectionId");
CREATE INDEX "OperationsItemUnit_tenant_company_item_idx" ON "OperationsItemUnit"("tenantId", "companyId", "itemId");
CREATE INDEX "OperationsItemConversionVersion_tenant_company_item_status_idx" ON "OperationsItemConversionVersion"("tenantId", "companyId", "itemId", "status");
CREATE INDEX "OperationsItemConversionEdge_tenant_company_version_idx" ON "OperationsItemConversionEdge"("tenantId", "companyId", "versionId");

ALTER TABLE "OperationsSection" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsSection" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsUnit" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsUnit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsItem" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsItem" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsItemUnit" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsItemUnit" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsItemConversionVersion" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsItemConversionVersion" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsItemConversionEdge" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsItemConversionEdge" FORCE ROW LEVEL SECURITY;

CREATE POLICY "OperationsSection_tenant_isolation" ON "OperationsSection" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsUnit_tenant_isolation" ON "OperationsUnit" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsItem_tenant_isolation" ON "OperationsItem" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsItemUnit_tenant_isolation" ON "OperationsItemUnit" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsItemConversionVersion_tenant_isolation" ON "OperationsItemConversionVersion" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsItemConversionEdge_tenant_isolation" ON "OperationsItemConversionEdge" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode")
SELECT role."tenantId", role."id", permission.code
FROM "Role" role
CROSS JOIN (VALUES
  ('operations.catalog.read'),
  ('operations.catalog.manage'),
  ('operations.conversions.publish')
) AS permission(code)
WHERE role."code" = 'BASEER_COMPANY_MANAGER'
ON CONFLICT DO NOTHING;
