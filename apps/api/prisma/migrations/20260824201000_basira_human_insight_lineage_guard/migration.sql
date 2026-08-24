-- E3 hardening: a correction must remain inside the same interpretation, and
-- approval metadata may never be invented or changed while withdrawing it.

CREATE OR REPLACE FUNCTION "baseer_guard_ai_human_insight_lifecycle"() RETURNS trigger AS $$
DECLARE
  prior_interpretation_id UUID;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'AiHumanInsight rows are append-only';
  END IF;

  IF NEW."supersedesInsightId" IS NOT NULL THEN
    IF NEW."supersedesInsightId" = NEW."id" THEN
      RAISE EXCEPTION 'AiHumanInsight cannot supersede itself';
    END IF;

    SELECT "interpretationId"
      INTO prior_interpretation_id
      FROM "AiHumanInsight"
      WHERE "id" = NEW."supersedesInsightId"
        AND "tenantId" = NEW."tenantId"
        AND "companyId" = NEW."companyId";

    IF prior_interpretation_id IS NULL OR prior_interpretation_id <> NEW."interpretationId" THEN
      RAISE EXCEPTION 'AiHumanInsight supersedes record must belong to the same interpretation';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'AiHumanInsight must begin as a draft';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW."tenantId" IS DISTINCT FROM OLD."tenantId"
     OR NEW."companyId" IS DISTINCT FROM OLD."companyId"
     OR NEW."interpretationId" IS DISTINCT FROM OLD."interpretationId"
     OR NEW."kind" IS DISTINCT FROM OLD."kind"
     OR NEW."encryptedStatement" IS DISTINCT FROM OLD."encryptedStatement"
     OR NEW."statementIv" IS DISTINCT FROM OLD."statementIv"
     OR NEW."statementTag" IS DISTINCT FROM OLD."statementTag"
     OR NEW."statementKeyVersion" IS DISTINCT FROM OLD."statementKeyVersion"
     OR NEW."statementChecksum" IS DISTINCT FROM OLD."statementChecksum"
     OR NEW."supersedesInsightId" IS DISTINCT FROM OLD."supersedesInsightId"
     OR NEW."createdByUserId" IS DISTINCT FROM OLD."createdByUserId"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'AiHumanInsight content and lineage are immutable';
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'APPROVED'
     AND NEW."approvedByUserId" IS NOT NULL AND NEW."approvedAt" IS NOT NULL
     AND NEW."revokedByUserId" IS NULL AND NEW."revokedAt" IS NULL AND NEW."revocationReason" IS NULL THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'DRAFT' AND NEW."status" = 'REVOKED'
     AND NEW."approvedByUserId" IS NULL AND NEW."approvedAt" IS NULL
     AND NEW."revokedByUserId" IS NOT NULL AND NEW."revokedAt" IS NOT NULL
     AND length(trim(COALESCE(NEW."revocationReason", ''))) > 0 THEN
    RETURN NEW;
  END IF;

  IF OLD."status" = 'APPROVED' AND NEW."status" = 'REVOKED'
     AND NEW."approvedByUserId" IS NOT DISTINCT FROM OLD."approvedByUserId"
     AND NEW."approvedAt" IS NOT DISTINCT FROM OLD."approvedAt"
     AND NEW."revokedByUserId" IS NOT NULL AND NEW."revokedAt" IS NOT NULL
     AND length(trim(COALESCE(NEW."revocationReason", ''))) > 0 THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'AiHumanInsight lifecycle transition is not permitted';
END;
$$ LANGUAGE plpgsql;
