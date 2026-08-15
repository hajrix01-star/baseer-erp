# Platform foundation delivery record

**Status:** Gate B complete; historical notes below are retained as evidence.
**Scope:** Identity, sessions, tenant/company context, authorization, audit,
idempotency, and document serial primitives.  
**Out of scope:** Finance, Noorix data import, Finance UI, and any Noorix
runtime connection.

## Gate A — discovery and decision evidence

| Question | Evidence / decision |
| --- | --- |
| User outcome | A user can establish a revocable Baseer session and access only live, permitted company scope. |
| Noorix equivalent | Read-only review recorded in [identity/company discovery](IDENTITY_COMPANY_CONTEXT_DISCOVERY.md) and [identity migration compatibility](IDENTITY_MIGRATION_COMPATIBILITY.md). |
| Source of truth | Baseer PostgreSQL is authoritative for Baseer identity, session, membership, role, and permission decisions. JWTs are identity receipts only. |
| Migration effect | Noorix CUIDs map to Baseer UUIDs in a future staged migration; Noorix passwords may be verified as bcrypt, but tokens and sessions never migrate. |
| Scope/permission decision | Tenant context is transaction-local RLS context; company membership and role capabilities are queried live from Baseer. No owner/super-admin bypass. |
| Completion definition | A dedicated Baseer database demonstrates RLS and tenant/company isolation, session revocation, refresh replay handling, audit rollback, idempotency replay/mismatch, and concurrent serial allocation. |

## Gate B — implementation evidence

- Prisma models and unapplied Baseer-only migration define composite tenant
  foreign keys, FORCE RLS, `AuditEvent`, `IdempotencyReceipt`, and
  `DocumentSerialCounter`.
- `POST /v1/auth/sign-in`, `/refresh`, and `/sign-out` use strict contracts,
  bcrypt-compatible password verification, token type separation, hashed
  refresh tokens, rotation, and token-safe audit events.
- `CompanyContextService` verifies a live user, session, company membership,
  active company, and exact role permissions in the tenant transaction.
- `IdempotencyService` and `DocumentSerialService` provide transaction-aware,
  parameterized primitives for later domain commands.
- Prisma validation/generation, contracts/API type checks and builds, and an
  API smoke test of health and safe invalid-auth receipt have passed.

## Gate B historical blockers (resolved)

1. **Current foundation slice database evidence:** complete. The dedicated
   disposable Baseer database was migrated and the executable Gate B matrix
   passed using a non-superuser, non-bypass-RLS application role.
2. **Bootstrap policy:** owner must approve the first test tenant code,
   company, initial user, role/capability set, and secure credential delivery
   method. No production credentials, Noorix users, or online data may be
   used for this proof.
3. **Core boundaries still pending:** file metadata,
   observability/metrics, and Output Platform binding need their own approved
   vertical slices before the entire platform foundation can pass Gate C.

## Gate B preflight — 2026-08-15

- Baseer has no local `DATABASE_URL` configuration and no Docker/Compose definition in its workspace.
- The reserved Baseer port `127.0.0.1:5433` is not listening.
- Another PostgreSQL listener exists on `127.0.0.1:5432`, but it is not identified as Baseer; it was not accessed.
- Docker and the PostgreSQL CLI are not available in the current shell.

**Historical result:** this preflight was later resolved with owner approval; the isolated BASEER Docker test database was created and verified.
## Gate B test result — 2026-08-15 (current foundation slice passed)

- The first RLS integration assertion correctly exposed a misconfigured test role: a `baseer_app` PostgreSQL superuser bypasses RLS, even with `FORCE ROW LEVEL SECURITY`.
- With owner approval, the disposable test volume was discarded and recreated. `postgres` is now bootstrap/migrator only; `baseer_app` is `NOSUPERUSER NOBYPASSRLS` and has data DML privileges only.
- The Baseer application and Gate B verification run exclusively as the restricted `baseer_app` role. An unscoped `User` query returns zero rows; a different tenant cannot read the fixture user.
- The complete executable matrix passed: RLS isolation; sign-in; safe failed-sign-in receipt; live company capability check; refresh rotation and replay revocation; sign-out; audit rollback; idempotency start/in-progress/replay/mismatch; and twenty concurrent, gapless serial reservations.
- No Baseer production database, Noorix database, or real data was accessed. All records are synthetic fixtures in disposable `baseer_erp_test`.

**Evidence command:** `node scripts/run-gate-b-db-verification.mjs` with the local-only `apps/api/.env.baseer-test` configuration.
## Gate B regression — refresh rotation (resolved)

- The expanded Gate B matrix reproduced a refresh-replay failure: a second refresh request made in the same second returned `200` instead of being rejected.
- Root cause: the HMAC JWT contained only stable session claims plus second-level `exp`; issuing twice within one second produced an identical refresh token and identical stored hash.
- Owner-approved correction: a random UUID `jti` is now issued and strictly verified for every access and refresh JWT. It carries no permissions or business data.
- The complete Gate B matrix was rerun after the correction and passed, including immediate refresh replay rejection, RLS isolation, Output Platform scope/permission/replay tests, audit events, idempotency, and serial concurrency.
- No Noorix system, production database, or real data was involved. This was a Baseer test-only regression.
## Historical owner decision (resolved)

Approve or decline each item:

1. Provision a new disposable PostgreSQL database exclusively for Baseer
   verification.
2. Apply the existing additive Baseer migration only to that database.
3. Seed a minimal synthetic test fixture only; do not import Noorix data.
4. Execute the Gate B integration matrix and return its evidence to the
   committee before any move to Gate C or Finance.

## Decision log

| Date | Decision | Owner approval | Evidence |
| --- | --- | --- | --- |
| 2026-08-15 | Provision a disposable Baseer-only test database and run Gate B evidence. | Approved and completed | `scripts/run-gate-b-db-verification.mjs` |
| 2026-08-15 | Correct the test database role that bypassed RLS; recreate synthetic volume and rerun Gate B. | Approved and completed | Restricted `baseer_app`; Gate B matrix passed |

## Gate B evidence — Business Date (passed)

- The owner-approved `Asia/Riyadh` Business Date kernel resolves server-owned current/date/month/range intents without fiscal close or historical-date blocking.
- The current API requires live company authorization and `platform.business-date.read`; strict contracts reject invalid dates and reversed ranges.
- The complete disposable-database Gate B matrix passed Riyadh-midnight, leap-month, invalid/cross-company/revoked-session cases alongside all identity, output, audit, idempotency, and serial controls.
## Current verified status

The restricted aseer_app role and the isolated BASEER Docker test database are verified by scripts/run-gate-b-db-verification.mjs. Finance Phase 1 then added and verified its authorized command boundary. The authoritative current status is docs/governance/MODULE_DELIVERY_REGISTER.md and docs/governance/FINANCE_PHASE_1_CLOSURE_RECORD_2026-08-15.md. No Noorix or production data was accessed.
