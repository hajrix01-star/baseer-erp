import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { DatabaseService } from '../database/database.service.js';
import { AttendanceService } from './attendance.service.js';

/**
 * Deletes only old coordinate evidence. The switch is explicit so a normal
 * interactive API instance stays inert; a durable database lease keeps a
 * one-per-day run safe across replicas and deployment restarts.
 */
@Injectable()
export class AttendanceLocationRetentionSchedulerService implements OnModuleInit, OnModuleDestroy {
  private bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly logger = new Logger(AttendanceLocationRetentionSchedulerService.name);

  constructor(private readonly database: DatabaseService, private readonly attendance: AttendanceService) {}

  onModuleInit() {
    if (process.env.BASEER_ATTENDANCE_LOCATION_RETENTION_SCHEDULER_ENABLED !== 'true') return;
    this.bootstrapTimer = setTimeout(() => { void this.runSafely(); }, 10_000);
    this.scheduleNextRun();
  }

  onModuleDestroy() {
    if (this.bootstrapTimer) clearTimeout(this.bootstrapTimer);
    if (this.scheduledTimer) clearTimeout(this.scheduledTimer);
  }

  async runScheduledRetention(now = new Date()) {
    const locked = await this.database.withSystemSchedulerLock('attendance-location-retention-v1', async () => {
      const tenantIds = await this.database.listTenantIdsForSystemScheduler();
      let purgedEvents = 0;
      for (const tenantId of tenantIds) purgedEvents += (await this.attendance.purgeExpiredLocationEvidenceForTenant(tenantId, now)).purgedEvents;
      return { status: 'COMPLETED' as const, tenantCount: tenantIds.length, purgedEvents };
    });
    return locked.acquired ? locked.result : { status: 'SKIPPED_LOCKED' as const };
  }

  private scheduleNextRun() {
    this.scheduledTimer = setTimeout(() => {
      void this.runSafely();
      this.scheduleNextRun();
    }, millisecondsUntilNextRiyadhRun());
  }

  private async runSafely() {
    try {
      await this.runScheduledRetention();
    } catch (error) {
      this.logger.error(`Attendance location-retention run failed: ${safeError(error)}`);
    }
  }
}

function millisecondsUntilNextRiyadhRun(now = new Date()) {
  const fields = new Map(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const next = new Date(Date.UTC(Number(fields.get('year')), Number(fields.get('month')) - 1, Number(fields.get('day')), 0, 17));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(1_000, next.getTime() - now.getTime());
}

function safeError(error: unknown) { return error instanceof Error ? error.message.slice(0, 500) : 'Unknown failure.'; }
