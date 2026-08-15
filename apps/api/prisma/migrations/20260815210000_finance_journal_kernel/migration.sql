-- BASEER ERP double-entry journal kernel. Additive; no business documents are migrated here.

CREATE TYPE "FinanceJournalEntryStatus" AS ENUM ('POSTED', 'REVERSED');

CREATE TABLE "FinanceJournalEntry" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "fiscalPeriodId" UUID NOT NULL,
  "sourceType" VARCHAR(80) NOT NULL,
  "sourceReference" VARCHAR(160) NOT NULL,
  "businessDate" DATE NOT NULL,
  "description" VARCHAR(1000),
  "status" "FinanceJournalEntryStatus" NOT NULL DEFAULT 'POSTED',
  "reversalOfEntryId" UUID UNIQUE,
  "reversalReason" VARCHAR(1000),
  "createdByUserId" UUID NOT NULL,
  "requestId" VARCHAR(120) NOT NULL,
  "postedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("reversalOfEntryId", "tenantId", "companyId"),
  UNIQUE ("companyId", "sourceType", "sourceReference"),
  CHECK (length(trim("sourceType")) > 0),
  CHECK (length(trim("sourceReference")) > 0),
  CHECK (("sourceType" = 'journal_reversal' AND "status" = 'POSTED' AND "reversalOfEntryId" IS NOT NULL AND "reversalReason" IS NOT NULL) OR ("sourceType" <> 'journal_reversal' AND "reversalOfEntryId" IS NULL AND "reversalReason" IS NULL)),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("fiscalPeriodId", "tenantId", "companyId") REFERENCES "FinanceFiscalPeriod"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("reversalOfEntryId", "tenantId", "companyId") REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE TABLE "FinanceJournalLine" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "journalEntryId" UUID NOT NULL,
  "accountId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "debitAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "creditAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "description" VARCHAR(1000),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("journalEntryId", "lineNumber"),
  CHECK ("lineNumber" > 0),
  CHECK (("debitAmount" > 0 AND "creditAmount" = 0) OR ("creditAmount" > 0 AND "debitAmount" = 0)),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("journalEntryId", "tenantId", "companyId") REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("accountId", "tenantId", "companyId") REFERENCES "FinanceAccount"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE INDEX "FinanceJournalEntry_tenant_company_date_status_idx" ON "FinanceJournalEntry"("tenantId", "companyId", "businessDate", "status");
CREATE INDEX "FinanceJournalEntry_tenant_company_period_date_idx" ON "FinanceJournalEntry"("tenantId", "companyId", "fiscalPeriodId", "businessDate");
CREATE INDEX "FinanceJournalLine_tenant_company_account_created_idx" ON "FinanceJournalLine"("tenantId", "companyId", "accountId", "createdAt");
CREATE INDEX "FinanceJournalLine_tenant_company_entry_idx" ON "FinanceJournalLine"("tenantId", "companyId", "journalEntryId");

-- A journal entry must remain balanced at commit time, even if it was not inserted by the application service.
CREATE FUNCTION "baseer_assert_finance_journal_balanced"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line_count INTEGER;
  total_debit DECIMAL(18,4);
  total_credit DECIMAL(18,4);
BEGIN
  SELECT count(*), COALESCE(sum("debitAmount"), 0), COALESCE(sum("creditAmount"), 0)
    INTO line_count, total_debit, total_credit
    FROM "FinanceJournalLine"
   WHERE "journalEntryId" = NEW."id"
     AND "tenantId" = NEW."tenantId"
     AND "companyId" = NEW."companyId";
  IF line_count < 2 OR total_debit <= 0 OR total_debit <> total_credit THEN
    RAISE EXCEPTION 'Finance journal entry % is not balanced.', NEW."id";
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "FinanceJournalEntry_balanced_at_commit"
AFTER INSERT OR UPDATE ON "FinanceJournalEntry"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "baseer_assert_finance_journal_balanced"();

CREATE FUNCTION "baseer_assert_finance_journal_line_balanced"() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  line_count INTEGER;
  total_debit DECIMAL(18,4);
  total_credit DECIMAL(18,4);
BEGIN
  SELECT count(*), COALESCE(sum("debitAmount"), 0), COALESCE(sum("creditAmount"), 0)
    INTO line_count, total_debit, total_credit
    FROM "FinanceJournalLine"
   WHERE "journalEntryId" = NEW."journalEntryId"
     AND "tenantId" = NEW."tenantId"
     AND "companyId" = NEW."companyId";
  IF line_count < 2 OR total_debit <= 0 OR total_debit <> total_credit THEN
    RAISE EXCEPTION 'Finance journal entry % is not balanced.', NEW."journalEntryId";
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "FinanceJournalLine_balanced_at_commit"
AFTER INSERT ON "FinanceJournalLine"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION "baseer_assert_finance_journal_line_balanced"();

-- Posted lines are immutable. An accounting correction must be a new reversal entry.
CREATE FUNCTION "baseer_prevent_finance_journal_line_mutation"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Finance journal lines are immutable; post a reversal instead.';
END;
$$;

CREATE TRIGGER "FinanceJournalLine_prevent_update_delete"
BEFORE UPDATE OR DELETE ON "FinanceJournalLine"
FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_finance_journal_line_mutation"();

-- The original entry may only move from POSTED to REVERSED after a replacement reversal was posted.
CREATE FUNCTION "baseer_guard_finance_journal_entry"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Finance journal entries are immutable; post a reversal instead.';
  END IF;
  IF OLD."status" <> 'POSTED' OR NEW."status" <> 'REVERSED'
     OR NEW."id" IS DISTINCT FROM OLD."id"
     OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
     OR NEW."fiscalPeriodId" IS DISTINCT FROM OLD."fiscalPeriodId"
     OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
     OR NEW."sourceReference" IS DISTINCT FROM OLD."sourceReference"
     OR NEW."businessDate" IS DISTINCT FROM OLD."businessDate"
     OR NEW."description" IS DISTINCT FROM OLD."description"
     OR NEW."reversalOfEntryId" IS DISTINCT FROM OLD."reversalOfEntryId"
     OR NEW."reversalReason" IS DISTINCT FROM OLD."reversalReason"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
     OR NEW."requestId" IS DISTINCT FROM OLD."requestId"
     OR NEW."postedAt" IS DISTINCT FROM OLD."postedAt" THEN
    RAISE EXCEPTION 'Finance journal entries may only be marked reversed; post a correction as a new entry.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "FinanceJournalEntry_guard_update_delete"
BEFORE UPDATE OR DELETE ON "FinanceJournalEntry"
FOR EACH ROW EXECUTE FUNCTION "baseer_guard_finance_journal_entry"();

ALTER TABLE "FinanceJournalEntry" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceJournalEntry" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FinanceJournalLine" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceJournalLine" FORCE ROW LEVEL SECURITY;

CREATE POLICY "FinanceJournalEntry_tenant_isolation" ON "FinanceJournalEntry"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "FinanceJournalLine_tenant_isolation" ON "FinanceJournalLine"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
