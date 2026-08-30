-- Durable, lease-backed control plane for non-financial Excel master-data waves.
CREATE TYPE "NurixExcelMasterDataExecutionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "NurixExcelMasterDataItemStatus" AS ENUM ('PENDING', 'CREATED', 'REUSED', 'REVIEW_REQUIRED');

CREATE TABLE "NurixExcelMasterDataExecution" (
  "id" UUID NOT NULL,
  "packageId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "targetCompanyId" UUID NOT NULL,
  "status" "NurixExcelMasterDataExecutionStatus" NOT NULL DEFAULT 'PENDING',
  "waveSequence" INTEGER NOT NULL DEFAULT 0,
  "reason" VARCHAR(500),
  "requestedByUserId" UUID NOT NULL,
  "leaseToken" UUID,
  "leaseExpiresAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NurixExcelMasterDataExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NurixExcelMasterDataExecution_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "NurixExcelMasterDataExecution_package_tenant_key" UNIQUE ("packageId", "tenantId")
);

CREATE TABLE "NurixExcelMasterDataItem" (
  "id" UUID NOT NULL,
  "executionId" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "entity" VARCHAR(40) NOT NULL,
  "sourceId" VARCHAR(160) NOT NULL,
  "sourceChecksum" CHAR(64) NOT NULL,
  "status" "NurixExcelMasterDataItemStatus" NOT NULL DEFAULT 'PENDING',
  "targetId" UUID,
  "code" VARCHAR(120),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NurixExcelMasterDataItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NurixExcelMasterDataItem_execution_entity_source_key" UNIQUE ("executionId", "entity", "sourceId")
);

CREATE INDEX "NurixExcelMasterDataExecution_tenant_company_status_updated_idx"
  ON "NurixExcelMasterDataExecution" ("tenantId", "targetCompanyId", "status", "updatedAt");
CREATE INDEX "NurixExcelMasterDataItem_tenant_execution_status_entity_source_idx"
  ON "NurixExcelMasterDataItem" ("tenantId", "executionId", "status", "entity", "sourceId");

ALTER TABLE "NurixExcelMasterDataExecution"
  ADD CONSTRAINT "NurixExcelMasterDataExecution_package_tenant_fkey"
  FOREIGN KEY ("packageId", "tenantId") REFERENCES "NurixExcelStagingPackage"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "NurixExcelMasterDataExecution_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "NurixExcelMasterDataExecution_company_tenant_fkey"
  FOREIGN KEY ("targetCompanyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "NurixExcelMasterDataItem"
  ADD CONSTRAINT "NurixExcelMasterDataItem_execution_tenant_fkey"
  FOREIGN KEY ("executionId", "tenantId") REFERENCES "NurixExcelMasterDataExecution"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "NurixExcelMasterDataItem_tenant_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
