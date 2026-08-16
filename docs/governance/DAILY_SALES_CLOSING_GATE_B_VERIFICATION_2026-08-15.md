# BASEER ERP — Daily Sales Closing Gate B Verification

**Date:** 2026-08-15
**Scope:** Daily Sales Closing only — not POS, dashboard, Marketing, Google, AI, migration, or production.

This implementation follows `FINANCIAL_AND_FACTUAL_SOURCE_OF_TRUTH_POLICY_2026-08-15.md`: its monetary summary is reconciled to the sealed journal; operating-day and customer-count facts add context only.
**Operational purpose (owner decision 2026-08-16):** an employee copies one end-of-day sales aggregate from an external POS system into BASEER ERP. This scope is not POS and does not accept sale lines or individual invoices. The governed wording and user flow are recorded in `../foundation/DAILY_SALES_CLOSING_OPERATIONAL_PURPOSE_DECISION_2026-08-16.md`.

## Implemented boundary

- Company-scoped operational calendar: `OPEN`, `CLOSED`, `PARTIAL`; its `PENDING` status is derived and is never treated as zero sales.
- One atomic, serialised closing per company/date/scope (`MORNING`, `EVENING`, `ALL`), with an idempotency receipt and a concurrency guard.
- Gross sales allocations copied from the external POS end-of-day summary into active sales-channel vaults. The server calculates the inclusive VAT split and creates the balanced, sealed journal.
- Cash-on-hand is stored as a management observation only. It is not revenue, a vault movement, or a journal entry.
- Corrections preserve the original document number and write a new immutable posting version only while the financial period is open. Reversal preserves history and creates a journal reversal.
- Server-owned calendar, closing history, channel-vault and daily-summary receipts are read through `finance.daily_sales.read`; no manual journal route is exposed.

## Verification completed on the isolated BASEER Docker test database

| Evidence                                                | Result                                                                                                                                                           |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Prisma migrations `20260815230000` and `20260815231000` | Applied to the isolated test database only                                                                                                                       |
| `node scripts/run-daily-sales-gate-b-verification.mjs`  | Passed: VAT, vault channels, idempotency replay, duplicate concurrent scope denial, correction, reversal, calendar semantics, company isolation, summary rebuild |
| `node scripts/run-daily-sales-http-verification.mjs`    | Passed: authentication, company capability scope, write replay, VAT receipt, calendar, channel-vault, one bounded workspace read and closing-history reads      |
| `npm.cmd run check --prefix packages/contracts`         | Passed                                                                                                                                                           |
| `npm.cmd run build --prefix packages/contracts`         | Passed                                                                                                                                                           |
| `npm.cmd run build --prefix apps/api`                   | Passed                                                                                                                                                           |
| `npm.cmd run build --prefix apps/web`                   | Passed                                                                                                                                                           |

## Request budget verification (2026-08-16)

- **Initial Sales workspace:** one `GET /v1/finance/daily-sales/workspace` for vaults, server-owned entry date, closing history, cash handovers, shift summary, and effective permissions.
- **Global shell context:** one separate `GET /v1/companies/available` may be used by the shared company selector; it is not repeated by the Sales workspace.
- **Save or correction:** one authorized write followed by one workspace refresh; it must not fan out to individual cards.
- **Preview:** at most one server preview after a 350ms pause; a stale preview request is aborted before its response can update the form.
- **Proof:** the HTTP verification now asserts the workspace receipt contains the same posted closing, handover, shift, vault and permission data in one bounded read.
## Native operating journey

`Operations → Sales` contains the narrow bilingual daily-closing workspace. It has no demo numbers and stays empty until a real authenticated company session exists. It sends commands only to the authorized API and displays server receipts; it does not calculate VAT, journals, balances, averages, or business totals in the browser.

## Remaining decision

This implementation is **ready for owner visual acceptance**. The embedded browser visual-inspection connector was blocked by a local access-control failure, so no unperformed visual test is claimed. Marketing Gate A, Google/OAuth, AI chat, inbound evidence, Noorix migration and production remain out of scope until acceptance is recorded.
