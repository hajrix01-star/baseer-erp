-- Cash reporting reads only posted, journal-backed supplier-due payments.
-- Snapshot columns remain nullable solely for historical rows created before this rule.

ALTER TABLE "FinanceSupplierDuePayment"
  ADD COLUMN "categoryCodeSnapshot" VARCHAR(80),
  ADD COLUMN "categoryNameArSnapshot" VARCHAR(160),
  ADD COLUMN "categoryKindSnapshot" "FinanceCategoryKind";

CREATE INDEX "FinanceSupplierDuePayment_cash_projection_idx"
  ON "FinanceSupplierDuePayment"("tenantId", "companyId", "status", "businessDate", "vaultId");
