CREATE TYPE "HrEmployeeAdvanceStatus" AS ENUM ('ISSUED', 'PARTIALLY_SETTLED', 'SETTLED', 'REVERSED');
CREATE TYPE "HrEmployeeAdvanceSettlementSource" AS ENUM ('PAYROLL', 'MANUAL_RECEIPT');

CREATE TABLE "HrEmployeeAdvance" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "employeeId" UUID NOT NULL,
  "advanceNumber" VARCHAR(80) NOT NULL,
  "businessDate" DATE NOT NULL,
  "originalAmount" DECIMAL(18,4) NOT NULL,
  "settledAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "remainingAmount" DECIMAL(18,4) NOT NULL,
  "status" "HrEmployeeAdvanceStatus" NOT NULL DEFAULT 'ISSUED',
  "notes" VARCHAR(2000),
  "issueJournalEntryId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "HrEmployeeAdvance_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrEmployeeAdvancePayoutAllocation" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "advanceId" UUID NOT NULL,
  "vaultId" UUID NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "paymentMethod" "FinanceVaultPaymentMethod" NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmployeeAdvancePayoutAllocation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "HrEmployeeAdvanceSettlement" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "advanceId" UUID NOT NULL,
  "source" "HrEmployeeAdvanceSettlementSource" NOT NULL,
  "businessDate" DATE NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "journalEntryId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmployeeAdvanceSettlement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HrEmployeeAdvance_id_tenant_company_key" ON "HrEmployeeAdvance"("id", "tenantId", "companyId");
CREATE UNIQUE INDEX "HrEmployeeAdvance_company_number_key" ON "HrEmployeeAdvance"("companyId", "advanceNumber");
CREATE UNIQUE INDEX "HrEmployeeAdvance_issue_journal_tenant_company_key" ON "HrEmployeeAdvance"("issueJournalEntryId", "tenantId", "companyId");
CREATE INDEX "HrEmployeeAdvance_tenant_company_employee_status_date_id_idx" ON "HrEmployeeAdvance"("tenantId", "companyId", "employeeId", "status", "businessDate", "id");
CREATE UNIQUE INDEX "HrEmployeeAdvancePayoutAllocation_id_tenant_company_key" ON "HrEmployeeAdvancePayoutAllocation"("id", "tenantId", "companyId");
CREATE UNIQUE INDEX "HrEmployeeAdvancePayoutAllocation_advance_vault_method_key" ON "HrEmployeeAdvancePayoutAllocation"("advanceId", "vaultId", "paymentMethod");
CREATE INDEX "HrEmployeeAdvancePayoutAllocation_tenant_company_vault_created_idx" ON "HrEmployeeAdvancePayoutAllocation"("tenantId", "companyId", "vaultId", "createdAt");
CREATE UNIQUE INDEX "HrEmployeeAdvanceSettlement_id_tenant_company_key" ON "HrEmployeeAdvanceSettlement"("id", "tenantId", "companyId");
CREATE INDEX "HrEmployeeAdvanceSettlement_tenant_company_advance_date_id_idx" ON "HrEmployeeAdvanceSettlement"("tenantId", "companyId", "advanceId", "businessDate", "id");
CREATE INDEX "HrEmployeeAdvanceSettlement_tenant_company_journal_idx" ON "HrEmployeeAdvanceSettlement"("tenantId", "companyId", "journalEntryId");

ALTER TABLE "HrEmployeeAdvance"
  ADD CONSTRAINT "HrEmployeeAdvance_company_tenant_fkey"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HrEmployeeAdvance_employee_tenant_company_fkey"
    FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HrEmployeeAdvance_issue_journal_tenant_company_fkey"
    FOREIGN KEY ("issueJournalEntryId", "tenantId", "companyId") REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HrEmployeeAdvancePayoutAllocation"
  ADD CONSTRAINT "HrEmployeeAdvancePayoutAllocation_company_tenant_fkey"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HrEmployeeAdvancePayoutAllocation_advance_tenant_company_fkey"
    FOREIGN KEY ("advanceId", "tenantId", "companyId") REFERENCES "HrEmployeeAdvance"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HrEmployeeAdvancePayoutAllocation_vault_tenant_company_fkey"
    FOREIGN KEY ("vaultId", "tenantId", "companyId") REFERENCES "FinanceVault"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "HrEmployeeAdvanceSettlement"
  ADD CONSTRAINT "HrEmployeeAdvanceSettlement_company_tenant_fkey"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HrEmployeeAdvanceSettlement_advance_tenant_company_fkey"
    FOREIGN KEY ("advanceId", "tenantId", "companyId") REFERENCES "HrEmployeeAdvance"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "HrEmployeeAdvanceSettlement_journal_tenant_company_fkey"
    FOREIGN KEY ("journalEntryId", "tenantId", "companyId") REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
