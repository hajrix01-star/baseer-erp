-- Denormalize the immutable journal date onto its immutable lines so account
-- and vault activity can seek through years of history without a join-sort.
ALTER TABLE "FinanceJournalLine" ADD COLUMN "businessDate" DATE;

UPDATE "FinanceJournalLine" AS line
SET "businessDate" = entry."businessDate"
FROM "FinanceJournalEntry" AS entry
WHERE entry."id" = line."journalEntryId"
  AND entry."tenantId" = line."tenantId"
  AND entry."companyId" = line."companyId";

ALTER TABLE "FinanceJournalLine" ALTER COLUMN "businessDate" SET NOT NULL;

CREATE INDEX "FinanceJournalLine_tenant_company_account_activity_idx"
  ON "FinanceJournalLine" ("tenantId", "companyId", "accountId", "businessDate" DESC, "createdAt" DESC, "lineNumber" DESC, "id" DESC);
