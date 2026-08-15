-- Inclusive-loan repayment schedule and immutable reversal links.

ALTER TABLE "FinanceInclusiveLoanPayment"
  ADD COLUMN "reversalOfId" UUID UNIQUE,
  ADD CONSTRAINT "FinanceInclusiveLoanPayment_reversalOfId_tenantId_companyId_fkey"
    FOREIGN KEY ("reversalOfId", "tenantId", "companyId")
    REFERENCES "FinanceInclusiveLoanPayment"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  ADD CONSTRAINT "FinanceInclusiveLoanPayment_reversal_unique"
    UNIQUE ("reversalOfId", "tenantId", "companyId");

CREATE TABLE "FinanceInclusiveLoanInstallmentPlan" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "installmentNo" INTEGER NOT NULL,
  "dueDate" DATE NOT NULL,
  "expectedAmount" DECIMAL(18,4) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("loanId", "installmentNo"),
  CHECK ("installmentNo" > 0 AND "expectedAmount" > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("loanId", "tenantId", "companyId") REFERENCES "FinanceInclusiveLoan"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE INDEX "FinanceInclusiveLoanInstallmentPlan_tenant_company_loan_due_idx"
  ON "FinanceInclusiveLoanInstallmentPlan"("tenantId", "companyId", "loanId", "dueDate");

ALTER TABLE "FinanceInclusiveLoanInstallmentPlan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceInclusiveLoanInstallmentPlan" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinanceInclusiveLoanInstallmentPlan_tenant_isolation" ON "FinanceInclusiveLoanInstallmentPlan"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
