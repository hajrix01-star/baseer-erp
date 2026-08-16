# Noorix daily sales closing discovery

**Status:** Gate A discovery record — no Baseer Finance code or Noorix data was changed.  
**Date:** 2026-08-15  
**Source reviewed:** public Noorix repository snapshot `origin/main` at `94536fd3bf7e82135b065aaa20c9dd1e1d496464`.  
**Related records:**

- `NOORIX_GITHUB_READ_ONLY_DISCOVERY_2026-08-15.md`
- `NOORIX_DOCUMENT_NUMBER_COMPATIBILITY.md`
- `../foundation/ANALYTICS_READ_MODELS_GATE_A_DECISION.md`
- `../foundation/CENTRAL_FILTERS_GATE_A_DECISION.md`
- `../foundation/DAILY_SALES_CLOSING_OPERATIONAL_PURPOSE_DECISION_2026-08-16.md`

## Business conclusion

The Noorix **Sales** module is not a point-of-sale screen and must not be copied into Baseer as one. Per the owner purpose decision, BASEER ERP records the end-of-day aggregate extracted by an employee from the external POS system. It records one daily sales-closing summary for a business date and shift:

- business date;
- one closing scope: `morning`, `evening`, or `all` day;
- customer count;
- one or more payment-channel amounts;
- each payment channel is a selected, approved vault, never free text;
- an optional physical-cash value (`cashOnHand`); and
- notes.

The total sales amount is the sum of payment channels. Each entered channel amount is gross and includes VAT when VAT is enabled for the company.

## Owner decision: optional closing

**Owner decision updated 2026-08-16; editing policy in `../foundation/OPEN_PERIOD_FINANCIAL_EDITING_GATE_A_DECISION.md`:** a Sales Closing remains optional. The absence of a saved daily-closing summary means the shop did not operate that day; it is never substituted with a zero-sales closing or a pending sales amount. The Operational Calendar may retain a reason such as holiday or partial operation, but it never creates a sales value. An authorized user may directly create or edit an active closing while its date belongs to an open fiscal period.

## What Noorix does after a closing is saved

Within one financial operation, Noorix:

1. checks that the accounting period for the business date is open and that the date is not in the future;
2. rejects an empty channel list or a non-positive total;
3. checks that every selected vault is allowed as a sales-payment vault;
4. prevents a second active closing for the same company, business date, and shift;
5. saves the daily sales summary and its individual vault allocations;
6. creates a linked unified sales invoice using the same summary number;
7. splits gross channel amounts into net revenue and collected VAT with balanced rounding;
8. posts balanced ledger entries per channel: debit the linked vault account, credit revenue net of VAT, and credit collected VAT where applicable;
9. records an audit event; and
10. returns the saved summary with its channel/vault detail.

Cancellation is not deletion. Noorix marks the closing, the linked sales invoice, and the linked ledger entries as cancelled, then records an audit event. This preserves history and makes cancelled values excluded from ordinary dashboard/report totals unless explicitly requested.

## Important meaning of the fields

| Field             | Meaning in the reviewed Noorix implementation                                                                                    | Baseer implication                                                                                                                                                                                                       |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `transactionDate` | The business date of the closing, not merely the time the user pressed Save.                                                     | Baseer must use its central business-date policy and enforce open/closed periods.                                                                                                                                        |
| `shift`           | Exactly `morning`, `evening`, or `all`. The same company/date/shift may have only one active closing.                            | Treat it as a closing scope, not as a POS session unless a future POS module explicitly maps to it.                                                                                                                      |
| `channels[]`      | Positive gross amounts, each connected to a vault. Their sum is the sales total.                                                 | Keep a dedicated allocation row per vault; do not store a comma-separated payment method.                                                                                                                                |
| `cashOnHand`      | A separately stored physical-cash figure. In the reviewed flow it does **not** contribute to the total or create ledger entries. | **Superseded owner decision (2026-08-16):** Noorix `cashOnHand` remains source evidence of a physical count only. BASEER does not treat it as a cash handover. A new, explicit `cashHandoverAmount` records cash actually handed to the accountant and is the only value included in the cumulative handover report; neither value is revenue, a payment channel, or an accounting posting. |
| `customerCount`   | A non-negative count used for average basket/customer metrics.                                                                   | Preserve its business definition during migration; it is not a customer master record list.                                                                                                                              |
| VAT               | Company configuration determines whether gross channel amounts are split into net revenue and VAT collected.                     | VAT must be calculated on the server and rounded/balanced safely, never by the screen.                                                                                                                                   |
| `dayContext`      | A snapshot of relevant special day, school holiday, or manual calendar event for that date.                                      | Retain only if it has business value; store a snapshot for historical analytics, not a live mutable label.                                                                                                               |

## Numbering observed in Noorix

Noorix generates a daily summary number in the form `DS-YYYYMMDD-001`. The reviewed implementation obtains the next suffix by counting existing same-date summaries. Baseer must retain migrated Noorix numbers exactly, but it must use the already-approved atomic, high-water serial mechanism for new documents. A count-based sequence is not accepted for Baseer because parallel saves can collide or reuse a logical suffix.

## Dashboard and filters derived from the source

The sales dashboard reads the saved closings; it does not create official finance values in the browser. Its useful operational views include:

- totals by date, aggregated across shifts;
- daily average, customer average, and average basket;
- weekly slices and fair comparison with the same elapsed days of the comparison month;
- period and operating-day averages follow the mandatory Operational Calendar decision; a closed day is zero for the period average, while an expected operating day with no closing is pending data rather than silent zero;
- breakdown by vault/payment channel;
- totals by closing shift; and
- month-over-month average comparison.

The central filters recorded separately remain mandatory for Baseer: all, day, month or month range, explicit date range, year, and quarter, applied centrally to dashboard/report/print/export. The selected company and authorized period must be enforced by the server.

## Baseer design requirements for the future Finance delivery

The first Finance delivery shall introduce a server-owned **Sales Closing** source document, distinct from a POS sale line or customer invoice. It must have, at minimum:

1. a company-scoped closing header with business date, scope/shift, customer count, saved gross total, status, notes, source/import identifiers, actor, and immutable audit trail;
2. child payment allocations referencing approved company vaults;
3. a linked posting receipt/journal representation that proves the exact net-revenue and VAT accounting effect;
4. direct editing with an atomic ledger/allocation rebuild and audit while the fiscal period is open, plus non-destructive cancellation/reversal after the period boundary;
5. central business-date and period-close checks;
6. idempotency protection and atomic Baseer serial generation;
7. company/user authorization and row-level isolation; and
8. server-generated, read-only analytics models and reconciliation receipts.

Noorix `cashOnHand` is preserved only as dated source evidence if imported; it must not be silently converted into a BASEER cash handover. BASEER records a handover only when the worker explicitly confirms the amount delivered to the accountant. Both remain outside revenue and journal posting. BASEER will not build a bank-statement or external reconciliation module.

For migration, the raw legacy summary number, original business date, original shift, channel-to-vault mapping, status, user reference, source record ID, and checksum must be retained. Any legacy vault that cannot be matched must go to an exception queue; it must never silently become cash or a new generic payment method.

## Required tests before this module can pass Gate B

- active closing uniqueness for company + business date + shift, including concurrent requests;
- totals equal the sum of positive channel allocations exactly;
- each channel is authorized for the selected company and is bound to an approved vault;
- VAT split and journal balance are exact after currency rounding;
- duplicate requests replay safely through idempotency;
- a closed period, future date, foreign company, inactive vault, invalid shift, or cancelled document is rejected;
- cancellation preserves the original history and excludes it from default operational totals;
- direct editing in an open period atomically updates the current ledger/allocation effect and preserves an auditable before/after record;
- dashboard/report/export apply one centrally authorized period and return server-calculated values only; and
- a Noorix import rehearsal proves record count, gross/net/VAT totals, per-vault totals, document-number preservation, and exception handling.

## Decisions still requiring owner confirmation before Finance implementation

1. **Owner decision (2026-08-15):** a Sales Closing may be directly edited while its business date is in an open fiscal period. Closed/locked period handling follows `../foundation/OPEN_PERIOD_FINANCIAL_EDITING_GATE_A_DECISION.md`.
2. Do all companies use the same morning/evening/full-day scopes, or must closing scopes be configurable per company?

Until these questions are resolved, Baseer may preserve legacy values during import but must not invent accounting behavior for them.
