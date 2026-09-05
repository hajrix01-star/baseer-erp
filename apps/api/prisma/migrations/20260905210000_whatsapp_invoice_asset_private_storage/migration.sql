-- WAI-B: encrypted, company-scoped original receipt storage. This migration
-- intentionally contains neither a WhatsApp connector nor a document reader.
CREATE TYPE "WhatsappInvoiceAssetStorageState" AS ENUM ('PENDING', 'READY', 'QUARANTINED', 'FAILED');
CREATE TYPE "WhatsappInvoiceAssetScanStatus" AS ENUM ('NOT_REQUESTED', 'PENDING', 'CLEAN', 'MALICIOUS', 'UNAVAILABLE', 'FAILED');

ALTER TABLE "WhatsappInvoiceAsset"
  ADD COLUMN "storageState" "WhatsappInvoiceAssetStorageState" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "storageReference" VARCHAR(700),
  ADD COLUMN "encryptionIv" VARCHAR(64),
  ADD COLUMN "encryptionKeyVersion" SMALLINT,
  ADD COLUMN "storedByteSize" BIGINT,
  ADD COLUMN "actualMimeType" VARCHAR(160),
  ADD COLUMN "scanStatus" "WhatsappInvoiceAssetScanStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  ADD COLUMN "scannedAt" TIMESTAMPTZ(6),
  ADD COLUMN "storageFailureReason" VARCHAR(500);

ALTER TABLE "WhatsappInvoiceAsset"
  ADD CONSTRAINT "WaiAsset_storage_reference_key" UNIQUE ("storageReference"),
  ADD CONSTRAINT "WaiAsset_storage_state_metadata" CHECK (
    ("storageState" = 'PENDING' AND "storageReference" IS NULL AND "encryptionIv" IS NULL AND "encryptionKeyVersion" IS NULL AND "storedByteSize" IS NULL AND "actualMimeType" IS NULL)
    OR ("storageState" IN ('READY', 'QUARANTINED') AND "storageReference" IS NOT NULL AND "encryptionIv" IS NOT NULL AND "encryptionKeyVersion" IS NOT NULL AND "storedByteSize" IS NOT NULL AND "storedByteSize" >= 0 AND "actualMimeType" IS NOT NULL)
    OR "storageState" = 'FAILED'
  ),
  ADD CONSTRAINT "WaiAsset_ready_requires_clean_scan" CHECK ("storageState" <> 'READY' OR "scanStatus" = 'CLEAN'),
  ADD CONSTRAINT "WaiAsset_encryption_key_version_positive" CHECK ("encryptionKeyVersion" IS NULL OR "encryptionKeyVersion" > 0),
  ADD CONSTRAINT "WaiAsset_actual_size_nonnegative" CHECK ("byteSize" IS NULL OR "byteSize" >= 0);

CREATE INDEX "WaiAsset_tenant_company_storage_scan_idx"
  ON "WhatsappInvoiceAsset" ("tenantId", "companyId", "storageState", "scanStatus");

-- Existing RLS policy on WhatsappInvoiceAsset already covers newly added
-- columns. No public storage reference or storage policy is created here.
