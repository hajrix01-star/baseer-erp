-- Supports bounded vault-activity pages while preserving tenant/company/account scope.
CREATE INDEX "FinanceJournalLine_tenant_company_account_entry_created_id_idx"
ON "FinanceJournalLine"("tenantId", "companyId", "accountId", "journalEntryId", "createdAt", "id");
