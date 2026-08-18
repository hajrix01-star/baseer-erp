# BAQC — Retrospective 360° Review

**Date:** 2026-08-17
**Decision:** **Conditional pass for local development — return to stabilization before a new business scope**
**Committee:** BAQC-01, BAQC-02, BAQC-03, BAQC-04, BAQC-05, BAQC-06, BAQC-08 and BAQC-09. BAQC-07 reviewed AI readiness and was not asked to approve a live provider or connector.

## Scope and evidence

The committee reviewed the implemented platform, administration and access, Daily Sales Closing, finance foundation/master data, Purchase & Expense, Expenses & Obligations, Treasury, AI Gate B, shared web system, tests and governing documents. It inspected source, contracts, migrations, isolated DB/HTTP evidence and the current delivery records.

The following local gates passed on 2026-08-17:

- `npm run check:architecture`
- `npm run check:permissions` — 50 capabilities
- `npm run check:web-financial-boundaries`
- `npm run check:web-dialog-conventions`
- `npm run verify:web-budget` — initial JS 289,227 B / 300,000 B; deferred JS 60,672 B / 100,000 B; CSS 61,629 B / 62,000 B
- contracts, API and web TypeScript/builds
- Finance DB and Daily Sales HTTP verification recorded in the current evidence register

## What is sound

| Area | Status | Notes |
| --- | --- | --- |
| Platform, identity and company context | Verified locally | Server-side authorization, tenant/company isolation, audit, idempotency and business-date boundaries are in place. Production backup/restore and public-internet hardening remain separate gates. |
| Finance foundation and master data | Verified locally | Journal, periods, company setup, categories, suppliers and vault foundations are established. |
| Daily Sales Closing | Ready for owner acceptance | Server posting, concurrency and HTTP evidence pass; it remains an external-POS daily aggregate, not POS. |
| Purchase & Expense and Expenses & Obligations | Owner verification | Documents, recurring expense payment and inclusive-loan liability flows exist; correction/cancellation is intentionally not yet in scope. |
| Treasury | Verification | Ledger-derived vault balances and internal transfers have local DB/HTTP evidence, but native acceptance and the items below remain open. |
| AI Gate B | Verified and offline | Registry/preflight/audit foundation exists. No provider, chat, memory, tools, OCR or external effect is enabled. |

## P1 — close before a new business scope

1. **Server-owned financial summaries:** remove remaining browser money calculations and UTC date defaults from Purchase & Expense, Treasury and Daily Sales fallbacks. Each operational workspace must receive its business date and display summary/preview from a bounded server receipt.
2. **Treasury completion:** return `totalBalance` from the server; expose the promised bounded movement history; handle idempotency-key payload mismatch as HTTP 409; decide and test the vault permissions granted to company manager and accountant.
3. **Typed module adapters and request bounds:** replace direct generic API calls in financial workspaces with typed module adapters. Purchase & Expense must use one bounded read workspace rather than multiple initial reads. Add limits/cursor or a documented bounded exception for profiles and loans.
4. **Shared UI completion:** centralize input/select/date/tabs/async state/confirmation primitives; remove `window.confirm`; define missing design tokens; make interactive controls meet the documented 44px target; finish visible-permission navigation.
5. **Bilingual and accessibility evidence:** centralize Arabic/English copy and formatting, complete RTL/LTR review, and add interaction/E2E/accessibility coverage for critical financial journeys.
6. **Governance reconciliation:** mark the completed Finance Setup decision as historical; record the required single-active-scope exception for Treasury beginning while Purchase & Expense is in owner verification; remove unimplemented correction/reversal claims from scope documents; attach commit/CI/DB/HTTP evidence to the quality register.
7. **CSS authority:** reconcile the documented 58 KB ceiling with the enforced 62 KB gate and consolidate CSS before adding visual scope. The current 371 B headroom is not safe for expansion.

## Explicit boundaries, not defects

- Noorix mapping/discovery exists, but there is no live importer, dry-run, reconciliation rehearsal or cutover.
- No production deployment claim, backup/restore evidence, live connector, OCR, AI provider, RAG, chat or marketing integration exists.
- Cash count, bank reconciliation and transfer reversal remain separately scoped.

## AI readiness

- Administration and implemented operations are **S1 help-ready only**.
- Daily Sales, finance, Purchase & Expense, recurring payments and loans remain **S2 planned**, pending reconciled server read models and approved Arabic evaluations.
- Treasury remains **S0/S1** until its movement/report read model and owner acceptance close.
- Marketing, inbound evidence, OCR and external AI actions are not implemented.

## BAQC-08 alternatives review

The retained modular monolith, server-owned REST workspace receipts, ledger-derived vault balances, recurring-expense profiles and loan-liability model are appropriate for Baseer’s private small-company stage. Microservices, GraphQL, a mutable vault balance, a third “recurring” category root, or an AI provider/chat now add risk without solving an accepted need. Re-evaluate only when usage, workflow complexity or external integration evidence justifies it.

## BAQC-09 code and rule compliance

Build and static gates pass, but compliance is **partial** until P1 items 1–7 close. The main gaps are browser financial calculations, direct generic API use, incomplete shared UI primitives, CSS/token drift, incomplete visible authorization and missing interaction/E2E/a11y evidence.

## Next permitted workflow

**One stabilization and verification scope only:** resolve P1 items above, run DB/HTTP/UI evidence, then perform owner acceptance for Treasury and Purchase & Expense. Afterwards, make and record the correction/cancellation decision. Only then may the next business scope be **reconciled finance read models and reporting**.

**No new module is permitted now:** no Marketing, Inbound Evidence, email/Telegram/OCR, live AI provider/chat, Noorix importer or production-release claim.
