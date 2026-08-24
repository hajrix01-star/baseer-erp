-- Basira governance foundation. Company context is structured, approved
-- business vocabulary; it is never a free-form instruction channel.

ALTER TYPE "AiProviderConfigurationStatus" ADD VALUE IF NOT EXISTS 'DRAFT';
ALTER TYPE "AiProviderConfigurationStatus" ADD VALUE IF NOT EXISTS 'VALIDATED';

CREATE TYPE "AiCompanyContextStatus" AS ENUM ('DRAFT', 'APPROVED', 'SUPERSEDED', 'REVOKED');
CREATE TYPE "AiCompanyPresentationStyle" AS ENUM ('CONCISE', 'DETAILED');
CREATE TYPE "AiCompanyContextKind" AS ENUM ('TERMINOLOGY', 'BUSINESS_SCOPE', 'POLICY_REFERENCE');
CREATE TYPE "AiSkillActivationStatus" AS ENUM ('PILOT', 'ACTIVE', 'SUSPENDED');
CREATE TYPE "AiEvaluationFeedbackKind" AS ENUM ('USEFUL', 'NOT_USEFUL', 'DATA_INCOMPLETE', 'COMPARISON_UNFAIR', 'CONTEXT_DIFFERENT', 'OTHER');

CREATE TABLE "AiCompanyContext" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "version" INTEGER NOT NULL,
  "status" "AiCompanyContextStatus" NOT NULL DEFAULT 'DRAFT',
  "kind" "AiCompanyContextKind" NOT NULL,
  "moduleScope" VARCHAR(80) NOT NULL,
  "presentationStyle" "AiCompanyPresentationStyle" NOT NULL DEFAULT 'CONCISE',
  "approvedTermsJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "policyReferencesJson" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "sourceReference" VARCHAR(500),
  "expiresAt" TIMESTAMPTZ(6),
  "revocationReason" VARCHAR(500),
  "supersedesContextId" UUID,
  "approvedByUserId" UUID,
  "approvedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiCompanyContext_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiCompanyContext_approver_fk" FOREIGN KEY ("approvedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiCompanyContext_supersedes_fk" FOREIGN KEY ("supersedesContextId", "tenantId", "companyId") REFERENCES "AiCompanyContext"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiCompanyContext_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AiCompanyContext_company_kind_scope_version_key" UNIQUE ("companyId", "kind", "moduleScope", "version"),
  CONSTRAINT "AiCompanyContext_version_positive" CHECK ("version" > 0),
  CONSTRAINT "AiCompanyContext_scope_nonempty" CHECK (length(trim("moduleScope")) > 0),
  CONSTRAINT "AiCompanyContext_structured_values" CHECK (jsonb_typeof("approvedTermsJson") = 'object' AND jsonb_typeof("policyReferencesJson") = 'array'),
  CONSTRAINT "AiCompanyContext_approval_consistent" CHECK (
    ("status" = 'DRAFT' AND "approvedByUserId" IS NULL AND "approvedAt" IS NULL)
    OR ("status" IN ('APPROVED', 'SUPERSEDED', 'REVOKED') AND "approvedByUserId" IS NOT NULL AND "approvedAt" IS NOT NULL)
  ),
  CONSTRAINT "AiCompanyContext_revocation_consistent" CHECK (
    ("status" = 'REVOKED' AND length(trim(COALESCE("revocationReason", ''))) > 0)
    OR ("status" <> 'REVOKED' AND "revocationReason" IS NULL)
  )
);
CREATE UNIQUE INDEX "AiCompanyContext_one_approved_per_company"
  ON "AiCompanyContext"("companyId", "kind", "moduleScope") WHERE "status" = 'APPROVED';
CREATE INDEX "AiCompanyContext_tenant_company_scope_status_idx" ON "AiCompanyContext"("tenantId", "companyId", "kind", "moduleScope", "status");

CREATE TABLE "AiSkillActivation" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "skillKey" VARCHAR(120) NOT NULL,
  "skillVersion" INTEGER NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "status" "AiSkillActivationStatus" NOT NULL DEFAULT 'PILOT',
  "validFrom" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validUntil" TIMESTAMPTZ(6),
  "dailyRequestLimit" INTEGER,
  "dailyCostLimit" DECIMAL(18,4),
  "approvedByUserId" UUID NOT NULL,
  "approvedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "suspendedByUserId" UUID,
  "suspendedAt" TIMESTAMPTZ(6),
  "suspensionReason" VARCHAR(500),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiSkillActivation_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiSkillActivation_approver_fk" FOREIGN KEY ("approvedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiSkillActivation_suspender_fk" FOREIGN KEY ("suspendedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiSkillActivation_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AiSkillActivation_company_skill_version_policy_key" UNIQUE ("companyId", "skillKey", "skillVersion", "policyVersion"),
  CONSTRAINT "AiSkillActivation_key_nonempty" CHECK (length(trim("skillKey")) > 0),
  CONSTRAINT "AiSkillActivation_versions_positive" CHECK ("skillVersion" > 0 AND "policyVersion" > 0),
  CONSTRAINT "AiSkillActivation_limits_valid" CHECK (("dailyRequestLimit" IS NULL OR "dailyRequestLimit" > 0) AND ("dailyCostLimit" IS NULL OR "dailyCostLimit" > 0)),
  CONSTRAINT "AiSkillActivation_validity_consistent" CHECK ("validUntil" IS NULL OR "validUntil" > "validFrom"),
  CONSTRAINT "AiSkillActivation_suspension_consistent" CHECK (
    ("status" = 'SUSPENDED' AND "suspendedByUserId" IS NOT NULL AND "suspendedAt" IS NOT NULL AND length(trim(COALESCE("suspensionReason", ''))) > 0)
    OR ("status" IN ('PILOT', 'ACTIVE') AND "suspendedByUserId" IS NULL AND "suspendedAt" IS NULL AND "suspensionReason" IS NULL)
  )
);
CREATE INDEX "AiSkillActivation_tenant_company_skill_status_idx" ON "AiSkillActivation"("tenantId", "companyId", "skillKey", "status");

ALTER TABLE "AiExecutionReceipt"
  ADD COLUMN "skillActivationId" UUID,
  ADD COLUMN "evidenceSnapshotId" UUID,
  ADD COLUMN "promptVersion" INTEGER,
  ADD COLUMN "inputChecksum" CHAR(64),
  ADD COLUMN "outputChecksum" CHAR(64);
ALTER TABLE "AiExecutionReceipt"
  ADD CONSTRAINT "AiExecutionReceipt_skill_activation_fk"
    FOREIGN KEY ("skillActivationId", "tenantId", "companyId") REFERENCES "AiSkillActivation"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  ADD CONSTRAINT "AiExecutionReceipt_evidence_snapshot_fk"
    FOREIGN KEY ("evidenceSnapshotId", "tenantId", "companyId") REFERENCES "DecisionEvidenceSnapshot"("id", "tenantId", "companyId") ON DELETE RESTRICT;
ALTER TABLE "AiExecutionReceipt" DROP CONSTRAINT "AiExecutionReceipt_versions_positive";
ALTER TABLE "AiExecutionReceipt" ADD CONSTRAINT "AiExecutionReceipt_versions_positive" CHECK (
  ("configurationVersion" IS NULL OR "configurationVersion" > 0)
  AND ("identityVersion" IS NULL OR "identityVersion" > 0)
  AND ("systemIdentityVersion" IS NULL OR "systemIdentityVersion" > 0)
  AND ("skillVersion" IS NULL OR "skillVersion" > 0)
  AND ("policyVersion" IS NULL OR "policyVersion" > 0)
  AND ("promptVersion" IS NULL OR "promptVersion" > 0)
);
ALTER TABLE "AiExecutionReceipt" ADD CONSTRAINT "AiExecutionReceipt_checksum_format" CHECK (
  ("inputChecksum" IS NULL OR "inputChecksum" ~ '^[0-9a-f]{64}$')
  AND ("outputChecksum" IS NULL OR "outputChecksum" ~ '^[0-9a-f]{64}$')
);
CREATE INDEX "AiExecutionReceipt_tenant_company_evidence_created_idx" ON "AiExecutionReceipt"("tenantId", "companyId", "evidenceSnapshotId", "createdAt");
CREATE INDEX "AiExecutionReceipt_tenant_company_activation_created_idx" ON "AiExecutionReceipt"("tenantId", "companyId", "skillActivationId", "createdAt");

CREATE TABLE "AiEvaluationFeedback" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "executionReceiptId" UUID NOT NULL,
  "kind" "AiEvaluationFeedbackKind" NOT NULL,
  "note" VARCHAR(1000),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiEvaluationFeedback_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiEvaluationFeedback_receipt_fk" FOREIGN KEY ("executionReceiptId", "tenantId", "companyId") REFERENCES "AiExecutionReceipt"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiEvaluationFeedback_actor_fk" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiEvaluationFeedback_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId")
);
CREATE INDEX "AiEvaluationFeedback_tenant_company_receipt_created_idx" ON "AiEvaluationFeedback"("tenantId", "companyId", "executionReceiptId", "createdAt");
CREATE INDEX "AiEvaluationFeedback_tenant_company_kind_created_idx" ON "AiEvaluationFeedback"("tenantId", "companyId", "kind", "createdAt");

ALTER TABLE "AiCompanyContext" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiCompanyContext" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AiSkillActivation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiSkillActivation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AiEvaluationFeedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiEvaluationFeedback" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AiCompanyContext_tenant_isolation" ON "AiCompanyContext"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AiSkillActivation_tenant_isolation" ON "AiSkillActivation"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AiEvaluationFeedback_tenant_isolation" ON "AiEvaluationFeedback"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION "baseer_prevent_ai_execution_receipt_mutation"() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'AiExecutionReceipt rows are append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiExecutionReceipt_append_only"
  BEFORE UPDATE OR DELETE ON "AiExecutionReceipt"
  FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_ai_execution_receipt_mutation"();

CREATE OR REPLACE FUNCTION "baseer_prevent_ai_evaluation_feedback_mutation"() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'AiEvaluationFeedback rows are append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiEvaluationFeedback_append_only"
  BEFORE UPDATE OR DELETE ON "AiEvaluationFeedback"
  FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_ai_evaluation_feedback_mutation"();

-- Draft context may be reviewed. Once approved, its structured payload is
-- frozen: it may only move to SUPERSEDED or REVOKED, and a replacement is a
-- separate versioned row. Deletion is never allowed.
CREATE OR REPLACE FUNCTION "baseer_guard_ai_company_context_lifecycle"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AiCompanyContext rows are versioned and cannot be deleted';
  END IF;
  IF OLD."status" = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD."status" = 'APPROVED' AND NEW."status" = 'SUPERSEDED' THEN
    IF ROW(NEW."id", NEW."tenantId", NEW."companyId", NEW."version", NEW."kind", NEW."moduleScope", NEW."presentationStyle", NEW."approvedTermsJson", NEW."policyReferencesJson", NEW."sourceReference", NEW."expiresAt", NEW."supersedesContextId", NEW."approvedByUserId", NEW."approvedAt", NEW."createdAt", NEW."revocationReason")
       IS DISTINCT FROM
       ROW(OLD."id", OLD."tenantId", OLD."companyId", OLD."version", OLD."kind", OLD."moduleScope", OLD."presentationStyle", OLD."approvedTermsJson", OLD."policyReferencesJson", OLD."sourceReference", OLD."expiresAt", OLD."supersedesContextId", OLD."approvedByUserId", OLD."approvedAt", OLD."createdAt", OLD."revocationReason") THEN
      RAISE EXCEPTION 'Approved AiCompanyContext payload is immutable';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" = 'APPROVED' AND NEW."status" = 'REVOKED' THEN
    IF ROW(NEW."id", NEW."tenantId", NEW."companyId", NEW."version", NEW."kind", NEW."moduleScope", NEW."presentationStyle", NEW."approvedTermsJson", NEW."policyReferencesJson", NEW."sourceReference", NEW."expiresAt", NEW."supersedesContextId", NEW."approvedByUserId", NEW."approvedAt", NEW."createdAt")
       IS DISTINCT FROM
       ROW(OLD."id", OLD."tenantId", OLD."companyId", OLD."version", OLD."kind", OLD."moduleScope", OLD."presentationStyle", OLD."approvedTermsJson", OLD."policyReferencesJson", OLD."sourceReference", OLD."expiresAt", OLD."supersedesContextId", OLD."approvedByUserId", OLD."approvedAt", OLD."createdAt") THEN
      RAISE EXCEPTION 'Approved AiCompanyContext payload is immutable';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Approved AiCompanyContext payload is immutable; create a replacement version';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiCompanyContext_approved_payload_guard"
  BEFORE UPDATE OR DELETE ON "AiCompanyContext"
  FOR EACH ROW EXECUTE FUNCTION "baseer_guard_ai_company_context_lifecycle"();
