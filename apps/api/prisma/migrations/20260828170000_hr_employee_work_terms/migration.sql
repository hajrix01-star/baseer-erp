-- Contractual work hours have one owner: the effective-dated HR work terms.
-- Attendance schedules decide *when* an employee works; payroll and
-- attendance may read these terms, but neither keeps a second agreement.
CREATE TABLE "HrEmployeeWorkTerms" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "employeeId" uuid NOT NULL,
  "effectiveFrom" date NOT NULL,
  "effectiveTo" date,
  "workMinutesPerDay" integer NOT NULL,
  "notes" varchar(1000),
  "createdByUserId" uuid NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(6) NOT NULL,
  CONSTRAINT "HrEmployeeWorkTerms_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HrEmployeeWorkTerms_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "HrEmployeeWorkTerms_companyId_employeeId_effectiveFrom_key" UNIQUE ("companyId", "employeeId", "effectiveFrom"),
  CONSTRAINT "HrEmployeeWorkTerms_minutes_range" CHECK ("workMinutesPerDay" BETWEEN 30 AND 1440),
  CONSTRAINT "HrEmployeeWorkTerms_date_range" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  CONSTRAINT "HrEmployeeWorkTerms_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrEmployeeWorkTerms_employeeId_tenantId_companyId_fkey" FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HrEmployeeWorkTerms_tenant_company_employee_effective_idx"
  ON "HrEmployeeWorkTerms"("tenantId", "companyId", "employeeId", "effectiveFrom");

-- The application serializes one employee's agreements and closes only the
-- directly preceding agreement. This trigger is a second line of defence
-- against overlap without requiring a database-extension privilege.
CREATE OR REPLACE FUNCTION "assert_hr_employee_work_terms_no_overlap"() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "HrEmployeeWorkTerms" existing
    WHERE existing."companyId" = NEW."companyId"
      AND existing."employeeId" = NEW."employeeId"
      AND existing."id" <> NEW."id"
      AND daterange(existing."effectiveFrom", COALESCE(existing."effectiveTo", 'infinity'::date), '[]')
          && daterange(NEW."effectiveFrom", COALESCE(NEW."effectiveTo", 'infinity'::date), '[]')
  ) THEN
    RAISE EXCEPTION 'HrEmployeeWorkTerms agreements cannot overlap for one employee.';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "HrEmployeeWorkTerms_no_overlap"
  BEFORE INSERT OR UPDATE ON "HrEmployeeWorkTerms"
  FOR EACH ROW EXECUTE FUNCTION "assert_hr_employee_work_terms_no_overlap"();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseer_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE "HrEmployeeWorkTerms" TO baseer_app;
  END IF;
END $$;

ALTER TABLE "HrEmployeeWorkTerms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "HrEmployeeWorkTerms" FORCE ROW LEVEL SECURITY;
CREATE POLICY "HrEmployeeWorkTerms_tenant_isolation" ON "HrEmployeeWorkTerms" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
