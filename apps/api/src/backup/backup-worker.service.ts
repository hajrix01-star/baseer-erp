import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { DatabaseService } from '../database/database.service.js';
import { BackupJobStatus } from '../generated/prisma/client.js';
import { CompanyArchiveExporter } from './company-archive-exporter.js';

const ACTIVE_STATUSES: readonly BackupJobStatus[] = [
  BackupJobStatus.QUEUED,
  BackupJobStatus.PRECHECK,
  BackupJobStatus.CONSISTENT_SNAPSHOT,
  BackupJobStatus.EXPORT_DATA,
  BackupJobStatus.EXPORT_ATTACHMENTS,
  BackupJobStatus.PACKAGE_COMPRESS_ENCRYPT,
  BackupJobStatus.VERIFY_HASHES,
];

/**
 * Opt-in, bounded, durable-job worker for a private single-server deployment.
 * It is deliberately independent from HTTP: an API restart leaves the job in
 * its persisted stage and the next enabled worker scan resumes it. A durable
 * per-job lease prevents concurrent replicas from advancing the same job.
 */
@Injectable()
export class BackupWorkerService implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly logger = new Logger(BackupWorkerService.name);
  private readonly workerId = randomUUID();
  private running = false;

  constructor(
    private readonly database: DatabaseService,
    private readonly exporter: CompanyArchiveExporter,
  ) {}

  onModuleInit(): void {
    if (process.env.BASEER_BACKUP_WORKER_ENABLED !== 'true') return;
    this.assertRequiredConfiguration();
    const intervalMs = configuredInterval();
    this.bootstrapTimer = setTimeout(() => { void this.runSafely(); }, 5_000);
    this.timer = setInterval(() => { void this.runSafely(); }, intervalMs);
  }

  onModuleDestroy(): void {
    if (this.bootstrapTimer) clearTimeout(this.bootstrapTimer);
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce(): Promise<Readonly<{ status: 'COMPLETED' | 'SKIPPED_LOCKED'; processedJobs: number; tenantCount: number }>> {
    const tenantIds = await this.database.listTenantIdsForSystemScheduler();
    let processedJobs = 0;
    for (const tenantId of tenantIds) {
      processedJobs += await this.runTenantOnce(tenantId);
    }
    return { status: 'COMPLETED', processedJobs, tenantCount: tenantIds.length };
  }

  /** Bounded tenant worker pass; exposed for local integration verification only. */
  async runTenantOnce(tenantId: string): Promise<number> {
      const jobs = await this.database.inTenantTransaction(tenantId, (tx) => tx.backupJob.findMany({
        where: {
          kind: 'COMPANY_ARCHIVE_EXPORT', status: { in: [...ACTIVE_STATUSES] },
          OR: [{ workerLeaseExpiresAt: null }, { workerLeaseExpiresAt: { lte: new Date() } }],
        },
        orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }],
        take: configuredJobsPerTenant(),
        select: { id: true, companyId: true },
      }));
      let processedJobs = 0;
      for (const job of jobs) {
        const scope = await this.claim(tenantId, job.companyId, job.id);
        if (!scope) continue;
        await this.runClaimedJob(scope);
        processedJobs += 1;
      }
      return processedJobs;
  }

  private async runSafely(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runOnce();
    } catch (error) {
      // The next interval/startup retry remains available. Individual exporter
      // failures become durable FAILED jobs with their own correlation record.
      this.logger.error(`Backup worker scan failed: ${safeError(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async claim(tenantId: string, companyId: string, jobId: string): Promise<Readonly<{ tenantId: string; companyId: string; jobId: string; workerLeaseOwnerId: string; workerLeaseFence: bigint }> | undefined> {
    const now = new Date();
    const leaseExpiresAt = new Date(now.valueOf() + 120_000);
    const result = await this.database.inTenantTransaction(tenantId, async (tx) => {
      const claimed = await tx.backupJob.updateMany({
      where: {
        id: jobId, tenantId, companyId, kind: 'COMPANY_ARCHIVE_EXPORT', status: { in: [...ACTIVE_STATUSES] },
        OR: [{ workerLeaseExpiresAt: null }, { workerLeaseExpiresAt: { lte: now } }],
      },
      data: {
        workerLeaseOwnerId: this.workerId,
        workerLeaseFence: { increment: 1 },
        workerLeaseExpiresAt: leaseExpiresAt,
        workerHeartbeatAt: now,
        status: 'QUEUED',
        stage: 'QUEUED',
        progressPercent: 0,
        checkpointJson: { version: 1, nextStage: 'PRECHECK' },
        recordsProcessed: 0,
        recordsTotal: null,
        bytesProcessed: 0n,
        bytesTotal: null,
        lastErrorCode: null,
        lastErrorMessage: null,
        completedAt: null,
      },
      });
      if (claimed.count !== 1) return undefined;
      const job = await tx.backupJob.findFirst({
        where: { id: jobId, tenantId, companyId, workerLeaseOwnerId: this.workerId },
        select: { workerLeaseFence: true },
      });
      if (!job) throw new Error('Claimed backup job could not be re-read.');
      return { tenantId, companyId, jobId, workerLeaseOwnerId: this.workerId, workerLeaseFence: job.workerLeaseFence };
    });
    return result;
  }

  private async runClaimedJob(scope: Readonly<{ tenantId: string; companyId: string; jobId: string; workerLeaseOwnerId: string; workerLeaseFence: bigint }>): Promise<void> {
    const heartbeat = setInterval(() => { void this.renewLease(scope); }, 30_000);
    try {
      await this.exporter.export(scope);
    } finally {
      clearInterval(heartbeat);
      await this.releaseLease(scope);
    }
  }

  private async renewLease(scope: Readonly<{ tenantId: string; companyId: string; jobId: string; workerLeaseOwnerId: string; workerLeaseFence: bigint }>): Promise<void> {
    const now = new Date();
    const result = await this.database.inTenantTransaction(scope.tenantId, (tx) => tx.backupJob.updateMany({
      where: { id: scope.jobId, tenantId: scope.tenantId, companyId: scope.companyId, workerLeaseOwnerId: scope.workerLeaseOwnerId, workerLeaseFence: scope.workerLeaseFence, workerLeaseExpiresAt: { gt: now }, status: { in: [...ACTIVE_STATUSES] } },
      data: { workerHeartbeatAt: now, workerLeaseExpiresAt: new Date(now.valueOf() + 120_000) },
    }));
    if (result.count !== 1) this.logger.error(`Backup worker lease lost for job ${scope.jobId}; durable job writes are fenced.`);
  }

  private async releaseLease(scope: Readonly<{ tenantId: string; companyId: string; jobId: string; workerLeaseOwnerId: string; workerLeaseFence: bigint }>): Promise<void> {
    await this.database.inTenantTransaction(scope.tenantId, (tx) => tx.backupJob.updateMany({
      where: { id: scope.jobId, tenantId: scope.tenantId, companyId: scope.companyId, workerLeaseOwnerId: scope.workerLeaseOwnerId, workerLeaseFence: scope.workerLeaseFence },
      data: { workerLeaseExpiresAt: new Date() },
    })).catch((error: unknown) => this.logger.error(`Backup worker lease release failed: ${safeError(error)}`));
  }

  private assertRequiredConfiguration(): void {
    const required = [
      'BASEER_BACKUP_ARCHIVE_STORAGE_ROOT',
      'BASEER_ARCHIVE_APPLICATION_VERSION',
      'BASEER_ARCHIVE_SCHEMA_VERSION',
    ];
    const missing = required.filter((name) => !process.env[name]?.trim());
    if (missing.length > 0) throw new Error(`Backup worker is enabled but required configuration is missing: ${missing.join(', ')}.`);
  }
}

function configuredInterval(): number {
  const parsed = Number(process.env.BASEER_BACKUP_WORKER_INTERVAL_MS);
  return Number.isInteger(parsed) && parsed >= 5_000 && parsed <= 300_000 ? parsed : 30_000;
}

function configuredJobsPerTenant(): number {
  const parsed = Number(process.env.BASEER_BACKUP_WORKER_MAX_JOBS_PER_TENANT);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 10 ? parsed : 1;
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 500) : 'Unknown worker failure.';
}
