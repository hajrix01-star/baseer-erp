-- Recurring-expense profiles become governed obligations: a real payment owns explicit calendar coverage.
ALTER TABLE "FinanceRecurringExpenseProfile"
  ADD COLUMN "serviceNumber" VARCHAR(160),
  ADD COLUMN "defaultVaultId" UUID,
  ADD COLUMN "allowAmountOverride" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "FinanceOutflowDocument"
  ADD COLUMN "recurringExpenseProfileId" UUID,
  ADD COLUMN "coverageYear" INTEGER,
  ADD COLUMN "coverageStartMonth" INTEGER,
  ADD COLUMN "coverageMonths" INTEGER;

ALTER TABLE "FinanceRecurringExpenseProfile"
  ADD CONSTRAINT "FinanceRecurringExpenseProfile_defaultVaultId_tenantId_companyId_fkey"
  FOREIGN KEY ("defaultVaultId", "tenantId", "companyId") REFERENCES "FinanceVault"("id", "tenantId", "companyId") ON DELETE RESTRICT;

ALTER TABLE "FinanceOutflowDocument"
  ADD CONSTRAINT "FinanceOutflowDocument_recurringExpenseProfileId_tenantId_companyId_fkey"
  FOREIGN KEY ("recurringExpenseProfileId", "tenantId", "companyId") REFERENCES "FinanceRecurringExpenseProfile"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  ADD CONSTRAINT "FinanceOutflowDocument_recurring_coverage_valid"
  CHECK (("recurringExpenseProfileId" IS NULL AND "coverageYear" IS NULL AND "coverageStartMonth" IS NULL AND "coverageMonths" IS NULL) OR ("recurringExpenseProfileId" IS NOT NULL AND "coverageYear" BETWEEN 2000 AND 2100 AND "coverageStartMonth" BETWEEN 1 AND 12 AND "coverageMonths" BETWEEN 1 AND 12 AND "coverageStartMonth" + "coverageMonths" - 1 <= 12));

CREATE TABLE "FinanceRecurringExpenseCoverage" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "profileId" UUID NOT NULL,
  "coverageYear" INTEGER NOT NULL,
  "coverageMonth" INTEGER NOT NULL,
  "documentId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("companyId", "profileId", "coverageYear", "coverageMonth"),
  CHECK ("coverageYear" BETWEEN 2000 AND 2100),
  CHECK ("coverageMonth" BETWEEN 1 AND 12),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("profileId", "tenantId", "companyId") REFERENCES "FinanceRecurringExpenseProfile"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("documentId", "tenantId", "companyId") REFERENCES "FinanceOutflowDocument"("id", "tenantId", "companyId") ON DELETE RESTRICT
);
CREATE INDEX "FinanceOutflowDocument_tenant_company_recurring_profile_year_idx" ON "FinanceOutflowDocument"("tenantId", "companyId", "recurringExpenseProfileId", "coverageYear");
CREATE INDEX "FinanceRecurringExpenseCoverage_tenant_company_profile_year_idx" ON "FinanceRecurringExpenseCoverage"("tenantId", "companyId", "profileId", "coverageYear");
ALTER TABLE "FinanceRecurringExpenseCoverage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceRecurringExpenseCoverage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinanceRecurringExpenseCoverage_tenant_isolation" ON "FinanceRecurringExpenseCoverage"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);