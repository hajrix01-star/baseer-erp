-- One shared AI provider credential/configuration per BASEER ERP tenant.
-- Company identity and all AI work/output receipts remain company-scoped.

ALTER TABLE "AiExecutionReceipt"
  DROP CONSTRAINT "AiExecutionReceipt_provider_scope_fkey";
ALTER TABLE "AiProviderConfiguration"
  DROP CONSTRAINT "AiProviderConfiguration_company_scope_fkey";
DROP INDEX "AiProviderConfiguration_one_active_default_per_company";
DROP INDEX "AiProviderConfiguration_tenant_company_status_idx";

ALTER TABLE "AiProviderConfiguration"
  DROP COLUMN "companyId";
ALTER TABLE "AiProviderConfiguration"
  ADD CONSTRAINT "AiProviderConfiguration_id_tenant_key" UNIQUE ("id", "tenantId");
ALTER TABLE "AiExecutionReceipt"
  ADD CONSTRAINT "AiExecutionReceipt_provider_tenant_fkey"
  FOREIGN KEY ("providerConfigurationId", "tenantId")
  REFERENCES "AiProviderConfiguration"("id", "tenantId") ON DELETE RESTRICT;

CREATE UNIQUE INDEX "AiProviderConfiguration_one_active_default_per_tenant"
  ON "AiProviderConfiguration"("tenantId")
  WHERE "status" = 'ACTIVE' AND "isDefault" = TRUE;
CREATE INDEX "AiProviderConfiguration_tenant_status_idx"
  ON "AiProviderConfiguration"("tenantId", "status");