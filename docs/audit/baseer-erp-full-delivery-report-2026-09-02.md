# Baseer ERP — Full Delivery Readiness Audit

**Audit date:** 2026-09-02
**Candidate revision:** `62994c682baeda84b6fab999e85144a62f09a462`
**Decision:** **NO-GO for a full production launch**

## Scope and method

This is a fresh, read-only review of the complete Baseer ERP repository: web, API, identity and tenant isolation, HR/attendance, finance, operations, delivery configuration, migrations, backup/recovery, CI, and documented release authority. No production system, production database, migration, or external integration was changed or exercised.

Independent review tracks covered application quality/map, security and integration boundaries, and operations/data readiness. The system map is available in `baseer-erp-full-audit-architecture-2026-09-02.html`; its specification and visual checks passed.

## Release blockers

| ID | Severity | Evidence | Impact | Required closure |
| --- | --- | --- | --- | --- |
| `SEC-OPS-001` | **P0** | `docker/baseer-private-init/10-create-baseer-app.sh:19-20` grants the production app role only database `CONNECT` and schema `USAGE`. The disposable test initializer explicitly grants table/sequence/default privileges at `docker/baseer-erp-test-init/10-create-baseer-app.sh:22-26`. The production compose uses this app user at `docker-compose.private-online.yml:71`. | A clean production database whose tables are owned by `postgres` can deny the API access to identity, company, finance, HR, and other Prisma tables on first real use. RLS does not replace table privileges. | Add a reviewed bootstrap and upgrade path for the actual `BASEER_DB_APP_USER`: least-privilege DML on existing tables/sequences, default privileges for subsequent migrations, no application `CREATE`, then prove readiness, sign-in, tenant context, and representative writes against a clean private-online deployment under `NOBYPASSRLS`. |

## High-priority release gates

| ID | Severity | Evidence | Impact | Required closure |
| --- | --- | --- | --- | --- |
| `OPS-REC-002` | P1 | `docs/backup-recovery/BACKUP_COMPANY_ARCHIVE_EXPORTER_GATE_2A_2026-08-26.md:37-42` records missing import/restore/rehearsal evidence. `docs/backup-recovery/BACKUP_SCHEDULE_RETENTION_GATE_4_2026-08-27.md:26-28` says retention deletion is deliberately unimplemented. | No proven production recovery or retention path for the full ERP data and file store. | Confirm host backup scope and retention, create an encrypted off-host copy, and document one isolated restore/reconciliation rehearsal using the release candidate. |
| `OPS-OBS-003` | P1 | `docker-compose.private-online.yml:130-132` supplies local readiness only; `docs/operations/PRODUCTION_BASELINE.md:45` defers external alerting; runtime metrics are process-memory based. | An outage, 5xx spike, or resource exhaustion may not reach the owner reliably and operational metrics disappear on restart. | Add an owner-receivable external HTTPS/readiness alert plus retained logs/metrics appropriate to the chosen host, then prove it fires. |
| `OPS-CI-004` | P1 | `.github/workflows/verify.yml:81-102` does not run the available attendance HTTP journey or RLS/backup gate checks. `package.json:88` defines `verify:attendance-http`. | Regressions in the newly delivered attendance journey, isolation, or recovery gates can merge without CI evidence. | Add the relevant deterministic checks and a clean private-online smoke using the restricted application role to CI/release acceptance. |
| `Q-01` | P1 | `npm run check:library-migration-inventory` fails at this revision. It reports direct ECharts imports at `apps/web/src/monthly-application-sales-share-chart.tsx:1-4`, 100+ unclassified migration targets, and stale manifest targets. The guard implementation is `scripts/check-library-migration-inventory.mjs:49-87`. | The repository cannot currently substantiate its library-migration / UI-standardization completion claim. The guard is not in CI. | Rebuild and approve the manifest, classify each target, move the ECharts use behind the approved chart abstraction or add a documented exception, add the guard to CI, and rerun it green. |
| `GOV-005` | P1 | `docs/governance/CURRENT_DELIVERY_AUTHORITY.md:247-252` explicitly blocks production release pending backup/restore, Noorix staging import/reconciliation/cutover, volume/query-plan evidence, and scope-specific owner acceptance. | The repository's own accepted authority does not grant a general production launch. | Close or explicitly re-authorize each listed gate with owner evidence. |

## Important, non-blocking findings

| ID | Severity | Evidence | Impact | Recommended next step |
| --- | --- | --- | --- | --- |
| `CAP-006` | P2 | `apps/api/src/attendance/attendance.service.ts:895-901` has bounded transactions and batch support, but `docker-compose.private-online.yml` has no CPU/RAM limits or recorded production load evidence. | The design supports the stated small attendance burst, but capacity for the actual host and all ERP areas is unproven. | Acceptance-test 30 employees/company and 12 simultaneous registrations; capture p95 latency, database waits, CPU, and memory. |
| `MAINT-007` | P2 | Large concentrated modules include web treasury (~1869 lines), finance setup (~1698), purchase/expense (~1564), and API decision (~1318), AI (~1261), payroll (~1196), attendance (~1150). | Future changes have a higher regression and review cost. | Incrementally split data hooks, actions, and view components with behavior-preserving tests. |

## Controls and checks that passed

- `npm run check:architecture` — pass.
- `npm run check:permissions` — pass; 137 capabilities verified.
- `npm run check:authorization-consistency` — pass.
- Independent checks passed for authorization/RLS coverage in HR, finance, administration, reports, decision, and command-center areas; controller registration found 54 registered controllers.
- Tenant controls are present: forced RLS policies, application role `NOBYPASSRLS`, and transaction-local tenant context.
- Identity controls are present: JWT HMAC, refresh-token rotation/revocation, and throttling.
- Edge and file controls are present: constrained CORS, Caddy security headers, AES-GCM HR file storage, MIME verification, quarantine/scanning flow, and Gmail OAuth state/PKCE.
- The database remains private in the documented compose topology; runtime file writes are restricted to documented mounts.

## Evidence limitations

- No production deployment or live production smoke was available or authorized for this audit.
- HTTP/E2E/database journeys that write fixtures were not rerun in this read-only full audit. Earlier candidate-only attendance evidence does not constitute complete ERP production evidence.
- Prisma advisory lookup could not complete because external network access was blocked; it is neither a clean advisory result nor a vulnerability finding.
- Current CI run status was not queried from GitHub; only the checked-in workflow was assessed.

## Exit criteria for a new decision

1. Resolve and prove `SEC-OPS-001` on a fresh private-online database using the real restricted app account.
2. Close backup/restore, monitoring, CI, library-inventory, Noorix, and volume/query-plan gates with artifacts.
3. Re-run the full delivery audit on the resulting immutable candidate and obtain explicit owner acceptance for the intended scopes.
