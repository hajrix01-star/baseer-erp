-- The personal cash-performance report has its own source-backed event model.
-- It is separate from formal P&L mappings and records only actual external
-- collections/payments, with cancellation represented by a later opposite row.

CREATE TYPE "FinanceCashPerformanceEventKind" AS ENUM (
  'SALES_COLLECTION', 'PURCHASE_PAYMENT', 'OPERATING_EXPENSE_PAYMENT', 'VAT_PAYMENT', 'VAT_REFUND'
);
CREATE TYPE "FinanceCashPerformanceDirection" AS ENUM ('INFLOW', 'OUTFLOW');

CREATE TABLE "FinanceCashPerformanceEvent" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "kind" "FinanceCashPerformanceEventKind" NOT NULL,
  "direction" "FinanceCashPerformanceDirection" NOT NULL,
  "businessDate" DATE NOT NULL,
  "grossAmount" DECIMAL(18,4) NOT NULL,
  "netAmount" DECIMAL(18,4) NOT NULL,
  "vatAmount" DECIMAL(18,4) NOT NULL,
  "vatBreakdownKnown" BOOLEAN NOT NULL DEFAULT true,
  "categoryCodeSnapshot" VARCHAR(80),
  "categoryNameArSnapshot" VARCHAR(160),
  "categoryNameEnSnapshot" VARCHAR(160),
  "categoryKindSnapshot" "FinanceCategoryKind",
  "settlementDestinationsJson" JSONB,
  "sourceType" VARCHAR(80) NOT NULL,
  "sourceId" UUID NOT NULL,
  "sourceJournalEntryId" UUID NOT NULL,
  "ledgerRevision" BIGINT NOT NULL,
  "reversalOfEventId" UUID,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceCashPerformanceEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceCashPerformanceEvent_tenant_company_id_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "FinanceCashPerformanceEvent_journal_key" UNIQUE ("sourceJournalEntryId", "tenantId", "companyId"),
  CONSTRAINT "FinanceCashPerformanceEvent_reversal_global_key" UNIQUE ("reversalOfEventId"),
  CONSTRAINT "FinanceCashPerformanceEvent_reversal_key" UNIQUE ("reversalOfEventId", "tenantId", "companyId"),
  CONSTRAINT "FinanceCashPerformanceEvent_amounts" CHECK ("grossAmount" > 0 AND "netAmount" >= 0 AND "vatAmount" >= 0 AND "grossAmount" = "netAmount" + "vatAmount"),
  CONSTRAINT "FinanceCashPerformanceEvent_revision" CHECK ("ledgerRevision" > 0),
  CONSTRAINT "FinanceCashPerformanceEvent_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceCashPerformanceEvent_journal_fkey" FOREIGN KEY ("sourceJournalEntryId", "tenantId", "companyId") REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceCashPerformanceEvent_reversal_fkey" FOREIGN KEY ("reversalOfEventId", "tenantId", "companyId") REFERENCES "FinanceCashPerformanceEvent"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceCashPerformanceEvent_creator_fkey" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);
CREATE INDEX "FinanceCashPerformanceEvent_tenant_company_date_kind_id_idx" ON "FinanceCashPerformanceEvent" ("tenantId", "companyId", "businessDate", "kind", "id");
CREATE INDEX "FinanceCashPerformanceEvent_tenant_company_revision_date_id_idx" ON "FinanceCashPerformanceEvent" ("tenantId", "companyId", "ledgerRevision", "businessDate", "id");
CREATE INDEX "FinanceCashPerformanceEvent_tenant_company_source_idx" ON "FinanceCashPerformanceEvent" ("tenantId", "companyId", "sourceType", "sourceId");

CREATE OR REPLACE FUNCTION "finance_cash_performance_event_journal_guard"()
RETURNS TRIGGER AS $$
DECLARE original_direction "FinanceCashPerformanceDirection";
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "FinanceJournalEntry"
    WHERE "id" = NEW."sourceJournalEntryId" AND "tenantId" = NEW."tenantId" AND "companyId" = NEW."companyId"
      AND "isSealed" = true AND "status" IN ('POSTED', 'REVERSED') AND "ledgerRevision" = NEW."ledgerRevision"
      AND "businessDate" = NEW."businessDate"
  ) THEN RAISE EXCEPTION 'Cash-performance event must match a sealed journal entry, business date and ledger revision'; END IF;
  IF NEW."reversalOfEventId" IS NOT NULL THEN
    SELECT "direction" INTO original_direction FROM "FinanceCashPerformanceEvent"
    WHERE "id" = NEW."reversalOfEventId" AND "tenantId" = NEW."tenantId" AND "companyId" = NEW."companyId";
    IF original_direction IS NULL OR original_direction = NEW."direction" THEN
      RAISE EXCEPTION 'Cash-performance reversal must have the opposite original direction';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FinanceCashPerformanceEvent_journal_guard"
  BEFORE INSERT OR UPDATE ON "FinanceCashPerformanceEvent"
  FOR EACH ROW EXECUTE FUNCTION "finance_cash_performance_event_journal_guard"();

CREATE OR REPLACE FUNCTION "finance_cash_performance_event_immutable_guard"()
RETURNS TRIGGER AS $$
BEGIN RAISE EXCEPTION 'Cash-performance events are immutable'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FinanceCashPerformanceEvent_immutable_guard"
  BEFORE UPDATE OR DELETE ON "FinanceCashPerformanceEvent"
  FOR EACH ROW EXECUTE FUNCTION "finance_cash_performance_event_immutable_guard"();

ALTER TABLE "FinanceCashPerformanceEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceCashPerformanceEvent" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinanceCashPerformanceEvent_tenant_isolation" ON "FinanceCashPerformanceEvent"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TYPE "FinanceVatSettlementKind" AS ENUM ('PAYMENT', 'REFUND');
CREATE TYPE "FinanceVatSettlementStatus" AS ENUM ('POSTED', 'REVERSED');
CREATE TABLE "FinanceVatSettlement" (
  "id" UUID NOT NULL, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
  "kind" "FinanceVatSettlementKind" NOT NULL, "status" "FinanceVatSettlementStatus" NOT NULL DEFAULT 'POSTED',
  "vaultId" UUID NOT NULL, "amount" DECIMAL(18,4) NOT NULL, "businessDate" DATE NOT NULL,
  "referenceNumber" VARCHAR(160) NOT NULL, "notes" VARCHAR(1000), "journalEntryId" UUID NOT NULL,
  "reversalOfId" UUID, "createdByUserId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceVatSettlement_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceVatSettlement_tenant_company_id_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "FinanceVatSettlement_journal_key" UNIQUE ("journalEntryId", "tenantId", "companyId"),
  CONSTRAINT "FinanceVatSettlement_reversal_global_key" UNIQUE ("reversalOfId"),
  CONSTRAINT "FinanceVatSettlement_reversal_key" UNIQUE ("reversalOfId", "tenantId", "companyId"),
  CONSTRAINT "FinanceVatSettlement_reference_key" UNIQUE ("companyId", "referenceNumber"),
  CONSTRAINT "FinanceVatSettlement_amount" CHECK ("amount" > 0),
  CONSTRAINT "FinanceVatSettlement_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceVatSettlement_vault_fkey" FOREIGN KEY ("vaultId", "tenantId", "companyId") REFERENCES "FinanceVault"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceVatSettlement_journal_fkey" FOREIGN KEY ("journalEntryId", "tenantId", "companyId") REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceVatSettlement_reversal_fkey" FOREIGN KEY ("reversalOfId", "tenantId", "companyId") REFERENCES "FinanceVatSettlement"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceVatSettlement_creator_fkey" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);
CREATE INDEX "FinanceVatSettlement_tenant_company_date_status_id_idx" ON "FinanceVatSettlement" ("tenantId", "companyId", "businessDate", "status", "id");
CREATE OR REPLACE FUNCTION "finance_vat_settlement_immutable_guard"()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."status" = 'POSTED' AND NEW."status" = 'REVERSED'
    AND NEW."id" = OLD."id" AND NEW."tenantId" = OLD."tenantId" AND NEW."companyId" = OLD."companyId"
    AND NEW."kind" = OLD."kind" AND NEW."vaultId" = OLD."vaultId" AND NEW."amount" = OLD."amount"
    AND NEW."businessDate" = OLD."businessDate" AND NEW."referenceNumber" = OLD."referenceNumber"
    AND NEW."notes" IS NOT DISTINCT FROM OLD."notes" AND NEW."journalEntryId" = OLD."journalEntryId"
    AND NEW."reversalOfId" IS NOT DISTINCT FROM OLD."reversalOfId" AND NEW."createdByUserId" = OLD."createdByUserId"
    AND NEW."createdAt" = OLD."createdAt" THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'VAT settlements are immutable except for their reversal status';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "FinanceVatSettlement_immutable_guard" BEFORE UPDATE OR DELETE ON "FinanceVatSettlement" FOR EACH ROW EXECUTE FUNCTION "finance_vat_settlement_immutable_guard"();
ALTER TABLE "FinanceVatSettlement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceVatSettlement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinanceVatSettlement_tenant_isolation" ON "FinanceVatSettlement"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
