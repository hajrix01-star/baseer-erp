-- A vault is one ledger account and may expose several payment methods.
-- Keep paymentMethod as the backwards-compatible primary/default method.
ALTER TABLE "FinanceVault"
  ADD COLUMN "paymentMethods" "FinanceVaultPaymentMethod"[] NOT NULL DEFAULT ARRAY[]::"FinanceVaultPaymentMethod"[];

UPDATE "FinanceVault"
SET "paymentMethods" = ARRAY["paymentMethod"];

ALTER TABLE "FinanceVault"
  ADD CONSTRAINT "FinanceVault_paymentMethods_not_empty"
  CHECK (cardinality("paymentMethods") > 0);