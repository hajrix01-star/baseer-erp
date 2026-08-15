# Noorix accounting foundation discovery

**Status:** Gate A discovery record — no Baseer Finance code or Noorix data was changed.  
**Date:** 2026-08-15  
**Source reviewed:** public Noorix repository snapshot `origin/main` at `94536fd3bf7e82135b065aaa20c9dd1e1d496464`.  
**Related records:**

- `NOORIX_DAILY_SALES_CLOSING_DISCOVERY_2026-08-15.md`
- `NOORIX_VAULTS_AND_PAYMENT_METHODS_DISCOVERY_2026-08-15.md`
- `../foundation/ANALYTICS_READ_MODELS_GATE_A_DECISION.md`
- `../foundation/OPERATIONAL_CALENDAR_AND_SALES_AVERAGES_GATE_A_DECISION.md`

## Business conclusion

Noorix uses a separate accounting foundation per company. The core objects are a company-specific chart of accounts, company-specific vault accounts, company VAT settings, fiscal periods, and ledger entries. A financial document posts against accounts in the selected company only.

The reviewed account types are assets, liabilities, equity, revenue, and expenses. Noorix seeds a practical starter chart containing cash, bank, receivables, employee advances, payables, VAT, loans, payroll payable, capital, opening-balance clearing, sales revenue, purchase groups, and expense groups. It also creates initial cash and bank vaults that each point to an asset account.

This is useful as a migration reference, but Baseer must not assume the starter seed represents every legacy company. Imported Noorix accounts, codes, names, status, linked vaults, and balances require a source-to-target mapping and reconciliation record.

## Fiscal periods observed in Noorix

Noorix supports per-company periods with non-overlapping start/end dates and statuses `open`, `closed`, and `locked`:

- a transaction in an `open` period is allowed;
- a `closed` period rejects financial posting but can be reopened;
- a `locked` period rejects posting and cannot be reopened through the reviewed service; and
- the current Noorix service permits a transaction when no matching fiscal period exists, for compatibility with legacy companies.

Baseer must deliberately improve the last point: **every Finance posting must belong to exactly one open fiscal period.** No unperioded transaction, overlapping period, or silent fallback is acceptable. This includes create, edit, cancellation, reversal, cash adjustment, transfer, and imported opening-entry activity.

## VAT observed in Noorix

Company settings hold a sales-VAT enabled flag and a configurable VAT percentage. Sales Closing and outflow creation calculate net and tax server-side from gross inclusive totals; the resulting amounts are stored on the linked financial document and posted to the revenue/expense and VAT accounts. Tax reports aggregate active document net/tax amounts by period.

## Mandatory Baseer improvements

1. **Tax snapshot and edit history.** Every saved taxable document/allocation retains the effective VAT rate, tax treatment, net amount, tax amount, gross amount, rounding method, and tax-account reference for its current version; an open-period direct edit writes a before/after audit record and recalculates the current version server-side. Changing company defaults alone cannot rewrite historical values.
2. **Explicit account protection.** System accounts must be protected by an immutable system role/flag and by dependency checks. A code-prefix convention alone is not sufficient. An account used in a journal, vault, or historical migration map must be archived rather than silently renamed, repurposed, or deleted.
3. **Mandatory fiscal coverage.** Every Finance posting requires exactly one open period. Period validation happens inside the same transaction as the posting.
4. **Two-stage close control.** `open` permits direct authorized editing with audit and atomic current-ledger rebuild. `closed` means temporarily closed and may be reopened only by an authorized owner with an audit reason. `locked` means final and can never be reopened through ordinary application operations. Closed and locked statuses block direct edits.
5. **Open-period amendment; post-boundary reversal.** A document may be directly amended while its date is in an open period, with complete audit evidence and a rebuilt current ledger effect. A closed or locked period uses a controlled reversal or adjustment in an eligible open period and links back to the original.
6. **Company-local configuration.** Accounts, default revenue/VAT accounts, fiscal periods, VAT settings, and account mappings are scoped to one company. A user sees and posts only through authorized company context.
7. **Report source discipline.** Official VAT, cash, and profit/loss values come from server-owned posted data and allocations. Planning or filing notes may be retained separately, but cannot alter ledger truth.

## Suggested Baseer accounting starter structure

Baseer should provide a controlled starter chart for a new company, then allow approved company-specific extension. At minimum it needs:

| Account family | Purpose |
| --- | --- |
| Assets | cash vaults, bank/electronic vaults, receivables, employee advances, opening-balance clearing |
| Liabilities | VAT collected/payable, supplier payables, payroll payable, loans |
| Equity | owner capital and opening-balance counterpart |
| Revenue | sales revenue, with a protected default account for Sales Closing posting |
| Expenses | purchases, payroll, rent/utilities, operating, government fees, finance costs, and company-specific additions |

The account used by a vault is an asset account. The account used for VAT is a liability account. These types and relationships must be validated by the server before posting.

## Migration requirements

Before any import, Baseer must capture for each company:

- fiscal-year and period boundaries, statuses, close/lock history where available;
- account source IDs, codes, names, types, active state, tax exemption setting, and mapped Baseer account;
- vault-to-account links and expected opening balances;
- company VAT setting and tax number;
- document-level net, VAT, gross, tax treatment, and original VAT rate where available; and
- a reconciliation of opening balances and the debit/credit total for every imported posting.

Where Noorix history lacks a document tax-rate snapshot, Baseer shall preserve the original stored net/tax/gross values and record the inferred/default rate, if one is needed, as migration evidence rather than pretending it is a confirmed original fact.

## Gate B tests required before Finance is accepted

- the same account code may exist in different companies, but never duplicates within one company;
- a company cannot post to another company's account, vault, VAT setting, or fiscal period;
- a posting without exactly one open period is rejected;
- period overlap is rejected and boundaries are treated consistently;
- closed and locked periods reject new posting, edit, cancellation, transfer, and cash adjustment;
- reopening a closed period requires authorized actor, reason, and audit event; a locked period cannot be reopened;
- VAT arithmetic, balanced rounding, current ledger posting, and tax snapshots remain consistent after company VAT settings change or an authorized open-period edit;
- inactive/retired accounts with historical use remain readable and cannot be repurposed; and
- a migration rehearsal reconciles account balances, vault balances, VAT totals, document count, and debit=credit totals company by company.

## Owner decision needed before Finance implementation

The recommended policy is:

1. monthly fiscal periods for ordinary operations;
2. an authorized owner may close a completed month and reopen it only with a recorded reason;
3. an authorized owner may permanently lock a month after final review, VAT filing, or year-end; and
4. a locked period is never reopened in the application — any later correction is a linked adjustment in an open period.

This decision is required before period-close and accounting-posting interfaces are implemented.
