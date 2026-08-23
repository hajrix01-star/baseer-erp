-- Marketing & Reputation Gate A1: internal campaign context only.
-- No provider credentials, egress, Google facts, content, workers or finance links.

CREATE TYPE "MarketingCampaignPlatform" AS ENUM ('MANUAL', 'GOOGLE_ADS', 'META', 'TIKTOK', 'SNAPCHAT', 'OTHER');
CREATE TYPE "MarketingCampaignStatus" AS ENUM ('DRAFT', 'PLANNED', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

CREATE TABLE "MarketingCampaign" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "titleAr" VARCHAR(160) NOT NULL,
  "titleEn" VARCHAR(160),
  "platform" "MarketingCampaignPlatform" NOT NULL DEFAULT 'MANUAL',
  "externalReference" VARCHAR(160),
  "startsOn" DATE,
  "endsOn" DATE,
  "status" "MarketingCampaignStatus" NOT NULL DEFAULT 'DRAFT',
  "objective" VARCHAR(500),
  "notes" VARCHAR(2000),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "MarketingCampaign_dates_check" CHECK ("endsOn" IS NULL OR "startsOn" IS NULL OR "endsOn" >= "startsOn"),
  CONSTRAINT "MarketingCampaign_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingCampaign_actor_fk" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingCampaign_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId")
);

CREATE INDEX "MarketingCampaign_tenant_company_status_starts_idx" ON "MarketingCampaign" ("tenantId", "companyId", "status", "startsOn");
CREATE INDEX "MarketingCampaign_tenant_company_platform_created_idx" ON "MarketingCampaign" ("tenantId", "companyId", "platform", "createdAt");

ALTER TABLE "MarketingCampaign" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingCampaign" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MarketingCampaign_tenant_isolation" ON "MarketingCampaign"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
