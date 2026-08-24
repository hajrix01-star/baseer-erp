-- E3: Human-in-the-loop records next to a reusable Basira interpretation.
-- They are encrypted, company-scoped, auditable and never feed a model by
-- themselves. Corrections create a new row rather than changing its text.

CREATE TYPE "AiHumanInsightKind" AS ENUM ('NOTE', 'HYPOTHESIS', 'DECISION');
CREATE TYPE "AiHumanInsightStatus" AS ENUM ('DRAFT', 'APPROVED', 'REVOKED');

CREATE TABLE "AiHumanInsight" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "interpretationId" UUID NOT NULL,
  "kind" "AiHumanInsightKind" NOT NULL,
  "status" "AiHumanInsightStatus" NOT NULL DEFAULT 'DRAFT',
  "encryptedStatement" TEXT NOT NULL,
  "statementIv" VARCHAR(64) NOT NULL,
  "statementTag" VARCHAR(64) NOT NULL,
  "statementKeyVersion" INTEGER NOT NULL,
  "statementChecksum" CHAR(64) NOT NULL,
  "supersedesInsightId" UUID,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approvedByUserId" UUID,
  "approvedAt" TIMESTAMPTZ(6),
  "revokedByUserId" UUID,
  "revokedAt" TIMESTAMPTZ(6),
  "revocationReason" VARCHAR(500),
  CONSTRAINT "AiHumanInsight_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiHumanInsight_interpretation_fk" FOREIGN KEY ("interpretationId", "tenantId", "companyId") REFERENCES "AiInterpretation"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiHumanInsight_supersedes_fk" FOREIGN KEY ("supersedesInsightId", "tenantId", "companyId") REFERENCES "AiHumanInsight"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiHumanInsight_created_by_fk" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiHumanInsight_approved_by_fk" FOREIGN KEY ("approvedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiHumanInsight_revoked_by_fk" FOREIGN KEY ("revokedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiHumanInsight_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AiHumanInsight_key_version_positive" CHECK ("statementKeyVersion" > 0),
  CONSTRAINT "AiHumanInsight_checksum_format" CHECK ("statementChecksum" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AiHumanInsight_statement_not_blank" CHECK (length(trim("encryptedStatement")) > 0),
  CONSTRAINT "AiHumanInsight_lifecycle_consistent" CHECK (
    ("status" = 'DRAFT' AND "approvedByUserId" IS NULL AND "approvedAt" IS NULL AND "revokedByUserId" IS NULL AND "revokedAt" IS NULL AND "revocationReason" IS NULL)
    OR ("status" = 'APPROVED' AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL AND "revokedByUserId" IS NULL AND "revokedAt" IS NULL AND "revocationReason" IS NULL)
    OR ("status" = 'REVOKED' AND "revokedByUserId" IS NOT NULL AND "revokedAt" IS NOT NULL AND length(trim(COALESCE("revocationReason", ''))) > 0)
  )
);
CREATE INDEX "AiHumanInsight_tenant_company_interpretation_created_idx" ON "AiHumanInsight" ("tenantId", "companyId", "interpretationId", "createdAt");
CREATE INDEX "AiHumanInsight_tenant_company_kind_status_created_idx" ON "AiHumanInsight" ("tenantId", "companyId", "kind", "status", "createdAt");
CREATE INDEX "AiHumanInsight_tenant_company_supersedes_idx" ON "AiHumanInsight" ("tenantId", "companyId", "supersedesInsightId");

ALTER TABLE "AiHumanInsight" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiHumanInsight" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AiHumanInsight_tenant_isolation" ON "AiHumanInsight"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION "baseer_guard_ai_human_insight_lifecycle"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'AiHumanInsight must begin as a draft';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AiHumanInsight rows are append-only';
  END IF;
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
     OR NEW."interpretationId" IS DISTINCT FROM OLD."interpretationId"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."encryptedStatement" IS DISTINCT FROM OLD."encryptedStatement"
     OR NEW."statementIv" IS DISTINCT FROM OLD."statementIv"
     OR NEW."statementTag" IS DISTINCT FROM OLD."statementTag"
     OR NEW."statementKeyVersion" IS DISTINCT FROM OLD."statementKeyVersion"
     OR NEW."statementChecksum" IS DISTINCT FROM OLD."statementChecksum"
     OR NEW."supersedesInsightId" IS DISTINCT FROM OLD."supersedesInsightId"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'AiHumanInsight content and lineage are immutable';
  END IF;
  IF OLD."status" = 'DRAFT' AND NEW."status" = 'APPROVED'
     AND NEW."approvedByUserId" IS NOT NULL AND NEW."approvedAt" IS NOT NULL
     AND NEW."revokedByUserId" IS NULL AND NEW."revokedAt" IS NULL AND NEW."revocationReason" IS NULL THEN
    RETURN NEW;
  END IF;
  IF OLD."status" IN ('DRAFT', 'APPROVED') AND NEW."status" = 'REVOKED'
     AND NEW."revokedByUserId" IS NOT NULL AND NEW."revokedAt" IS NOT NULL
     AND length(trim(COALESCE(NEW."revocationReason", ''))) > 0 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AiHumanInsight lifecycle transition is not permitted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiHumanInsight_lifecycle_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "AiHumanInsight"
  FOR EACH ROW EXECUTE FUNCTION "baseer_guard_ai_human_insight_lifecycle"();
