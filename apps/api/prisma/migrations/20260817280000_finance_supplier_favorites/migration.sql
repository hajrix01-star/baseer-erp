ALTER TABLE "FinanceSupplier"
  ADD COLUMN "isFavorite" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "FinanceSupplier_tenantId_companyId_isFavorite_status_idx"
  ON "FinanceSupplier"("tenantId", "companyId", "isFavorite", "status");
