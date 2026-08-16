CREATE TABLE "FinanceOutflowBatch" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "batchNumber" VARCHAR(80) NOT NULL,
  "businessDate" DATE NOT NULL,
  "documentCount" INTEGER NOT NULL,
  "grossAmount" DECIMAL(18,4) NOT NULL,
  "netAmount" DECIMAL(18,4) NOT NULL,
  "vatAmount" DECIMAL(18,4) NOT NULL,
  "notes" VARCHAR(2000),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceOutflowBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceOutflowBatch_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "FinanceOutflowBatch_company_batch_key" UNIQUE ("companyId", "batchNumber"),
  CONSTRAINT "FinanceOutflowBatch_document_count_check" CHECK ("documentCount" > 0),
  CONSTRAINT "FinanceOutflowBatch_amounts_check" CHECK ("grossAmount" > 0 AND "netAmount" >= 0 AND "vatAmount" >= 0 AND "grossAmount" = "netAmount" + "vatAmount")
);

ALTER TABLE "FinanceOutflowDocument" ADD COLUMN "batchId" UUID;
ALTER TABLE "FinanceOutflowBatch" ADD CONSTRAINT "FinanceOutflowBatch_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinanceOutflowDocument" ADD CONSTRAINT "FinanceOutflowDocument_batch_fkey" FOREIGN KEY ("batchId", "tenantId", "companyId") REFERENCES "FinanceOutflowBatch"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "FinanceOutflowBatch_tenant_company_date_idx" ON "FinanceOutflowBatch"("tenantId", "companyId", "businessDate");
CREATE INDEX "FinanceOutflowDocument_tenant_company_batch_idx" ON "FinanceOutflowDocument"("tenantId", "companyId", "batchId");

ALTER TABLE "FinanceOutflowBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceOutflowBatch" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON "FinanceOutflowBatch" USING ("tenantId" = current_setting('app.tenant_id', true)::uuid) WITH CHECK ("tenantId" = current_setting('app.tenant_id', true)::uuid);