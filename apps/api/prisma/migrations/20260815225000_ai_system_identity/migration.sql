-- Central BASEER assistant identity: one active name/persona per tenant.

CREATE TABLE "AiSystemIdentity" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "AiCompanyIdentityStatus" NOT NULL DEFAULT 'ACTIVE',
  "assistantNameAr" VARCHAR(80) NOT NULL,
  "assistantNameEn" VARCHAR(80) NOT NULL,
  "defaultLanguage" VARCHAR(2) NOT NULL DEFAULT 'ar',
  "toneInstructions" VARCHAR(2000) NOT NULL,
  "safetyInstructions" VARCHAR(4000) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiSystemIdentity_version_positive" CHECK ("version" > 0),
  CONSTRAINT "AiSystemIdentity_language_valid" CHECK ("defaultLanguage" IN ('ar', 'en')),
  CONSTRAINT "AiSystemIdentity_text_nonempty" CHECK (
    length(trim("assistantNameAr")) > 0 AND length(trim("assistantNameEn")) > 0
    AND length(trim("toneInstructions")) > 0 AND length(trim("safetyInstructions")) > 0
  ),
  UNIQUE ("id", "tenantId"),
  UNIQUE ("tenantId", "version")
);
CREATE UNIQUE INDEX "AiSystemIdentity_one_active_per_tenant"
  ON "AiSystemIdentity"("tenantId") WHERE "status" = 'ACTIVE';
CREATE INDEX "AiSystemIdentity_tenant_status_idx"
  ON "AiSystemIdentity"("tenantId", "status");
ALTER TABLE "AiSystemIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiSystemIdentity" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AiSystemIdentity_tenant_isolation" ON "AiSystemIdentity"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);