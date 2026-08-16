# Company Setup Seed and Supplier Copy — Owner Decision

**Status:** Implemented in source for the Finance Setup flow on 2026-08-17. Activation requires the controlled database migration 20260817210000_finance_category_posting_hierarchy; supplier copying from another company remains a separate later slice.
**Date:** 2026-08-15  
**Product:** BASEER ERP — private use by the owner and the owner's companies.  
**Source reference:** read-only Noorix source inspection at `origin/main` commit `94536fd3bf7e82135b065aaa20c9dd1e1d496464`. No Noorix data was accessed or changed.

## Owner outcome

When the owner creates a new company, BASEER must present a guided setup. It must show the accounting seed and offer two supplier sources:

1. the standard supplier seed; and
2. suppliers already used in the owner's other authorized companies.

The owner selects what to add. A selected supplier is **copied into the new company as an independent supplier record**. It is never a shared supplier record across companies.

This avoids repeatedly typing common suppliers while preserving complete company isolation.

## Why the copy model is required

One company may later have a different phone number, tax treatment, category, notes, payment terms, archive state, invoices, dues, or payments for the same supplier. A shared mutable row would mix those histories and break company isolation.

The new company receives its own copy. Later changes in either company do not update the other. The setup audit retains the source company and source supplier reference as provenance only; it does not create a live cross-company financial link.

## Noorix seed observed

Noorix currently creates a company and then initializes accounting. Its starter seed contains:

| Seed item | Noorix observed content | BASEER setup treatment |
|---|---|---|
| Chart of accounts | 20 starter accounts: assets, liabilities, equity, revenue, purchases and expenses | required protected base, visible for review before confirmation |
| Core categories | 13 parent categories and 47 subcategories (current Noorix source); BASEER applies a compatible 16-parent, 50-leaf taxonomy tailored to its expanded service accounts | required base; created company-local and extendable later |
| Vaults | cash and bank asset-backed vaults | cash vault required; bank/electronic vault is optional and is **not** a bank-reconciliation feature |
| Fiscal period | one open calendar-year period | required; BASEER uses the approved strict rule that every Finance posting must be in exactly one open period |
| Standard suppliers | 16 general Saudi service/government/platform suppliers | selectable, not silently forced |

The 16 observed standard suppliers are Saudi Energy, STC, GOSI, ZATCA, Ministry of Commerce, Saudi Business Center, Ministry of Municipalities and Housing, HRSD, Passports, Civil Defense, Saudi Chambers, Qiwa, Absher Business, Mudad, Muqeem, and Balady.

Noorix keeps activity-specific entities, such as NWC, Mobily, Zain, Salam, SFDA, SASO, SAIP, and MISA, outside the automatic default list. BASEER likewise presents them only when selected or copied from an authorized company.

## تنفيذ البذرة في بصير

أصبحت البذرة المالية تضيف أيضًا فئات خدمات مستقلة: **كهرباء وطاقة**، **مياه وصرف صحي**، **اتصالات وإنترنت**، و**خدمات بلدية وتراخيص**. عند تهيئة شركة جديدة تظهر قائمة الموردين العامة الـ16 كخيارات صريحة، وتُنشأ فقط للمحدد منها كسجلات مستقلة داخل الشركة مع فئتها المقترحة. لا تُنشأ موردات مشتركة ولا تُضاف أي جهة دون اختيار.
## Required Company Setup flow

### Step 1 — company identity

Collect the new company name, optional English name, tax registration details, business timezone, and the creating owner's company role. No financial data is created before confirmation.

### Step 2 — review the company seed

Show a short, human-readable summary of the protected starter accounts, categories, initial fiscal period, and proposed vaults. The user may add optional vaults or business-specific categories, but may not remove a required protected account that later posting needs.

### Step 3 — choose suppliers

Show two clearly separated lists:

| List | What the user sees | Default action |
|---|---|---|
| Standard supplier seed | the 16 common suppliers, with tax status and suggested category | selectable; not silently added |
| My other companies | supplier cards from companies the actor is authorized to read | selectable; no financial totals, invoices, balances, dues, or payments are shown |

Each card displays only the data needed to decide: name, tax number when present, tax registration flag, phone when present, and suggested category. It must show the source company name only as a selection aid.

Before confirmation, BASEER shows: selected suppliers, proposed target category for each, duplicate warnings, and any item that cannot be safely mapped. The user may remove selections or add a new local supplier later.

### Step 4 — confirm and create atomically

One server transaction creates the company, membership, protected chart, chosen categories, fiscal-period configuration, selected vaults, selected supplier copies, provenance records, idempotency receipt, and audit event. A retry with the same setup request must return the original result rather than creating a second company or duplicate suppliers.

## Mandatory safety and isolation rules

1. The actor needs authorized company-setup permission on the target and supplier-read permission for each source company. A company not visible to the actor never appears in the list.
2. The selection view never exposes source invoices, sales, ledger balances, due balances, payment history, bank data, employee data, or attachments.
3. Each copied supplier gets a new target-company ID. Its source company/supplier is retained only in an internal setup-provenance/audit record.
4. Supplier category mapping uses target company category codes, not a foreign source-category ID. An unresolved category blocks that selected item and is shown before confirmation.
5. Exact active target duplicates are detected by tax number when present; otherwise by an explicit user-confirmed match. Similar names are warnings only and are never auto-merged.
6. Copying a supplier never copies its invoices, dues, payments, expense lines, assets, attachments, balances, document numbers, or financial history.
7. Supplier edits, archival, and later payments remain wholly local to the target company.
8. The cancelled bank-statement/reconciliation scope remains excluded. A bank/electronic vault here is only a company-local payment destination.

## Relationship to migration

This setup wizard is for a new company. It is not a replacement for the formal Noorix migration. Migration imports exact source suppliers and financial references through the source-ID map described in [Noorix Suppliers — Read-Only Discovery and BASEER Import Map](../migration/NOORIX_SUPPLIERS_DISCOVERY_AND_IMPORT_MAP_2026-08-15.md). The wizard's copy function is intentionally limited to supplier master data.

## Delivery acceptance tests

- A new company can be created with only the mandatory accounting base and no optional suppliers.
- The owner can select standard suppliers and supplier cards from an authorized company in one setup request.
- A user without permission to a source company cannot discover its name or suppliers.
- A copied supplier has a different target ID and no shared mutable financial links.
- Changing, archiving, or paying a copied supplier in the new company does not affect its source-company supplier.
- Duplicate handling, category mapping, idempotent retries, audit records, and rollback on any failure are proven.
- The company seed, selected supplier copies, and fiscal configuration remain company-scoped under live authorization and database row-level security.



## Utility default and Noorix migration safety

For small private companies, Baseer version 4 provides one active posting category: UTIL-001 (مرافق وخدمات). Noorix electricity, telecom, and water leaves map to it only through the approved semantic resolver; identical-looking codes are never assumed equivalent. Existing company history is preserved and is not rewritten by seed refresh.
