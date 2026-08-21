-- A durable, system-only lease for scheduled jobs. It intentionally has no
-- tenant row or RLS policy: it never carries business data and is used solely
-- to ensure that one API replica owns a code-defined scheduler at a time.
-- The lease replaces an interactive-transaction advisory lock, which must not
-- remain open while tenant work opens nested Prisma transactions.
CREATE TABLE "SystemSchedulerLease" (
  "lockName" VARCHAR(160) PRIMARY KEY,
  "ownerId" UUID NOT NULL,
  "leaseExpiresAt" TIMESTAMPTZ(6) NOT NULL,
  "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "SystemSchedulerLease_expiry_idx" ON "SystemSchedulerLease" ("leaseExpiresAt");
