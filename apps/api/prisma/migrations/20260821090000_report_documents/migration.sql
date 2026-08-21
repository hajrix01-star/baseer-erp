-- User-retained report documents are immutable snapshots. They are created
-- explicitly from a ready report run; viewing a report does not create one.

CREATE TABLE "ReportDocument" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "reportRunId" UUID NOT NULL,
  "reportCode" VARCHAR(80) NOT NULL,
  "locale" VARCHAR(2) NOT NULL,
  "titleAr" VARCHAR(240) NOT NULL,
  "titleEn" VARCHAR(240) NOT NULL,
  "snapshotJson" JSONB NOT NULL,
  "snapshotChecksum" CHAR(64) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReportDocument_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "ReportDocument_reportRun_creator_locale_key" UNIQUE ("reportRunId", "createdByUserId", "locale"),
  CONSTRAINT "ReportDocument_snapshot_checksum_format" CHECK ("snapshotChecksum" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ReportDocument_locale" CHECK ("locale" IN ('ar', 'en')),
  CONSTRAINT "ReportDocument_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "ReportDocument_report_run_fkey" FOREIGN KEY ("reportRunId", "tenantId", "companyId") REFERENCES "ReportRun"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "ReportDocument_creator_fkey" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "ReportDocument_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT
);
CREATE INDEX "ReportDocument_tenant_company_creator_created_idx" ON "ReportDocument" ("tenantId", "companyId", "createdByUserId", "createdAt" DESC);
CREATE INDEX "ReportDocument_tenant_company_code_created_idx" ON "ReportDocument" ("tenantId", "companyId", "reportCode", "createdAt" DESC);

CREATE OR REPLACE FUNCTION "report_document_immutable_guard"()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Report documents are immutable; create a new document instead.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ReportDocument_immutable_guard"
  BEFORE UPDATE OR DELETE ON "ReportDocument"
  FOR EACH ROW EXECUTE FUNCTION "report_document_immutable_guard"();

ALTER TABLE "ReportDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ReportDocument_tenant_isolation" ON "ReportDocument"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
