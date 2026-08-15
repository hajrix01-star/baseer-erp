-- BASEER ERP supplier-due posting links. Additive; existing pre-journal rows remain readable.

ALTER TABLE "FinanceSupplierDue"
  ADD COLUMN "journalEntryId" UUID;

ALTER TABLE "FinanceSupplierDuePayment"
  ADD COLUMN "journalEntryId" UUID;

ALTER TABLE "FinanceSupplierDue"
  ADD CONSTRAINT "FinanceSupplierDue_journalEntryId_key"
  UNIQUE ("journalEntryId"),
  ADD CONSTRAINT "FinanceSupplierDue_journalEntry_unique"
  UNIQUE ("journalEntryId", "tenantId", "companyId"),
  ADD CONSTRAINT "FinanceSupplierDue_journalEntry_fk"
  FOREIGN KEY ("journalEntryId", "tenantId", "companyId")
  REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT;

ALTER TABLE "FinanceSupplierDuePayment"
  ADD CONSTRAINT "FinanceSupplierDuePayment_journalEntryId_key"
  UNIQUE ("journalEntryId"),
  ADD CONSTRAINT "FinanceSupplierDuePayment_reversal_unique"
  UNIQUE ("reversalOfId", "tenantId", "companyId"),
  ADD CONSTRAINT "FinanceSupplierDuePayment_journalEntry_unique"
  UNIQUE ("journalEntryId", "tenantId", "companyId"),
  ADD CONSTRAINT "FinanceSupplierDuePayment_reversal_fk"
  FOREIGN KEY ("reversalOfId", "tenantId", "companyId")
  REFERENCES "FinanceSupplierDuePayment"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  ADD CONSTRAINT "FinanceSupplierDuePayment_journalEntry_fk"
  FOREIGN KEY ("journalEntryId", "tenantId", "companyId")
  REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT;

CREATE INDEX "FinanceSupplierDue_tenant_company_journal_idx"
  ON "FinanceSupplierDue"("tenantId", "companyId", "journalEntryId");
CREATE INDEX "FinanceSupplierDuePayment_tenant_company_journal_idx"
  ON "FinanceSupplierDuePayment"("tenantId", "companyId", "journalEntryId");
