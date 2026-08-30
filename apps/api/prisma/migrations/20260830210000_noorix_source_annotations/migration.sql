-- Preserve Noorix source notes exactly, independently from a target model's
-- limited operational note field.  This table contains no accounting payload.
CREATE TABLE "NoorixSourceAnnotation" (
  "id" UUID NOT NULL,
  "tenantId" UUID NOT NULL,
  "targetCompanyId" UUID NOT NULL,
  "sourceCompanyId" VARCHAR(120) NOT NULL,
  "sourceEntity" VARCHAR(120) NOT NULL,
  "sourceId" VARCHAR(160) NOT NULL,
  "sourceChecksum" CHAR(64) NOT NULL,
  "targetEntity" VARCHAR(120),
  "targetId" VARCHAR(160),
  "field" VARCHAR(120) NOT NULL,
  "exactText" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NoorixSourceAnnotation_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NoorixSourceAnnotation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "NoorixSourceAnnotation_targetCompanyId_tenantId_fkey" FOREIGN KEY ("targetCompanyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "NoorixSourceAnnotation_tenant_company_source_field_key"
  ON "NoorixSourceAnnotation"("tenantId", "targetCompanyId", "sourceEntity", "sourceId", "field");
CREATE INDEX "NoorixSourceAnnotation_target_idx"
  ON "NoorixSourceAnnotation"("tenantId", "targetCompanyId", "targetEntity", "targetId");
CREATE INDEX "NoorixSourceAnnotation_source_idx"
  ON "NoorixSourceAnnotation"("tenantId", "targetCompanyId", "sourceEntity", "sourceId");
