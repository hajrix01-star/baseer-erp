-- BASEER ERP finance master-data foundation.
-- This migration is additive and belongs only to the Baseer database.
-- It creates no financial balances, documents, or imported Noorix data.

CREATE TYPE "FinanceAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');
CREATE TYPE "FinanceAccountStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "FinanceCategoryKind" AS ENUM ('PURCHASE', 'EXPENSE', 'SALE');
CREATE TYPE "FinanceCategoryStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "FinanceSupplierStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "CompanyFinanceProfile" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "baseSeedVersion" INTEGER NOT NULL DEFAULT 1 CHECK ("baseSeedVersion" > 0),
  "accountingMode" VARCHAR(40) NOT NULL DEFAULT 'management_cash',
  "vatAccountingEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "initializedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("companyId"),
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("companyId", "tenantId"),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT
);

CREATE TABLE "FinanceAccount" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160) NOT NULL,
  "type" "FinanceAccountType" NOT NULL,
  "systemKey" VARCHAR(80),
  "isSystem" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" "FinanceAccountStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("companyId", "code"),
  UNIQUE ("companyId", "systemKey"),
  CHECK (length(trim("code")) > 0),
  CHECK (length(trim("nameAr")) > 0),
  CHECK (length(trim("nameEn")) > 0),
  CHECK (("isSystem" = FALSE) OR ("systemKey" IS NOT NULL AND length(trim("systemKey")) > 0)),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT
);

CREATE TABLE "FinanceCategory" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "parentId" UUID,
  "accountId" UUID,
  "code" VARCHAR(80) NOT NULL,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160) NOT NULL,
  "kind" "FinanceCategoryKind" NOT NULL,
  "status" "FinanceCategoryStatus" NOT NULL DEFAULT 'ACTIVE',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("companyId", "code"),
  CHECK (length(trim("code")) > 0),
  CHECK (length(trim("nameAr")) > 0),
  CHECK (length(trim("nameEn")) > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("accountId", "tenantId", "companyId") REFERENCES "FinanceAccount"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("parentId", "tenantId", "companyId") REFERENCES "FinanceCategory"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE TABLE "FinanceSupplier" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "categoryId" UUID,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160),
  "phone" VARCHAR(30),
  "taxNumber" VARCHAR(32),
  "isTaxRegistered" BOOLEAN NOT NULL DEFAULT FALSE,
  "status" "FinanceSupplierStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  CHECK (length(trim("nameAr")) > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("categoryId", "tenantId", "companyId") REFERENCES "FinanceCategory"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE TABLE "SupplierCopyProvenance" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "targetSupplierId" UUID NOT NULL,
  "sourceCompanyId" UUID,
  "sourceSupplierId" UUID,
  "sourceKind" VARCHAR(40) NOT NULL,
  "sourceReference" VARCHAR(160),
  "copiedByUserId" UUID,
  "copiedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("targetSupplierId"),
  UNIQUE ("targetSupplierId", "tenantId", "companyId"),
  CHECK (length(trim("sourceKind")) > 0),
  FOREIGN KEY ("targetSupplierId", "tenantId", "companyId") REFERENCES "FinanceSupplier"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE INDEX "CompanyFinanceProfile_tenant_company_idx" ON "CompanyFinanceProfile"("tenantId", "companyId");
CREATE INDEX "FinanceAccount_tenant_company_status_idx" ON "FinanceAccount"("tenantId", "companyId", "status");
CREATE INDEX "FinanceCategory_tenant_company_status_sort_idx" ON "FinanceCategory"("tenantId", "companyId", "status", "sortOrder");
CREATE INDEX "FinanceCategory_company_parent_idx" ON "FinanceCategory"("companyId", "parentId");
CREATE INDEX "FinanceSupplier_tenant_company_status_idx" ON "FinanceSupplier"("tenantId", "companyId", "status");
CREATE INDEX "FinanceSupplier_company_tax_idx" ON "FinanceSupplier"("companyId", "taxNumber");
CREATE INDEX "SupplierCopyProvenance_tenant_company_source_kind_idx" ON "SupplierCopyProvenance"("tenantId", "companyId", "sourceKind");
CREATE INDEX "SupplierCopyProvenance_tenant_source_supplier_idx" ON "SupplierCopyProvenance"("tenantId", "sourceCompanyId", "sourceSupplierId");

ALTER TABLE "CompanyFinanceProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyFinanceProfile" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FinanceAccount" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceAccount" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FinanceCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceCategory" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FinanceSupplier" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceSupplier" FORCE ROW LEVEL SECURITY;
ALTER TABLE "SupplierCopyProvenance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "SupplierCopyProvenance" FORCE ROW LEVEL SECURITY;

CREATE POLICY "CompanyFinanceProfile_tenant_isolation" ON "CompanyFinanceProfile"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "FinanceAccount_tenant_isolation" ON "FinanceAccount"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "FinanceCategory_tenant_isolation" ON "FinanceCategory"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "FinanceSupplier_tenant_isolation" ON "FinanceSupplier"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "SupplierCopyProvenance_tenant_isolation" ON "SupplierCopyProvenance"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
