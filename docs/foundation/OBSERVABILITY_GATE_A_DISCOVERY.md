# Observability and diagnostics â€” Gate A discovery and decision record

**Status:** Gate B implementation and integration evidence complete — Gate C remains blocked by the owner-led production-operations evidence gate.
**Capability:** Safe operational observability for the Baseer ERP platform foundation.  
**In scope:** request correlation, structured server logs, bounded in-process request metrics, liveness/readiness receipts, a permission-gated operational summary, redaction policy, and a runbook boundary.  
**Out of scope:** external telemetry/SIEM vendor integration, log shipping, alert delivery, traces across external services, customer analytics, user activity surveillance, financial/business dashboards, backup/restore implementation, and Noorix runtime dependency.

## Gate A evidence

| Question | Evidence and proposed decision |
| --- | --- |
| Governing Baseer contract | The Technical Contracts and Quality Standard requires a correlation ID across API, logs, audit, and asynchronous work; metrics for critical commands/read models must cover success, failure, latency, and reconciliation health. The Engineering Standard requires structured logs, correlation IDs, metrics, alerts, backups/restore drills, and incident runbooks in production. |
| Existing Baseer state | `GET /v1/health` is a minimal liveness receipt. Error receipts generate or preserve a safe correlation ID, but successful requests, audit events, and bootstrap logging are not yet consistently bound to one request context. Fastify logging is disabled. |
| Noorix evidence | Noorix has process/bootstrap and exception logging, plus a diagnostic UI that presents safe health receipts. Its exception logger can include raw error messages/stacks and an AI service can log upstream response text. These are useful evidence but must not be reused as a Baseer runtime pattern because they risk sensitive operational data disclosure. |
| Source of truth | Baseer process runtime is the source for request timing/outcome metrics and structured events. AuditEvent remains the business security/history source; observability must reference audit correlation IDs but must never replace audit or infer business facts from logs. |
| Correlation contract | On every HTTP request, Baseer accepts a syntactically safe `X-Request-Id` or creates UUIDv4; it returns the same ID in `X-Request-Id`, attaches it to all structured request/error events, and passes it to audit-producing commands through one request context. It never trusts header values as identity or permission. |
| Logs | Emit newline-delimited structured JSON to stdout/stderr only: timestamp, level, event name, correlation ID, method, route template, status class/code, elapsed milliseconds, and safe error category. Never log authorization, cookies, request/response bodies, passwords, tokens, idempotency keys, SQL, storage references, personal data, files, secrets, or raw exception stacks. |
| Metrics | Maintain bounded in-process counters/histograms keyed only by normalized route and method: request totals by outcome/status class and latency buckets. Exclude request IDs, user IDs, tenant/company IDs, route parameters, query values, error text, and arbitrary labels to prevent cardinality and privacy failures. Metrics reset on process restart and are not financial or reconciliation metrics. |
| Health and diagnostics | Keep unauthenticated `GET /v1/health` as a minimal liveness receipt. Add unauthenticated `GET /v1/health/ready` with a safe dependency-ready/not-ready receipt and no database details. A narrowed operational summary requires live `platform.observability.read`; it exposes only aggregate process metrics and current readiness, never logs or configuration. |
| Production gap | External collection, retained searchable logs, alert routing, on-call ownership, retention, SLO/error-budget thresholds, backup/restore drills, and incident runbooks are mandatory before Gate C/production acceptance but require explicit operational ownership and cannot be silently selected by code. |
| Completion definition | A request is correlated end-to-end in safe receipts/logs/audit; logs and metrics contain no sensitive values; readiness is safely observable; denied/cross-company/stale users cannot read diagnostics; route-label cardinality is bounded; tests prove redaction and correlation behavior. |

## Preserve / Harden / Correct / Defer

| Area | Decision | Rationale |
| --- | --- | --- |
| Minimal health receipt | Preserve and harden | Retain an unauthenticated liveness check; add separate generic readiness without database/schema/configuration details. |
| Noorix safe diagnostic receipt | Preserve | A narrow safe health/diagnostic receipt is appropriate; it must not expose upstream text, configuration, secrets, or raw error detail. |
| Noorix raw error/stack/upstream logging | Correct | Replace string interpolation and raw stacks/responses with allowlisted structured event fields and safe error categories. |
| Correlation ID in error response only | Correct | Bind a single correlation ID to success, error, audit, log, and later async work through centralized request context. |
| Metrics labels | Harden | Use normalized route/method/status/latency only; forbid unbounded or sensitive labels. |
| External observability vendor | Defer | No vendor, credential, collection endpoint, retention contract, or external data flow is selected in this slice. |
| Alerts, SLOs, retention, runbook | Defer | They require product/operations ownership and are Gate C/production prerequisites, not assumptions that code may invent. |

## Required owner decisions

1. Approve the first slice as **structured JSON stdout/stderr logs plus bounded in-process metrics only**, with no external telemetry, log shipping, or vendor dependency (recommended).
2. Approve `platform.observability.read` for the narrowed aggregate operational-summary endpoint; public health endpoints remain aggregate-only and cannot reveal diagnostics, configuration, tenants, users, or logs (recommended).
3. Approve the redaction rule: no bodies, headers, credentials, tokens, idempotency keys, SQL, storage references, personal data, raw exceptions, or external response text in observability data (recommended).
4. Approve the correlation contract: honor only syntax-safe `X-Request-Id` or generate UUIDv4, return it on every response, and use it for logs, errors, audit, and future asynchronous work (recommended).
5. Approve that production log retention/aggregation, alerts/on-call, SLO/error budgets, backup/restore drills, and incident runbook remain a separate owner-led Gate A before Gate C/production acceptance (recommended).

## Gate B plan after approval

1. Add a request-context boundary that owns the correlation ID and makes no identity/authorization decision.
2. Add a safe structured logger with a fixed allowlist and redaction tests; configure no secret-bearing logger options.
3. Add a bounded metrics registry/interceptor that records normalized route/method/status/latency only.
4. Separate liveness from generic readiness and add a live-company-authorized aggregate operational summary endpoint.
5. Pass the request correlation ID into audit-producing Baseer commands; do not rewrite historical audit events or infer missing legacy information.
6. Verify valid/generated correlation IDs, response propagation, safe error receipts, redaction, fixed metric cardinality, readiness failure behavior, denied/cross-company/revoked diagnostics access, audit correlation, and all existing RLS/core regressions.

## Approval state

- Product owner: approved decisions 1–5 on 2026-08-15.
- Architect/security/QA: Gate B evidence recorded below; external telemetry and raw diagnostic disclosure remain intentionally out of scope.
- Operations/migration reviewer: must own the deferred production collection, retention, alerts, SLOs, backup/restore drill, and incident runbook decisions before Gate C.
- Independent monitor: Finance remains blocked; no Noorix runtime, external telemetry, customer analytics, or secret transfer is introduced.

## Gate B implementation evidence

- `RequestContext` accepts only a syntactically safe `X-Request-Id` or creates UUIDv4; the global interceptor returns it on every response and makes it available to controller/service work without storing identity, company, credentials, or bodies.
- Safe error receipts now use the same context correlation ID. Existing identity, Output, and File Metadata audit events use it when triggered by HTTP, retaining a UUID fallback only for non-request work.
- Process events are newline-delimited JSON to stdout/stderr with an allowlisted schema only: timestamp, level, event, correlation ID, method, normalized route, status, and elapsed milliseconds. There is no raw exception, stack, body, header, token, SQL, idempotency key, file reference, user, tenant, or company field.
- Metrics are bounded to 256 normalized method/route/status-class series with fixed latency buckets. They use no route parameters, query values, request IDs, company/tenant/user IDs, or arbitrary labels and reset on process restart.
- `GET /v1/health` remains minimal liveness. `GET /v1/health/ready` safely checks the Baseer database and returns only `ready` or `not_ready`. `GET /v1/observability/summary` exposes aggregate in-process metrics only after live `platform.observability.read` company authorization.
- `scripts/run-gate-b-db-verification.mjs` passed liveness/readiness, accepted/generated request IDs, error/header propagation, audit correlation, redaction from the summary, bounded metric response, denied/cross-company/revoked-session diagnostics access, plus all prior RLS, identity, output, file, audit, idempotency, and serial regressions against the disposable Baseer database.
