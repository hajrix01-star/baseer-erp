-- Historical Noorix payroll evidence is intentionally isolated from the HR
-- payroll lifecycle. These tables have no foreign keys to HrPayrollRun,
-- journals, payments, employee financial movements, or employee debt tables.

CREATE TYPE "NurixHistoricalPayrollEvidenceStatus" AS ENUM ('EVIDENCE_ONLY', 'REVIEW_REQUIRED');
CREATE TYPE "NurixHistoricalPayrollPaymentEvidenceKind" AS ENUM ('NONE', 'AMOUNT_ONLY');

CREATE TABLE "NurixHistoricalPayrollEvidence" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "executionId" UUID NOT NULL,
  "sourceCompanyId" VARCHAR(120) NOT NULL,
  "sourceRunId" VARCHAR(160) NOT NULL,
  "sourceChecksum" CHAR(64) NOT NULL,
  "sourceRunNumber" VARCHAR(80) NOT NULL,
  "payrollMonth" DATE NOT NULL,
  "sourceAccruedAt" TIMESTAMPTZ(6) NOT NULL,
  "sourceStatus" VARCHAR(40) NOT NULL,
  "employeeCount" INTEGER NOT NULL,
  "grossAmount" DECIMAL(18,4) NOT NULL,
  "deductionsAmount" DECIMAL(18,4) NOT NULL,
  "appliedAdvancesAmount" DECIMAL(18,4) NOT NULL,
  "sourceAdvancesAmount" DECIMAL(18,4) NOT NULL,
  "advanceCarryoverEvidenceAmount" DECIMAL(18,4) NOT NULL,
  "netAmount" DECIMAL(18,4) NOT NULL,
  "paymentEvidenceKind" "NurixHistoricalPayrollPaymentEvidenceKind" NOT NULL DEFAULT 'NONE',
  "paymentEvidenceAmount" DECIMAL(18,4),
  "paymentEvidenceAt" TIMESTAMPTZ(6),
  "status" "NurixHistoricalPayrollEvidenceStatus" NOT NULL DEFAULT 'EVIDENCE_ONLY',
  "notes" VARCHAR(1000),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NurixHistoricalPayrollEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NurixHistoricalPayrollEvidence_id_tenantId_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "NurixHistoricalPayrollEvidence_tenantId_executionId_sourceRunId_key" UNIQUE ("tenantId", "executionId", "sourceRunId"),
  CONSTRAINT "NurixHistoricalPayrollEvidence_id_tenantId_companyId_executionId_key" UNIQUE ("id", "tenantId", "companyId", "executionId"),
  CONSTRAINT "NurixHistoricalPayrollEvidence_execution_tenant_company_fkey" FOREIGN KEY ("executionId", "tenantId", "companyId") REFERENCES "NurixExcelFinancialExecution"("id", "tenantId", "targetCompanyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixHistoricalPayrollEvidence_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixHistoricalPayrollEvidence_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixHistoricalPayrollEvidence_creator_tenant_fkey" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "NurixHistoricalPayrollEvidence_tenantId_companyId_payrollMonth_idx" ON "NurixHistoricalPayrollEvidence"("tenantId", "companyId", "payrollMonth");
CREATE INDEX "NurixHistoricalPayrollEvidence_tenantId_companyId_status_createdAt_idx" ON "NurixHistoricalPayrollEvidence"("tenantId", "companyId", "status", "createdAt");

CREATE TABLE "NurixHistoricalPayrollLineEvidence" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "executionId" UUID NOT NULL,
  "runEvidenceId" UUID NOT NULL,
  "sourceItemId" VARCHAR(160) NOT NULL,
  "sourceChecksum" CHAR(64) NOT NULL,
  "employeeSourceId" VARCHAR(160) NOT NULL,
  "employeeId" UUID,
  "grossSalary" DECIMAL(18,4) NOT NULL,
  "allowancesAdd" DECIMAL(18,4) NOT NULL,
  "deductionsAmount" DECIMAL(18,4) NOT NULL,
  "sourceAdvancesAmount" DECIMAL(18,4) NOT NULL,
  "appliedAdvancesAmount" DECIMAL(18,4) NOT NULL,
  "advanceCarryoverEvidence" DECIMAL(18,4) NOT NULL,
  "netSalary" DECIMAL(18,4) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NurixHistoricalPayrollLineEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NurixHistoricalPayrollLineEvidence_id_tenantId_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "NurixHistoricalPayrollLineEvidence_tenantId_executionId_sourceItemId_key" UNIQUE ("tenantId", "executionId", "sourceItemId"),
  CONSTRAINT "NurixHistoricalPayrollLineEvidence_run_scope_fkey" FOREIGN KEY ("runEvidenceId", "tenantId", "companyId", "executionId") REFERENCES "NurixHistoricalPayrollEvidence"("id", "tenantId", "companyId", "executionId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixHistoricalPayrollLineEvidence_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixHistoricalPayrollLineEvidence_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixHistoricalPayrollLineEvidence_employee_tenant_company_fkey" FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "NurixHistoricalPayrollLineEvidence_tenantId_companyId_runEvidenceId_idx" ON "NurixHistoricalPayrollLineEvidence"("tenantId", "companyId", "runEvidenceId");
CREATE INDEX "NurixHistoricalPayrollLineEvidence_tenantId_companyId_employeeId_idx" ON "NurixHistoricalPayrollLineEvidence"("tenantId", "companyId", "employeeId");

ALTER TABLE "NurixHistoricalPayrollEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NurixHistoricalPayrollEvidence" FORCE ROW LEVEL SECURITY;
ALTER TABLE "NurixHistoricalPayrollLineEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NurixHistoricalPayrollLineEvidence" FORCE ROW LEVEL SECURITY;

CREATE POLICY "NurixHistoricalPayrollEvidence_tenant_isolation" ON "NurixHistoricalPayrollEvidence"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "NurixHistoricalPayrollLineEvidence_tenant_isolation" ON "NurixHistoricalPayrollLineEvidence"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
