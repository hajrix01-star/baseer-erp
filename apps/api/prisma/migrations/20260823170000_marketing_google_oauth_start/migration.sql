ALTER TYPE "MarketingProviderConnectionStatus" ADD VALUE IF NOT EXISTS 'AUTHORIZING';

CREATE TABLE "MarketingProviderOAuthState" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "provider" "MarketingProvider" NOT NULL,
  "initiatedByUserId" UUID NOT NULL,
  "stateHash" VARCHAR(64) NOT NULL UNIQUE,
  "verifierEncrypted" TEXT NOT NULL,
  "verifierIv" VARCHAR(64) NOT NULL,
  "verifierTag" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "consumedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MarketingProviderOAuthState_tenant_company_provider_expiry_idx"
  ON "MarketingProviderOAuthState" ("tenantId", "companyId", "provider", "expiresAt");
ALTER TABLE "MarketingProviderOAuthState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingProviderOAuthState" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MarketingProviderOAuthState_tenant_isolation" ON "MarketingProviderOAuthState"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
