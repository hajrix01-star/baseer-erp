-- A verified historical import is additive evidence: it never changes the
-- original immutable coverage declaration used by earlier report runs.
CREATE TABLE "FinanceCashPerformanceHistoricalImport" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "coverageStartBusinessDate" DATE NOT NULL,
  "sourceKind" VARCHAR(80) NOT NULL,
  "importedEventCount" INTEGER NOT NULL,
  "checksum" CHAR(64) NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "importedByUserId" UUID NOT NULL,
  "importedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceCashPerformanceHistoricalImport_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceCashPerformanceHistoricalImport_tenant_company_id_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "FinanceCashPerformanceHistoricalImport_company_kind_start_key" UNIQUE ("companyId", "sourceKind", "coverageStartBusinessDate"),
  CONSTRAINT "FinanceCashPerformanceHistoricalImport_event_count_nonnegative" CHECK ("importedEventCount" >= 0),
  CONSTRAINT "FinanceCashPerformanceHistoricalImport_checksum_format" CHECK ("checksum" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "FinanceCashPerformanceHistoricalImport_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceCashPerformanceHistoricalImport_creator_fkey" FOREIGN KEY ("importedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);
CREATE INDEX "FinanceCashPerformanceHistoricalImport_tenant_company_start_idx"
  ON "FinanceCashPerformanceHistoricalImport" ("tenantId", "companyId", "coverageStartBusinessDate");

CREATE OR REPLACE FUNCTION "finance_cash_performance_historical_import_immutable_guard"()
RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Cash-performance historical imports are immutable'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FinanceCashPerformanceHistoricalImport_immutable_guard"
  BEFORE UPDATE OR DELETE ON "FinanceCashPerformanceHistoricalImport"
  FOR EACH ROW EXECUTE FUNCTION "finance_cash_performance_historical_import_immutable_guard"();

ALTER TABLE "FinanceCashPerformanceHistoricalImport" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceCashPerformanceHistoricalImport" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinanceCashPerformanceHistoricalImport_tenant_isolation" ON "FinanceCashPerformanceHistoricalImport"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
