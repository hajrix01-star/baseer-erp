# Noorix Supplier Dues and Partial Payments — Read-Only Discovery

**Discovery date:** 2026-08-15  
**Source inspected:** `hajrix01-star/NOORIX`, pinned local reference `origin/main` at `94536fd3bf7e82135b065aaa20c9dd1e1d496464`  
**Scope:** source-code inspection only. No Noorix data was viewed, changed, exported, or imported.

## Decision context

BASEER ERP will ultimately migrate and run the owner's historical Noorix data. The owner approved a management cash-basis presentation for supplier dues:

- an unpaid supplier due is visible in its own Supplier Dues report;
- it is excluded from ordinary cash movement, vault balances, paid-purchase totals, and ordinary management expense/profit reports;
- a partial payment is included in those ordinary cash reports only for the amount and business date actually paid;
- tax/statutory reporting is a separately approved future rule.

The governing BASEER decision is [Supplier Dues and Cash-Basis Reporting — Gate A Decision](../foundation/SUPPLIER_DUES_CASH_BASIS_REPORTING_GATE_A_DECISION.md).

## What Noorix actually implements

### 1. The Noorix purchase-debt register is a staging register, not a payment ledger

`PurchaseDebtRecord` retains a historical supplier invoice before it is converted to a normal purchase invoice. Its core data is supplier, supplier invoice number, normalized duplicate key, invoice date, total amount, tax flag, notes, and state.

Its only states are:

| State | Meaning |
|---|---|
| `pending` | historical debt is waiting for conversion |
| `promoting` | atomic conversion in progress |
| `promoted` | converted to a normal purchase invoice |
| `cancelled` | staging record cancelled |

The schema migration explicitly states that this register is outside accounting and reporting until its purchase-batch conversion. The list summary treats only `pending` records as the official outstanding amount; `promoted` records are retained as history.

### 2. Conversion creates a full normal purchase invoice

When a purchase-batch item supplies `legacyDebtId`, Noorix reserves the pending record, hydrates the item from it, and forces:

- supplier, supplier invoice number, original invoice date, amount, tax status, notes;
- document kind `purchase`;
- accounting category/account resolved from the supplier.

The record then links to the one converted invoice, the batch, conversion user/time, and idempotency data. It is audited. Cancelling that converted invoice reopens the staging record atomically.

### 3. This path does not model partial settlement of a supplier due

The inspected schema and `purchase-debts` service have no payment child record, paid amount, remaining amount, payment date, or partial-payment state. The batch conversion API accepts one `vaultId` for the batch; its generated purchase outflow uses the full invoice total.

Normal Noorix invoice creation can split a **fully paid invoice** over two or more vaults, but its contract requires the vault-split total to equal the full invoice total. This is a payment-source split, not supplier credit with later partial settlement.

## BASEER migration and delivery rule

BASEER must preserve Noorix source facts without pretending Noorix had partial-payment links:

| Noorix source condition | BASEER import treatment | Ordinary management reports |
|---|---|---|
| `pending` purchase-debt record | import as an open Supplier Due, retaining original supplier invoice number, invoice date, amount, tax flag, notes, legacy ID and source status | excluded from ordinary cash/expense/profit totals; shown in Supplier Dues only |
| `promoted` record with linked active purchase invoice | import the purchase invoice as the authoritative financial document; retain the source-link/audit metadata | follow the imported payment facts of that invoice; do not create a second due |
| `cancelled` staging record | retain as cancelled source/audit history; never make it payable | excluded |
| fully paid Noorix invoice split between vaults | import the document and each vault allocation; allocations must total the invoice | full amount on the actual payment business date |
| future BASEER partial payment | create a linked payment against one Supplier Due; reduce remaining amount atomically | only the paid portion, on that payment's business date |

## Mandatory safeguards for implementation

1. A migration dry run must detect and block duplicate supplier invoice identities after Noorix's normalized duplicate key rules.
2. Import is idempotent by source system, source record ID, company, and source document identity; rerunning it must not create a second due or payment.
3. A due and its payments must always belong to the same tenant, company, supplier, and fiscal-period policy.
4. Remaining amount is server-calculated: original due minus active linked payments. It may never be negative.
5. A partial-payment write creates the payment, vault allocation, current ledger effect, report-read-model effect, and audit event in one transaction.
6. An open-period correction follows the owner's approved direct-edit policy; cancellation or correction preserves the source record and history rather than hard-deleting it.
7. The import reconciliation must compare counts and monetary totals for pending, promoted, cancelled, and skipped/exception records before cutover.

## Result

The owner-approved BASEER behaviour is compatible with Noorix migration and intentionally more capable: Noorix's pre-conversion debt register maps cleanly to BASEER open dues, while BASEER adds future partial-payment links without inventing historical partial-payment data. No data migration should run until the Supplier Dues domain, payment domain, and reconciliation rehearsal are delivered and accepted.

