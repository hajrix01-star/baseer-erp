-- A category may suggest a supplier for new recurring profiles. It is an
-- optional convenience only; financial documents and profiles keep their own
-- selected supplier snapshots.
ALTER TABLE "FinanceCategory"
  ADD COLUMN "suggestedSupplierId" UUID;

CREATE INDEX "FinanceCategory_tenantId_companyId_suggestedSupplierId_idx"
  ON "FinanceCategory"("tenantId", "companyId", "suggestedSupplierId");

ALTER TABLE "FinanceCategory"
  ADD CONSTRAINT "FinanceCategory_suggestedSupplierId_tenantId_companyId_fkey"
  FOREIGN KEY ("suggestedSupplierId", "tenantId", "companyId")
  REFERENCES "FinanceSupplier"("id", "tenantId", "companyId")
  ON DELETE RESTRICT
  ON UPDATE CASCADE;
