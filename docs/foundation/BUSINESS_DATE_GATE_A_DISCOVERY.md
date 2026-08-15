# Business Date kernel — Gate A discovery and decision record

**Status:** Gate B implementation and integration evidence complete — Gate C remains blocked by other foundation slices  
**Capability:** Central Baseer Business Date and period-intent resolution.  
**In scope:** server-owned current business date, strict `YYYY-MM-DD` parsing,
month/range resolution, `Asia/Riyadh` conversion, explicit date receipts, and
testable clock injection.  
**Out of scope:** financial posting, VAT calculation, fiscal-period setup,
period closing/locking, Hijri conversion, public holiday calendars, and UI
date-picker implementation.

## Gate A evidence

| Question | Evidence and proposed decision |
| --- | --- |
| User outcome | A user sees and submits an unambiguous Saudi business date or period intent; Baseer resolves it consistently for every later command and report. |
| Noorix equivalent | Noorix has `nowSaudi`, `toYmd`, sales-range helpers, dashboard period query helpers, and `FiscalPeriodService`. The latter can close/lock a period, while other helpers sometimes use UTC `toISOString()` or local `Date` constructors. |
| Source of truth | Baseer server clock plus the live company `businessTimezone`; for this first slice only `Asia/Riyadh` is accepted. The browser supplies only a strict date or intent, never boundaries or derived current date. |
| Date meanings | `businessDate` is a SQL/calendar `DATE`; `issuedAt` is an immutable event `TIMESTAMPTZ`; creation/update/cancellation/audit times are technical instants. No conversion may merge these meanings. |
| Month semantics | `month=YYYY-MM` is the full Gregorian civil month in the company Saudi timezone, from day 1 through its last day. Period movement starts at zero; a cumulative value is a separate explicit `asOf` request. |
| Historical work | A valid prior `businessDate` is allowed by the kernel. Authorization for amendment/cancellation belongs to the command policy; the kernel must not introduce a fiscal close or automatic historical block. |
| Company scope | `CompanyContextService` verifies the live company before resolving its date. Proposed read capability: `platform.business-date.read`. No company identifier is accepted in a request body. |
| Migration impact | No Noorix data or fiscal-period status migrates in this slice. Future migrated document dates map as literal `DATE` values; legacy timestamp ambiguity requires a dedicated migration/reconciliation record. |
| Completion definition | A verified company receives a Riyadh current-date receipt; strict dates/months/ranges resolve on the server; invalid/leap/date-order cases fail safely; Riyadh midnight boundaries are deterministic under a test clock; no closure behavior exists. |

## Preserve / Harden / Correct / Defer

| Area | Decision | Rationale |
| --- | --- | --- |
| `Asia/Riyadh` as date authority | Preserve and harden | Use the IANA zone centrally, not scattered `+03:00` or browser-local calculations. |
| Business date distinct from technical instants | Preserve and harden | Represent business date as strict `YYYY-MM-DD`/SQL `DATE`; never derive it by slicing arbitrary timestamp input. |
| Month and period semantics | Preserve | Resolve full Saudi/Gregorian civil months server-side; distinguish movement from balance-as-of. |
| Noorix UTC/local helper mix | Correct | Replace local `Date` constructors and UTC slicing for business-date boundaries with one central, clock-injectable kernel. |
| Fiscal period close/lock | Correct | Do not carry forward automatic close/lock behavior. The approved Baseer policy permits historical amendment/cancellation with authorization and audit. |
| Company timezone changes | Defer | Current kernel accepts only `Asia/Riyadh`; a future non-Riyadh company policy requires its own ADR, migration effect, and test matrix. |
| Hijri/calendar/holidays | Defer | They are not required to resolve the approved Gregorian business date and period intent. |

## Required owner decisions

1. Approve `Asia/Riyadh` as the only accepted business timezone in this slice (recommended).
2. Approve `platform.business-date.read` as the capability for the current-date/period-resolution endpoint (recommended).
3. Confirm no automatic fiscal close/lock or historical-date block belongs in the kernel (recommended; command-level authorization and audit remain mandatory).
4. Confirm first release accepts only Gregorian `YYYY-MM-DD`, `month=YYYY-MM`, and an ordered date range; Hijri/calendar/holiday policy is deferred (recommended).

## Gate B plan after approval

1. Add strict contracts for business date, month intent, and inclusive range intent.
2. Implement an injectable-clock `BusinessDateService` that resolves all values from the server and live company context.
3. Expose a read-only API receipt for the verified company; do not accept body company IDs or client-created boundaries.
4. Add unit and database/API tests for leap days, invalid dates, date-order, Riyadh midnight, denied/cross-company/revoked sessions, and no-closure historical dates.
5. Bind Output Platform generated-at metadata to the central kernel rather than local offset arithmetic.

## Approval state

- Product owner: approved the four decisions on 2026-08-15.
- Architect/security/QA: discovery evidence recorded; implementation review pending approved contract.
- Finance/domain reviewer: policy impact recorded; no financial posting is included.
- Independent monitor: Finance remains blocked; Noorix runtime and fiscal-period state are not introduced.

## Gate B implementation evidence

- `BusinessDateService` resolves current, explicit-date, full-month, and ordered-range intents solely on the server after live company authorization.
- The active company must use the approved IANA timezone `Asia/Riyadh`; body company IDs and browser-created boundaries are not accepted.
- `POST /v1/business-date/resolve` requires `platform.business-date.read` and returns a typed receipt only.
- The resolver is clock-injectable and uses IANA timezone formatting for current-date boundaries; it does not use browser-local date construction or UTC slicing for business dates.
- Output Platform now obtains generated-at metadata through this central kernel.
- `scripts/run-gate-b-db-verification.mjs` passed Riyadh midnight transition, leap February, invalid date, reversed range, denied cross-company request, revoked session, and all prior foundation regressions.