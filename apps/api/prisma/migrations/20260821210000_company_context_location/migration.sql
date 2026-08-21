CREATE TYPE "DecisionContextScope" AS ENUM ('TENANT_GLOBAL', 'AREA');

ALTER TABLE "Company"
  ADD COLUMN "contextLocationCode" VARCHAR(80),
  ADD COLUMN "contextLocationLabelAr" VARCHAR(160),
  ADD COLUMN "contextLatitude" DECIMAL(9,6),
  ADD COLUMN "contextLongitude" DECIMAL(9,6);
CREATE INDEX "Company_tenant_context_location_idx" ON "Company" ("tenantId", "contextLocationCode");

ALTER TABLE "DecisionContextCandidate"
  ADD COLUMN "scope" "DecisionContextScope" NOT NULL DEFAULT 'TENANT_GLOBAL',
  ADD COLUMN "locationCode" VARCHAR(80);

ALTER TABLE "DecisionGlobalContextEvent"
  ADD COLUMN "scope" "DecisionContextScope" NOT NULL DEFAULT 'TENANT_GLOBAL',
  ADD COLUMN "locationCode" VARCHAR(80),
  ADD COLUMN "locationLabelAr" VARCHAR(160);
CREATE INDEX "DecisionGlobalContextEvent_tenant_scope_location_idx"
  ON "DecisionGlobalContextEvent" ("tenantId", "scope", "locationCode", "status");
