CREATE TABLE "DecisionContextImportRun" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "sourceId" UUID NOT NULL,
  "triggerCode" VARCHAR(80) NOT NULL,
  "status" VARCHAR(40) NOT NULL,
  "documentChecksum" CHAR(64),
  "receivedEvents" INTEGER NOT NULL DEFAULT 0,
  "publishedEvents" INTEGER NOT NULL DEFAULT 0,
  "reviewEvents" INTEGER NOT NULL DEFAULT 0,
  "diagnosticsJson" JSONB NOT NULL,
  "startedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMPTZ(6),
  CONSTRAINT "DecisionContextImportRun_source_fk" FOREIGN KEY ("sourceId", "tenantId") REFERENCES "DecisionContextSource"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionContextImportRun_id_tenant_key" UNIQUE ("id", "tenantId")
);

CREATE INDEX "DecisionContextImportRun_tenant_source_started_idx" ON "DecisionContextImportRun" ("tenantId", "sourceId", "startedAt");

ALTER TABLE "DecisionContextImportRun" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DecisionContextImportRun" FORCE ROW LEVEL SECURITY;
CREATE POLICY "DecisionContextImportRun_tenant_isolation" ON "DecisionContextImportRun"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
