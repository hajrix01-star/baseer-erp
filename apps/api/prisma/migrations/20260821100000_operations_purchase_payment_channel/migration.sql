CREATE TYPE "OperationsPurchasePaymentChannel" AS ENUM ('CUSTODY', 'CASH', 'BANK_TRANSFER');
ALTER TABLE "OperationsPurchaseRequest" ADD COLUMN "plannedPaymentChannel" "OperationsPurchasePaymentChannel" NOT NULL DEFAULT 'CASH';
UPDATE "OperationsPurchaseRequest" SET "plannedPaymentChannel" = 'CUSTODY' WHERE "executionKind" = 'DELEGATED';
ALTER TABLE "OperationsPurchaseReceipt" ADD COLUMN "actualPaymentChannel" "OperationsPurchasePaymentChannel" NOT NULL DEFAULT 'CASH', ADD COLUMN "paymentReference" VARCHAR(160);
UPDATE "OperationsPurchaseReceipt" receipt SET "actualPaymentChannel" = request."plannedPaymentChannel" FROM "OperationsPurchaseRequest" request WHERE request."id" = receipt."requestId";
