-- Immutable human attestations for the Noorix migration review gate.
-- These rows carry only safe aggregate review facts; they never contain
-- legacy business payloads and never mutate a migration mapping.

CREATE TYPE "LegacyMigrationReviewActionKind" AS ENUM ('APPROVE_DIRECT_CANDIDATES', 'ACKNOWLEDGE_EXCEPTION');

ALTER TABLE "LegacyMigrationException"
  ADD CONSTRAINT "LegacyMigrationException_id_tenant_key" UNIQUE ("id", "tenantId");

CREATE TABLE "LegacyMigrationReviewAction" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "runId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "exceptionId" UUID,
  "action" "LegacyMigrationReviewActionKind" NOT NULL,
  "actionKey" VARCHAR(120) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "reviewSnapshotSha256" CHAR(64) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LegacyMigrationReviewAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "LegacyMigrationReviewAction_run_tenant_fkey" FOREIGN KEY ("runId", "tenantId") REFERENCES "LegacyMigrationRun"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationReviewAction_exception_tenant_fkey" FOREIGN KEY ("exceptionId", "tenantId") REFERENCES "LegacyMigrationException"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationReviewAction_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationReviewAction_creator_tenant_fkey" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "LegacyMigrationReviewAction_run_action_key_key" UNIQUE ("runId", "action", "actionKey")
);
CREATE INDEX "LegacyMigrationReviewAction_tenant_run_created_idx" ON "LegacyMigrationReviewAction" ("tenantId", "runId", "createdAt");
CREATE INDEX "LegacyMigrationReviewAction_tenant_exception_created_idx" ON "LegacyMigrationReviewAction" ("tenantId", "exceptionId", "createdAt");

CREATE OR REPLACE FUNCTION prevent_legacy_migration_review_action_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Legacy migration review actions are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "LegacyMigrationReviewAction_append_only"
  BEFORE UPDATE OR DELETE ON "LegacyMigrationReviewAction"
  FOR EACH ROW EXECUTE FUNCTION prevent_legacy_migration_review_action_mutation();

ALTER TABLE "LegacyMigrationReviewAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LegacyMigrationReviewAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "LegacyMigrationReviewAction_tenant_isolation" ON "LegacyMigrationReviewAction"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
