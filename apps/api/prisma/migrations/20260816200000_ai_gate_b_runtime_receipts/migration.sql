-- AI Gate B: make execution receipts attributable to an immutable skill and policy.
-- No provider adapter, prompt, output, conversation or external call is introduced.

ALTER TABLE "AiExecutionReceipt"
  ADD COLUMN "skillKey" VARCHAR(120),
  ADD COLUMN "skillVersion" INTEGER,
  ADD COLUMN "policyVersion" INTEGER;

ALTER TABLE "AiExecutionReceipt"
  DROP CONSTRAINT "AiExecutionReceipt_versions_positive";
ALTER TABLE "AiExecutionReceipt"
  ADD CONSTRAINT "AiExecutionReceipt_versions_positive" CHECK (
    ("configurationVersion" IS NULL OR "configurationVersion" > 0)
    AND ("identityVersion" IS NULL OR "identityVersion" > 0)
    AND ("skillVersion" IS NULL OR "skillVersion" > 0)
    AND ("policyVersion" IS NULL OR "policyVersion" > 0)
  );

CREATE INDEX "AiExecutionReceipt_tenant_company_skill_created_idx"
  ON "AiExecutionReceipt"("tenantId", "companyId", "skillKey", "createdAt");