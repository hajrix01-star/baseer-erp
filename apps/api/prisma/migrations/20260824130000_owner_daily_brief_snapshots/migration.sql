-- Immutable daily owner briefing receipts. The scheduler writes one snapshot
-- after each completed Asia/Riyadh business day; subsequent reads use the
-- receipt rather than recalculating historical reporting data.
CREATE TABLE "OwnerDailyBriefSnapshot" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "reportDate" DATE NOT NULL,
  "receiptJson" JSONB NOT NULL,
  "receiptSha256" CHAR(64) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OwnerDailyBriefSnapshot_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "OwnerDailyBriefSnapshot_tenant_reportDate_key"
    UNIQUE ("tenantId", "reportDate")
);

CREATE INDEX "OwnerDailyBriefSnapshot_tenant_reportDate_idx"
  ON "OwnerDailyBriefSnapshot" ("tenantId", "reportDate" DESC);

ALTER TABLE "OwnerDailyBriefSnapshot" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OwnerDailyBriefSnapshot" FORCE ROW LEVEL SECURITY;
CREATE POLICY "OwnerDailyBriefSnapshot_tenant_isolation"
  ON "OwnerDailyBriefSnapshot"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
