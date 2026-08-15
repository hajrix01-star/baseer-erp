# AI Platform Foundation — Gate A Delivery Record

Date: 2026-08-15
Status: Backend foundation accepted locally; no external AI provider or UI enabled.

## Delivered

- Tenant/system-scoped provider configuration with one active default configuration and encrypted server-only credential envelope; company identity and execution context remain isolated.
- Versioned company AI identity with one active version, bilingual identity fields, tone/safety policy and immutable historical versions.
- Append-only-ready execution receipt model that records only provider/model/version, safe status, character counts and correlation metadata; it stores no prompt, output or secret.
- RLS/FORCE RLS, compound tenant/company foreign keys, active-default uniqueness and configuration/identity constraints.
- Authorized Administration API:
  - `GET /v1/administration/ai/configuration`
  - `POST /v1/administration/ai/provider-configurations`
  - `POST /v1/administration/ai/identities`
- CompanyContext, idempotency, advisory serialization and AuditEvent on all configuration writes.
- AES-256-GCM credential envelope guarded by `AI_CREDENTIAL_ENCRYPTION_KEY`; configuration fails closed when the encryption key is absent or invalid.

## Explicitly not delivered

No provider network adapter, browser credential, automatic AI action, Google reply publish, Marketing sync, finance posting, prompt/output retention or Administration UI exists in this increment.

## Verification evidence

- Prisma validate and client generation passed.
- Migrations `20260815223000_ai_platform_foundation` and `20260815224000_ai_provider_tenant_scope` was applied to Docker database `baseer_erp_test` only. The first Prisma attempt correctly failed because `baseer_app` has no schema-creation privilege; the migration was applied by the Docker PostgreSQL test administrator, then recorded in Prisma. Application grants remained unchanged.
- Prisma migration status: up to date.
- New tables have RLS and FORCE RLS enabled; application table grants match existing finance table grants.
- Contracts build, API TypeScript check, API build and architecture check passed.
- In-memory credential-envelope smoke test passed without a real provider key or any network call.

## Remaining Gate A work

1. Add API/DB integration tests for authorization, cross-company denial, idempotency replay/mismatch, concurrent activation and audit rollback.
2. Add the AI Gateway adapter registry and deterministic no-provider/disabled/limit receipts. Keep adapters offline until each provider decision record passes.
3. Add the Marketing facts/connection foundation using the approved metric catalog. UI remains blocked until those backend gates pass.