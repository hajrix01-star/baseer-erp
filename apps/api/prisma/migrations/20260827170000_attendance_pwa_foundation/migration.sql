CREATE TYPE "AttendanceEventType" AS ENUM ('CHECK_IN', 'CHECK_OUT');
CREATE TYPE "AttendanceWorkSessionStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TABLE "AttendanceEmployeeCredential" (
  "id" UUID NOT NULL, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "employeeId" UUID NOT NULL,
  "pinHash" VARCHAR(100) NOT NULL, "pinLookupHash" CHAR(64) NOT NULL, "failedAttempts" INTEGER NOT NULL DEFAULT 0,
  "lockedUntil" TIMESTAMPTZ(6), "rotatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "AttendanceEmployeeCredential_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceEmployeeCredential_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceEmployeeCredential_companyId_employeeId_key" UNIQUE ("companyId", "employeeId"),
  CONSTRAINT "AttendanceEmployeeCredential_employeeId_tenantId_companyId_key" UNIQUE ("employeeId", "tenantId", "companyId"),
  CONSTRAINT "AttendanceEmployeeCredential_companyId_pinLookupHash_key" UNIQUE ("companyId", "pinLookupHash"),
  CONSTRAINT "AttendanceEmployeeCredential_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceEmployeeCredential_employeeId_tenantId_companyId_fkey" FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "AttendanceEmployeeCredential_tenantId_companyId_employeeId_idx" ON "AttendanceEmployeeCredential"("tenantId", "companyId", "employeeId");

CREATE TABLE "AttendanceBranch" (
  "id" UUID NOT NULL, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "nameAr" VARCHAR(160) NOT NULL, "nameEn" VARCHAR(160),
  "latitude" DECIMAL(10,7) NOT NULL, "longitude" DECIMAL(10,7) NOT NULL, "radiusMeters" INTEGER NOT NULL DEFAULT 100,
  "maxAccuracyMeters" INTEGER NOT NULL DEFAULT 75, "qrValiditySeconds" INTEGER NOT NULL DEFAULT 45, "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "AttendanceBranch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceBranch_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceBranch_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AttendanceBranch_tenantId_companyId_isActive_idx" ON "AttendanceBranch"("tenantId", "companyId", "isActive");

CREATE TABLE "AttendanceWorkSession" (
  "id" UUID NOT NULL, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "branchId" UUID NOT NULL, "employeeId" UUID NOT NULL,
  "status" "AttendanceWorkSessionStatus" NOT NULL DEFAULT 'OPEN', "checkInAt" TIMESTAMPTZ(6) NOT NULL, "checkOutAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "AttendanceWorkSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceWorkSession_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceWorkSession_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceWorkSession_branchId_tenantId_companyId_fkey" FOREIGN KEY ("branchId", "tenantId", "companyId") REFERENCES "AttendanceBranch"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceWorkSession_employeeId_tenantId_companyId_fkey" FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AttendanceWorkSession_tenantId_companyId_employeeId_status_idx" ON "AttendanceWorkSession"("tenantId", "companyId", "employeeId", "status");
CREATE UNIQUE INDEX "AttendanceWorkSession_one_open_employee" ON "AttendanceWorkSession"("companyId", "employeeId") WHERE "status" = 'OPEN';

CREATE TABLE "AttendanceEvent" (
  "id" UUID NOT NULL, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "branchId" UUID NOT NULL, "employeeId" UUID NOT NULL, "sessionId" UUID NOT NULL,
  "eventType" "AttendanceEventType" NOT NULL, "occurredAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "latitude" DECIMAL(10,7) NOT NULL, "longitude" DECIMAL(10,7) NOT NULL, "accuracyMeters" DECIMAL(10,2) NOT NULL,
  "qrTokenHash" CHAR(64) NOT NULL, "requestKey" VARCHAR(255) NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AttendanceEvent_id_tenantId_companyId_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AttendanceEvent_companyId_requestKey_key" UNIQUE ("companyId", "requestKey"),
  CONSTRAINT "AttendanceEvent_companyId_tenantId_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceEvent_branchId_tenantId_companyId_fkey" FOREIGN KEY ("branchId", "tenantId", "companyId") REFERENCES "AttendanceBranch"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceEvent_employeeId_tenantId_companyId_fkey" FOREIGN KEY ("employeeId", "tenantId", "companyId") REFERENCES "HrEmployee"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "AttendanceEvent_sessionId_tenantId_companyId_fkey" FOREIGN KEY ("sessionId", "tenantId", "companyId") REFERENCES "AttendanceWorkSession"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "AttendanceEvent_tenantId_companyId_employeeId_occurredAt_idx" ON "AttendanceEvent"("tenantId", "companyId", "employeeId", "occurredAt");
