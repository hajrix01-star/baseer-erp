-- Payroll foundation: compensation snapshots, immutable line applications,
-- accrual lifecycle, and multi-vault payment receipts.
CREATE TYPE "HrPayrollRunStatus" AS ENUM ('DRAFT', 'APPROVED', 'PARTIALLY_PAID', 'PAID', 'REVERSED');

CREATE TABLE "HrEmployeeCompensationProfile" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "employeeId" uuid NOT NULL,
  "effectiveFrom" date NOT NULL,
  "effectiveTo" date,
  "monthlyGross" decimal(18,4) NOT NULL,
  "notes" varchar(1000),
  "createdByUserId" uuid NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(6) NOT NULL,
  CONSTRAINT "HrEmployeeCompensationProfile_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HrEmployeeCompensationProfile_company_employee_from_key" UNIQUE ("companyId", "employeeId", "effectiveFrom"),
  CONSTRAINT "HrEmployeeCompensationProfile_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrEmployeeCompensationProfile_employee_tenant_company_fkey" FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HrEmployeeCompensationProfile_tenant_company_employee_from_idx" ON "HrEmployeeCompensationProfile"("tenantId", "companyId", "employeeId", "effectiveFrom");

CREATE TABLE "HrPayrollRun" (
  "id" uuid NOT NULL, "tenantId" uuid NOT NULL, "companyId" uuid NOT NULL,
  "runNumber" varchar(80) NOT NULL, "payrollMonth" date NOT NULL, "businessDate" date NOT NULL,
  "status" "HrPayrollRunStatus" NOT NULL DEFAULT 'DRAFT', "employeeCount" integer NOT NULL DEFAULT 0,
  "grossAmount" decimal(18,4) NOT NULL DEFAULT 0, "advanceSettlementAmount" decimal(18,4) NOT NULL DEFAULT 0,
  "administrativeDeductionAmount" decimal(18,4) NOT NULL DEFAULT 0, "netPayableAmount" decimal(18,4) NOT NULL DEFAULT 0,
  "paidAmount" decimal(18,4) NOT NULL DEFAULT 0, "notes" varchar(2000), "accrualJournalEntryId" uuid,
  "approvedAt" timestamptz(6), "reversedAt" timestamptz(6), "reversalReason" varchar(1000),
  "createdByUserId" uuid NOT NULL, "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamptz(6) NOT NULL,
  CONSTRAINT "HrPayrollRun_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HrPayrollRun_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "HrPayrollRun_company_month_key" UNIQUE ("companyId", "payrollMonth"),
  CONSTRAINT "HrPayrollRun_company_run_number_key" UNIQUE ("companyId", "runNumber"),
  CONSTRAINT "HrPayrollRun_accrual_journal_tenant_company_key" UNIQUE ("accrualJournalEntryId", "tenantId", "companyId"),
  CONSTRAINT "HrPayrollRun_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrPayrollRun_accrual_journal_tenant_company_fkey" FOREIGN KEY ("accrualJournalEntryId", "tenantId", "companyId") REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HrPayrollRun_tenant_company_month_status_id_idx" ON "HrPayrollRun"("tenantId", "companyId", "payrollMonth", "status", "id");

CREATE TABLE "HrPayrollLine" (
  "id" uuid NOT NULL, "tenantId" uuid NOT NULL, "companyId" uuid NOT NULL, "payrollRunId" uuid NOT NULL, "employeeId" uuid NOT NULL,
  "employeeNumberSnapshot" varchar(80) NOT NULL, "employeeNameArSnapshot" varchar(160) NOT NULL, "employeeNameEnSnapshot" varchar(160),
  "grossSalary" decimal(18,4) NOT NULL, "advanceSettlementAmount" decimal(18,4) NOT NULL DEFAULT 0,
  "administrativeDeductionAmount" decimal(18,4) NOT NULL DEFAULT 0, "netPayableAmount" decimal(18,4) NOT NULL, "paidAmount" decimal(18,4) NOT NULL DEFAULT 0,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamptz(6) NOT NULL,
  CONSTRAINT "HrPayrollLine_pkey" PRIMARY KEY ("id"), CONSTRAINT "HrPayrollLine_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"), CONSTRAINT "HrPayrollLine_run_employee_key" UNIQUE ("payrollRunId", "employeeId"),
  CONSTRAINT "HrPayrollLine_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrPayrollLine_run_tenant_company_fkey" FOREIGN KEY ("payrollRunId", "tenantId", "companyId") REFERENCES "HrPayrollRun"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrPayrollLine_employee_tenant_company_fkey" FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HrPayrollLine_tenant_company_employee_run_idx" ON "HrPayrollLine"("tenantId", "companyId", "employeeId", "payrollRunId");

CREATE TABLE "HrPayrollAdvanceApplication" (
  "id" uuid NOT NULL, "tenantId" uuid NOT NULL, "companyId" uuid NOT NULL, "payrollLineId" uuid NOT NULL, "advanceId" uuid NOT NULL, "amount" decimal(18,4) NOT NULL, "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrPayrollAdvanceApplication_pkey" PRIMARY KEY ("id"), CONSTRAINT "HrPayrollAdvanceApplication_line_advance_key" UNIQUE ("payrollLineId", "advanceId"),
  CONSTRAINT "HrPayrollAdvanceApplication_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrPayrollAdvanceApplication_line_tenant_company_fkey" FOREIGN KEY ("payrollLineId", "tenantId", "companyId") REFERENCES "HrPayrollLine"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrPayrollAdvanceApplication_advance_tenant_company_fkey" FOREIGN KEY ("advanceId", "tenantId", "companyId") REFERENCES "HrEmployeeAdvance"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HrPayrollAdvanceApplication_tenant_company_advance_idx" ON "HrPayrollAdvanceApplication"("tenantId", "companyId", "advanceId");

CREATE TABLE "HrPayrollAdministrativeDeductionApplication" (
  "id" uuid NOT NULL, "tenantId" uuid NOT NULL, "companyId" uuid NOT NULL, "payrollLineId" uuid NOT NULL, "deductionId" uuid NOT NULL, "amount" decimal(18,4) NOT NULL, "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrPayrollAdministrativeDeductionApplication_pkey" PRIMARY KEY ("id"), CONSTRAINT "HrPayrollAdministrativeDeductionApplication_line_deduction_key" UNIQUE ("payrollLineId", "deductionId"),
  CONSTRAINT "HrPayrollAdministrativeDeductionApplication_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrPayrollAdministrativeDeductionApplication_line_tenant_company_fkey" FOREIGN KEY ("payrollLineId", "tenantId", "companyId") REFERENCES "HrPayrollLine"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrPayrollAdministrativeDeductionApplication_deduction_tenant_company_fkey" FOREIGN KEY ("deductionId", "tenantId", "companyId") REFERENCES "HrEmployeeAdministrativeDeduction"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HrPayrollAdministrativeDeductionApplication_tenant_company_deduction_idx" ON "HrPayrollAdministrativeDeductionApplication"("tenantId", "companyId", "deductionId");

CREATE TABLE "HrPayrollPayment" (
  "id" uuid NOT NULL, "tenantId" uuid NOT NULL, "companyId" uuid NOT NULL, "payrollRunId" uuid NOT NULL,
  "paymentNumber" varchar(80) NOT NULL, "businessDate" date NOT NULL, "amount" decimal(18,4) NOT NULL, "journalEntryId" uuid NOT NULL,
  "createdByUserId" uuid NOT NULL, "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrPayrollPayment_pkey" PRIMARY KEY ("id"), CONSTRAINT "HrPayrollPayment_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"), CONSTRAINT "HrPayrollPayment_company_number_key" UNIQUE ("companyId", "paymentNumber"), CONSTRAINT "HrPayrollPayment_journal_tenant_company_key" UNIQUE ("journalEntryId", "tenantId", "companyId"),
  CONSTRAINT "HrPayrollPayment_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrPayrollPayment_run_tenant_company_fkey" FOREIGN KEY ("payrollRunId", "tenantId", "companyId") REFERENCES "HrPayrollRun"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrPayrollPayment_journal_tenant_company_fkey" FOREIGN KEY ("journalEntryId", "tenantId", "companyId") REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HrPayrollPayment_tenant_company_run_date_id_idx" ON "HrPayrollPayment"("tenantId", "companyId", "payrollRunId", "businessDate", "id");

CREATE TABLE "HrPayrollPaymentAllocation" (
  "id" uuid NOT NULL, "tenantId" uuid NOT NULL, "companyId" uuid NOT NULL, "payrollPaymentId" uuid NOT NULL, "vaultId" uuid NOT NULL,
  "paymentMethod" "FinanceVaultPaymentMethod" NOT NULL, "amount" decimal(18,4) NOT NULL, "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrPayrollPaymentAllocation_pkey" PRIMARY KEY ("id"), CONSTRAINT "HrPayrollPaymentAllocation_payment_vault_method_key" UNIQUE ("payrollPaymentId", "vaultId", "paymentMethod"),
  CONSTRAINT "HrPayrollPaymentAllocation_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrPayrollPaymentAllocation_payment_tenant_company_fkey" FOREIGN KEY ("payrollPaymentId", "tenantId", "companyId") REFERENCES "HrPayrollPayment"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrPayrollPaymentAllocation_vault_tenant_company_fkey" FOREIGN KEY ("vaultId", "tenantId", "companyId") REFERENCES "FinanceVault"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HrPayrollPaymentAllocation_tenant_company_vault_created_idx" ON "HrPayrollPaymentAllocation"("tenantId", "companyId", "vaultId", "createdAt");
