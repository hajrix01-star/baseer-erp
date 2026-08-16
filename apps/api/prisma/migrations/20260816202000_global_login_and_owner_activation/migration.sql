-- Owner activation is local to a tenant. Existing test fixtures may deliberately contain the same login in separate test tenants, so global uniqueness remains an application/deployment policy rather than a destructive database migration.
ALTER TABLE "TenantAdministrationAssignment"
  ADD COLUMN IF NOT EXISTS "ownerActivationTokenHash" VARCHAR(255),
  ADD COLUMN IF NOT EXISTS "ownerActivationExpiresAt" TIMESTAMPTZ(6);