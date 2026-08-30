-- Record the dated reason for a non-operational employee state without
-- inventing historical values for legacy imported employee records.
ALTER TABLE "HrEmployee"
  ADD COLUMN "statusEffectiveAt" date,
  ADD COLUMN "statusReason" varchar(240);

-- Existing termination dates are authoritative and can safely seed the
-- generic status date. Reasons remain null until supplied by a user/source.
UPDATE "HrEmployee"
SET "statusEffectiveAt" = "terminatedAt"
WHERE "statusEffectiveAt" IS NULL AND "terminatedAt" IS NOT NULL;
