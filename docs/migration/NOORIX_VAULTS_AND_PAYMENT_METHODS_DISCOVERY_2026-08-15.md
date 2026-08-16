# Noorix vaults and payment methods discovery

**Status:** Gate A discovery record — no Baseer Finance code or Noorix data was changed.  
**Date:** 2026-08-15  
**Source reviewed:** public Noorix repository snapshot `origin/main` at `94536fd3bf7e82135b065aaa20c9dd1e1d496464`.  
**Related records:**

- `NOORIX_DAILY_SALES_CLOSING_DISCOVERY_2026-08-15.md`
- `NOORIX_DOCUMENT_NUMBER_COMPATIBILITY.md`
- `../foundation/CENTRAL_FILTERS_GATE_A_DECISION.md`

## Business conclusion

In Noorix, a payment method is not an independent text label. It is a company-owned **vault** connected to one asset account in the chart of accounts. Cash, bank, and application/card vaults are operational forms of the same accounting object:

- `cash` — physical cash box or petty cash;
- `bank` — bank account or deposit destination; and
- `app` — electronic/card/application payment destination.

The vault has two separate eligibility controls:

| Control | Meaning | Used by |
| --- | --- | --- |
| `isSalesChannel` | This vault is allowed to receive an aggregated Sales Closing channel. | Daily sales closing only. |
| `showAsPaymentMethod` | This vault is allowed to appear as an operational payment method. | Purchases, expenses, payroll, advances, and other outflows. |

The vault must also belong to the selected company, be active, and not be archived. A transfer can use active non-archived vaults even if hidden from payment choices, because a hidden cash box/custody vault can still legitimately receive a transfer.

## Expected balance versus actual counted cash

Noorix correctly derives a vault's accounting balance from active ledger entries:

`expected balance = debit movements to the vault account − credit movements from the vault account`

Cancelled entries are excluded. The balance is not manually stored or edited.

The owner decision for Baseer is separate and mandatory:

- `cashOnHand` is **a Noorix physical cash-count field** at the time of a daily closing; it is legacy evidence and not a BASEER cash handover.
- it does not create revenue, VAT, or a journal entry;
- it is not a payment channel; and
- it is retained for end-of-month available-cash visibility and reconciliation.

Therefore Baseer must keep two values that must never be confused:

1. **Expected cash balance** — derived from the financial ledger for each cash vault, as of the selected business date.
2. **Actual cash count** — the dated physical count recorded by an authorized user for a specific cash vault.

The reconciliation result is `actual count − expected balance`. It is an observation, not an automatic accounting adjustment. A difference may only affect accounting through a separate, authorized cash-adjustment document with its own reason, approvals, audit record, and balanced posting.

## Owner decision: optional closing

**Approved 2026-08-15; editing policy in `../foundation/OPEN_PERIOD_FINANCIAL_EDITING_GATE_A_DECISION.md`:** a Sales Closing remains optional. The company Operational Calendar determines whether a date was closed or expected to operate. A scheduled closed date creates neither sales nor a cash discrepancy and needs no manual zero closing; an expected operating date without a saved active closing is pending data. Vault and cash-count rules apply to a closing an authorized user creates or edits in an open fiscal period.

## Sales-closing implications

For a Sales Closing, every channel amount is a gross amount including VAT and is linked to an eligible sales-channel vault. The posting is per channel:

- debit the channel vault account by its gross amount;
- credit net sales revenue; and
- credit VAT collected, when enabled.

The total of all channel allocations is the sales-closing total. The physical cash count does not take part in that total. In Baseer, a sales closing with a cash count must explicitly identify the cash vault being counted; it cannot rely on an ambiguous company-level number.

## Transfers between vaults

A vault transfer is an internal movement, not revenue or an expense:

- source vault account is credited;
- destination vault account is debited;
- the amount is positive, the date is valid and in an open accounting period;
- source and destination cannot be the same vault;
- it has an idempotency key to prevent double posting;
- it creates an operational transfer voucher, one balanced ledger entry, and an audit record; and
- a correction is a separate, dated reverse transfer. The original stays visible as reversed; it is not overwritten or deleted.

This distinction is essential for a bank deposit: moving physical cash from a cash vault to a bank vault is a transfer, not a sale. It must not inflate revenue.

## Excluded scope: bank statements and bank matching

**Owner decision (2026-08-15):** Baseer will not build bank-statement upload, external-bank matching, or a bank-reconciliation workspace. Bank and electronic vaults remain payment destinations with ledger-derived balances, and internal vault transfers remain available.

## Requirements for the future Baseer Vaults and Finance delivery

1. A vault belongs to exactly one company and has a linked asset account; its identifier and linked account cannot be silently repurposed.
2. Vault type, sales-channel eligibility, payment-method visibility, active/archived state, and ordering are explicit controlled fields.
3. Every finance document uses approved vault identifiers and durable allocation rows, not free-text payment labels.
4. Ledger-derived expected balance is the only official accounting balance.
5. Cash-count observations are dated, vault-specific, actor-stamped, immutable after approval, and linked to a Sales Closing where one exists.
6. Archive prevents new operational use but preserves historical references and reconciliation.
7. Transfers and reversals are idempotent, company-isolated, period-checked, balanced, and auditable.
8. The dashboard/report/print/export must use the central company-and-period filter contract and server-calculated results only.

## Migration requirements

Before import, each Noorix vault requires a mapping record containing the company, source ID, source name, type, linked source account, active/archive status, sales-channel flag, payment-method flag, and checksum.

Legacy Sales Closing channel rows must map to the matching imported vault by source identity, not by display name. Where a legacy `cashOnHand` value lacks a vault reference, Baseer must preserve it as source evidence and place the vault assignment in a controlled exception queue. It must not guess which cash box was counted, and it must never add it to the BASEER cumulative cash-handover report.

## Gate B test requirements

- a user in one company cannot read or use another company's vault;
- inactive or archived vaults cannot be newly used as a sales channel or payment method;
- a hidden payment vault can still be used only for a valid internal transfer;
- allocations sum exactly to the document total and post to the selected vault accounts;
- expected balance equals active ledger debits minus credits as of the selected date;
- actual cash count is never included in revenue, VAT, or expected balance;
- reconciliation difference is visible but creates no posting by itself;
- original and reversal transfers are both auditable and do not double-count the final balance;
- multi-vault sales/invoices retain correct payment-allocation evidence rather than relying on a nullable header vault; and
- migration reports every unmapped vault or ambiguous legacy cash count as an exception.

## Owner decision: correction policy

**Approved 2026-08-15:** direct edits are allowed while the Sales Closing business date is in an open fiscal period. The system atomically rebuilds the current payment allocations and ledger effect and retains before/after audit evidence. Closed and locked periods follow ../foundation/OPEN_PERIOD_FINANCIAL_EDITING_GATE_A_DECISION.md.