# BASEER ERP Reporting Module — Product and Architecture Decision

**Status:** Proposed for owner approval before implementation.  
**Date:** 2026-08-20  
**Scope:** The `reports` module only. It reads governed facts; it never creates, edits, posts, cancels, or recalculates a financial source record in the browser.

## 1. Why the module exists

Reports answer a question from already-governed data. They do not become a second finance system, a second operational register, or a place to configure tax/company settings.

The module has four jobs:

1. show an owner a clear, period-based picture of performance and financial position;
2. let an accountant trace every total to its source movement and ledger evidence;
3. provide controlled statutory/tax views only where the rule and source are approved;
4. produce an immutable, server-generated preview/export when a report must be shared.

## 2. Existing documented foundation

| Existing decision or capability | What it already guarantees | Consequence for Reports |
| --- | --- | --- |
| `ANALYTICS_READ_MODELS_GATE_A_DECISION.md` | Financial dashboard/report amounts are server-owned and reconcile to active sealed journal evidence. | Reports read projections and ledger facts; the browser never calculates money. |
| `SUPPLIER_DUES_CASH_BASIS_REPORTING_GATE_A_DECISION.md` | Unpaid supplier dues are commitments, not ordinary paid-expense/cash totals. Partial settlement is reported on its payment date. | Supplier dues get a separate commitment report; they must not silently inflate profit/cash totals. |
| Finance journal, documents and cancellation model | Posted source entries are immutable; an accounting cancellation preserves the original and creates the cancelling evidence. | Default commercial reports exclude cancelled economic effect while audit detail retains the original → cancellation trail. |
| `FinanceDailyFinancialSummary` and `FinanceDailySalesChannelSummary` | Daily operational financial projections are server-maintained. | Overview trends and sales/channel analysis read these models rather than raw UI aggregation. |
| `FinanceAccountDailyBalance` and `FinanceAccountMonthlyBalance` | Account balances are projected from journal evidence and rebuildable. | Balance, movement and statement-style reports can be fast for long ranges without inventing a second ledger. |
| Output platform | Print/Excel are created from an authorised server snapshot with audit/idempotency. | The report module requests outputs; it does not print DOM or generate a client-side spreadsheet. |

## 3. Sources of truth and ownership

| Fact | Authoritative source | Report use |
| --- | --- | --- |
| Accounting position and account movement | `FinanceJournalEntry` + `FinanceJournalLine`, sealed posting and cancellation linkage | Financial statements, account drill-down and audit detail |
| Account balance at a date | Account daily/monthly balance projections, reconcilable to the journal | Fast balance and comparative reports |
| Sales, paid purchases, paid expenses and channel mix | Daily financial and sales-channel summaries, reconciled to sources | Management overview and trend reports |
| Payables/commitments | Supplier-due source and settlement history | Separate outstanding-commitment reports |
| VAT/statutory amounts | Approved tax source rule and tax-bearing financial documents | Tax report only; never inferred from a chart or a management cash view |
| Payroll/HR financial amounts | Approved payroll/final-settlement journal sources | Financial reports may classify their posted effect; HR retains operational ownership |

Settings stay with their owner: company and tax setup stay in Administration, accounts/categories/vaults stay in Finance, operations stay in Operations, and HR records stay in HR. A report links to a source; it does not duplicate its editor.

## 4. Module sections and their goals

| Section | Goal | What it contains | What it deliberately does not contain |
| --- | --- | --- | --- |
| **0. Reports overview** | Give a fast, honest entry point. | Period status, report catalogue, recently generated outputs, readiness/data-coverage notices and saved report views. | Financial input fields or a second dashboard total. |
| **1. Financial reports** | Explain money, position and movement. | A catalogue separated into ledger statements, management-cash reports and supplier commitments; account balances/activity and drill-down to the unified register. | Editing of entries, suppliers, vaults or accounting settings. It does not claim a P&L until its account mapping and source facts are approved. |
| **2. VAT report** | Provide a governed tax view. | Taxable net, VAT, document counts, exceptions and the approved return period when the company tax rule supports it. | Tax-rate configuration or an unapproved statutory filing claim. |
| **3. Hajri Tax** | Host Hajri-specific approved tax/analysis products. | A catalogue entry and report only after its rule, authority, inputs and acceptance tests are approved. | Guessed tax logic, copied totals, or a placeholder that claims compliance. |
| **4. Print & export** | Make a report shareable and reproducible. | Server preview, A4/PDF-compatible print, XLSX export, output history and applied-filter snapshot. | Browser `window.print()`, screenshots, or editable report numbers. |

## 5. User experience contract

The visual reference is the useful part of Odoo's reporting experience, not a literal copy of its screens or code:

- report catalogue first, then a single report canvas;
- one compact, sticky filter bar: company context, period, comparison, view options and search only when the report supports it;
- comparison is explicit: current period, comparison period, value difference and percentage difference; no hidden comparison math;
- hierarchical rows may unfold on demand; totals are visible at every opened level; zero rows are hidden only when the report explicitly allows it;
- each amount can drill into a bounded, server-paged evidence list, then open the original operation or financial movement file;
- mobile keeps filters in a compact menu and shows a concise table/card form; it never squeezes a desktop ledger into unreadable columns;
- report-specific actions are limited to **open source**, **print/export**, and permitted saved view actions. There is no financial write button.

The central `BaseerFilterBar`, `BaseerPeriodFilter`, `DataTable`, `BaseerDialog`, `BaseerOutputActions` and lazy workspaces are mandatory. No report creates a local styling system. A filter bar is central in behaviour, not identical in every report: company context and period are always explicit, while comparison, search and view options appear only when the report definition supports them.

Every report header and every exported output must disclose: accounting basis (ledger/accrual, management cash, commitment, or tax), source kind (ledger or named projection), company, business timezone/date basis, currency, rounding rule, selected period, `asOf`, data coverage, cancellation treatment and reconciliation/freshness status. A number that is clickable must explain why it is present through its bounded evidence rows and applied filters.

## 6. Odoo reference — what Baseer adopts

The official Odoo accounting-report model exposes report filters such as date range, period comparison, draft entries, unreconciled entries, multi-company selection, unfold-all and optional zero-line hiding. Its menu separates statement reports, partner reports, taxes/fiscal and management reports. Its report definitions separate report, line, expression and column rather than hard-coding every total in a page. [Odoo `account_report.py`](https://github.com/odoo/odoo/blob/19.0/addons/account/models/account_report.py) and [Odoo accounting menus](https://github.com/odoo/odoo/blob/19.0/addons/account/views/account_menuitem.xml) are the reference sources.

Baseer adopts these principles:

1. a **report definition** identifies supported filters, columns, hierarchy and drill-down capability;
2. an **options/request contract** is validated on the server and includes company, period, comparison and view options;
3. a **report result** contains snapshot metadata, columns, hierarchical rows, totals, notices and bounded drill-down cursors;
4. statement/management/commitment/tax catalogues remain separate so users do not confuse cash management with tax or statutory reporting;
5. report output uses the central snapshot platform.

Baseer deliberately differs where its policies require it: single authorised company context by default, only posted/cancelled accounting evidence in financial reports, no browser formula engine, no editable report expressions by ordinary users, and no claim of Saudi statutory compliance without an approved rule.

## 7. Central report contract

Every implemented report must declare:

- `reportCode`, title, owner module and required capability;
- allowed dimensions/filters and default period (interactive views require a bounded period);
- supported comparison modes and exact comparison semantics;
- source models/projections, reconciliation rule and freshness/coverage notice;
- row hierarchy, column definitions, money/currency rules and drill-down target;
- output formats and snapshot fields;
- maximum interactive range, keyset/page policy and asynchronous-export threshold.

The server returns all totals, comparison values and notices. A client can format, sort only a received page where allowed, unfold a provided hierarchy and request the next evidence page; it cannot calculate a financial total.

The report snapshot contract additionally requires `sourceCutoff`/watermark, projection version and freshness state, report-definition version, account-mapping version where applicable, reconciliation receipt/checksum, maximum interactive period/rows, asynchronous-export threshold, and explicit cancellation semantics. `asOf` by itself is not sufficient to keep a total, its drill-down pages and its export mutually consistent while posting continues.

## 8. Scale and reliability requirements

1. Interactive report requests must have a default bounded period; broad history is explicit.
2. Lists and drill-downs use keyset pagination, not `OFFSET` or unbounded `take` values.
3. Long-range summary totals read durable daily/monthly projections or controlled rollups, never repeat full journal scans on every refresh. A report may use a projection only when that projection actually contains its named facts: the current daily financial summary is a sales summary, not a general purchases/expenses/profit fact.
4. Search/select filters with large dimensions are server-backed autocomplete.
5. A report response includes `asOf`, selected period, source coverage and cancellation treatment.
6. Exports over the interactive threshold run as an asynchronous, chunked server job. They preserve applied filters, issuer, generated time, watermark and checksum; they do not load millions of rows into one transaction or inline snapshot payload.
7. Every projection is rebuildable and must reconcile to active ledger/source evidence.

## 9. Delivery sequence and gates

### Gate R0-A — approved accounting reporting policy (before API/UI)

No report contract is implemented before this policy is accepted and versioned. It defines:

1. **Ledger Trial Balance** as opening debit/credit, period debit/credit movement and closing debit/credit, with equal debit and credit totals for every eligible scope.
2. Separate temporal concepts: economic business date, fiscal-period boundary, posted watermark (what was known/committed), and report-run creation time. A current entry status is never used alone to rewrite a historical result.
3. The eligible-entry predicate and its version: sealed/posted source entries, cancellation entries and their original linkage, account status, system/opening accounts, zero balances and normal debit/credit presentation.
4. Cancellation semantics: a ledger report includes the original effect until its cancellation business date and includes the cancellation entry from that date. The technical cancellation line may be hidden from the commercial table only when a complete audit trail remains available.
5. Opening/closing policy, locked/reopened fiscal periods, retained-earnings policy and account-to-statement mapping versioning for any future statement.
6. R1 functional-currency restriction. Current Finance models do not support foreign-currency/FX/revaluation or consolidation; R1 is a single authorised company in its functional currency only.

### Gate R0-B — durable report-run consistency (before R1)

`asOf` is a business meaning, not a concurrency mechanism. The platform must implement a durable `ReportRun`/snapshot with a company ledger revision or equivalent monotonically committed watermark allocated in the same transaction as every posting and accounting cancellation.

Each run persists canonical options, company scope, `economicAsOfDate`, ledger revision/watermark, eligible-entry-predicate version, projection version/watermark when used, report-definition version, account-mapping version where applicable, source coverage, checksum, creator, expiry and output-job linkage. Every page of a drill-down and every export is constrained to the same run. A projection may serve a run only when it is reconciled at or before that run's revision.

The output platform must gain a report-output job contract before any long export claim: bounded inline previews are allowed; large XLSX/PDF-compatible output streams in chunks from the frozen report run, supports retry/idempotency/failure status, stores the filter/definition/revision checksum, and follows retention/cleanup policy. It must not load millions of rows into a single in-memory JSON snapshot or transaction.

### Gate R0-C — R1 behaviour matrix (before catalogue/API)

| Report | Basis and primary source | Time model | Comparison in R1 | Presentation |
| --- | --- | --- | --- | --- |
| Ledger Trial Balance | Ledger entries/lines and approved account hierarchy | End of fiscal period with opening + movement + closing | Optional end-of-period comparison after the initial correctness release | Hierarchical account tree; no unfold-all |
| Account Balance | Ledger/account-balance projection reconciled to ledger | End of period or `asOf` | Equivalent `asOf`/period only | One account balance card/table |
| Account Activity / Statement | Ledger lines | Explicit date range | None at row level; summary comparison may follow later | Keyset-paged movement table |
| Ledger Vault Balance / Activity | Account-backed vault ledger account | `asOf` and/or explicit activity range | Off by default; no cash-flow claim | Ledger balance and activity, with last reconciliation/count shown separately |
| Supplier-Dues Commitment Schedule | Immutable due/payment/cancellation events plus control-ledger reconciliation | Outstanding `asOf`, due-date aging and paid-in-period as separate measures | Off by default | Paged schedule and aging buckets; not a general AP/AR subledger |

Every R1 report declares the exact comparison behaviour rather than using “where meaningful”. The catalogue groups them visibly as **Ledger**, **Cash and Vaults**, and **Supplier Commitments**. Comparison starts off, then offers simple presets (previous period / same period last year) only for a report that supports them. The hierarchy is a report capability, not a template: Trial Balance may unfold; account activity and supplier commitments remain tables.

### Gate R0 — technical foundation

After R0-A/R0-B/R0-C are accepted, create the report catalogue/definition contract, central options parser, durable report-run API, response contract, capability map, source-coverage metadata, report-output job registration and empty module shell. The shell explains the distinct states **no data**, **coverage incomplete** and **report not ready** honestly; it hides reports the current user is not authorised to read.

### Gate R1 — first safe accounting reports

Implement, in this order: Ledger Trial Balance, Account Balance, Account Activity, Ledger Vault Balance/Activity and Supplier-Dues Commitment Schedule. Each must use its R0-C behaviour contract, bounded drill-down and authorised output. The catalogue labels the basis visibly: **Ledger**, **Cash and Vaults**, and **Supplier Commitments**.

Do **not** implement a general financial overview, P&L, cash-flow statement or statutory VAT report in R1. They require approved account-to-statement mapping, normal-balance/opening/closing policy, retained-earnings treatment and correctly scoped fact/rollup sources. Supplier dues require their own source gate: no status/remaining-amount-at-read-time model may be used as a historical proof unless its due/payment/cancellation events reconcile to the control ledger at the report run revision.

### Gate R2 — VAT report

Implement only after tax source mapping and Saudi return-rule acceptance are documented. The report remains read-only and must distinguish management cash reporting from statutory treatment.

### Gate R3 — Hajri Tax

Begin only with a separately approved source/rule/ownership document. It is not inferred from the name or copied from a different product.

## 10. Acceptance criteria

- A report total reconciles to the approved source for a selected company and period, and the same total reconciles after rebuilding its projection.
- Cancellation behaviour is tested for a date before cancellation, a range containing only the source, a range containing only the cancellation, and a range containing both. Historical `asOf` reporting must retain the original effect until the cancellation business date.
- Supplier dues follow the approved cash-basis commitment rule.
- Company and permission boundaries are enforced in catalogue, data, drill-down and output.
- Comparisons use disclosed periods and server-calculated values.
- Page 1 and deep drill-down pages retain stable keyset order at high volume under concurrent posting/cancellation, using the same report watermark.
- Preview/A4/XLSX contain server snapshot metadata and exactly the applied filters.
- Browser code has no financial write path or independently computed financial total.
- A report has an approved source/index plan and measured acceptance: representative data at 100k then at least 1m journal entries/lines across five or more years, `EXPLAIN ANALYZE`, p95/timeout/lock-wait thresholds, RLS checks and reconciliation/rebuild checksum. Partitioning is not a substitute for this evidence.

## 11. Explicit exclusions for the first release

- custom formula authoring by users;
- a generic drag-and-drop BI tool;
- unapproved tax/legal filing or Hajri Tax calculation;
- multi-company consolidation until consolidation rules, currencies and eliminations are approved;
- a report copy of Finance, Operations or HR editors.
