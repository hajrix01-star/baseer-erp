-- R0-B freezes the financial source boundary for later report API/UI work.
-- It does not add a report endpoint, calculation, catalogue or output job.

CREATE TYPE "ReportRunStatus" AS ENUM ('READY', 'EXPIRED');

CREATE TABLE "FinanceLedgerRevision" (
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "currentRevision" BIGINT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceLedgerRevision_pkey" PRIMARY KEY ("tenantId", "companyId"),
  CONSTRAINT "FinanceLedgerRevision_company_tenant_key" UNIQUE ("companyId", "tenantId"),
  CONSTRAINT "FinanceLedgerRevision_nonnegative" CHECK ("currentRevision" >= 0),
  CONSTRAINT "FinanceLedgerRevision_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT
);

-- A pre-R0-B company becomes a single immutable baseline. Future sealed
-- entries receive the revision allocated atomically by JournalPostingService.
ALTER TABLE "FinanceJournalEntry" ADD COLUMN "ledgerRevision" BIGINT NOT NULL DEFAULT 0;
-- Legacy sealed entries are immutable financial evidence.  This one-time
-- metadata backfill assigns their common ledger baseline only; it does not
-- change an amount, date, status, reversal relation, or any business field.
-- The migration is transactional in PostgreSQL, so the guard is restored if
-- this statement cannot complete.
ALTER TABLE "FinanceJournalEntry" DISABLE TRIGGER "FinanceJournalEntry_guard_update_delete";
UPDATE "FinanceJournalEntry" SET "ledgerRevision" = 1 WHERE "isSealed" = true;
-- Updating an entry can queue deferred foreign-key checks. Drain those checks
-- before re-enabling the guard on the same table.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE "FinanceJournalEntry" ENABLE TRIGGER "FinanceJournalEntry_guard_update_delete";
ALTER TABLE "FinanceJournalEntry"
  ADD CONSTRAINT "FinanceJournalEntry_sealed_requires_ledger_revision"
  CHECK (NOT "isSealed" OR "ledgerRevision" > 0);
CREATE INDEX "FinanceJournalEntry_tenant_company_revision_date_id_idx"
  ON "FinanceJournalEntry" ("tenantId", "companyId", "ledgerRevision", "businessDate", "id");

INSERT INTO "FinanceLedgerRevision" ("tenantId", "companyId", "currentRevision")
SELECT "tenantId", "id", CASE WHEN EXISTS (
  SELECT 1 FROM "FinanceJournalEntry" entry
  WHERE entry."tenantId" = "Company"."tenantId" AND entry."companyId" = "Company"."id" AND entry."isSealed" = true
) THEN 1 ELSE 0 END
FROM "Company";

CREATE TABLE "ReportRun" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "reportCode" VARCHAR(80) NOT NULL,
  "definitionVersion" VARCHAR(80) NOT NULL,
  "canonicalOptionsJson" JSONB NOT NULL,
  "economicAsOfDate" DATE NOT NULL,
  "ledgerRevision" BIGINT NOT NULL,
  "eligibleEntryPredicateVersion" VARCHAR(80) NOT NULL,
  "projectionWatermarkJson" JSONB,
  "sourceCoverageJson" JSONB NOT NULL,
  "accountMappingVersionId" UUID,
  "accountMappingChecksum" CHAR(64),
  "checksum" CHAR(64) NOT NULL,
  "status" "ReportRunStatus" NOT NULL DEFAULT 'READY',
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "outputJobId" UUID,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ReportRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReportRun_tenant_company_id_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "ReportRun_mapping_pair" CHECK (("accountMappingVersionId" IS NULL) = ("accountMappingChecksum" IS NULL)),
  CONSTRAINT "ReportRun_mapping_checksum_format" CHECK ("accountMappingChecksum" IS NULL OR "accountMappingChecksum" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ReportRun_checksum_format" CHECK ("checksum" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "ReportRun_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "ReportRun_creator_fkey" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);
CREATE INDEX "ReportRun_tenant_company_report_created_idx" ON "ReportRun" ("tenantId", "companyId", "reportCode", "createdAt");
CREATE INDEX "ReportRun_tenant_company_status_expiry_idx" ON "ReportRun" ("tenantId", "companyId", "status", "expiresAt");
CREATE INDEX "ReportRun_tenant_company_ledger_revision_idx" ON "ReportRun" ("tenantId", "companyId", "ledgerRevision");

-- Report metadata is audit evidence. Availability expiry is evaluated at read
-- time; an archival process may only change READY -> EXPIRED.
CREATE OR REPLACE FUNCTION "report_run_immutable_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Report runs are immutable audit evidence';
  END IF;
  IF OLD."status" = 'READY' AND NEW."status" = 'EXPIRED'
    AND NEW."id" = OLD."id" AND NEW."tenantId" = OLD."tenantId" AND NEW."companyId" = OLD."companyId"
    AND NEW."reportCode" = OLD."reportCode" AND NEW."definitionVersion" = OLD."definitionVersion"
    AND NEW."canonicalOptionsJson" = OLD."canonicalOptionsJson" AND NEW."economicAsOfDate" = OLD."economicAsOfDate"
    AND NEW."ledgerRevision" = OLD."ledgerRevision" AND NEW."eligibleEntryPredicateVersion" = OLD."eligibleEntryPredicateVersion"
    AND NEW."projectionWatermarkJson" IS NOT DISTINCT FROM OLD."projectionWatermarkJson"
    AND NEW."sourceCoverageJson" = OLD."sourceCoverageJson" AND NEW."accountMappingVersionId" IS NOT DISTINCT FROM OLD."accountMappingVersionId"
    AND NEW."accountMappingChecksum" IS NOT DISTINCT FROM OLD."accountMappingChecksum" AND NEW."checksum" = OLD."checksum"
    AND NEW."expiresAt" = OLD."expiresAt" AND NEW."outputJobId" IS NOT DISTINCT FROM OLD."outputJobId"
    AND NEW."createdByUserId" = OLD."createdByUserId" AND NEW."createdAt" = OLD."createdAt"
  THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'A report run may only transition from READY to EXPIRED';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "ReportRun_immutable_guard"
  BEFORE UPDATE OR DELETE ON "ReportRun"
  FOR EACH ROW EXECUTE FUNCTION "report_run_immutable_guard"();

ALTER TABLE "FinanceLedgerRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceLedgerRevision" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinanceLedgerRevision_tenant_isolation" ON "FinanceLedgerRevision"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "ReportRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ReportRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY "ReportRun_tenant_isolation" ON "ReportRun"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
