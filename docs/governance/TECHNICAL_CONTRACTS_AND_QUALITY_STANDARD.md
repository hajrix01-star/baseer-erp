# Technical Contracts, File Boundaries, and Quality Standard

**Status:** Mandatory engineering standard  
**Applies to:** Platform core and every Baseer ERP module.

## 1. Purpose

This document turns architecture into enforceable day-to-day coding rules. It prevents oversized files, hidden API behavior, browser-owned business logic, loose types, duplicated adapters, unbounded uploads, and module coupling.

## 2. Repository and module boundaries

Baseer ERP is a modular monolith. The intended boundary is:

```text
apps/
  api/                 # HTTP/API composition only
  web/                 # React application and presentation
packages/
  core/                # shared platform kernel contracts and primitives
  contracts/           # versioned public API schemas/types only
  modules/
    <module>/          # domain commands, reads, persistence, UI adapter, tests
```

Rules:

- A module may use another module only through its published contract/facade; it may not query another module's private tables or import its internal services.
- Core is intentionally small. It owns cross-cutting primitives only; it must not become a dumping ground for unrelated utilities.
- Frontend code never imports backend internals, ORM types, database models, or server services.
- Each module owns a clear public API, route namespace, permission set, migration surface, and test suite.
- Circular dependencies between modules are prohibited.

## 3. File and component size rules

File size is a warning about mixed responsibility, not a reason to split coherent code mechanically.

| Artifact | Normal target | Mandatory review point |
| --- | ---: | ---: |
| Pure utility, schema, DTO, mapper | 50–200 lines | More than 250 lines |
| Backend command/read service | 100–300 lines | More than 400 lines |
| React screen/container | 100–250 lines | More than 350 lines |
| Reusable React component | 40–180 lines | More than 250 lines |
| Test file | 80–350 lines | More than 500 lines |
| Migration | One focused concern | Multiple unrelated concerns |

At a review point, the author must either split by responsibility or document why the artifact remains coherent. Files above 600 lines require an explicit architecture exception. A large file may never contain unrelated module behavior simply to avoid creating a new file.

## 4. API contract first

Every API capability has a versioned, typed contract before UI work begins.

### Input contract

- Server schemas strictly allowlist fields; unknown fields are rejected.
- IDs, company scope, actor identity, permissions, and sensitive context are derived/verified by the server, not trusted from the body.
- Each write command declares validation, confirmation phrase where needed, idempotency-key requirement, canonical request-hash behavior, and replay/conflict receipt.
- Dates use business-date intent, not browser-generated date boundaries.

### Authentication identifiers

- A user may sign in with either a full email address or a short username. Only the server resolves a short username, using the authenticated tenant code, to a deterministic tenant-local email-shaped identity.
- The browser never constructs, stores, or treats the resolved address as authority. Rate-limit keys use the resolved identifier so email and short-form attempts cannot bypass the same limit.
- A short username is lowercase ASCII (`a-z`, `0-9`, `.`, `_`, `-`), 3–64 characters, unique per tenant, and is only a convenience presentation. The stored identity remains the normalized email-shaped value.

### Output contract

- Responses are narrow, intentional projections. Never return raw ORM/database objects.
- Financial reads include currency, period, basis (`gross`, `net`, `tax`, `movement`, or `asOf`), source, and generated time where relevant.
- Error receipts have stable machine codes, safe bilingual user messages, correlation ID, and appropriate retry guidance; stack traces and private data never leave the server.
- Contracts are backward compatible within a released version. Breaking changes require a new version or approved migration path.

## 5. Web adapters and the no-business-logic rule

The adapter may read only the module’s published server projection. Any financial display must be a journal-reconciled read model; operational/provider facts must carry provenance, freshness and quality in accordance with `FINANCIAL_AND_FACTUAL_SOURCE_OF_TRUTH_POLICY_2026-08-15.md`.

Each module has a typed web adapter that is the only client code allowed to call its HTTP endpoints.

```text
Screen -> module hook/state -> typed adapter -> API contract -> backend
```

Rules:

- Screens/components do not call `fetch`, assemble URLs, parse raw JSON, or know endpoint details.
- Adapters validate and rebuild safe response objects; they do not pass raw objects through.
- Query keys always include company scope and relevant server filter intent.
- On company switch, module query and mutation state is reset or invalidated before old data can render.
- The client may format values for display only. It may not compute totals, VAT, balances, ratios, dates, timelines, eligibility, serials, or authority.
- A UI action receives a server receipt and renders it; it does not infer a successful accounting result locally.

## 6. Data, migration, and transaction rules

- Database schema changes are reviewed migrations, not runtime schema mutations.
- Migrations are one concern each, additive by default, indexed, preflighted, and verified. Destructive changes require an approved staged migration and recovery plan.
- Commands that change business state execute in a transaction with audit and idempotency behavior in the same authoritative boundary.
- Posted financial history is cancelled/reversed, not deleted.
- Numeric persistence uses Decimal/fixed precision; money does not use binary floating point.
- Every data import has a strict format, size limit, MIME/content validation, dry-run/preflight, row-level rejection report, idempotency, audit, and rollback/recovery policy.

## 7. File storage, uploads, and attachments

File handling is central; modules store file metadata and authorized references, not public file paths.

- Default attachment limit: **10 MiB per file**.
- Default structured-import limit: **25 MiB per upload**, subject to row-count and streaming limits.
- A module may use a different limit only through an approved contract with a business reason, server-side resource analysis, and test coverage.
- The server verifies MIME type, file signature/magic bytes where feasible, size, extension policy, malware-scanning integration point, and storage success before creating an attachment record.
- Filenames are treated as untrusted metadata; storage keys are generated server-side.
- Download/preview authorization is rechecked server-side for every request. No permanent public URL, filesystem path, or cross-company blob reference is returned to the UI.
- Imports and attachments are company-scoped, auditable, virus-scan-ready, and cleaned up safely if their command fails.

## 8. Errors, retries, and user feedback

- Server error taxonomy distinguishes validation, denied permission, not found, conflict, idempotency mismatch, unavailable dependency, and internal failure.
- Every write UI has pending, success, failure, retry, and stale-company behavior.
- Retry reuses the exact idempotency key for the same user intent; changed input creates a new intent/key.
- Destructive or globally impactful actions require explicit confirmation and, where defined, a literal confirmation phrase.
- Errors shown to the user are clear and bilingual; diagnostic data is logged with correlation ID rather than exposed.

## 9. Testing requirements

| Layer | Required proof |
| --- | --- |
| Unit | Pure rules, dates, Decimal calculations, mappers, and policy edges |
| Contract | DTO allowlists, response projections, error codes, version behavior |
| Integration | Transaction rollback, audit, idempotency replay/mismatch, RLS/tenant/company isolation, concurrency |
| UI | Permission/no-company/stale scope, adapter parsing, loading/empty/error/retry, RTL/LTR |
| End-to-end | The complete native user job without a legacy handoff |
| Reconciliation | Noorix fixture parity for data, serial, cancellation, VAT, ledger, vault, and report result when relevant |
| Accessibility | Keyboard, focus, labels, contrast, target sizes, Arabic and English layouts |

No test may hide type errors using `any`, `as any`, or `as never`.

## 10. Dependency, configuration, and secret policy

- A dependency is added only with owner, license/security review, version pinning policy, and a reason it cannot be solved with the current platform.
- Secrets never appear in source, commits, browser bundles, logs, fixtures, screenshots, or local storage.
- Configuration is typed, validated at startup, environment-scoped, and documented. Missing critical configuration fails closed.
- Build artifacts are reproducible and dependency vulnerability checks run in CI.

## 11. Performance and observability

- Each native workspace declares its **request budget** in its discovery/acceptance record. A normal initial load must use one bounded workspace read-model request, plus only truly global session/context reads shared by the shell. A screen must not fan out into repeated HTTP reads for its own cards, filters, permissions, and summary.
- A write receipt either contains the refreshed projection needed by the current screen or names the one bounded refresh request that follows. Reloading a page through many unrelated reads after every save is prohibited.
- Server-owned preview is allowed only for authoritative validation/calculation. It must be debounced, cancel stale in-flight work where practical, and never be used to calculate money in the browser.
- Every module completion review records: initial-load request count, post-write request count, preview behavior, largest response size, and evidence that no duplicate company/session/context request is made by sibling components.
- Performance budgets are established per critical route before release: server latency, query count, payload size, client load, and error rate.
- List endpoints paginate and filter server-side; they do not return unbounded tables for browser filtering.
- Large imports/exports run as observable jobs with status, cancellation/recovery policy, audit, and user-safe receipts.
- Every request carries a correlation ID across API, logs, audit, and asynchronous work.
- Critical commands and read models emit metrics sufficient to monitor success, failure, latency, and reconciliation health.

## 12. Pull-request and release checklist

No change is ready for review until it answers:

1. Which active scope and gate does it belong to?
2. Which contract, policy, and Noorix workflow does it implement?
3. Does it introduce UI business logic, a broad response, raw query, or duplicate source of truth?
4. What security, company-scope, transaction, idempotency, and audit proof exists?
5. What tests prove normal, failed, retry, and unauthorized behavior?
6. Are Arabic/English, desktop/mobile, accessibility, and error states covered?
7. Does it change schema, migration, external API, files, serials, dates, VAT, or migration mapping?
8. What is the rollback/recovery behavior?

