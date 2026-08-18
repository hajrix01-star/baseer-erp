-- Cash-on-payment: retain the net amount recognised in P&L for every settled supplier due.
-- Existing rows are experimental/local history and default to zero; new payments populate it atomically.
ALTER TABLE "FinanceSupplierDuePayment"
  ADD COLUMN "recognizedNetAmount" DECIMAL(18,4) NOT NULL DEFAULT 0;