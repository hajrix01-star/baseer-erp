CREATE TYPE "NurixExcelStagingPackageStatus" AS ENUM ('RECEIVED', 'PARSED', 'QUARANTINED', 'READY_FOR_RECONCILIATION', 'FAILED');
CREATE TYPE "NurixExcelStagingBatchStatus" AS ENUM ('PENDING', 'PARSED', 'VALIDATED', 'QUARANTINED', 'FAILED');
CREATE TYPE "NurixExcelStagingRowStatus" AS ENUM ('ACCEPTED', 'QUARANTINED', 'REJECTED', 'SKIPPED');

CREATE TABLE "NurixExcelStagingPackage" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "targetCompanyId" uuid NOT NULL,
  "sourceCompanyId" varchar(120) NOT NULL,
  "templateVersion" varchar(80) NOT NULL,
  "workbookSha256" char(64) NOT NULL,
  "sourceFingerprint" char(64),
  "storageReference" varchar(500),
  "encryptionIv" varchar(40),
  "storedByteSize" bigint,
  "status" "NurixExcelStagingPackageStatus" NOT NULL DEFAULT 'RECEIVED',
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(6) NOT NULL,
  CONSTRAINT "NurixExcelStagingPackage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NurixExcelStagingPackage_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "NurixExcelStagingPackage_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelStagingPackage_company_fkey" FOREIGN KEY ("targetCompanyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "NurixExcelStagingBatch" (
  "id" uuid NOT NULL,
  "packageId" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "sequence" integer NOT NULL,
  "status" "NurixExcelStagingBatchStatus" NOT NULL DEFAULT 'PENDING',
  "rowsDeclared" integer NOT NULL DEFAULT 0,
  "rowsAccepted" integer NOT NULL DEFAULT 0,
  "rowsRejected" integer NOT NULL DEFAULT 0,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(6) NOT NULL,
  CONSTRAINT "NurixExcelStagingBatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NurixExcelStagingBatch_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "NurixExcelStagingBatch_package_fkey" FOREIGN KEY ("packageId", "tenantId") REFERENCES "NurixExcelStagingPackage"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelStagingBatch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "NurixExcelStagingRow" (
  "id" uuid NOT NULL,
  "packageId" uuid NOT NULL,
  "batchId" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "sheet" varchar(80) NOT NULL,
  "sourceId" varchar(160) NOT NULL,
  "sourceChecksum" char(64) NOT NULL,
  "status" "NurixExcelStagingRowStatus" NOT NULL,
  "code" varchar(120) NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NurixExcelStagingRow_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NurixExcelStagingRow_package_fkey" FOREIGN KEY ("packageId", "tenantId") REFERENCES "NurixExcelStagingPackage"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelStagingRow_batch_fkey" FOREIGN KEY ("batchId", "tenantId") REFERENCES "NurixExcelStagingBatch"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NurixExcelStagingRow_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NurixExcelStagingPackage_tenant_company_hash_key" ON "NurixExcelStagingPackage"("tenantId", "targetCompanyId", "workbookSha256");
CREATE INDEX "NurixExcelStagingPackage_scope_status_idx" ON "NurixExcelStagingPackage"("tenantId", "targetCompanyId", "status", "createdAt");
CREATE UNIQUE INDEX "NurixExcelStagingBatch_package_sequence_key" ON "NurixExcelStagingBatch"("packageId", "sequence");
CREATE INDEX "NurixExcelStagingBatch_scope_status_idx" ON "NurixExcelStagingBatch"("tenantId", "packageId", "status", "sequence");
CREATE UNIQUE INDEX "NurixExcelStagingRow_id_tenant_key" ON "NurixExcelStagingRow"("id", "tenantId");
CREATE UNIQUE INDEX "NurixExcelStagingRow_package_sheet_source_key" ON "NurixExcelStagingRow"("packageId", "sheet", "sourceId");
CREATE INDEX "NurixExcelStagingRow_scope_status_idx" ON "NurixExcelStagingRow"("tenantId", "packageId", "status", "sheet");
CREATE INDEX "NurixExcelStagingRow_checksum_idx" ON "NurixExcelStagingRow"("tenantId", "sourceChecksum");

ALTER TABLE "NurixExcelStagingPackage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NurixExcelStagingBatch" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "NurixExcelStagingRow" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "NurixExcelStagingPackage_tenant_isolation" ON "NurixExcelStagingPackage"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "NurixExcelStagingBatch_tenant_isolation" ON "NurixExcelStagingBatch"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "NurixExcelStagingRow_tenant_isolation" ON "NurixExcelStagingRow"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
