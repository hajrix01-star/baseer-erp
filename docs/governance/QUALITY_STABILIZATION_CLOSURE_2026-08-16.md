# Quality stabilization closure — 2026-08-16

## Scope closed in this change

- Fresh PostgreSQL migrations now match the Prisma model for the optional vault reference on inclusive-loan installment plans. The relation is enforced with the same tenant and company as the vault.
- A cash handover in Daily Sales is explicitly a management observation. It is not a vault movement and it does not create or alter a journal entry.
- Cash-handover totals and counts are calculated by database aggregation. The returned list is bounded for performance and includes `hasMore` when it is truncated.
- Daily Sales database and HTTP verification scripts were repaired to reflect the current command dependencies, `APP` vault type, global sign-in flow, separated cashier capabilities, and management-only cash handover.
- GitHub Actions now provisions PostgreSQL, runs migrations from an empty database, and executes the Daily Sales database and HTTP verification gates on every change.
- The shared web release budget and financial-boundary checker were aligned to the implemented design system. The CSS budget is 52 KB raw and 10 KB compressed; current production CSS is below both limits.

## Migration operating rule

Migrations run through a dedicated database owner/migrator identity. The application role must remain non-owner and uses only the grants required at runtime. The local test database was reconciled only to validate this migration chain; no production database was changed by this closure.

## Evidence required before release

A release is accepted only when CI is green, including: generated Prisma client check, fresh migration deployment, contracts/API/web builds, architecture/permission/AI checks, Daily Sales database+HTTP gates, web budget, and production dependency audit.

## Deliberately still outside this closure

This work does not enable a live AI provider, external Google/Gmail/Telegram connections, file upload/scanning, backups, or public production launch. Those retain their separate approval and operational gates.
