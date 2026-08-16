-- Align the installment-plan vault relation with the Prisma model and preserve
-- tenant/company isolation for a clean migration from an empty database.

ALTER TABLE "FinanceInclusiveLoanInstallmentPlan"
  ADD COLUMN "financeVaultId" UUID;

ALTER TABLE "FinanceInclusiveLoanInstallmentPlan"
  ADD CONSTRAINT "FinanceInclusiveLoanInstallmentPlan_financeVaultId_tenantId_companyId_fkey"
    FOREIGN KEY ("financeVaultId", "tenantId", "companyId")
    REFERENCES "FinanceVault"("id", "tenantId", "companyId") ON DELETE RESTRICT;

CREATE INDEX "FinanceInclusiveLoanInstallmentPlan_tenant_company_vault_idx"
  ON "FinanceInclusiveLoanInstallmentPlan"("tenantId", "companyId", "financeVaultId");
