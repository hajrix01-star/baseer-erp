# BASEER ERP — 360° Committee Review and Build Confirmation

**Date:** 2026-08-16  
**Decision:** Conditional pass for local development. No P0 blocker was found. The approved sequence remains valid, with a mandatory stabilization gate before the next financial write scope.

## Verified position

- Platform: identity, live sessions, company context, RBAC, audit, idempotency, RLS/FORCE RLS, sealed journal and fiscal controls are implemented foundations.
- Administration: company, user, role and theme journeys are native UI foundations; authorization remains server-side.
- Daily Sales Closing: versioned operational end-of-day aggregate (not POS), operating-day calendar, shifts and management-only cash handover are implemented. Owner operational acceptance remains pending.
- AI Gate B: technical, offline only; it has no provider call, prompt, tool, conversation, memory or chat UI.
- Marketing/Google and Inbound Evidence/Email/Telegram/OCR: approved designs only; no backend integration has started.

## Mandatory stabilization gate — S1

Close these before accepting the first new Purchase & Expense write model:

1. **Restricted CI database role:** use `postgres` only for bootstrap/migrate; API, DB and HTTP verifiers must run under a dedicated `NOSUPERUSER NOBYPASSRLS` application role so RLS is proved rather than bypassed.
2. **Financial report completeness:** calculate shift totals directly in the database across the permitted period, not from a 400-row display list; no financial report may truncate silently.
3. **CI evidence:** run administration lifecycle, finance race/foundation and AI Gate B DB/HTTP verification as mandatory checks using the restricted role.
4. **Web reliability:** fix multiple-month reload dependencies, complete theme-aware active/semantic tokens, and add keyboard/Escape/outside-click behavior plus interaction coverage for the period picker.
5. **CSS capacity:** consolidate legacy selectors before expanding further; the release stylesheet is close to its approved 58KB budget.

## Confirmed delivery order

1. S1 stabilization gate.
2. Purchase & Expense financial documents: contract → server command → journal posting → correction/reversal → tests → native UI → owner acceptance.
3. Treasury completion and journal-reconciled financial read models/reports.
4. Daily Sales owner acceptance and report adoption.
5. Owner decision between Inbound Evidence E1/E2 and Marketing Gate A; one business scope only.
6. Read-only integrations after their provider decisions and evidence gates.
7. Basira read tools/evaluations/chat only after official read models exist; no autonomous financial action.

## Production boundary

Local development may continue. Real financial data, external connectors or private production release require a documented Hostinger backup coverage decision and a successful isolated restore rehearsal. The current daily server-backup decision must be reconciled with older operations wording before release.