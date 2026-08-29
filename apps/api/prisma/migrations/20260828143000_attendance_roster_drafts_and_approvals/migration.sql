-- Dynamic attendance rosters are separate from biometric/QR attendance
-- evidence. A draft is editable; an approved roster is an effective-dated
-- planning snapshot and a permanent roster records the applied decision.
CREATE TYPE "AttendanceRosterPlanStatus" AS ENUM ('DRAFT', 'APPROVED', 'APPLIED');
CREATE TYPE "AttendanceRosterApprovalMode" AS ENUM ('WEEK', 'TEMPORARY', 'PERMANENT');

CREATE TABLE "AttendanceRosterPlan" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "weekStart" date NOT NULL,
  "status" "AttendanceRosterPlanStatus" NOT NULL DEFAULT 'DRAFT',
  "approvalMode" "AttendanceRosterApprovalMode",
  "effectiveFrom" date,
  "effectiveUntil" date,
  "revision" integer NOT NULL DEFAULT 1,
  "createdByUserId" uuid NOT NULL,
  "approvedByUserId" uuid,
  "approvedAt" timestamptz(6),
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(6) NOT NULL,
  CONSTRAINT "AttendanceRosterPlan_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceRosterPlan_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceRosterPlan_effective_range" CHECK ("effectiveUntil" IS NULL OR "effectiveFrom" IS NULL OR "effectiveUntil" >= "effectiveFrom"),
  CONSTRAINT "AttendanceRosterPlan_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AttendanceRosterPlan_tenant_company_week_status_updated_idx" ON "AttendanceRosterPlan"("tenantId", "companyId", "weekStart", "status", "updatedAt");
CREATE INDEX "AttendanceRosterPlan_tenant_company_status_effective_approved_idx" ON "AttendanceRosterPlan"("tenantId", "companyId", "status", "effectiveFrom", "effectiveUntil", "approvedAt");

CREATE TABLE "AttendanceRosterEntry" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "planId" uuid NOT NULL,
  "employeeId" uuid NOT NULL,
  "businessDate" date NOT NULL,
  "kind" "AttendanceWeeklyAdjustmentKind" NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceRosterEntry_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceRosterEntry_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceRosterEntry_plan_employee_date_key" UNIQUE ("planId", "employeeId", "businessDate"),
  CONSTRAINT "AttendanceRosterEntry_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceRosterEntry_planId_tenantId_companyId_fkey" FOREIGN KEY ("planId", "tenantId", "companyId") REFERENCES "AttendanceRosterPlan"("id", "tenantId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AttendanceRosterEntry_employeeId_tenantId_companyId_fkey" FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AttendanceRosterEntry_tenant_company_employee_date_idx" ON "AttendanceRosterEntry"("tenantId", "companyId", "employeeId", "businessDate");

CREATE TABLE "AttendanceRosterEntryPeriod" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "entryId" uuid NOT NULL,
  "startMinute" integer NOT NULL,
  "endMinute" integer NOT NULL,
  "endsNextDay" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceRosterEntryPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceRosterEntryPeriod_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceRosterEntryPeriod_start_range" CHECK ("startMinute" BETWEEN 0 AND 1439),
  CONSTRAINT "AttendanceRosterEntryPeriod_end_range" CHECK ("endMinute" BETWEEN 0 AND 1439),
  CONSTRAINT "AttendanceRosterEntryPeriod_cross_midnight" CHECK (("endsNextDay" = false AND "endMinute" > "startMinute") OR ("endsNextDay" = true AND "endMinute" < "startMinute")),
  CONSTRAINT "AttendanceRosterEntryPeriod_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceRosterEntryPeriod_entryId_tenantId_companyId_fkey" FOREIGN KEY ("entryId", "tenantId", "companyId") REFERENCES "AttendanceRosterEntry"("id", "tenantId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AttendanceRosterEntryPeriod_tenant_company_entry_start_idx" ON "AttendanceRosterEntryPeriod"("tenantId", "companyId", "entryId", "startMinute");

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseer_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE
      "AttendanceRosterPlan", "AttendanceRosterEntry", "AttendanceRosterEntryPeriod"
    TO baseer_app;
  END IF;
END $$;

DO $$ DECLARE tbl text; BEGIN
  FOREACH tbl IN ARRAY ARRAY['AttendanceRosterPlan', 'AttendanceRosterEntry', 'AttendanceRosterEntryPeriod'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)', tbl || '_tenant_isolation', tbl);
  END LOOP;
END $$;

-- Approved or applied roster history cannot be silently rewritten. Drafts
-- remain editable because they are not operational history yet.
CREATE OR REPLACE FUNCTION "prevent_finalized_attendance_roster_mutation"() RETURNS trigger AS $$
BEGIN
  IF TG_TABLE_NAME = 'AttendanceRosterPlan' AND OLD."status" <> 'DRAFT' THEN
    RAISE EXCEPTION 'Finalized attendance roster plans are immutable.';
  END IF;
  IF TG_TABLE_NAME IN ('AttendanceRosterEntry', 'AttendanceRosterEntryPeriod') AND EXISTS (
    SELECT 1 FROM "AttendanceRosterPlan" p
    WHERE p."id" = CASE WHEN TG_TABLE_NAME = 'AttendanceRosterEntry' THEN OLD."planId" ELSE (SELECT e."planId" FROM "AttendanceRosterEntry" e WHERE e."id" = OLD."entryId") END
      AND p."status" <> 'DRAFT'
  ) THEN
    RAISE EXCEPTION 'Finalized attendance roster entries are immutable.';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "AttendanceRosterPlan_finalized_immutable" BEFORE UPDATE OR DELETE ON "AttendanceRosterPlan"
FOR EACH ROW EXECUTE FUNCTION "prevent_finalized_attendance_roster_mutation"();
CREATE TRIGGER "AttendanceRosterEntry_finalized_immutable" BEFORE UPDATE OR DELETE ON "AttendanceRosterEntry"
FOR EACH ROW EXECUTE FUNCTION "prevent_finalized_attendance_roster_mutation"();
CREATE TRIGGER "AttendanceRosterEntryPeriod_finalized_immutable" BEFORE UPDATE OR DELETE ON "AttendanceRosterEntryPeriod"
FOR EACH ROW EXECUTE FUNCTION "prevent_finalized_attendance_roster_mutation"();
