-- A review company may be active for normal read screens without allowing
-- operational writes. The authorization boundary enforces this flag.
ALTER TABLE "Company"
  ADD COLUMN "migrationReviewLocked" BOOLEAN NOT NULL DEFAULT false;
