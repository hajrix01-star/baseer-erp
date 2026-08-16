-- BASEER ERP administration foundation.  This is additive and remains scoped
-- to the Baseer database; it never references Noorix data.
CREATE TABLE "TenantAdministrationAssignment" (
  "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "userId" UUID NOT NULL,
  "isOwner" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tenantId", "userId"),
  FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);
CREATE INDEX "TenantAdministrationAssignment_tenantId_isOwner_idx"
  ON "TenantAdministrationAssignment"("tenantId", "isOwner");

CREATE TABLE "CompanyBranding" (
  "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "companyId" UUID NOT NULL,
  "logoFileMetadataId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tenantId", "companyId"),
  UNIQUE ("companyId"),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT
);

ALTER TABLE "TenantAdministrationAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TenantAdministrationAssignment" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CompanyBranding" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyBranding" FORCE ROW LEVEL SECURITY;

CREATE POLICY "TenantAdministrationAssignment_tenant_isolation" ON "TenantAdministrationAssignment"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "CompanyBranding_tenant_isolation" ON "CompanyBranding"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
