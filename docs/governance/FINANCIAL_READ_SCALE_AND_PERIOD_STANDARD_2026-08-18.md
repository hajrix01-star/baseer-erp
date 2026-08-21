# Financial read scale and period standard — 2026-08-18

**Status:** local implementation standard; not a production-volume certification.

## Decision

All period-aware financial workspaces open on the **current Riyadh business month**. The shared `defaultBaseerPeriodRange()` is the only default. Users can then select a day, one or more explicit months under the single `MONTH` mode, quarter, year, or custom range through `BaseerPeriodFilter`. Multiple selected months are a union of those months, not the enclosing date range.

This applies to Sales, operational dashboard views, the unified invoice register, Treasury, and future financial reports. Master data is timeless and must not receive a cosmetic period filter. Open credit is an **as-of** liability view: unpaid prior-month documents remain visible on the first day of a new month.

## Non-negotiable read rules

- The server owns financial filtering, sorting, totals, currency math, and pagination.
- A browser never derives monetary totals from a partially loaded page.
- Every long-running financial list has a bounded `pageSize`, a stable cursor, and a maximum page size.
- A cursor is valid only for the same company and normalized filter/sort scope that issued it.
- Range selection changes server scope, not how many records the browser fetches.
- Long master-data option lists use server-backed lookup; they are not loaded without a bound merely to populate a select.
- A read projection may accelerate reads, but the posted journal remains the accounting source of truth.

## Implemented local baseline

| Surface | Local implementation |
| --- | --- |
| Unified invoice register | Server-side filters/summaries and a stable keyset page; default 50, maximum 100. |
| Supplier dues and cash payments | Full-scope server summary with bounded due pages; payment history and cash projection are cursorized. |
| Purchase/expense history | Bounded outflow-document page rather than an implicit growing list. |
| Daily Sales history | Stable cursor page with 50/100 bounds. |
| Treasury activity | Tuple cursor aligned to the displayed activity order; bounded page. |
| Treasury balances | `FinanceAccountDailyBalance` reads daily ledger-derived deltas instead of scanning all journal lines on each workspace opening. |
| Supplier/category selection | Server-backed typeahead endpoints for long lists. |

The corrections were delivered in commits `7d962d5`, `2c9edfe`, `ff0afe4`, and `bca5d87`.

## Daily account balance projection

`FinanceAccountDailyBalance` is a company/tenant/account/business-date projection containing the summed debit, credit, and signed delta of **posted** journal lines.

- The migration backfills from posted journal lines only.
- Journal posting updates the projection in the same database transaction.
- Reversal removes the original posted contribution and adds the reversal contribution, matching the existing posted-ledger read semantics.
- The projection is disposable and rebuildable. It never changes historical journal lines and is not a second accounting ledger.

This design is deliberate: an earlier local migration rehearsal correctly failed when it attempted to write a denormalized field to protected journal history. The accepted design uses a separate projection table instead, preserving journal immutability.

## What this standard does not claim

This baseline is safe for bounded operational reads, but it does **not** prove unlimited historical scale or enterprise-size performance.

Before claiming readiness for multi-year, high-volume production data, all of the following must be evidenced:

1. Seeded benchmarks at the intended volume (at least 100k, then 1m journal entries and representative journal lines).
2. `EXPLAIN ANALYZE` evidence on the deployed PostgreSQL version and indexes for the slowest financial reads.
3. p95 targets for pages, current-period summaries, and longer ranges, plus no missing/duplicate cursor records under concurrent posting.
4. A monthly fact/rollup or equivalent for multi-year invoice-register/report summaries; the current exact register summary still uses relational aggregation.
5. A specialized Treasury activity projection/query plan if the joined business-date sort is shown to be a bottleneck at benchmark scale.
6. Production monitoring, retention/archive policy, and async output/report jobs for unbounded exports.

The owner explicitly deferred the synthetic-volume benchmark for the current work. Therefore no document may claim that Baseer has been load-tested for five years, millions of transactions, or a production target volume.

## Evidence

The normal local verification set includes contracts/API/Web checks and builds, `verify:finance-gate-b-db`, `verify:finance-period-race`, and `verify:daily-sales-http`. The executed evidence and open acceptance gates belong in [QUALITY_EVIDENCE_AND_COMMITTEE_REGISTER.md](QUALITY_EVIDENCE_AND_COMMITTEE_REGISTER.md).
