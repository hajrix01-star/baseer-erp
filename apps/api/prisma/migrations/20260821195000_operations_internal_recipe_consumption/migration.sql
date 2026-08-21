-- Internal registration is the operational consumption event. It remains
-- price-free to its staff UI, while the database keeps immutable recipe and
-- valuation snapshots for inventory integrity.

ALTER TYPE "OperationsInventoryMovementType" ADD VALUE IF NOT EXISTS 'INTERNAL_CONSUMPTION';

ALTER TABLE "OperationsInternalRegistrationLine"
  ADD COLUMN "recipeVersionId" UUID,
  ADD COLUMN "recipeOutputQuantitySnapshot" DECIMAL(24,8);

ALTER TABLE "OperationsInternalRegistrationLine"
  ADD CONSTRAINT "OperationsInternalRegistrationLine_recipeVersionId_tenantId_companyId_fkey"
  FOREIGN KEY ("recipeVersionId", "tenantId", "companyId")
  REFERENCES "OperationsRecipeVersion"("id", "tenantId", "companyId") ON DELETE RESTRICT;

CREATE INDEX "OperationsInternalRegistrationLine_recipeVersion_idx"
  ON "OperationsInternalRegistrationLine"("tenantId", "companyId", "recipeVersionId");

ALTER TABLE "OperationsRecipeLine"
  ADD CONSTRAINT "OperationsRecipeLine_id_tenantId_companyId_key"
  UNIQUE ("id", "tenantId", "companyId");

CREATE TABLE "OperationsInternalRegistrationConsumption" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "registrationLineId" UUID NOT NULL,
  "recipeVersionId" UUID NOT NULL,
  "recipeLineId" UUID NOT NULL,
  "rawMaterialItemId" UUID NOT NULL,
  "unitId" UUID NOT NULL,
  "baseUnitId" UUID NOT NULL,
  "conversionVersionId" UUID,
  "recipeQuantitySnapshot" DECIMAL(24,8) NOT NULL,
  "recipeResolvedBaseQuantitySnapshot" DECIMAL(24,8) NOT NULL,
  "consumedBaseQuantity" DECIMAL(24,8) NOT NULL,
  "weightedUnitCostSnapshot" DECIMAL(26,12) NOT NULL,
  "consumedValue" DECIMAL(18,4) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("registrationLineId", "recipeLineId"),
  CHECK ("recipeQuantitySnapshot" > 0),
  CHECK ("recipeResolvedBaseQuantitySnapshot" > 0),
  CHECK ("consumedBaseQuantity" > 0),
  CHECK ("weightedUnitCostSnapshot" >= 0),
  CHECK ("consumedValue" >= 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("registrationLineId", "tenantId", "companyId") REFERENCES "OperationsInternalRegistrationLine"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("recipeVersionId", "tenantId", "companyId") REFERENCES "OperationsRecipeVersion"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("recipeLineId", "tenantId", "companyId") REFERENCES "OperationsRecipeLine"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("rawMaterialItemId", "tenantId", "companyId") REFERENCES "OperationsItem"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("unitId", "tenantId", "companyId") REFERENCES "OperationsUnit"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("baseUnitId", "tenantId", "companyId") REFERENCES "OperationsUnit"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  FOREIGN KEY ("conversionVersionId", "tenantId", "companyId") REFERENCES "OperationsItemConversionVersion"("id", "tenantId", "companyId") ON DELETE RESTRICT
);

CREATE INDEX "OperationsInternalRegistrationConsumption_material_idx"
  ON "OperationsInternalRegistrationConsumption"("tenantId", "companyId", "rawMaterialItemId");
CREATE INDEX "OperationsInternalRegistrationConsumption_recipe_idx"
  ON "OperationsInternalRegistrationConsumption"("tenantId", "companyId", "recipeVersionId");

ALTER TABLE "OperationsInventoryMovement"
  ADD COLUMN "internalRegistrationConsumptionId" UUID;
ALTER TABLE "OperationsInventoryMovement"
  ADD CONSTRAINT "OperationsInventoryMovement_internalConsumption_single_key"
  UNIQUE ("internalRegistrationConsumptionId");
ALTER TABLE "OperationsInventoryMovement"
  ADD CONSTRAINT "OperationsInventoryMovement_internalConsumption_tenant_key"
  UNIQUE ("internalRegistrationConsumptionId", "tenantId", "companyId");
ALTER TABLE "OperationsInventoryMovement"
  ADD CONSTRAINT "OperationsInventoryMovement_internalRegistrationConsumption_tenant_company_fkey"
  FOREIGN KEY ("internalRegistrationConsumptionId", "tenantId", "companyId")
  REFERENCES "OperationsInternalRegistrationConsumption"("id", "tenantId", "companyId") ON DELETE RESTRICT;

ALTER TABLE "OperationsInternalRegistrationConsumption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "OperationsInternalRegistrationConsumption" FORCE ROW LEVEL SECURITY;
CREATE POLICY "OperationsInternalRegistrationConsumption_tenant_isolation"
  ON "OperationsInternalRegistrationConsumption"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE TRIGGER "OperationsInternalRegistrationConsumption_append_only"
  BEFORE UPDATE OR DELETE ON "OperationsInternalRegistrationConsumption"
  FOR EACH ROW EXECUTE FUNCTION "operations_block_append_only_mutation"();
