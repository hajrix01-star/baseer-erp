-- A journal must be sealed before its deferred balance checks permit commit.
-- This also rejects direct DML that would otherwise leave a balanced draft entry unsealed.

CREATE OR REPLACE FUNCTION "baseer_assert_finance_journal_balanced"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line_count INTEGER;
  total_debit DECIMAL(18,4);
  total_credit DECIMAL(18,4);
  entry_sealed BOOLEAN;
BEGIN
  SELECT "isSealed" INTO entry_sealed
    FROM "FinanceJournalEntry"
   WHERE "id" = NEW."id"
     AND "tenantId" = NEW."tenantId"
     AND "companyId" = NEW."companyId";
  SELECT count(*), COALESCE(sum("debitAmount"), 0), COALESCE(sum("creditAmount"), 0)
    INTO line_count, total_debit, total_credit
    FROM "FinanceJournalLine"
   WHERE "journalEntryId" = NEW."id"
     AND "tenantId" = NEW."tenantId"
     AND "companyId" = NEW."companyId";
  IF NOT COALESCE(entry_sealed, false) OR line_count < 2 OR total_debit <= 0 OR total_debit <> total_credit THEN
    RAISE EXCEPTION 'Finance journal entry % must be sealed and balanced at commit.', NEW."id";
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION "baseer_assert_finance_journal_line_balanced"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line_count INTEGER;
  total_debit DECIMAL(18,4);
  total_credit DECIMAL(18,4);
  entry_sealed BOOLEAN;
BEGIN
  SELECT "isSealed" INTO entry_sealed
    FROM "FinanceJournalEntry"
   WHERE "id" = NEW."journalEntryId"
     AND "tenantId" = NEW."tenantId"
     AND "companyId" = NEW."companyId";
  SELECT count(*), COALESCE(sum("debitAmount"), 0), COALESCE(sum("creditAmount"), 0)
    INTO line_count, total_debit, total_credit
    FROM "FinanceJournalLine"
   WHERE "journalEntryId" = NEW."journalEntryId"
     AND "tenantId" = NEW."tenantId"
     AND "companyId" = NEW."companyId";
  IF NOT COALESCE(entry_sealed, false) OR line_count < 2 OR total_debit <= 0 OR total_debit <> total_credit THEN
    RAISE EXCEPTION 'Finance journal entry % must be sealed and balanced at commit.', NEW."journalEntryId";
  END IF;
  RETURN NULL;
END;
$$;
