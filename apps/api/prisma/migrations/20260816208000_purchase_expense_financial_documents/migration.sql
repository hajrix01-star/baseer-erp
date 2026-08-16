CREATE TYPE "FinanceOutflowDocumentKind" AS ENUM ('PURCHASE', 'EXPENSE');
CREATE TYPE "FinanceOutflowDocumentStatus" AS ENUM ('POSTED', 'CANCELLED');
CREATE TYPE "FinanceOutflowSettlementKind" AS ENUM ('PAID', 'PAYABLE');

CREATE TABLE "FinanceOutflowDocument" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "kind" "FinanceOutflowDocumentKind" NOT NULL,
  "status" "FinanceOutflowDocumentStatus" NOT NULL DEFAULT 'POSTED',
  "settlementKind" "FinanceOutflowSettlementKind" NOT NULL,
  "documentNumber" VARCHAR(80) NOT NULL,
  "supplierId" UUID,
  "categoryId" UUID NOT NULL,
  "supplierInvoiceNumber" VARCHAR(160),
  "supplierInvoiceNumberNormalized" VARCHAR(160),
  "supplierInvoiceMissingReason" VARCHAR(500),
  "businessDate" DATE NOT NULL,
  "supplierInvoiceDate" DATE,
  "grossAmount" DECIMAL(18,4) NOT NULL,
  "netAmount" DECIMAL(18,4) NOT NULL,
  "vatAmount" DECIMAL(18,4) NOT NULL,
  "vatRateBasisPoints" INTEGER NOT NULL DEFAULT 0,
  "notes" VARCHAR(2000),
  "journalEntryId" UUID NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "FinanceOutflowDocument_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceOutflowDocument_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "FinanceOutflowDocument_journal_tenant_company_key" UNIQUE ("journalEntryId", "tenantId", "companyId"),
  CONSTRAINT "FinanceOutflowDocument_company_document_key" UNIQUE ("companyId", "documentNumber"),
  CONSTRAINT "FinanceOutflowDocument_amounts_check" CHECK ("grossAmount" > 0 AND "netAmount" >= 0 AND "vatAmount" >= 0 AND "grossAmount" = "netAmount" + "vatAmount"),
  CONSTRAINT "FinanceOutflowDocument_vat_rate_check" CHECK ("vatRateBasisPoints" >= 0 AND "vatRateBasisPoints" <= 10000),
  CONSTRAINT "FinanceOutflowDocument_payable_supplier_check" CHECK ("settlementKind" <> 'PAYABLE' OR "supplierId" IS NOT NULL),
  CONSTRAINT "FinanceOutflowDocument_supplier_invoice_check" CHECK ("supplierInvoiceNumberNormalized" IS NOT NULL OR "supplierInvoiceMissingReason" IS NOT NULL)
);

CREATE TABLE "FinanceOutflowAllocation" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "documentId" UUID NOT NULL,
  "vaultId" UUID NOT NULL,
  "grossAmount" DECIMAL(18,4) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceOutflowAllocation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceOutflowAllocation_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "FinanceOutflowAllocation_document_vault_key" UNIQUE ("documentId", "vaultId"),
  CONSTRAINT "FinanceOutflowAllocation_amount_check" CHECK ("grossAmount" > 0)
);

ALTER TABLE "FinanceOutflowDocument" ADD CONSTRAINT "FinanceOutflowDocument_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceOutflowDocument" ADD CONSTRAINT "FinanceOutflowDocument_supplier_fkey" FOREIGN KEY ("supplierId", "tenantId", "companyId") REFERENCES "FinanceSupplier"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceOutflowDocument" ADD CONSTRAINT "FinanceOutflowDocument_category_fkey" FOREIGN KEY ("categoryId", "tenantId", "companyId") REFERENCES "FinanceCategory"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceOutflowDocument" ADD CONSTRAINT "FinanceOutflowDocument_journal_fkey" FOREIGN KEY ("journalEntryId", "tenantId", "companyId") REFERENCES "FinanceJournalEntry"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceOutflowAllocation" ADD CONSTRAINT "FinanceOutflowAllocation_document_fkey" FOREIGN KEY ("documentId", "tenantId", "companyId") REFERENCES "FinanceOutflowDocument"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceOutflowAllocation" ADD CONSTRAINT "FinanceOutflowAllocation_vault_fkey" FOREIGN KEY ("vaultId", "tenantId", "companyId") REFERENCES "FinanceVault"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "FinanceOutflowDocument_tenant_company_date_status_idx" ON "FinanceOutflowDocument"("tenantId", "companyId", "businessDate", "status");
CREATE INDEX "FinanceOutflowDocument_tenant_company_supplier_date_idx" ON "FinanceOutflowDocument"("tenantId", "companyId", "supplierId", "businessDate");
CREATE INDEX "FinanceOutflowAllocation_tenant_company_vault_created_idx" ON "FinanceOutflowAllocation"("tenantId", "companyId", "vaultId", "createdAt");
CREATE UNIQUE INDEX "FinanceOutflowDocument_active_supplier_invoice_key" ON "FinanceOutflowDocument"("companyId", "supplierId", "supplierInvoiceNumberNormalized") WHERE "status" = 'POSTED' AND "supplierInvoiceNumberNormalized" IS NOT NULL;

ALTER TABLE "FinanceOutflowDocument" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceOutflowDocument" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "FinanceOutflowDocument" USING ("tenantId" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);
ALTER TABLE "FinanceOutflowAllocation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceOutflowAllocation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "FinanceOutflowAllocation" USING ("tenantId" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);