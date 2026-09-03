# Central calendar and global text-search scope — 2026-09-03

- **Classification:** `CONTROLLED`
- **Registry:** `BASEER-ARCH v1.0` (working-tree verified 2026-09-03)
- **Owners consulted:** `platform-data-contracts` for the shared period value contract; `finance-accounting`, `people-attendance-payroll`, and `operations-inventory-commercial` for their consuming read screens.
- **Change:** extend the central `BaseerPeriodFilter` with an explicit `ALL` period, remove the two route-local date-picker adapters that duplicated the central picker, and make text search query the complete authorised business history rather than the currently displayed period.
- **Boundary:** period filtering still controls report/list presentation when no text search is active. Text search does not bypass tenant, company, capability, or pagination limits. Purchase-invoice entry dates remain untouched; the exception does not create a second filter/calendar implementation.
- **Data and API:** no schema, endpoint, or permission contract changes. `ALL` is represented as the earliest supported ISO business date through the current Riyadh business date, so existing typed date parameters remain valid. Existing server-side company scoping and page sizes remain the enforcement point.
- **Risk and mitigation:** broad reads can return more historic matches. Search-facing endpoints already use bounded pages; no client-side fetch-all is introduced. Aggregate/report screens retain their existing API behavior.
- **Verification plan:** focused component/value tests for the `ALL` period and request scope; TypeScript check; production web build; focused Playwright coverage for a filtered search where available.
- **Rollback:** revert the central period-value/filter change and its affected workspace callers together. No data migration or persisted preference changes are involved.
