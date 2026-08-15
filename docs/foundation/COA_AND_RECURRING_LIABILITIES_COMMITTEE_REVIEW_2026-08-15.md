# Committee Review: Chart of Accounts, Recurring Expenses, and Liabilities

**Status:** Owner approved — mandatory Finance foundation rules for BASEER ERP.  
**Date:** 2026-08-15  
**Evidence:** Noorix source snapshot `origin/main` at `94536fd3bf7e82135b065aaa20c9dd1e1d496464`. No Noorix data or production system was changed.

## Executive verdict

Noorix's chart is a strong and practical **operating starter** for a small Saudi restaurant or similar small operating company. It is clear, company-local, and covers daily cash, suppliers, tax, loans, payroll, purchases, rent, utilities, government fees, and employee services.

It is **not**, by itself, a complete professional chart for every small company or for full statutory accounting. BASEER should preserve its familiar codes where they support Noorix migration, but add protected accounting controls and optional company-profile layers. The interface can remain simple: advanced accounts stay out of ordinary daily screens until used.

## What Noorix seeds for a new company

| Area | Observed seed |
|---|---|
| Accounts | 23: cash, bank, receivables, employee advances; supplier payables, VAT, loans, payroll payable; capital and opening-balance clearing; sales; purchases and operating expenses |
| Categories | 13 parent categories and 47 subcategories |
| Operational context | cash and bank vaults, an open calendar-year fiscal period, and 16 common Saudi service/government suppliers |
| Recurring classifications | rent/utilities, government fees, GOSI, medical insurance, and employee services are classified for recurring reporting |

Account codes are unique per company, and the source keeps account/category/vault/ledger data company-scoped. This aligns with BASEER's company isolation.

## Strengths worth retaining

1. Clear separation of assets, liabilities, equity, revenue, purchases, and expenses.
2. Practical Saudi operating categories: rent, electricity, water, telecom, government services, employee services, GOSI, finance fees, maintenance, and purchases.
3. Separate supplier-payable, loan, VAT, payroll-payable, capital, and opening-balance accounts.
4. Company-specific account, category, supplier, vault, and fiscal-period setup.
5. Reporting classification snapshots retained with ledger entries, so a later category change does not silently rewrite old report meaning.

## Professional gaps BASEER must not copy unchanged

| Gap in Noorix seed/behaviour | Why it matters | BASEER recommendation |
|---|---|---|
| `EXP-008` treats assets/equipment as expense | asset cost, depreciation, and disposal can be misstated | add an optional fixed-assets layer: asset cost, accumulated depreciation, depreciation expense, and disposal; do not auto-reclassify historical Noorix expense rows |
| One VAT liability account | input and output VAT cannot be clearly controlled through the ledger | use separate protected input-VAT receivable and output-VAT payable accounts when VAT accounting is enabled; keep the owner-facing cash dashboard gross/inclusive of VAT as already decided |
| No inventory/COGS layer | purchase totals can be mistaken for cost of sales | add an optional inventory/COGS/stock-adjustment layer for retail, trading, or restaurant companies that need it |
| Equity is narrow | owner withdrawals, owner current balance, and retained results are not explicitly represented | add protected owner-current/drawings and retained-earnings accounts when relevant |
| Payroll and statutory commitments are incomplete | a paid expense does not show what is still owed | provide optional payroll/GOSI/leave/end-of-service/VAT obligation registers when the company needs them |
| Seed accounts are not strongly protected in Noorix | changing a system account's code/type can corrupt reports | BASEER system accounts must have immutable purpose/type/code policy after first use and may be archived, never repurposed |
| A vault need not have a distinct settlement account in the seed | multiple payment channels become less transparent | BASEER validates one appropriate asset account per vault/payment destination and preserves its account mapping |

## What Noorix actually does with recurring expenses

An `ExpenseLine` is a reusable **template**, not an accounting liability. It stores a company supplier, expense category, service/meter number, expected amount, optional annual total, and payment interval of 1, 2, 3, 4, 6, or 12 months. Its payment history is a list of already active invoices.

Noorix does **not** create an unpaid bill, overdue state, remaining balance, scheduled payable, or partial-payment link merely because a recurring date arrives. A fixed-expense invoice can record months/quarter it covers, but that is coverage metadata; it does not automatically spread a prepaid amount over accounting periods.

## What Noorix actually does with liabilities

### Supplier dues

The Noorix purchase-debt register is historical staging data. It stays outside the ledger and reporting until it is converted to a fully paid purchase invoice. It is not an operational accounts-payable register and does not support partial payments.

BASEER already has the owner-approved improvement: a real Supplier Due, linked payments, remaining balance, and cash-basis management reporting. See [Supplier Dues and Cash-Basis Reporting — Gate A Decision](SUPPLIER_DUES_CASH_BASIS_REPORTING_GATE_A_DECISION.md).

### Loans

Noorix records loans with a separate accounting allocation: opening principal credits the loan liability and debits opening-balance clearing; a payment debits the loan liability and credits a vault; reversals restore the balance. Noorix treats finance interest and fees as separate expenses. BASEER deliberately does not adopt that split under the owner-approved inclusive-loan policy below.

Important migration fact: Noorix keeps historical paid figures as audit information, while its starting outstanding balance equals the entered `amount`. A BASEER loan import must therefore treat the supplied opening amount as the **remaining balance at the migration start date**, not automatically subtract historical figures again.

**Owner policy for BASEER:** the recorded amount and every payment are inclusive. BASEER will not split original loan amount, principal, interest, or financing fees; it retains one remaining inclusive balance.

## Committee recommendation for BASEER

### A. Keep daily work simple, keep accounting correct underneath

Give each new company a small operational seed, then let its profile add hidden-until-needed groups: inventory/COGS, fixed assets/depreciation, VAT input/output, payroll/statutory obligations, and owner equity controls. The owner should not have to use advanced accounts to record a normal sale, purchase, or cash payment.

### B. Make recurring expenses reminders, not invented expenses

A recurring-expense profile records supplier, category, service reference, expected amount, interval, next due date, and optional service-coverage rule. It creates a reminder/forecast only. It never creates a ledger entry, payable, or expense automatically.

When a real supplier bill is confirmed:

- paid immediately: record the actual paid cash expense on its payment date;
- paid later: create the approved Supplier Due; and
- paid partially: reduce that due only by the real paid amount and retain its remaining balance.

Thus an unpaid expected electricity bill is a reminder, not a false cash expense. An actual unpaid electricity invoice is a supplier due. This matches the owner's approved cash-basis dashboard rule.

### C. Separate cash reporting from accounting classification

Ordinary owner dashboards remain cash-based and gross/inclusive of VAT where already approved. The accounting ledger retains net/tax/gross and liability classification. Future statutory/tax reports must use explicit tax rules and never silently reuse the personal cash-management presentation.

### D. Owner-approved inclusive loan commitment

**Owner decision, 2026-08-15:** BASEER treats each loan as one inclusive commitment. The agreed loan balance and every payment remain one loan balance/payment; the application does not split principal, interest, or financing fees into separate user-facing records, ledger accounts, or reports. A payment reduces the inclusive loan balance and the selected vault; reversal restores both. This is an intentional personal-management policy, not a statutory accounting allocation.

## Owner-approved Finance foundation rules

The owner approved the following package on 2026-08-15. It is mandatory for Finance implementation:

1. Preserve Noorix-compatible starter account codes, while adding Baseer-protected system accounts and optional profile layers.
2. Make recurring-expense profiles reminders/forecasts only; never auto-post an expense or liability.
3. Keep the approved supplier-due cash-basis rule for actual unpaid bills and partial payments.
4. Use separate VAT input/output accounts when VAT accounting is enabled, while keeping the personal management dashboard gross/inclusive of VAT.
5. Treat each loan as one inclusive commitment with no principal/interest split; import only the remaining inclusive opening loan balance.

## Delivery gates after approval

- protected account purpose/type/code cannot be repurposed after use;
- company profile selection adds only company-local accounts/categories;
- a recurring reminder produces no financial posting until a real bill is confirmed;
- unpaid actual bills and partial payments reconcile exactly to the Supplier Dues report and never leak into ordinary cash totals before payment;
- inclusive loan payment, reversal, remaining balance, and vault effect reconcile in one transaction;
- all accounting postings require exactly one open fiscal period, authorized company context, idempotency, and audit evidence.

