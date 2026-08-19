CREATE TYPE "HrCompensationFormulaCode" AS ENUM ('STANDARD_MONTHLY_V1');
CREATE TYPE "HrCompensationPolicyVersionStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED');

CREATE TABLE "HrCompensationPolicy" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "code" varchar(80) NOT NULL,
  "nameAr" varchar(160) NOT NULL,
  "nameEn" varchar(160),
  "createdByUserId" uuid NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(6) NOT NULL,
  CONSTRAINT "HrCompensationPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HrCompensationPolicy_company_code_key" UNIQUE ("companyId", "code"),
  CONSTRAINT "HrCompensationPolicy_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "HrCompensationPolicy_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HrCompensationPolicy_tenant_company_code_idx" ON "HrCompensationPolicy"("tenantId", "companyId", "code");

CREATE TABLE "HrCompensationPolicyVersion" (
  "id" uuid NOT NULL,
  "tenantId" uuid NOT NULL,
  "companyId" uuid NOT NULL,
  "policyId" uuid NOT NULL,
  "versionNumber" integer NOT NULL,
  "effectiveFrom" date NOT NULL,
  "effectiveTo" date,
  "status" "HrCompensationPolicyVersionStatus" NOT NULL DEFAULT 'DRAFT',
  "formulaCode" "HrCompensationFormulaCode" NOT NULL DEFAULT 'STANDARD_MONTHLY_V1',
  "approvedByUserId" uuid,
  "approvedAt" timestamptz(6),
  "createdByUserId" uuid NOT NULL,
  "createdAt" timestamptz(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamptz(6) NOT NULL,
  CONSTRAINT "HrCompensationPolicyVersion_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "HrCompensationPolicyVersion_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "HrCompensationPolicyVersion_policy_version_key" UNIQUE ("policyId", "versionNumber"),
  CONSTRAINT "HrCompensationPolicyVersion_policy_from_key" UNIQUE ("policyId", "effectiveFrom"),
  CONSTRAINT "HrCompensationPolicyVersion_company_tenant_fkey" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "HrCompensationPolicyVersion_policy_tenant_company_fkey" FOREIGN KEY ("policyId", "tenantId", "companyId") REFERENCES "HrCompensationPolicy"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "HrCompensationPolicyVersion_tenant_company_policy_status_from_idx" ON "HrCompensationPolicyVersion"("tenantId", "companyId", "policyId", "status", "effectiveFrom");

ALTER TABLE "HrEmployeeCompensationProfile" ADD COLUMN "policyVersionId" uuid;
ALTER TABLE "HrPayrollLine" ADD COLUMN "compensationPolicyVersionId" uuid, ADD COLUMN "compensationPolicySnapshotJson" jsonb;

ALTER TABLE "HrEmployeeCompensationProfile"
  ADD CONSTRAINT "HrEmployeeCompensationProfile_policy_version_tenant_company_fkey"
  FOREIGN KEY ("policyVersionId", "tenantId", "companyId") REFERENCES "HrCompensationPolicyVersion"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HrPayrollLine"
  ADD CONSTRAINT "HrPayrollLine_policy_version_tenant_company_fkey"
  FOREIGN KEY ("compensationPolicyVersionId", "tenantId", "companyId") REFERENCES "HrCompensationPolicyVersion"("id", "tenantId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
