-- Marketing P3a: a company-scoped self-service connection control centre.
-- This migration intentionally contains no OAuth credential, provider account,
-- location, callback, worker, outbox, HTTP client, or external data table.

CREATE TYPE "MarketingProvider" AS ENUM ('GOOGLE_ADS', 'GOOGLE_BUSINESS');
CREATE TYPE "MarketingProviderConnectionStatus" AS ENUM ('NOT_CONNECTED', 'SETUP_REQUESTED', 'BLOCKED');

CREATE TABLE "MarketingProviderConnection" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "provider" "MarketingProvider" NOT NULL,
  "status" "MarketingProviderConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
  "setupRequestedAt" TIMESTAMPTZ(6),
  "setupRequestedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingProviderConnection_company_fk"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company" ("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingProviderConnection_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "MarketingProviderConnection_tenant_company_provider_key" UNIQUE ("tenantId", "companyId", "provider")
);
CREATE INDEX "MarketingProviderConnection_tenant_company_status_idx"
  ON "MarketingProviderConnection" ("tenantId", "companyId", "status");

ALTER TABLE "MarketingProviderConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingProviderConnection" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MarketingProviderConnection_tenant_isolation" ON "MarketingProviderConnection"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Only the built-in company-manager role gains this new sensitive control.
-- Custom roles retain explicit grants and are never widened silently.
INSERT INTO "RolePermission" ("roleId", "permissionCode")
SELECT roles."id", capabilities."permissionCode"
FROM "Role" roles
CROSS JOIN (VALUES ('marketing.google-connection.manage')) AS capabilities("permissionCode")
WHERE roles."code" = 'BASEER_COMPANY_MANAGER'
  AND roles."isSystem" = true
ON CONFLICT ("roleId", "permissionCode") DO NOTHING;
