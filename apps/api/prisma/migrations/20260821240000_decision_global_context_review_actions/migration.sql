-- Imported public-context revisions are immutable. A separate append-only
-- action records the human decision to publish or dismiss a reviewed change.

CREATE TYPE "DecisionContextReviewActionKind" AS ENUM ('APPROVED', 'DISMISSED');

CREATE TABLE "DecisionGlobalContextReviewAction" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "eventId" UUID NOT NULL,
  "revision" INTEGER NOT NULL,
  "action" "DecisionContextReviewActionKind" NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "createdByUserId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DecisionGlobalContextReviewAction_event_fk" FOREIGN KEY ("eventId", "tenantId") REFERENCES "DecisionGlobalContextEvent"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionGlobalContextReviewAction_actor_fk" FOREIGN KEY ("createdByUserId", "tenantId") REFERENCES "User"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "DecisionGlobalContextReviewAction_id_tenant_key" UNIQUE ("id", "tenantId"),
  CONSTRAINT "DecisionGlobalContextReviewAction_event_revision_key" UNIQUE ("eventId", "revision")
);

CREATE INDEX "DecisionGlobalContextReviewAction_tenant_created_idx" ON "DecisionGlobalContextReviewAction" ("tenantId", "createdAt");

ALTER TABLE "DecisionGlobalContextReviewAction" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "DecisionGlobalContextReviewAction" FORCE ROW LEVEL SECURITY;
CREATE POLICY "DecisionGlobalContextReviewAction_tenant_isolation" ON "DecisionGlobalContextReviewAction"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION "decision_global_context_review_action_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'DecisionGlobalContextReviewAction is append-only'; END; $$;
CREATE TRIGGER "DecisionGlobalContextReviewAction_append_only"
  BEFORE UPDATE OR DELETE ON "DecisionGlobalContextReviewAction"
  FOR EACH ROW EXECUTE FUNCTION "decision_global_context_review_action_append_only"();
