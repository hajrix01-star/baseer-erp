CREATE TYPE "HrEmployeeAdministrativeDeductionStatus" AS ENUM ('OPEN', 'PARTIALLY_APPLIED', 'APPLIED', 'DEFERRED', 'CANCELLED');

CREATE TABLE "HrEmployeeAdministrativeDeduction" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "deductionNumber" VARCHAR(80) NOT NULL,
  "businessDate" DATE NOT NULL,
  "originalAmount" DECIMAL(18,4) NOT NULL,
  "appliedAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "remainingAmount" DECIMAL(18,4) NOT NULL,
  "status" "HrEmployeeAdministrativeDeductionStatus" NOT NULL DEFAULT 'OPEN',
  "plannedPayrollDate" DATE,
  "description" VARCHAR(1000) NOT NULL,
  "cancellationReason" VARCHAR(1000),
  "cancelledAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "HrEmployeeAdministrativeDeduction_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HrEmployeeAdministrativeDeduction_id_tenant_company_key"
  ON "HrEmployeeAdministrativeDeduction"("id", "tenantId", "companyId");
CREATE UNIQUE INDEX "HrEmployeeAdministrativeDeduction_company_number_key"
  ON "HrEmployeeAdministrativeDeduction"("companyId", "deductionNumber");
CREATE INDEX "HrEmployeeAdministrativeDeduction_tenant_company_employee_status_date_id_idx"
  ON "HrEmployeeAdministrativeDeduction"("tenantId", "companyId", "employeeId", "status", "businessDate", "id");
CREATE INDEX "HrEmployeeAdministrativeDeduction_tenant_company_status_planned_date_idx"
  ON "HrEmployeeAdministrativeDeduction"("tenantId", "companyId", "status", "plannedPayrollDate");

ALTER TABLE "HrEmployeeAdministrativeDeduction"
  ADD CONSTRAINT "HrEmployeeAdministrativeDeduction_company_tenant_fkey"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HrEmployeeAdministrativeDeduction_employee_tenant_company_fkey"
    FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
