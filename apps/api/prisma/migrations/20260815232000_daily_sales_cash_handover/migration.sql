-- Management-only cumulative cash handover. This is deliberately not a ledger event.
ALTER TABLE "FinanceDailySalesClosing"
  ADD COLUMN "cashHandoverAmount" DECIMAL(18,4),
  ADD COLUMN "cashHandoverVaultId" UUID,
  ADD CONSTRAINT "FinanceDailySalesClosing_cash_handover_non_negative"
    CHECK ("cashHandoverAmount" IS NULL OR "cashHandoverAmount" >= 0),
  ADD CONSTRAINT "FinanceDailySalesClosing_cash_handover_pair"
    CHECK (("cashHandoverAmount" IS NULL) = ("cashHandoverVaultId" IS NULL)),
  ADD CONSTRAINT "FinanceDailySalesClosing_cash_handover_vault_fkey"
    FOREIGN KEY ("cashHandoverVaultId", "tenantId", "companyId")
    REFERENCES "FinanceVault"("id", "tenantId", "companyId") ON DELETE RESTRICT;

CREATE INDEX "FinanceDailySalesClosing_tenant_company_date_handover_idx"
  ON "FinanceDailySalesClosing"("tenantId", "companyId", "businessDate", "status", "cashHandoverVaultId");
