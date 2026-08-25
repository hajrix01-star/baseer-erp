-- VAT simulations are saved planning records only. They do not reference a
-- payment, invoice, journal entry, or external filing provider.
CREATE TABLE "VatSimulation" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "year" INTEGER NOT NULL,
  "quarter" INTEGER NOT NULL,
  "vatRateBasisPoints" INTEGER NOT NULL,
  "salesTaxableAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "outputVatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "purchasesTaxableAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "inputVatAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "priorAdjustments" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "balanceCarried" DECIMAL(18,4) NOT NULL DEFAULT 0,
  "paymentTarget" DECIMAL(18,4),
  "notes" VARCHAR(1000),
  "sourceLedgerRevision" BIGINT,
  "sourceImportedAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "VatSimulation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "VatSimulation_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "VatSimulation_company_year_quarter_key" UNIQUE ("companyId", "year", "quarter"),
  CONSTRAINT "VatSimulation_quarter_check" CHECK ("quarter" BETWEEN 1 AND 4),
  CONSTRAINT "VatSimulation_year_check" CHECK ("year" BETWEEN 2000 AND 2100),
  CONSTRAINT "VatSimulation_rate_check" CHECK ("vatRateBasisPoints" BETWEEN 0 AND 10000),
  CONSTRAINT "VatSimulation_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "VatSimulation_creator_fkey" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "VatSimulation_updater_fkey" FOREIGN KEY ("updatedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "VatSimulation_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT
);
CREATE INDEX "VatSimulation_tenant_company_year_quarter_idx" ON "VatSimulation" ("tenantId", "companyId", "year", "quarter");

ALTER TABLE "VatSimulation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "VatSimulation" FORCE ROW LEVEL SECURITY;
CREATE POLICY "VatSimulation_tenant_isolation" ON "VatSimulation"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
