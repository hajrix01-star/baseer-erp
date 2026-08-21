-- Human lifecycle decisions are append-only. They explain why an alert was
-- acknowledged or closed without rewriting the frozen evidence snapshot.

CREATE TYPE "DecisionAlertActionKind" AS ENUM ('ACKNOWLEDGED', 'CLOSED');

CREATE TABLE "DecisionAlertAction" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "alertId" UUID NOT NULL,
  "action" "DecisionAlertActionKind" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionAlertAction_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionAlertAction_alert_fk" FOREIGN KEY ("alertId", "tenantId", "companyId") REFERENCES "DecisionAlert"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionAlertAction_actor_fk" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionAlertAction_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId")
);

CREATE INDEX "DecisionAlertAction_tenant_company_alert_created_idx" ON "DecisionAlertAction" ("tenantId", "companyId", "alertId", "createdAt");

ALTER TABLE "DecisionAlertAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DecisionAlertAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "DecisionAlertAction_tenant_isolation" ON "DecisionAlertAction"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION "decision_alert_action_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'DecisionAlertAction is append-only'; END; $$;
CREATE TRIGGER "DecisionAlertAction_append_only"
  BEFORE UPDATE OR DELETE ON "DecisionAlertAction"
  FOR EACH ROW EXECUTE FUNCTION "decision_alert_action_append_only"();
