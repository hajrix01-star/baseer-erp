-- Preserve the exact method used for every paid allocation. Existing rows are
-- backfilled from their vault's legacy default before the column becomes required.
ALTER TABLE "FinanceOutflowAllocation"
  ADD COLUMN IF NOT EXISTS "paymentMethod" "FinanceVaultPaymentMethod";

UPDATE "FinanceOutflowAllocation" AS allocation
SET "paymentMethod" = vault."paymentMethod"
FROM "FinanceVault" AS vault
WHERE vault."id" = allocation."vaultId"
  AND vault."tenantId" = allocation."tenantId"
  AND vault."companyId" = allocation."companyId";

ALTER TABLE "FinanceOutflowAllocation"
  ALTER COLUMN "paymentMethod" SET NOT NULL;

ALTER TABLE "FinanceOutflowAllocation"
  DROP CONSTRAINT IF EXISTS "FinanceOutflowAllocation_documentId_vaultId_key";

-- Early development databases used a shorter generated constraint name. Both
-- baselines must converge before the payment-method-aware unique key exists.
ALTER TABLE "FinanceOutflowAllocation"
  DROP CONSTRAINT IF EXISTS "FinanceOutflowAllocation_document_vault_key";

CREATE UNIQUE INDEX IF NOT EXISTS "FinanceOutflowAllocation_documentId_vaultId_paymentMethod_key"
  ON "FinanceOutflowAllocation"("documentId", "vaultId", "paymentMethod");
