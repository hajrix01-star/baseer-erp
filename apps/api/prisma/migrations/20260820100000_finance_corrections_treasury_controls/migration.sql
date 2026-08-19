-- Finance correction controls and non-posting treasury observations.
-- Reversals use the existing immutable journal-reversal machinery; this table
-- deliberately stores only bank/cash control evidence and never a balance.

CREATE TYPE "FinanceVaultReconciliationKind" AS ENUM ('BANK_RECONCILIATION', 'CASH_COUNT');
CREATE TYPE "FinanceVaultReconciliationStatus" AS ENUM ('MATCHED', 'VARIANCE');

CREATE TABLE "FinanceVaultReconciliation" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "vaultId" UUID NOT NULL,
  "kind" "FinanceVaultReconciliationKind" NOT NULL,
  "asOfBusinessDate" DATE NOT NULL,
  "ledgerBalance" DECIMAL(18,4) NOT NULL,
  "observedBalance" DECIMAL(18,4) NOT NULL,
  "differenceAmount" DECIMAL(18,4) NOT NULL,
  "status" "FinanceVaultReconciliationStatus" NOT NULL,
  "referenceNumber" VARCHAR(160),
  "notes" VARCHAR(2000),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceVaultReconciliation_company_vault_kind_date_key" UNIQUE ("companyId", "vaultId", "kind", "asOfBusinessDate"),
  CONSTRAINT "FinanceVaultReconciliation_company_tenant_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceVaultReconciliation_vault_tenant_company_fk" FOREIGN KEY ("vaultId", "tenantId", "companyId") REFERENCES "FinanceVault"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "FinanceVaultReconciliation_id_tenant_company_key" ON "FinanceVaultReconciliation"("id", "tenantId", "companyId");
CREATE INDEX "FinanceVaultReconciliation_tenant_company_vault_date_id_idx" ON "FinanceVaultReconciliation"("tenantId", "companyId", "vaultId", "asOfBusinessDate", "id");
CREATE INDEX "FinanceVaultReconciliation_tenant_company_kind_date_id_idx" ON "FinanceVaultReconciliation"("tenantId", "companyId", "kind", "asOfBusinessDate", "id");

ALTER TABLE "FinanceVaultReconciliation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceVaultReconciliation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinanceVaultReconciliation_tenant_isolation" ON "FinanceVaultReconciliation"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Existing system roles keep their prior privileges plus explicit treasury
-- control rights. Custom roles remain unchanged and must be assigned by an
-- administrator intentionally.
INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode")
SELECT roles."tenantId", roles."id", 'finance.vaults.reconcile'
FROM "Role" AS roles
WHERE roles."code" IN ('BASEER_COMPANY_MANAGER', 'BASEER_FINANCE_ACCOUNTANT')
  AND roles."isSystem" = true
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;
