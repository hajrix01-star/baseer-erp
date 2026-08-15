-- BASEER ERP supplier dues and partial payments. Baseer-only, additive.
CREATE TYPE "FinanceSupplierDueStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');
CREATE TYPE "FinanceSupplierDuePaymentStatus" AS ENUM ('POSTED', 'REVERSED');
CREATE TABLE "FinanceSupplierDue" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "supplierId" UUID NOT NULL, "categoryId" UUID, "sourceDocumentNumber" VARCHAR(160) NOT NULL, "originalBusinessDate" DATE NOT NULL, "dueDate" DATE, "originalAmount" DECIMAL(18,4) NOT NULL, "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0, "remainingAmount" DECIMAL(18,4) NOT NULL, "status" "FinanceSupplierDueStatus" NOT NULL DEFAULT 'OPEN', "notes" VARCHAR(2000), "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id","tenantId","companyId"), UNIQUE ("companyId","supplierId","sourceDocumentNumber"), CHECK ("originalAmount" > 0 AND "paidAmount" >= 0 AND "remainingAmount" >= 0 AND "paidAmount" + "remainingAmount" = "originalAmount"),
  FOREIGN KEY ("companyId","tenantId") REFERENCES "Company"("id","tenantId") ON DELETE RESTRICT, FOREIGN KEY ("supplierId","tenantId","companyId") REFERENCES "FinanceSupplier"("id","tenantId","companyId") ON DELETE RESTRICT, FOREIGN KEY ("categoryId","tenantId","companyId") REFERENCES "FinanceCategory"("id","tenantId","companyId") ON DELETE RESTRICT
);
CREATE TABLE "FinanceSupplierDuePayment" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "dueId" UUID NOT NULL, "vaultId" UUID NOT NULL, "amount" DECIMAL(18,4) NOT NULL, "businessDate" DATE NOT NULL, "status" "FinanceSupplierDuePaymentStatus" NOT NULL DEFAULT 'POSTED', "reversalOfId" UUID UNIQUE, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id","tenantId","companyId"), CHECK ("amount" > 0), FOREIGN KEY ("companyId","tenantId") REFERENCES "Company"("id","tenantId") ON DELETE RESTRICT, FOREIGN KEY ("dueId","tenantId","companyId") REFERENCES "FinanceSupplierDue"("id","tenantId","companyId") ON DELETE RESTRICT, FOREIGN KEY ("vaultId","tenantId","companyId") REFERENCES "FinanceVault"("id","tenantId","companyId") ON DELETE RESTRICT
);
CREATE INDEX "FinanceSupplierDue_tenant_company_status_date_idx" ON "FinanceSupplierDue"("tenantId","companyId","status","originalBusinessDate");
CREATE INDEX "FinanceSupplierDuePayment_tenant_company_due_date_idx" ON "FinanceSupplierDuePayment"("tenantId","companyId","dueId","businessDate");
ALTER TABLE "FinanceSupplierDue" ENABLE ROW LEVEL SECURITY; ALTER TABLE "FinanceSupplierDue" FORCE ROW LEVEL SECURITY; ALTER TABLE "FinanceSupplierDuePayment" ENABLE ROW LEVEL SECURITY; ALTER TABLE "FinanceSupplierDuePayment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinanceSupplierDue_tenant_isolation" ON "FinanceSupplierDue" USING ("tenantId" = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY "FinanceSupplierDuePayment_tenant_isolation" ON "FinanceSupplierDuePayment" USING ("tenantId" = NULLIF(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id',true),'')::uuid);
