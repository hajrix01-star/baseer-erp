CREATE TYPE "HrEmployeeStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'TERMINATED', 'ARCHIVED');
CREATE TYPE "HrEmployeeServiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');
CREATE TYPE "HrEmployeeFinancialMovementType" AS ENUM ('SERVICE_COST', 'PAYROLL_ACCRUAL', 'PAYROLL_PAYMENT', 'ADVANCE_ISSUED', 'ADVANCE_SETTLEMENT');

CREATE TABLE "HrEmployee" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "employeeNumber" VARCHAR(80) NOT NULL,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160),
  "jobTitle" VARCHAR(160),
  "phone" VARCHAR(30),
  "email" VARCHAR(254),
  "hireDate" DATE NOT NULL,
  "status" "HrEmployeeStatus" NOT NULL DEFAULT 'ACTIVE',
  "terminatedAt" DATE,
  "notes" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "HrEmployee_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrEmployeeService" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "serviceType" VARCHAR(80) NOT NULL,
  "referenceNumber" VARCHAR(160),
  "issueDate" DATE,
  "expiryDate" DATE,
  "supplierId" UUID,
  "categoryId" UUID,
  "outflowDocumentId" UUID,
  "status" "HrEmployeeServiceStatus" NOT NULL DEFAULT 'DRAFT',
  "notes" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "HrEmployeeService_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrEmployeeFinancialMovement" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "journalEntryId" UUID NOT NULL,
  "movementType" "HrEmployeeFinancialMovementType" NOT NULL,
  "businessDate" DATE NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "sourceReference" VARCHAR(160) NOT NULL,
  "description" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmployeeFinancialMovement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HrEmployee_id_tenantId_companyId_key" ON "HrEmployee"("id", "tenantId", "companyId");
CREATE UNIQUE INDEX "HrEmployee_companyId_employeeNumber_key" ON "HrEmployee"("companyId", "employeeNumber");
CREATE INDEX "HrEmployee_tenant_company_status_name_idx" ON "HrEmployee"("tenantId", "companyId", "status", "nameAr");

CREATE UNIQUE INDEX "HrEmployeeService_id_tenantId_companyId_key" ON "HrEmployeeService"("id", "tenantId", "companyId");
CREATE UNIQUE INDEX "HrEmployeeService_outflowDocumentId_tenantId_companyId_key" ON "HrEmployeeService"("outflowDocumentId", "tenantId", "companyId");
CREATE INDEX "HrEmployeeService_tenant_company_employee_status_expiry_idx" ON "HrEmployeeService"("tenantId", "companyId", "employeeId", "status", "expiryDate");
CREATE INDEX "HrEmployeeService_tenant_company_service_status_idx" ON "HrEmployeeService"("tenantId", "companyId", "serviceType", "status");

CREATE UNIQUE INDEX "HrEmployeeFinancialMovement_id_tenantId_companyId_key" ON "HrEmployeeFinancialMovement"("id", "tenantId", "companyId");
CREATE UNIQUE INDEX "HrEmployeeFinancialMovement_employee_journal_type_key" ON "HrEmployeeFinancialMovement"("employeeId", "journalEntryId", "movementType");
CREATE INDEX "HrEmployeeFinancialMovement_tenant_company_employee_date_id_idx" ON "HrEmployeeFinancialMovement"("tenantId", "companyId", "employeeId", "businessDate", "id");
CREATE INDEX "HrEmployeeFinancialMovement_tenant_company_journal_idx" ON "HrEmployeeFinancialMovement"("tenantId", "companyId", "journalEntryId");

ALTER TABLE "HrEmployee"
  ADD CONSTRAINT "HrEmployee_company_tenant_fkey"
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HrEmployeeService"
  ADD CONSTRAINT "HrEmployeeService_company_tenant_fkey"
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HrEmployeeService_employee_tenant_company_fkey"
  FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HrEmployeeService_supplier_tenant_company_fkey"
  FOREIGN KEY ("supplierId", "tenantId", "companyId") REFERENCES "FinanceSupplier"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HrEmployeeService_category_tenant_company_fkey"
  FOREIGN KEY ("categoryId", "tenantId", "companyId") REFERENCES "FinanceCategory"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HrEmployeeService_outflow_tenant_company_fkey"
  FOREIGN KEY ("outflowDocumentId", "tenantId", "companyId") REFERENCES "FinanceOutflowDocument"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HrEmployeeFinancialMovement"
  ADD CONSTRAINT "HrEmployeeFinancialMovement_company_tenant_fkey"
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HrEmployeeFinancialMovement_employee_tenant_company_fkey"
  FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HrEmployeeFinancialMovement_journal_tenant_company_fkey"
  FOREIGN KEY ("journalEntryId", "tenantId", "companyId") REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
