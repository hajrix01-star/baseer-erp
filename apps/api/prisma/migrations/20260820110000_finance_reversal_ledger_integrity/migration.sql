-- A cancellation is represented by an immutable opposite entry.  Keep the
-- original entry's historical effect and add the cancellation effect on its
-- own business date so as-of balances remain correct before and after it.
DELETE FROM "FinanceAccountDailyBalance";

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
WHERE entry."status" IN ('POSTED', 'REVERSED')
GROUP BY line."tenantId", line."companyId", line."accountId", entry."businessDate";
