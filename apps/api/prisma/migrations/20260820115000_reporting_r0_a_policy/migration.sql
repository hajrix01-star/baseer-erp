-- R0-A is accounting-reporting policy only. These records define an
-- effective-dated P&L presentation policy; they do not implement a report,
-- report run, export or financial posting path.

ALTER TABLE "CompanyFinanceProfile"
  ADD COLUMN "functionalCurrencyCode" CHAR(3) NOT NULL DEFAULT 'SAR';

ALTER TABLE "CompanyFinanceProfile"
  ADD CONSTRAINT "CompanyFinanceProfile_functional_currency_format"
  CHECK ("functionalCurrencyCode" ~ '^[A-Z]{3}$');

CREATE TYPE "FinancePnlMappingVersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');
CREATE TYPE "FinancePnlPresentationNature" AS ENUM (
  'REVENUE', 'COST_OF_SALES', 'OPERATING_INCOME', 'OPERATING_EXPENSE',
  'INVESTING', 'FINANCING', 'INCOME_TAX', 'DISCONTINUED_OPERATIONS'
);
CREATE TYPE "FinancePnlPresentationSign" AS ENUM ('CREDIT_NATURE', 'DEBIT_NATURE');

CREATE TABLE "FinancePnlMappingVersion" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "status" "FinancePnlMappingVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "policyVersion" VARCHAR(80) NOT NULL,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "approvedAt" TIMESTAMPTZ(6),
  "approvedByUserId" UUID,
  "checksum" CHAR(64),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancePnlMappingVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancePnlMappingVersion_tenant_company_id_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "FinancePnlMappingVersion_company_version_key" UNIQUE ("companyId", "versionNumber"),
  CONSTRAINT "FinancePnlMappingVersion_effective_range" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  CONSTRAINT "FinancePnlMappingVersion_approval_state" CHECK (
    ("status" = 'DRAFT' AND "approvedAt" IS NULL AND "approvedByUserId" IS NULL)
    OR ("status" IN ('APPROVED', 'SUPERSEDED') AND "approvedAt" IS NOT NULL AND "approvedByUserId" IS NOT NULL AND "checksum" IS NOT NULL)
  ),
  CONSTRAINT "FinancePnlMappingVersion_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT
);

CREATE TABLE "FinancePnlStatementLine" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "mappingVersionId" UUID NOT NULL,
  "code" VARCHAR(80) NOT NULL,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160) NOT NULL,
  "presentationNature" "FinancePnlPresentationNature" NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  "isSubtotal" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancePnlStatementLine_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancePnlStatementLine_tenant_company_id_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "FinancePnlStatementLine_version_code_key" UNIQUE ("mappingVersionId", "code"),
  CONSTRAINT "FinancePnlStatementLine_version_sort_order_key" UNIQUE ("mappingVersionId", "sortOrder"),
  CONSTRAINT "FinancePnlStatementLine_version_fkey" FOREIGN KEY ("mappingVersionId", "tenantId", "companyId") REFERENCES "FinancePnlMappingVersion"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "FinancePnlStatementLine_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT
);

CREATE TABLE "FinancePnlAccountMapping" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "mappingVersionId" UUID NOT NULL,
  "statementLineId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "presentationSign" "FinancePnlPresentationSign" NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinancePnlAccountMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinancePnlAccountMapping_tenant_company_id_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "FinancePnlAccountMapping_version_account_key" UNIQUE ("mappingVersionId", "accountId"),
  CONSTRAINT "FinancePnlAccountMapping_version_fkey" FOREIGN KEY ("mappingVersionId", "tenantId", "companyId") REFERENCES "FinancePnlMappingVersion"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "FinancePnlAccountMapping_line_fkey" FOREIGN KEY ("statementLineId", "tenantId", "companyId") REFERENCES "FinancePnlStatementLine"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "FinancePnlAccountMapping_account_fkey" FOREIGN KEY ("accountId", "tenantId", "companyId") REFERENCES "FinanceAccount"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "FinancePnlAccountMapping_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT
);

CREATE INDEX "FinancePnlMappingVersion_tenant_company_status_effective_from_idx"
  ON "FinancePnlMappingVersion" ("tenantId", "companyId", "status", "effectiveFrom");
CREATE INDEX "FinancePnlStatementLine_tenant_company_version_sort_order_idx"
  ON "FinancePnlStatementLine" ("tenantId", "companyId", "mappingVersionId", "sortOrder");
CREATE INDEX "FinancePnlAccountMapping_tenant_company_version_line_idx"
  ON "FinancePnlAccountMapping" ("tenantId", "companyId", "mappingVersionId", "statementLineId");
CREATE INDEX "FinancePnlAccountMapping_tenant_company_account_idx"
  ON "FinancePnlAccountMapping" ("tenantId", "companyId", "accountId");

-- A mapping may only point to a statement line in its own version. This cannot
-- be expressed by the ORM's three-column company-scoped relation alone.
CREATE OR REPLACE FUNCTION "finance_pnl_mapping_line_matches_version"()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "FinancePnlStatementLine"
    WHERE "id" = NEW."statementLineId"
      AND "tenantId" = NEW."tenantId"
      AND "companyId" = NEW."companyId"
      AND "mappingVersionId" = NEW."mappingVersionId"
  ) THEN
    RAISE EXCEPTION 'P&L account mapping line must belong to its mapping version';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "FinancePnlStatementLine"
    WHERE "id" = NEW."statementLineId" AND "isSubtotal" = true
  ) THEN
    RAISE EXCEPTION 'A P&L subtotal line cannot receive a direct account mapping';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "FinanceAccount"
    WHERE "id" = NEW."accountId" AND "tenantId" = NEW."tenantId" AND "companyId" = NEW."companyId"
      AND "type" IN ('REVENUE', 'EXPENSE')
  ) THEN
    RAISE EXCEPTION 'Only revenue and expense accounts may enter a P&L mapping';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FinancePnlAccountMapping_line_matches_version"
  BEFORE INSERT OR UPDATE ON "FinancePnlAccountMapping"
  FOR EACH ROW EXECUTE FUNCTION "finance_pnl_mapping_line_matches_version"();

-- Once a policy is approved, its lines/mappings are historical evidence and
-- cannot be rewritten. A successor policy supersedes the whole version.
CREATE OR REPLACE FUNCTION "finance_pnl_children_mutable_only_in_draft"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (
      SELECT 1 FROM "FinancePnlMappingVersion"
      WHERE "id" = OLD."mappingVersionId" AND "tenantId" = OLD."tenantId" AND "companyId" = OLD."companyId"
        AND "status" <> 'DRAFT'
    ) THEN
      RAISE EXCEPTION 'Approved P&L mapping lines and account mappings are immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF EXISTS (
    SELECT 1 FROM "FinancePnlMappingVersion"
    WHERE "id" = NEW."mappingVersionId" AND "tenantId" = NEW."tenantId" AND "companyId" = NEW."companyId"
      AND "status" <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'Approved P&L mapping lines and account mappings are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FinancePnlStatementLine_mutable_only_in_draft"
  BEFORE UPDATE OR DELETE ON "FinancePnlStatementLine"
  FOR EACH ROW EXECUTE FUNCTION "finance_pnl_children_mutable_only_in_draft"();
CREATE TRIGGER "FinancePnlAccountMapping_mutable_only_in_draft"
  BEFORE UPDATE OR DELETE ON "FinancePnlAccountMapping"
  FOR EACH ROW EXECUTE FUNCTION "finance_pnl_children_mutable_only_in_draft"();

-- The approval transition is append-only in effect: after approval, only the
-- effective end date and status may change while a new policy supersedes it.
CREATE OR REPLACE FUNCTION "finance_pnl_version_transition_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD."status" = 'SUPERSEDED' THEN
    RAISE EXCEPTION 'A superseded P&L mapping version is immutable';
  END IF;
  IF OLD."status" = 'APPROVED' AND (
    NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
    OR NEW."versionNumber" IS DISTINCT FROM OLD."versionNumber" OR NEW."policyVersion" IS DISTINCT FROM OLD."policyVersion"
    OR NEW."effectiveFrom" IS DISTINCT FROM OLD."effectiveFrom" OR NEW."approvedAt" IS DISTINCT FROM OLD."approvedAt"
    OR NEW."approvedByUserId" IS DISTINCT FROM OLD."approvedByUserId" OR NEW."checksum" IS DISTINCT FROM OLD."checksum"
    OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
    OR NOT (NEW."status" = 'SUPERSEDED' OR (NEW."status" = 'APPROVED' AND NEW."effectiveTo" IS NOT DISTINCT FROM OLD."effectiveTo"))
  ) THEN
    RAISE EXCEPTION 'An approved P&L mapping version may only be superseded';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "FinancePnlMappingVersion_transition_guard"
  BEFORE UPDATE ON "FinancePnlMappingVersion"
  FOR EACH ROW EXECUTE FUNCTION "finance_pnl_version_transition_guard"();

-- The functional currency is explicit and cannot silently change once any
-- sealed accounting evidence exists for the company.
CREATE OR REPLACE FUNCTION "finance_functional_currency_after_seal_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."functionalCurrencyCode" IS DISTINCT FROM OLD."functionalCurrencyCode" AND EXISTS (
    SELECT 1 FROM "FinanceJournalEntry"
    WHERE "tenantId" = OLD."tenantId" AND "companyId" = OLD."companyId" AND "isSealed" = true
  ) THEN
    RAISE EXCEPTION 'Functional currency cannot change after sealed journal evidence exists';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "CompanyFinanceProfile_functional_currency_after_seal_guard"
  BEFORE UPDATE ON "CompanyFinanceProfile"
  FOR EACH ROW EXECUTE FUNCTION "finance_functional_currency_after_seal_guard"();

-- All R0-A policy tables, and the daily ledger projection used by a future
-- Trial Balance, are tenant-isolated even when accessed outside a report API.
ALTER TABLE "FinanceAccountDailyBalance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceAccountDailyBalance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinanceAccountDailyBalance_tenant_isolation" ON "FinanceAccountDailyBalance"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "FinancePnlMappingVersion" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinancePnlMappingVersion" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinancePnlMappingVersion_tenant_isolation" ON "FinancePnlMappingVersion"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "FinancePnlStatementLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinancePnlStatementLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinancePnlStatementLine_tenant_isolation" ON "FinancePnlStatementLine"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "FinancePnlAccountMapping" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinancePnlAccountMapping" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinancePnlAccountMapping_tenant_isolation" ON "FinancePnlAccountMapping"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
