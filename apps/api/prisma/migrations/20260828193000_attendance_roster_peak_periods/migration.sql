-- Peak periods express operational demand inside a roster only.  They are
-- neither attendance evidence nor a payroll/overtime input.
CREATE TABLE "AttendanceRosterPeakPeriod" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "planId" uuid NOT NULL,
  "businessDate" date NOT NULL,
  "startMinute" integer NOT NULL,
  "endMinute" integer NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceRosterPeakPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceRosterPeakPeriod_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceRosterPeakPeriod_plan_date_start_end_key" UNIQUE ("planId", "businessDate", "startMinute", "endMinute"),
  CONSTRAINT "AttendanceRosterPeakPeriod_range" CHECK ("startMinute" >= 0 AND "endMinute" > "startMinute" AND "endMinute" <= 2880),
  CONSTRAINT "AttendanceRosterPeakPeriod_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceRosterPeakPeriod_planId_tenantId_companyId_fkey" FOREIGN KEY ("planId", "tenantId", "companyId") REFERENCES "AttendanceRosterPlan"("id", "tenantId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AttendanceRosterPeakPeriod_tenant_company_date_idx" ON "AttendanceRosterPeakPeriod"("tenantId", "companyId", "businessDate");

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseer_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "AttendanceRosterPeakPeriod" TO baseer_app;
  END IF;
END $$;

ALTER TABLE "AttendanceRosterPeakPeriod" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AttendanceRosterPeakPeriod" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AttendanceRosterPeakPeriod_tenant_isolation" ON "AttendanceRosterPeakPeriod"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION "prevent_finalized_attendance_roster_peak_mutation"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "AttendanceRosterPlan" WHERE "id" = OLD."planId" AND "status" <> 'DRAFT') THEN
    RAISE EXCEPTION 'Finalized attendance roster peak periods are immutable.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AttendanceRosterPeakPeriod_finalized_immutable" BEFORE UPDATE OR DELETE ON "AttendanceRosterPeakPeriod"
FOR EACH ROW EXECUTE FUNCTION "prevent_finalized_attendance_roster_peak_mutation"();
