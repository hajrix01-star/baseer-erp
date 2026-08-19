-- Approved leave and actual-return records. These are operational HR facts
-- only: no financial account, journal, or payroll entry is created here.
CREATE TYPE "HrEmployeeLeaveType" AS ENUM ('ANNUAL', 'SICK', 'UNPAID', 'OTHER');
CREATE TYPE "HrEmployeeLeaveStatus" AS ENUM ('APPROVED', 'RETURNED');

CREATE TABLE "HrEmployeeLeave" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "leaveType" "HrEmployeeLeaveType" NOT NULL,
  "status" "HrEmployeeLeaveStatus" NOT NULL DEFAULT 'APPROVED',
  "startDate" DATE NOT NULL,
  "endDate" DATE NOT NULL,
  "actualReturnDate" DATE,
  "notes" VARCHAR(2000),
  "approvedByUserId" UUID NOT NULL,
  "approvedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "returnedByUserId" UUID,
  "returnedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "HrEmployeeLeave_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HrEmployeeLeave_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "HrEmployeeLeave_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrEmployeeLeave_employeeId_tenantId_companyId_fkey" FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrEmployeeLeave_date_range_check" CHECK ("endDate" >= "startDate")
);

CREATE INDEX "HrEmployeeLeave_tenant_company_employee_start_end_idx"
  ON "HrEmployeeLeave"("tenantId", "companyId", "employeeId", "startDate", "endDate");
CREATE INDEX "HrEmployeeLeave_tenant_company_status_start_end_idx"
  ON "HrEmployeeLeave"("tenantId", "companyId", "status", "startDate", "endDate");
