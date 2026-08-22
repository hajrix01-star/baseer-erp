# BASEER ERP — Current Delivery Authority

**Last updated:** 2026-08-21
**Purpose:** single authority for the active delivery order, local acceptance status, and production boundaries.

## Read order

1. This file — current priority and boundary.
2. [Module delivery register](MODULE_DELIVERY_REGISTER.md) — state of each business scope.
3. [Quality evidence and committee register](QUALITY_EVIDENCE_AND_COMMITTEE_REGISTER.md) — executed checks and unresolved gates.
4. [Financial read scale and period standard](FINANCIAL_READ_SCALE_AND_PERIOD_STANDARD_2026-08-18.md) — shared period/read-scale rules.
5. [Build sequence committee plan](../foundation/BASEER_BUILD_SEQUENCE_COMMITTEE_PLAN_2026-08-15.md) — governing sequence unless this record states a bounded exception.

The dated Gate A/B records, module decisions, and retrospective reviews are historical evidence. They do not create a competing current roadmap.

## Current decision

Baseer is in **local finance-acceptance closure and next-scope selection**, not final delivery or production readiness.

On 2026-08-22, the owner accepted locally the Purchase & Expense and
Expenses & Obligations journeys, Treasury and custody movements, Suppliers,
Categories, and the read-only Invoice Register. The correction/cancellation
policy is also recorded in
[FINANCE_CORRECTION_AND_CANCELLATION_POLICY_2026-08-22.md](FINANCE_CORRECTION_AND_CANCELLATION_POLICY_2026-08-22.md).

No new business scope is active until the owner selects and authorizes the
next bounded scope. This closure authorizes planning that next scope; it does
not itself authorize production, Google connectivity, an AI provider, or a
Noorix cutover.

## Active cross-cutting enablement — 2026-08-22

The owner has authorized exactly one bounded cross-cutting scope:
**Baseer UI Platform Enablement — Phase 0 baseline and one React Aria
Combobox pilot**. It is not a business-module activation and it excludes
production, Noorix, external providers, broad UI migration, a dashboard, and
any financial-policy change.

The permitted order is: establish an auditable baseline; resolve a failing
web-release budget if it is reproduced from the approved tree; record the
dependency decision; then implement one non-financial `BaseerCombobox` pilot
behind the Baseer adapter. The scope stops at the Phase 1 acceptance gate.
The [quality and delivery monitor model](QUALITY_AND_DELIVERY_MONITOR_OPERATING_MODEL.md)
and [platform transformation plan](UI_PLATFORM_ADOPTION_AND_DASHBOARD_IMPLEMENTATION_PLAN_2026-08-22.md)
govern its evidence. Any later phase requires a new owner decision.

## 2026-08-21 current working-tree verification

The current working tree contains uncommitted candidate additions for Reports and Operations. They do not alter the active delivery order or grant owner acceptance. Type checks, API/web builds, report-policy verifiers, the Operations purchase-cycle verifier, Finance Gate B, and the web release budget passed on the local test database. The budget result is 83,636/85,000 bytes for the largest JavaScript journey and 14,161/16,000 bytes for the largest CSS journey.

Finance Gate B was restored by updating its direct fixture to inject `FinanceCashPerformanceEventService` into both supplier-due and purchase-expense services. The candidate must still be explicitly accepted before it is recorded as a delivered Reports or Operations scope.

Assets & Warranty Gate A is now a local, bounded candidate within Operations: the Purchase & Expense entry row can mark follow-up; Operations contains the company-scoped queue and operational asset/warranty register; archive, audit, idempotency and no-finance-posting behavior are verified by `npm run verify:operations-assets-warranty`. It does not grant acceptance, financial asset accounting, attachment upload, claims, disposal, or Noorix import. Owner acceptance remains required.

## 2026-08-18 read-scale status

Commits `7d962d5`, `2c9edfe`, `ff0afe4`, and `bca5d87` delivered local, bounded-read corrections:

- stable cursors and bounded page sizes for the financial register, supplier dues/payments, daily sales, outflows, and treasury activity;
- server-backed lookup for large supplier/category choices;
- period-aware views default to the current Riyadh business month;
- `FinanceAccountDailyBalance`, a rebuildable daily read projection updated in the journal-posting transaction and sourced only from posted journal lines.

These changes improve safe operational scale but do **not** prove multi-year or million-row production performance. The owner deferred volume benchmarks; benchmark data, query plans, and p95 targets remain a future gate. The current working tree includes candidate report read models, but no official-report or formal accrual-P&L acceptance has been granted.

## Production and migration boundary

Production release remains blocked until all of the following are evidenced:

1. Production backup coverage and an isolated restore rehearsal.
2. Noorix staging import, dry run, reconciliation, and cutover approval.
3. Volume benchmark and deployed-database query-plan evidence for the intended data scale.
4. A separate owner acceptance for each future business scope and its production readiness.

Noorix remains a read-only discovery/migration source. There is no runtime integration or dual-write.

## Authorities by concern

- [Master build charter](../BASEER_ERP_MASTER_BUILD_CHARTER.md): non-negotiable architecture and engineering principles.
- [Module taxonomy](../architecture/BASEER_ERP_MODULE_TAXONOMY_V2.md) and [user modules](../architecture/BASEER_ERP_USER_MODULES_V3.md): product boundaries and navigation.
- [Financial source-of-truth policy](FINANCIAL_AND_FACTUAL_SOURCE_OF_TRUTH_POLICY_2026-08-15.md): journal and factual ownership.
- [Baseer UI system standard](BASEER_UI_SYSTEM_STANDARD.md): shared UI behavior and accessibility.
- [Technical contracts and quality standard](TECHNICAL_CONTRACTS_AND_QUALITY_STANDARD.md): service/read/write and quality rules.
- [Scope exception log](SCOPE_EXCEPTION_LOG.md): bounded exceptions only; it does not alter the delivery order by itself.

## Documentation rule

When the priority or acceptance state changes, update this file, the Module Delivery Register, and the Quality Evidence Register in the same change. The [documentation map](../README.md) identifies those current references and prevents historical records from being mistaken for the current plan.
