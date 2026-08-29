import { localScheduleTime, parseBackupSchedule, scheduledPeriodKey, type BackupSchedulePolicy, type LocalScheduleTime } from './schedule-policy.js';

export type BackupRetentionArtifact = Readonly<{
  id: string;
  createdAt: Date;
  status: 'VERIFIED' | 'PENDING' | 'REJECTED' | 'EXPIRED';
  storageKey: string | null;
}>;

export type BackupScheduleAlert = Readonly<{
  severity: 'warning' | 'critical';
  code: 'SCHEDULER_DISABLED' | 'SCHEDULE_INVALID' | 'BACKUP_WINDOW_MISSED' | 'RECENT_BACKUP_FAILURES' | 'RETENTION_INVALID';
  policyId: string;
  message: string;
}>;

/** Matches the current BackupPolicy validation ceiling. Retention remains advisory in this gate. */
export const MAX_BACKUP_RETENTION_COUNT = 3650;

/** Retention is advisory only in this gate: candidates are never unlinked, expired, or deleted here. */
export function planBackupRetention(policy: BackupSchedulePolicy, artifacts: readonly BackupRetentionArtifact[]): readonly BackupRetentionArtifact[] {
  if (!Number.isInteger(policy.retentionCount) || policy.retentionCount < 1 || policy.retentionCount > MAX_BACKUP_RETENTION_COUNT) return [];
  return artifacts
    .filter((artifact) => artifact.status === 'VERIFIED' && artifact.storageKey !== null)
    .sort((left, right) => right.createdAt.valueOf() - left.createdAt.valueOf() || right.id.localeCompare(left.id))
    .slice(policy.retentionCount);
}

/**
 * Read-only schedule health assessment. Callers supply period completion and
 * failure counts from durable jobs; this monitor never starts a worker or
 * alters a job/artifact policy.
 */
export function assessBackupSchedule(input: Readonly<{
  policy: BackupSchedulePolicy;
  now: Date;
  runtimeEnabled: boolean;
  completedPeriodKeys: ReadonlySet<string>;
  failedJobsSinceLastWindow: number;
}>): readonly BackupScheduleAlert[] {
  const { policy } = input;
  if (policy.frequency === 'MANUAL' || !policy.enabled) return [];
  const parsed = parseBackupSchedule(policy.frequency, policy.scheduleJson);
  if (!parsed.ok) return [{ severity: 'critical', code: 'SCHEDULE_INVALID', policyId: policy.id, message: 'Backup policy schedule is invalid and was not evaluated.' }];
  const alerts: BackupScheduleAlert[] = [];
  if (!input.runtimeEnabled) {
    alerts.push({ severity: 'warning', code: 'SCHEDULER_DISABLED', policyId: policy.id, message: 'Backup policy is enabled but scheduler and worker configuration are not both enabled.' });
    return alerts;
  }
  if (!Number.isInteger(policy.retentionCount) || policy.retentionCount < 1 || policy.retentionCount > MAX_BACKUP_RETENTION_COUNT) {
    alerts.push({ severity: 'warning', code: 'RETENTION_INVALID', policyId: policy.id, message: 'Backup retention count is invalid; no deletion candidate is produced.' });
  }
  if (input.failedJobsSinceLastWindow > 0) {
    alerts.push({ severity: 'critical', code: 'RECENT_BACKUP_FAILURES', policyId: policy.id, message: 'One or more backup jobs failed since the prior schedule window.' });
  }
  const local = localScheduleTime(input.now, parsed.value.timezone);
  if (!isScheduledDate(policy.frequency, parsed.value, local) || !isAfterScheduledMinute(local, parsed.value.hour, parsed.value.minute)) return alerts;
  const periodKey = scheduledPeriodKey(policy.frequency, local);
  if (!input.completedPeriodKeys.has(periodKey)) {
    alerts.push({ severity: 'critical', code: 'BACKUP_WINDOW_MISSED', policyId: policy.id, message: 'The local backup schedule window elapsed without a completed backup period.' });
  }
  return alerts;
}

function isScheduledDate(frequency: BackupSchedulePolicy['frequency'], schedule: Readonly<{ weekday?: number; dayOfMonth?: number }>, local: LocalScheduleTime): boolean {
  return frequency === 'DAILY' || (frequency === 'WEEKLY' && local.weekday === schedule.weekday) || (frequency === 'MONTHLY' && local.day === schedule.dayOfMonth);
}
function isAfterScheduledMinute(local: LocalScheduleTime, hour: number, minute: number): boolean { return local.hour > hour || (local.hour === hour && local.minute > minute); }
