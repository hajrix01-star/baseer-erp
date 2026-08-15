CREATE TYPE "FileMetadataStatus" AS ENUM ('RESERVED', 'SUPERSEDED');

CREATE TABLE "FileMetadata" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "companyId" UUID NOT NULL,
  "sourceType" VARCHAR(80) NOT NULL,
  "sourceId" UUID NOT NULL,
  "purpose" VARCHAR(80) NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "FileMetadataStatus" NOT NULL DEFAULT 'RESERVED',
  "displayName" VARCHAR(240) NOT NULL,
  "declaredMimeType" VARCHAR(127) NOT NULL,
  "declaredByteSize" BIGINT NOT NULL,
  "declaredSha256" CHAR(64) NOT NULL,
  "storageReference" VARCHAR(255) NOT NULL UNIQUE,
  "replacesFileMetadataId" UUID NULL,
  "supersededAt" TIMESTAMPTZ(6) NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FileMetadata_company_tenant_fkey"
    FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "FileMetadata_creator_tenant_fkey"
    FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "FileMetadata_replaces_scope_fkey"
    FOREIGN KEY ("replacesFileMetadataId", "tenantId", "companyId")
    REFERENCES "FileMetadata"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "FileMetadata_version_positive" CHECK ("version" > 0),
  CONSTRAINT "FileMetadata_source_type_nonempty" CHECK (length("sourceType") > 0),
  CONSTRAINT "FileMetadata_purpose_nonempty" CHECK (length("purpose") > 0),
  CONSTRAINT "FileMetadata_display_name_nonempty" CHECK (length("displayName") > 0),
  CONSTRAINT "FileMetadata_declared_mime_nonempty" CHECK (length("declaredMimeType") > 0),
  CONSTRAINT "FileMetadata_declared_size_range" CHECK ("declaredByteSize" BETWEEN 1 AND 10485760),
  CONSTRAINT "FileMetadata_declared_sha256_format" CHECK ("declaredSha256" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "FileMetadata_supersession_status" CHECK (
    ("status" = 'RESERVED' AND "supersededAt" IS NULL)
    OR ("status" = 'SUPERSEDED' AND "supersededAt" IS NOT NULL)
  ),
  UNIQUE ("id", "tenantId", "companyId"),
  UNIQUE ("tenantId", "companyId", "sourceType", "sourceId", "purpose", "version")
);

CREATE INDEX "FileMetadata_tenant_company_source_status_idx"
  ON "FileMetadata"("tenantId", "companyId", "sourceType", "sourceId", "purpose", "status");
CREATE INDEX "FileMetadata_tenant_company_sha256_idx"
  ON "FileMetadata"("tenantId", "companyId", "declaredSha256");

ALTER TABLE "FileMetadata" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "FileMetadata" FORCE ROW LEVEL SECURITY;
CREATE POLICY "FileMetadata_tenant_isolation" ON "FileMetadata"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
