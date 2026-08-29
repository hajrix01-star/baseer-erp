-- Gate 1: durable, tenant-isolated company archive job foundation only.
-- No ERP data is exported or restored by this migration.

CREATE TYPE "BackupJobKind" AS ENUM ('COMPANY_ARCHIVE_EXPORT');
CREATE TYPE "BackupJobStatus" AS ENUM (
  'QUEUED', 'PRECHECK', 'CONSISTENT_SNAPSHOT', 'EXPORT_DATA',
  'EXPORT_ATTACHMENTS', 'PACKAGE_COMPRESS_ENCRYPT', 'VERIFY_HASHES',
  'PUBLISHED', 'FAILED', 'CANCELLED'
);
CREATE TYPE "BackupArtifactStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED');
CREATE TYPE "BackupPolicyFrequency" AS ENUM ('MANUAL', 'DAILY', 'WEEKLY', 'MONTHLY');

CREATE TABLE "BackupPolicy" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "name" VARCHAR(80) NOT NULL DEFAULT 'default',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "frequency" "BackupPolicyFrequency" NOT NULL DEFAULT 'MANUAL',
  "scheduleJson" JSONB,
  "retentionCount" INTEGER NOT NULL DEFAULT 7,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BackupPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BackupPolicy_retention_positive" CHECK ("retentionCount" BETWEEN 1 AND 3650),
  CONSTRAINT "BackupPolicy_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "BackupPolicy_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "BackupPolicy_creator_tenant_fkey" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "BackupPolicy_tenant_company_name_key" UNIQUE ("tenantId", "companyId", "name"),
  CONSTRAINT "BackupPolicy_id_tenant_key" UNIQUE ("id", "tenantId")
);
CREATE INDEX "BackupPolicy_tenant_company_enabled_idx" ON "BackupPolicy" ("tenantId", "companyId", "enabled");

CREATE TABLE "BackupJob" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "policyId" UUID,
  "requestedByUserId" UUID NOT NULL,
  "kind" "BackupJobKind" NOT NULL,
  "status" "BackupJobStatus" NOT NULL DEFAULT 'QUEUED',
  "stage" VARCHAR(80) NOT NULL DEFAULT 'QUEUED',
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "correlationId" UUID NOT NULL,
  "progressPercent" INTEGER NOT NULL DEFAULT 0,
  "checkpointJson" JSONB,
  "recordsProcessed" INTEGER NOT NULL DEFAULT 0,
  "recordsTotal" INTEGER,
  "bytesProcessed" BIGINT NOT NULL DEFAULT 0,
  "bytesTotal" BIGINT,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "workerLeaseOwnerId" UUID,
  "workerLeaseExpiresAt" TIMESTAMPTZ(6),
  "workerHeartbeatAt" TIMESTAMPTZ(6),
  "lastErrorCode" VARCHAR(120),
  "lastErrorMessage" VARCHAR(1000),
  "queuedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMPTZ(6),
  "completedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BackupJob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BackupJob_progress_valid" CHECK ("progressPercent" BETWEEN 0 AND 100),
  CONSTRAINT "BackupJob_counts_valid" CHECK ("recordsProcessed" >= 0 AND ("recordsTotal" IS NULL OR "recordsTotal" >= "recordsProcessed")),
  CONSTRAINT "BackupJob_bytes_valid" CHECK ("bytesProcessed" >= 0 AND ("bytesTotal" IS NULL OR "bytesTotal" >= "bytesProcessed")),
  CONSTRAINT "BackupJob_attempts_valid" CHECK ("attemptCount" >= 0),
  CONSTRAINT "BackupJob_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "BackupJob_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "BackupJob_policy_tenant_fkey" FOREIGN KEY ("policyId", "tenantId") REFERENCES "BackupPolicy"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "BackupJob_requester_tenant_fkey" FOREIGN KEY ("requestedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "BackupJob_tenant_company_requester_kind_idempotency_key" UNIQUE ("tenantId", "companyId", "requestedByUserId", "kind", "idempotencyKey"),
  CONSTRAINT "BackupJob_id_tenant_key" UNIQUE ("id", "tenantId")
);
CREATE INDEX "BackupJob_tenant_company_status_queued_idx" ON "BackupJob" ("tenantId", "companyId", "status", "queuedAt");
CREATE INDEX "BackupJob_tenant_status_worker_lease_queued_idx" ON "BackupJob" ("tenantId", "status", "workerLeaseExpiresAt", "queuedAt");
CREATE INDEX "BackupJob_tenant_policy_queued_idx" ON "BackupJob" ("tenantId", "policyId", "queuedAt");

CREATE TABLE "BackupArtifact" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "jobId" UUID NOT NULL,
  "status" "BackupArtifactStatus" NOT NULL DEFAULT 'PENDING',
  "formatVersion" VARCHAR(80) NOT NULL,
  "storageKey" VARCHAR(500),
  "filename" VARCHAR(255),
  "sha256" CHAR(64),
  "byteSize" BIGINT,
  "verifiedAt" TIMESTAMPTZ(6),
  "expiresAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BackupArtifact_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BackupArtifact_size_valid" CHECK ("byteSize" IS NULL OR "byteSize" >= 0),
  CONSTRAINT "BackupArtifact_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "BackupArtifact_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "BackupArtifact_job_tenant_fkey" FOREIGN KEY ("jobId", "tenantId") REFERENCES "BackupJob"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "BackupArtifact_jobId_key" UNIQUE ("jobId"),
  CONSTRAINT "BackupArtifact_id_tenant_key" UNIQUE ("id", "tenantId")
);
CREATE INDEX "BackupArtifact_tenant_company_status_created_idx" ON "BackupArtifact" ("tenantId", "companyId", "status", "createdAt");

CREATE TABLE "BackupAuditEvent" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "jobId" UUID,
  "actorUserId" UUID,
  "action" VARCHAR(120) NOT NULL,
  "correlationId" UUID NOT NULL,
  "previousHash" CHAR(64),
  "eventHash" CHAR(64) NOT NULL,
  "metadataJson" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BackupAuditEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BackupAuditEvent_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "BackupAuditEvent_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "BackupAuditEvent_job_tenant_fkey" FOREIGN KEY ("jobId", "tenantId") REFERENCES "BackupJob"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "BackupAuditEvent_actor_tenant_fkey" FOREIGN KEY ("actorUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE NO ACTION,
  CONSTRAINT "BackupAuditEvent_tenant_eventHash_key" UNIQUE ("tenantId", "eventHash")
);
CREATE INDEX "BackupAuditEvent_tenant_company_created_idx" ON "BackupAuditEvent" ("tenantId", "companyId", "createdAt");
CREATE INDEX "BackupAuditEvent_tenant_job_created_idx" ON "BackupAuditEvent" ("tenantId", "jobId", "createdAt");

CREATE OR REPLACE FUNCTION prevent_backup_audit_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Backup audit events are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "BackupAuditEvent_append_only"
  BEFORE UPDATE OR DELETE ON "BackupAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION prevent_backup_audit_mutation();

ALTER TABLE "BackupPolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BackupPolicy" FORCE ROW LEVEL SECURITY;
CREATE POLICY "BackupPolicy_tenant_isolation" ON "BackupPolicy"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "BackupJob" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BackupJob" FORCE ROW LEVEL SECURITY;
CREATE POLICY "BackupJob_tenant_isolation" ON "BackupJob"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "BackupArtifact" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BackupArtifact" FORCE ROW LEVEL SECURITY;
CREATE POLICY "BackupArtifact_tenant_isolation" ON "BackupArtifact"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "BackupAuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "BackupAuditEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "BackupAuditEvent_tenant_isolation" ON "BackupAuditEvent"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
