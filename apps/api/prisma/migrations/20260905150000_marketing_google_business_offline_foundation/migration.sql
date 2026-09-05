CREATE TYPE "MarketingProviderCredentialStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "MarketingProviderSyncRunStatus" AS ENUM ('QUEUED', 'RUNNING', 'FAILED', 'BLOCKED');

ALTER TABLE "MarketingProviderConnection"
  ADD CONSTRAINT "MarketingProviderConnection_id_tenant_company_provider_key" UNIQUE ("id", "tenantId", "companyId", "provider");

ALTER TABLE "CompanyMembership"
  ADD CONSTRAINT "CompanyMembership_tenant_user_company_key" UNIQUE ("tenantId", "userId", "companyId");

CREATE TABLE "MarketingProviderCredentialEnvelope" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "connectionId" UUID NOT NULL,
  "provider" "MarketingProvider" NOT NULL, "ciphertext" TEXT NOT NULL, "iv" VARCHAR(64) NOT NULL,
  "tag" VARCHAR(64) NOT NULL, "keyVersion" INTEGER NOT NULL DEFAULT 1,
  "status" "MarketingProviderCredentialStatus" NOT NULL DEFAULT 'ACTIVE', "revokedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingProviderCredentialEnvelope_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingProviderCredentialEnvelope_connection_fk" FOREIGN KEY ("connectionId", "tenantId", "companyId", "provider") REFERENCES "MarketingProviderConnection"("id", "tenantId", "companyId", "provider") ON DELETE RESTRICT,
  CONSTRAINT "MarketingProviderCredentialEnvelope_connection_tenant_company_provider_key" UNIQUE ("connectionId", "tenantId", "companyId", "provider")
);
CREATE INDEX "MarketingProviderCredentialEnvelope_tenant_company_status_idx" ON "MarketingProviderCredentialEnvelope" ("tenantId", "companyId", "status");

CREATE TABLE "MarketingGoogleBusinessLocationMapping" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "connectionId" UUID NOT NULL,
  "provider" "MarketingProvider" NOT NULL DEFAULT 'GOOGLE_BUSINESS', "googleAccountResourceName" VARCHAR(512) NOT NULL,
  "googleLocationResourceName" VARCHAR(512) NOT NULL, "selectedAt" TIMESTAMPTZ(6) NOT NULL, "selectedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingGoogleBusinessLocationMapping_provider_check" CHECK ("provider" = 'GOOGLE_BUSINESS'),
  CONSTRAINT "MarketingGoogleBusinessLocationMapping_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingGoogleBusinessLocationMapping_connection_fk" FOREIGN KEY ("connectionId", "tenantId", "companyId", "provider") REFERENCES "MarketingProviderConnection"("id", "tenantId", "companyId", "provider") ON DELETE RESTRICT,
  CONSTRAINT "MarketingGoogleBusinessLocationMapping_selected_by_membership_fk" FOREIGN KEY ("tenantId", "selectedByUserId", "companyId") REFERENCES "CompanyMembership"("tenantId", "userId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingGoogleBusinessLocationMapping_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "MktGbpMapping_id_tenant_company_provider_uq" UNIQUE ("id", "tenantId", "companyId", "provider"),
  CONSTRAINT "MarketingGoogleBusinessLocationMapping_resource_key" UNIQUE ("tenantId", "companyId", "connectionId", "googleAccountResourceName", "googleLocationResourceName")
);
CREATE INDEX "MarketingGoogleBusinessLocationMapping_tenant_company_provider_selected_idx" ON "MarketingGoogleBusinessLocationMapping" ("tenantId", "companyId", "provider", "selectedAt");

CREATE TABLE "MarketingProviderSyncRun" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "locationMappingId" UUID NOT NULL,
  "provider" "MarketingProvider" NOT NULL, "status" "MarketingProviderSyncRunStatus" NOT NULL DEFAULT 'QUEUED',
  "correlationId" UUID NOT NULL, "attempt" INTEGER NOT NULL DEFAULT 1, "sourceWindowFrom" TIMESTAMPTZ(6), "sourceWindowTo" TIMESTAMPTZ(6),
  "rowsRead" INTEGER NOT NULL DEFAULT 0, "rowsWritten" INTEGER NOT NULL DEFAULT 0, "sourceChecksum" CHAR(64), "sourceFreshAt" TIMESTAMPTZ(6),
  "safeErrorCode" VARCHAR(80), "adapterVersion" VARCHAR(80) NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingProviderSyncRun_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingProviderSyncRun_mapping_fk" FOREIGN KEY ("locationMappingId", "tenantId", "companyId", "provider") REFERENCES "MarketingGoogleBusinessLocationMapping"("id", "tenantId", "companyId", "provider") ON DELETE RESTRICT
);
CREATE INDEX "MarketingProviderSyncRun_tenant_company_provider_status_created_idx" ON "MarketingProviderSyncRun" ("tenantId", "companyId", "provider", "status", "createdAt");
CREATE INDEX "MarketingProviderSyncRun_tenant_company_mapping_created_idx" ON "MarketingProviderSyncRun" ("tenantId", "companyId", "locationMappingId", "createdAt");

DO $$ DECLARE table_name TEXT; BEGIN FOREACH table_name IN ARRAY ARRAY['MarketingProviderCredentialEnvelope','MarketingGoogleBusinessLocationMapping','MarketingProviderSyncRun'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name || '_tenant_isolation', table_name);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseer_app') THEN EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO baseer_app', table_name); END IF;
END LOOP; END $$;
