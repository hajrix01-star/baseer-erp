# Payroll selected period and month-end issuance

- Registry: BASEER-ARCH v1.0; ARCHITECTURAL; owner: people-attendance-payroll.
- Base revision: 3ef2427e57e60bfb7498c34bf9ebf070ef5fc362.
- Scope: payroll create/preview/update/approve contract and UI; no data migration.
- User: show payroll month without day; allow August and prior-month issuance;
  invoice/accrual date must be the last day of the selected payroll month.

## G0 contract / cycle

Month selection -> server-owned month-end preview -> draft -> approval posts
the month-end accrual -> payments retain their actual payment dates. Existing
paid payroll and source evidence remain immutable. The current-month-only
restriction is removed. Tenant/company capabilities, duplicate-month locks,
amount accuracy, fiscal-period posting controls and payment chronology remain.

UI stores YYYY-MM, converts once to YYYY-MM-01 at the API boundary, and renders
month labels as YYYY-MM. RHF blur must never replace the payload with YYYY-MM.
Optional legacy businessDate input remains accepted for compatibility; payroll
month alone determines the server-owned calculation and accrual date.

## G1 capacity / G2 data

Reuse existing bounded preview pages (50 default, 100 max), payroll generation
limits and transaction/row/advisory locks. No new unbounded queries or tables.
Preparation accepts current and previous months; existing future-date posting
guard remains at approval using the derived month-end date. Approval uses the
same date for journal, applications and employee financial movements.

Current active employees hired after the selected period are excluded without
blocking the whole run; explicit settlement applications for excluded employees
still fail. Existing employment-status rules are unchanged.

An older draft whose stored calculation date is not month-end must be refreshed
through updateDraft before approval; return a clear localized refresh message
instead of silently changing its previously calculated amounts. The edit UI
already exposes the update action. No automatic modification of paid history.

## G3 implementation / verification

Reuse Nest/Prisma/Zod, lastDayOfMonth, central calendar and existing React form
components. No dependencies or schema changes. Direct implementation in owner
files; no new service layer. Existing contracts become more permissive for the
unused legacy businessDate field, preserving old clients while new clients omit it.

Tests: previous August while operational September; 28/29/30/31-day months and
year rollover; forged client date ignored; no future-month draft/future accrual;
next-month hires excluded; draft refresh; duplication/idempotency/fiscal closed
period/permissions; balanced accrual and unchanged actual-payment semantics.
Browser acceptance: month select then blur then preview/create sends valid date;
table and summary omit day; API controls month-end; Arabic/English and mobile.
Local tests use isolated fixtures; no live payroll is issued during testing.

## Gates / operations

- Architecture and orchestration references reused from the session; build and
  delivery skills selected for this implementation and release.
- Read current owner files and tests. Created isolated codex/payroll-period-issuance
  from current origin/main to avoid unrelated concurrent work.
- Independent reviewer inspected backend barriers and identified post-period
  hires and old-draft calculation handling; resolved above. Independent G0–G3 approval received before implementation.

## Candidate evidence / G5–G8

- Contracts, output-platform, API and web builds/typechecks passed.
- Focused period runner passed: month lengths, leap year/year rollover, prior August, hire exclusion, month-end accrual/application dates, normalized and legacy replay, forged dates, refresh and future guards.
- Real PostgreSQL HR lifecycle and HTTP verification passed, including a closed fiscal period rejection with unchanged run/lines/applications/journals/settlements/movements/idempotency, followed by successful approval after reopening using the same key. Fixtures use the local test database only.
- Payroll browser acceptance: 24/24 desktop/mobile cases passed. Calendar selection, field blur, canonical API payload and summary refresh: 4/4 Arabic/English desktop/mobile passed after final assertion. Saved draft edit verifies disabled month remains in request.
- Architecture, central API transport, financial boundaries, localization, numeric policy and diff checks passed. CI executes all three HR runners.
- Old draft guidance explicitly says to open the draft and select Save changes. Mutation callbacks reload list and missing-month summary.
- One initial browser run reached a pre-existing shared dev server and was discarded as candidate evidence; acceptance was rerun using an isolated server on 5299. Windows Playwright server cleanup was terminated after tests; isolated rerun exited cleanly.
- No schema/data migration, payroll issuance or payment on production. Rollback is application commit rollback; newly persisted drafts carry month-end dates.
- Independent final delivery review and PR quality gates required before merge/deploy.

- G8 independent delivery decision: GO. Source and closed-period test reviewed; evidence accepted. Release still passes normal PR quality and immutable deployment gates.

- Release candidate rebased onto main 7a13bcd7 (unrelated Google reviews feature); sole conflict was the append-only governance log, both entries preserved. No payroll source conflict.
