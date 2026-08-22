# BASEER ERP — Current Delivery Authority

**Last updated:** 2026-08-23
**Purpose:** single authority for the active delivery order, local acceptance status, and production boundaries.

## Read order

1. This file — current priority and boundary.
2. [Module delivery register](MODULE_DELIVERY_REGISTER.md) — state of each business scope.
3. [Quality evidence and committee register](QUALITY_EVIDENCE_AND_COMMITTEE_REGISTER.md) — executed checks and unresolved gates.
4. [Financial read scale and period standard](FINANCIAL_READ_SCALE_AND_PERIOD_STANDARD_2026-08-18.md) — shared period/read-scale rules.
5. [Build sequence committee plan](../foundation/BASEER_BUILD_SEQUENCE_COMMITTEE_PLAN_2026-08-15.md) — governing sequence unless this record states a bounded exception.

The dated Gate A/B records, module decisions, and retrospective reviews are historical evidence. They do not create a competing current roadmap.

## Current decision

Baseer has **closed Operations Core, Human Resources, Finance and Accounting,
Administration and access, Reports, and Decision Intelligence locally,
including their library migrations**. The next active transformation scope in
the centralized sequence is **Command Center library-migration closure**. This is not final
delivery or general production readiness.

On 2026-08-22, the owner accepted locally the Purchase & Expense and
Expenses & Obligations journeys, Treasury and custody movements, Suppliers,
Categories, and the read-only Invoice Register. The correction/cancellation
policy is also recorded in
[FINANCE_CORRECTION_AND_CANCELLATION_POLICY_2026-08-22.md](FINANCE_CORRECTION_AND_CANCELLATION_POLICY_2026-08-22.md).

Finance migration is closed at `a1cbf54`; its reproducible evidence is recorded
in [Finance library-migration verification](FINANCE_LIBRARY_MIGRATION_VERIFICATION_RECORD_2026-08-22.md).
Administration migration is closed at `33a7175`; its reproducible evidence is
recorded in [Administration library-migration verification](ADMINISTRATION_LIBRARY_MIGRATION_VERIFICATION_RECORD_2026-08-22.md).
Reports migration is closed at `82ae65d`; its reproducible evidence is recorded
in [Reports library-migration verification](REPORTS_LIBRARY_MIGRATION_VERIFICATION_RECORD_2026-08-23.md).
Decision Intelligence migration is closed at `97c99bf`; its reproducible
evidence is recorded in [Decision Intelligence library-migration verification](DECISION_INTELLIGENCE_LIBRARY_MIGRATION_VERIFICATION_RECORD_2026-08-23.md).
The active scope is now limited to converting already implemented Command
Center UI consumers registered in `LIBRARY_MIGRATION_MANIFEST.json` to the
approved central Baseer adapters. It does not authorize a new KPI, action,
financial calculation, API, schema, RLS/RBAC rule, external provider, or
production change.

For the closed Finance scope only, the owner's instruction to remove all browser-side
financial aggregation authorizes one backward-compatible read-model addition:
`GET /finance/accounts` may return an authoritative Decimal-string summary
computed in its existing tenant transaction. This does not change a command,
schema, RLS, posting rule, period rule or permission, and it may not be reused
as authority for another API expansion.

It excludes invitation and MFA work, new permission semantics, asset
capitalization/depreciation/disposal, automatic financial posting, public
attachments, bank connectivity, external providers, Noorix import/cutover,
formal reports/P&L and any unapproved financial policy.

Operations evidence remains in
[Operations Core verification](OPERATIONS_CORE_VERIFICATION_RECORD_2026-08-22.md),
and HR evidence is recorded in
[HR library-migration verification](HR_LIBRARY_MIGRATION_VERIFICATION_RECORD_2026-08-22.md).
The HR implementation reference is `6942b50`: Playwright reports `73 passed`
and `1 intentional skip`; inventory has zero unclassified/stale targets; HR
HTTP/RLS/lifecycle/onboarding/financial-integrity and Finance period gates pass.

## Active cross-cutting enablement — 2026-08-22

The owner has authorized the **Baseer Library Adoption operating authority**:
an ongoing, gated path for adopting eligible libraries without a separate
owner decision for each one. It is not a business-module activation and it
does not authorize production, Noorix, external providers, financial-policy
changes, or the excluded categories defined in the
[Library Adoption Operating Authority](LIBRARY_ADOPTION_OPERATING_AUTHORITY.md).

Every library remains a small, evidence-led phase behind a Baseer adapter.
The [quality and delivery monitor model](QUALITY_AND_DELIVERY_MONITOR_OPERATING_MODEL.md)
and [platform transformation plan](UI_PLATFORM_ADOPTION_AND_DASHBOARD_IMPLEMENTATION_PLAN_2026-08-22.md)
govern its evidence. A failed gate blocks only that library unless it reveals
a shared risk.

### Security gate recorded after the validation install

Phase 0 baseline is verified at
`cc9c89d3300fd09c7cf9da413f85b172e32d6d62`. The isolated validation install
of `react-aria-components@1.20.0` did not change the web build budget before
import, but `npm audit --omit=dev` found three high findings through the
pre-existing path `prisma@7.9.1` → `@prisma/config@7.9.1` →
`deepmerge-ts@7.1.5` (`GHSA-ggr8-5vv4-36mx`). React Aria is not in that path.

No newer stable Prisma 7 patch is presently available, and an override to
`deepmerge-ts@8` is not an approved remediation because it breaks Prisma's
published dependency contract. The owner approved the following written,
time-boxed exception on 2026-08-22: until **2026-09-05** only, source merge,
local implementation, and verification of two non-financial React Aria adapters
is allowed: `BaseerCombobox` in the employee filter of HR “Leave & return”, and
`BaseerAriaDatePicker` in the leave/return date fields. They exclude production,
release acceptance, dashboard work, a third consumer, any API/RLS/permission/
financial change and financial business dates. The P1 remains open and this
exception does not reclassify it as resolved. Both pilots passed their adapter,
AR/EN RTL/LTR, keyboard/mobile, E2E and web-budget gates locally. The deployable
dependency graph is also clean when development and optional Prisma CLI peers
are omitted; the full build/migration graph is still tracked as P1.

Under the standing library-adoption authority, the same source-merge and local
verification boundary also covers the isolated non-financial RHF/Zod adapter
for a draft HR service cancellation reason. It has no financial values, API,
RLS or permission change, and it does not authorize release or production.

It also covers the local ECharts HR operational visualisation over the existing
server overview, with its matching HTML summary/table and dedicated lazy-size
gate. It is not a financial dashboard, reporting surface, or production claim.

**Closed Decision Intelligence scope / active Command Center scope:** Decision
Intelligence migration is closed at `97c99bf`. The same gated operating
authority now applies only to Command Center files recorded in the manifest. It
permits central-adapter migration in homogeneous batches after KPI/action
ownership, read-model, source, HTTP/RLS/RBAC, browser, accessibility and budget
gates pass.
It does not authorize a new library class, another module, a decision or
financial policy change, an external AI provider, or release/public production
acceptance. The Prisma P1 and its private-deployment risk acceptance remain
unchanged.

The durable remedy remains an official Prisma
patch, followed by a matched Prisma-stack upgrade and re-verification.
Automatic `npm audit fix --force` is explicitly forbidden here because its
proposed Prisma change is breaking.

The public API exposure has been reduced independently: the deployment now
builds a production-only `runtime` image that proves it excludes `prisma`,
`@prisma/config`, and `deepmerge-ts`, while an internal, read-only `migrate`
job holds the CLI and has only the database network. This is a containment
control, not a patch; it does not close the advisory in the build or migration
image and does not change the owner decision above.

### Superseding owner decision — private personal deployment

The owner has now approved
[the Prisma private-deployment risk acceptance](PRISMA_PRIVATE_DEPLOYMENT_RISK_ACCEPTANCE_2026-08-22.md).
It supersedes the earlier `2026-09-05` Prisma-only restriction: this advisory
no longer blocks completing modules, eligible library adoption, source merge,
or a private personal online deployment while the documented runtime boundary,
one-shot migration procedure, backup, audit and monitoring controls pass.

This does not mark the advisory fixed and does not waive any unrelated release,
financial, RLS, authorization, backup/restore or owner-acceptance gate. It is
automatically revoked for SaaS, commercial sale, public signup, public exposure
of the migration job, external Prisma-config input, or leakage of the affected
packages into the API runtime image.

## 2026-08-21 historical working-tree verification

This historical entry recorded then-uncommitted Reports and Operations candidates.
Both scopes have since been superseded by their dedicated closure records and
commits; it does not describe the current working tree or active priority.

Finance Gate B was restored by updating its direct fixture to inject
`FinanceCashPerformanceEventService` into both supplier-due and purchase-expense
services. Reports and Operations acceptance are now recorded in their closure
records.

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
