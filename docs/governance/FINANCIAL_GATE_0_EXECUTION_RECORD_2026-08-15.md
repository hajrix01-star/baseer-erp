# BASEER ERP — Financial Gate 0 Execution Record

**Environment:** disposable local test stack only — Compose project `baseer-erp`, container `baseer-erp-postgres`, database `baseer_erp_test`.  
**Scope:** no Noorix database, `baseer_local`, production database, or business data was accessed or changed.

## Completed evidence

- Applied the complete Prisma chain successfully through `20260815221000_inclusive_loan_installments_and_reversal`.
- Confirmed `13` completed migrations in the test database.
- Confirmed application role `baseer_app` has `NOSUPERUSER` and `NOBYPASSRLS`.
- Confirmed `baseer_app` can insert audit records but cannot update or delete `AuditEvent`.
- Confirmed `25` RLS-protected tables and `4` journal triggers are present.
- Built TypeScript successfully with `npm.cmd run check --prefix apps/api` and `npm.cmd run build --prefix apps/api`.
- Ran the existing executable Gate B successfully. It verified RLS, identity/session handling, authorization, business date, output and file metadata controls, observability, audit rollback, idempotency, and concurrent serial allocation.

## Gate B repair made during verification

`scripts/run-gate-b-db-verification.mjs` now bounds shutdown waiting for the temporary Windows API child process. The old cleanup could remain unsettled after a signal and hide the actual test result. The repair changes test cleanup only; it does not change application or database behavior.

## Still required before Gate 0 is accepted

The existing Gate B proves the platform foundation, not the later finance flows. A dedicated executable financial gate remains required for:

1. journal balance, seal, immutable lines, and reversal;
2. post-versus-period-close concurrency;
3. supplier-due partial payment, reversal, and paid-only cash projection;
4. inclusive opening-loan repayment and reversal;
5. cross-company denial for all finance records.

Until those tests are added and pass, Finance APIs, writable Finance UI, live data migration, and production operation remain blocked by the approved build sequence.

## Financial Gate B — initial execution

`node scripts/run-finance-gate-b-db-verification.mjs` now passes against the same BASEER ERP test database. It proves journal sealing/balance/line immutability, company isolation, supplier-due partial payment and reversal with paid-only cash projection, and inclusive-loan repayment and reversal.

**Remaining Gate 0 test:** an executable concurrent close-versus-post race test. The source includes the shared advisory lock, but this exact race still needs a dedicated proof before Gate 0 is formally accepted.
## Gate 0 closure update

`node scripts/run-finance-period-race-verification.mjs` passed on the BASEER ERP test database. It holds an in-flight journal post inside the shared fiscal-period advisory lock, proves that close waits rather than racing past it, then proves that a new post is rejected after the period becomes `CLOSED`.

**Gate 0 financial safety evidence is now complete.** The next approved stage is the authorised Finance command/API boundary; this does not yet authorise a writable web UI, live Noorix migration, or production use.