-- Owner amendments keep the commercial document identity stable while the
-- sealed journal history remains append-only.

ALTER TABLE "FinanceOutflowDocument"
  ADD COLUMN "postingVersion" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "FinanceOutflowDocumentRevision" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "previousJournalEntryId" UUID NOT NULL,
  "journalEntryId" UUID NOT NULL,
  "beforeJson" JSONB NOT NULL,
  "afterJson" JSONB NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceOutflowDocumentRevision_version_positive" CHECK ("version" > 1),
  CONSTRAINT "FinanceOutflowDocumentRevision_document_version_key" UNIQUE ("documentId", "version"),
  CONSTRAINT "FinanceOutflowDocumentRevision_document_tenant_company_fk"
    FOREIGN KEY ("documentId", "tenantId", "companyId")
    REFERENCES "FinanceOutflowDocument"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceOutflowDocumentRevision_company_tenant_fk"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceOutflowDocumentRevision_previous_journal_tenant_company_fk"
    FOREIGN KEY ("previousJournalEntryId", "tenantId", "companyId")
    REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceOutflowDocumentRevision_journal_tenant_company_fk"
    FOREIGN KEY ("journalEntryId", "tenantId", "companyId")
    REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceOutflowDocumentRevision_actor_tenant_fk"
    FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);

CREATE UNIQUE INDEX "FinanceOutflowDocumentRevision_id_tenant_company_key"
  ON "FinanceOutflowDocumentRevision" ("id", "tenantId", "companyId");
CREATE INDEX "FinanceOutflowDocumentRevision_tenant_company_document_version_idx"
  ON "FinanceOutflowDocumentRevision" ("tenantId", "companyId", "documentId", "version" DESC);

ALTER TABLE "FinanceOutflowDocumentRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceOutflowDocumentRevision" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinanceOutflowDocumentRevision_tenant_isolation" ON "FinanceOutflowDocumentRevision"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION "finance_outflow_document_revision_append_only"()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'FinanceOutflowDocumentRevision is append-only';
END;
$$;

CREATE TRIGGER "FinanceOutflowDocumentRevision_append_only"
  BEFORE UPDATE OR DELETE ON "FinanceOutflowDocumentRevision"
  FOR EACH ROW EXECUTE FUNCTION "finance_outflow_document_revision_append_only"();
