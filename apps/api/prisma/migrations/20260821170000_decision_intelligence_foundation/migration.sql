-- Decision Intelligence & Context is an isolated, read-first analytical
-- foundation. It owns evidence and context, never financial source facts.

CREATE TYPE "DecisionDataQualityStatus" AS ENUM ('READY', 'NO_DATA', 'INCOMPLETE', 'STALE', 'UNAVAILABLE', 'CONFLICTED');
CREATE TYPE "DecisionEvidenceKind" AS ENUM ('OFFICIAL_FACT', 'PROVIDER_FACT', 'RECORDED_CONTEXT', 'EXTRACTED_CLAIM', 'HYPOTHESIS');
CREATE TYPE "DecisionVerificationStatus" AS ENUM ('UNVERIFIED', 'HUMAN_CONFIRMED', 'SYSTEM_RECONCILED', 'REJECTED', 'NOT_APPLICABLE');
CREATE TYPE "DecisionContextEventStatus" AS ENUM ('PUBLISHED', 'NEEDS_REVIEW', 'ARCHIVED');
CREATE TYPE "DecisionAlertStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'CLOSED');

CREATE TABLE "DecisionMetricDefinition" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
  "metricCode" VARCHAR(120) NOT NULL, "definitionVersion" VARCHAR(80) NOT NULL,
  "comparisonCode" VARCHAR(80) NOT NULL, "descriptionAr" VARCHAR(500) NOT NULL,
  "status" "DecisionContextEventStatus" NOT NULL DEFAULT 'PUBLISHED',
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionMetricDefinition_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionMetricDefinition_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "DecisionMetricDefinition_company_metric_version_key" UNIQUE ("companyId", "metricCode", "definitionVersion")
);

CREATE TABLE "DecisionContextSource" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "sourceCode" VARCHAR(80) NOT NULL,
  "displayNameAr" VARCHAR(160) NOT NULL, "sourceUrl" VARCHAR(1000) NOT NULL,
  "scheduleCode" VARCHAR(80) NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DecisionContextSource_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "DecisionContextSource_tenant_source_key" UNIQUE ("tenantId", "sourceCode")
);

CREATE TABLE "DecisionGlobalContextEvent" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "sourceId" UUID NOT NULL,
  "externalKey" VARCHAR(240) NOT NULL, "eventKind" VARCHAR(80) NOT NULL,
  "status" "DecisionContextEventStatus" NOT NULL DEFAULT 'PUBLISHED', "currentRevision" INTEGER NOT NULL DEFAULT 1,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DecisionGlobalContextEvent_source_fk" FOREIGN KEY ("sourceId", "tenantId") REFERENCES "DecisionContextSource"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionGlobalContextEvent_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "DecisionGlobalContextEvent_source_external_key" UNIQUE ("tenantId", "sourceId", "externalKey")
);

CREATE TABLE "DecisionGlobalContextEventRevision" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "eventId" UUID NOT NULL, "revision" INTEGER NOT NULL,
  "titleAr" VARCHAR(240) NOT NULL, "startsOn" DATE NOT NULL, "endsOn" DATE NOT NULL,
  "sourceUpdatedAt" TIMESTAMPTZ(6), "sourceChecksum" CHAR(64) NOT NULL, "importReceipt" JSONB NOT NULL,
  "status" "DecisionContextEventStatus" NOT NULL DEFAULT 'PUBLISHED', "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionGlobalContextEventRevision_dates_check" CHECK ("endsOn" >= "startsOn"),
  CONSTRAINT "DecisionGlobalContextEventRevision_event_fk" FOREIGN KEY ("eventId", "tenantId") REFERENCES "DecisionGlobalContextEvent"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionGlobalContextEventRevision_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "DecisionGlobalContextEventRevision_event_revision_key" UNIQUE ("eventId", "revision")
);

CREATE TABLE "DecisionCompanyContextEvent" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
  "eventKind" VARCHAR(80) NOT NULL, "titleAr" VARCHAR(240) NOT NULL, "startsOn" DATE NOT NULL, "endsOn" DATE NOT NULL,
  "verificationStatus" "DecisionVerificationStatus" NOT NULL DEFAULT 'HUMAN_CONFIRMED',
  "status" "DecisionContextEventStatus" NOT NULL DEFAULT 'PUBLISHED', "sourceReference" VARCHAR(500),
  "createdByUserId" UUID NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMPTZ(6) NOT NULL,
  CONSTRAINT "DecisionCompanyContextEvent_dates_check" CHECK ("endsOn" >= "startsOn"),
  CONSTRAINT "DecisionCompanyContextEvent_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionCompanyContextEvent_actor_fk" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionCompanyContextEvent_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId")
);

CREATE TABLE "DecisionEvaluationRun" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
  "ruleCode" VARCHAR(120) NOT NULL, "ruleVersion" VARCHAR(80) NOT NULL,
  "periodFrom" DATE NOT NULL, "periodTo" DATE NOT NULL, "dataQuality" "DecisionDataQualityStatus" NOT NULL,
  "inputsChecksum" CHAR(64) NOT NULL, "outcomeJson" JSONB NOT NULL, "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionEvaluationRun_dates_check" CHECK ("periodTo" >= "periodFrom"),
  CONSTRAINT "DecisionEvaluationRun_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionEvaluationRun_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "DecisionEvaluationRun_dedupe_key" UNIQUE ("companyId", "ruleCode", "ruleVersion", "periodFrom", "periodTo", "inputsChecksum")
);

CREATE TABLE "DecisionEvidenceSnapshot" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
  "sourceReportRunId" UUID, "supersedesSnapshotId" UUID,
  "evidenceKind" "DecisionEvidenceKind" NOT NULL, "verificationStatus" "DecisionVerificationStatus" NOT NULL,
  "periodFrom" DATE NOT NULL, "periodTo" DATE NOT NULL, "timezone" VARCHAR(64) NOT NULL DEFAULT 'Asia/Riyadh',
  "payloadJson" JSONB NOT NULL, "checksum" CHAR(64) NOT NULL, "createdByUserId" UUID,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionEvidenceSnapshot_dates_check" CHECK ("periodTo" >= "periodFrom"),
  CONSTRAINT "DecisionEvidenceSnapshot_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionEvidenceSnapshot_report_fk" FOREIGN KEY ("sourceReportRunId", "tenantId", "companyId") REFERENCES "ReportRun"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionEvidenceSnapshot_supersedes_fk" FOREIGN KEY ("supersedesSnapshotId", "tenantId", "companyId") REFERENCES "DecisionEvidenceSnapshot"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionEvidenceSnapshot_actor_fk" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionEvidenceSnapshot_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId")
);

CREATE TABLE "DecisionAlert" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL,
  "evaluationRunId" UUID NOT NULL, "evidenceSnapshotId" UUID NOT NULL,
  "ruleCode" VARCHAR(120) NOT NULL, "ruleVersion" VARCHAR(80) NOT NULL,
  "status" "DecisionAlertStatus" NOT NULL DEFAULT 'OPEN', "titleAr" VARCHAR(240) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP, "acknowledgedAt" TIMESTAMPTZ(6), "closedAt" TIMESTAMPTZ(6),
  CONSTRAINT "DecisionAlert_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionAlert_evaluation_fk" FOREIGN KEY ("evaluationRunId", "tenantId", "companyId") REFERENCES "DecisionEvaluationRun"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionAlert_evidence_fk" FOREIGN KEY ("evidenceSnapshotId", "tenantId", "companyId") REFERENCES "DecisionEvidenceSnapshot"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionAlert_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId")
);

CREATE TABLE "DecisionFeedback" (
  "id" UUID PRIMARY KEY, "tenantId" UUID NOT NULL, "companyId" UUID NOT NULL, "alertId" UUID NOT NULL,
  "kind" VARCHAR(80) NOT NULL, "note" VARCHAR(2000), "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionFeedback_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionFeedback_alert_fk" FOREIGN KEY ("alertId", "tenantId", "companyId") REFERENCES "DecisionAlert"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionFeedback_actor_fk" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionFeedback_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId")
);

CREATE INDEX "DecisionMetricDefinition_tenant_company_metric_status_idx" ON "DecisionMetricDefinition" ("tenantId", "companyId", "metricCode", "status");
CREATE INDEX "DecisionGlobalContextEvent_tenant_status_kind_idx" ON "DecisionGlobalContextEvent" ("tenantId", "status", "eventKind");
CREATE INDEX "DecisionGlobalContextEventRevision_tenant_period_status_idx" ON "DecisionGlobalContextEventRevision" ("tenantId", "startsOn", "endsOn", "status");
CREATE INDEX "DecisionCompanyContextEvent_tenant_company_period_status_idx" ON "DecisionCompanyContextEvent" ("tenantId", "companyId", "startsOn", "endsOn", "status");
CREATE INDEX "DecisionEvaluationRun_tenant_company_created_idx" ON "DecisionEvaluationRun" ("tenantId", "companyId", "createdAt");
CREATE INDEX "DecisionEvidenceSnapshot_tenant_company_created_idx" ON "DecisionEvidenceSnapshot" ("tenantId", "companyId", "createdAt");
CREATE INDEX "DecisionEvidenceSnapshot_tenant_company_report_idx" ON "DecisionEvidenceSnapshot" ("tenantId", "companyId", "sourceReportRunId");
CREATE INDEX "DecisionAlert_tenant_company_status_created_idx" ON "DecisionAlert" ("tenantId", "companyId", "status", "createdAt");
CREATE INDEX "DecisionAlert_tenant_company_rule_created_idx" ON "DecisionAlert" ("tenantId", "companyId", "ruleCode", "createdAt");
CREATE INDEX "DecisionFeedback_tenant_company_alert_created_idx" ON "DecisionFeedback" ("tenantId", "companyId", "alertId", "createdAt");

ALTER TABLE "DecisionMetricDefinition" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DecisionMetricDefinition" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DecisionContextSource" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DecisionContextSource" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DecisionGlobalContextEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DecisionGlobalContextEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DecisionGlobalContextEventRevision" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DecisionGlobalContextEventRevision" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DecisionCompanyContextEvent" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DecisionCompanyContextEvent" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DecisionEvaluationRun" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DecisionEvaluationRun" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DecisionEvidenceSnapshot" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DecisionEvidenceSnapshot" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DecisionAlert" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DecisionAlert" FORCE ROW LEVEL SECURITY;
ALTER TABLE "DecisionFeedback" ENABLE ROW LEVEL SECURITY; ALTER TABLE "DecisionFeedback" FORCE ROW LEVEL SECURITY;

CREATE POLICY "DecisionMetricDefinition_tenant_isolation" ON "DecisionMetricDefinition" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "DecisionContextSource_tenant_isolation" ON "DecisionContextSource" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "DecisionGlobalContextEvent_tenant_isolation" ON "DecisionGlobalContextEvent" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "DecisionGlobalContextEventRevision_tenant_isolation" ON "DecisionGlobalContextEventRevision" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "DecisionCompanyContextEvent_tenant_isolation" ON "DecisionCompanyContextEvent" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "DecisionEvaluationRun_tenant_isolation" ON "DecisionEvaluationRun" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "DecisionEvidenceSnapshot_tenant_isolation" ON "DecisionEvidenceSnapshot" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "DecisionAlert_tenant_isolation" ON "DecisionAlert" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "DecisionFeedback_tenant_isolation" ON "DecisionFeedback" USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION "decision_evidence_snapshot_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'DecisionEvidenceSnapshot is append-only'; END; $$;
CREATE TRIGGER "DecisionEvidenceSnapshot_append_only" BEFORE UPDATE OR DELETE ON "DecisionEvidenceSnapshot" FOR EACH ROW EXECUTE FUNCTION "decision_evidence_snapshot_append_only"();

CREATE OR REPLACE FUNCTION "decision_global_context_revision_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'DecisionGlobalContextEventRevision is append-only'; END; $$;
CREATE TRIGGER "DecisionGlobalContextEventRevision_append_only" BEFORE UPDATE OR DELETE ON "DecisionGlobalContextEventRevision" FOR EACH ROW EXECUTE FUNCTION "decision_global_context_revision_append_only"();
