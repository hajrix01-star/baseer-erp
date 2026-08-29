-- A company-map approval is an immutable review attestation.  It intentionally
-- does not mutate planned maps; a later migration run consumes the attestation.

ALTER TYPE "LegacyMigrationReviewActionKind" ADD VALUE IF NOT EXISTS 'APPROVE_COMPANY_MAPS';
