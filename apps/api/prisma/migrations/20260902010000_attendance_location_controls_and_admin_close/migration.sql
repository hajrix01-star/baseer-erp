-- Location proof is an explicit company policy. Existing companies retain a
-- safe disabled default until their owner deliberately enables it.
ALTER TABLE "Company"
  ADD COLUMN "attendanceLocationEnabled" boolean NOT NULL DEFAULT false;

-- A disabled policy must be able to store an attendance event without any
-- device coordinates, and the retention operation clears this evidence later.
ALTER TABLE "AttendanceEvent"
  ALTER COLUMN "latitude" DROP NOT NULL,
  ALTER COLUMN "longitude" DROP NOT NULL,
  ALTER COLUMN "accuracyMeters" DROP NOT NULL;

ALTER TABLE "AttendanceEvent"
  ADD CONSTRAINT "AttendanceEvent_location_evidence_complete"
  CHECK (
    ("latitude" IS NULL AND "longitude" IS NULL AND "accuracyMeters" IS NULL)
    OR
    ("latitude" IS NOT NULL AND "longitude" IS NOT NULL AND "accuracyMeters" IS NOT NULL)
  );

-- Administrative checkout keeps the original employee check-in immutable and
-- makes the responsible actor, stated reason, and system action time explicit.
ALTER TABLE "AttendanceWorkSession"
  ADD COLUMN "adminClosedByUserId" uuid,
  ADD COLUMN "adminCloseReason" varchar(2000),
  ADD COLUMN "adminClosedAt" timestamptz(6);

ALTER TYPE "AttendanceEventType" ADD VALUE IF NOT EXISTS 'ADMIN_CHECK_OUT';

CREATE INDEX "AttendanceEvent_location_retention_idx"
  ON "AttendanceEvent" ("occurredAt")
  WHERE "latitude" IS NOT NULL OR "longitude" IS NOT NULL OR "accuracyMeters" IS NOT NULL;
