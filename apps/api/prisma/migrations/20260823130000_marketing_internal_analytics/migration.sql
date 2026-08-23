-- Marketing P2: internal links and read-model support only.
-- It creates no Finance command, provider credential, external egress or journal entry.

ALTER TABLE "MarketingCampaign"
  ADD COLUMN "plannedCost" DECIMAL(18,4),
  ADD COLUMN "plannedCurrencyCode" CHAR(3),
  ADD CONSTRAINT "MarketingCampaign_planned_cost_currency_check"
    CHECK (("plannedCost" IS NULL AND "plannedCurrencyCode" IS NULL)
      OR ("plannedCost" IS NOT NULL AND "plannedCurrencyCode" IS NOT NULL AND "plannedCost" >= 0));

CREATE TABLE "MarketingCampaignFinancialLink" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "financialDocumentId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingCampaignFinancialLink_company_fk"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company" ("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingCampaignFinancialLink_campaign_fk"
    FOREIGN KEY ("campaignId", "tenantId", "companyId") REFERENCES "MarketingCampaign" ("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingCampaignFinancialLink_document_fk"
    FOREIGN KEY ("financialDocumentId", "tenantId", "companyId") REFERENCES "FinanceOutflowDocument" ("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingCampaignFinancialLink_actor_fk"
    FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User" ("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingCampaignFinancialLink_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "MarketingCampaignFinancialLink_document_tenant_company_key" UNIQUE ("financialDocumentId", "tenantId", "companyId")
);
CREATE INDEX "MarketingCampaignFinancialLink_tenant_company_campaign_created_idx"
  ON "MarketingCampaignFinancialLink" ("tenantId", "companyId", "campaignId", "createdAt");

CREATE TABLE "MarketingCampaignContextLink" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "campaignId" UUID NOT NULL,
  "globalContextRevisionId" UUID,
  "companyContextEventId" UUID,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingCampaignContextLink_exactly_one_target_check"
    CHECK (("globalContextRevisionId" IS NOT NULL)::int + ("companyContextEventId" IS NOT NULL)::int = 1),
  CONSTRAINT "MarketingCampaignContextLink_company_fk"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company" ("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingCampaignContextLink_campaign_fk"
    FOREIGN KEY ("campaignId", "tenantId", "companyId") REFERENCES "MarketingCampaign" ("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingCampaignContextLink_global_revision_fk"
    FOREIGN KEY ("globalContextRevisionId", "tenantId") REFERENCES "DecisionGlobalContextEventRevision" ("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingCampaignContextLink_company_event_fk"
    FOREIGN KEY ("companyContextEventId", "tenantId", "companyId") REFERENCES "DecisionCompanyContextEvent" ("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingCampaignContextLink_actor_fk"
    FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User" ("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingCampaignContextLink_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "MarketingCampaignContextLink_campaign_global_revision_key" UNIQUE ("campaignId", "globalContextRevisionId"),
  CONSTRAINT "MarketingCampaignContextLink_campaign_company_event_key" UNIQUE ("campaignId", "companyContextEventId")
);
CREATE INDEX "MarketingCampaignContextLink_tenant_company_campaign_created_idx"
  ON "MarketingCampaignContextLink" ("tenantId", "companyId", "campaignId", "createdAt");

ALTER TABLE "MarketingCampaignFinancialLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingCampaignFinancialLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MarketingCampaignFinancialLink_tenant_isolation" ON "MarketingCampaignFinancialLink"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "MarketingCampaignContextLink" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingCampaignContextLink" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MarketingCampaignContextLink_tenant_isolation" ON "MarketingCampaignContextLink"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
