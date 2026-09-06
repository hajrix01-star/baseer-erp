ALTER TABLE "AiBudgetReservation"
  DROP CONSTRAINT "AiBudgetReservation_lifecycle_consistent";

ALTER TABLE "AiBudgetReservation"
  ADD CONSTRAINT "AiBudgetReservation_lifecycle_consistent" CHECK (
    ("status" = 'RESERVED' AND "actualCostUsd" IS NULL AND "settledAt" IS NULL AND "releasedAt" IS NULL AND "releaseReason" IS NULL AND "expiresAt" > "createdAt")
    OR ("status" = 'SETTLED' AND "actualCostUsd" IS NOT NULL AND "settledAt" IS NOT NULL AND "releasedAt" IS NULL AND "releaseReason" IS NULL)
    OR ("status" IN ('RELEASED', 'EXPIRED') AND "actualCostUsd" IS NULL AND "settledAt" IS NULL AND "releasedAt" IS NOT NULL AND length(trim(COALESCE("releaseReason", ''))) > 0)
    OR ("status" = 'UNKNOWN_PROVIDER_OUTCOME' AND "actualCostUsd" IS NULL AND "settledAt" IS NULL AND "releasedAt" IS NOT NULL AND length(trim(COALESCE("releaseReason", ''))) > 0)
  );
