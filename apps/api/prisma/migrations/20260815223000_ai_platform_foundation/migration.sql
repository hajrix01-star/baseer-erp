-- BASEER ERP centralized AI platform foundation.
-- No provider network call, credential value or automated external action is introduced here.

CREATE TYPE "AiProviderKind" AS ENUM ('OPENAI_COMPATIBLE', 'ANTHROPIC', 'GOOGLE_GENERATIVE_AI');
CREATE TYPE "AiProviderConfigurationStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "AiCompanyIdentityStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "AiExecutionOutcome" AS ENUM ('SUCCEEDED', 'FAILED', 'BLOCKED');

CREATE TABLE "AiProviderConfiguration" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "provider" "AiProviderKind" NOT NULL,
  "model" VARCHAR(160) NOT NULL,
  "status" "AiProviderConfigurationStatus" NOT NULL DEFAULT 'DISABLED',
  "isDefault" BOOLEAN NOT NULL DEFAULT FALSE,
  "dailyRequestLimit" INTEGER NOT NULL DEFAULT 100,
  "dailyCostLimit" DECIMAL(18,4),
  "encryptedCredential" TEXT NOT NULL,
  "credentialIv" VARCHAR(64) NOT NULL,
  "credentialTag" VARCHAR(64) NOT NULL,
  "credentialKeyVersion" INTEGER NOT NULL DEFAULT 1,
  "configurationVersion" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiProviderConfiguration_company_scope_fkey"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiProviderConfiguration_model_nonempty" CHECK (length(trim("model")) > 0),
  CONSTRAINT "AiProviderConfiguration_limit_positive" CHECK ("dailyRequestLimit" > 0),
  CONSTRAINT "AiProviderConfiguration_cost_nonnegative" CHECK ("dailyCostLimit" IS NULL OR "dailyCostLimit" >= 0),
  CONSTRAINT "AiProviderConfiguration_envelope_nonempty" CHECK (
    length("encryptedCredential") > 0 AND length("credentialIv") > 0 AND length("credentialTag") > 0
  ),
  CONSTRAINT "AiProviderConfiguration_version_positive" CHECK ("credentialKeyVersion" > 0 AND "configurationVersion" > 0),
  UNIQUE ("id", "tenantId", "companyId")
);

CREATE TABLE "AiCompanyIdentity" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "AiCompanyIdentityStatus" NOT NULL DEFAULT 'ACTIVE',
  "displayNameAr" VARCHAR(160) NOT NULL,
  "displayNameEn" VARCHAR(160) NOT NULL,
  "defaultLanguage" VARCHAR(2) NOT NULL DEFAULT 'ar',
  "toneInstructions" VARCHAR(2000) NOT NULL,
  "safetyInstructions" VARCHAR(4000) NOT NULL,
  "policyReference" VARCHAR(160),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCompanyIdentity_company_scope_fkey"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiCompanyIdentity_version_positive" CHECK ("version" > 0),
  CONSTRAINT "AiCompanyIdentity_language_valid" CHECK ("defaultLanguage" IN ('ar', 'en')),
  CONSTRAINT "AiCompanyIdentity_text_nonempty" CHECK (
    length(trim("displayNameAr")) > 0 AND length(trim("displayNameEn")) > 0
    AND length(trim("toneInstructions")) > 0 AND length(trim("safetyInstructions")) > 0
  ),
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("companyId", "version")
);

CREATE TABLE "AiExecutionReceipt" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "providerConfigurationId" UUID,
  "identityId" UUID,
  "moduleKey" VARCHAR(80) NOT NULL,
  "capability" VARCHAR(120) NOT NULL,
  "outcome" "AiExecutionOutcome" NOT NULL,
  "providerSnapshot" "AiProviderKind",
  "modelSnapshot" VARCHAR(160),
  "configurationVersion" INTEGER,
  "identityVersion" INTEGER,
  "inputCharacters" INTEGER NOT NULL DEFAULT 0,
  "outputCharacters" INTEGER NOT NULL DEFAULT 0,
  "safeErrorCode" VARCHAR(120),
  "requestId" VARCHAR(120) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiExecutionReceipt_company_scope_fkey"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiExecutionReceipt_provider_scope_fkey"
    FOREIGN KEY ("providerConfigurationId", "tenantId", "companyId") REFERENCES "AiProviderConfiguration"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiExecutionReceipt_identity_scope_fkey"
    FOREIGN KEY ("identityId", "tenantId", "companyId") REFERENCES "AiCompanyIdentity"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiExecutionReceipt_text_nonempty" CHECK (length(trim("moduleKey")) > 0 AND length(trim("capability")) > 0 AND length(trim("requestId")) > 0),
  CONSTRAINT "AiExecutionReceipt_character_counts_nonnegative" CHECK ("inputCharacters" >= 0 AND "outputCharacters" >= 0),
  CONSTRAINT "AiExecutionReceipt_versions_positive" CHECK (("configurationVersion" IS NULL OR "configurationVersion" > 0) AND ("identityVersion" IS NULL OR "identityVersion" > 0)),
  UNIQUE ("id", "tenantId", "companyId")
);

CREATE UNIQUE INDEX "AiProviderConfiguration_one_active_default_per_company"
  ON "AiProviderConfiguration"("companyId")
  WHERE "status" = 'ACTIVE' AND "isDefault" = TRUE;
CREATE UNIQUE INDEX "AiCompanyIdentity_one_active_per_company"
  ON "AiCompanyIdentity"("companyId")
  WHERE "status" = 'ACTIVE';
CREATE INDEX "AiProviderConfiguration_tenant_company_status_idx"
  ON "AiProviderConfiguration"("tenantId", "companyId", "status");
CREATE INDEX "AiCompanyIdentity_tenant_company_status_idx"
  ON "AiCompanyIdentity"("tenantId", "companyId", "status");
CREATE INDEX "AiExecutionReceipt_tenant_company_created_idx"
  ON "AiExecutionReceipt"("tenantId", "companyId", "createdAt");
CREATE INDEX "AiExecutionReceipt_tenant_company_module_capability_created_idx"
  ON "AiExecutionReceipt"("tenantId", "companyId", "moduleKey", "capability", "createdAt");

ALTER TABLE "AiProviderConfiguration" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiProviderConfiguration" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AiCompanyIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiCompanyIdentity" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AiExecutionReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiExecutionReceipt" FORCE ROW LEVEL SECURITY;

CREATE POLICY "AiProviderConfiguration_tenant_isolation" ON "AiProviderConfiguration"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AiCompanyIdentity_tenant_isolation" ON "AiCompanyIdentity"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AiExecutionReceipt_tenant_isolation" ON "AiExecutionReceipt"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);