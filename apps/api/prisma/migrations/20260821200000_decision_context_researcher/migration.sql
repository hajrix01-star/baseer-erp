CREATE TYPE "DecisionContextCandidateStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'DISMISSED', 'DUPLICATE');

ALTER TABLE "DecisionGlobalContextEventRevision"
  ADD COLUMN "verificationStatus" "DecisionVerificationStatus" NOT NULL DEFAULT 'SYSTEM_RECONCILED';

CREATE TABLE "DecisionContextResearchRun" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "sourceId" UUID NOT NULL,
  "triggerCode" VARCHAR(80) NOT NULL,
  "status" VARCHAR(40) NOT NULL,
  "documentChecksum" CHAR(64),
  "receivedCandidates" INTEGER NOT NULL DEFAULT 0,
  "pendingCandidates" INTEGER NOT NULL DEFAULT 0,
  "duplicateCandidates" INTEGER NOT NULL DEFAULT 0,
  "diagnosticsJson" JSONB NOT NULL,
  "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(6),
  CONSTRAINT "DecisionContextResearchRun_source_fk" FOREIGN KEY ("sourceId", "tenantId") REFERENCES "DecisionContextSource"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionContextResearchRun_id_tenant_key" UNIQUE ("id", "tenantId")
);

CREATE INDEX "DecisionContextResearchRun_tenant_source_started_idx"
  ON "DecisionContextResearchRun" ("tenantId", "sourceId", "startedAt");

CREATE TABLE "DecisionContextCandidate" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "sourceId" UUID NOT NULL,
  "researchRunId" UUID NOT NULL,
  "externalKey" VARCHAR(240) NOT NULL,
  "eventKind" VARCHAR(80) NOT NULL,
  "titleAr" VARCHAR(240) NOT NULL,
  "startsOn" DATE NOT NULL,
  "endsOn" DATE NOT NULL,
  "locationLabelAr" VARCHAR(160),
  "relevanceReasonAr" VARCHAR(500),
  "sourceUpdatedAt" TIMESTAMPTZ(6),
  "sourceChecksum" CHAR(64) NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "status" "DecisionContextCandidateStatus" NOT NULL DEFAULT 'PENDING_REVIEW',
  "resolutionJson" JSONB,
  "publishedEventId" UUID,
  "resolvedByUserId" UUID,
  "resolvedAt" TIMESTAMPTZ(6),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionContextCandidate_source_fk" FOREIGN KEY ("sourceId", "tenantId") REFERENCES "DecisionContextSource"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionContextCandidate_run_fk" FOREIGN KEY ("researchRunId", "tenantId") REFERENCES "DecisionContextResearchRun"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionContextCandidate_published_event_fk" FOREIGN KEY ("publishedEventId", "tenantId") REFERENCES "DecisionGlobalContextEvent"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionContextCandidate_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "DecisionContextCandidate_tenant_source_external_key" UNIQUE ("tenantId", "sourceId", "externalKey")
);

CREATE INDEX "DecisionContextCandidate_tenant_status_dates_idx"
  ON "DecisionContextCandidate" ("tenantId", "status", "startsOn", "endsOn");
CREATE INDEX "DecisionContextCandidate_tenant_source_run_idx"
  ON "DecisionContextCandidate" ("tenantId", "sourceId", "researchRunId");

ALTER TABLE "DecisionContextResearchRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DecisionContextResearchRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY "DecisionContextResearchRun_tenant_isolation" ON "DecisionContextResearchRun"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

ALTER TABLE "DecisionContextCandidate" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DecisionContextCandidate" FORCE ROW LEVEL SECURITY;
CREATE POLICY "DecisionContextCandidate_tenant_isolation" ON "DecisionContextCandidate"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
