-- Attendance evidence remains append-only.  The only permitted mutation is
-- privacy retention: a complete coordinate triplet may be redacted to NULL
-- after its 14-day retention period.  No identity, time, session, QR proof,
-- request key, or audit-relevant attribute may change.
CREATE OR REPLACE FUNCTION "prevent_attendance_event_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD."id" = NEW."id"
     AND OLD."tenantId" = NEW."tenantId"
     AND OLD."companyId" = NEW."companyId"
     AND OLD."branchId" = NEW."branchId"
     AND OLD."employeeId" = NEW."employeeId"
     AND OLD."sessionId" = NEW."sessionId"
     AND OLD."eventType" = NEW."eventType"
     AND OLD."businessDate" = NEW."businessDate"
     AND OLD."occurredAt" = NEW."occurredAt"
     AND OLD."qrTokenHash" = NEW."qrTokenHash"
     AND OLD."requestKey" = NEW."requestKey"
     AND OLD."createdAt" = NEW."createdAt"
     AND OLD."latitude" IS NOT NULL
     AND OLD."longitude" IS NOT NULL
     AND OLD."accuracyMeters" IS NOT NULL
     AND NEW."latitude" IS NULL
     AND NEW."longitude" IS NULL
     AND NEW."accuracyMeters" IS NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AttendanceEvent rows are immutable; create an approved exception instead.';
END;
$$ LANGUAGE plpgsql;
