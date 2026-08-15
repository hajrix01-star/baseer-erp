-- BASEER ERP recurring reminders and inclusive opening-loan records.
-- A loan created here is an already-disbursed liability, not an incoming cash transaction.

CREATE TYPE "FinanceRecurringExpenseStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "FinanceInclusiveLoanStatus" AS ENUM ('ACTIVE', 'SETTLED', 'ARCHIVED');
CREATE TYPE "FinanceInclusiveLoanPaymentStatus" AS ENUM ('POSTED', 'REVERSED');

CREATE TABLE "FinanceRecurringExpenseProfile" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "supplierId" UUID,
  "categoryId" UUID NOT NULL,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160) NOT NULL,
  "expectedAmount" DECIMAL(18,4) NOT NULL,
  "intervalMonths" INTEGER NOT NULL,
  "nextReminderDate" DATE NOT NULL,
  "status" "FinanceRecurringExpenseStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes" VARCHAR(2000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  CHECK ("expectedAmount" > 0),
  CHECK ("intervalMonths" BETWEEN 1 AND 12),
  CHECK (length(trim("nameAr")) > 0 AND length(trim("nameEn")) > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("supplierId", "tenantId", "companyId") REFERENCES "FinanceSupplier"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("categoryId", "tenantId", "companyId") REFERENCES "FinanceCategory"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE TABLE "FinanceInclusiveLoan" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "sourceDocumentNumber" VARCHAR(160) NOT NULL,
  "originalAmount" DECIMAL(18,4) NOT NULL,
  "openingOutstandingAmount" DECIMAL(18,4) NOT NULL,
  "paidAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "remainingAmount" DECIMAL(18,4) NOT NULL,
  "installmentAmount" DECIMAL(18,4) NOT NULL,
  "termMonths" INTEGER NOT NULL,
  "firstInstallmentDueDate" DATE NOT NULL,
  "openingBusinessDate" DATE NOT NULL,
  "status" "FinanceInclusiveLoanStatus" NOT NULL DEFAULT 'ACTIVE',
  "notes" VARCHAR(2000),
  "openingJournalEntryId" UUID UNIQUE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("companyId", "sourceDocumentNumber"),
  UNIQUE ("openingJournalEntryId", "tenantId", "companyId"),
  CHECK ("originalAmount" > 0 AND "openingOutstandingAmount" > 0 AND "openingOutstandingAmount" <= "originalAmount"),
  CHECK ("paidAmount" >= 0 AND "remainingAmount" >= 0 AND "paidAmount" + "remainingAmount" = "openingOutstandingAmount"),
  CHECK ("installmentAmount" > 0 AND "termMonths" > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("openingJournalEntryId", "tenantId", "companyId") REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE TABLE "FinanceInclusiveLoanPayment" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "loanId" UUID NOT NULL,
  "vaultId" UUID NOT NULL,
  "amount" DECIMAL(18,4) NOT NULL,
  "businessDate" DATE NOT NULL,
  "status" "FinanceInclusiveLoanPaymentStatus" NOT NULL DEFAULT 'POSTED',
  "journalEntryId" UUID UNIQUE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("journalEntryId", "tenantId", "companyId"),
  CHECK ("amount" > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("loanId", "tenantId", "companyId") REFERENCES "FinanceInclusiveLoan"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("vaultId", "tenantId", "companyId") REFERENCES "FinanceVault"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("journalEntryId", "tenantId", "companyId") REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE INDEX "FinanceRecurringExpenseProfile_tenant_company_status_date_idx" ON "FinanceRecurringExpenseProfile"("tenantId", "companyId", "status", "nextReminderDate");
CREATE INDEX "FinanceInclusiveLoan_tenant_company_status_due_idx" ON "FinanceInclusiveLoan"("tenantId", "companyId", "status", "firstInstallmentDueDate");
CREATE INDEX "FinanceInclusiveLoanPayment_tenant_company_loan_date_idx" ON "FinanceInclusiveLoanPayment"("tenantId", "companyId", "loanId", "businessDate");

ALTER TABLE "FinanceRecurringExpenseProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceRecurringExpenseProfile" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FinanceInclusiveLoan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceInclusiveLoan" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FinanceInclusiveLoanPayment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceInclusiveLoanPayment" FORCE ROW LEVEL SECURITY;

CREATE POLICY "FinanceRecurringExpenseProfile_tenant_isolation" ON "FinanceRecurringExpenseProfile"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "FinanceInclusiveLoan_tenant_isolation" ON "FinanceInclusiveLoan"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "FinanceInclusiveLoanPayment_tenant_isolation" ON "FinanceInclusiveLoanPayment"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
