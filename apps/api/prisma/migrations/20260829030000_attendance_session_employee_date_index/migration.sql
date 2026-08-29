-- Employee-specific attendance reports and employee-portal commitment use
-- this order.  The existing date-first index remains optimal for company-wide
-- daily coverage and reports.
CREATE INDEX "AttendanceWorkSession_tenantId_companyId_employeeId_businessDate_idx"
  ON "AttendanceWorkSession"("tenantId", "companyId", "employeeId", "businessDate");
