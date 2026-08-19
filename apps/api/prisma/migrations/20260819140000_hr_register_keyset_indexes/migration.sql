-- Keeps HR operational registers page-able as employee and history volumes grow.
CREATE INDEX "HrEmployee_tenantId_companyId_employeeNumber_id_idx"
  ON "HrEmployee"("tenantId", "companyId", "employeeNumber", "id");

CREATE INDEX "HrEmployee_status_number_id_idx"
  ON "HrEmployee"("tenantId", "companyId", "status", "employeeNumber", "id");

CREATE INDEX "HrEmployeeAdvance_tenantId_companyId_status_businessDate_id_idx"
  ON "HrEmployeeAdvance"("tenantId", "companyId", "status", "businessDate" DESC, "id" DESC);

CREATE INDEX "HrEmpDed_status_date_id_idx"
  ON "HrEmployeeAdministrativeDeduction"("tenantId", "companyId", "status", "businessDate" DESC, "id" DESC);

CREATE INDEX "HrPayrollRun_tenantId_companyId_status_payrollMonth_id_idx"
  ON "HrPayrollRun"("tenantId", "companyId", "status", "payrollMonth" DESC, "id" DESC);
