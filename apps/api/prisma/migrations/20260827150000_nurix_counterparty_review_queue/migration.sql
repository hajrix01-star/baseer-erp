-- Owner-review queue for the minimum supplier identity evidence needed to
-- resolve unmatched names in staging. This table never creates a supplier.

CREATE TYPE "LegacyMigrationCounterpartyCandidateKind" AS ENUM ('EXPLICIT_ALIAS', 'REVIEW_REQUIRED');

CREATE TABLE "LegacyMigrationCounterpartyCandidate" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "sourceCompanyId" VARCHAR(120) NOT NULL,
  "sourceSupplierId" VARCHAR(160) NOT NULL,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160),
  "kind" "LegacyMigrationCounterpartyCandidateKind" NOT NULL,
  "sourceChecksum" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacyMigrationCounterpartyCandidate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacyMigrationCounterpartyCandidate_run_tenant_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "LegacyMigrationRun"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationCounterpartyCandidate_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationCounterpartyCandidate_run_company_supplier_key" UNIQUE ("runId", "sourceCompanyId", "sourceSupplierId")
);
CREATE INDEX "LegacyMigrationCounterpartyCandidate_tenant_run_kind_created_idx" ON "LegacyMigrationCounterpartyCandidate" ("tenantId", "runId", "kind", "createdAt");

CREATE OR REPLACE FUNCTION prevent_legacy_migration_counterparty_candidate_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Legacy migration counterparty candidates are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LegacyMigrationCounterpartyCandidate_append_only"
  BEFORE UPDATE OR DELETE ON "LegacyMigrationCounterpartyCandidate"
  FOR EACH ROW EXECUTE FUNCTION prevent_legacy_migration_counterparty_candidate_mutation();

ALTER TABLE "LegacyMigrationCounterpartyCandidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegacyMigrationCounterpartyCandidate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "LegacyMigrationCounterpartyCandidate_tenant_isolation" ON "LegacyMigrationCounterpartyCandidate"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
