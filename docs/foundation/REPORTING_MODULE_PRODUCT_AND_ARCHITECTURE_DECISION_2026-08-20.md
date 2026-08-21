# BASEER ERP Reporting Module — Product and Architecture Decision

**Status:** R0-A policy, R0-B durable report-run, the first personal-cash-performance view, R1 Ledger Trial Balance, and bounded report-document print/Excel output are implemented locally. Later R1 accounting reports and large/asynchronous output jobs remain pending.
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
| `FinanceDailyFinancialSummary` and `FinanceDailySalesChannelSummary` | The currently implemented projection is server-maintained **for sales and sales channels**. | It can support explicitly labelled sales analysis only. It is not evidence for purchases, expenses, profit, P&L or cash flow until those facts exist and reconcile. |
| `FinanceAccountDailyBalance` and `FinanceAccountMonthlyBalance` | Account balances are projected from journal evidence and rebuildable. | Balance, movement and statement-style reports can be fast for long ranges without inventing a second ledger. |
| Output platform | Print/Excel are created from an authorised server snapshot with audit/idempotency. | The report module requests outputs; it does not print DOM or generate a client-side spreadsheet. |

## 3. Sources of truth and ownership

| Fact | Authoritative source | Report use |
| --- | --- | --- |
| Accounting position and account movement | `FinanceJournalEntry` + `FinanceJournalLine`, sealed posting and cancellation linkage | Financial statements, account drill-down and audit detail |
| Account balance at a date | Account daily/monthly balance projections, reconcilable to the journal | Fast balance and comparative reports |
| Sales and channel mix | Current daily sales and sales-channel summaries, reconciled to sales sources | Explicitly labelled operational sales analysis only |
| Paid purchases, paid expenses and profit | Ledger or a future, purpose-built reconciled fact/rollup | Not available from the current daily sales summary; never inferred from a sales chart |
| Personal cash performance (owner view) | Future cash-performance event model, populated atomically by actual collection/payment sources and reconciled to sealed ledger entries | A detailed, all-payment-methods inflow/outflow view. Its approved VAT-inclusive policy is separate from formal P&L and never inferred from balances. |
| Payables/commitments | Supplier-due source and settlement history | Separate outstanding-commitment reports |
| VAT/statutory amounts | Approved tax source rule and tax-bearing financial documents | Tax report only; never inferred from a chart or a management cash view |
| Payroll/HR financial amounts | Approved payroll/final-settlement journal sources | Financial reports may classify their posted effect; HR retains operational ownership |

Settings stay with their owner: company and tax setup stay in Administration, accounts/categories/vaults stay in Finance, operations stay in Operations, and HR records stay in HR. A report links to a source; it does not duplicate its editor.

## 4. Module sections and their goals

| Section | Goal | What it contains | What it deliberately does not contain |
| --- | --- | --- | --- |
| **0. Reports overview** | Give a fast, honest entry point. | Report catalogue and readiness/data-coverage notices. Saved documents remain in their own section. | Financial input fields, a second dashboard total, or automatic output history. |
| **1. Financial reports** | Explain money, position and movement. | A catalogue separated into **Ledger**, **Cash and Vaults**, **Supplier Commitments**, and later **Personal cash performance**; account balances/activity and drill-down to the unified register. | Editing of entries, suppliers, vaults or accounting settings. It does not claim a formal P&L until its account mapping and source facts are approved. |
| **2. VAT report** | Provide a governed tax view. | Taxable net, VAT, document counts, exceptions and the approved return period when the company tax rule supports it. | Tax-rate configuration or an unapproved statutory filing claim. |
| **3. Hajri Tax** | Host Hajri-specific approved tax/analysis products. | A catalogue entry and report only after its rule, authority, inputs and acceptance tests are approved. | Guessed tax logic, copied totals, or a placeholder that claims compliance. |
| **4. Report documents** | Let a user return to report documents they explicitly chose to retain. | Document history, status and the exact applied-filter snapshot. Nothing is added merely because a report was viewed: when creating an Excel or retained print output inside its originating report, the user may explicitly choose **Add to report documents**. This is not a print/export screen; those actions operate only on the originating report's frozen report run. | A second report catalogue, automatic history of every viewed report, printing the interactive application shell, screenshots, editable report numbers, or standalone export filters. |

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

Every report header and every exported output must disclose: accounting basis (ledger/accrual, personal-cash-performance, cash-and-vault, commitment, operational-sales-analysis, or tax), source kind (ledger or named projection), company, business timezone/date basis, currency, rounding rule, selected period, `asOf`, data coverage, cancellation treatment and reconciliation/freshness status. A number that is clickable must explain why it is present through its bounded evidence rows and applied filters.

## 6. Odoo reference — what Baseer adopts

The official Odoo accounting-report model exposes report filters such as date range, period comparison, draft entries, unreconciled entries, multi-company selection, unfold-all and optional zero-line hiding. Its menu separates statement reports, partner reports, taxes/fiscal and management reports. Its report definitions separate report, line, expression and column rather than hard-coding every total in a page. [Odoo `account_report.py`](https://github.com/odoo/odoo/blob/19.0/addons/account/models/account_report.py) and [Odoo accounting menus](https://github.com/odoo/odoo/blob/19.0/addons/account/views/account_menuitem.xml) are the reference sources.

Baseer adopts these principles:

1. a **report definition** identifies supported filters, columns, hierarchy and drill-down capability;
2. an **options/request contract** is validated on the server and includes company, period, comparison and view options;
3. a **report result** contains snapshot metadata, columns, hierarchical rows, totals, notices and bounded drill-down cursors;
4. ledger, cash-and-vault, supplier-commitment, operational-sales-analysis and tax catalogues remain separate so users do not confuse cash management, sales analysis, tax or statutory reporting;
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

The detailed, versioned policy and its R0-A implementation boundary are in [Reporting R0-A — Accounting Policy and Versioned P&L Mapping](REPORTING_R0_A_ACCOUNTING_POLICY_2026-08-20.md). It is deliberately limited to policy storage and guardrails: no report API, catalogue, UI, durable report run or export begins here.

No report contract is implemented before this policy is accepted and versioned. It defines:

1. **Ledger Trial Balance** as opening debit/credit, period debit/credit movement and closing debit/credit, with equal debit and credit totals for every eligible scope.
2. Separate temporal concepts: economic business date, fiscal-period boundary, posted watermark (what was known/committed), and report-run creation time. A current entry status is never used alone to rewrite a historical result.
3. The eligible-entry predicate and its version: sealed/posted source entries, cancellation entries and their original linkage, account status, system/opening accounts, zero balances and normal debit/credit presentation.
4. Cancellation semantics: a ledger report includes the original effect until its cancellation business date and includes the cancellation entry from that date. The technical cancellation line may be hidden from the commercial table only when a complete audit trail remains available.
5. Opening/closing policy, locked/reopened fiscal periods, retained-earnings policy and account-to-statement mapping versioning for any future statement.
6. R1 functional-currency restriction. Current Finance models do not support foreign-currency/FX/revaluation or consolidation; R1 is a single authorised company in its functional currency only.
7. **Formal P&L policy before formal P&L implementation:** a versioned account-to-statement-line mapping and presentation policy must identify revenue, cost of sales, operating income/expense, investing, financing, income tax and discontinued operations where applicable. The first formal P&L uses ledger/accrual evidence only; it does not use the sales summary as a proxy, count VAT as ordinary revenue/expense unless a specific approved policy requires it, or treat advances, due settlements or vault movement as operating expense merely because cash moved.
8. **Personal cash-performance policy:** the owner-approved [personal cash-performance decision](PERSONAL_CASH_PERFORMANCE_REPORT_DECISION_2026-08-20.md) defines the same future P&L screen's `شامل الضريبة` basis: actual external receipts/payments across all payment methods, gross VAT-inclusive rows when enabled, and a separately disclosed actual VAT-payment/refund line. It uses its own immutable event source and may not reuse or relax the formal P&L mapping.

The target P&L sequence is: revenue → cost of sales → gross profit → operating income/expense → operating profit → investing → profit before financing and income taxes → financing → income taxes → profit. It adopts the presentation direction of IFRS 18, but Baseer must not claim IFRS-compliant financial statements until its mapping, disclosure policy and coverage are formally approved.

### Gate R0-B — durable report-run consistency (before R1)

The implemented boundary is documented in [Reporting R0-B — Durable Report-Run Boundary](REPORTING_R0_B_DURABLE_REPORT_RUN_DECISION_2026-08-20.md). It adds the tenant/company ledger revision, persists it on every sealed journal entry/reversal, and provides an immutable, RLS-protected service-only `ReportRun`. It does not expose a report endpoint or UI.

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

The first R0 slice is implemented for the personal cash-performance definition: `GET /reports/catalogue` and `GET /reports/personal-cash-performance` require `reports.read`; `POST /reports/personal-cash-performance/coverage` requires the sensitive `reports.cash_performance.activate` capability. The API returns server-calculated rows/totals and a frozen `ReportRun` boundary only for a declared complete coverage interval. It returns the distinct states **no data**, **coverage incomplete** and **report not ready** without substituting zero, and the catalogue/API are company-scoped and capability-gated. UI, output jobs, common options/response schemas for all definitions, and R1 reports remain later work.

### Gate R1 — first safe accounting reports

The first item, [Ledger Trial Balance](LEDGER_TRIAL_BALANCE_R1_DECISION_2026-08-20.md), is implemented locally with a frozen ledger run, direct sealed-journal calculation, bounded evidence and contextual print/Excel actions. Continue, in this order: Account Balance, Account Activity, Ledger Vault Balance/Activity and Supplier-Dues Commitment Schedule. Each must use its R0-C behaviour contract, bounded drill-down and authorised output. The catalogue labels the basis visibly: **Ledger**, **Cash and Vaults**, and **Supplier Commitments**.

Do **not** implement a general financial overview, P&L, cash-flow statement or statutory VAT report in R1. They require approved account-to-statement mapping, normal-balance/opening/closing policy, retained-earnings treatment and correctly scoped fact/rollup sources. Supplier dues require their own source gate: no status/remaining-amount-at-read-time model may be used as a historical proof unless its due/payment/cancellation events reconcile to the control ledger at the report run revision.

### Gate R1.5 — operational sales analysis

Sales trend, channel mix and similar operating views may be delivered only from the current daily sales projections. They are visibly labelled **Operational sales analysis — not P&L, cash flow or VAT**. They may not be promoted to an all-finance overview until a purpose-built daily fact contains the named purchases, expenses, tax and profit measures and reconciles to the ledger.

### Gate R1.6 — الربح والخسارة المالي

The implemented [actual-financial-movements policy](PERSONAL_CASH_PERFORMANCE_EVENT_MODEL_DECISION_2026-08-20.md) reads the frozen sealed ledger directly: every line on a configured vault account is visible, including employee advances, payroll payments and final-settlement payments. Only an internal vault transfer is excluded. Source events enrich known VAT split information, but are no longer the completeness boundary; an unknown new financial source is shown under “other financial movements” rather than silently disappearing. The report is labelled **الربح والخسارة المالي** and exposes the owner-approved **شامل الضريبة** switch. The live view, bounded keyset evidence list, read-only source-journal dialog and contextual print/Excel actions are implemented.

### Gate R1.7 — report documents

Print and Excel are actions within the originating report, never a separate report type. Their rendering, download and document retention use one central report-document service/client; individual report screens supply only a `ReportRun` identifier and never render/export their own table data. An action renders only the selected `ReportRun` at its frozen ledger boundary. A user may explicitly choose **Add to report documents**; this stores an immutable server-built table snapshot under that user's Report Documents list. Viewing, filtering or drilling into a report never creates a document. The current bounded slice supports print preview and Excel only; it does not claim PDF generation, long-running jobs or multi-million-row exports.

**Accepted prototype experience (2026-08-20):** the report is a compact, centred hierarchy that uses the shared `BaseerPeriodFilter` and the `شامل الضريبة` view option, with no comparison checkbox or report search. Each detail row sits directly under its principal heading; the report contains no “operating/non-operating” partition or explanatory rows. Every displayed monetary value opens a centred, read-only evidence dialog. The browser does not compute financial facts: rows, totals, source list and navigation permission are supplied by the frozen report run/API. Header styling inherits the active application header theme; currency and posting-state disclosure belong to server-provided report metadata rather than fixed prototype controls.

### Gate R1.8 — internal VAT ledger analysis

The implemented **التقرير الضريبي الداخلي** is a read-only, frozen-ledger analysis of the `VAT_OUTPUT` and `VAT_INPUT` control accounts for the selected business-date period. It displays output VAT, input VAT, their net period difference, and VAT paid/refunded as separate settlement rows. A VAT settlement is deliberately excluded from output/input period tax so payment or refund does not rewrite the VAT created by invoices and purchases. Every non-zero row can open its bounded ledger evidence and source journal; print, Excel and explicit saving use the same central `ReportRun` output path as the other reports.

This is not a Saudi VAT return, a taxable-supplies calculation, a document-count/exceptions register, or an assertion of ZATCA/VAT compliance. Those remain Gate R3 and require an approved tax-source mapping, return-rule policy and acceptance tests.

### Gate R2 — formal P&L, position and cash flow

**مؤجل وغير مطلوب للاستخدام الشخصي الحالي** بموجب [قرار نطاق التقارير للاستخدام الشخصي](PERSONAL_REPORTING_SCOPE_DECISION_2026-08-20.md). لا يُبنى تقرير ربح وخسارة استحقاقي أو قائمة مركز مالي/ميزانية عمومية دفترّية أو واجهة أو مخرج لأي منها دون قرار مالك جديد. تبقى خريطة R0-A كقدرة مستقبلية محفوظة فقط. إذا تغيّر القرار، يطبق P&L بعد سياسة العرض/الخريطة ذات الإصدار، لقطة تاريخية، اختبارات التغطية والإلغاء، ومطابقة مباشرة للدفتر. وتحتاج قائمة المركز المالي إلى خريطة عرض حسابات ذات إصدار وسياسة صريحة للأصول والالتزامات وحقوق الملكية والأرباح المبقاة؛ كما تحتاج التدفقات النقدية إلى سياسة مستقلة، فرصيد الخزينة ليس قائمة تدفقات نقدية.

### Gate R3 — VAT report

Implement only after tax source mapping and Saudi return-rule acceptance are documented. The report remains read-only and must distinguish management cash reporting from statutory treatment.

### Gate R4 — Hajri Tax

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
- A formal P&L is released only when every displayed line reconciles to the frozen ledger run through its approved mapping version, including a documented treatment for VAT, cancellations, opening/closing and accounts without activity.
- Personal cash performance is released only when its gross/net rows, VAT paid/refund rows, partial settlements and cancellation dates reconcile to the same frozen cash-performance event run; source coverage must explicitly include every selected payment method.

## 11. Independent review basis — 2026-08-20

This revision was checked against the current Baseer schema/services and the following primary references:

- [IFRS 18 — Presentation and Disclosure in Financial Statements](https://www.ifrs.org/issued-standards/list-of-standards/ifrs-18-presentation-and-disclosure-in-financial-statements/) supports the future P&L categories and defined subtotals. IFRS 18 is effective for annual periods beginning on or after 1 January 2027; this document therefore adopts its presentation direction without claiming compliance.
- [IAS 7 — Statement of Cash Flows](https://www.ifrs.org/issued-standards/list-of-standards/ias-7-statement-of-cash-flows/) confirms that cash flow is a separate operating/investing/financing statement, not a vault-balance report.
- [Odoo accounting report model](https://github.com/odoo/odoo/blob/19.0/addons/account/models/account_report.py) supports report definitions with centrally controlled date, comparison and view options; it is a product reference, not Baseer source code.
- [PostgreSQL transaction isolation documentation](https://www.postgresql.org/docs/current/transaction-iso.html) supports the need for a stable snapshot while reading; Baseer's durable ledger revision/ReportRun is the product-level extension needed for paged and long-running output.
- [ZATCA VAT implementing regulations](https://zatca.gov.sa/ar/RulesRegulations/Taxes/Pages/VATImplementingRegulations.aspx) confirm that Saudi VAT requires its own governed rule path; it is not inferred from management views.

## 12. Explicit exclusions for the first release

- custom formula authoring by users;
- a generic drag-and-drop BI tool;
- unapproved tax/legal filing or Hajri Tax calculation;
- multi-company consolidation until consolidation rules, currencies and eliminations are approved;
- a report copy of Finance, Operations or HR editors.
