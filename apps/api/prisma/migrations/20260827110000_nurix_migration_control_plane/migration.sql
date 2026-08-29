-- Snapshot-bound Noorix/Baseer migration control plane.
-- This migration creates technical lineage only; it imports no legacy data.

CREATE TYPE "LegacyMigrationRunStatus" AS ENUM ('DISCOVERY', 'DRY_RUN', 'READY_TO_STAGE', 'STAGED', 'RECONCILED', 'FAILED', 'CANCELLED');
CREATE TYPE "LegacyMigrationCompanyMapState" AS ENUM ('PLANNED', 'APPROVED');
CREATE TYPE "LegacyMigrationRecordMapState" AS ENUM ('PLANNED', 'STAGED', 'RECONCILED', 'EXCLUDED');
CREATE TYPE "LegacyMigrationExceptionSeverity" AS ENUM ('BLOCKER', 'REVIEW', 'WARNING');

CREATE TABLE "LegacyMigrationRun" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "sourceSystem" VARCHAR(80) NOT NULL,
  "sourceFingerprint" CHAR(64) NOT NULL,
  "transformVersion" VARCHAR(80) NOT NULL,
  "status" "LegacyMigrationRunStatus" NOT NULL DEFAULT 'DISCOVERY',
  "initiatedByUserId" UUID NOT NULL,
  "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacyMigrationRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacyMigrationRun_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationRun_creator_tenant_fkey" FOREIGN KEY ("initiatedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationRun_tenant_source_fingerprint_transform_key" UNIQUE ("tenantId", "sourceSystem", "sourceFingerprint", "transformVersion"),
  CONSTRAINT "LegacyMigrationRun_id_tenant_key" UNIQUE ("id", "tenantId")
);
CREATE INDEX "LegacyMigrationRun_tenant_status_started_idx" ON "LegacyMigrationRun" ("tenantId", "status", "startedAt");

CREATE TABLE "LegacyMigrationCompanyMap" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "sourceCompanyId" VARCHAR(120) NOT NULL,
  "targetCompanyId" UUID NOT NULL,
  "state" "LegacyMigrationCompanyMapState" NOT NULL DEFAULT 'PLANNED',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacyMigrationCompanyMap_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacyMigrationCompanyMap_run_tenant_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "LegacyMigrationRun"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationCompanyMap_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationCompanyMap_target_company_tenant_fkey" FOREIGN KEY ("targetCompanyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationCompanyMap_run_source_company_key" UNIQUE ("runId", "sourceCompanyId"),
  CONSTRAINT "LegacyMigrationCompanyMap_run_target_company_key" UNIQUE ("runId", "targetCompanyId")
);
CREATE INDEX "LegacyMigrationCompanyMap_tenant_target_company_idx" ON "LegacyMigrationCompanyMap" ("tenantId", "targetCompanyId");

CREATE TABLE "LegacyMigrationRecordMap" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "targetCompanyId" UUID NOT NULL,
  "sourceCompanyId" VARCHAR(120) NOT NULL,
  "sourceEntity" VARCHAR(120) NOT NULL,
  "sourceId" VARCHAR(160) NOT NULL,
  "targetEntity" VARCHAR(120) NOT NULL,
  "targetId" VARCHAR(160) NOT NULL,
  "transformVersion" VARCHAR(80) NOT NULL,
  "sourceChecksum" CHAR(64) NOT NULL,
  "state" "LegacyMigrationRecordMapState" NOT NULL DEFAULT 'PLANNED',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacyMigrationRecordMap_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacyMigrationRecordMap_run_tenant_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "LegacyMigrationRun"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationRecordMap_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationRecordMap_target_company_tenant_fkey" FOREIGN KEY ("targetCompanyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationRecordMap_run_source_entity_id_key" UNIQUE ("runId", "sourceEntity", "sourceId"),
  CONSTRAINT "LegacyMigrationRecordMap_run_target_entity_id_key" UNIQUE ("runId", "targetEntity", "targetId")
);
CREATE INDEX "LegacyMigrationRecordMap_tenant_target_entity_idx" ON "LegacyMigrationRecordMap" ("tenantId", "targetCompanyId", "sourceEntity");
CREATE INDEX "LegacyMigrationRecordMap_tenant_source_entity_idx" ON "LegacyMigrationRecordMap" ("tenantId", "sourceCompanyId", "sourceEntity");

CREATE TABLE "LegacyMigrationException" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "sourceCompanyId" VARCHAR(120),
  "sourceEntity" VARCHAR(120),
  "sourceId" VARCHAR(160),
  "severity" "LegacyMigrationExceptionSeverity" NOT NULL,
  "code" VARCHAR(120) NOT NULL,
  "message" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacyMigrationException_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacyMigrationException_run_tenant_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "LegacyMigrationRun"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationException_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT
);
CREATE INDEX "LegacyMigrationException_tenant_run_severity_created_idx" ON "LegacyMigrationException" ("tenantId", "runId", "severity", "createdAt");

CREATE OR REPLACE FUNCTION prevent_legacy_migration_map_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Legacy migration mappings are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LegacyMigrationCompanyMap_append_only"
  BEFORE UPDATE OR DELETE ON "LegacyMigrationCompanyMap"
  FOR EACH ROW EXECUTE FUNCTION prevent_legacy_migration_map_mutation();
CREATE TRIGGER "LegacyMigrationRecordMap_append_only"
  BEFORE UPDATE OR DELETE ON "LegacyMigrationRecordMap"
  FOR EACH ROW EXECUTE FUNCTION prevent_legacy_migration_map_mutation();

ALTER TABLE "LegacyMigrationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegacyMigrationRun" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LegacyMigrationCompanyMap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegacyMigrationCompanyMap" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LegacyMigrationRecordMap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegacyMigrationRecordMap" FORCE ROW LEVEL SECURITY;
ALTER TABLE "LegacyMigrationException" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegacyMigrationException" FORCE ROW LEVEL SECURITY;

CREATE POLICY "LegacyMigrationRun_tenant_isolation" ON "LegacyMigrationRun"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "LegacyMigrationCompanyMap_tenant_isolation" ON "LegacyMigrationCompanyMap"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "LegacyMigrationRecordMap_tenant_isolation" ON "LegacyMigrationRecordMap"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "LegacyMigrationException_tenant_isolation" ON "LegacyMigrationException"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
