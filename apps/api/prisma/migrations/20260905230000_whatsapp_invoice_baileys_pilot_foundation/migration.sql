-- WAI G5-B foundation: durable state only. This migration deliberately adds
-- no socket, QR, media download, OCR, purchase, or financial side effect.
CREATE TYPE "WhatsappInvoiceMediaWorkItemState" AS ENUM ('QUEUED', 'RUNNING', 'STORED', 'QUARANTINED', 'FAILED');

-- One AES-GCM envelope per tenant connection. The envelope is intentionally
-- opaque to PostgreSQL and is never a browser-facing credential store.
CREATE TABLE "WhatsappInvoiceConnectionSession" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "iv" VARCHAR(64) NOT NULL,
  "keyVersion" SMALLINT NOT NULL,
  "rowVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiConnectionSession_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "WaiConnectionSession_connection_fk" FOREIGN KEY ("connectionId", "tenantId") REFERENCES "WhatsappInvoiceConnection"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "WaiConnectionSession_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "WaiConnectionSession_connection_key" UNIQUE ("tenantId", "connectionId"),
  CONSTRAINT "WaiConnectionSession_key_version_positive" CHECK ("keyVersion" > 0),
  CONSTRAINT "WaiConnectionSession_row_version_nonnegative" CHECK ("rowVersion" >= 0),
  CONSTRAINT "WaiConnectionSession_ciphertext_present" CHECK (char_length("ciphertext") > 0),
  CONSTRAINT "WaiConnectionSession_iv_present" CHECK (char_length("iv") > 0)
);

-- A monotonically fenced lease. A stale worker must present both its owner
-- token and current fence before it can mutate a connection-bound resource.
CREATE TABLE "WhatsappInvoiceConnectionLease" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "connectionId" UUID NOT NULL,
  "ownerToken" VARCHAR(128) NOT NULL,
  "fence" BIGINT NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "heartbeatAt" TIMESTAMPTZ(6) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiConnectionLease_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "WaiConnectionLease_connection_fk" FOREIGN KEY ("connectionId", "tenantId") REFERENCES "WhatsappInvoiceConnection"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "WaiConnectionLease_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "WaiConnectionLease_connection_key" UNIQUE ("tenantId", "connectionId"),
  CONSTRAINT "WaiConnectionLease_owner_present" CHECK (char_length("ownerToken") > 0),
  CONSTRAINT "WaiConnectionLease_fence_positive" CHECK ("fence" > 0),
  CONSTRAINT "WaiConnectionLease_expiry_after_heartbeat" CHECK ("expiresAt" > "heartbeatAt")
);
CREATE INDEX "WaiConnectionLease_tenant_expiry_idx" ON "WhatsappInvoiceConnectionLease" ("tenantId", "expiresAt");

-- One work item is bound to one immutable asset. Its encrypted metadata is
-- worker transport context, distinct from receipt and stored-file metadata.
CREATE TABLE "WhatsappInvoiceMediaWorkItem" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "assetId" UUID NOT NULL,
  "state" "WhatsappInvoiceMediaWorkItemState" NOT NULL DEFAULT 'QUEUED',
  "metadataCiphertext" TEXT NOT NULL,
  "metadataIv" VARCHAR(64) NOT NULL,
  "metadataKeyVersion" SMALLINT NOT NULL,
  "metadataRowVersion" INTEGER NOT NULL DEFAULT 0,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMPTZ(6),
  "jobOwnerToken" VARCHAR(128),
  "jobFence" BIGINT,
  "jobLeaseExpiresAt" TIMESTAMPTZ(6),
  "jobHeartbeatAt" TIMESTAMPTZ(6),
  "lastErrorCode" VARCHAR(80),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiMediaWorkItem_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "WaiMediaWorkItem_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "WaiMediaWorkItem_asset_fk" FOREIGN KEY ("assetId", "tenantId", "companyId") REFERENCES "WhatsappInvoiceAsset"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "WaiMediaWorkItem_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "WaiMediaWorkItem_asset_key" UNIQUE ("tenantId", "companyId", "assetId"),
  CONSTRAINT "WaiMediaWorkItem_metadata_key_version_positive" CHECK ("metadataKeyVersion" > 0),
  CONSTRAINT "WaiMediaWorkItem_metadata_row_version_nonnegative" CHECK ("metadataRowVersion" >= 0),
  CONSTRAINT "WaiMediaWorkItem_attempts_nonnegative" CHECK ("attempts" >= 0),
  CONSTRAINT "WaiMediaWorkItem_metadata_present" CHECK (char_length("metadataCiphertext") > 0 AND char_length("metadataIv") > 0),
  CONSTRAINT "WaiMediaWorkItem_error_code_present" CHECK ("lastErrorCode" IS NULL OR char_length("lastErrorCode") > 0),
  CONSTRAINT "WaiMediaWorkItem_state_lease_shape" CHECK (
    ("state" = 'QUEUED' AND "nextAttemptAt" IS NOT NULL AND "jobOwnerToken" IS NULL AND "jobFence" IS NULL AND "jobLeaseExpiresAt" IS NULL AND "jobHeartbeatAt" IS NULL)
    OR ("state" = 'RUNNING' AND "nextAttemptAt" IS NULL AND "jobOwnerToken" IS NOT NULL AND "jobFence" IS NOT NULL AND "jobLeaseExpiresAt" IS NOT NULL AND "jobHeartbeatAt" IS NOT NULL AND "jobFence" > 0 AND "jobLeaseExpiresAt" > "jobHeartbeatAt")
    OR ("state" IN ('STORED', 'QUARANTINED', 'FAILED') AND "nextAttemptAt" IS NULL AND "jobOwnerToken" IS NULL AND "jobFence" IS NULL AND "jobLeaseExpiresAt" IS NULL AND "jobHeartbeatAt" IS NULL)
  )
);
CREATE INDEX "WaiMediaWorkItem_tenant_company_state_next_attempt_idx"
  ON "WhatsappInvoiceMediaWorkItem" ("tenantId", "companyId", "state", "nextAttemptAt");
CREATE INDEX "WaiMediaWorkItem_tenant_company_job_expiry_idx"
  ON "WhatsappInvoiceMediaWorkItem" ("tenantId", "companyId", "jobLeaseExpiresAt");

-- The connector worker runs inside a tenant transaction, so RLS remains the
-- DB boundary even if an application predicate is accidentally omitted.
DO $$ DECLARE table_name TEXT; BEGIN FOREACH table_name IN ARRAY ARRAY[
  'WhatsappInvoiceConnectionSession', 'WhatsappInvoiceConnectionLease', 'WhatsappInvoiceMediaWorkItem'
] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name || '_tenant_isolation', table_name);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseer_app') THEN
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO baseer_app', table_name);
  END IF;
END LOOP; END $$;
