CREATE TABLE "DecisionRuleDefinition" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
  "ruleCode" VARCHAR(120) NOT NULL, "ruleVersion" VARCHAR(80) NOT NULL,
  "status" "DecisionContextEventStatus" NOT NULL DEFAULT 'PUBLISHED',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionRuleDefinition_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionRuleDefinition_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "DecisionRuleDefinition_company_rule_version_key" UNIQUE ("companyId", "ruleCode", "ruleVersion")
);
CREATE INDEX "DecisionRuleDefinition_tenant_company_rule_status_idx" ON "DecisionRuleDefinition" ("tenantId", "companyId", "ruleCode", "status");
ALTER TABLE "DecisionRuleDefinition" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DecisionRuleDefinition" FORCE ROW LEVEL SECURITY;
CREATE POLICY "DecisionRuleDefinition_tenant_isolation" ON "DecisionRuleDefinition"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
