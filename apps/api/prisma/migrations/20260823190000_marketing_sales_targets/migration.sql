CREATE TABLE "MarketingSalesTarget" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "periodMonth" DATE NOT NULL,
  "amount" DECIMAL(18, 4) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "updatedByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MarketingSalesTarget_amount_positive" CHECK ("amount" > 0),
  CONSTRAINT "MarketingSalesTarget_first_of_month" CHECK (EXTRACT(DAY FROM "periodMonth") = 1),
  CONSTRAINT "MarketingSalesTarget_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingSalesTarget_created_by_fk" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingSalesTarget_updated_by_fk" FOREIGN KEY ("updatedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "MarketingSalesTarget_company_month_key" UNIQUE ("companyId", "periodMonth"),
  CONSTRAINT "MarketingSalesTarget_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId")
);

CREATE INDEX "MarketingSalesTarget_tenant_company_month_idx"
  ON "MarketingSalesTarget" ("tenantId", "companyId", "periodMonth");

ALTER TABLE "MarketingSalesTarget" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "MarketingSalesTarget" FORCE ROW LEVEL SECURITY;
CREATE POLICY "MarketingSalesTarget_tenant_isolation" ON "MarketingSalesTarget"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
