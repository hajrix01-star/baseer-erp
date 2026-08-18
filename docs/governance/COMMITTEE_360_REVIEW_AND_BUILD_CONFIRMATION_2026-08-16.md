# BASEER ERP — 360° Committee Review and Build Confirmation

**Date:** 2026-08-16  
**Decision:** Conditional pass for local development. S1 stabilization is closed; Purchase & Expense is the only active next business scope. Private/production release remains separately blocked by backup-and-restore evidence.

## Verified position

- Platform: identity, live sessions, company context, RBAC, audit, idempotency, RLS/FORCE RLS, sealed journal and fiscal controls are implemented foundations.
- Administration: company, user, role and theme journeys are native UI foundations; authorization remains server-side.
- Daily Sales Closing: versioned operational end-of-day aggregate (not POS), operating-day calendar, shifts and management-only cash handover are implemented. Owner operational acceptance remains pending.
- AI Gate B: technical, offline only; it has no provider call, prompt, tool, conversation, memory or chat UI.
- Marketing/Google and Inbound Evidence/Email/Telegram/OCR: approved designs only; no backend integration has started.

## S1 stabilization closure — 2026-08-16

1. **Restricted CI database role:** CI now runs migrations with `postgres` only, then provisions `baseer_ci_app` as `NOSUPERUSER NOBYPASSRLS` for API, database and HTTP verification. The same restricted-role Finance Gate B proof passed locally against the disposable Docker test database.
2. **Financial report completeness:** shift summaries now use a database `groupBy` across the full allowed business-date range; they are no longer calculated from the 400-row screen list.
3. **CI evidence:** administration lifecycle, Finance Gate B, period-race, AI Gate B DB/HTTP and Daily Sales DB/HTTP verifiers are mandatory workflow steps. Two stale HTTP fixtures were corrected to select their generated system tenant, so the tests are repeatable.
4. **Web reliability:** multiple-month selections now trigger reloads from their stable month selection; the period picker supports outside-click close, Escape close and focus return. Active picker states and sales insight accents use theme tokens.
5. **CSS capacity:** obsolete Daily Sales button declarations were consolidated into the central button primitive. Production CSS is now 57,684 bytes under the unchanged 58,000-byte limit (316-byte headroom).

## Re-evaluation evidence

Passed locally after the fixes: TypeScript checks for contracts/API/web; API and web production builds; web release-budget, financial-boundary and dialog-convention gates; architecture, permission-catalog and AI Gate B gates; Finance Gate B DB; period-race; Daily Sales DB/HTTP; Administration lifecycle; AI Gate B DB/HTTP; and Finance Gate B again under `baseer_ci_app` rather than a superuser.

The GitHub workflow will repeat these checks using its ephemeral restricted role on its next run. Visual regression and browser E2E coverage remain a quality improvement for the next UI expansion; they are not represented as completed evidence.
## Confirmed delivery order

1. Purchase & Expense financial documents: contract → server command → journal posting → correction/reversal → tests → native UI → owner acceptance.
2. Treasury completion and journal-reconciled financial read models/reports.
3. Daily Sales owner acceptance and report adoption.
4. Owner decision between Inbound Evidence E1/E2 and Marketing Gate A; one business scope only.
5. Read-only integrations after their provider decisions and evidence gates.
6. Basira read tools/evaluations/chat only after official read models exist; no autonomous financial action.

## Production boundary

Local development may continue. Real financial data, external connectors or private production release require a documented Hostinger backup coverage decision and a successful isolated restore rehearsal. The Hostinger daily server-backup decision is the governing backup policy; its required coverage confirmation and isolated restore rehearsal remain open before release.
## Verification addendum — 2026-08-17

- Finance Setup & Master Data is implemented as the prerequisite for the only active scope: **Purchase & Expense financial documents, including Operations → Expenses & Obligations**.
- The scope now exposes a bounded, company-authorized server workspace receipt. It provides business date, financial configuration, recurring profiles, loans and document history; the browser no longer needs to assemble the section from independent reads or calculate financial totals.
- Read access for loans is distinct from write access. Company manager, accountant and reader templates receive only the capabilities appropriate to their role; financial commands remain re-authorized on the server.
- A payable batch item is valid without a vault allocation and requires a supplier; a paid item requires a payment destination. Recurring-payment coverage uniqueness and payable-batch behavior are now included in the Finance DB verifier.
- **Status remains in verification.** The migration `20260817230000_recurring_expense_payments` is applied on the isolated local test database and the expanded database/HTTP evidence passes. Bilingual/RTL owner acceptance remains required. No correction/cancel scope is claimed until it is separately implemented.
## 2026-08-17 implementation evidence update

- The recurring-expense payment migration was applied to the isolated local test database.
- The Finance DB verifier now covers recurring-payment coverage uniqueness and payable-batch posting without a vault; it passes.
- The Daily Sales HTTP verifier additionally proves the company-authorized bounded Expenses & Obligations workspace and a denied cashier access path; it passes.
- The scope remains **in verification**: native Arabic/English owner acceptance and the correction/cancellation decision are still required. This record does not claim a Noorix importer or production readiness.

## Current execution addendum — 2026-08-17

This addendum supersedes the historical Confirmed delivery order above. Treasury and vault movements is the single active verification scope; Purchase & Expense and Expenses & Obligations remain in owner verification. The controlling next sequence is reconciled finance read models, Daily Sales owner acceptance, then planned Assets & Warranty Gate A before the later owner-priority choice between Inbound Evidence and Marketing. Assets & Warranty uses a source-document follow-up queue only; its asset-accounting policy, attachment storage and Noorix Import Run are separate gates described in ../foundation/ASSETS_AND_WARRANTY_SCOPE_DECISION_2026-08-17.md.
