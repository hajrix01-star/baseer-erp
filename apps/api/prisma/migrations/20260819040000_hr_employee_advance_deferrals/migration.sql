ALTER TABLE "HrEmployeeAdvance"
  ADD COLUMN "nextSettlementDate" DATE;

CREATE TABLE "HrEmployeeAdvanceDeferral" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "advanceId" UUID NOT NULL,
  "businessDate" DATE NOT NULL,
  "deferredUntil" DATE NOT NULL,
  "reason" VARCHAR(1000) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmployeeAdvanceDeferral_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HrEmployeeAdvanceDeferral_id_tenant_company_key"
  ON "HrEmployeeAdvanceDeferral"("id", "tenantId", "companyId");
CREATE INDEX "HrEmployeeAdvanceDeferral_tenant_company_advance_date_id_idx"
  ON "HrEmployeeAdvanceDeferral"("tenantId", "companyId", "advanceId", "businessDate", "id");
CREATE INDEX "HrEmployeeAdvanceDeferral_tenant_company_deferred_until_idx"
  ON "HrEmployeeAdvanceDeferral"("tenantId", "companyId", "deferredUntil");

ALTER TABLE "HrEmployeeAdvanceDeferral"
  ADD CONSTRAINT "HrEmployeeAdvanceDeferral_company_tenant_fkey"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HrEmployeeAdvanceDeferral_advance_tenant_company_fkey"
    FOREIGN KEY ("advanceId", "tenantId", "companyId") REFERENCES "HrEmployeeAdvance"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
