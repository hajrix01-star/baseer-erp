-- Commercial change alerts require an explicit policy per company. The policy
-- is disabled by default; no inferred threshold is permitted.
CREATE TABLE "DecisionSalesChangePolicy" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "comparisonPolicyCode" VARCHAR(80) NOT NULL DEFAULT 'PREVIOUS_EQUAL_PERIOD',
  "comparisonPolicyVersion" VARCHAR(80) NOT NULL DEFAULT 'previous_equal_period.v1',
  "decreaseThresholdBasisPoints" INTEGER,
  "increaseThresholdBasisPoints" INTEGER,
  "updatedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DecisionSalesChangePolicy_decrease_threshold_check" CHECK ("decreaseThresholdBasisPoints" IS NULL OR "decreaseThresholdBasisPoints" BETWEEN 1 AND 10000),
  CONSTRAINT "DecisionSalesChangePolicy_increase_threshold_check" CHECK ("increaseThresholdBasisPoints" IS NULL OR "increaseThresholdBasisPoints" BETWEEN 1 AND 10000),
  CONSTRAINT "DecisionSalesChangePolicy_enabled_thresholds_check" CHECK (NOT "enabled" OR ("decreaseThresholdBasisPoints" IS NOT NULL AND "increaseThresholdBasisPoints" IS NOT NULL)),
  CONSTRAINT "DecisionSalesChangePolicy_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionSalesChangePolicy_updated_by_fk" FOREIGN KEY ("updatedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionSalesChangePolicy_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "DecisionSalesChangePolicy_company_tenant_key" UNIQUE ("companyId", "tenantId")
);

CREATE INDEX "DecisionSalesChangePolicy_tenant_company_enabled_idx" ON "DecisionSalesChangePolicy" ("tenantId", "companyId", "enabled");

ALTER TABLE "DecisionSalesChangePolicy" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DecisionSalesChangePolicy" FORCE ROW LEVEL SECURITY;
CREATE POLICY "DecisionSalesChangePolicy_tenant_isolation" ON "DecisionSalesChangePolicy"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
