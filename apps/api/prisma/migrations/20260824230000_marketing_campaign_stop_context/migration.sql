-- A stop is business context, not a deletion. It keeps the original campaign
-- record auditable and makes the effective final day available to analysis.
ALTER TABLE "MarketingCampaign"
  ADD COLUMN "stoppedOn" DATE,
  ADD COLUMN "stoppedReason" VARCHAR(500),
  ADD CONSTRAINT "MarketingCampaign_stop_reason_check"
    CHECK (("stoppedOn" IS NULL AND "stoppedReason" IS NULL)
      OR ("stoppedOn" IS NOT NULL AND "stoppedReason" IS NOT NULL AND length(trim("stoppedReason")) > 0)),
  ADD CONSTRAINT "MarketingCampaign_stop_after_start_check"
    CHECK ("stoppedOn" IS NULL OR "startsOn" IS NULL OR "stoppedOn" >= "startsOn");
