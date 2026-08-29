import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';
import { sha256CanonicalJson } from './archive-canonical-json.js';
import { BackupService } from './backup.service.js';
import { assessBackupSchedule } from './schedule-monitor.js';
import { backupScheduleRuntimeEnabled, currentScheduledPeriodKey, evaluateBackupPolicySchedule, type BackupSchedulePolicy } from './schedule-policy.js';

type StoredBackupPolicy = BackupSchedulePolicy & Readonly<{ createdByUserId: string }>;

type PolicyJob = Readonly<{
  id: string;
  idempotencyKey: string;
  policyId: string | null;
  requestedByUserId: string;
  requestHash: string;
  status: string;
}>;

export type BackupScheduleDispatchSummary = Readonly<{
  runtimeEnabled: boolean;
  lockAcquired: boolean;
  policiesScanned: number;
  jobsCreated: number;
  jobsReplayed: number;
  alertsLogged: number;
}>;

/**
 * Host-owned scheduler entry point. It is deliberately inert until an app
 * module calls runOnce on a cadence; both scheduler and worker env switches
 * must be true before it can enqueue any job.
 */
@Injectable()
export class BackupScheduleDispatcherService {
  private readonly logger = new Logger(BackupScheduleDispatcherService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly backups: BackupService,
  ) {}

  async runOnce(now: Date = new Date()): Promise<BackupScheduleDispatchSummary> {
    const runtimeEnabled = backupScheduleRuntimeEnabled();
    const locked = await this.database.withSystemSchedulerLock('backup-policy-dispatch-v1', async () => {
      const state = { policiesScanned: 0, jobsCreated: 0, jobsReplayed: 0, alertsLogged: 0 };
      for (const tenantId of await this.database.listTenantIdsForSystemScheduler()) {
        const policies = await this.database.inTenantTransaction(tenantId, (tx) => tx.backupPolicy.findMany({
          where: { tenantId, enabled: true, frequency: { not: 'MANUAL' } },
          select: {
            id: true, tenantId: true, companyId: true, enabled: true, frequency: true,
            scheduleJson: true, retentionCount: true, createdByUserId: true,
          },
          orderBy: [{ companyId: 'asc' }, { id: 'asc' }],
        }));
        for (const policy of policies) {
          state.policiesScanned += 1;
          state.alertsLogged += await this.evaluatePolicy({ ...policy, frequency: policy.frequency as BackupSchedulePolicy['frequency'] }, now, runtimeEnabled, state);
        }
      }
      return state;
    });
    if (!locked.acquired) return { runtimeEnabled, lockAcquired: false, policiesScanned: 0, jobsCreated: 0, jobsReplayed: 0, alertsLogged: 0 };
    return { runtimeEnabled, lockAcquired: true, ...locked.result };
  }

  private async evaluatePolicy(policy: StoredBackupPolicy, now: Date, runtimeEnabled: boolean, state: { jobsCreated: number; jobsReplayed: number; alertsLogged: number }): Promise<number> {
    const prefix = `backup-policy:${policy.id}:`;
    const jobs = await this.database.inTenantTransaction(policy.tenantId, (tx) => tx.backupJob.findMany({
      where: {
        tenantId: policy.tenantId,
        companyId: policy.companyId,
        kind: 'COMPANY_ARCHIVE_EXPORT',
        idempotencyKey: { startsWith: prefix },
      },
      select: { id: true, idempotencyKey: true, policyId: true, requestedByUserId: true, requestHash: true, status: true },
    })) as PolicyJob[];
    let recoveredAttachment = false;
    for (const job of jobs) {
      if (job.policyId === policy.id) continue;
      const periodKey = job.idempotencyKey.slice(prefix.length);
      const reason = scheduledReason(periodKey);
      const expectedRequestHash = sha256CanonicalJson({ companyId: policy.companyId, reason });
      if (job.policyId === null && job.requestedByUserId === policy.createdByUserId && job.requestHash === expectedRequestHash) {
        await this.attachPolicyOrRejectCollision(policy, job.id, job.idempotencyKey, reason);
        recoveredAttachment = true;
        continue;
      }
      // The deterministic prefix is reserved for this policy. Never allow a
      // user-created or differently-owned job to suppress/replace a schedule.
      this.logger.error(`SCHEDULE_IDEMPOTENCY_COLLISION: policy ${policy.id}. A non-policy job occupies a reserved schedule period.`);
      return 1;
    }
    const periodKeys = new Set(jobs.map((job) => job.idempotencyKey.slice(prefix.length)).filter((value) => value.length > 0));
    const evaluation = evaluateBackupPolicySchedule({ policy, now, runtimeEnabled, existingPeriodKeys: periodKeys });
    const completedPeriodKeys = new Set(jobs.filter((job) => job.status === 'PUBLISHED').map((job) => job.idempotencyKey.slice(prefix.length)));
    const currentPeriodKey = currentScheduledPeriodKey(policy, now);
    const currentFailedJobs = currentPeriodKey
      ? jobs.filter((job) => job.idempotencyKey === `${prefix}${currentPeriodKey}` && job.status === 'FAILED').length
      : 0;
    let alertsLogged = 0;
    for (const alert of assessBackupSchedule({ policy, now, runtimeEnabled, completedPeriodKeys, failedJobsSinceLastWindow: currentFailedJobs })) {
      alertsLogged += 1;
      const message = `${alert.code}: policy ${alert.policyId}. ${alert.message}`;
      if (alert.severity === 'critical') this.logger.error(message);
      else this.logger.warn(message);
    }
    if (!evaluation.eligible || !evaluation.dispatch) {
      if (recoveredAttachment) state.jobsReplayed += 1;
      return alertsLogged;
    }

    const reason = scheduledReason(evaluation.dispatch.periodKey);
    const receipt = await this.backups.createCompanyArchiveJob(
      { tenantId: policy.tenantId, companyId: policy.companyId, actorUserId: policy.createdByUserId },
      { idempotencyKey: evaluation.dispatch.idempotencyKey, reason },
    );
    const attached = await this.attachPolicyOrRejectCollision(policy, receipt.id, evaluation.dispatch.idempotencyKey, reason);
    if (attached === 'created') state.jobsCreated += 1;
    else state.jobsReplayed += 1;
    return alertsLogged;
  }

  /**
   * BackupService owns the idempotent job/audit transaction. The immediate
   * policy attachment makes a scheduled job queryable as policy-owned, while
   * accepting a safe replay after a crash between those two transactions.
   */
  private async attachPolicyOrRejectCollision(policy: StoredBackupPolicy, jobId: string, idempotencyKey: string, reason: string): Promise<'created' | 'replayed'> {
    return this.database.inTenantTransaction(policy.tenantId, async (tx) => {
      const job = await tx.backupJob.findFirst({
        where: { id: jobId, tenantId: policy.tenantId, companyId: policy.companyId, kind: 'COMPANY_ARCHIVE_EXPORT', idempotencyKey },
        select: { policyId: true, requestedByUserId: true, requestHash: true },
      });
      if (!job) throw new Error('Scheduled backup job disappeared before policy attachment.');
      if (job.policyId === policy.id) return 'replayed';
      const expectedRequestHash = sha256CanonicalJson({ companyId: policy.companyId, reason });
      if (job.policyId !== null || job.requestedByUserId !== policy.createdByUserId || job.requestHash !== expectedRequestHash) {
        throw new Error('Scheduled backup idempotency key collides with a non-policy job.');
      }
      const update = await tx.backupJob.updateMany({
        where: { id: jobId, tenantId: policy.tenantId, companyId: policy.companyId, policyId: null, requestedByUserId: policy.createdByUserId, requestHash: expectedRequestHash },
        data: { policyId: policy.id },
      });
      if (update.count !== 1) throw new Error('Scheduled backup policy attachment lost its compare-and-set race.');
      return 'created';
    });
  }
}

function scheduledReason(periodKey: string): string {
  return `Scheduled backup policy period ${periodKey}`;
}

/**
 * Optional host runner. AppModule must register this provider explicitly; it
 * remains inert unless the scheduler switch is exactly `true`. Dispatch still
 * requires the independent worker switch before it can create a job.
 */
@Injectable()
export class BackupScheduleRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BackupScheduleRunnerService.name);
  private startTimer: NodeJS.Timeout | undefined;
  private intervalTimer: NodeJS.Timeout | undefined;

  constructor(private readonly dispatcher: BackupScheduleDispatcherService) {}

  onModuleInit(): void {
    if (process.env.BASEER_BACKUP_SCHEDULER_ENABLED !== 'true') return;
    const tick = (): void => {
      void this.dispatcher.runOnce().catch(() => {
        // Do not expose database/provider details through operational logs.
        this.logger.error('Backup scheduler tick failed safely.');
      });
    };
    const delay = 60_000 - (Date.now() % 60_000);
    this.startTimer = setTimeout(() => {
      tick();
      this.intervalTimer = setInterval(tick, 60_000);
    }, delay);
    this.startTimer.unref();
  }

  onModuleDestroy(): void {
    if (this.startTimer) clearTimeout(this.startTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    this.startTimer = undefined;
    this.intervalTimer = undefined;
  }
}
