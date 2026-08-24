-- Shared Basira interpretations. A result is immutable, encrypted and bound
-- to one frozen evidence package. The mutable run is only a short-lived
-- concurrency lease; it never contains a model response.

CREATE TYPE "AiInterpretationRunStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED');
CREATE TYPE "AiInterpretationSubjectKind" AS ENUM ('DECISION_ALERT', 'MARKETING_CAMPAIGN');
CREATE TYPE "AiInterpretationPlacementKind" AS ENUM ('DECISION_ALERT', 'MARKETING_CAMPAIGN', 'COMMAND_CENTER', 'REPORT');

CREATE TABLE "AiInterpretation" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "subjectKind" "AiInterpretationSubjectKind" NOT NULL,
  "subjectId" UUID NOT NULL,
  "evidenceSnapshotId" UUID NOT NULL,
  "evidenceChecksum" CHAR(64) NOT NULL,
  "reuseKey" CHAR(64) NOT NULL,
  "skillKey" VARCHAR(120) NOT NULL,
  "skillVersion" INTEGER NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "promptVersion" INTEGER NOT NULL,
  "language" VARCHAR(2) NOT NULL,
  "systemIdentityVersion" INTEGER,
  "companyContextDigest" CHAR(64) NOT NULL,
  "modelProfileDigest" CHAR(64) NOT NULL,
  "providerSnapshot" "AiProviderKind" NOT NULL,
  "modelSnapshot" VARCHAR(160) NOT NULL,
  "sourceExecutionReceiptId" UUID NOT NULL,
  "encryptedOutput" TEXT NOT NULL,
  "outputIv" VARCHAR(64) NOT NULL,
  "outputTag" VARCHAR(64) NOT NULL,
  "outputKeyVersion" INTEGER NOT NULL,
  "outputChecksum" CHAR(64) NOT NULL,
  "expiresAt" TIMESTAMPTZ(6),
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiInterpretation_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiInterpretation_evidence_fk" FOREIGN KEY ("evidenceSnapshotId", "tenantId", "companyId") REFERENCES "DecisionEvidenceSnapshot"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiInterpretation_receipt_fk" FOREIGN KEY ("sourceExecutionReceiptId", "tenantId", "companyId") REFERENCES "AiExecutionReceipt"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiInterpretation_actor_fk" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiInterpretation_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AiInterpretation_versions_positive" CHECK ("skillVersion" > 0 AND "policyVersion" > 0 AND "promptVersion" > 0 AND "outputKeyVersion" > 0 AND ("systemIdentityVersion" IS NULL OR "systemIdentityVersion" > 0)),
  CONSTRAINT "AiInterpretation_language_valid" CHECK ("language" IN ('ar', 'en')),
  CONSTRAINT "AiInterpretation_checksum_format" CHECK (
    "evidenceChecksum" ~ '^[0-9a-f]{64}$'
    AND "reuseKey" ~ '^[0-9a-f]{64}$'
    AND "companyContextDigest" ~ '^[0-9a-f]{64}$'
    AND "modelProfileDigest" ~ '^[0-9a-f]{64}$'
    AND "outputChecksum" ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT "AiInterpretation_output_not_blank" CHECK (length(trim("encryptedOutput")) > 0)
);
CREATE INDEX "AiInterpretation_tenant_company_reuse_created_idx" ON "AiInterpretation" ("tenantId", "companyId", "reuseKey", "createdAt");
CREATE INDEX "AiInterpretation_tenant_company_subject_created_idx" ON "AiInterpretation" ("tenantId", "companyId", "subjectKind", "subjectId", "createdAt");
CREATE INDEX "AiInterpretation_tenant_company_evidence_created_idx" ON "AiInterpretation" ("tenantId", "companyId", "evidenceSnapshotId", "createdAt");

CREATE TABLE "AiInterpretationRun" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "reuseKey" CHAR(64) NOT NULL,
  "status" "AiInterpretationRunStatus" NOT NULL DEFAULT 'PENDING',
  "leaseExpiresAt" TIMESTAMPTZ(6) NOT NULL,
  "claimedByUserId" UUID NOT NULL,
  "interpretationId" UUID,
  "safeFailureCode" VARCHAR(120),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMPTZ(6),
  CONSTRAINT "AiInterpretationRun_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiInterpretationRun_actor_fk" FOREIGN KEY ("claimedByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiInterpretationRun_interpretation_fk" FOREIGN KEY ("interpretationId", "tenantId", "companyId") REFERENCES "AiInterpretation"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiInterpretationRun_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AiInterpretationRun_reuse_checksum_format" CHECK ("reuseKey" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "AiInterpretationRun_pending_consistent" CHECK (
    ("status" = 'PENDING' AND "interpretationId" IS NULL AND "safeFailureCode" IS NULL AND "completedAt" IS NULL AND "leaseExpiresAt" > "createdAt")
    OR ("status" = 'COMPLETED' AND "interpretationId" IS NOT NULL AND "safeFailureCode" IS NULL AND "completedAt" IS NOT NULL)
    OR ("status" = 'FAILED' AND "interpretationId" IS NULL AND length(trim(COALESCE("safeFailureCode", ''))) > 0 AND "completedAt" IS NOT NULL)
  )
);
CREATE INDEX "AiInterpretationRun_tenant_company_reuse_status_lease_idx" ON "AiInterpretationRun" ("tenantId", "companyId", "reuseKey", "status", "leaseExpiresAt");
-- PostgreSQL enforces the actual cross-instance single-flight property. Rows
-- from completed or failed attempts do not prevent a replacement after expiry.
CREATE UNIQUE INDEX "AiInterpretationRun_one_pending_per_reuse_key"
  ON "AiInterpretationRun" ("tenantId", "companyId", "reuseKey")
  WHERE "status" = 'PENDING';

CREATE TABLE "AiInterpretationPlacement" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "interpretationId" UUID NOT NULL,
  "kind" "AiInterpretationPlacementKind" NOT NULL,
  "subjectId" UUID NOT NULL,
  "moduleKey" VARCHAR(80) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiInterpretationPlacement_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiInterpretationPlacement_interpretation_fk" FOREIGN KEY ("interpretationId", "tenantId", "companyId") REFERENCES "AiInterpretation"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiInterpretationPlacement_actor_fk" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiInterpretationPlacement_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AiInterpretationPlacement_reference_key" UNIQUE ("interpretationId", "kind", "subjectId", "moduleKey"),
  CONSTRAINT "AiInterpretationPlacement_module_nonempty" CHECK (length(trim("moduleKey")) > 0)
);
CREATE INDEX "AiInterpretationPlacement_tenant_company_subject_created_idx" ON "AiInterpretationPlacement" ("tenantId", "companyId", "kind", "subjectId", "createdAt");

-- Campaign evidence is a retained analysis artifact. A checksum identifies the
-- same frozen campaign brief, so duplicate manual requests cannot grow it.
CREATE UNIQUE INDEX "DecisionEvidenceSnapshot_marketing_campaign_checksum_key"
  ON "DecisionEvidenceSnapshot" ("tenantId", "companyId", "checksum")
  WHERE ("payloadJson" ->> 'schemaVersion') = 'basira.marketing_campaign_brief.v1';

ALTER TABLE "AiInterpretation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiInterpretation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AiInterpretationRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiInterpretationRun" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AiInterpretationPlacement" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiInterpretationPlacement" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AiInterpretation_tenant_isolation" ON "AiInterpretation"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AiInterpretationRun_tenant_isolation" ON "AiInterpretationRun"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AiInterpretationPlacement_tenant_isolation" ON "AiInterpretationPlacement"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- A successful immutable interpretation must prove the evidence checksum and
-- source receipt at the database boundary, not only in service code.
CREATE OR REPLACE FUNCTION "baseer_guard_ai_interpretation_insert"() RETURNS trigger AS $$
DECLARE
  snapshot_checksum CHAR(64);
  receipt_outcome "AiExecutionOutcome";
  receipt_evidence_id UUID;
  receipt_input_checksum CHAR(64);
  receipt_output_checksum CHAR(64);
BEGIN
  SELECT "checksum" INTO snapshot_checksum
    FROM "DecisionEvidenceSnapshot"
    WHERE "id" = NEW."evidenceSnapshotId" AND "tenantId" = NEW."tenantId" AND "companyId" = NEW."companyId";
  IF snapshot_checksum IS NULL OR snapshot_checksum <> NEW."evidenceChecksum" THEN
    RAISE EXCEPTION 'AiInterpretation evidence checksum does not match its snapshot';
  END IF;
  SELECT "outcome", "evidenceSnapshotId", "inputChecksum", "outputChecksum"
    INTO receipt_outcome, receipt_evidence_id, receipt_input_checksum, receipt_output_checksum
    FROM "AiExecutionReceipt"
    WHERE "id" = NEW."sourceExecutionReceiptId" AND "tenantId" = NEW."tenantId" AND "companyId" = NEW."companyId";
  IF receipt_outcome IS DISTINCT FROM 'SUCCEEDED'::"AiExecutionOutcome" THEN
    RAISE EXCEPTION 'AiInterpretation requires a succeeded source execution receipt';
  END IF;
  IF receipt_evidence_id IS DISTINCT FROM NEW."evidenceSnapshotId"
     OR receipt_input_checksum IS DISTINCT FROM NEW."evidenceChecksum"
     OR receipt_output_checksum IS DISTINCT FROM NEW."outputChecksum" THEN
    RAISE EXCEPTION 'AiInterpretation receipt does not match its evidence or output checksum';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiInterpretation_validate_source"
  BEFORE INSERT ON "AiInterpretation"
  FOR EACH ROW EXECUTE FUNCTION "baseer_guard_ai_interpretation_insert"();

CREATE OR REPLACE FUNCTION "baseer_prevent_ai_interpretation_mutation"() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'AiInterpretation rows are append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiInterpretation_append_only"
  BEFORE UPDATE OR DELETE ON "AiInterpretation"
  FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_ai_interpretation_mutation"();

CREATE OR REPLACE FUNCTION "baseer_guard_ai_interpretation_run_lifecycle"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AiInterpretationRun rows are retained for operation audit';
  END IF;
  IF OLD."status" <> 'PENDING' THEN
    RAISE EXCEPTION 'Completed or failed AiInterpretationRun rows cannot be changed';
  END IF;
  IF NEW."status" = 'PENDING' THEN
    RAISE EXCEPTION 'Pending AiInterpretationRun rows cannot be changed';
  END IF;
  IF NEW."reuseKey" IS DISTINCT FROM OLD."reuseKey"
     OR NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
     OR NEW."claimedByUserId" IS DISTINCT FROM OLD."claimedByUserId"
     OR NEW."leaseExpiresAt" IS DISTINCT FROM OLD."leaseExpiresAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'AiInterpretationRun claim fields are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiInterpretationRun_lifecycle_guard"
  BEFORE UPDATE OR DELETE ON "AiInterpretationRun"
  FOR EACH ROW EXECUTE FUNCTION "baseer_guard_ai_interpretation_run_lifecycle"();

CREATE OR REPLACE FUNCTION "baseer_prevent_ai_interpretation_placement_mutation"() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'AiInterpretationPlacement rows are append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiInterpretationPlacement_append_only"
  BEFORE UPDATE OR DELETE ON "AiInterpretationPlacement"
  FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_ai_interpretation_placement_mutation"();
