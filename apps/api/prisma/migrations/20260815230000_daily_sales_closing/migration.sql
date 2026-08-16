-- BASEER ERP daily sales closing: operational calendar, sales source documents,
-- server-owned daily summaries, and vault-channel projections. This is not POS.

CREATE TYPE "FinanceOperationalDayStatus" AS ENUM ('OPEN', 'CLOSED', 'PARTIAL');
CREATE TYPE "FinanceOperationalDaySource" AS ENUM ('MANUAL', 'HOLIDAY', 'MIGRATION');
CREATE TYPE "FinanceDailySalesClosingScope" AS ENUM ('MORNING', 'EVENING', 'ALL');
CREATE TYPE "FinanceDailySalesClosingStatus" AS ENUM ('POSTED', 'REVERSED');
CREATE TYPE "FinanceDailySalesDataStatus" AS ENUM ('RECORDED', 'PENDING', 'CLOSED');

ALTER TABLE "CompanyFinanceProfile"
  ADD COLUMN "vatRateBasisPoints" INTEGER NOT NULL DEFAULT 1500,
  ADD CONSTRAINT "CompanyFinanceProfile_vat_rate_range"
    CHECK ("vatRateBasisPoints" BETWEEN 0 AND 10000);

CREATE TABLE "FinanceOperationalDay" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "businessDate" DATE NOT NULL,
  "status" "FinanceOperationalDayStatus" NOT NULL DEFAULT 'OPEN',
  "source" "FinanceOperationalDaySource" NOT NULL DEFAULT 'MANUAL',
  "note" VARCHAR(1000),
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("companyId", "businessDate"),
  CHECK (("status" <> 'CLOSED') OR ("note" IS NOT NULL AND length(trim("note")) > 0)),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT
);

CREATE TABLE "FinanceDailySalesClosing" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "businessDate" DATE NOT NULL,
  "scope" "FinanceDailySalesClosingScope" NOT NULL,
  "documentNumber" VARCHAR(160) NOT NULL,
  "postingVersion" INTEGER NOT NULL DEFAULT 1,
  "grossAmount" DECIMAL(18,4) NOT NULL,
  "netAmount" DECIMAL(18,4) NOT NULL,
  "vatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "vatRateBasisPoints" INTEGER NOT NULL DEFAULT 0,
  "customerCount" INTEGER NOT NULL DEFAULT 0,
  "cashOnHandAmount" DECIMAL(18,4),
  "cashObservationVaultId" UUID,
  "notes" VARCHAR(2000),
  "status" "FinanceDailySalesClosingStatus" NOT NULL DEFAULT 'POSTED',
  "journalEntryId" UUID NOT NULL UNIQUE,
  "sourceSystem" VARCHAR(80),
  "sourceReference" VARCHAR(160),
  "sourceChecksum" VARCHAR(128),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("journalEntryId", "tenantId", "companyId"),
  UNIQUE ("companyId", "businessDate", "scope"),
  CHECK ("postingVersion" > 0),
  CHECK ("grossAmount" > 0 AND "netAmount" >= 0 AND "vatAmount" >= 0 AND "grossAmount" = "netAmount" + "vatAmount"),
  CHECK ("vatRateBasisPoints" BETWEEN 0 AND 10000),
  CHECK ("customerCount" >= 0),
  CHECK ("cashOnHandAmount" IS NULL OR "cashOnHandAmount" >= 0),
  CHECK (("cashOnHandAmount" IS NULL) = ("cashObservationVaultId" IS NULL)),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("journalEntryId", "tenantId", "companyId") REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("cashObservationVaultId", "tenantId", "companyId") REFERENCES "FinanceVault"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE TABLE "FinanceDailySalesAllocation" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "closingId" UUID NOT NULL,
  "vaultId" UUID NOT NULL,
  "grossAmount" DECIMAL(18,4) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("closingId", "vaultId"),
  CHECK ("grossAmount" > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("closingId", "tenantId", "companyId") REFERENCES "FinanceDailySalesClosing"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("vaultId", "tenantId", "companyId") REFERENCES "FinanceVault"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE TABLE "FinanceDailyFinancialSummary" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "businessDate" DATE NOT NULL,
  "salesGrossAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "salesNetAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "salesVatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "salesClosingCount" INTEGER NOT NULL DEFAULT 0,
  "customerCount" INTEGER NOT NULL DEFAULT 0,
  "operationalDayStatus" "FinanceOperationalDayStatus" NOT NULL DEFAULT 'OPEN',
  "dataStatus" "FinanceDailySalesDataStatus" NOT NULL DEFAULT 'PENDING',
  "sourceChecksum" VARCHAR(128) NOT NULL,
  "reconciledAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("companyId", "businessDate"),
  CHECK ("salesGrossAmount" >= 0 AND "salesNetAmount" >= 0 AND "salesVatAmount" >= 0),
  CHECK ("salesGrossAmount" = "salesNetAmount" + "salesVatAmount"),
  CHECK ("salesClosingCount" >= 0 AND "customerCount" >= 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT
);

CREATE TABLE "FinanceDailySalesChannelSummary" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "dailySummaryId" UUID NOT NULL,
  "vaultId" UUID NOT NULL,
  "grossAmount" DECIMAL(18,4) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("dailySummaryId", "vaultId"),
  CHECK ("grossAmount" > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("dailySummaryId", "tenantId", "companyId") REFERENCES "FinanceDailyFinancialSummary"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("vaultId", "tenantId", "companyId") REFERENCES "FinanceVault"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE INDEX "FinanceOperationalDay_tenant_company_date_status_idx"
  ON "FinanceOperationalDay"("tenantId", "companyId", "businessDate", "status");
CREATE INDEX "FinanceDailySalesClosing_tenant_company_date_status_idx"
  ON "FinanceDailySalesClosing"("tenantId", "companyId", "businessDate", "status");
CREATE INDEX "FinanceDailySalesAllocation_tenant_company_vault_idx"
  ON "FinanceDailySalesAllocation"("tenantId", "companyId", "vaultId");
CREATE INDEX "FinanceDailyFinancialSummary_tenant_company_date_status_idx"
  ON "FinanceDailyFinancialSummary"("tenantId", "companyId", "businessDate", "dataStatus");
CREATE INDEX "FinanceDailySalesChannelSummary_tenant_company_vault_idx"
  ON "FinanceDailySalesChannelSummary"("tenantId", "companyId", "vaultId");

ALTER TABLE "FinanceOperationalDay" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceOperationalDay" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FinanceDailySalesClosing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceDailySalesClosing" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FinanceDailySalesAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceDailySalesAllocation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FinanceDailyFinancialSummary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceDailyFinancialSummary" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FinanceDailySalesChannelSummary" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceDailySalesChannelSummary" FORCE ROW LEVEL SECURITY;

CREATE POLICY "FinanceOperationalDay_tenant_isolation" ON "FinanceOperationalDay"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "FinanceDailySalesClosing_tenant_isolation" ON "FinanceDailySalesClosing"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "FinanceDailySalesAllocation_tenant_isolation" ON "FinanceDailySalesAllocation"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "FinanceDailyFinancialSummary_tenant_isolation" ON "FinanceDailyFinancialSummary"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "FinanceDailySalesChannelSummary_tenant_isolation" ON "FinanceDailySalesChannelSummary"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);