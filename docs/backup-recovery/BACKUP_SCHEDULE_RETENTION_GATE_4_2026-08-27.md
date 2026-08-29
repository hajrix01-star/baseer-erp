# Backup schedule, retention, and monitoring — Gate 4 (2026-08-27)

## Status and boundary

This gate adds a code-owned, opt-in schedule dispatcher and runner, not a new HTTP endpoint, storage deletion job, import, or restore path. The current company archive remains `PARTIAL_CONFIGURATION_ONLY` and is not eligible for restoration.

`BackupScheduleRunnerService` is intentionally inert unless it is registered as an application provider and `BASEER_BACKUP_SCHEDULER_ENABLED=true`. When active, it calls the dispatcher on minute boundaries. The dispatcher independently requires `BASEER_BACKUP_WORKER_ENABLED=true` before it can enqueue a job. It never enables the worker itself.

## Schedule format and due semantics

`BackupPolicy.scheduleJson` is strict JSON; unknown or missing fields fail closed.

| Frequency | Required JSON |
| --- | --- |
| `DAILY` | `{ "timezone": "Asia/Riyadh", "hour": 3, "minute": 15 }` |
| `WEEKLY` | Daily fields plus `"weekday": 0` through `6` (`Sun=0`) |
| `MONTHLY` | Daily fields plus `"dayOfMonth": 1` through `28` |
| `MANUAL` | Never dispatched by this scheduler |

The dispatcher uses `Intl.DateTimeFormat` with the named IANA timezone and is due only in the exact local minute. It does not silently catch up a missed time or guess through an invalid/DST schedule; the monitor reports a missed window instead. Each schedule period has a deterministic idempotency key: `backup-policy:<policy UUID>:<daily|weekly|monthly period>`. A database `SystemSchedulerLease` prevents concurrent replica scans, while `BackupService.createCompanyArchiveJob` supplies the job-level idempotency protection.

The dispatcher obtains the policy creator as the internal job actor and calls `BackupService.createCompanyArchiveJob`. It then compare-and-set attaches the policy ID. At the beginning of a later scan it reconciles the narrow crash window between those two transactions only when the policy creator and canonical request hash match exactly. A colliding job with a different policy, actor, or canonical request hash is logged as `SCHEDULE_IDEMPOTENCY_COLLISION` and rejected rather than adopted.

## Monitoring and retention

The dispatcher is read-side monitored through Nest `Logger` only: invalid schedules, enabled-but-disabled runtime, missed due windows, and a failed current-period job result in a code/severity log. There is no external email, webhook, UI notification, or silent retry in this gate.

`planBackupRetention` returns only `VERIFIED` artifacts beyond `retentionCount`, ordered newest-first. It does not unlink files, update an artifact state, expire a record, or remove encryption keys. The validator accepts the current policy ceiling of `1..3650`; invalid values produce no candidate and a monitoring warning. Retention deletion remains deliberately unimplemented until an approved lifecycle/audit workflow exists.

## Required application wiring

Register both `BackupScheduleDispatcherService` and `BackupScheduleRunnerService` as providers in the API module. Registration alone remains safe with the default environment: the runner starts only with `BASEER_BACKUP_SCHEDULER_ENABLED=true`, and job creation additionally needs `BASEER_BACKUP_WORKER_ENABLED=true`.

The database must include the existing `SystemSchedulerLease` migration before the runner is enabled. The runner is an in-process dispatch clock, not a worker; long export work remains owned and fenced by the backup worker lease. Operations should emit external alerts from the protected log/monitoring system and test the configured whole-server backup separately.

## Evidence

After building the API, run:

```powershell
npm run check --workspace @baseer-erp/api
npm run build --workspace @baseer-erp/api
node apps/api/dist/backup/schedule-retention.policy-verification.js
```

The verifier covers Riyadh due calculation, duplicate-period suppression, invalid timezone rejection, both runtime switches, advisory retention and its 3650 ceiling, and overdue/failure alerts. It is a focused policy verifier, not a live PostgreSQL scheduler integration test.
