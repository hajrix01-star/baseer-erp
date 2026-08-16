-- Optional source links added to daily sales only with the same tenant/company
-- composite integrity as every other Finance relationship.

ALTER TABLE "FinanceDailySalesClosing"
  ADD COLUMN "financeCategoryId" UUID,
  ADD COLUMN "financeSupplierId" UUID,
  ADD CONSTRAINT "FinanceDailySalesClosing_financeCategory_fk"
    FOREIGN KEY ("financeCategoryId", "tenantId", "companyId")
    REFERENCES "FinanceCategory"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  ADD CONSTRAINT "FinanceDailySalesClosing_financeSupplier_fk"
    FOREIGN KEY ("financeSupplierId", "tenantId", "companyId")
    REFERENCES "FinanceSupplier"("id", "tenantId", "companyId") ON DELETE RESTRICT;

CREATE INDEX "FinanceDailySalesClosing_tenant_company_category_idx"
  ON "FinanceDailySalesClosing"("tenantId", "companyId", "financeCategoryId");
CREATE INDEX "FinanceDailySalesClosing_tenant_company_supplier_idx"
  ON "FinanceDailySalesClosing"("tenantId", "companyId", "financeSupplierId");