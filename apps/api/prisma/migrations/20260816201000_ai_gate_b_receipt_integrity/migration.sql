-- AI Gate B hardening: preserve immutable policy/system identity lineage and
-- reject incomplete skill metadata while retaining legacy Gate A receipts.
ALTER TABLE "AiExecutionReceipt"
  ADD COLUMN "systemIdentityId" UUID,
  ADD COLUMN "systemIdentityVersion" INTEGER;

ALTER TABLE "AiExecutionReceipt"
  ADD CONSTRAINT "AiExecutionReceipt_system_identity_fk"
  FOREIGN KEY ("systemIdentityId", "tenantId")
  REFERENCES "AiSystemIdentity"("id", "tenantId") ON DELETE RESTRICT;

ALTER TABLE "AiExecutionReceipt"
  DROP CONSTRAINT "AiExecutionReceipt_versions_positive";
ALTER TABLE "AiExecutionReceipt"
  ADD CONSTRAINT "AiExecutionReceipt_versions_positive" CHECK (
    ("configurationVersion" IS NULL OR "configurationVersion" > 0)
    AND ("identityVersion" IS NULL OR "identityVersion" > 0)
    AND ("systemIdentityVersion" IS NULL OR "systemIdentityVersion" > 0)
    AND (
      ("skillKey" IS NULL AND "skillVersion" IS NULL AND "policyVersion" IS NULL)
      OR (
        "skillKey" IS NOT NULL AND length(trim("skillKey")) > 0
        AND "skillVersion" IS NOT NULL AND "skillVersion" > 0
        AND "policyVersion" IS NOT NULL AND "policyVersion" > 0
      )
    )
    AND (
      ("systemIdentityId" IS NULL AND "systemIdentityVersion" IS NULL)
      OR ("systemIdentityId" IS NOT NULL AND "systemIdentityVersion" IS NOT NULL AND "systemIdentityVersion" > 0)
    )
  );

CREATE INDEX "AiExecutionReceipt_tenant_system_identity_created_idx"
  ON "AiExecutionReceipt"("tenantId", "systemIdentityId", "createdAt");