-- Bounded, rebuildable read projection for balances over long ledger history.
CREATE TABLE "FinanceAccountDailyBalance" (
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "businessDate" DATE NOT NULL,
  "debitAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "creditAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceAccountDailyBalance_pkey" PRIMARY KEY ("tenantId", "companyId", "accountId", "businessDate")
);

CREATE INDEX "FinanceAccountDailyBalance_tenant_company_account_date_idx"
ON "FinanceAccountDailyBalance"("tenantId", "companyId", "accountId", "businessDate");

-- Backfill is deterministic and includes only the same POSTED entries used by
-- the existing ledger-derived treasury read path.
INSERT INTO "FinanceAccountDailyBalance" (
  "tenantId", "companyId", "accountId", "businessDate", "debitAmount", "creditAmount", "updatedAt"
)
SELECT
  line."tenantId",
  line."companyId",
  line."accountId",
  entry."businessDate",
  SUM(line."debitAmount"),
  SUM(line."creditAmount"),
  CURRENT_TIMESTAMP
FROM "FinanceJournalLine" line
JOIN "FinanceJournalEntry" entry
  ON entry."id" = line."journalEntryId"
 AND entry."tenantId" = line."tenantId"
 AND entry."companyId" = line."companyId"
WHERE entry."status" = 'POSTED'
GROUP BY line."tenantId", line."companyId", line."accountId", entry."businessDate";
