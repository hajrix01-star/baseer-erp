# Financial read scale and period standard — 2026-08-18

## Decision

All period-aware financial workspaces open on the **current Riyadh business month**. The shared `defaultBaseerPeriodRange()` is the only default. Users may then choose a single day, month, multiple months, quarter, year, or a custom date range through `BaseerPeriodFilter`.

This applies to the current Sales, operational dashboard, unified invoice register, and Treasury views. Master data (suppliers, categories, vault setup) is timeless and does not receive a cosmetic period filter. Open-credit is an **as-of** liability view: it must include unpaid invoices from previous months, so it deliberately does not discard them on the first day of a new month.

## Read-scale rules

- Financial register filters, counts, money totals, ordering, and pagination are calculated on the server.
- The invoice register uses a stable keyset cursor with a default page of 50 and a maximum of 100 records. It is ordered by business date, posting timestamp, and id.
- Credit summary amounts cover every open due. Credit detail records use the same bounded cursor-page pattern.
- No browser is allowed to calculate monetary totals from a partially loaded page.
- A database index supports the register’s company/status/date/posting/id access path.
- Client options remain bounded; a future unbounded master-data chooser must use server-backed search rather than loading every option.

## Evidence and remaining work

`verify:daily-sales-http` now proves the register’s bounded server page and full-scope summary, plus the credit workspace’s full-scope open count with a one-record page. Contract/API/Web type checks must pass for every change.

This is a local-development scale foundation, not a production capacity claim. Before production with five-plus years of high-volume data, add a repeatable seeded volume benchmark, EXPLAIN/ANALYZE evidence on the deployed database, retention/archival policy, and cursorized historical Sales and supplier-payment reports.
