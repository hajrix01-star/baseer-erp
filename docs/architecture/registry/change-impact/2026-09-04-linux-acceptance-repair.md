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

The deployable runtime audit sets npm's internal request timeout to 45 seconds
and disables npm's hidden transport retry. The repository's explicit bounded
retry remains the only npm retry policy. A returned vulnerability report or any
non-transient audit failure still fails immediately; the guard is not weakened.
This eliminates the prior five-minute hidden wait per retry while retaining the
same npm advisory source and the same command in Linux parity and GitHub.

The GitHub `quality` job has a bounded 30-minute window, aligned with the
Linux acceptance job. The prior 20-minute limit cancelled the run while its
runtime audit was still executing after all preceding quality gates had passed.
This grants time for one controlled registry recovery; it does not skip or
soften any quality, security, or release gate.

## Rollback

Revert the acceptance-repair commit. No migration, financial data, API contract,
or DNS state requires a rollback operation.
