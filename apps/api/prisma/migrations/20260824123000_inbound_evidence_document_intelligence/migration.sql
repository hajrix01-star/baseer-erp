-- Visual document intelligence is immutable review evidence. It does not
-- create a financial document or make the source attachment authoritative.
CREATE TYPE "InboundEvidenceAnalysisStatus" AS ENUM ('ANALYZED', 'NEEDS_REVIEW', 'FAILED');

CREATE TABLE "InboundEvidenceDocumentAnalysis" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenantId" UUID NOT NULL,
  "attachmentId" UUID NOT NULL,
  "supersedesId" UUID,
  "status" "InboundEvidenceAnalysisStatus" NOT NULL,
  "sourceSha256" CHAR(64) NOT NULL,
  "skillKey" VARCHAR(120) NOT NULL,
  "skillVersion" INTEGER NOT NULL,
  "policyVersion" INTEGER NOT NULL,
  "provider" "AiProviderKind" NOT NULL,
  "model" VARCHAR(160) NOT NULL,
  "configurationVersion" INTEGER NOT NULL,
  "promptVersion" INTEGER NOT NULL,
  "schemaVersion" INTEGER NOT NULL,
  "resultJson" JSONB NOT NULL,
  "validationJson" JSONB NOT NULL,
  "resultChecksum" CHAR(64) NOT NULL,
  "requestId" VARCHAR(120) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "InboundEvidenceDocumentAnalysis_tenant_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT,
  CONSTRAINT "InboundEvidenceDocumentAnalysis_attachment_tenant_fkey" FOREIGN KEY ("attachmentId", "tenantId") REFERENCES "InboundEvidenceAttachment"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "InboundEvidenceDocumentAnalysis_supersedes_tenant_fkey" FOREIGN KEY ("supersedesId", "tenantId") REFERENCES "InboundEvidenceDocumentAnalysis"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "InboundEvidenceDocumentAnalysis_id_tenant_key" UNIQUE ("id", "tenantId")
);
CREATE INDEX "InboundEvidenceDocumentAnalysis_tenant_attachment_created_idx" ON "InboundEvidenceDocumentAnalysis" ("tenantId", "attachmentId", "createdAt");
CREATE INDEX "InboundEvidenceDocumentAnalysis_tenant_source_created_idx" ON "InboundEvidenceDocumentAnalysis" ("tenantId", "sourceSha256", "createdAt");

ALTER TABLE "InboundEvidenceDocumentAnalysis" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "InboundEvidenceDocumentAnalysis" FORCE ROW LEVEL SECURITY;
CREATE POLICY "InboundEvidenceDocumentAnalysis_tenant_isolation" ON "InboundEvidenceDocumentAnalysis"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION "baseer_prevent_inbound_evidence_analysis_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'InboundEvidenceDocumentAnalysis rows are append-only';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "InboundEvidenceDocumentAnalysis_append_only"
  BEFORE UPDATE OR DELETE ON "InboundEvidenceDocumentAnalysis"
  FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_inbound_evidence_analysis_mutation"();
