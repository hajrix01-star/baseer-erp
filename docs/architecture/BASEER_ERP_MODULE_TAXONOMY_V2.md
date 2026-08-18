# Baseer ERP Module Taxonomy v2

**Status:** Proposed architecture — supersedes the broad grouping in `NOORIX_TO_BASEER_ERP_MODULE_MAP.md` for new navigation and module-boundary decisions.  
**Basis:** Noorix portfolio review, HajriTax review, and comparison with mature modular ERP application structures.

## 1. The correction

The earlier proposal grouped too many different jobs under broad labels such as **Finance** and **Operations**. That is simple on a slide but not ideal for a real ERP: daily sales, purchase workflow, expense control, treasury, accounting, inventory, tax filing, and reports have different users, screens, states, permissions, and source data.

The professional model is not “one database section per app” and not “dozens of disconnected applications.” It is:

> **One Baseer ERP platform and one central database; several focused modules; one shared accounting, identity, company, date, audit, file, and theme kernel.**

This follows the useful distinction visible in mature ERPs: accounting, purchase, inventory, employees, payroll, documents, and productivity are separate applications that integrate through central records—not through duplicate databases. Odoo’s official application structure separates Accounting/Invoicing and Expenses from Purchase and Inventory, while also treating Documents, Employees, Payroll, and Dashboards as distinct application areas. [Odoo application structure](https://www.odoo.com/documentation/19.0/applications.html) ERPNext similarly describes accounting as the central financial truth while procurement, stock, assets, and HR create approved accounting effects through it. [ERPNext accounting overview](https://docs.frappe.io/erpnext/accounting/introduction)

## 2. Baseer ERP application launcher

The application launcher should show focused **apps**, grouped for orientation only. A group is not a separate system.

```text
Baseer ERP
├─ القيادة
│  └─ مركز القيادة
├─ التجارة والعمليات
│  ├─ المبيعات اليومية
│  ├─ المشتريات
│  ├─ المخزون
│  └─ الأصول والضمان
├─ المالية والامتثال
│  ├─ المحاسبة
│  ├─ الخزائن والبنوك
│  ├─ المصروفات
│  ├─ الضريبة والامتثال (Hajri Tax)
│  └─ التقارير
├─ الأشخاص
│  └─ الموارد البشرية والرواتب
├─ الإنتاجية
│  ├─ المستندات
│  └─ المساعد الذكي
└─ الإدارة
   └─ الشركات والمستخدمون والصلاحيات والإعدادات والنسخ
```

The launcher may show only apps the user has permission to open. All apps still share the same company context, identity, locale, theme, business date, files, audit, and central accounting engine.

## 3. Professional module boundaries

| App | Primary job | Owns | Uses, but does not own |
| --- | --- | --- | --- |
| **Command Center** | Help the owner decide what needs attention today | Read-only executive projections, alerts, calendar, action links | All domain data; it never writes accounting, tax, inventory, or HR truth |
| **Daily Sales** | Record and manage daily/shift sales | Sales day/shift/channel workflow and operational sales evidence | Accounting posting, tax determination, vault allocation, documents |
| **Purchasing** | Control supplier-side procurement from request to receipt/bill handoff | Supplier procurement workflow, requests, batches, receiving context | Supplier master, inventory receipt, accounting bill/posting, documents |
| **Inventory** | Maintain products, locations, quantities, and controlled stock movement | Items, units, locations, availability, stock movements, counts | Accounting valuation/posting, purchase/sales source documents, documents |
| **Accounting** | Keep official financial truth | Chart of accounts, journals/ledger, invoices/bills, financial classification, canonical posting/reversal, financial history | Sales/purchase/inventory/HR source workflows, tax compliance filing view |
| **Treasury & Payments** | Manage company money locations and internal movement | Vaults, payment channels, transfers, balances as-of | Accounting ledger and document effects |
| **Expenses** | Control operating expenses and recurring commitments | Expense policy/lines, recurring commitments, payment intent/history | Accounting posting, supplier master, vault payment, tax calculation |
| **Tax & Compliance (Hajri Tax)** | Convert tax-source evidence into controlled filing and compliance work | Filing periods, declaration snapshots/versions, review, controlled adjustments, evidence package, submission/payment tracking | Accounting tax engine, approved invoices, documents, company registration |
| **People & Payroll** | Manage employee lifecycle and payroll work | Employees, leave, residency, services, payroll lifecycle, employee records | Accounting payment/posting, documents, tax where legally relevant |
| **Assets & Warranty** | Track owned assets and warranty obligations | Source-document follow-up queue, operational asset register, warranty/custody/maintenance alerts | Explicit asset-accounting postings only after their own policy; inventory/receipts and authorized document storage. A warranty marker never creates a journal automatically. |
| **Documents** | Safely store, find, retain, and authorize files | File metadata, storage references, document index, retention/access controls | The business source that gives each file meaning |
| **Reports** | Explore, print, export, and drill into official read models | Read-only report definitions, server projections, exports, print packages | Every module’s authoritative data; it never creates source data |
| **Administration** | Configure and govern the ERP | Companies, users, memberships, roles, policies, theme, integrations, backup/recovery control | Platform kernel services |
| **Smart Assistant** | Help users query approved ERP knowledge and take explicitly authorized actions | Conversations/session context, tool orchestration, safe answer/provenance policy | Narrow read/write contracts published by other modules |

## 4. What changes from the earlier map

| Broad old proposal | Problem | v2 correction |
| --- | --- | --- |
| Finance containing sales, purchases, expenses, treasury, loans, ledger | Too many separate user jobs and workflows hidden under one app | Separate Daily Sales, Purchasing, Expenses, Treasury & Payments, and Accounting; all post through the same accounting core |
| Operations containing purchase requests, purchase receipt, catalog, inventory | Procurement and inventory are different lifecycles | Purchasing owns procurement; Inventory owns quantities and stock; both integrate through contracts |
| Tax positioned mainly as a report | HajriTax has a unique filing/registry/review workflow | Tax & Compliance becomes a dedicated application, fed by accounting—not a dashboard tab |
| People treated as a general HR folder | Payroll has financial and legal lifecycle complexity | One People & Payroll application with clear internal workspaces and controlled Accounting contracts |
| Documents treated as a place for commercial invoices | A document index should not own a financial invoice | Accounting/Purchasing own business documents; Documents owns secure file/index infrastructure |

## 5. Hajri Tax — what it is in Noorix

HajriTax is not merely the existing VAT report. The Noorix application has a distinctive registry-style workflow:

1. Create/select a declaration for a company and tax period (quarter/year context).
2. Import the calculated tax-report data into the declaration workspace.
3. Review disclosure rows and completeness.
4. Maintain a persistent declaration record with navigation between filings.
5. Track or simulate payment outcome.
6. Support controlled bulk import/export, print, and filing-oriented views.

That makes it a **compliance case-management application**: it turns financial evidence into a reviewed filing package. It has a different lifecycle from an invoice, a ledger entry, or a general report.

Saudi VAT filing itself is period-based and requires a taxpayer to file a return for each applicable monthly or quarterly period; the official guidance describes the return as a taxpayer self-assessment and requires the related payment by the stated deadline. [ZATCA VAT guideline](https://www.zatca.gov.sa/en/RulesRegulations/VAT/Documents/VAT%20%20Real%20Guidelines%20English%20Web.pdf) ZATCA also provides workflows for changing filing period and amending filed VAT returns. [Tax filing-period change](https://zatca.gov.sa/en/eServices/Pages/eServices-011.aspx), [VAT return amendment](https://zatca.gov.sa/ar/eServices/Pages/eservices-078.aspx)

## 6. Hajri Tax in Baseer ERP — the correct boundary

### 6.1 What it owns

`Tax & Compliance` owns:

- tax registration profile and approved filing cadence for each company;
- filing calendar, due dates, readiness state, and reminders;
- declaration registry with company, period, version, status, and submission/payment references;
- immutable source snapshot used for each declaration version;
- review checklist, disclosure rows, evidence links, reviewer/owner approvals, and audit;
- typed/manual adjustment entries with reason, evidence, author, and approval—not arbitrary edits to totals;
- export/print package and controlled import staging;
- filed/amended/superseded status history.

### 6.2 What it does not own

It does **not** own or directly alter:

- the accounting ledger;
- invoice net/tax/gross values;
- vault balances or bank transactions;
- browser-calculated VAT totals;
- generic document storage;
- company/user/permission truth.

The Accounting tax engine remains the canonical source for tax classification and financial totals. Documents provides the secure evidence store. Tax & Compliance creates a controlled **filing snapshot** and compliance history above those sources.

### 6.3 Reconcile personal-ERP flexibility with filing integrity

The approved Baseer ERP policy allows the owner to amend or cancel historical financial operations; there is no automatic fiscal lock. Hajri Tax must preserve that flexibility without corrupting a filed declaration:

- A filing snapshot does **not** close the underlying financial period.
- If a historical invoice changes after a declaration snapshot, the system records a reconciliation drift alert.
- The owner may review the difference and create a new declaration version/amendment workflow with full history.
- The original submitted snapshot remains immutable evidence; it is never silently overwritten.

This is the professional solution: historical finance stays editable by the owner, while tax filing evidence stays traceable.

## 7. Tax flow across modules

```text
Daily Sales / Purchasing / Expenses
          │ approved financial document
          ▼
Accounting + central tax engine
          │ authoritative net, tax, gross and classification
          ├──────────► Reports (read-only gross default / tax-separated view)
          │
          ▼
Tax & Compliance (Hajri Tax)
filing snapshot → review → evidence → file/payment tracking → amendment version if needed
```

No UI in this flow calculates a tax total. The **gross default** remains the user’s approved management display policy; Tax & Compliance retains the authoritative separated tax fields necessary for disclosure.

## 8. Suggested internal navigation for Hajri Tax

```text
Tax & Compliance
├─ Overview & filing calendar
├─ Declarations
│  ├─ New / imported source snapshot
│  ├─ Review & disclosure
│  ├─ Evidence package
│  ├─ Approval / submission state
│  ├─ Payment or refund tracking
│  └─ Amendments and versions
├─ VAT reconciliation
├─ Tax registrations & filing settings
└─ Exports and archive
```

## 9. Scope discipline

This v2 taxonomy is the proposed product structure. It does not authorize building every app now. The single-module focus policy still applies:

1. complete platform foundation;
2. choose one app;
3. perform full Noorix discovery for that app;
4. build and verify it end-to-end;
5. only then proceed.

