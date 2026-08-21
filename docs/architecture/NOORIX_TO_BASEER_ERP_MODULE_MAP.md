# Noorix to Baseer ERP — Proposed Module Map
## Current navigation note — 2026-08-17

This is historical comparison/migration evidence, not navigation authority. Baseer V3 places Daily Sales, Purchases and Expenses & Obligations in Operations; Finance remains the financial-record and reporting authority. See BASEER_ERP_USER_MODULES_V3.md.


**Status:** Portfolio discovery baseline — not a build authorization  
**Source reviewed:** Noorix application module catalogue, route/screen structure, backend module catalogue, current Baseer transition surfaces, and the finance/HR/operations/admin discovery already recorded.  
**Rule:** This map groups capabilities by their business responsibility. It does not copy Noorix navigation, code, or database boundaries.

## 1. Reading the map correctly

Noorix has grown around screens and historical routes: `Sales`, `Invoices`, `Purchases`, `Treasury`, `Reports`, `HR`, `OrdersV4`, `Settings`, `HajriTax`, and others. Baseer ERP will be one modular application with a central platform kernel and coherent modules.

This is a portfolio map, not a claim that every workflow has already been understood. Before building any row, the team must complete the Noorix Discovery Record and workflow/parity gates defined in `../governance/NOORIX_DISCOVERY_AND_PARITY_STANDARD.md`.

## 2. Proposed Baseer ERP module navigation

```text
Baseer ERP
├─ Command Center
├─ Finance & Accounting
│  ├─ Finance dashboard
│  ├─ Daily sales
│  ├─ Treasury & payments
│  ├─ Expenses & recurring commitments
│  ├─ Purchases & supplier invoices
│  ├─ Suppliers and accounting categories
│  ├─ Liabilities & loans
│  ├─ Ledger, accounts, and financial periods
├─ Operations & Inventory
│  ├─ Item catalog and units
│  ├─ Locations and inventory
│  ├─ Internal registration
│  ├─ Purchase requests and custody
│  ├─ Receipts and operational documents
│  ├─ Raw materials, menu products and recipes
│  └─ Inventory, counts and operational activity
├─ People
│  ├─ Employee directory and profiles
│  ├─ Employment records and services
│  ├─ Leave and return
│  ├─ Compensation, advances, and payroll
│  ├─ Residency and employee documents
│  └─ Termination and final settlement
├─ Assets & Warranty
├─ Documents
├─ Reports & Analytics
├─ Tax & Compliance
├─ Administration
└─ Smart Assistant

Platform kernel (not a user business module): authentication, sessions, companies, users, permissions, themes, locale, business date, audit, idempotency, serials, files, notifications, observability, backup primitives, and migration tools.
```

## 3. Legacy-to-new module table

| Noorix current section / capability | Proposed Baseer ERP module | What exists under the new module | Transition decision |
| --- | --- | --- | --- |
| Owner dashboard, Dashboard, executive KPIs, special days, Saudi occasions, school calendar | **Command Center** | Executive snapshot; accounting-truth indicators; operational activity; alerts; Saudi calendar/occasions; time line; cross-module decisions | Rebuild as a read-only server projection. It does not own accounting, sales, HR, or calendar data. |
| Daily Sales, shifts, channels, vault allocation, customer count, sales sharing/export | **Finance & Accounting → Daily sales** | Daily entry; shifts; channels; sales history; edit/cancel; serials; vault allocation; day report; print/export | Preserve the end-of-day summary workflow and its serial/accounting/VAT effect; rebuild native. |
| Treasury, vaults, vault transactions, vault transfer/reversal/reorder, balance as-of | **Finance & Accounting → Treasury & payments** | Vault master; payment channels; period movement; balance as-of; transfer; reversal; statement; reconciliation link | Preserve permitted negative balances. Separate period movement from cumulative balance. |
| Expenses, expense lines, fixed/variable/recurring expenses, batches, payment history | **Finance & Accounting → Expenses & commitments** | Expense configuration; one-time payment; recurring payment; batches; history; edit/cancel/reversal; supplier/category/vault links | Rebuild all commands and reports; no browser totals. |
| Loans, loan schedules, loan payments | **Finance & Accounting → Liabilities & loans** | Liability recognition; schedule; payment; balance; history | Owner policy: keep each loan as one inclusive commitment; do not split principal, interest, or fees. |
| Invoices list, cash report, day close, attachments, import/export/print | **Finance & Accounting → Purchases & supplier invoices** | Supplier invoice list/detail; document attachment; cash/day report; edit/cancel; print/export | Invoices are financial documents, not a generic Documents module. |
| Purchase batches, purchase debts, supplier debt import | **Finance & Accounting → Purchases & supplier invoices** | Batch purchases; drafts; supplier payable/debt promotion; correction/cancel; import | Preserve workflow after exact discovery of statuses and serials. |
| Suppliers, supplier profile, supplier import/export, supplier directory | **Finance & Accounting → Suppliers** | Supplier master; profile; classification; import/export; payable drill-down | Vendor master belongs with purchasing/payables. |
| Accounting categories, accounts, ledger, financial core, accounting initialization, fiscal periods | **Finance & Accounting → Accounting core** | Chart of accounts; classifications; canonical ledger; periods/filter policy; posting/reversal; audit; central serials | New core honors approved policy: no automatic close, historical owner amendment/cancel, retained cancellation, gross management display. |
| OrdersV4 catalog, items, units, locations, stock, documents, requests, purchase receipt, counts, operational reports | **Operations & Inventory** | Item catalog; units; locations; stock availability; requests; purchase receipt; cycle count; correction; operational activity | Rebuild by operational workflow. Ledger posting remains through Finance core; inventory never owns a parallel ledger. |
| OrdersV4 purchase requests and approvals | **Operations & Inventory → Purchase requests and custody** | Multi-line purchase request; local or delegated execution; custody, receipt, correction and audit | No approval or rejection workflow is part of the request. The request waits for factual receipt; keep it distinct from supplier invoice/payment. |
| OrdersV4 inventory documents and operational reports | **Operations & Inventory → Operational documents & activity** | Stock documents; movement history; count/correction evidence; read-only activity reports | Documents remain linked to their operational source. |
| HR main workspace, staff list, employee profile, salary/allowances, career movement | **People → Directory & employment** | Employee master; profile; employment record; compensation context; career events | Preserve business data after deeper workflow discovery; calculations move to server. |
| Leave, return from leave, settlement | **People → Leave & return** | Leave request/record; history; return; approved settlement lifecycle and audit | Rebuild only after full financial/settlement parity; do not hand off silently. |
| Payroll runs, payroll payment, attendance, manual entries, deductions, salary slips | **People → Payroll & compensation** | Payroll configuration; month preview; run; approvals/issue; payment; reconciliation; slips | High-risk vertical module. All payroll calculations and finance posting stay server-side. |
| Employee advances | **People → Compensation & advances** | Advance issue; balance; scheduled settlement policy; history | Uses Finance core for actual postings; no separate employee ledger truth. |
| Residency, residency invoice/void | **People → Residency & compliance records** | Residency records; renewal; invoice/void integration; alerts/documents | Finance owns the invoice; People owns residency workflow. |
| Employee records, employee documents, certificates/contracts/final settlement print | **People → Employee records & documents** | Metadata; secure attachments; document lifecycle; certified print/export | Generic storage comes from Documents platform; People owns access/purpose. |
| Employee services | **People → Employment services** | Service requests/history/category-specific operations | Keep as a bounded People capability after discovery. |
| Employee termination/final settlement | **People → Termination** | Termination record; final settlement workflow; financial handoff; documents/audit | Requires explicit Finance contract, not UI-only calculation. |
| Asset register, warranty lines, asset completion from invoice, warranty queue | **Assets & Warranty** | Asset master; acquisition link; depreciation policy if approved; warranty lifecycle; alerts; attachments | Separate module; Finance provides acquisition/accounting reference, Operations may provide custody. |
| Commercial document index, generic attachments | **Documents** | Cross-module document index; metadata; secure storage; attachment access; retention; print/export references | Does not own financial invoice or HR workflow; it indexes and safely serves their documents. |
| General report, P&L, period analytics, cost-accounting apps, exports/print | **Reports & Analytics** | Read-only financial/operational/HR reports; period filters; timeline; export/print; drill-down | Reports never become a second source of truth and never calculate in the browser. |
| Report Tax VAT | **Tax & Compliance → VAT report** | Gross-default management view; server-side tax separation; VAT disclosure/export; reconciliation | Gross default is 115; separate mode exposes 100 + 15 from the server. |
| HajriTax declarations, quarter/year registry, disclosure editor, import/export, payment simulation | **Tax & Compliance → Filings & declarations** | Tax period registry; official declaration workflow; controlled adjustments; filing evidence; payment tracking | Separate compliance workflow, fed by authoritative finance documents—not browser-local drafts. |
| VAT planning | **Tax & Compliance → Planning** | Upcoming periods, filing readiness, obligations, reminders | Planning does not modify ledger truth. |
| Settings: companies, company profile, ordering/archive, tax registration/settings | **Administration → Companies & policy** | Company lifecycle; profile; business policy; tax registration; operating settings | Central company model for all modules. Archive rather than destructive deletion. |
| Settings: users, roles, memberships, permissions | **Administration → Identity & access** | Users; company membership; roles; permissions; lifecycle; session invalidation | Platform-backed, centrally applied to all modules. |
| Settings: branding/theme preview | **Administration → Appearance** | Central theme tokens; logo/branding policy; bilingual visual settings | Theme is visual only; no mode-specific behavior. |
| Settings: insight thresholds | **Administration → Insight policy** | Threshold configuration that drives server-generated alerts | Settings only; Command Center/Reports consume results. |
| Settings: company logical backup, system backup, restore/import | **Administration → Backup & recovery** | Company logical backup; verification; schedule; safe import-as-new-company; control-plane system backup | Separate company scope from platform/system scope; no hidden broad restore. |
| Settings: AI diagnostics | **Administration → Integrations & diagnostics** | Health, connection configuration, safe diagnostic receipts | No secret exposure to UI. |
| Login, JWT/auth, owner tooling, platform admin dashboard | **Platform kernel / Administration** | Authentication; sessions; account recovery; platform-only operations | Not a business module; central guard for every module. |
| Smart Chat / Gemini questions, uploads, finance/HR/order answer handlers | **Smart Assistant** | Permission-filtered assistant; approved read tools; safe upload/context policy; no direct uncontrolled writes | Build only after source modules expose narrow, auditable contracts. |
| Theme preview / UI laboratory | **Design system development tooling** | Internal component/theme test area only | Not a production ERP module or user navigation item. |
| HBC settlements / external business-control integration | **Integration boundary — discovery required** | Explicit adapter, import/export, reconciliation, and ownership contract if retained | Do not place in a user module until its source of truth and operational role are confirmed. |
| Full backup/export/import and final historical data move | **Migration & cutover tooling** | Read-only export; mapping; staging import; reconciliation; final cutover | Not an everyday ERP module. It is a controlled project capability. |

## 4. Important boundary decisions

1. **Finance owns money and financial documents.** Supplier invoices, purchases, treasury, expenses, loans, ledger, and payment effects live together. Documents only stores/indexes attachments.
2. **Operations owns quantity and workflow.** It may cause a financial posting through an approved Finance contract, but never creates a competing ledger.
3. **People owns employee workflow.** It invokes Finance only for approved financial events such as payroll/advance/settlement.
4. **Reports only read.** They consume authoritative server projections and do not create financial truth.
5. **Tax & Compliance owns filing workflow, not accounting truth.** It reads approved documents/ledger classifications and records disclosure/filing evidence.
6. **Assets is a separate module.** It links to an acquisition/invoice but does not get buried under Finance.
7. **Administration and platform kernel are central.** Company, users, roles, themes, business date, files, audit, serials, and backup policies apply across every module.

## 5. What is not found as a complete Noorix module

The portfolio does not currently establish a complete native equivalent for CRM, customer master management, POS order lines, e-commerce, manufacturing, projects, or general procurement approval beyond the current request/order capabilities. These are **not** invented as Baseer ERP scope; they remain future discovery decisions.

## 6. Recommended build order — subject to single-module policy

1. Platform foundation (central kernel; not a business module).
2. Finance & Accounting — built fully as the first business module because it supplies canonical financial truth.
3. Command Center — rebuilt only after official Finance/Operations/People read contracts exist; it remains read-only.
4. Operations & Inventory.
5. People.
6. Assets & Warranty.
7. Documents.
8. Reports & Analytics.
9. Tax & Compliance.
10. Administration and Smart Assistant capabilities not already delivered by the platform foundation.

The delivery register may have only one active scope. This ordering is a roadmap, not permission to start multiple modules.
