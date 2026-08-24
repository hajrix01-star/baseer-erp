-- Owner-only, tenant-level configuration. The central mailbox must never be
-- faked as a company mailbox: company assignment happens only after evidence
-- intake in a later gate.
CREATE TABLE "InboundEvidenceLabel" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "nameAr" VARCHAR(80) NOT NULL,
  "nameEn" VARCHAR(80),
  "nameKey" VARCHAR(120) NOT NULL,
  "colorHex" CHAR(7) NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 100,
  "systemKey" VARCHAR(80),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundEvidenceLabel_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "InboundEvidenceLabel_tenant_nameKey_key" UNIQUE ("tenantId", "nameKey"),
  CONSTRAINT "InboundEvidenceLabel_tenant_systemKey_key" UNIQUE ("tenantId", "systemKey"),
  CONSTRAINT "InboundEvidenceLabel_id_tenant_key" UNIQUE ("id", "tenantId")
);
CREATE INDEX "InboundEvidenceLabel_tenant_sort_idx" ON "InboundEvidenceLabel" ("tenantId", "sortOrder");

CREATE TABLE "InboundEvidenceRule" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "labelId" UUID NOT NULL,
  "name" VARCHAR(120) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "senderContains" VARCHAR(240),
  "subjectContains" VARCHAR(240),
  "attachmentCondition" VARCHAR(16) NOT NULL DEFAULT 'ANY',
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundEvidenceRule_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "InboundEvidenceRule_label_tenant_fkey" FOREIGN KEY ("labelId", "tenantId") REFERENCES "InboundEvidenceLabel"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "InboundEvidenceRule_id_tenant_key" UNIQUE ("id", "tenantId")
);
CREATE INDEX "InboundEvidenceRule_tenant_enabled_priority_idx" ON "InboundEvidenceRule" ("tenantId", "enabled", "priority");
CREATE INDEX "InboundEvidenceRule_tenant_label_idx" ON "InboundEvidenceRule" ("tenantId", "labelId");

CREATE TABLE "InboundEvidenceCommandReceipt" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "operation" VARCHAR(120) NOT NULL,
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "responseJson" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "InboundEvidenceCommandReceipt_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "InboundEvidenceCommandReceipt_tenant_actor_operation_key" UNIQUE ("tenantId", "actorUserId", "operation", "idempotencyKey")
);
CREATE INDEX "InboundEvidenceCommandReceipt_tenant_expires_idx" ON "InboundEvidenceCommandReceipt" ("tenantId", "expiresAt");

ALTER TABLE "InboundEvidenceLabel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboundEvidenceLabel" FORCE ROW LEVEL SECURITY;
CREATE POLICY "InboundEvidenceLabel_tenant_isolation" ON "InboundEvidenceLabel"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "InboundEvidenceRule" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboundEvidenceRule" FORCE ROW LEVEL SECURITY;
CREATE POLICY "InboundEvidenceRule_tenant_isolation" ON "InboundEvidenceRule"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "InboundEvidenceCommandReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboundEvidenceCommandReceipt" FORCE ROW LEVEL SECURITY;
CREATE POLICY "InboundEvidenceCommandReceipt_tenant_isolation" ON "InboundEvidenceCommandReceipt"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
