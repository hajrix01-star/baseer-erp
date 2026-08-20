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
| **1. Financial reports** | Explain money, position and movement. | Management performance, cash movement, account balances, account activity, supplier-dues commitments and drill-down to the unified register. | Editing of entries, suppliers, vaults or accounting settings. |
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

The central `BaseerFilterBar`, `BaseerPeriodFilter`, `DataTable`, `BaseerDialog`, `BaseerOutputActions` and lazy workspaces are mandatory. No report creates a local styling system.

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

## 8. Scale and reliability requirements

1. Interactive report requests must have a default bounded period; broad history is explicit.
2. Lists and drill-downs use keyset pagination, not `OFFSET` or unbounded `take` values.
3. Long-range summary totals read durable daily/monthly projections or controlled rollups, never repeat full journal scans on every refresh.
4. Search/select filters with large dimensions are server-backed autocomplete.
5. A report response includes `asOf`, selected period, source coverage and cancellation treatment.
6. Exports over the interactive threshold run from a server snapshot/job and preserve applied filters, issuer and generated time.
7. Every projection is rebuildable and must reconcile to active ledger/source evidence.

## 9. Delivery sequence and gates

### Gate R0 — foundation (first)

Create the report catalogue/definition contract, central options parser, response/snapshot contract, capability map, source-coverage metadata and report-output registration. Deliver the empty module shell only after it explains readiness and no-data states honestly.

### Gate R1 — management and accounting reports

Implement, in this order: financial overview, account balances/activity, paid cash movement and supplier-dues commitments. Each must support period/comparison where meaningful, bounded drill-down and A4/XLSX output.

### Gate R2 — VAT report

Implement only after tax source mapping and Saudi return-rule acceptance are documented. The report remains read-only and must distinguish management cash reporting from statutory treatment.

### Gate R3 — Hajri Tax

Begin only with a separately approved source/rule/ownership document. It is not inferred from the name or copied from a different product.

## 10. Acceptance criteria

- A report total reconciles to the approved source for a selected company and period.
- Cancelled accounting operations have zero ordinary economic effect yet remain traceable in audit drill-down.
- Supplier dues follow the approved cash-basis commitment rule.
- Company and permission boundaries are enforced in catalogue, data, drill-down and output.
- Comparisons use disclosed periods and server-calculated values.
- Page 1 and deep drill-down pages retain stable keyset order at high volume.
- Preview/A4/XLSX contain server snapshot metadata and exactly the applied filters.
- Browser code has no financial write path or independently computed financial total.

## 11. Explicit exclusions for the first release

- custom formula authoring by users;
- a generic drag-and-drop BI tool;
- unapproved tax/legal filing or Hajri Tax calculation;
- multi-company consolidation until consolidation rules, currencies and eliminations are approved;
- a report copy of Finance, Operations or HR editors.
