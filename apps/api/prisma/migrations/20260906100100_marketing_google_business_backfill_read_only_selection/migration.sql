-- The enum value is introduced in the preceding migration so PostgreSQL can
-- safely use it here. This is idempotent and touches only an already saved,
-- company-scoped Google Business selection; it never reads or moves secrets.
UPDATE "MarketingProviderConnection" AS connection
SET "status" = 'AUTHORIZED_READ_ONLY_SELECTED'
WHERE connection."provider" = 'GOOGLE_BUSINESS'
  AND connection."status" = 'AUTHORIZED_AWAITING_SELECTION'
  AND EXISTS (
    SELECT 1
    FROM "MarketingGoogleBusinessLocationMapping" AS mapping
    WHERE mapping."tenantId" = connection."tenantId"
      AND mapping."companyId" = connection."companyId"
      AND mapping."connectionId" = connection."id"
      AND mapping."provider" = 'GOOGLE_BUSINESS'
  );
