-- Effective-dated attendance schedules.  Template versions and employee
-- assignments are append-only so changing future hours cannot rewrite prior
-- attendance interpretation.
CREATE TYPE "AttendanceScheduleTemplateStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "AttendanceWeeklyAdjustmentKind" AS ENUM ('FULL_REST', 'CUSTOM_PERIODS');
CREATE TYPE "AttendanceScheduleExceptionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

CREATE TABLE "AttendanceScheduleTemplate" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "nameAr" varchar(160) NOT NULL,
  "nameEn" varchar(160),
  "status" "AttendanceScheduleTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
  "archivedAt" timestamptz(6),
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(6) NOT NULL,
  CONSTRAINT "AttendanceScheduleTemplate_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceScheduleTemplate_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceScheduleTemplate_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AttendanceScheduleTemplate_tenant_company_status_name_idx" ON "AttendanceScheduleTemplate"("tenantId", "companyId", "status", "nameAr");

CREATE TABLE "AttendanceScheduleTemplateVersion" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "templateId" uuid NOT NULL,
  "versionNumber" integer NOT NULL,
  "effectiveFrom" date NOT NULL,
  "createdByUserId" uuid NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceScheduleTemplateVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceScheduleTemplateVersion_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceScheduleTemplateVersion_templateId_versionNumber_key" UNIQUE ("templateId", "versionNumber"),
  CONSTRAINT "AttendanceScheduleTemplateVersion_templateId_effectiveFrom_key" UNIQUE ("templateId", "effectiveFrom"),
  CONSTRAINT "AttendanceScheduleTemplateVersion_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceScheduleTemplateVersion_templateId_tenantId_companyId_fkey" FOREIGN KEY ("templateId", "tenantId", "companyId") REFERENCES "AttendanceScheduleTemplate"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AttendanceScheduleTemplateVersion_tenant_company_template_effective_idx" ON "AttendanceScheduleTemplateVersion"("tenantId", "companyId", "templateId", "effectiveFrom");

CREATE TABLE "AttendanceSchedulePeriod" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "versionId" uuid NOT NULL,
  "dayOfWeek" integer NOT NULL,
  "startMinute" integer NOT NULL,
  "endMinute" integer NOT NULL,
  "endsNextDay" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceSchedulePeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceSchedulePeriod_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceSchedulePeriod_day_range" CHECK ("dayOfWeek" BETWEEN 1 AND 7),
  CONSTRAINT "AttendanceSchedulePeriod_start_range" CHECK ("startMinute" BETWEEN 0 AND 1439),
  CONSTRAINT "AttendanceSchedulePeriod_end_range" CHECK ("endMinute" BETWEEN 0 AND 1439),
  CONSTRAINT "AttendanceSchedulePeriod_not_empty" CHECK ("startMinute" <> "endMinute"),
  CONSTRAINT "AttendanceSchedulePeriod_cross_midnight" CHECK (("endsNextDay" = false AND "endMinute" > "startMinute") OR ("endsNextDay" = true AND "endMinute" < "startMinute")),
  CONSTRAINT "AttendanceSchedulePeriod_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceSchedulePeriod_versionId_tenantId_companyId_fkey" FOREIGN KEY ("versionId", "tenantId", "companyId") REFERENCES "AttendanceScheduleTemplateVersion"("id", "tenantId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AttendanceSchedulePeriod_tenant_company_version_day_start_idx" ON "AttendanceSchedulePeriod"("tenantId", "companyId", "versionId", "dayOfWeek", "startMinute");

CREATE TABLE "AttendanceEmployeeScheduleAssignment" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "employeeId" uuid NOT NULL,
  "templateId" uuid NOT NULL,
  "effectiveFrom" date NOT NULL,
  "createdByUserId" uuid NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceEmployeeScheduleAssignment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceEmployeeScheduleAssignment_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceEmployeeScheduleAssignment_employeeId_effectiveFrom_key" UNIQUE ("employeeId", "effectiveFrom"),
  CONSTRAINT "AttendanceEmployeeScheduleAssignment_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceEmployeeScheduleAssignment_employeeId_tenantId_companyId_fkey" FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceEmployeeScheduleAssignment_templateId_tenantId_companyId_fkey" FOREIGN KEY ("templateId", "tenantId", "companyId") REFERENCES "AttendanceScheduleTemplate"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AttendanceEmployeeScheduleAssignment_tenant_company_employee_effective_idx" ON "AttendanceEmployeeScheduleAssignment"("tenantId", "companyId", "employeeId", "effectiveFrom");

CREATE TABLE "AttendanceEmployeeWeeklyAdjustment" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "employeeId" uuid NOT NULL,
  "dayOfWeek" integer NOT NULL,
  "effectiveFrom" date NOT NULL,
  "kind" "AttendanceWeeklyAdjustmentKind" NOT NULL,
  "createdByUserId" uuid NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceEmployeeWeeklyAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceEmployeeWeeklyAdjustment_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceEmployeeWeeklyAdjustment_employee_day_effective_key" UNIQUE ("employeeId", "dayOfWeek", "effectiveFrom"),
  CONSTRAINT "AttendanceEmployeeWeeklyAdjustment_day_range" CHECK ("dayOfWeek" BETWEEN 1 AND 7),
  CONSTRAINT "AttendanceEmployeeWeeklyAdjustment_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceEmployeeWeeklyAdjustment_employeeId_tenantId_companyId_fkey" FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AttendanceEmployeeWeeklyAdjustment_tenant_company_employee_day_effective_idx" ON "AttendanceEmployeeWeeklyAdjustment"("tenantId", "companyId", "employeeId", "dayOfWeek", "effectiveFrom");

CREATE TABLE "AttendanceEmployeeWeeklyAdjustmentPeriod" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "adjustmentId" uuid NOT NULL,
  "startMinute" integer NOT NULL,
  "endMinute" integer NOT NULL,
  "endsNextDay" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceEmployeeWeeklyAdjustmentPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceEmployeeWeeklyAdjustmentPeriod_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceEmployeeWeeklyAdjustmentPeriod_start_range" CHECK ("startMinute" BETWEEN 0 AND 1439),
  CONSTRAINT "AttendanceEmployeeWeeklyAdjustmentPeriod_end_range" CHECK ("endMinute" BETWEEN 0 AND 1439),
  CONSTRAINT "AttendanceEmployeeWeeklyAdjustmentPeriod_cross_midnight" CHECK (("endsNextDay" = false AND "endMinute" > "startMinute") OR ("endsNextDay" = true AND "endMinute" < "startMinute")),
  CONSTRAINT "AttendanceEmployeeWeeklyAdjustmentPeriod_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceEmployeeWeeklyAdjustmentPeriod_adjustmentId_tenantId_companyId_fkey" FOREIGN KEY ("adjustmentId", "tenantId", "companyId") REFERENCES "AttendanceEmployeeWeeklyAdjustment"("id", "tenantId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AttendanceEmployeeWeeklyAdjustmentPeriod_tenant_company_adjustment_start_idx" ON "AttendanceEmployeeWeeklyAdjustmentPeriod"("tenantId", "companyId", "adjustmentId", "startMinute");

CREATE TABLE "AttendanceScheduleException" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "employeeId" uuid NOT NULL,
  "businessDate" date NOT NULL,
  "kind" "AttendanceWeeklyAdjustmentKind" NOT NULL,
  "status" "AttendanceScheduleExceptionStatus" NOT NULL DEFAULT 'PENDING',
  "reason" varchar(2000) NOT NULL,
  "requestedByUserId" uuid NOT NULL,
  "decidedByUserId" uuid,
  "decidedAt" timestamptz(6),
  "decisionNote" varchar(2000),
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(6) NOT NULL,
  CONSTRAINT "AttendanceScheduleException_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceScheduleException_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceScheduleException_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceScheduleException_employeeId_tenantId_companyId_fkey" FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AttendanceScheduleException_tenant_company_employee_date_status_idx" ON "AttendanceScheduleException"("tenantId", "companyId", "employeeId", "businessDate", "status");

CREATE TABLE "AttendanceScheduleExceptionPeriod" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "exceptionId" uuid NOT NULL,
  "startMinute" integer NOT NULL,
  "endMinute" integer NOT NULL,
  "endsNextDay" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceScheduleExceptionPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceScheduleExceptionPeriod_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceScheduleExceptionPeriod_start_range" CHECK ("startMinute" BETWEEN 0 AND 1439),
  CONSTRAINT "AttendanceScheduleExceptionPeriod_end_range" CHECK ("endMinute" BETWEEN 0 AND 1439),
  CONSTRAINT "AttendanceScheduleExceptionPeriod_cross_midnight" CHECK (("endsNextDay" = false AND "endMinute" > "startMinute") OR ("endsNextDay" = true AND "endMinute" < "startMinute")),
  CONSTRAINT "AttendanceScheduleExceptionPeriod_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceScheduleExceptionPeriod_exceptionId_tenantId_companyId_fkey" FOREIGN KEY ("exceptionId", "tenantId", "companyId") REFERENCES "AttendanceScheduleException"("id", "tenantId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AttendanceScheduleExceptionPeriod_tenant_company_exception_start_idx" ON "AttendanceScheduleExceptionPeriod"("tenantId", "companyId", "exceptionId", "startMinute");

-- Operational workday makes cross-midnight check-outs report against the day
-- on which the session opened. Existing evidence is backfilled in Riyadh time.
ALTER TABLE "AttendanceWorkSession" ADD COLUMN "businessDate" date;
UPDATE "AttendanceWorkSession" SET "businessDate" = ("checkInAt" AT TIME ZONE 'Asia/Riyadh')::date WHERE "businessDate" IS NULL;
ALTER TABLE "AttendanceWorkSession" ALTER COLUMN "businessDate" SET NOT NULL;
CREATE INDEX "AttendanceWorkSession_tenant_company_workday_employee_idx" ON "AttendanceWorkSession"("tenantId", "companyId", "businessDate", "employeeId");
ALTER TABLE "AttendanceEvent" ADD COLUMN "businessDate" date;
UPDATE "AttendanceEvent" event SET "businessDate" = session."businessDate" FROM "AttendanceWorkSession" session WHERE event."sessionId" = session."id" AND event."businessDate" IS NULL;
ALTER TABLE "AttendanceEvent" ALTER COLUMN "businessDate" SET NOT NULL;

-- Give the application role access, then apply the same tenant boundary as
-- existing attendance records. Child period rows are only ever written as part
-- of a new immutable parent snapshot.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseer_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      "AttendanceScheduleTemplate", "AttendanceScheduleTemplateVersion", "AttendanceSchedulePeriod",
      "AttendanceEmployeeScheduleAssignment", "AttendanceEmployeeWeeklyAdjustment", "AttendanceEmployeeWeeklyAdjustmentPeriod",
      "AttendanceScheduleException", "AttendanceScheduleExceptionPeriod"
    TO baseer_app;
  END IF;
END $$;

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'AttendanceScheduleTemplate', 'AttendanceScheduleTemplateVersion', 'AttendanceSchedulePeriod',
    'AttendanceEmployeeScheduleAssignment', 'AttendanceEmployeeWeeklyAdjustment', 'AttendanceEmployeeWeeklyAdjustmentPeriod',
    'AttendanceScheduleException', 'AttendanceScheduleExceptionPeriod'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)', tbl || '_tenant_isolation', tbl);
  END LOOP;
END $$;

-- Attendance event evidence is append-only. Managers use exceptions rather
-- than editing coordinates, timestamps or QR proofs in place.
CREATE OR REPLACE FUNCTION "prevent_attendance_event_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AttendanceEvent rows are immutable; create an approved exception instead.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AttendanceEvent_immutable" BEFORE UPDATE OR DELETE ON "AttendanceEvent"
FOR EACH ROW EXECUTE FUNCTION "prevent_attendance_event_mutation"();
