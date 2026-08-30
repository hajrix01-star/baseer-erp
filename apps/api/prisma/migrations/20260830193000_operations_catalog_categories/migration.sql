-- Source catalogue classifications are operational metadata.  They must never
-- be repurposed as finance categories or as producing sections.
CREATE TABLE "OperationsCatalogCategory" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "code" varchar(80) NOT NULL,
  "nameAr" varchar(160) NOT NULL,
  "nameEn" varchar(160),
  "isActive" boolean NOT NULL DEFAULT true,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OperationsCatalogCategory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OperationsCatalogCategory_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "OperationsCatalogCategory_company_code_key" UNIQUE ("companyId", "code"),
  CONSTRAINT "OperationsCatalogCategory_company_tenant_fkey"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

ALTER TABLE "OperationsItem" ADD COLUMN "categoryId" uuid;
ALTER TABLE "OperationsItem"
  ADD CONSTRAINT "OperationsItem_category_fkey"
  FOREIGN KEY ("categoryId", "tenantId", "companyId")
  REFERENCES "OperationsCatalogCategory"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "OperationsCatalogCategory_tenant_company_active_sort_idx"
  ON "OperationsCatalogCategory"("tenantId", "companyId", "isActive", "sortOrder");
CREATE INDEX "OperationsItem_tenant_company_category_idx"
  ON "OperationsItem"("tenantId", "companyId", "categoryId");

ALTER TABLE "OperationsCatalogCategory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperationsCatalogCategory" FORCE ROW LEVEL SECURITY;
CREATE POLICY "OperationsCatalogCategory_tenant_isolation" ON "OperationsCatalogCategory"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
