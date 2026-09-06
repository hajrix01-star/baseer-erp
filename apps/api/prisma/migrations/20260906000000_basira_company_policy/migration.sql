-- BASIRA-AUTO: company-scoped, versioned operating policy. Existing manual
-- skill activations remain LEGACY until a company explicitly opts in.
CREATE TYPE "AiCompanyPolicyMode" AS ENUM ('DISABLED', 'ENABLED', 'PAUSED');
CREATE TYPE "AiSkillActivationOrigin" AS ENUM ('LEGACY', 'MANUAL', 'COMPANY_POLICY');
CREATE TYPE "AiCompanySkillOverrideState" AS ENUM ('BLOCKED', 'CLEARED');

CREATE TABLE "AiCompanyPolicy" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "currentVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCompanyPolicy_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiCompanyPolicy_tenant_company_key" UNIQUE ("tenantId", "companyId"),
  CONSTRAINT "AiCompanyPolicy_company_tenant_key" UNIQUE ("companyId", "tenantId"),
  CONSTRAINT "AiCompanyPolicy_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AiCompanyPolicy_current_version_nonnegative" CHECK ("currentVersion" >= 0)
);

CREATE TABLE "AiCompanyPolicyRevision" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "policyId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "mode" "AiCompanyPolicyMode" NOT NULL,
  "monthlyBudgetUsdCents" DECIMAL(18, 0),
  "billingTimeZone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Riyadh',
  "autoEnrollStable" BOOLEAN NOT NULL DEFAULT false,
  "changedByUserId" UUID NOT NULL,
  "changeReason" VARCHAR(500) NOT NULL,
  "policyDigest" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCompanyPolicyRevision_policy_fk" FOREIGN KEY ("policyId", "tenantId", "companyId") REFERENCES "AiCompanyPolicy"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiCompanyPolicyRevision_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiCompanyPolicyRevision_user_fk" FOREIGN KEY ("changedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiCompanyPolicyRevision_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AiCompanyPolicyRevision_policy_version_key" UNIQUE ("policyId", "version"),
  CONSTRAINT "AiCompanyPolicyRevision_timezone" CHECK ("billingTimeZone" = 'Asia/Riyadh'),
  CONSTRAINT "AiCompanyPolicyRevision_budget_lifecycle" CHECK (
    ("mode" = 'ENABLED' AND "monthlyBudgetUsdCents" IS NOT NULL AND "monthlyBudgetUsdCents" > 0)
    OR ("mode" IN ('DISABLED', 'PAUSED') AND "monthlyBudgetUsdCents" IS NULL)
  ),
  CONSTRAINT "AiCompanyPolicyRevision_reason_nonempty" CHECK (length(trim("changeReason")) > 0)
);
CREATE INDEX "AiCompanyPolicyRevision_tenant_company_created_idx" ON "AiCompanyPolicyRevision" ("tenantId", "companyId", "createdAt");

CREATE TABLE "AiCompanyPolicyProviderAllowlist" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "policyRevisionId" UUID NOT NULL,
  "providerConfigurationId" UUID NOT NULL,
  "providerSnapshot" "AiProviderKind" NOT NULL,
  "modelSnapshot" VARCHAR(160) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCompanyPolicyProviderAllowlist_revision_fk" FOREIGN KEY ("policyRevisionId", "tenantId", "companyId") REFERENCES "AiCompanyPolicyRevision"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiCompanyPolicyProviderAllowlist_provider_fk" FOREIGN KEY ("providerConfigurationId", "tenantId") REFERENCES "AiProviderConfiguration"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiCompanyPolicyProviderAllowlist_revision_provider_key" UNIQUE ("policyRevisionId", "providerConfigurationId")
);
CREATE INDEX "AiCompanyPolicyProviderAllowlist_tenant_company_provider_idx" ON "AiCompanyPolicyProviderAllowlist" ("tenantId", "companyId", "providerConfigurationId");

CREATE TABLE "AiCompanyPolicyPilotAllowlist" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "policyRevisionId" UUID NOT NULL,
  "skillKey" VARCHAR(120) NOT NULL,
  "skillVersion" INTEGER NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCompanyPolicyPilotAllowlist_revision_fk" FOREIGN KEY ("policyRevisionId", "tenantId", "companyId") REFERENCES "AiCompanyPolicyRevision"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiCompanyPolicyPilotAllowlist_revision_skill_key" UNIQUE ("policyRevisionId", "skillKey", "skillVersion", "policyVersion")
);
CREATE INDEX "AiCompanyPolicyPilotAllowlist_tenant_company_skill_idx" ON "AiCompanyPolicyPilotAllowlist" ("tenantId", "companyId", "skillKey");

CREATE TABLE "AiCompanySkillOverride" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "skillKey" VARCHAR(120) NOT NULL,
  "state" "AiCompanySkillOverrideState" NOT NULL DEFAULT 'BLOCKED',
  "rowVersion" INTEGER NOT NULL DEFAULT 1,
  "reason" VARCHAR(500) NOT NULL,
  "changedByUserId" UUID NOT NULL,
  "changedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCompanySkillOverride_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiCompanySkillOverride_user_fk" FOREIGN KEY ("changedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiCompanySkillOverride_company_skill_key" UNIQUE ("tenantId", "companyId", "skillKey"),
  CONSTRAINT "AiCompanySkillOverride_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AiCompanySkillOverride_reason_nonempty" CHECK (length(trim("reason")) > 0),
  CONSTRAINT "AiCompanySkillOverride_version_positive" CHECK ("rowVersion" > 0)
);

ALTER TABLE "AiSkillActivation"
  ADD COLUMN "origin" "AiSkillActivationOrigin" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "companyPolicyRevisionId" UUID;
ALTER TABLE "AiSkillActivation"
  ADD CONSTRAINT "AiSkillActivation_policy_revision_fk" FOREIGN KEY ("companyPolicyRevisionId", "tenantId", "companyId") REFERENCES "AiCompanyPolicyRevision"("id", "tenantId", "companyId") ON DELETE RESTRICT;

ALTER TABLE "AiBudgetReservation"
  ADD COLUMN "monthStartAt" TIMESTAMPTZ(6),
  ADD COLUMN "companyPolicyRevisionId" UUID;
ALTER TABLE "AiBudgetReservation"
  ADD CONSTRAINT "AiBudgetReservation_policy_revision_fk" FOREIGN KEY ("companyPolicyRevisionId", "tenantId", "companyId") REFERENCES "AiCompanyPolicyRevision"("id", "tenantId", "companyId") ON DELETE RESTRICT;
CREATE INDEX "AiBudgetReservation_company_month_status_idx" ON "AiBudgetReservation" ("tenantId", "companyId", "monthStartAt", "status");

ALTER TABLE "AiExecutionReceipt"
  ADD COLUMN "companyPolicyRevisionId" UUID,
  ADD COLUMN "billingPeriodStartAt" TIMESTAMPTZ(6);
ALTER TABLE "AiExecutionReceipt"
  ADD CONSTRAINT "AiExecutionReceipt_policy_revision_fk" FOREIGN KEY ("companyPolicyRevisionId", "tenantId", "companyId") REFERENCES "AiCompanyPolicyRevision"("id", "tenantId", "companyId") ON DELETE RESTRICT;

-- Existing explicit suspension becomes a conservative key-wide block. No
-- policy or monthly budget is inferred for an existing company.
INSERT INTO "AiCompanySkillOverride" ("id", "tenantId", "companyId", "skillKey", "state", "reason", "changedByUserId", "changedAt")
SELECT gen_random_uuid(), "tenantId", "companyId", "skillKey", 'BLOCKED', COALESCE(NULLIF("suspensionReason", ''), 'Legacy Basira suspension'), COALESCE("suspendedByUserId", "approvedByUserId"), COALESCE("suspendedAt", CURRENT_TIMESTAMP)
FROM "AiSkillActivation"
WHERE "status" = 'SUSPENDED'
ON CONFLICT ("tenantId", "companyId", "skillKey") DO NOTHING;

ALTER TABLE "AiCompanyPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiCompanyPolicy" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AiCompanyPolicyRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiCompanyPolicyRevision" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AiCompanyPolicyProviderAllowlist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiCompanyPolicyProviderAllowlist" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AiCompanyPolicyPilotAllowlist" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiCompanyPolicyPilotAllowlist" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AiCompanySkillOverride" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiCompanySkillOverride" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AiCompanyPolicy_tenant_isolation" ON "AiCompanyPolicy" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AiCompanyPolicyRevision_tenant_isolation" ON "AiCompanyPolicyRevision" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AiCompanyPolicyProviderAllowlist_tenant_isolation" ON "AiCompanyPolicyProviderAllowlist" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AiCompanyPolicyPilotAllowlist_tenant_isolation" ON "AiCompanyPolicyPilotAllowlist" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AiCompanySkillOverride_tenant_isolation" ON "AiCompanySkillOverride" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION "baseer_prevent_ai_company_policy_revision_mutation"() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'AiCompanyPolicyRevision rows are append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiCompanyPolicyRevision_append_only" BEFORE UPDATE OR DELETE ON "AiCompanyPolicyRevision" FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_ai_company_policy_revision_mutation"();

CREATE OR REPLACE FUNCTION "baseer_prevent_ai_company_policy_allowlist_mutation"() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'AiCompanyPolicy allowlists are append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiCompanyPolicyProviderAllowlist_append_only" BEFORE UPDATE OR DELETE ON "AiCompanyPolicyProviderAllowlist" FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_ai_company_policy_allowlist_mutation"();
CREATE TRIGGER "AiCompanyPolicyPilotAllowlist_append_only" BEFORE UPDATE OR DELETE ON "AiCompanyPolicyPilotAllowlist" FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_ai_company_policy_allowlist_mutation"();
