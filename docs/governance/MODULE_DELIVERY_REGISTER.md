# BASEER ERP Module Delivery Register

Last updated: 2026-08-15
Control protocol: `DELIVERY_CONTROL_PROTOCOL.md`

## Current focus

| Field | Value |
| --- | --- |
| Active scope | Daily Sales Closing backend — official sales source for later Marketing analysis |
| Stage | Finance Phase 1 backend is verified. Daily Sales Closing source design/build is next. |
| Deferred scope | Marketing Performance & Google Hub waits for the official sales source; Finance Phase 2 UI waits as a separate native UI scope. |
| Next decision gate | Daily Sales Closing database, authorization, journal, data-state and read-receipt gate before Marketing Gate A. |

## Portfolio state

| Scope | State | Evidence / boundary |
| --- | --- | --- |
| Platform foundation | Verified | Identity, trusted company context, RBAC, audit, idempotency, serials, business date, files, output and observability are verified. |
| Finance | Phase 1 verified — operational sources pending | Journal, periods, company setup, vaults, supplier dues, recurring profiles and inclusive loans are implemented. Paid expense documents, daily sales closing, transfers, cash count, reports and UI are not yet built. |
| Daily Sales Closing | Active build | Required official source for operating-day analytics and for any later sales/marketing relationship. It is not POS. |
| Marketing Performance & Google Hub | Approved design — backend not started | Scope is bounded by `docs/marketing/MARKETING_PERFORMANCE_AND_GOOGLE_HUB_SCOPE_DECISION_2026-08-15.md`. No models, API, OAuth, sync, UI or external call exists yet. |
| AI Platform | Foundation only | Tenant-wide provider configuration, central system identity and company context identity are implemented. There is no provider call, chat, memory, read tool or AI UI. |
| Reports and Command Center | Not started | Begin after official source operations and central filter contract exist. |
| Migration and cutover | Discovery | No Noorix import or cutover before source maps, staging rehearsal and reconciliation gates. |
| All other modules | Not started | Kept out of scope while the active vertical slice is incomplete. |

## Delivery evidence

- `scripts/run-gate-b-db-verification.mjs` — platform isolation and Finance HTTP boundary checks.
- `scripts/run-finance-gate-b-db-verification.mjs` — Finance migration, RLS, journal, audit, idempotency and data-integrity checks.
- `scripts/run-finance-period-race-verification.mjs` — close-versus-post locking verification.
- `docs/governance/FINANCE_PHASE_1_CLOSURE_RECORD_2026-08-15.md` — Finance Phase 1 closure evidence.
- `docs/governance/AI_PLATFORM_FOUNDATION_GATE_A_DELIVERY_2026-08-15.md` — AI configuration foundation boundary.
- `docs/foundation/BASEER_BUILD_SEQUENCE_COMMITTEE_PLAN_2026-08-15.md` — mandatory active build order.

## Control rule

Exactly one business scope may be in active build or verification. A phase changes only when its stated closure evidence is recorded. No browser calculation, direct database write, manual journal route, live Noorix migration, production deployment, external marketing action or AI side effect is allowed outside the approved plan.