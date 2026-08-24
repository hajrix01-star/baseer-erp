-- E5a: code-owned, offline Basira evaluation evidence. These rows contain
-- de-identified control outcomes only; provider prompts and answers are never
-- stored here. A new skill/policy/suite revision must create a new row.

CREATE TYPE "AiSkillEvaluationRunMode" AS ENUM ('OFFLINE');
CREATE TYPE "AiSkillEvaluationRunStatus" AS ENUM ('PASSED', 'FAILED', 'BLOCKED');

CREATE TABLE "AiSkillEvaluationRun" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "skillKey" VARCHAR(120) NOT NULL,
  "skillVersion" INTEGER NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "suiteKey" VARCHAR(160) NOT NULL,
  "suiteVersion" INTEGER NOT NULL,
  "suiteChecksum" CHAR(64) NOT NULL,
  "mode" "AiSkillEvaluationRunMode" NOT NULL,
  "status" "AiSkillEvaluationRunStatus" NOT NULL,
  "totalCaseCount" INTEGER NOT NULL,
  "passedCaseCount" INTEGER NOT NULL,
  "failedCaseCount" INTEGER NOT NULL,
  "resultSummaryJson" JSONB NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiSkillEvaluationRun_company_fk"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiSkillEvaluationRun_created_by_fk"
    FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiSkillEvaluationRun_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AiSkillEvaluationRun_versions_positive" CHECK (
    "skillVersion" > 0 AND "policyVersion" > 0 AND "suiteVersion" > 0
  ),
  CONSTRAINT "AiSkillEvaluationRun_checksum_valid" CHECK (
    "suiteChecksum" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "AiSkillEvaluationRun_case_counts_valid" CHECK (
    "totalCaseCount" > 0 AND "passedCaseCount" >= 0 AND "failedCaseCount" >= 0
    AND "passedCaseCount" + "failedCaseCount" = "totalCaseCount"
  ),
  CONSTRAINT "AiSkillEvaluationRun_status_consistent" CHECK (
    ("status" = 'PASSED' AND "failedCaseCount" = 0 AND "passedCaseCount" = "totalCaseCount")
    OR ("status" = 'FAILED' AND "failedCaseCount" > 0)
    OR ("status" = 'BLOCKED' AND "passedCaseCount" = 0)
  )
);

CREATE INDEX "AiSkillEvaluationRun_company_skill_status_created_idx"
  ON "AiSkillEvaluationRun" ("tenantId", "companyId", "skillKey", "skillVersion", "policyVersion", "status", "createdAt");
CREATE INDEX "AiSkillEvaluationRun_company_suite_created_idx"
  ON "AiSkillEvaluationRun" ("tenantId", "companyId", "suiteKey", "suiteVersion", "suiteChecksum", "createdAt");

ALTER TABLE "AiSkillEvaluationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiSkillEvaluationRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AiSkillEvaluationRun_tenant_isolation" ON "AiSkillEvaluationRun"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION "baseer_prevent_ai_skill_evaluation_run_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AiSkillEvaluationRun rows are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiSkillEvaluationRun_append_only"
  BEFORE UPDATE OR DELETE ON "AiSkillEvaluationRun"
  FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_ai_skill_evaluation_run_mutation"();
