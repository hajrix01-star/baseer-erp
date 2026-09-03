# BASEER-IMPACT-2026-09-03-MOBILE-CALENDAR-AND-PAYROLL-ACCEPTANCE

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `CONTROLLED`.
- **Scope:** the shared Baseer date/month picker and the payroll-run draft
  editor's accessible labels and preview-failure receipt.

## Evidence and decision

Linux mobile acceptance found that the central calendar's small-screen bottom
popover could cover the field trigger that opened it.  The calendar remained
openable and closable with Escape or an outside press, but its visible close
action was not reliably reachable by pointer.  The payroll editor also passed
the shared month picker its English fallback label in an Arabic session, and
reduced a known, localized payroll-preview failure to a generic service error.

The repair keeps the central picker and the server as the sole source of
financial and payroll truth.  It adds an owned close action inside the
popover, gives the month picker its locale-specific accessible name, and
preserves the server's localized message only for the explicitly classified
`PAYROLL_PREVIEW_FAILED` receipt.  No route, schema, authorization rule,
calculation, or API payload changes.

## Verification and rollback

- Run focused decision-calendar and payroll browser acceptance checks on Linux,
  then the full isolated web-acceptance gate and quality gate.
- Roll back the UI and receipt handling as one commit.  No data migration,
  server state, deployment, or DNS change is involved.
