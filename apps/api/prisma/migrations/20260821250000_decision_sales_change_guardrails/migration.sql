-- Commercial alerts require company-owned materiality and repetition guards.
-- Null keeps legacy policies disabled until a manager explicitly configures it.

ALTER TABLE "DecisionSalesChangePolicy"
  ADD COLUMN "minimumBaselineAmount" DECIMAL(18, 4),
  ADD COLUMN "minimumAbsoluteDifferenceAmount" DECIMAL(18, 4),
  ADD COLUMN "cooldownHours" INTEGER;

ALTER TABLE "DecisionSalesChangePolicy"
  ADD CONSTRAINT "DecisionSalesChangePolicy_minimum_baseline_check"
    CHECK ("minimumBaselineAmount" IS NULL OR "minimumBaselineAmount" > 0),
  ADD CONSTRAINT "DecisionSalesChangePolicy_minimum_difference_check"
    CHECK ("minimumAbsoluteDifferenceAmount" IS NULL OR "minimumAbsoluteDifferenceAmount" > 0),
  ADD CONSTRAINT "DecisionSalesChangePolicy_cooldown_check"
    CHECK ("cooldownHours" IS NULL OR "cooldownHours" BETWEEN 1 AND 720),
  ADD CONSTRAINT "DecisionSalesChangePolicy_enabled_guardrails_check"
    CHECK (NOT "enabled" OR (
      "decreaseThresholdBasisPoints" IS NOT NULL
      AND "increaseThresholdBasisPoints" IS NOT NULL
      AND "minimumBaselineAmount" IS NOT NULL
      AND "minimumAbsoluteDifferenceAmount" IS NOT NULL
      AND "cooldownHours" IS NOT NULL
    ));
