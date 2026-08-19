CREATE TABLE "HrEmployeePromotion" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "previousJobTitle" VARCHAR(160),
    "newJobTitle" VARCHAR(160) NOT NULL,
    "decisionReference" VARCHAR(240) NOT NULL,
    "reason" VARCHAR(2000),
    "createdByUserId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HrEmployeePromotion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HrEmployeePromotion_id_tenant_company_key"
  ON "HrEmployeePromotion"("id", "tenantId", "companyId");
CREATE UNIQUE INDEX "HrEmployeePromotion_company_employee_date_reference_key"
  ON "HrEmployeePromotion"("companyId", "employeeId", "effectiveDate", "decisionReference");
CREATE INDEX "HrEmployeePromotion_tenant_company_employee_date_id_idx"
  ON "HrEmployeePromotion"("tenantId", "companyId", "employeeId", "effectiveDate", "id");

ALTER TABLE "HrEmployeePromotion"
  ADD CONSTRAINT "HrEmployeePromotion_company_tenant_fkey"
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HrEmployeePromotion"
  ADD CONSTRAINT "HrEmployeePromotion_employee_tenant_company_fkey"
  FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
