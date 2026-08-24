-- E4: deterministic Basira consumption guard. A provider dashboard budget is
-- deliberately not trusted as a hard stop. The application reserves the
-- maximum bounded request cost before egress, then settles actual usage.

CREATE TYPE "AiBudgetReservationStatus" AS ENUM ('RESERVED', 'SETTLED', 'RELEASED', 'EXPIRED');
CREATE TYPE "AiUsageLedgerKind" AS ENUM ('RESERVATION', 'SETTLEMENT', 'RELEASE');

ALTER TABLE "AiExecutionReceipt"
  ADD COLUMN "inputTokens" INTEGER,
  ADD COLUMN "cachedInputTokens" INTEGER,
  ADD COLUMN "outputTokens" INTEGER,
  ADD COLUMN "reasoningTokens" INTEGER,
  ADD COLUMN "modelPriceRevisionId" UUID,
  ADD COLUMN "estimatedCostUsd" DECIMAL(18, 8),
  ADD COLUMN "actualCostUsd" DECIMAL(18, 8),
  ADD COLUMN "providerRequestId" VARCHAR(160);

CREATE TABLE "AiModelPriceRevision" (
  "id" UUID PRIMARY KEY,
  "provider" "AiProviderKind" NOT NULL,
  "model" VARCHAR(160) NOT NULL,
  "version" INTEGER NOT NULL,
  "effectiveFrom" TIMESTAMPTZ(6) NOT NULL,
  "inputUsdPerMillion" DECIMAL(18, 8) NOT NULL,
  "cachedInputUsdPerMillion" DECIMAL(18, 8) NOT NULL,
  "outputUsdPerMillion" DECIMAL(18, 8) NOT NULL,
  "sourceReference" VARCHAR(500) NOT NULL,
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiModelPriceRevision_version_positive" CHECK ("version" > 0),
  CONSTRAINT "AiModelPriceRevision_rates_positive" CHECK (
    "inputUsdPerMillion" > 0 AND "cachedInputUsdPerMillion" >= 0 AND "outputUsdPerMillion" > 0
  ),
  CONSTRAINT "AiModelPriceRevision_source_nonempty" CHECK (length(trim("sourceReference")) > 0),
  CONSTRAINT "AiModelPriceRevision_provider_model_version_key" UNIQUE ("provider", "model", "version")
);
CREATE INDEX "AiModelPriceRevision_provider_model_effective_idx"
  ON "AiModelPriceRevision" ("provider", "model", "effectiveFrom");

-- The current code-owned S2 profile defaults to gpt-5-mini. Prices are USD
-- per 1M tokens and must be revised by a new version whenever the provider
-- price changes. Source checked 2026-08-24.
INSERT INTO "AiModelPriceRevision" (
  "id", "provider", "model", "version", "effectiveFrom",
  "inputUsdPerMillion", "cachedInputUsdPerMillion", "outputUsdPerMillion", "sourceReference"
) VALUES (
  'a5000000-0000-4000-8000-000000000001', 'OPENAI_COMPATIBLE', 'gpt-5-mini', 1,
  '2026-08-24T00:00:00.000Z', 0.25000000, 0.02500000, 2.00000000,
  'https://developers.openai.com/api/docs/models/gpt-5-mini'
);

CREATE TABLE "AiBudgetReservation" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "providerConfigurationId" UUID NOT NULL,
  "skillActivationId" UUID NOT NULL,
  "interpretationRunId" UUID NOT NULL,
  "modelPriceRevisionId" UUID NOT NULL,
  "dayStartAt" TIMESTAMPTZ(6) NOT NULL,
  "status" "AiBudgetReservationStatus" NOT NULL DEFAULT 'RESERVED',
  "inputTokenEstimate" INTEGER NOT NULL,
  "maxOutputTokens" INTEGER NOT NULL,
  "estimatedCostUsd" DECIMAL(18, 8) NOT NULL,
  "chargeCostUsd" DECIMAL(18, 8) NOT NULL,
  "actualCostUsd" DECIMAL(18, 8),
  "expiresAt" TIMESTAMPTZ(6) NOT NULL,
  "settledAt" TIMESTAMPTZ(6),
  "releasedAt" TIMESTAMPTZ(6),
  "releaseReason" VARCHAR(120),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiBudgetReservation_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiBudgetReservation_provider_fk" FOREIGN KEY ("providerConfigurationId", "tenantId") REFERENCES "AiProviderConfiguration"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiBudgetReservation_activation_fk" FOREIGN KEY ("skillActivationId", "tenantId", "companyId") REFERENCES "AiSkillActivation"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiBudgetReservation_run_fk" FOREIGN KEY ("interpretationRunId", "tenantId", "companyId") REFERENCES "AiInterpretationRun"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiBudgetReservation_price_fk" FOREIGN KEY ("modelPriceRevisionId") REFERENCES "AiModelPriceRevision"("id") ON DELETE RESTRICT,
  CONSTRAINT "AiBudgetReservation_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AiBudgetReservation_run_tenant_company_key" UNIQUE ("interpretationRunId", "tenantId", "companyId"),
  CONSTRAINT "AiBudgetReservation_nonnegative" CHECK (
    "inputTokenEstimate" >= 0 AND "maxOutputTokens" > 0
    AND "estimatedCostUsd" >= 0 AND "chargeCostUsd" >= 0
    AND ("actualCostUsd" IS NULL OR "actualCostUsd" >= 0)
  ),
  CONSTRAINT "AiBudgetReservation_lifecycle_consistent" CHECK (
    ("status" = 'RESERVED' AND "actualCostUsd" IS NULL AND "settledAt" IS NULL AND "releasedAt" IS NULL AND "releaseReason" IS NULL AND "expiresAt" > "createdAt")
    OR ("status" = 'SETTLED' AND "actualCostUsd" IS NOT NULL AND "settledAt" IS NOT NULL AND "releasedAt" IS NULL AND "releaseReason" IS NULL)
    OR ("status" IN ('RELEASED', 'EXPIRED') AND "actualCostUsd" IS NULL AND "settledAt" IS NULL AND "releasedAt" IS NOT NULL AND length(trim(COALESCE("releaseReason", ''))) > 0)
  )
);
CREATE INDEX "AiBudgetReservation_provider_day_status_idx"
  ON "AiBudgetReservation" ("tenantId", "providerConfigurationId", "dayStartAt", "status");
CREATE INDEX "AiBudgetReservation_company_activation_day_status_idx"
  ON "AiBudgetReservation" ("tenantId", "companyId", "skillActivationId", "dayStartAt", "status");

CREATE TABLE "AiUsageLedger" (
  "id" UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL,
  "companyId" UUID NOT NULL,
  "reservationId" UUID NOT NULL,
  "executionReceiptId" UUID,
  "providerConfigurationId" UUID NOT NULL,
  "skillActivationId" UUID NOT NULL,
  "modelPriceRevisionId" UUID NOT NULL,
  "kind" "AiUsageLedgerKind" NOT NULL,
  "inputTokens" INTEGER,
  "cachedInputTokens" INTEGER,
  "outputTokens" INTEGER,
  "reasoningTokens" INTEGER,
  "estimatedCostUsd" DECIMAL(18, 8) NOT NULL,
  "actualCostUsd" DECIMAL(18, 8),
  "safeReasonCode" VARCHAR(120),
  "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AiUsageLedger_company_fk" FOREIGN KEY ("companyId", "tenantId") REFERENCES "Company"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiUsageLedger_reservation_fk" FOREIGN KEY ("reservationId", "tenantId", "companyId") REFERENCES "AiBudgetReservation"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiUsageLedger_receipt_fk" FOREIGN KEY ("executionReceiptId", "tenantId", "companyId") REFERENCES "AiExecutionReceipt"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiUsageLedger_provider_fk" FOREIGN KEY ("providerConfigurationId", "tenantId") REFERENCES "AiProviderConfiguration"("id", "tenantId") ON DELETE RESTRICT,
  CONSTRAINT "AiUsageLedger_activation_fk" FOREIGN KEY ("skillActivationId", "tenantId", "companyId") REFERENCES "AiSkillActivation"("id", "tenantId", "companyId") ON DELETE RESTRICT,
  CONSTRAINT "AiUsageLedger_price_fk" FOREIGN KEY ("modelPriceRevisionId") REFERENCES "AiModelPriceRevision"("id") ON DELETE RESTRICT,
  CONSTRAINT "AiUsageLedger_id_tenant_company_key" UNIQUE ("id", "tenantId", "companyId"),
  CONSTRAINT "AiUsageLedger_nonnegative" CHECK (
    ("inputTokens" IS NULL OR "inputTokens" >= 0)
    AND ("cachedInputTokens" IS NULL OR "cachedInputTokens" >= 0)
    AND ("outputTokens" IS NULL OR "outputTokens" >= 0)
    AND ("reasoningTokens" IS NULL OR "reasoningTokens" >= 0)
    AND "estimatedCostUsd" >= 0 AND ("actualCostUsd" IS NULL OR "actualCostUsd" >= 0)
  )
);
CREATE INDEX "AiUsageLedger_tenant_company_created_idx" ON "AiUsageLedger" ("tenantId", "companyId", "createdAt");
CREATE INDEX "AiUsageLedger_provider_created_idx" ON "AiUsageLedger" ("tenantId", "providerConfigurationId", "createdAt");
CREATE INDEX "AiUsageLedger_company_activation_created_idx" ON "AiUsageLedger" ("tenantId", "companyId", "skillActivationId", "createdAt");

ALTER TABLE "AiExecutionReceipt"
  ADD CONSTRAINT "AiExecutionReceipt_price_fk" FOREIGN KEY ("modelPriceRevisionId") REFERENCES "AiModelPriceRevision"("id") ON DELETE RESTRICT;
CREATE INDEX "AiExecutionReceipt_price_idx" ON "AiExecutionReceipt" ("modelPriceRevisionId");
ALTER TABLE "AiExecutionReceipt"
  ADD CONSTRAINT "AiExecutionReceipt_usage_nonnegative" CHECK (
    ("inputTokens" IS NULL OR "inputTokens" >= 0)
    AND ("cachedInputTokens" IS NULL OR "cachedInputTokens" >= 0)
    AND ("outputTokens" IS NULL OR "outputTokens" >= 0)
    AND ("reasoningTokens" IS NULL OR "reasoningTokens" >= 0)
    AND ("estimatedCostUsd" IS NULL OR "estimatedCostUsd" >= 0)
    AND ("actualCostUsd" IS NULL OR "actualCostUsd" >= 0)
  );

COMMENT ON COLUMN "AiProviderConfiguration"."dailyCostLimit" IS 'Hard daily USD cap. Required by the consumption guard before any live provider request.';
COMMENT ON COLUMN "AiSkillActivation"."dailyCostLimit" IS 'Hard daily USD cap for this company skill activation. Required before live provider request.';

ALTER TABLE "AiModelPriceRevision" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiModelPriceRevision" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AiModelPriceRevision_read_only" ON "AiModelPriceRevision"
  FOR SELECT USING (true);

ALTER TABLE "AiBudgetReservation" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiBudgetReservation" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AiUsageLedger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AiUsageLedger" FORCE ROW LEVEL SECURITY;
CREATE POLICY "AiBudgetReservation_tenant_isolation" ON "AiBudgetReservation"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE POLICY "AiUsageLedger_tenant_isolation" ON "AiUsageLedger"
  USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

CREATE OR REPLACE FUNCTION "baseer_guard_ai_budget_reservation_lifecycle"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AiBudgetReservation rows are retained for cost audit';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'RESERVED' THEN
      RAISE EXCEPTION 'AiBudgetReservation must begin RESERVED';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" <> 'RESERVED' THEN
    RAISE EXCEPTION 'Settled, released, or expired AiBudgetReservation rows cannot change';
  END IF;
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
     OR NEW."providerConfigurationId" IS DISTINCT FROM OLD."providerConfigurationId"
     OR NEW."skillActivationId" IS DISTINCT FROM OLD."skillActivationId"
     OR NEW."interpretationRunId" IS DISTINCT FROM OLD."interpretationRunId"
     OR NEW."modelPriceRevisionId" IS DISTINCT FROM OLD."modelPriceRevisionId"
     OR NEW."dayStartAt" IS DISTINCT FROM OLD."dayStartAt"
     OR NEW."inputTokenEstimate" IS DISTINCT FROM OLD."inputTokenEstimate"
     OR NEW."maxOutputTokens" IS DISTINCT FROM OLD."maxOutputTokens"
     OR NEW."estimatedCostUsd" IS DISTINCT FROM OLD."estimatedCostUsd"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'AiBudgetReservation scope and estimate are immutable';
  END IF;
  IF NEW."status" = 'SETTLED'
     AND NEW."actualCostUsd" IS NOT NULL AND NEW."chargeCostUsd" = NEW."actualCostUsd"
     AND NEW."settledAt" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW."status" IN ('RELEASED', 'EXPIRED')
     AND NEW."chargeCostUsd" = 0 AND NEW."releasedAt" IS NOT NULL
     AND length(trim(COALESCE(NEW."releaseReason", ''))) > 0 THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AiBudgetReservation lifecycle transition is not permitted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiBudgetReservation_lifecycle_guard"
  BEFORE INSERT OR UPDATE OR DELETE ON "AiBudgetReservation"
  FOR EACH ROW EXECUTE FUNCTION "baseer_guard_ai_budget_reservation_lifecycle"();

CREATE OR REPLACE FUNCTION "baseer_prevent_ai_usage_ledger_mutation"() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'AiUsageLedger rows are append-only'; END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "AiUsageLedger_append_only"
  BEFORE UPDATE OR DELETE ON "AiUsageLedger"
  FOR EACH ROW EXECUTE FUNCTION "baseer_prevent_ai_usage_ledger_mutation"();
