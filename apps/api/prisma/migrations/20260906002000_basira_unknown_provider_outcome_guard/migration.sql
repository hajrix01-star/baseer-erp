-- Preserve cost on a lease expiry after possible provider egress, while still
-- allowing a late authoritative usage report to settle that reservation.
CREATE OR REPLACE FUNCTION "baseer_guard_ai_budget_reservation_lifecycle"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'AiBudgetReservation rows are retained for cost audit'; END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'RESERVED' THEN RAISE EXCEPTION 'AiBudgetReservation must begin RESERVED'; END IF;
    RETURN NEW;
  END IF;
  IF OLD."status" NOT IN ('RESERVED', 'UNKNOWN_PROVIDER_OUTCOME') THEN RAISE EXCEPTION 'Settled, released, or expired AiBudgetReservation rows cannot change'; END IF;
  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId" OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
     OR NEW."providerConfigurationId" IS DISTINCT FROM OLD."providerConfigurationId" OR NEW."skillActivationId" IS DISTINCT FROM OLD."skillActivationId"
     OR NEW."interpretationRunId" IS DISTINCT FROM OLD."interpretationRunId" OR NEW."modelPriceRevisionId" IS DISTINCT FROM OLD."modelPriceRevisionId"
     OR NEW."dayStartAt" IS DISTINCT FROM OLD."dayStartAt" OR NEW."monthStartAt" IS DISTINCT FROM OLD."monthStartAt"
     OR NEW."companyPolicyRevisionId" IS DISTINCT FROM OLD."companyPolicyRevisionId" OR NEW."inputTokenEstimate" IS DISTINCT FROM OLD."inputTokenEstimate"
     OR NEW."maxOutputTokens" IS DISTINCT FROM OLD."maxOutputTokens" OR NEW."estimatedCostUsd" IS DISTINCT FROM OLD."estimatedCostUsd"
     OR NEW."expiresAt" IS DISTINCT FROM OLD."expiresAt" OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'AiBudgetReservation scope and estimate are immutable';
  END IF;
  IF NEW."status" = 'SETTLED' AND NEW."actualCostUsd" IS NOT NULL AND NEW."chargeCostUsd" = NEW."actualCostUsd" AND NEW."settledAt" IS NOT NULL THEN RETURN NEW; END IF;
  IF OLD."status" = 'RESERVED' AND NEW."status" = 'UNKNOWN_PROVIDER_OUTCOME'
     AND NEW."actualCostUsd" IS NOT DISTINCT FROM OLD."actualCostUsd" AND NEW."chargeCostUsd" = OLD."chargeCostUsd"
     AND NEW."releasedAt" IS NOT NULL AND NEW."settledAt" IS NULL AND length(trim(COALESCE(NEW."releaseReason", ''))) > 0 THEN RETURN NEW; END IF;
  IF OLD."status" = 'RESERVED' AND NEW."status" IN ('RELEASED', 'EXPIRED')
     AND NEW."chargeCostUsd" = 0 AND NEW."releasedAt" IS NOT NULL AND length(trim(COALESCE(NEW."releaseReason", ''))) > 0 THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'AiBudgetReservation lifecycle transition is not permitted';
END;
$$ LANGUAGE plpgsql;
