-- A supplier has one explicit operational type and one default posting category.
-- Existing experimental suppliers retain their category; their type is inferred safely from it.
CREATE TYPE "FinanceSupplierType" AS ENUM ('PURCHASE', 'EXPENSE');

ALTER TABLE "FinanceSupplier"
  ADD COLUMN "supplierType" "FinanceSupplierType";

UPDATE "FinanceSupplier" AS supplier
SET "supplierType" = CASE category."kind"
  WHEN 'EXPENSE' THEN 'EXPENSE'::"FinanceSupplierType"
  ELSE 'PURCHASE'::"FinanceSupplierType"
END
FROM "FinanceCategory" AS category
WHERE supplier."categoryId" = category."id"
  AND supplier."tenantId" = category."tenantId"
  AND supplier."companyId" = category."companyId";

-- Legacy rows without a category remain reviewable, but do not receive a fabricated category.
UPDATE "FinanceSupplier"
SET "supplierType" = 'PURCHASE'::"FinanceSupplierType"
WHERE "supplierType" IS NULL;

ALTER TABLE "FinanceSupplier"
  ALTER COLUMN "supplierType" SET NOT NULL;

CREATE INDEX "FinanceSupplier_tenantId_companyId_supplierType_status_idx"
  ON "FinanceSupplier"("tenantId", "companyId", "supplierType", "status");