-- An owner-approved source boundary is required before the personal cash
-- performance report may call any selected period complete. It is immutable:
-- changing it would retroactively rewrite the meaning of a saved report run.
CREATE TABLE "FinanceCashPerformanceCoverage" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "coverageStartBusinessDate" DATE NOT NULL,
  "policyVersion" VARCHAR(80) NOT NULL,
  "activatedByUserId" UUID NOT NULL,
  "activatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceCashPerformanceCoverage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceCashPerformanceCoverage_tenant_company_id_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "FinanceCashPerformanceCoverage_company_key" UNIQUE ("companyId"),
  CONSTRAINT "FinanceCashPerformanceCoverage_company_tenant_key" UNIQUE ("companyId", "tenantId"),
  CONSTRAINT "FinanceCashPerformanceCoverage_company_fkey"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceCashPerformanceCoverage_activator_fkey"
    FOREIGN KEY ("activatedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);
CREATE INDEX "FinanceCashPerformanceCoverage_tenant_company_idx"
  ON "FinanceCashPerformanceCoverage" ("tenantId", "companyId");

CREATE OR REPLACE FUNCTION "finance_cash_performance_coverage_immutable_guard"()
RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Cash-performance report coverage is immutable'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FinanceCashPerformanceCoverage_immutable_guard"
  BEFORE UPDATE OR DELETE ON "FinanceCashPerformanceCoverage"
  FOR EACH ROW EXECUTE FUNCTION "finance_cash_performance_coverage_immutable_guard"();

ALTER TABLE "FinanceCashPerformanceCoverage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceCashPerformanceCoverage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinanceCashPerformanceCoverage_tenant_isolation" ON "FinanceCashPerformanceCoverage"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode")
SELECT role."tenantId", role."id", 'reports.cash_performance.activate'
FROM "Role" role
WHERE role."code" = 'BASEER_COMPANY_MANAGER'
ON CONFLICT DO NOTHING;
