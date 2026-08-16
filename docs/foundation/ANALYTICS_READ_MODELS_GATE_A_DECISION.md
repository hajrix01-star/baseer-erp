# BASEER ERP analytics read-model decision

**Decision status:** Approved by the owner on 2026-08-15.

## Non-negotiable requirement

This decision is governed by `docs/governance/FINANCIAL_AND_FACTUAL_SOURCE_OF_TRUTH_POLICY_2026-08-15.md`: money is authoritative only when the server projection reconciles to active sealed journal evidence. Operational summaries add context but do not independently establish financial amounts.

The first Finance delivery is not complete unless it creates and maintains server-owned analytics read models. The BASEER ERP dashboard is read-only: it never enters, edits, or independently calculates financial records in the browser.

## Required data model

The Finance Gate A design must include these categories:

| Category                            | Purpose                                                                                                                                                      | Write authority                                                   |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Financial source records            | Active sales documents, purchases, expenses, receipts, and accounting ledger entries                                                                         | Finance commands and posting workflows only                       |
| Company daily financial summary     | One isolated daily summary per tenant, company, and business date: sales, tax, purchases, expenses, profit measures, invoice count, and reconciliation state | Server projection in the same controlled posting/rebuild workflow |
| Company daily sales-channel summary | One isolated daily summary per tenant, company, business date, and active sales/payment channel                                                              | Server projection in the same controlled posting/rebuild workflow |
| Projection/reconciliation receipt   | Records the source range, generated time, checksum or counts, and reconciliation result                                                                      | Server only                                                       |

The final Finance schema will assign exact physical table names, foreign keys, RLS policies, indexes, and retention rules. It must preserve the categories above; they may not be replaced by browser calculations or editable dashboard fields.

## Dashboard contract

The dashboard reads server-produced results only. It may format values and render charts, but it must not be the accounting authority.

The server calculates, from the daily summaries and active financial records:

- both named sales averages: period daily average using all calendar days, and operating-day average using documented operating days only; pending days disclose incomplete coverage rather than silently becoming zero;
- weekly comparisons;
- weekday analysis to identify the strongest sales days;
- sales-channel/payment-channel mix;
- average invoice/basket and customer count where a verified customer count exists;
- reconciliation status between operating summaries and the accounting ledger.

There is no separate table for "best day", "weekly average", or a dashboard chart. These are read-only server calculations from the required summaries.

## Isolation and migration rules

- Every source, summary, and receipt is tenant- and company-scoped with row-level security.
- A user may read only summaries for a company they are authorised to access.
- Imported Noorix history is loaded into approved financial source records first. The server then rebuilds summaries and produces a reconciliation receipt; imported dashboard totals are never trusted without comparison.
- Cancelled or corrected financial documents update/rebuild the related summary through a controlled server workflow; a browser refresh cannot change financial data.

## Finance acceptance gate

Before Finance or Dashboard is declared complete, tests must prove:

1. posting and cancellation/reversal produce the correct daily summaries;
2. one company's dashboard cannot read another company's facts or summaries;
3. dashboard API results reconcile to the active ledger for a selected period;
4. documented Day Off dates are included as zero only in period daily average, excluded from operating-day average, and pending operating dates are disclosed as incomplete;
5. imported Noorix history rebuilds to the expected daily and series totals;
6. the browser has no financial calculation or write path.

## Current boundary

This decision is documented now and becomes mandatory during the first Finance Gate A and Gate B implementation. No finance tables are created in the foundation-only baseline, because they require the controlled financial document and ledger design that feeds them.
