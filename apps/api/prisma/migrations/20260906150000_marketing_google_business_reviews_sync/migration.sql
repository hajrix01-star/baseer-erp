ALTER TYPE "MarketingProviderSyncRunStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

ALTER TABLE "MarketingProviderSyncRun"
  ADD COLUMN "providerAverageRating" DECIMAL(2, 1),
  ADD COLUMN "providerTotalReviewCount" INTEGER;

CREATE TABLE "MarketingGoogleBusinessReviewFact" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "locationMappingId" UUID NOT NULL,
  "provider" "MarketingProvider" NOT NULL DEFAULT 'GOOGLE_BUSINESS',
  "providerReviewResourceName" VARCHAR(512) NOT NULL,
  "rating" INTEGER NOT NULL CHECK ("rating" BETWEEN 1 AND 5),
  "reviewerDisplayName" VARCHAR(256),
  "reviewComment" TEXT,
  "reviewCreatedAt" TIMESTAMPTZ(6) NOT NULL,
  "reviewUpdatedAt" TIMESTAMPTZ(6) NOT NULL,
  "replyComment" TEXT,
  "replyUpdatedAt" TIMESTAMPTZ(6),
  "fetchedAt" TIMESTAMPTZ(6) NOT NULL,
  "contentHash" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingGoogleBusinessReviewFact_provider_check" CHECK ("provider" = 'GOOGLE_BUSINESS'),
  CONSTRAINT "MarketingGoogleBusinessReviewFact_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingGoogleBusinessReviewFact_mapping_fk" FOREIGN KEY ("locationMappingId", "tenantId", "companyId", "provider") REFERENCES "MarketingGoogleBusinessLocationMapping"("id", "tenantId", "companyId", "provider") ON DELETE RESTRICT,
  CONSTRAINT "MarketingGoogleBusinessReviewFact_identity_key" UNIQUE ("tenantId", "companyId", "locationMappingId", "providerReviewResourceName")
);
CREATE INDEX "MarketingGoogleBusinessReviewFact_company_mapping_updated_idx" ON "MarketingGoogleBusinessReviewFact" ("tenantId", "companyId", "locationMappingId", "reviewUpdatedAt");
CREATE INDEX "MarketingGoogleBusinessReviewFact_company_fetched_idx" ON "MarketingGoogleBusinessReviewFact" ("tenantId", "companyId", "fetchedAt");
CREATE UNIQUE INDEX "MarketingProviderSyncRun_one_running_per_provider" ON "MarketingProviderSyncRun" ("tenantId", "companyId", "provider") WHERE "status" = 'RUNNING';

ALTER TABLE "MarketingGoogleBusinessReviewFact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingGoogleBusinessReviewFact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MarketingGoogleBusinessReviewFact_tenant_isolation" ON "MarketingGoogleBusinessReviewFact"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseer_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "MarketingGoogleBusinessReviewFact" TO baseer_app;
  END IF;
END $$;
