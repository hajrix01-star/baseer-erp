# BASEER ERP — Committee Build Sequence

**Status:** Owner-approved execution sequence. Current authority: `../governance/CURRENT_DELIVERY_AUTHORITY.md`.

## Current truth

The mandatory cross-module policy is `docs/governance/FINANCIAL_AND_FACTUAL_SOURCE_OF_TRUTH_POLICY_2026-08-15.md`: every money value in a later report, Marketing view, Command Center card or AI answer must come from a journal-reconciled server read model; operational and provider facts add provenance-aware context only.

- Platform and Finance Phase 1 backend are verified on the isolated BASEER Docker test database.
- Finance Phase 2 native UI remains deferred; it is not cancelled.
- Marketing Performance & Google Hub is designed but has no backend models, commands, Google connection, facts, UI, or external calls yet.
- AI Platform Gate B technical core is verified: versioned skills, company-authorized offline preflight, rate limit, idempotency, audit receipts and receipt-integrity constraints. It still has no provider call, conversation, memory, read tool or chat UI.
- Daily Sales Closing is frozen pending owner acceptance as the official sales source. Finance Setup & Master Data is implemented as the prerequisite. Purchase & Expense, including the Operations-facing Expenses & Obligations workspace, is in owner verification: recurring-payment local DB/HTTP evidence passes, while bilingual/RTL acceptance and correction/cancellation scope remain open. The owner has activated **Treasury and vault movements** as the one active build scope: ledger-derived vault balances, lifecycle and balanced internal transfers. Marketing/Google, Inbound Evidence and a user-facing AI assistant remain deferred until required financial documents and reconciled server read models close.

## Executable order — 2026-08-17

The following order controls the active build. Older phase headings below remain historical scope evidence where they differ:

1. **Treasury and vault movements — verification (active):** ledger-derived balances, add/archive lifecycle, bounded history and balanced internal transfer commands. Cash count/handover reporting, bank reconciliation and transfer reversal remain separate.
2. **Purchase & Expense / Expenses & Obligations — owner verification:** local recurring migration and DB/HTTP evidence pass; bilingual/RTL owner acceptance and the correction/cancellation decision remain open.
3. **Reconciled finance read models:** server-owned financial reporting facts and management cash reporting after source operations close.
4. **Daily Sales owner acceptance:** keep its operating workflow frozen except for confirmed defects.
5. **Assets & Warranty — planned Gate A:** after finance reporting, deliver the source-document queue and operational register only; automatic capitalization, depreciation and warranty-file upload remain separately gated by the asset-accounting policy and File Storage Gate A.
6. **Owner priority gate:** select Inbound Evidence E1/E2 or Marketing Gate A only after the finance-reporting and Assets & Warranty Gate A decisions; neither starts automatically.
7. **AI read tools and Basira UI:** only after verified read models and skill evaluations; provider/chat are not in the active scope.

## Phase 0 — Build-control baseline

1. Keep the delivery register and scope decisions aligned with the source.
2. Correct confirmed text-encoding defects before user-facing UI work.
3. Establish a reviewed source-control baseline before the next large implementation increment; never commit secrets or test data.
4. Preserve one active business scope at a time and record any owner priority exception.

**Closure:** documents, source status, encoding checks, and baseline evidence agree.

## Phase 1 — Daily Sales Closing vertical slice

1. Operational calendar with `OPEN`, `CLOSED`, and `PARTIAL` operational states, with `PENDING` as a derived data state and `HOLIDAY` recorded as a closed-day source.
2. Daily Sales Closing only — not POS — where an employee records the external POS end-of-day aggregate, with gross/VAT, channels tied to vaults, and an explicit management-only cash handover to the accountant. The handover is separate from revenue, collection channels, vault balances and journals.
3. Open-period correction and closed/locked-period reversal policy through the journal.
4. Company-scoped contracts, RLS, authorization, idempotency, audit, serials, tests, and server read receipts.
5. A narrow native operational UI for the calendar and daily close only, with bilingual/RTL behavior, authorized API use and error/retry states. It is not a dashboard or POS.

**Closure:** the backend, database/HTTP/concurrency tests and the narrow operating journey are accepted together. Daily sales is an authoritative, versioned source that distinguishes a non-working day from a zero-sales day.

## Effective priority amendment (2026-08-16)

The owner-approved order after Daily Sales is governed by `../governance/OWNER_PRIORITY_AMENDMENT_AI_AND_FINANCE_SEQUENCE_2026-08-16.md`: AI Gate B technical core is closed; core Finance documents, treasury and reconciled reports come next. Marketing/Google and Inbound Email/Telegram/OCR remain deferred. The phase headings below describe scope only; this amendment controls activation order.

## Phase 2 — Marketing Performance Gate A

1. Company-scoped manual campaign register: channel, dates, status, objective, location/reference and immutable revisions where required.
2. Immutable normalized daily facts, source/freshness/quality fields, metric catalog enforcement and explicit campaign-to-fact links.
3. Read contracts for campaign analysis; no browser calculations, revenue attribution, Google call, OAuth, provider credential, or external action.
4. Database/RLS, authorization, idempotency, audit, cross-company and data-quality integration tests.

**Closure:** BASEER can safely store and explain manual campaign context and factual measurements, but does not claim causation.

## Phase 3 — Google read-only connection gates

1. Separate provider decision records for Google Ads and Google Business Profile: supported fields, scopes, terms, retention, rate/quota, kill switch and no-write proof.
2. Connection/capability/mapping/sync-receipt and snapshot foundations, then a verified read-only adapter for one provider at a time.
3. Imported daily facts are immutable, deduplicated, freshness-labelled and quarantined on validation failure.

**Closure:** each provider has proven company isolation, token protection, manual sync, no external write, retry/deduplication and data-quality behavior.

## Phase 4 — Server-calculated analysis and reports

1. Central filter contract: all/day/month/range/year/quarter, company/location, timezone and Apply/Reset semantics.
2. Marketing Performance read models; sales correlation only after Daily Sales Closing exists.
3. Financial ledger/read models, vault balances, supplier aging and management cash projections as their source operations become complete.
4. No ROAS or causal claim unless sales source, metric definition, window and attribution methodology are all complete.

**Closure:** every displayed metric has source, period, timezone, freshness and quality state.

## Phase 5 — Native UI, one vertical journey at a time

1. Marketing Performance UI: Overview, Campaigns, Google Ads, Google Business and Connections.
2. Command Center summary cards use the same server read models; they do not duplicate a full dashboard or contain external action controls.
3. Finance setup and remaining Finance operation UI resume as a separate approved scope.

**Closure:** each screen uses authorized API contracts, bilingual RTL/LTR behavior, mobile/accessibility states, retry/error handling and no direct database access.

## Phase 6 — Assistant and AI adoption

1. Implement AI Gateway adapter, read-only tools, citations, evaluations and encrypted bounded conversation memory.
2. Run internal read-only evaluation using verified Marketing, Sales, Finance and report read models.
3. Add the floating Basira Assistant UI only after isolation, prompt-injection, source/freshness and no-side-effect tests pass.

**Closure:** the assistant explains verified facts and uncertainty; it cannot perform financial, advertising, publishing or configuration side effects.

## Phase 7 — Noorix rehearsal and private operation

1. Design source maps and stage an import rehearsal only after the corresponding BASEER source models exist.
2. Reconcile company/month counts, status, gross/net/tax, debit/credit, serials, cancellations, attachments and operating dates.
3. Complete private Hostinger deployment, verified daily server-backup coverage and an isolated restore drill before cutover.

## Explicitly deferred

- live Noorix cutover;
- public signup/SaaS behavior;
- POS/inventory;
- bank reconciliation;
- Google Ads/GBP write actions, automated review replies, social publishing, or external spend;
- AI chat UI before verified source read models;
- browser-calculated business values.

## Queued finance-operational scope — Inbound Evidence & Payment Hub

The owner-approved scope in `INBOUND_EVIDENCE_AND_PAYMENT_HUB_SCOPE_DECISION_2026-08-15.md` is queued and does not replace the active Purchase & Expense financial-document scope. It covers work-only central email classification, evidence received through Telegram and later SMS, trusted company bank-account/service-identifier matching, manual company-first recurring-expense selection, payment orders and payment vouchers.

It starts only after core financial documents and reconciled reports close, and after a separate owner priority decision. It begins as a backend vertical slice: trusted evidence records and company isolation (E1), then authorized payment order/voucher plus journal integration (E2), then separately approved email/Telegram/SMS and AI analysis adapters (E3), and finally native UI (E4). Bank-statement reconciliation, automatic payment, automatic posting and unrestricted mailbox ingestion remain excluded.
