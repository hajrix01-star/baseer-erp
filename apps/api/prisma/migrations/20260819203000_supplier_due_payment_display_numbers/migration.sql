-- Supplier-due payments were previously linked to their journal with a UUID
-- source reference.  Replace that internal identifier with the same stable,
-- human-readable series used by new payment postings.
WITH numbered_payments AS (
  SELECT
    payment."id",
    payment."journalEntryId",
    payment."tenantId",
    payment."companyId",
    payment."businessDate",
    'PAY-' || to_char(payment."businessDate", 'YYYYMMDD') || '-' ||
      lpad(
        row_number() OVER (
          PARTITION BY payment."tenantId", payment."companyId", payment."businessDate"
          ORDER BY payment."createdAt", payment."id"
        )::text,
        4,
        '0'
      ) AS "paymentNumber"
  FROM "FinanceSupplierDuePayment" payment
  INNER JOIN "FinanceJournalEntry" journal
    ON journal."id" = payment."journalEntryId"
   AND journal."tenantId" = payment."tenantId"
   AND journal."companyId" = payment."companyId"
  WHERE journal."sourceType" = 'supplier_due_payment'
)
UPDATE "FinanceJournalEntry" journal
SET
  "sourceReference" = numbered_payments."paymentNumber",
  "description" = regexp_replace(
    COALESCE(journal."description", ''),
    'Supplier due payment [0-9a-f-]{36}(:v1)?',
    'Supplier due payment ' || numbered_payments."paymentNumber"
  )
FROM numbered_payments
WHERE journal."id" = numbered_payments."journalEntryId"
  AND journal."tenantId" = numbered_payments."tenantId"
  AND journal."companyId" = numbered_payments."companyId";

-- Keep the atomic serial counter ahead of every migrated payment so the next
-- posting cannot reuse an existing display number.
INSERT INTO "DocumentSerialCounter" (
  "tenantId", "companyId", "series", "businessDate", "lastValue", "createdAt", "updatedAt"
)
SELECT
  payment."tenantId",
  payment."companyId",
  'SUPPLIER_DUE_PAYMENT',
  payment."businessDate",
  COUNT(*)::bigint,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM "FinanceSupplierDuePayment" payment
INNER JOIN "FinanceJournalEntry" journal
  ON journal."id" = payment."journalEntryId"
 AND journal."tenantId" = payment."tenantId"
 AND journal."companyId" = payment."companyId"
WHERE journal."sourceType" = 'supplier_due_payment'
GROUP BY payment."tenantId", payment."companyId", payment."businessDate"
ON CONFLICT ("tenantId", "companyId", "series", "businessDate")
DO UPDATE SET
  "lastValue" = GREATEST("DocumentSerialCounter"."lastValue", EXCLUDED."lastValue"),
  "updatedAt" = CURRENT_TIMESTAMP;
