-- Internal in-app inbox only. No device tokens, external transport state,
-- financial amounts, or location evidence is stored in this boundary.
CREATE TYPE "InAppNotificationSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

CREATE TABLE "InAppNotification" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "recipientUserId" uuid NOT NULL,
  "type" varchar(120) NOT NULL,
  "severity" "InAppNotificationSeverity" NOT NULL DEFAULT 'INFO',
  "module" varchar(80) NOT NULL,
  "entityType" varchar(120),
  "entityId" varchar(120),
  "route" varchar(500),
  "sourcePermissionCode" varchar(120) NOT NULL,
  "titleAr" varchar(240) NOT NULL,
  "bodyAr" varchar(1000),
  "dedupeKey" varchar(255),
  "readAt" timestamptz(6),
  "acknowledgedAt" timestamptz(6),
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(6) NOT NULL,
  CONSTRAINT "InAppNotification_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "InAppNotification_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "InAppNotification_tenantId_companyId_recipientUserId_dedupeKey_key" UNIQUE ("tenantId", "companyId", "recipientUserId", "dedupeKey"),
  CONSTRAINT "InAppNotification_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "InAppNotification_recipientUserId_tenantId_fkey" FOREIGN KEY ("recipientUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "InAppNotification_tenant_company_recipient_read_created_idx"
  ON "InAppNotification"("tenantId", "companyId", "recipientUserId", "readAt", "createdAt");
CREATE INDEX "InAppNotification_tenant_company_recipient_ack_created_idx"
  ON "InAppNotification"("tenantId", "companyId", "recipientUserId", "acknowledgedAt", "createdAt");
CREATE INDEX "InAppNotification_tenant_company_type_created_idx"
  ON "InAppNotification"("tenantId", "companyId", "type", "createdAt");

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'baseer_app') THEN
    GRANT SELECT, INSERT, UPDATE ON TABLE "InAppNotification" TO baseer_app;
  END IF;
END $$;

ALTER TABLE "InAppNotification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InAppNotification" FORCE ROW LEVEL SECURITY;
CREATE POLICY "InAppNotification_tenant_isolation" ON "InAppNotification"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
