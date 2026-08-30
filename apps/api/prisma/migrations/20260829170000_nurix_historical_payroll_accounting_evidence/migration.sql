-- Extend historical Noorix payroll evidence only. These source proofs remain
-- isolated from HrPayrollRun, payments, journals and FinanceOutflowDocument.

CREATE TYPE "NurixHistoricalPayrollAccountingEvidenceAvailability" AS ENUM ('NONE', 'PRESENT');
CREATE TYPE "NurixHistoricalPayrollAccountingEvidenceKind" AS ENUM ('PAYROLL_INVOICE', 'JOURNAL_ENTRY', 'VAULT_ALLOCATION');

ALTER TABLE "NurixHistoricalPayrollEvidence"
  ADD COLUMN "sourceInvoiceEvidence" "NurixHistoricalPayrollAccountingEvidenceAvailability" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "sourceJournalEvidence" "NurixHistoricalPayrollAccountingEvidenceAvailability" NOT NULL DEFAULT 'NONE';

CREATE TABLE "NurixHistoricalPayrollAccountingEvidence" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "executionId" UUID NOT NULL,
  "runEvidenceId" UUID NOT NULL,
  "evidenceKind" "NurixHistoricalPayrollAccountingEvidenceKind" NOT NULL,
  "sourceRecordId" VARCHAR(160) NOT NULL,
  "sourceChecksum" CHAR(64) NOT NULL,
  "sourceNumber" VARCHAR(160),
  "sourceDate" TIMESTAMPTZ(6),
  "vaultSourceId" VARCHAR(160),
  "amount" DECIMAL(18,4),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NurixHistoricalPayrollAccountingEvidence_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NurixHistoricalPayrollAccountingEvidence_id_tenantId_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "NurixHistoricalPayrollAccountingEvidence_tenantId_executionId_evidenceKind_sourceRecordId_key" UNIQUE ("tenantId", "executionId", "evidenceKind", "sourceRecordId"),
  CONSTRAINT "NurixHistoricalPayrollAccountingEvidence_run_scope_fkey" FOREIGN KEY ("runEvidenceId", "tenantId", "companyId", "executionId") REFERENCES "NurixHistoricalPayrollEvidence"("id", "tenantId", "companyId", "executionId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixHistoricalPayrollAccountingEvidence_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixHistoricalPayrollAccountingEvidence_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "NurixHistoricalPayrollAccountingEvidence_tenantId_companyId_runEvidenceId_evidenceKind_idx"
  ON "NurixHistoricalPayrollAccountingEvidence" ("tenantId", "companyId", "runEvidenceId", "evidenceKind");

ALTER TABLE "NurixHistoricalPayrollAccountingEvidence" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NurixHistoricalPayrollAccountingEvidence" FORCE ROW LEVEL SECURITY;
CREATE POLICY "NurixHistoricalPayrollAccountingEvidence_tenant_isolation" ON "NurixHistoricalPayrollAccountingEvidence"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
