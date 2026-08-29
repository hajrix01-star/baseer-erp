/** Run after API build: `node apps/api/dist/backup/schedule-retention.policy-verification.js`. */
import assert from 'node:assert/strict';

import { assessBackupSchedule, planBackupRetention } from './schedule-monitor.js';
import { backupScheduleRuntimeEnabled, currentScheduledPeriodKey, evaluateBackupPolicySchedule, type BackupSchedulePolicy } from './schedule-policy.js';

const policy: BackupSchedulePolicy = {
  id: '10000000-0000-4000-8000-000000000001', tenantId: '20000000-0000-4000-8000-000000000001', companyId: '30000000-0000-4000-8000-000000000001',
  enabled: true, frequency: 'DAILY', scheduleJson: { timezone: 'Asia/Riyadh', hour: 3, minute: 15 }, retentionCount: 2,
};

function main(): void {
  const dueAt = new Date('2026-08-27T00:15:30.000Z'); // 03:15 Asia/Riyadh
  const due = evaluateBackupPolicySchedule({ policy, now: dueAt, runtimeEnabled: true, existingPeriodKeys: new Set() });
  assert.equal(due.reason, 'DUE');
  assert.equal(due.dispatch?.periodKey, 'daily:2026-08-27');
  assert.equal(currentScheduledPeriodKey(policy, new Date('2026-08-27T00:17:00.000Z')), 'daily:2026-08-27');
  assert.equal(evaluateBackupPolicySchedule({ policy, now: dueAt, runtimeEnabled: true, existingPeriodKeys: new Set(['daily:2026-08-27']) }).reason, 'DUPLICATE_PERIOD');
  assert.equal(evaluateBackupPolicySchedule({ policy, now: dueAt, runtimeEnabled: false, existingPeriodKeys: new Set() }).reason, 'RUNTIME_DISABLED');
  assert.equal(backupScheduleRuntimeEnabled({ BASEER_BACKUP_SCHEDULER_ENABLED: 'true', BASEER_BACKUP_WORKER_ENABLED: 'false' }), false);
  assert.equal(evaluateBackupPolicySchedule({ policy: { ...policy, scheduleJson: { timezone: 'Invalid/Zone', hour: 3, minute: 15 } }, now: dueAt, runtimeEnabled: true, existingPeriodKeys: new Set() }).reason, 'INVALID_SCHEDULE');

  const retention = planBackupRetention(policy, [
    { id: 'new', createdAt: new Date('2026-08-27T00:00:00.000Z'), status: 'VERIFIED', storageKey: 'encrypted/new' },
    { id: 'middle', createdAt: new Date('2026-08-26T00:00:00.000Z'), status: 'VERIFIED', storageKey: 'encrypted/middle' },
    { id: 'old', createdAt: new Date('2026-08-25T00:00:00.000Z'), status: 'VERIFIED', storageKey: 'encrypted/old' },
    { id: 'pending', createdAt: new Date('2026-08-24T00:00:00.000Z'), status: 'PENDING', storageKey: 'encrypted/pending' },
  ]);
  assert.deepEqual(retention.map((artifact) => artifact.id), ['old'], 'Retention returns candidates only; it never mutates storage.');
  assert.equal(planBackupRetention({ ...policy, retentionCount: 3650 }, retention).length, 0, 'The current policy ceiling is 3650, not 365.');
  assert.equal(assessBackupSchedule({ policy: { ...policy, retentionCount: 3651 }, now: dueAt, runtimeEnabled: true, completedPeriodKeys: new Set(), failedJobsSinceLastWindow: 0 }).some((alert) => alert.code === 'RETENTION_INVALID'), true);
  const alerts = assessBackupSchedule({ policy, now: new Date('2026-08-27T00:17:00.000Z'), runtimeEnabled: true, completedPeriodKeys: new Set(), failedJobsSinceLastWindow: 1 });
  assert.deepEqual(alerts.map((alert) => alert.code).sort(), ['BACKUP_WINDOW_MISSED', 'RECENT_BACKUP_FAILURES']);
  assert.equal(assessBackupSchedule({ policy, now: dueAt, runtimeEnabled: false, completedPeriodKeys: new Set(), failedJobsSinceLastWindow: 0 })[0]?.code, 'SCHEDULER_DISABLED');
  console.log('Backup schedule and retention policy verification passed: timezone due evaluation, duplicate prevention, fail-closed runtime, advisory retention, and overdue/failure alerts.');
}

main();
