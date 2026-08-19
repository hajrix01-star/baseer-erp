CREATE TYPE "HrDocumentBlobStatus" AS ENUM ('STAGED', 'READY', 'QUARANTINED', 'REVOKED');
CREATE TYPE "HrEmployeeDocumentType" AS ENUM ('NATIONAL_ID', 'IQAMA', 'PASSPORT', 'EMPLOYMENT_CONTRACT', 'MEDICAL_INSURANCE', 'HEALTH_CERTIFICATE', 'QUALIFICATION', 'OTHER');
CREATE TYPE "HrEmployeeDocumentStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "HrEmployeeLetterType" AS ENUM ('SALARY_CERTIFICATE', 'SERVICE_CERTIFICATE');
CREATE TYPE "HrEmployeeLetterStatus" AS ENUM ('ISSUED', 'REVOKED');

CREATE TABLE "HrEmployeeDocumentBlob" (
  "id" uuid NOT NULL, "tenantId" uuid NOT NULL, "companyId" uuid NOT NULL, "fileMetadataId" uuid NOT NULL,
  "status" "HrDocumentBlobStatus" NOT NULL DEFAULT 'STAGED', "storageReference" varchar(255) NOT NULL, "encryptionIv" char(24) NOT NULL,
  "mimeType" varchar(127) NOT NULL, "byteSize" bigint NOT NULL, "sha256" char(64) NOT NULL,
  "scannerName" varchar(80), "scannerResult" varchar(160), "scannedAt" timestamptz(6), "revokedAt" timestamptz(6),
  "createdByUserId" uuid NOT NULL, "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmployeeDocumentBlob_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HrEmployeeDocumentBlob_tenant_company_id_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "HrEmployeeDocumentBlob_metadata_scope_key" UNIQUE ("fileMetadataId", "tenantId", "companyId"),
  CONSTRAINT "HrEmployeeDocumentBlob_fileMetadataId_key" UNIQUE ("fileMetadataId"),
  CONSTRAINT "HrEmployeeDocumentBlob_storageReference_key" UNIQUE ("storageReference"),
  CONSTRAINT "HrEmployeeDocumentBlob_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrEmployeeDocumentBlob_metadata_fkey" FOREIGN KEY ("fileMetadataId", "tenantId", "companyId") REFERENCES "FileMetadata"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HrEmployeeDocumentBlob_scope_status_created_idx" ON "HrEmployeeDocumentBlob"("tenantId", "companyId", "status", "createdAt");

CREATE TABLE "HrEmployeeDocument" (
  "id" uuid NOT NULL, "tenantId" uuid NOT NULL, "companyId" uuid NOT NULL, "employeeId" uuid NOT NULL,
  "documentType" "HrEmployeeDocumentType" NOT NULL, "status" "HrEmployeeDocumentStatus" NOT NULL DEFAULT 'ACTIVE',
  "title" varchar(240) NOT NULL, "referenceNumber" varchar(160), "issueDate" date, "expiryDate" date, "notes" varchar(2000), "linkedServiceId" uuid, "retentionUntil" date, "legalHold" boolean NOT NULL DEFAULT false,
  "currentVersionId" uuid, "revokedAt" timestamptz(6), "revokedReason" varchar(1000), "createdByUserId" uuid NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" timestamptz(6) NOT NULL,
  CONSTRAINT "HrEmployeeDocument_pkey" PRIMARY KEY ("id"), CONSTRAINT "HrEmployeeDocument_scope_id_key" UNIQUE ("id", "tenantId", "companyId"), CONSTRAINT "HrEmployeeDocument_currentVersionId_key" UNIQUE ("currentVersionId"), CONSTRAINT "HrEmployeeDocument_current_version_scope_key" UNIQUE ("currentVersionId", "tenantId", "companyId"),
  CONSTRAINT "HrEmployeeDocument_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrEmployeeDocument_employee_fkey" FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrEmployeeDocument_service_fkey" FOREIGN KEY ("linkedServiceId", "tenantId", "companyId") REFERENCES "HrEmployeeService"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HrEmployeeDocument_employee_type_status_idx" ON "HrEmployeeDocument"("tenantId", "companyId", "employeeId", "documentType", "status");
CREATE INDEX "HrEmployeeDocument_expiry_idx" ON "HrEmployeeDocument"("tenantId", "companyId", "expiryDate");
CREATE INDEX "HrEmployeeDocument_service_idx" ON "HrEmployeeDocument"("tenantId", "companyId", "linkedServiceId");

CREATE TABLE "HrEmployeeDocumentVersion" (
  "id" uuid NOT NULL, "tenantId" uuid NOT NULL, "companyId" uuid NOT NULL, "documentId" uuid NOT NULL, "blobId" uuid NOT NULL, "version" integer NOT NULL, "createdByUserId" uuid NOT NULL, "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmployeeDocumentVersion_pkey" PRIMARY KEY ("id"), CONSTRAINT "HrEmployeeDocumentVersion_scope_id_key" UNIQUE ("id", "tenantId", "companyId"), CONSTRAINT "HrEmployeeDocumentVersion_document_version_key" UNIQUE ("documentId", "version"),
  CONSTRAINT "HrEmployeeDocumentVersion_document_fkey" FOREIGN KEY ("documentId", "tenantId", "companyId") REFERENCES "HrEmployeeDocument"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrEmployeeDocumentVersion_blob_fkey" FOREIGN KEY ("blobId", "tenantId", "companyId") REFERENCES "HrEmployeeDocumentBlob"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HrEmployeeDocumentVersion_blob_idx" ON "HrEmployeeDocumentVersion"("tenantId", "companyId", "blobId");
ALTER TABLE "HrEmployeeDocument" ADD CONSTRAINT "HrEmployeeDocument_current_version_fkey" FOREIGN KEY ("currentVersionId", "tenantId", "companyId") REFERENCES "HrEmployeeDocumentVersion"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "HrEmployeeLetter" (
  "id" uuid NOT NULL, "tenantId" uuid NOT NULL, "companyId" uuid NOT NULL, "employeeId" uuid NOT NULL, "letterType" "HrEmployeeLetterType" NOT NULL, "status" "HrEmployeeLetterStatus" NOT NULL DEFAULT 'ISSUED', "letterNumber" varchar(80) NOT NULL, "templateVersion" varchar(40) NOT NULL, "locale" varchar(2) NOT NULL, "recipient" varchar(240), "snapshotJson" jsonb NOT NULL, "snapshotSha256" char(64) NOT NULL, "revokedAt" timestamptz(6), "revokedReason" varchar(1000), "issuedByUserId" uuid NOT NULL, "issuedAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HrEmployeeLetter_pkey" PRIMARY KEY ("id"), CONSTRAINT "HrEmployeeLetter_scope_id_key" UNIQUE ("id", "tenantId", "companyId"), CONSTRAINT "HrEmployeeLetter_number_key" UNIQUE ("tenantId", "companyId", "letterNumber"),
  CONSTRAINT "HrEmployeeLetter_company_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrEmployeeLetter_employee_fkey" FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HrEmployeeLetter_employee_issued_idx" ON "HrEmployeeLetter"("tenantId", "companyId", "employeeId", "issuedAt");
