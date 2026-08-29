-- Identity and alias foundation for safe counterparty migration.  It does not
-- merge suppliers and does not alter historical financial records.

CREATE TYPE "FinanceCounterpartyKind" AS ENUM ('COMMERCIAL_SUPPLIER', 'GOVERNMENT_AUTHORITY', 'GOVERNMENT_PLATFORM', 'UTILITY_PROVIDER', 'OTHER');
CREATE TYPE "FinanceCounterpartyAliasKind" AS ENUM ('CANONICAL', 'FORMER_NAME', 'TRADE_NAME', 'ABBREVIATION', 'SOURCE_VARIANT');

CREATE TABLE "FinanceCounterpartyIdentity" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "canonicalKey" VARCHAR(100) NOT NULL,
  "canonicalNameAr" VARCHAR(160) NOT NULL,
  "canonicalNameEn" VARCHAR(160),
  "kind" "FinanceCounterpartyKind" NOT NULL,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceCounterpartyIdentity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceCounterpartyIdentity_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "FinanceCounterpartyIdentity_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "FinanceCounterpartyIdentity_tenant_key_key" UNIQUE ("tenantId", "canonicalKey")
);
CREATE INDEX "FinanceCounterpartyIdentity_tenant_kind_active_idx" ON "FinanceCounterpartyIdentity" ("tenantId", "kind", "isActive");

CREATE TABLE "FinanceCounterpartyAlias" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "identityId" UUID NOT NULL,
  "normalizedAlias" VARCHAR(200) NOT NULL,
  "nameAr" VARCHAR(160),
  "nameEn" VARCHAR(160),
  "kind" "FinanceCounterpartyAliasKind" NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FinanceCounterpartyAlias_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FinanceCounterpartyAlias_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "FinanceCounterpartyAlias_identity_tenant_fkey" FOREIGN KEY ("identityId", "tenantId") REFERENCES "FinanceCounterpartyIdentity"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "FinanceCounterpartyAlias_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "FinanceCounterpartyAlias_tenant_normalized_key" UNIQUE ("tenantId", "normalizedAlias")
);
CREATE INDEX "FinanceCounterpartyAlias_tenant_identity_idx" ON "FinanceCounterpartyAlias" ("tenantId", "identityId");

ALTER TABLE "FinanceSupplier" ADD COLUMN "counterpartyIdentityId" UUID;
ALTER TABLE "FinanceSupplier" ADD CONSTRAINT "FinanceSupplier_identity_tenant_fkey" FOREIGN KEY ("counterpartyIdentityId", "tenantId") REFERENCES "FinanceCounterpartyIdentity"("id", "tenantId") ON DELETE RESTRICT;
CREATE INDEX "FinanceSupplier_tenant_identity_idx" ON "FinanceSupplier" ("tenantId", "counterpartyIdentityId");

ALTER TABLE "FinanceOutflowDocument"
  ADD COLUMN "supplierNameSnapshotAr" VARCHAR(160),
  ADD COLUMN "supplierNameSnapshotEn" VARCHAR(160);

ALTER TABLE "FinanceCounterpartyIdentity" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceCounterpartyIdentity" FORCE ROW LEVEL SECURITY;
ALTER TABLE "FinanceCounterpartyAlias" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FinanceCounterpartyAlias" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FinanceCounterpartyIdentity_tenant_isolation" ON "FinanceCounterpartyIdentity"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "FinanceCounterpartyAlias_tenant_isolation" ON "FinanceCounterpartyAlias"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
