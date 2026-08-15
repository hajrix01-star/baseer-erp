-- Baseer ERP foundation: identity and company context only.
-- This migration is intentionally additive and must be applied only to the
-- new Baseer database, never to the Noorix online database.

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "CompanyStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "SessionStatus" AS ENUM ('ACTIVE', 'REVOKED', 'EXPIRED');

CREATE TABLE "Tenant" (
  "id" UUID PRIMARY KEY,
  "code" VARCHAR(64) NOT NULL UNIQUE,
  "name" VARCHAR(160) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "User" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "loginNormalized" VARCHAR(254) NOT NULL,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160) NOT NULL,
  "preferredLanguage" VARCHAR(2) NOT NULL DEFAULT 'ar',
  "passwordHash" VARCHAR(255) NOT NULL,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "sessionVersion" INTEGER NOT NULL DEFAULT 0 CHECK ("sessionVersion" >= 0),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", "loginNormalized"),
  UNIQUE ("id", "tenantId")
);

CREATE TABLE "Company" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160) NOT NULL,
  "businessTimezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Riyadh',
  "status" "CompanyStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("id", "tenantId")
);

CREATE TABLE "Role" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "code" VARCHAR(80) NOT NULL,
  "nameAr" VARCHAR(160) NOT NULL,
  "nameEn" VARCHAR(160) NOT NULL,
  "isSystem" BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE ("tenantId", "code"),
  UNIQUE ("id", "tenantId")
);

CREATE TABLE "RolePermission" (
  "tenantId" UUID NOT NULL,
  "roleId" UUID NOT NULL,
  "permissionCode" VARCHAR(120) NOT NULL,
  PRIMARY KEY ("roleId", "permissionCode"),
  FOREIGN KEY ("roleId", "tenantId") REFERENCES "Role"("id", "tenantId") ON DELETE CASCADE
);

CREATE TABLE "CompanyMembership" (
  "tenantId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "roleId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("userId", "companyId"),
  FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("roleId", "tenantId") REFERENCES "Role"("id", "tenantId") ON DELETE RESTRICT
);

CREATE TABLE "AppSession" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "userId" UUID NOT NULL,
  "refreshTokenHash" VARCHAR(255) NOT NULL,
  "sessionVersion" INTEGER NOT NULL CHECK ("sessionVersion" >= 0),
  "status" "SessionStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "revokedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);

CREATE TABLE "AuditEvent" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "companyId" UUID,
  "actorUserId" UUID,
  "action" VARCHAR(120) NOT NULL,
  "entityType" VARCHAR(120) NOT NULL,
  "entityId" VARCHAR(120) NOT NULL,
  "requestId" VARCHAR(120) NOT NULL,
  "beforeJson" JSONB,
  "afterJson" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("actorUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE SET NULL ("actorUserId")
);

CREATE INDEX "User_tenantId_status_idx" ON "User"("tenantId", "status");
CREATE INDEX "Company_tenantId_status_idx" ON "Company"("tenantId", "status");
CREATE INDEX "RolePermission_tenantId_permissionCode_idx" ON "RolePermission"("tenantId", "permissionCode");
CREATE INDEX "CompanyMembership_tenantId_companyId_idx" ON "CompanyMembership"("tenantId", "companyId");
CREATE INDEX "CompanyMembership_tenantId_roleId_idx" ON "CompanyMembership"("tenantId", "roleId");
CREATE INDEX "AppSession_tenantId_userId_status_idx" ON "AppSession"("tenantId", "userId", "status");
CREATE INDEX "AppSession_expiresAt_idx" ON "AppSession"("expiresAt");
CREATE INDEX "AuditEvent_tenantId_companyId_createdAt_idx" ON "AuditEvent"("tenantId", "companyId", "createdAt");
CREATE INDEX "AuditEvent_tenantId_actorUserId_createdAt_idx" ON "AuditEvent"("tenantId", "actorUserId", "createdAt");

-- Application connections must set app.tenant_id transaction-locally.
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Company" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Company" FORCE ROW LEVEL SECURITY;
ALTER TABLE "Role" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Role" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RolePermission" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RolePermission" FORCE ROW LEVEL SECURITY;
ALTER TABLE "CompanyMembership" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CompanyMembership" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AppSession" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AppSession" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditEvent" FORCE ROW LEVEL SECURITY;

CREATE POLICY "User_tenant_isolation" ON "User"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "Company_tenant_isolation" ON "Company"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "Role_tenant_isolation" ON "Role"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "RolePermission_tenant_isolation" ON "RolePermission"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "CompanyMembership_tenant_isolation" ON "CompanyMembership"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AppSession_tenant_isolation" ON "AppSession"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AuditEvent_tenant_isolation" ON "AuditEvent"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- Baseer-only idempotency and document-numbering core.
CREATE TYPE "IdempotencyReceiptStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

CREATE TABLE "IdempotencyReceipt" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "companyId" UUID NOT NULL,
  "actorUserId" UUID NOT NULL,
  "operation" VARCHAR(160) NOT NULL,
  "idempotencyKey" VARCHAR(255) NOT NULL,
  "requestHash" CHAR(64) NOT NULL,
  "status" "IdempotencyReceiptStatus" NOT NULL DEFAULT 'IN_PROGRESS',
  "responseStatus" INTEGER,
  "responseHeaders" JSONB,
  "responseBody" JSONB,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  UNIQUE ("tenantId", "companyId", "actorUserId", "operation", "idempotencyKey"),
  CHECK (length("operation") > 0),
  CHECK (length("idempotencyKey") > 0),
  CHECK ("requestHash" ~ '^[0-9a-f]{64}$'),
  CHECK ("expiresAt" > "createdAt"),
  CHECK (
    ("status" = 'IN_PROGRESS' AND "responseStatus" IS NULL AND "responseHeaders" IS NULL AND "responseBody" IS NULL)
    OR
    ("status" = 'COMPLETED' AND "responseStatus" BETWEEN 100 AND 599)
  ),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  FOREIGN KEY ("actorUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT
);

CREATE TABLE "DocumentSerialCounter" (
  "tenantId" UUID NOT NULL REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  "companyId" UUID NOT NULL,
  "series" VARCHAR(80) NOT NULL,
  "businessDate" DATE NOT NULL,
  "lastValue" BIGINT NOT NULL DEFAULT 0 CHECK ("lastValue" >= 0),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tenantId", "companyId", "series", "businessDate"),
  CHECK (length("series") > 0),
  FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT
);

CREATE INDEX "IdempotencyReceipt_tenantId_companyId_expiresAt_idx"
  ON "IdempotencyReceipt"("tenantId", "companyId", "expiresAt");

ALTER TABLE "IdempotencyReceipt" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "IdempotencyReceipt" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DocumentSerialCounter" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DocumentSerialCounter" FORCE ROW LEVEL SECURITY;

CREATE POLICY "IdempotencyReceipt_tenant_isolation" ON "IdempotencyReceipt"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "DocumentSerialCounter_tenant_isolation" ON "DocumentSerialCounter"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
