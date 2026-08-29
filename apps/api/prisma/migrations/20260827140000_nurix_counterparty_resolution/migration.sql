-- Append-only source-supplier to tenant identity resolution.  This migration
-- records no supplier balance and creates no company-specific supplier.

CREATE TYPE "LegacyMigrationCounterpartyResolutionKind" AS ENUM ('EXPLICIT_ALIAS', 'MANUAL');

CREATE TABLE "LegacyMigrationCounterpartyResolution" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "sourceCompanyId" VARCHAR(120) NOT NULL,
  "sourceSupplierId" VARCHAR(160) NOT NULL,
  "identityId" UUID NOT NULL,
  "kind" "LegacyMigrationCounterpartyResolutionKind" NOT NULL,
  "transformVersion" VARCHAR(80) NOT NULL,
  "sourceChecksum" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacyMigrationCounterpartyResolution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacyMigrationCounterpartyResolution_run_tenant_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "LegacyMigrationRun"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationCounterpartyResolution_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationCounterpartyResolution_identity_tenant_fkey" FOREIGN KEY ("identityId", "tenantId") REFERENCES "FinanceCounterpartyIdentity"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationCounterpartyResolution_run_company_supplier_key" UNIQUE ("runId", "sourceCompanyId", "sourceSupplierId")
);
CREATE INDEX "LegacyMigrationCounterpartyResolution_tenant_run_identity_idx" ON "LegacyMigrationCounterpartyResolution" ("tenantId", "runId", "identityId");

CREATE OR REPLACE FUNCTION prevent_legacy_migration_counterparty_resolution_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Legacy migration counterparty resolutions are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LegacyMigrationCounterpartyResolution_append_only"
  BEFORE UPDATE OR DELETE ON "LegacyMigrationCounterpartyResolution"
  FOR EACH ROW EXECUTE FUNCTION prevent_legacy_migration_counterparty_resolution_mutation();

ALTER TABLE "LegacyMigrationCounterpartyResolution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegacyMigrationCounterpartyResolution" FORCE ROW LEVEL SECURITY;
CREATE POLICY "LegacyMigrationCounterpartyResolution_tenant_isolation" ON "LegacyMigrationCounterpartyResolution"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
