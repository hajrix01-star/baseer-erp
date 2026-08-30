-- Close the tenant-isolation gap in the already-deployed master-data control
-- plane. FORCE is intentional: a table owner must not silently bypass tenant
-- policies in an interactive migration transaction.
ALTER TABLE "NurixExcelMasterDataExecution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NurixExcelMasterDataExecution" FORCE ROW LEVEL SECURITY;
ALTER TABLE "NurixExcelMasterDataItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NurixExcelMasterDataItem" FORCE ROW LEVEL SECURITY;

CREATE POLICY "NurixExcelMasterDataExecution_tenant_isolation" ON "NurixExcelMasterDataExecution"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "NurixExcelMasterDataItem_tenant_isolation" ON "NurixExcelMasterDataItem"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- This is a control plane only. It intentionally contains no invoice, journal,
-- payment, allocation, or raw Excel payload column. A later writer must use
-- these immutable keys and receipts inside the same transaction as its facts.
CREATE TYPE "NurixExcelFinancialExecutionStatus" AS ENUM (
  'PENDING', 'READY_FOR_APPROVAL', 'APPROVED', 'RUNNING', 'RECONCILING',
  'COMPLETED', 'FAILED', 'CANCELLED'
);
CREATE TYPE "NurixExcelFinancialWaveStatus" AS ENUM (
  'PENDING', 'RUNNING', 'COMMITTED', 'FAILED', 'CANCELLED'
);
CREATE TYPE "NurixExcelFinancialItemStatus" AS ENUM (
  'PENDING', 'PLANNED', 'POSTED', 'REUSED', 'REVIEW_REQUIRED', 'FAILED', 'EXCLUDED'
);
CREATE TYPE "NurixExcelFinancialSourceMapState" AS ENUM (
  'PLANNED', 'APPLIED', 'REUSED', 'REVERSED'
);
CREATE TYPE "NurixExcelFinancialReceiptKind" AS ENUM (
  'DRY_RUN', 'WAVE_COMMITTED', 'RECONCILIATION', 'FAILURE', 'CANCELLATION'
);

CREATE TABLE "NurixExcelFinancialExecution" (
  "id" uuid NOT NULL,
  "packageId" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "targetCompanyId" uuid NOT NULL,
  "transformVersion" varchar(80) NOT NULL,
  "financialPlanSha256" char(64) NOT NULL,
  "status" "NurixExcelFinancialExecutionStatus" NOT NULL DEFAULT 'PENDING',
  "reason" varchar(500),
  "requestedByUserId" uuid NOT NULL,
  "approvedByUserId" uuid,
  "approvedAt" timestamptz(6),
  "leaseToken" uuid,
  "leaseExpiresAt" timestamptz(6),
  "waveSequence" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NurixExcelFinancialExecution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NurixExcelFinancialExecution_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "NurixExcelFinancialExecution_id_tenant_company_key" UNIQUE ("id", "tenantId", "targetCompanyId"),
  CONSTRAINT "NurixExcelFinancialExecution_package_tenant_transform_key" UNIQUE ("packageId", "tenantId", "transformVersion"),
  CONSTRAINT "NurixExcelFinancialExecution_package_tenant_fkey"
    FOREIGN KEY ("packageId", "tenantId") REFERENCES "NurixExcelStagingPackage"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialExecution_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialExecution_company_tenant_fkey"
    FOREIGN KEY ("targetCompanyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialExecution_requester_tenant_fkey"
    FOREIGN KEY ("requestedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialExecution_approver_tenant_fkey"
    FOREIGN KEY ("approvedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "NurixExcelFinancialWave" (
  "id" uuid NOT NULL,
  "executionId" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "targetCompanyId" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "status" "NurixExcelFinancialWaveStatus" NOT NULL DEFAULT 'PENDING',
  "plannedItems" integer NOT NULL DEFAULT 0,
  "postedItems" integer NOT NULL DEFAULT 0,
  "reusedItems" integer NOT NULL DEFAULT 0,
  "reviewItems" integer NOT NULL DEFAULT 0,
  "failedItems" integer NOT NULL DEFAULT 0,
  "leaseToken" uuid,
  "leaseExpiresAt" timestamptz(6),
  "committedAt" timestamptz(6),
  "reconciliationHash" char(64),
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NurixExcelFinancialWave_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NurixExcelFinancialWave_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "NurixExcelFinancialWave_id_tenant_company_key" UNIQUE ("id", "tenantId", "targetCompanyId"),
  CONSTRAINT "NurixExcelFinancialWave_execution_sequence_key" UNIQUE ("executionId", "sequence"),
  CONSTRAINT "NurixExcelFinancialWave_execution_tenant_company_fkey"
    FOREIGN KEY ("executionId", "tenantId", "targetCompanyId") REFERENCES "NurixExcelFinancialExecution"("id", "tenantId", "targetCompanyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialWave_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialWave_company_tenant_fkey"
    FOREIGN KEY ("targetCompanyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "NurixExcelFinancialItem" (
  "id" uuid NOT NULL,
  "executionId" uuid NOT NULL,
  "waveId" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "targetCompanyId" uuid NOT NULL,
  "sourceSheet" varchar(80) NOT NULL,
  "sourceEntity" varchar(120) NOT NULL,
  "sourceId" varchar(160) NOT NULL,
  "sourceChecksum" char(64) NOT NULL,
  "operationKey" char(64) NOT NULL,
  "status" "NurixExcelFinancialItemStatus" NOT NULL DEFAULT 'PENDING',
  "targetEntity" varchar(120),
  "targetId" varchar(160),
  "resultCode" varchar(120),
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NurixExcelFinancialItem_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NurixExcelFinancialItem_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "NurixExcelFinancialItem_execution_source_key" UNIQUE ("executionId", "sourceEntity", "sourceId"),
  CONSTRAINT "NurixExcelFinancialItem_execution_operation_key" UNIQUE ("executionId", "operationKey"),
  CONSTRAINT "NurixExcelFinancialItem_execution_tenant_company_fkey"
    FOREIGN KEY ("executionId", "tenantId", "targetCompanyId") REFERENCES "NurixExcelFinancialExecution"("id", "tenantId", "targetCompanyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialItem_wave_tenant_company_fkey"
    FOREIGN KEY ("waveId", "tenantId", "targetCompanyId") REFERENCES "NurixExcelFinancialWave"("id", "tenantId", "targetCompanyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialItem_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialItem_company_tenant_fkey"
    FOREIGN KEY ("targetCompanyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "NurixExcelFinancialSourceMap" (
  "id" uuid NOT NULL,
  "executionId" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "targetCompanyId" uuid NOT NULL,
  "sourceEntity" varchar(120) NOT NULL,
  "sourceId" varchar(160) NOT NULL,
  "sourceChecksum" char(64) NOT NULL,
  "targetEntity" varchar(120) NOT NULL,
  "targetId" varchar(160) NOT NULL,
  "state" "NurixExcelFinancialSourceMapState" NOT NULL DEFAULT 'PLANNED',
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NurixExcelFinancialSourceMap_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NurixExcelFinancialSourceMap_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "NurixExcelFinancialSourceMap_execution_source_key" UNIQUE ("executionId", "sourceEntity", "sourceId"),
  CONSTRAINT "NurixExcelFinancialSourceMap_execution_tenant_company_fkey"
    FOREIGN KEY ("executionId", "tenantId", "targetCompanyId") REFERENCES "NurixExcelFinancialExecution"("id", "tenantId", "targetCompanyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialSourceMap_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialSourceMap_company_tenant_fkey"
    FOREIGN KEY ("targetCompanyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "NurixExcelFinancialReceipt" (
  "id" uuid NOT NULL,
  "executionId" uuid NOT NULL,
  "waveId" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "targetCompanyId" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "kind" "NurixExcelFinancialReceiptKind" NOT NULL,
  "receiptSha256" char(64) NOT NULL,
  "summaryJson" jsonb NOT NULL,
  "createdByUserId" uuid NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NurixExcelFinancialReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NurixExcelFinancialReceipt_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "NurixExcelFinancialReceipt_execution_sequence_key" UNIQUE ("executionId", "sequence"),
  CONSTRAINT "NurixExcelFinancialReceipt_execution_tenant_company_fkey"
    FOREIGN KEY ("executionId", "tenantId", "targetCompanyId") REFERENCES "NurixExcelFinancialExecution"("id", "tenantId", "targetCompanyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialReceipt_wave_tenant_company_fkey"
    FOREIGN KEY ("waveId", "tenantId", "targetCompanyId") REFERENCES "NurixExcelFinancialWave"("id", "tenantId", "targetCompanyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialReceipt_tenant_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialReceipt_company_tenant_fkey"
    FOREIGN KEY ("targetCompanyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelFinancialReceipt_creator_tenant_fkey"
    FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "NurixExcelFinancialExecution_scope_status_updated_idx"
  ON "NurixExcelFinancialExecution" ("tenantId", "targetCompanyId", "status", "updatedAt");
CREATE INDEX "NurixExcelFinancialExecution_package_status_idx"
  ON "NurixExcelFinancialExecution" ("tenantId", "packageId", "status");
CREATE INDEX "NurixExcelFinancialWave_scope_status_updated_idx"
  ON "NurixExcelFinancialWave" ("tenantId", "targetCompanyId", "status", "updatedAt");
CREATE INDEX "NurixExcelFinancialWave_execution_status_sequence_idx"
  ON "NurixExcelFinancialWave" ("tenantId", "executionId", "status", "sequence");
CREATE INDEX "NurixExcelFinancialItem_scope_status_source_idx"
  ON "NurixExcelFinancialItem" ("tenantId", "targetCompanyId", "status", "sourceEntity", "sourceId");
CREATE INDEX "NurixExcelFinancialItem_wave_status_idx"
  ON "NurixExcelFinancialItem" ("tenantId", "waveId", "status");
CREATE INDEX "NurixExcelFinancialSourceMap_scope_target_idx"
  ON "NurixExcelFinancialSourceMap" ("tenantId", "targetCompanyId", "targetEntity", "targetId");
CREATE INDEX "NurixExcelFinancialSourceMap_execution_state_idx"
  ON "NurixExcelFinancialSourceMap" ("tenantId", "executionId", "state");
CREATE INDEX "NurixExcelFinancialReceipt_scope_created_idx"
  ON "NurixExcelFinancialReceipt" ("tenantId", "targetCompanyId", "createdAt");
CREATE INDEX "NurixExcelFinancialReceipt_wave_kind_created_idx"
  ON "NurixExcelFinancialReceipt" ("tenantId", "waveId", "kind", "createdAt");

ALTER TABLE "NurixExcelFinancialExecution" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NurixExcelFinancialExecution" FORCE ROW LEVEL SECURITY;
ALTER TABLE "NurixExcelFinancialWave" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NurixExcelFinancialWave" FORCE ROW LEVEL SECURITY;
ALTER TABLE "NurixExcelFinancialItem" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NurixExcelFinancialItem" FORCE ROW LEVEL SECURITY;
ALTER TABLE "NurixExcelFinancialSourceMap" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NurixExcelFinancialSourceMap" FORCE ROW LEVEL SECURITY;
ALTER TABLE "NurixExcelFinancialReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NurixExcelFinancialReceipt" FORCE ROW LEVEL SECURITY;

CREATE POLICY "NurixExcelFinancialExecution_tenant_isolation" ON "NurixExcelFinancialExecution"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "NurixExcelFinancialWave_tenant_isolation" ON "NurixExcelFinancialWave"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "NurixExcelFinancialItem_tenant_isolation" ON "NurixExcelFinancialItem"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "NurixExcelFinancialSourceMap_tenant_isolation" ON "NurixExcelFinancialSourceMap"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "NurixExcelFinancialReceipt_tenant_isolation" ON "NurixExcelFinancialReceipt"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
