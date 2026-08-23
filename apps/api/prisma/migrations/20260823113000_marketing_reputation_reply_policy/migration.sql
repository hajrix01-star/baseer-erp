-- Marketing reputation reply policy: company-owned configuration only.
-- This migration does not add provider credentials, review content, jobs or egress.

CREATE TYPE "MarketingReputationReplyAutomationStatus" AS ENUM ('DISABLED', 'ENABLED', 'PAUSED');
CREATE TYPE "MarketingReputationReplyAuthoringMethod" AS ENUM ('TEMPLATE', 'BASIRA_DRAFT');
CREATE TYPE "MarketingReputationReplyTone" AS ENUM ('WARM', 'PROFESSIONAL', 'FORMAL');
CREATE TYPE "MarketingReputationReplyLanguageMode" AS ENUM ('MATCH_REVIEW', 'ARABIC', 'ENGLISH');

CREATE TABLE "MarketingReputationReplyPolicy" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "automationStatus" "MarketingReputationReplyAutomationStatus" NOT NULL DEFAULT 'DISABLED',
  "authoringMethod" "MarketingReputationReplyAuthoringMethod" NOT NULL DEFAULT 'TEMPLATE',
  "tone" "MarketingReputationReplyTone" NOT NULL DEFAULT 'WARM',
  "languageMode" "MarketingReputationReplyLanguageMode" NOT NULL DEFAULT 'MATCH_REVIEW',
  "autoFourFiveEnabled" BOOLEAN NOT NULL DEFAULT TRUE,
  "autoThreeIfSafe" BOOLEAN NOT NULL DEFAULT TRUE,
  "signature" VARCHAR(160),
  "revision" INTEGER NOT NULL DEFAULT 1,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "MarketingReputationReplyPolicy_revision_check" CHECK ("revision" >= 1),
  CONSTRAINT "MarketingReputationReplyPolicy_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingReputationReplyPolicy_updated_by_fk" FOREIGN KEY ("updatedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingReputationReplyPolicy_company_tenant_key" UNIQUE ("companyId", "tenantId"),
  CONSTRAINT "MarketingReputationReplyPolicy_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId")
);

CREATE INDEX "MarketingReputationReplyPolicy_tenant_company_status_idx" ON "MarketingReputationReplyPolicy" ("tenantId", "companyId", "automationStatus");

ALTER TABLE "MarketingReputationReplyPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingReputationReplyPolicy" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MarketingReputationReplyPolicy_tenant_isolation" ON "MarketingReputationReplyPolicy"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
