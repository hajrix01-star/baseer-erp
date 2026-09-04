# BASEER-IMPACT-2026-09-04-LINUX-ACCEPTANCE-REPAIR

- **Registry:** `BASEER-ARCH v1.0`; **classification:** `CONTROLLED`.
- **Scope:** shared employee-profile attendance reads, profile-menu language action,
  report-stage navigation, and Linux-only visual acceptance references.

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

## Rollback

Revert the acceptance-repair commit. No migration, financial data, API contract,
or DNS state requires a rollback operation.
