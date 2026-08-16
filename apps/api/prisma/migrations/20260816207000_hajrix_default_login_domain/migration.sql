-- BASEER uses hajrix.com as the single default email domain for all users.
-- The immutable User.id is unchanged; only the editable sign-in identifier moves.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "User" AS legacy
    INNER JOIN "User" AS collision
      ON collision."tenantId" = legacy."tenantId"
     AND collision."loginNormalized" = lower(split_part(legacy."loginNormalized", '@', 1) || '@hajrix.com')
     AND collision."id" <> legacy."id"
    WHERE legacy."loginNormalized" NOT LIKE '%@hajrix.com'
  ) THEN
    RAISE EXCEPTION 'Cannot migrate user logins to hajrix.com because a target login already exists.';
  END IF;
END $$;

UPDATE "User"
SET "loginNormalized" = lower(split_part("loginNormalized", '@', 1) || '@hajrix.com')
WHERE "loginNormalized" NOT LIKE '%@hajrix.com';