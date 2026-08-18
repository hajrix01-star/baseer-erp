CREATE TYPE "FinanceVaultPaymentMethod" AS ENUM ('CASH', 'BANK_TRANSFER', 'BANK_CARD', 'BANK_PAYMENT', 'APP');

ALTER TABLE "FinanceVault"
  ADD COLUMN "paymentMethod" "FinanceVaultPaymentMethod";

UPDATE "FinanceVault"
SET "paymentMethod" = CASE "type"
  WHEN 'CASH' THEN 'CASH'::"FinanceVaultPaymentMethod"
  WHEN 'BANK' THEN 'BANK_TRANSFER'::"FinanceVaultPaymentMethod"
  WHEN 'APP' THEN 'APP'::"FinanceVaultPaymentMethod"
END;

ALTER TABLE "FinanceVault"
  ALTER COLUMN "paymentMethod" SET NOT NULL;