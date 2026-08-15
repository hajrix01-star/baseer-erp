-- BASEER ERP journal sealing. A posted journal becomes immutable once its initial lines are complete.

ALTER TABLE "FinanceJournalEntry"
  ADD COLUMN "isSealed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "sealedAt" TIMESTAMPTZ(6);

DROP TRIGGER "FinanceJournalLine_prevent_update_delete" ON "FinanceJournalLine";
DROP FUNCTION "baseer_prevent_finance_journal_line_mutation"();

CREATE FUNCTION "baseer_guard_finance_journal_line"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  entry_sealed BOOLEAN;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'Finance journal lines are immutable; post a reversal instead.';
  END IF;
  SELECT "isSealed"
    INTO entry_sealed
    FROM "FinanceJournalEntry"
   WHERE "id" = NEW."journalEntryId"
     AND "tenantId" = NEW."tenantId"
     AND "companyId" = NEW."companyId";
  IF NOT FOUND OR entry_sealed THEN
    RAISE EXCEPTION 'Finance journal lines cannot be added after the entry is sealed.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FinanceJournalLine_guard_insert_update_delete"
BEFORE INSERT OR UPDATE OR DELETE ON "FinanceJournalLine"
FOR EACH ROW EXECUTE FUNCTION "baseer_guard_finance_journal_line"();

DROP TRIGGER "FinanceJournalEntry_guard_update_delete" ON "FinanceJournalEntry";
DROP FUNCTION "baseer_guard_finance_journal_entry"();

CREATE FUNCTION "baseer_guard_finance_journal_entry"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Finance journal entries are immutable; post a reversal instead.';
  END IF;

  IF OLD."isSealed" = false
     AND NEW."isSealed" = true
     AND NEW."sealedAt" IS NOT NULL
     AND NEW."status" IS NOT DISTINCT FROM OLD."status"
     AND NEW."id" IS NOT DISTINCT FROM OLD."id"
     AND NEW."tenantId" IS NOT DISTINCT FROM OLD."tenantId"
     AND NEW."companyId" IS NOT DISTINCT FROM OLD."companyId"
     AND NEW."fiscalPeriodId" IS NOT DISTINCT FROM OLD."fiscalPeriodId"
     AND NEW."sourceType" IS NOT DISTINCT FROM OLD."sourceType"
     AND NEW."sourceReference" IS NOT DISTINCT FROM OLD."sourceReference"
     AND NEW."businessDate" IS NOT DISTINCT FROM OLD."businessDate"
     AND NEW."description" IS NOT DISTINCT FROM OLD."description"
     AND NEW."reversalOfEntryId" IS NOT DISTINCT FROM OLD."reversalOfEntryId"
     AND NEW."reversalReason" IS NOT DISTINCT FROM OLD."reversalReason"
     AND NEW."createdByUserId" IS NOT DISTINCT FROM OLD."createdByUserId"
     AND NEW."requestId" IS NOT DISTINCT FROM OLD."requestId"
     AND NEW."postedAt" IS NOT DISTINCT FROM OLD."postedAt" THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'POSTED'
     AND NEW."status" = 'REVERSED'
     AND OLD."isSealed" = true
     AND NEW."isSealed" = true
     AND NEW."sealedAt" IS NOT DISTINCT FROM OLD."sealedAt"
     AND NEW."id" IS NOT DISTINCT FROM OLD."id"
     AND NEW."tenantId" IS NOT DISTINCT FROM OLD."tenantId"
     AND NEW."companyId" IS NOT DISTINCT FROM OLD."companyId"
     AND NEW."fiscalPeriodId" IS NOT DISTINCT FROM OLD."fiscalPeriodId"
     AND NEW."sourceType" IS NOT DISTINCT FROM OLD."sourceType"
     AND NEW."sourceReference" IS NOT DISTINCT FROM OLD."sourceReference"
     AND NEW."businessDate" IS NOT DISTINCT FROM OLD."businessDate"
     AND NEW."description" IS NOT DISTINCT FROM OLD."description"
     AND NEW."reversalOfEntryId" IS NOT DISTINCT FROM OLD."reversalOfEntryId"
     AND NEW."reversalReason" IS NOT DISTINCT FROM OLD."reversalReason"
     AND NEW."createdByUserId" IS NOT DISTINCT FROM OLD."createdByUserId"
     AND NEW."requestId" IS NOT DISTINCT FROM OLD."requestId"
     AND NEW."postedAt" IS NOT DISTINCT FROM OLD."postedAt"
     AND EXISTS (
       SELECT 1
         FROM "FinanceJournalEntry" AS reversal
        WHERE reversal."reversalOfEntryId" = OLD."id"
          AND reversal."tenantId" = OLD."tenantId"
          AND reversal."companyId" = OLD."companyId"
          AND reversal."sourceType" = 'journal_reversal'
          AND reversal."status" = 'POSTED'
          AND reversal."isSealed" = true
     ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Finance journal entries may only be sealed or marked reversed by a sealed reversal entry.';
END;
$$;

CREATE TRIGGER "FinanceJournalEntry_guard_update_delete"
BEFORE UPDATE OR DELETE ON "FinanceJournalEntry"
FOR EACH ROW EXECUTE FUNCTION "baseer_guard_finance_journal_entry"();
