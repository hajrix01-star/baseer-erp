# Reporting R0-B — Durable Report-Run Boundary

**Status:** Implemented in the API schema/service/migration; no report API, report calculation, UI or output job is released by this gate.
**Effective version:** `REPORTING_R0_B_2026_08_20`
**Purpose:** Keep one future report's totals, evidence pages and export tied to the same sealed-ledger boundary while financial posting continues.

## Decision

`FinanceLedgerRevision` is a tenant/company-local monotonic counter. `JournalPostingService` advances it inside the same database transaction that seals a normal journal entry or a reversal; the resulting value is persisted in `FinanceJournalEntry.ledgerRevision`.

Existing sealed evidence is migrated as one baseline revision (`1`) per company. New entries receive later revisions. A journal reversal is a new sealed opposite entry with its own later revision; its original retains its earlier revision. Therefore a report run at revision `N` uses:

```text
isSealed = true
AND status IN (POSTED, REVERSED)
AND ledgerRevision <= N
```

This includes the original effect and excludes an as-yet-unseen later reversal, so a historic run is not rewritten by the current status. A current report may include both source and reversal when both revisions are within its boundary.

## `ReportRun` record

`ReportRun` is an immutable, tenant-RLS-protected server record. It stores the report code, definition version, canonical options, economic `asOf` date, ledger revision, eligible-predicate version, source-coverage metadata, optional projection watermark, optional P&L-mapping version/checksum, checksum, creator and expiry. Its metadata may only transition operationally from `READY` to `EXPIRED`; it cannot be edited or deleted.

`ReportRunService` is deliberately service-only in R0-B. It creates a run inside the trusted tenant transaction, derives its revision from `FinanceLedgerRevision`, canonicalises JSON options and coverage metadata, and writes an audit receipt. It exposes no controller. Future report code must pass the run ID through every table page, drill-down and output request and constrain each read to its stored boundary.

## Safety and scope

- The report checksum changes if the ledger revision, definition, options, coverage, mapping version, or projection watermark changes.
- Ledger reversals cannot predate the original business date; a historical account may be reversed even after archival, although ordinary posting still requires an active account.
- The database migration adds RLS/`FORCE ROW LEVEL SECURITY` to both R0-B tables and a database immutability guard for `ReportRun`.
- This is not a materialised report result, a durable output job, a report catalogue, or an authorization API. Those remain Gate R0/R1 work.

## Verification

`npm run verify:reporting-r0-b-policy` builds the API and confirms deterministic canonical options/checksum behaviour and revision sensitivity. Database deployment/integration verification remains part of the normal migration environment; this change has not fabricated report data or an output.
