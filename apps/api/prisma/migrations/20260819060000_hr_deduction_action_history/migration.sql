CREATE TYPE "HrEmployeeAdministrativeDeductionActionType" AS ENUM ('CREATED', 'DEFERRED', 'CANCELLED', 'APPLIED', 'REVERSED');

CREATE TABLE "HrEmployeeAdministrativeDeductionAction" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "deductionId" UUID NOT NULL,
  "actionType" "HrEmployeeAdministrativeDeductionActionType" NOT NULL,
  "businessDate" DATE NOT NULL,
  "amount" DECIMAL(18,4),
  "plannedPayrollDate" DATE,
  "reason" VARCHAR(1000),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmployeeAdministrativeDeductionAction_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HrEmployeeAdministrativeDeductionAction_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "HrEmployeeAdministrativeDeductionAction_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrEmployeeAdministrativeDeductionAction_deductionId_tenantId_companyId_fkey" FOREIGN KEY ("deductionId", "tenantId", "companyId") REFERENCES "HrEmployeeAdministrativeDeduction"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "HrEmployeeAdministrativeDeductionAction_tenant_company_deduction_date_id_idx"
  ON "HrEmployeeAdministrativeDeductionAction"("tenantId", "companyId", "deductionId", "businessDate", "id");
