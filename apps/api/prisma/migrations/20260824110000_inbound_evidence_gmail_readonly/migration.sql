-- Gmail is a tenant-owner evidence source, not a company-scoped financial
-- system. Credentials are encrypted application ciphertext only; no secret is
-- ever copied to audit rows or browser responses.
CREATE TYPE "InboundEvidenceGmailConnectionStatus" AS ENUM ('NOT_CONNECTED', 'AUTHORIZING', 'CONNECTED', 'REAUTH_REQUIRED', 'BLOCKED');
CREATE TYPE "InboundEvidenceAttachmentStatus" AS ENUM ('STORED', 'QUARANTINED', 'UNSUPPORTED', 'TOO_LARGE', 'FAILED');

CREATE TABLE "InboundEvidenceGmailConnection" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL UNIQUE,
  "status" "InboundEvidenceGmailConnectionStatus" NOT NULL DEFAULT 'NOT_CONNECTED',
  "mailboxEmail" VARCHAR(320),
  "credentialCiphertext" TEXT,
  "credentialIv" VARCHAR(64),
  "credentialTag" VARCHAR(64),
  "credentialKeyVersion" INTEGER,
  "accessTokenExpiresAt" TIMESTAMPTZ(6),
  "gmailHistoryId" VARCHAR(80),
  "lastSyncedAt" TIMESTAMPTZ(6),
  "lastErrorCode" VARCHAR(80),
  "createdByUserId" UUID,
  "updatedByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundEvidenceGmailConnection_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "InboundEvidenceGmailConnection_id_tenant_key" UNIQUE ("id", "tenantId")
);
CREATE INDEX "InboundEvidenceGmailConnection_tenant_status_idx" ON "InboundEvidenceGmailConnection" ("tenantId", "status");

CREATE TABLE "InboundEvidenceGmailOAuthState" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "initiatedByUserId" UUID NOT NULL,
  "stateHash" CHAR(64) NOT NULL UNIQUE,
  "nonceHash" CHAR(64) NOT NULL,
  "verifierEncrypted" TEXT NOT NULL,
  "verifierIv" VARCHAR(64) NOT NULL,
  "verifierTag" VARCHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "consumedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundEvidenceGmailOAuthState_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT
);
CREATE INDEX "InboundEvidenceGmailOAuthState_tenant_expires_idx" ON "InboundEvidenceGmailOAuthState" ("tenantId", "expiresAt");

CREATE TABLE "InboundEvidenceMessage" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "gmailMessageId" VARCHAR(120) NOT NULL,
  "gmailThreadId" VARCHAR(120),
  "sender" VARCHAR(600),
  "subject" VARCHAR(998),
  "snippet" TEXT,
  "receivedAt" TIMESTAMPTZ(6),
  "hasAttachments" BOOLEAN NOT NULL DEFAULT false,
  "rawChecksum" CHAR(64) NOT NULL,
  "importedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundEvidenceMessage_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "InboundEvidenceMessage_tenant_gmailMessageId_key" UNIQUE ("tenantId", "gmailMessageId"),
  CONSTRAINT "InboundEvidenceMessage_id_tenant_key" UNIQUE ("id", "tenantId")
);
CREATE INDEX "InboundEvidenceMessage_tenant_receivedAt_idx" ON "InboundEvidenceMessage" ("tenantId", "receivedAt");

CREATE TABLE "InboundEvidenceAttachment" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "gmailAttachmentId" VARCHAR(180) NOT NULL,
  "gmailPartId" VARCHAR(80) NOT NULL,
  "fileName" VARCHAR(500) NOT NULL,
  "mimeType" VARCHAR(160) NOT NULL,
  "byteSize" BIGINT NOT NULL,
  "status" "InboundEvidenceAttachmentStatus" NOT NULL,
  "sha256" CHAR(64),
  "storageReference" VARCHAR(500),
  "encryptionIv" VARCHAR(64),
  "scannerName" VARCHAR(120),
  "scannerResult" VARCHAR(240),
  "retentionUntil" TIMESTAMPTZ(6),
  "downloadedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundEvidenceAttachment_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "InboundEvidenceAttachment_message_tenant_fkey" FOREIGN KEY ("messageId", "tenantId") REFERENCES "InboundEvidenceMessage"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "InboundEvidenceAttachment_tenant_message_attachment_key" UNIQUE ("tenantId", "messageId", "gmailAttachmentId"),
  CONSTRAINT "InboundEvidenceAttachment_id_tenant_key" UNIQUE ("id", "tenantId")
);
CREATE INDEX "InboundEvidenceAttachment_tenant_message_idx" ON "InboundEvidenceAttachment" ("tenantId", "messageId");
CREATE INDEX "InboundEvidenceAttachment_tenant_status_retention_idx" ON "InboundEvidenceAttachment" ("tenantId", "status", "retentionUntil");

CREATE TABLE "InboundEvidenceMessageLabel" (
  "tenantId" UUID NOT NULL,
  "messageId" UUID NOT NULL,
  "labelId" UUID NOT NULL,
  "appliedBy" VARCHAR(24) NOT NULL,
  "appliedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("tenantId", "messageId", "labelId"),
  CONSTRAINT "InboundEvidenceMessageLabel_message_tenant_fkey" FOREIGN KEY ("messageId", "tenantId") REFERENCES "InboundEvidenceMessage"("id", "tenantId") ON DELETE CASCADE,
  CONSTRAINT "InboundEvidenceMessageLabel_label_tenant_fkey" FOREIGN KEY ("labelId", "tenantId") REFERENCES "InboundEvidenceLabel"("id", "tenantId") ON DELETE RESTRICT
);
CREATE INDEX "InboundEvidenceMessageLabel_tenant_label_idx" ON "InboundEvidenceMessageLabel" ("tenantId", "labelId");

ALTER TABLE "InboundEvidenceGmailConnection" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboundEvidenceGmailConnection" FORCE ROW LEVEL SECURITY;
CREATE POLICY "InboundEvidenceGmailConnection_tenant_isolation" ON "InboundEvidenceGmailConnection" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "InboundEvidenceGmailOAuthState" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboundEvidenceGmailOAuthState" FORCE ROW LEVEL SECURITY;
CREATE POLICY "InboundEvidenceGmailOAuthState_tenant_isolation" ON "InboundEvidenceGmailOAuthState" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "InboundEvidenceMessage" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboundEvidenceMessage" FORCE ROW LEVEL SECURITY;
CREATE POLICY "InboundEvidenceMessage_tenant_isolation" ON "InboundEvidenceMessage" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "InboundEvidenceAttachment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboundEvidenceAttachment" FORCE ROW LEVEL SECURITY;
CREATE POLICY "InboundEvidenceAttachment_tenant_isolation" ON "InboundEvidenceAttachment" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
ALTER TABLE "InboundEvidenceMessageLabel" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboundEvidenceMessageLabel" FORCE ROW LEVEL SECURITY;
CREATE POLICY "InboundEvidenceMessageLabel_tenant_isolation" ON "InboundEvidenceMessageLabel" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
