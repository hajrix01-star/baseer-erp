-- Payroll snapshots the contractual-hours agreement it used. Attendance
-- schedules remain operational and cannot mutate this financial evidence.
ALTER TABLE "HrPayrollLine"
  ADD COLUMN "contractWorkTermsId" uuid,
  ADD COLUMN "contractMinutesPerDay" integer;

ALTER TABLE "HrEmployeeWorkTerms"
  ADD CONSTRAINT "HrEmployeeWorkTerms_id_tenant_company_employee_key"
    UNIQUE ("id", "tenantId", "companyId", "employeeId");

ALTER TABLE "HrPayrollLine"
  ADD CONSTRAINT "HrPayrollLine_contractMinutesPerDay_range"
    CHECK ("contractMinutesPerDay" IS NULL OR "contractMinutesPerDay" BETWEEN 30 AND 1440),
  ADD CONSTRAINT "HrPayrollLine_contractWorkTermsId_tenantId_companyId_fkey"
    FOREIGN KEY ("contractWorkTermsId", "tenantId", "companyId", "employeeId")
    REFERENCES "HrEmployeeWorkTerms"("id", "tenantId", "companyId", "employeeId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "HrPayrollLine_tenant_company_contract_terms_idx"
  ON "HrPayrollLine"("tenantId", "companyId", "contractWorkTermsId");

-- One active (pending or approved) exception is allowed for an employee and
-- business date. Rejected and cancelled history stays visible and does not
-- prevent a corrected request.
CREATE UNIQUE INDEX "AttendanceScheduleException_one_active_per_employee_date"
  ON "AttendanceScheduleException"("companyId", "employeeId", "businessDate")
  WHERE "status" IN ('PENDING', 'APPROVED');
