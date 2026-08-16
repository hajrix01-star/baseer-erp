-- Cash handover is a management observation, not a vault movement.
-- Keep the historical nullable reference column for migration compatibility, but
-- remove the pair requirement so an amount can be recorded without a vault.

ALTER TABLE "FinanceDailySalesClosing"
  DROP CONSTRAINT "FinanceDailySalesClosing_cash_handover_pair";

ALTER TABLE "FinanceDailySalesClosing"
  DROP CONSTRAINT "FinanceDailySalesClosing_cash_handover_vault_fkey";
