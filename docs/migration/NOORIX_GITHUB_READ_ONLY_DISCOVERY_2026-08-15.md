# Noorix GitHub read-only discovery — 2026-08-15

## Scope and source

This record is a read-only discovery of `https://github.com/hajrix01-star/NOORIX`, branch `main`, commit `94536fd3bf7e82135b065aaa20c9dd1e1d496464`. No Noorix files, records, GitHub settings, branches, or deployments were changed.

The local Noorix worktree is older (`b97bd84c`) and contains extensive uncommitted user work. It must not be reset, checked out over, or treated as identical to GitHub `main`. Any later migration evidence must identify the exact source snapshot and commit/export date.

## What Noorix is

Noorix is a React/Vite frontend with a NestJS backend, Prisma, PostgreSQL, and tenant/company isolation. Its major business areas include dashboard, sales, purchase/expense invoices, suppliers/categories, treasury/vaults, people/HR/payroll, reporting, settings, orders/inventory, backup/recovery, and owner administration.

## Finance operating model discovered

| Noorix flow | Meaning to preserve in BASEER ERP |
|---|---|
| Daily sales summary | End-of-day operational sales total, customer/transaction count, and payment/sales channels. It is not a detailed point-of-sale replacement. |
| Purchase/expense invoice | Outflow document linked to supplier/category/payment or vault; total is mandatory while item lines may be optional. |
| Batch invoice entry | Multiple purchase/expense invoices share a batch ID and need history, safe editing, printing, and export. |
| Financial posting | Inflow/outflow/cancellation produce financial records, ledger consequences, and audit history. |
| Invoice numbering | Company-unique legacy invoice number; the compatible Baseer strategy is defined in `NOORIX_DOCUMENT_NUMBER_COMPATIBILITY.md`. |

## Dashboard and reporting findings

Noorix explicitly distinguishes three valid read sources:

1. **Ledger/P&L** for official accounting profit and loss.
2. **Daily sales summaries** for operational daily, weekday, channel, and customer metrics.
3. **Period invoice analytics** for selected-range supplier and category analysis.

They can differ legitimately because of classification, timing, or data grain. BASEER ERP must label the source and provide reconciliation rather than force all values to match silently.

Noorix dashboard documentation also requires that official KPI amounts, averages, percentages, and comparisons come from backend APIs. BASEER ERP adopts and strengthens that rule: financial calculations are server-owned; the browser only formats and renders read-only results.

## Noorix visual filter reference

The reviewed Noorix interface uses central period choices: All, Day, Month/month range, Range, Year, and Quarter. The user chooses a value then applies or resets it. Weekly analysis is derived from the selected period rather than being a separate global filter. BASEER ERP's mandatory central-filter decision records the compatible, stricter server-authorised design in `../foundation/CENTRAL_FILTERS_GATE_A_DECISION.md`.

## Recent GitHub main changes relevant to future migration

Between the local committed checkout and GitHub `main`, the remote history adds safe internal registration corrections, historical registration-sale price backfill, payroll/direct-advance correction handling, reporting/order analytics refinements, and permission-section alignment. These changes reinforce that migration must use an explicit frozen source snapshot and reconciliation receipt, not an assumed source schema.

## BASEER ERP adoption decisions

- Preserve business meaning, visible invoice numbers, source identity, auditability, and cancellation/reversal history.
- Do not copy Noorix runtime code, credentials, routes, backup paths, client-side financial calculation, or database directly.
- Use Baseer tenant/company RLS, server commands, idempotency, atomic serials, audit events, and controlled migration maps.
- Build Finance with mandatory server-owned daily/company/channel summaries and read-only dashboard results, as defined in `../foundation/ANALYTICS_READ_MODELS_GATE_A_DECISION.md`.

## Discovery still required before real data migration

1. A read-only, dated export or snapshot of the actual Noorix database.
2. Per-company inventory of document kinds, statuses, invoice-number formats, duplicate exceptions, and date/time-zone values.
3. Mapping of users, roles, companies, suppliers, categories, channels, vaults, ledger accounts, and linked attachments.
4. Sample reconciliation of invoice totals, daily sales summaries, ledger/P&L, VAT, and dashboard figures.
5. Owner approval of every exception before import; no silent renumbering, reclassification, or live overwrite.
