# Baseer ERP release and recovery runbook

## Preconditions

1. Release image/version is immutable and recorded.
2. Staging is green for contracts, build, integration checks, RLS, audit, and the applicable Gate evidence.
3. Migration is additive or has an approved recovery plan.
4. A verified backup checkpoint exists and the operations owner confirms the alert path is healthy.

## Staging rehearsal

1. Deploy the exact release candidate to staging.
2. Apply migrations with a preflight report; stop on any unexpected migration state.
3. Run health/readiness, authentication, cross-company denial, audit correlation, and relevant module smoke checks.
4. Record image digest, migration names/checksums, timestamps, result, and reviewer. Do not record secrets or data rows.

## Production release

1. Announce the approved window and freeze non-essential changes.
2. Confirm a current backup checkpoint and recovery target availability.
3. Deploy the rehearsed image only; apply the rehearsed migrations only.
4. Run safe readiness and smoke checks, then observe error/latency signals during the defined watch period.
5. Declare completion only after the operational owner records the receipt.

## Failure decision

- **Before data migration:** stop, roll back the application image, and investigate.
- **Additive migration compatible with prior image:** prefer application rollback or forward-fix after preserving evidence.
- **Data integrity/security risk:** stop writes, escalate as P0, preserve evidence, and restore only into an isolated target first.
- **Never:** run an unreviewed destructive command, overwrite active production directly, or use Noorix as a runtime fallback.

