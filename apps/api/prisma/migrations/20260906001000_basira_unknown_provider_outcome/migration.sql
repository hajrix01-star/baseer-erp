-- A lease expiry after the provider boundary is not evidence of zero cost.
-- Preserve that reservation until a reconciliation can settle it safely.
ALTER TYPE "AiBudgetReservationStatus" ADD VALUE IF NOT EXISTS 'UNKNOWN_PROVIDER_OUTCOME';
