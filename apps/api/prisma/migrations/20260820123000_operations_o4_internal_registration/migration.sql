-- O4: price-free internal production registration for bar, kitchen, and other sections.
-- These tables have no link to financial journals or sales prices.

CREATE TABLE "OperationsInternalRegistration" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "registrationNumber" VARCHAR(80) NOT NULL,
  "sectionId" UUID NOT NULL,
  "businessDate" DATE NOT NULL,
  "notes" VARCHAR(1000),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("companyId", "registrationNumber"),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("sectionId", "tenantId", "companyId") REFERENCES "OperationsSection"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);

CREATE TABLE "OperationsInternalRegistrationLine" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "registrationId" UUID NOT NULL,
  "lineNumber" INTEGER NOT NULL,
  "menuProductItemId" UUID NOT NULL,
  "unitId" UUID NOT NULL,
  "quantity" DECIMAL(24,8) NOT NULL,
  "productNameArSnapshot" VARCHAR(160) NOT NULL,
  "productNameEnSnapshot" VARCHAR(160),
  "unitNameArSnapshot" VARCHAR(80) NOT NULL,
  "unitNameEnSnapshot" VARCHAR(80),
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("registrationId", "lineNumber"),
  CHECK ("quantity" > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("registrationId", "tenantId", "companyId") REFERENCES "OperationsInternalRegistration"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("menuProductItemId", "tenantId", "companyId") REFERENCES "OperationsItem"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("unitId", "tenantId", "companyId") REFERENCES "OperationsUnit"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE INDEX "OperationsInternalRegistration_tenant_company_date_idx" ON "OperationsInternalRegistration"("tenantId", "companyId", "businessDate");
CREATE INDEX "OperationsInternalRegistration_tenant_company_section_date_idx" ON "OperationsInternalRegistration"("tenantId", "companyId", "sectionId", "businessDate");
CREATE INDEX "OperationsInternalRegistrationLine_tenant_company_product_idx" ON "OperationsInternalRegistrationLine"("tenantId", "companyId", "menuProductItemId");

ALTER TABLE "OperationsInternalRegistration" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsInternalRegistration" FORCE ROW LEVEL SECURITY;
ALTER TABLE "OperationsInternalRegistrationLine" ENABLE ROW LEVEL SECURITY; ALTER TABLE "OperationsInternalRegistrationLine" FORCE ROW LEVEL SECURITY;
CREATE POLICY "OperationsInternalRegistration_tenant_isolation" ON "OperationsInternalRegistration" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "OperationsInternalRegistrationLine_tenant_isolation" ON "OperationsInternalRegistrationLine" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE FUNCTION "operations_block_internal_registration_mutation"() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Internal registrations are append-only.';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "OperationsInternalRegistration_append_only" BEFORE UPDATE OR DELETE ON "OperationsInternalRegistration" FOR EACH ROW EXECUTE FUNCTION "operations_block_internal_registration_mutation"();
CREATE TRIGGER "OperationsInternalRegistrationLine_append_only" BEFORE UPDATE OR DELETE ON "OperationsInternalRegistrationLine" FOR EACH ROW EXECUTE FUNCTION "operations_block_internal_registration_mutation"();

INSERT INTO "RolePermission" ("tenantId", "roleId", "permissionCode")
SELECT role."tenantId", role."id", permission.code
FROM "Role" role CROSS JOIN (VALUES
  ('operations.internal_registration.create'),
  ('operations.internal_registration.read')
) AS permission(code)
WHERE role."code" = 'BASEER_COMPANY_MANAGER'
ON CONFLICT DO NOTHING;
