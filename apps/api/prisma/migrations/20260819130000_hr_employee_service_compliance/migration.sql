CREATE TYPE "HrEmployeeServiceComplianceStatus" AS ENUM ('ACTIVE', 'RENEWED', 'CANCELLED');

ALTER TABLE "HrEmployeeService"
  ADD COLUMN "visaDurationMonths" SMALLINT,
  ADD COLUMN "renewalOfServiceId" UUID,
  ADD COLUMN "complianceStatus" "HrEmployeeServiceComplianceStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "HrEmployeeService_tenant_company_employee_compliance_expiry_idx"
  ON "HrEmployeeService"("tenantId", "companyId", "employeeId", "complianceStatus", "expiryDate");

CREATE INDEX "HrEmployeeService_tenant_company_renewal_idx"
  ON "HrEmployeeService"("tenantId", "companyId", "renewalOfServiceId");
