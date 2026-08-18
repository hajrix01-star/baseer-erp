-- Stable keyset paging for the daily-sales history across long date ranges.
CREATE INDEX "FinanceDailySalesClosing_tenant_company_date_id_idx"
ON "FinanceDailySalesClosing"("tenantId", "companyId", "businessDate" DESC, "id" DESC);
