ALTER TYPE "MarketingProviderConnectionStatus"
  ADD VALUE IF NOT EXISTS 'AUTHORIZED_AWAITING_SELECTION';

CREATE TABLE "MarketingGoogleBusinessOAuthState" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "provider" "MarketingProvider" NOT NULL DEFAULT 'GOOGLE_BUSINESS',
  "initiatedByUserId" UUID NOT NULL,
  "stateHash" VARCHAR(64) NOT NULL UNIQUE,
  "verifierEncrypted" TEXT NOT NULL,
  "verifierIv" VARCHAR(64) NOT NULL,
  "verifierTag" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "consumedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingGoogleBusinessOAuthState_provider_check" CHECK ("provider" = 'GOOGLE_BUSINESS'),
  CONSTRAINT "MarketingGoogleBusinessOAuthState_company_fk"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingGoogleBusinessOAuthState_connection_fk"
    FOREIGN KEY ("connectionId", "tenantId", "companyId", "provider")
    REFERENCES "MarketingProviderConnection"("id", "tenantId", "companyId", "provider") ON DELETE RESTRICT,
  CONSTRAINT "MarketingGoogleBusinessOAuthState_membership_fk"
    FOREIGN KEY ("tenantId", "initiatedByUserId", "companyId")
    REFERENCES "CompanyMembership"("tenantId", "userId", "companyId") ON DELETE RESTRICT
);

CREATE INDEX "MarketingGoogleBusinessOAuthState_tenant_company_provider_expires_idx"
  ON "MarketingGoogleBusinessOAuthState" ("tenantId", "companyId", "provider", "expiresAt");
CREATE INDEX "MarketingGoogleBusinessOAuthState_connection_tenant_company_provider_idx"
  ON "MarketingGoogleBusinessOAuthState" ("connectionId", "tenantId", "companyId", "provider");
CREATE UNIQUE INDEX "MarketingGoogleBusinessOAuthState_one_active_attempt_uq"
  ON "MarketingGoogleBusinessOAuthState" ("tenantId", "companyId", "provider")
  WHERE "consumedAt" IS NULL;

ALTER TABLE "MarketingGoogleBusinessOAuthState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingGoogleBusinessOAuthState" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MarketingGoogleBusinessOAuthState_tenant_isolation"
  ON "MarketingGoogleBusinessOAuthState"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseer_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "MarketingGoogleBusinessOAuthState" TO baseer_app;
  END IF;
END $$;
