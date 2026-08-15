-- BASEER ERP fiscal-period and vault foundation.
-- Additive Baseer-only migration; it creates no financial movements or imports.

CREATE TYPE "FinanceFiscalPeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'LOCKED');
CREATE TYPE "FinanceVaultType" AS ENUM ('CASH', 'BANK', 'ELECTRONIC');
CREATE TYPE "FinanceVaultStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

CREATE TABLE "FinanceFiscalPeriod" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160) NOT NULL,
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "status" "FinanceFiscalPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "closedAt" TIMESTAMPTZ(6),
  "closeReason" VARCHAR(500),
  "lockedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("companyId", "startDate", "endDate"),
  CHECK ("startDate" <= "endDate"),
  CHECK (("status" = 'OPEN' AND "closedAt" IS NULL AND "closeReason" IS NULL AND "lockedAt" IS NULL) OR ("status" = 'CLOSED' AND "closedAt" IS NOT NULL AND "closeReason" IS NOT NULL AND "lockedAt" IS NULL) OR ("status" = 'LOCKED' AND "lockedAt" IS NOT NULL)),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT
);

CREATE TABLE "FinanceVault" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160) NOT NULL,
  "type" "FinanceVaultType" NOT NULL,
  "status" "FinanceVaultStatus" NOT NULL DEFAULT 'ACTIVE',
  "isSalesChannel" BOOLEAN NOT NULL DEFAULT FALSE,
  "isPaymentDestination" BOOLEAN NOT NULL DEFAULT TRUE,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("companyId", "nameAr"),
  UNIQUE ("companyId", "accountId"),
  CHECK (length(trim("nameAr")) > 0),
  CHECK (length(trim("nameEn")) > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("accountId", "tenantId", "companyId") REFERENCES "FinanceAccount"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE INDEX "FinanceFiscalPeriod_tenant_company_status_dates_idx" ON "FinanceFiscalPeriod"("tenantId", "companyId", "status", "startDate", "endDate");
CREATE INDEX "FinanceVault_tenant_company_status_sort_idx" ON "FinanceVault"("tenantId", "companyId", "status", "sortOrder");

ALTER TABLE "FinanceFiscalPeriod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceFiscalPeriod" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FinanceVault" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceVault" FORCE ROW LEVEL SECURITY;

CREATE POLICY "FinanceFiscalPeriod_tenant_isolation" ON "FinanceFiscalPeriod"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "FinanceVault_tenant_isolation" ON "FinanceVault"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
