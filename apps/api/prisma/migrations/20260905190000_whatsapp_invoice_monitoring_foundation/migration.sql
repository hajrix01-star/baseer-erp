-- WAI-P1: company-scoped invoice monitoring foundations only. This migration
-- neither creates a WhatsApp session nor stores media bytes or financial rows.
CREATE TYPE "WhatsappInvoiceConnectionStatus" AS ENUM ('NOT_CONFIGURED', 'PLANNED', 'DISCONNECTED', 'CONNECTED', 'GAP_DETECTED', 'REAUTH_REQUIRED', 'BLOCKED');
CREATE TYPE "WhatsappInvoiceExtractionState" AS ENUM ('NOT_REQUESTED', 'QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "WhatsappInvoiceQualityState" AS ENUM ('VALID', 'INCOMPLETE', 'CONFLICT');
CREATE TYPE "WhatsappInvoiceApprovalState" AS ENUM ('APPROVED_MONITORING', 'INCOMPLETE');
CREATE TYPE "WhatsappInvoiceDuplicateState" AS ENUM ('UNCHECKED', 'CLEAR', 'SUSPECTED', 'CONFIRMED', 'DISMISSED');
CREATE TYPE "WhatsappInvoiceArchiveState" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "WhatsappInvoicePurchaseState" AS ENUM ('NOT_LINKED', 'PREPARING', 'DRAFT_LINKED', 'DOCUMENT_LINKED', 'CANCELLED');
CREATE TYPE "WhatsappInvoiceRevisionSource" AS ENUM ('INITIAL', 'MANUAL_CORRECTION', 'AI_REEXTRACTION');

CREATE TABLE "WhatsappInvoiceConnection" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL,
  "connectionKey" VARCHAR(80) NOT NULL, "status" "WhatsappInvoiceConnectionStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  "phoneNumberHint" VARCHAR(80), "lastSyncedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiConnection_tenant_fk" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "WaiConnection_tenant_key_key" UNIQUE ("tenantId", "connectionKey"),
  CONSTRAINT "WaiConnection_id_tenant_key" UNIQUE ("id", "tenantId")
);
CREATE INDEX "WaiConnection_tenant_status_idx" ON "WhatsappInvoiceConnection" ("tenantId", "status");

CREATE TABLE "WhatsappInvoiceGroupBinding" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "connectionId" UUID NOT NULL,
  "groupJid" VARCHAR(240) NOT NULL, "displayName" VARCHAR(240) NOT NULL, "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "bindingRevision" INTEGER NOT NULL DEFAULT 1, "createdByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiGroupBinding_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "WaiGroupBinding_connection_fk" FOREIGN KEY ("connectionId", "tenantId") REFERENCES "WhatsappInvoiceConnection"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "WaiGroupBinding_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "WaiGroupBinding_revision_positive" CHECK ("bindingRevision" > 0)
);
CREATE INDEX "WaiGroupBinding_tenant_company_active_idx" ON "WhatsappInvoiceGroupBinding" ("tenantId", "companyId", "active");
CREATE INDEX "WaiGroupBinding_tenant_connection_jid_idx" ON "WhatsappInvoiceGroupBinding" ("tenantId", "connectionId", "groupJid");
-- A JID belongs to at most one active company binding on one tenant connection.
CREATE UNIQUE INDEX "WaiGroupBinding_active_connection_jid_key" ON "WhatsappInvoiceGroupBinding" ("tenantId", "connectionId", "groupJid") WHERE "active" = TRUE;

CREATE TABLE "WhatsappInboundMessage" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "connectionId" UUID NOT NULL,
  "groupBindingId" UUID, "groupBindingRevision" INTEGER, "whatsappMessageId" VARCHAR(240) NOT NULL, "groupJidSnapshot" VARCHAR(240) NOT NULL,
  "receivedAt" TIMESTAMPTZ(6) NOT NULL, "importedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiInboundMessage_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "WaiInboundMessage_connection_fk" FOREIGN KEY ("connectionId", "tenantId") REFERENCES "WhatsappInvoiceConnection"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "WaiInboundMessage_binding_fk" FOREIGN KEY ("groupBindingId", "tenantId", "companyId") REFERENCES "WhatsappInvoiceGroupBinding"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "WaiInboundMessage_connection_group_message_key" UNIQUE ("tenantId", "connectionId", "groupJidSnapshot", "whatsappMessageId"),
  CONSTRAINT "WaiInboundMessage_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId")
);
CREATE INDEX "WaiInboundMessage_tenant_company_received_idx" ON "WhatsappInboundMessage" ("tenantId", "companyId", "receivedAt");
CREATE INDEX "WaiInboundMessage_tenant_company_binding_received_idx" ON "WhatsappInboundMessage" ("tenantId", "companyId", "groupBindingId", "receivedAt");

CREATE TABLE "WhatsappInvoiceAsset" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "inboundMessageId" UUID NOT NULL, "attachmentIndex" INTEGER NOT NULL,
  "originalFileName" VARCHAR(500) NOT NULL, "mimeType" VARCHAR(160) NOT NULL, "byteSize" BIGINT, "sha256" CHAR(64),
  "pageCount" INTEGER NOT NULL DEFAULT 1, "receivedAt" TIMESTAMPTZ(6) NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiAsset_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "WaiAsset_message_fk" FOREIGN KEY ("inboundMessageId", "tenantId", "companyId") REFERENCES "WhatsappInboundMessage"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "WaiAsset_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "WaiAsset_message_attachment_key" UNIQUE ("tenantId", "companyId", "inboundMessageId", "attachmentIndex"),
  CONSTRAINT "WaiAsset_attachment_index_nonnegative" CHECK ("attachmentIndex" >= 0),
  CONSTRAINT "WaiAsset_page_count_positive" CHECK ("pageCount" > 0)
);
CREATE INDEX "WaiAsset_tenant_company_received_idx" ON "WhatsappInvoiceAsset" ("tenantId", "companyId", "receivedAt");
CREATE INDEX "WaiAsset_tenant_company_message_idx" ON "WhatsappInvoiceAsset" ("tenantId", "companyId", "inboundMessageId");

CREATE TABLE "WhatsappInvoiceAssetPage" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "assetId" UUID NOT NULL,
  "pageNumber" INTEGER NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiAssetPage_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "WaiAssetPage_asset_fk" FOREIGN KEY ("assetId", "tenantId", "companyId") REFERENCES "WhatsappInvoiceAsset"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "WaiAssetPage_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "WaiAssetPage_asset_page_key" UNIQUE ("tenantId", "companyId", "assetId", "pageNumber"),
  CONSTRAINT "WaiAssetPage_page_positive" CHECK ("pageNumber" > 0)
);
CREATE INDEX "WaiAssetPage_tenant_company_asset_idx" ON "WhatsappInvoiceAssetPage" ("tenantId", "companyId", "assetId");

CREATE TABLE "WhatsappInvoiceRecord" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "groupBindingId" UUID, "supplierId" UUID,
  "supplierName" VARCHAR(240), "supplierNameKey" VARCHAR(300), "supplierTaxNumber" VARCHAR(80), "invoiceNumber" VARCHAR(160), "invoiceNumberKey" VARCHAR(200),
  "invoiceDate" DATE, "receivedAt" TIMESTAMPTZ(6) NOT NULL, "currencyCode" CHAR(3),
  "netAmount" DECIMAL(18,2), "vatAmount" DECIMAL(18,2), "grossAmount" DECIMAL(18,2),
  "extractionState" "WhatsappInvoiceExtractionState" NOT NULL DEFAULT 'NOT_REQUESTED', "qualityState" "WhatsappInvoiceQualityState" NOT NULL DEFAULT 'INCOMPLETE',
  "approvalState" "WhatsappInvoiceApprovalState" NOT NULL DEFAULT 'INCOMPLETE', "duplicateState" "WhatsappInvoiceDuplicateState" NOT NULL DEFAULT 'UNCHECKED',
  "archiveState" "WhatsappInvoiceArchiveState" NOT NULL DEFAULT 'ACTIVE', "archivedAt" TIMESTAMPTZ(6), "purchaseState" "WhatsappInvoicePurchaseState" NOT NULL DEFAULT 'NOT_LINKED',
  "rowVersion" INTEGER NOT NULL DEFAULT 0, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiRecord_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "WaiRecord_binding_fk" FOREIGN KEY ("groupBindingId", "tenantId", "companyId") REFERENCES "WhatsappInvoiceGroupBinding"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "WaiRecord_supplier_fk" FOREIGN KEY ("supplierId", "tenantId", "companyId") REFERENCES "FinanceSupplier"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "WaiRecord_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "WaiRecord_row_version_nonnegative" CHECK ("rowVersion" >= 0)
);
CREATE INDEX "WaiRecord_tenant_company_received_id_idx" ON "WhatsappInvoiceRecord" ("tenantId", "companyId", "receivedAt", "id");
CREATE INDEX "WaiRecord_tenant_company_invoice_id_idx" ON "WhatsappInvoiceRecord" ("tenantId", "companyId", "invoiceDate", "id");
CREATE INDEX "WaiRecord_tenant_company_archive_duplicate_idx" ON "WhatsappInvoiceRecord" ("tenantId", "companyId", "archiveState", "duplicateState");
CREATE INDEX "WaiRecord_tenant_company_supplier_invoice_key_idx" ON "WhatsappInvoiceRecord" ("tenantId", "companyId", "supplierNameKey", "invoiceNumberKey");
CREATE INDEX "WaiRecord_tenant_company_supplier_idx" ON "WhatsappInvoiceRecord" ("tenantId", "companyId", "supplierId");

CREATE TABLE "WhatsappInvoicePageAssignment" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "recordId" UUID NOT NULL, "assetPageId" UUID NOT NULL, "sourceRevision" INTEGER NOT NULL DEFAULT 1, "sortOrder" INTEGER NOT NULL DEFAULT 0, "active" BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiPageAssignment_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "WaiPageAssignment_record_fk" FOREIGN KEY ("recordId", "tenantId", "companyId") REFERENCES "WhatsappInvoiceRecord"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "WaiPageAssignment_page_fk" FOREIGN KEY ("assetPageId", "tenantId", "companyId") REFERENCES "WhatsappInvoiceAssetPage"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "WaiPageAssignment_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "WaiPageAssignment_record_page_revision_key" UNIQUE ("tenantId", "companyId", "recordId", "assetPageId", "sourceRevision"),
  CONSTRAINT "WaiPageAssignment_source_revision_positive" CHECK ("sourceRevision" > 0)
);
CREATE INDEX "WaiPageAssignment_tenant_company_record_idx" ON "WhatsappInvoicePageAssignment" ("tenantId", "companyId", "recordId");
CREATE INDEX "WaiPageAssignment_tenant_company_page_active_idx" ON "WhatsappInvoicePageAssignment" ("tenantId", "companyId", "assetPageId", "active");
CREATE UNIQUE INDEX "WaiPageAssignment_active_page_partition_key" ON "WhatsappInvoicePageAssignment" ("tenantId", "companyId", "assetPageId") WHERE "active" = TRUE;

CREATE TABLE "WhatsappInvoiceExtractionRevision" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "recordId" UUID NOT NULL,
  "revision" INTEGER NOT NULL, "source" "WhatsappInvoiceRevisionSource" NOT NULL, "valuesJson" JSONB NOT NULL, "createdByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiRevision_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "WaiRevision_record_fk" FOREIGN KEY ("recordId", "tenantId", "companyId") REFERENCES "WhatsappInvoiceRecord"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "WaiRevision_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "WaiRevision_record_revision_key" UNIQUE ("tenantId", "companyId", "recordId", "revision"),
  CONSTRAINT "WaiRevision_positive" CHECK ("revision" > 0)
);
CREATE INDEX "WaiRevision_tenant_company_record_created_idx" ON "WhatsappInvoiceExtractionRevision" ("tenantId", "companyId", "recordId", "createdAt");

CREATE TABLE "WhatsappInvoiceReview" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "recordId" UUID NOT NULL,
  "reason" VARCHAR(500) NOT NULL, "beforeJson" JSONB NOT NULL, "afterJson" JSONB NOT NULL, "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiReview_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "WaiReview_record_fk" FOREIGN KEY ("recordId", "tenantId", "companyId") REFERENCES "WhatsappInvoiceRecord"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "WaiReview_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId")
);
CREATE INDEX "WaiReview_tenant_company_record_created_idx" ON "WhatsappInvoiceReview" ("tenantId", "companyId", "recordId", "createdAt");

CREATE TABLE "WhatsappInvoiceDuplicateAssessment" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(), "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "recordId" UUID NOT NULL, "candidateRecordId" UUID,
  "state" "WhatsappInvoiceDuplicateState" NOT NULL, "evidenceJson" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaiDuplicate_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "WaiDuplicate_record_fk" FOREIGN KEY ("recordId", "tenantId", "companyId") REFERENCES "WhatsappInvoiceRecord"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "WaiDuplicate_candidate_fk" FOREIGN KEY ("candidateRecordId", "tenantId", "companyId") REFERENCES "WhatsappInvoiceRecord"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "WaiDuplicate_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId")
);
CREATE INDEX "WaiDuplicate_tenant_company_record_created_idx" ON "WhatsappInvoiceDuplicateAssessment" ("tenantId", "companyId", "recordId", "createdAt");
CREATE INDEX "WaiDuplicate_tenant_company_candidate_created_idx" ON "WhatsappInvoiceDuplicateAssessment" ("tenantId", "companyId", "candidateRecordId", "createdAt");

-- Every new table has tenant RLS. The app role may read/write only through a
-- tenant transaction; user/action authorization remains in the Nest boundary.
DO $$ DECLARE table_name TEXT; BEGIN FOREACH table_name IN ARRAY ARRAY[
  'WhatsappInvoiceConnection','WhatsappInvoiceGroupBinding','WhatsappInboundMessage','WhatsappInvoiceAsset','WhatsappInvoiceAssetPage',
  'WhatsappInvoiceRecord','WhatsappInvoicePageAssignment','WhatsappInvoiceExtractionRevision','WhatsappInvoiceReview','WhatsappInvoiceDuplicateAssessment'
] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
  EXECUTE format('CREATE POLICY %I ON %I USING ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)', table_name || '_tenant_isolation', table_name);
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseer_app') THEN EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO baseer_app', table_name); END IF;
END LOOP; END $$;

-- Review/evidence histories are append-only; correcting the record creates a
-- successor revision and review audit rather than changing past evidence.
CREATE OR REPLACE FUNCTION "baseer_prevent_whatsapp_invoice_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Whatsapp invoice monitoring history rows are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "WaiRevision_append_only" BEFORE UPDATE OR DELETE ON "WhatsappInvoiceExtractionRevision" FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_whatsapp_invoice_history_mutation"();
CREATE TRIGGER "WaiReview_append_only" BEFORE UPDATE OR DELETE ON "WhatsappInvoiceReview" FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_whatsapp_invoice_history_mutation"();
CREATE TRIGGER "WaiDuplicate_append_only" BEFORE UPDATE OR DELETE ON "WhatsappInvoiceDuplicateAssessment" FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_whatsapp_invoice_history_mutation"();
