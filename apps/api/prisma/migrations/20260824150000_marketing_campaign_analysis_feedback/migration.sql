CREATE TABLE "MarketingCampaignAnalysisFeedback" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "evidenceSnapshotId" UUID NOT NULL,
  "kind" VARCHAR(80) NOT NULL,
  "note" VARCHAR(1000),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingCampaignAnalysisFeedback_company_fk"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingCampaignAnalysisFeedback_campaign_fk"
    FOREIGN KEY ("campaignId", "tenantId", "companyId") REFERENCES "MarketingCampaign"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingCampaignAnalysisFeedback_id_tenant_company_key"
    UNIQUE ("id", "tenantId", "companyId")
);

CREATE INDEX "MarketingCampaignAnalysisFeedback_tenant_company_campaign_created_idx"
  ON "MarketingCampaignAnalysisFeedback" ("tenantId", "companyId", "campaignId", "createdAt");
CREATE INDEX "MarketingCampaignAnalysisFeedback_tenant_company_snapshot_created_idx"
  ON "MarketingCampaignAnalysisFeedback" ("tenantId", "companyId", "evidenceSnapshotId", "createdAt");

ALTER TABLE "MarketingCampaignAnalysisFeedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingCampaignAnalysisFeedback" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MarketingCampaignAnalysisFeedback_tenant_isolation" ON "MarketingCampaignAnalysisFeedback"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
