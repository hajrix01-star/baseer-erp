-- A bounded, rebuildable monthly roll-up accelerates historical account and
-- vault balances. The journal remains the sole accounting source of truth.
CREATE TABLE "FinanceAccountMonthlyBalance" (
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "monthStart" DATE NOT NULL,
  "debitAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "creditAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceAccountMonthlyBalance_pkey" PRIMARY KEY ("tenantId", "companyId", "accountId", "monthStart")
);

CREATE INDEX "FinanceAccountMonthlyBalance_tenant_company_account_month_idx"
  ON "FinanceAccountMonthlyBalance" ("tenantId", "companyId", "accountId", "monthStart");

ALTER TABLE "FinanceAccountMonthlyBalance" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceAccountMonthlyBalance" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinanceAccountMonthlyBalance_tenant_isolation" ON "FinanceAccountMonthlyBalance"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO "FinanceAccountMonthlyBalance" (
  "tenantId", "companyId", "accountId", "monthStart", "debitAmount", "creditAmount"
)
SELECT
  "tenantId", "companyId", "accountId", date_trunc('month', "businessDate")::date,
  SUM("debitAmount"), SUM("creditAmount")
FROM "FinanceAccountDailyBalance"
GROUP BY "tenantId", "companyId", "accountId", date_trunc('month', "businessDate")::date;
