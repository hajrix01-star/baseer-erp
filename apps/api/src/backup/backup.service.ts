import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { DatabaseService } from '../database/database.service.js';
import type { CreateCompanyArchiveBackupRequest } from '@baseer-erp/contracts';
import { sha256CanonicalJson } from './archive-canonical-json.js';
import { assertBackupWorkerTransition, statusForWorkerStage, type BackupWorkerTransition } from './backup-worker-state.js';

export interface BackupCompanyContext {
  tenantId: string;
  companyId: string;
  actorUserId: string;
}

export interface BackupWorkerJobScope {
  tenantId: string;
  companyId: string;
  jobId: string;
  workerLeaseOwnerId: string;
  workerLeaseFence: bigint;
}

export interface PublishedCompanyArchiveArtifact {
  formatVersion: string;
  storageKey: string;
  filename: string;
  sha256: string;
  byteSize: bigint;
}

const COMPANY_ARCHIVE_KIND = 'COMPANY_ARCHIVE_EXPORT' as const;

function isTerminalWorkerStage(stage: string): boolean {
  return stage === 'PUBLISHED' || stage === 'FAILED' || stage === 'CANCELLED';
}

/**
 * Gate 1 only persists intent and exposes real persisted progress. A later
 * worker owns export, encryption, artifact creation, and all state advances.
 */
@Injectable()
export class BackupService {
  constructor(private readonly database: DatabaseService) {}

  async createCompanyArchiveJob(context: BackupCompanyContext, request: CreateCompanyArchiveBackupRequest) {
    const requestHash = this.hash({ companyId: context.companyId, reason: request.reason ?? null });
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const existing = await tx.backupJob.findFirst({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          requestedByUserId: context.actorUserId,
          kind: COMPANY_ARCHIVE_KIND,
          idempotencyKey: request.idempotencyKey,
        },
      });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new ConflictException('Idempotency key has already been used for a different backup request.');
        return this.receipt(existing);
      }

      const correlationId = randomUUID();
      try {
        const job = await tx.backupJob.create({
          data: {
            id: randomUUID(),
            tenantId: context.tenantId,
            companyId: context.companyId,
            requestedByUserId: context.actorUserId,
            kind: COMPANY_ARCHIVE_KIND,
            idempotencyKey: request.idempotencyKey,
            requestHash,
            correlationId,
            checkpointJson: { version: 1, nextStage: 'PRECHECK' },
          },
        });
        await this.appendAudit(tx, context, {
          jobId: job.id,
          action: 'backup.job.created',
          correlationId,
          metadata: { kind: COMPANY_ARCHIVE_KIND, reason: request.reason ?? null, status: job.status },
        });
        return this.receipt(job);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error;
        const replay = await tx.backupJob.findFirst({
          where: { tenantId: context.tenantId, companyId: context.companyId, requestedByUserId: context.actorUserId, kind: COMPANY_ARCHIVE_KIND, idempotencyKey: request.idempotencyKey },
        });
        if (!replay) throw error;
        if (replay.requestHash !== requestHash) throw new ConflictException('Idempotency key has already been used for a different backup request.');
        return this.receipt(replay);
      }
    });
  }

  async listJobs(context: BackupCompanyContext, limit: number) {
    const jobs = await this.database.inTenantTransaction(context.tenantId, (tx) => tx.backupJob.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId },
      orderBy: [{ queuedAt: 'desc' }, { id: 'desc' }],
      take: limit,
    }));
    return jobs.map((job) => this.receipt(job));
  }

  async readJob(context: BackupCompanyContext, jobId: string) {
    const job = await this.database.inTenantTransaction(context.tenantId, (tx) => tx.backupJob.findFirst({
      where: { id: jobId, tenantId: context.tenantId, companyId: context.companyId },
    }));
    if (!job) throw new NotFoundException('Backup job was not found.');
    return this.receipt(job);
  }

  async listAuditEvents(context: BackupCompanyContext, limit: number) {
    const events = await this.database.inTenantTransaction(context.tenantId, (tx) => tx.backupAuditEvent.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: { id: true, action: true, actorUserId: true, correlationId: true, previousHash: true, eventHash: true, createdAt: true },
    }));
    return events.map((event) => ({
      id: event.id,
      action: event.action,
      actorUserId: event.actorUserId,
      correlationId: event.correlationId,
      previousHashPrefix: event.previousHash?.slice(0, 12) ?? null,
      eventHashPrefix: event.eventHash.slice(0, 12),
      createdAt: event.createdAt.toISOString(),
    }));
  }

  /**
   * Worker-only durable state transition.  It deliberately has no controller
   * entry point: queue consumers call it after an idempotent checkpoint is on
   * disk.  The transaction lock serializes multiple worker processes that may
   * race after a restart.
   */
  async advanceWorkerJob(scope: BackupWorkerJobScope, transition: BackupWorkerTransition) {
    return this.database.inTenantTransaction(scope.tenantId, async (tx) => {
      const current = await tx.backupJob.findFirst({ where: { id: scope.jobId, tenantId: scope.tenantId, companyId: scope.companyId, kind: COMPANY_ARCHIVE_KIND } });
      if (!current) throw new NotFoundException('Backup job was not found.');
      assertBackupWorkerTransition(current.stage, transition);
      await this.beforeWorkerTransitionCompareAndSet(scope);
      const claimed = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "BackupJob"
        SET
          "status" = ${statusForWorkerStage(transition.stage)}::"BackupJobStatus",
          "stage" = ${transition.stage},
          "progressPercent" = ${transition.progressPercent},
          "checkpointJson" = ${JSON.stringify(transition.checkpoint)}::jsonb,
          "recordsProcessed" = CASE WHEN ${transition.recordsProcessed !== undefined} THEN ${transition.recordsProcessed ?? 0} ELSE "recordsProcessed" END,
          "recordsTotal" = CASE WHEN ${transition.recordsTotal !== undefined} THEN ${transition.recordsTotal ?? null} ELSE "recordsTotal" END,
          "bytesProcessed" = CASE WHEN ${transition.bytesProcessed !== undefined} THEN ${transition.bytesProcessed ?? 0n} ELSE "bytesProcessed" END,
          "bytesTotal" = CASE WHEN ${transition.bytesTotal !== undefined} THEN ${transition.bytesTotal ?? null} ELSE "bytesTotal" END,
          "lastErrorCode" = CASE WHEN ${Boolean(transition.error)} THEN ${transition.error?.code.slice(0, 120) ?? null} ELSE "lastErrorCode" END,
          "lastErrorMessage" = CASE WHEN ${Boolean(transition.error)} THEN ${transition.error?.message.slice(0, 1000) ?? null} ELSE "lastErrorMessage" END,
          "startedAt" = CASE WHEN "startedAt" IS NULL THEN CURRENT_TIMESTAMP ELSE "startedAt" END,
          "completedAt" = CASE WHEN ${isTerminalWorkerStage(transition.stage)} THEN CURRENT_TIMESTAMP ELSE "completedAt" END,
          "attemptCount" = CASE WHEN ${current.stage === 'QUEUED'} THEN "attemptCount" + 1 ELSE "attemptCount" END,
          "updatedAt" = CURRENT_TIMESTAMP
        WHERE "id" = ${scope.jobId}::uuid
          AND "tenantId" = ${scope.tenantId}::uuid
          AND "companyId" = ${scope.companyId}::uuid
          AND "kind" = ${COMPANY_ARCHIVE_KIND}::"BackupJobKind"
          AND "workerLeaseOwnerId" = ${scope.workerLeaseOwnerId}::uuid
          AND "workerLeaseFence" = ${scope.workerLeaseFence}
          AND "workerLeaseExpiresAt" > CURRENT_TIMESTAMP
        RETURNING "id"
      `;
      if (!claimed[0]) throw new ConflictException('Backup worker lease was lost; this worker is fenced from further job mutation.');
      const updated = await tx.backupJob.findUniqueOrThrow({ where: { id: current.id } });
      await this.appendAudit(tx, { tenantId: scope.tenantId, companyId: scope.companyId }, {
        jobId: current.id,
        action: `backup.job.${transition.stage.toLowerCase()}`,
        correlationId: current.correlationId,
        metadata: {
          stage: transition.stage,
          progressPercent: transition.progressPercent,
          recordsProcessed: transition.recordsProcessed ?? current.recordsProcessed,
          recordsTotal: transition.recordsTotal === undefined ? current.recordsTotal : transition.recordsTotal,
          bytesProcessed: (transition.bytesProcessed ?? current.bytesProcessed).toString(),
          bytesTotal: (transition.bytesTotal === undefined ? current.bytesTotal : transition.bytesTotal)?.toString() ?? null,
          errorCode: transition.error?.code ?? null,
        },
      });
      return this.receipt(updated);
    });
  }

  /**
   * Worker-only state read.  It intentionally returns the durable checkpoint
   * rather than a UI receipt, so a restarted worker can make a fail-closed
   * decision before touching staged archive files.
   */
  async readWorkerJob(scope: BackupWorkerJobScope) {
    const job = await this.database.inTenantTransaction(scope.tenantId, (tx) => tx.backupJob.findFirst({
      where: { id: scope.jobId, tenantId: scope.tenantId, companyId: scope.companyId, kind: COMPANY_ARCHIVE_KIND },
      select: {
        id: true, tenantId: true, companyId: true, correlationId: true, stage: true, status: true,
        checkpointJson: true, recordsProcessed: true, recordsTotal: true, bytesProcessed: true, bytesTotal: true,
        workerLeaseOwnerId: true, workerLeaseFence: true, workerLeaseExpiresAt: true,
      },
    }));
    if (!job) throw new NotFoundException('Backup job was not found.');
    if (job.workerLeaseOwnerId !== scope.workerLeaseOwnerId
      || job.workerLeaseFence !== scope.workerLeaseFence
      || !job.workerLeaseExpiresAt
      || job.workerLeaseExpiresAt <= new Date()) {
      throw new ConflictException('Backup worker lease was lost; this worker is fenced from further job mutation.');
    }
    return job;
  }

  /**
   * Persists only a verified, already-published artifact.  The storage layer
   * performs the publication verification; this method makes an interrupted
   * worker replay idempotent without ever making an incomplete artifact visible.
   */
  async recordPublishedCompanyArchive(scope: BackupWorkerJobScope, artifact: PublishedCompanyArchiveArtifact) {
    return this.database.inTenantTransaction(scope.tenantId, async (tx) => {
      await this.beforeArtifactCompareAndSet(scope);
      const claimed = await tx.$queryRaw<Array<{ id: string }>>`
        UPDATE "BackupJob"
        SET "updatedAt" = "updatedAt"
        WHERE "id" = ${scope.jobId}::uuid
          AND "tenantId" = ${scope.tenantId}::uuid
          AND "companyId" = ${scope.companyId}::uuid
          AND "kind" = ${COMPANY_ARCHIVE_KIND}::"BackupJobKind"
          AND "stage" IN ('VERIFY_HASHES', 'PUBLISHED')
          AND "workerLeaseOwnerId" = ${scope.workerLeaseOwnerId}::uuid
          AND "workerLeaseFence" = ${scope.workerLeaseFence}
          AND "workerLeaseExpiresAt" > CURRENT_TIMESTAMP
        RETURNING "id"
      `;
      if (!claimed[0]) throw new ConflictException('Backup worker lease was lost or the artifact is not eligible for publication.');
      const existing = await tx.backupArtifact.findUnique({ where: { jobId: scope.jobId } });
      if (existing) {
        if (existing.status !== 'VERIFIED' || existing.formatVersion !== artifact.formatVersion || existing.storageKey !== artifact.storageKey || existing.sha256 !== artifact.sha256 || existing.byteSize !== artifact.byteSize) {
          throw new ConflictException('The job already has a different archive artifact.');
        }
        return existing;
      }
      return tx.backupArtifact.create({
        data: {
          id: randomUUID(),
          tenantId: scope.tenantId,
          companyId: scope.companyId,
          jobId: scope.jobId,
          status: 'VERIFIED',
          formatVersion: artifact.formatVersion,
          storageKey: artifact.storageKey,
          filename: artifact.filename,
          sha256: artifact.sha256,
          byteSize: artifact.byteSize,
          verifiedAt: new Date(),
        },
      });
    });
  }

  /** Records authorization only; it never receives a storage path or key material. */
  async recordCompanyArchiveDownloadAuthorized(context: BackupCompanyContext, artifact: Readonly<{ jobId: string; artifactId: string; sha256: string; byteSize: bigint }>): Promise<void> {
    await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.appendAudit(tx, context, {
        jobId: artifact.jobId,
        action: 'backup.artifact.download.authorized',
        correlationId: randomUUID(),
        metadata: {
          artifactId: artifact.artifactId,
          formatVersion: 'baseer-encrypted-company-archive/v1',
          sha256Prefix: artifact.sha256.slice(0, 16),
          byteSize: artifact.byteSize.toString(),
          disposition: 'attachment',
          range: 'none',
        },
      });
    });
  }

  /**
   * The HTTP stream reports its source-side terminal state separately from
   * authorization.  A source completion is not represented as proof that a
   * browser saved the file: the client can still abandon its own destination.
   */
  async recordCompanyArchiveDownloadOutcome(
    context: BackupCompanyContext,
    artifact: Readonly<{ jobId: string; artifactId: string; byteSize: bigint }>,
    outcome: 'source_completed' | 'source_aborted' | 'source_failed',
    bytesRead: bigint,
  ): Promise<void> {
    await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.appendAudit(tx, context, {
        jobId: artifact.jobId,
        action: `backup.artifact.download.${outcome}`,
        correlationId: randomUUID(),
        metadata: {
          artifactId: artifact.artifactId,
          bytesRead: bytesRead.toString(),
          expectedByteSize: artifact.byteSize.toString(),
          sourceOnly: true,
        },
      });
    });
  }

  /**
   * Policy mutation callers invoke this inside the same tenant transaction as
   * the policy write. A sensitive scheduler setting must never commit without
   * its append-only evidence.
   */
  async recordBackupPolicyChangeInTransaction(
    tx: Prisma.TransactionClient,
    context: BackupCompanyContext,
    policyId: string,
    action: 'backup.policy.created' | 'backup.policy.updated',
    metadata: Prisma.InputJsonValue,
  ): Promise<void> {
    await this.appendAudit(tx, context, { action, correlationId: randomUUID(), metadata: { policyId, ...(metadata as object) } });
  }

  private async appendAudit(tx: Prisma.TransactionClient, context: Pick<BackupCompanyContext, 'tenantId' | 'companyId'> & Partial<Pick<BackupCompanyContext, 'actorUserId'>>, input: {
    jobId?: string;
    action: string;
    correlationId: string;
    metadata: Prisma.InputJsonValue;
  }) {
    // A transaction-scoped advisory lock provides one deterministic event chain
    // for each company while retaining the database append-only trigger.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`backup-audit:${context.tenantId}:${context.companyId}`}, 0))`;
    const previous = await tx.backupAuditEvent.findFirst({
      where: { tenantId: context.tenantId, companyId: context.companyId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { eventHash: true },
    });
    const eventHash = this.hash({ previousHash: previous?.eventHash ?? null, action: input.action, correlationId: input.correlationId, jobId: input.jobId, metadata: input.metadata });
    await tx.backupAuditEvent.create({
      data: {
        id: randomUUID(),
        tenantId: context.tenantId,
        companyId: context.companyId,
        ...(input.jobId ? { jobId: input.jobId } : {}),
        ...(context.actorUserId ? { actorUserId: context.actorUserId } : {}),
        action: input.action,
        correlationId: input.correlationId,
        previousHash: previous?.eventHash ?? null,
        eventHash,
        metadataJson: input.metadata,
      },
    });
  }

  /** Test seam for proving compare-and-set fencing under a deliberate race. */
  protected async beforeWorkerTransitionCompareAndSet(_scope: BackupWorkerJobScope): Promise<void> {}

  /** Test seam for proving an old worker cannot create an artifact after loss. */
  protected async beforeArtifactCompareAndSet(_scope: BackupWorkerJobScope): Promise<void> {}


  private receipt(job: {
    id: string; companyId: string; kind: typeof COMPANY_ARCHIVE_KIND; status: string; stage: string; progressPercent: number;
    recordsProcessed: number; recordsTotal: number | null; bytesProcessed: bigint; bytesTotal: bigint | null;
    attemptCount: number; lastErrorCode: string | null; lastErrorMessage: string | null; correlationId: string;
    queuedAt: Date; startedAt: Date | null; completedAt: Date | null; updatedAt: Date;
  }) {
    return {
      id: job.id, companyId: job.companyId, kind: job.kind, status: job.status, stage: job.stage,
      progressPercent: job.progressPercent, recordsProcessed: job.recordsProcessed, recordsTotal: job.recordsTotal,
      bytesProcessed: job.bytesProcessed.toString(), bytesTotal: job.bytesTotal?.toString() ?? null,
      attemptCount: job.attemptCount, lastErrorCode: job.lastErrorCode, lastErrorMessage: job.lastErrorMessage,
      correlationId: job.correlationId, queuedAt: job.queuedAt.toISOString(), startedAt: job.startedAt?.toISOString() ?? null,
      completedAt: job.completedAt?.toISOString() ?? null, updatedAt: job.updatedAt.toISOString(),
      // This gate's allow-list is intentionally not a recovery point. The
      // explicit fields travel with every job receipt so a client cannot infer
      // full restore eligibility from a PUBLISHED stage alone.
      archiveCoverage: 'PARTIAL_CONFIGURATION_ONLY' as const,
      restoreEligible: false as const,
    };
  }

  private hash(value: unknown): string {
    return sha256CanonicalJson(value);
  }
}
