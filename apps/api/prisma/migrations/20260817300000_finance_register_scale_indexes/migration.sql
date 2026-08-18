-- Keyset paging for the unified financial register: company/status/date/posting/id.
CREATE INDEX "FinanceJournalEntry_tenant_company_status_date_posted_id_idx"
ON "FinanceJournalEntry"("tenantId", "companyId", "status", "businessDate" DESC, "postedAt" DESC, "id" DESC);
