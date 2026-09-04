# BASEER-IMPACT-2026-09-04-LINUX-ACCEPTANCE-REPAIR

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `CONTROLLED`.
- **Scope:** shared employee-profile attendance reads, profile-menu language action,
  report-stage navigation, purchase-calendar mobile geometry assertion, and
  Linux-only visual acceptance references.

## Decision and boundaries

The repair keeps API routes, permissions, financial calculations, database state,
and deployment topology unchanged. The employee profile now tolerates a temporary
partial attendance-schedule read and renders its existing empty state rather than
failing the entire file. Acceptance fixtures now supply the documented attendance
read receipts and follow the current inline profile, drawer, report-stage, and
profile-menu semantics.

Linux Chromium snapshots were regenerated only for the shared Basira connection
and application-shell surfaces after focused checks showed the differences are the
intentional current visual contract. Windows references were not copied or used.

## Required verification

1. Focused Linux checks for HR, decision, operations, theme navigation, and the
   affected visual tests.
2. Full isolated `web-acceptance` job in Linux.
3. Full isolated `quality` job in Linux before `main` is updated.

The local runner declares `BASEER_CI_PARITY=true` solely to skip GitHub's
artifact-upload action, which requires a short-lived GitHub runtime token not
available to `act`. The GitHub workflow preserves its `always()` artifact
behavior because that flag is absent there; build and acceptance commands are
unchanged in both environments.

The purchase-calendar assertion waits for the post-navigation mobile layout box
before comparing the ISO field with its calendar action. It still requires both
controls to be visible and spatially separated, and still verifies the body
portal and outside-click close behavior; only the transient drawer-close race is
removed.

The decision-company-event acceptance test waits for the visible `To` calendar
to apply the updated `From` bound before submitting the invalid range. It proves
the user-facing calendar rule and then the schema message, instead of racing a
React state update immediately after typing. The event-date contract itself is
unchanged.

The deployable runtime audit sets npm's internal request timeout to 45 seconds
and disables npm's hidden transport retry. The repository's explicit bounded
retry remains the only npm retry policy. If every attempt ends in an identified
transient npm-registry failure (such as a 503 or connection reset), the same
lockfile-derived, production-only dependency graph is checked through the
independent OSV advisory source. Only package names and versions are sent to
that fallback. A vulnerability, a malformed advisory response, or an unavailable
fallback source fails the job; the guard is still fail-closed. This removes the
single-registry availability dependency without treating an outage as success.

OSV currently associates the `xlsx` package name with two advisories that apply
through releases `0.19.2` and `0.20.1`, even when the exact SheetJS CDN release
`0.20.3` is installed. The fallback recognises only those two advisory IDs when
the package version, official CDN URL, and lockfile integrity hash all exactly
match the reviewed release. SheetJS documents the respective fixes at
`https://cdn.sheetjs.com/advisories/CVE-2023-30533` and
`https://cdn.sheetjs.com/advisories/CVE-2024-22363`. Any other `xlsx` version,
source, integrity value, or advisory remains a failure.

The GitHub `quality` job has a bounded 30-minute window, aligned with the
Linux acceptance job. The prior 20-minute limit cancelled the run while its
runtime audit was still executing after all preceding quality gates had passed.
This grants time for one controlled registry recovery; it does not skip or
soften any quality, security, or release gate.

## Rollback

Revert the acceptance-repair commit. No migration, financial data, API contract,
or DNS state requires a rollback operation.
