-- Effective-dated schedule history is append-only. A correction is expressed
-- as a later-dated version/assignment/adjustment, never as an UPDATE/DELETE
-- that would silently rewrite an already evaluated workday.
CREATE OR REPLACE FUNCTION "prevent_attendance_schedule_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% rows are immutable; create a later effective-dated record instead.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'AttendanceScheduleTemplateVersion',
    'AttendanceSchedulePeriod',
    'AttendanceEmployeeScheduleAssignment',
    'AttendanceEmployeeWeeklyAdjustment',
    'AttendanceEmployeeWeeklyAdjustmentPeriod'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', tbl || '_immutable', tbl);
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION "prevent_attendance_schedule_history_mutation"()', tbl || '_immutable', tbl);
  END LOOP;
END;
$$;

-- A shared kiosk QR remains usable by different employees during its short
-- window, while this uniqueness guard consumes it once per employee identity.
CREATE TABLE "AttendanceQrScanUse" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "employeeId" uuid NOT NULL,
  "qrTokenHash" char(64) NOT NULL,
  "expiresAt" timestamptz(6) NOT NULL,
  "usedAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceQrScanUse_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceQrScanUse_company_employee_token_key" UNIQUE ("companyId", "employeeId", "qrTokenHash")
);
CREATE INDEX "AttendanceQrScanUse_tenant_company_expiry_idx" ON "AttendanceQrScanUse"("tenantId", "companyId", "expiresAt");

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseer_app') THEN
    GRANT SELECT, INSERT, DELETE ON TABLE "AttendanceQrScanUse" TO baseer_app;
  END IF;
END $$;
ALTER TABLE "AttendanceQrScanUse" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceQrScanUse" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AttendanceQrScanUse_tenant_isolation" ON "AttendanceQrScanUse"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
