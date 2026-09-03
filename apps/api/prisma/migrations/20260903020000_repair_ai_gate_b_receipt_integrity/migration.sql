-- Repair the receipt-integrity invariant in databases where the original
-- Gate B migration was recorded before its complete check expression landed.
-- This is intentionally a new migration: applied migrations are immutable.
ALTER TABLE "AiExecutionReceipt"
  DROP CONSTRAINT IF EXISTS "AiExecutionReceipt_versions_positive";

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
      OR (
        "systemIdentityId" IS NOT NULL
        AND "systemIdentityVersion" IS NOT NULL
        AND "systemIdentityVersion" > 0
      )
    )
  );
