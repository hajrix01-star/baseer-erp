import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { OwnerDailyBriefService } from "./owner-daily-brief.service.js";

/**
 * Produces one immutable receipt for the completed Riyadh business day. This
 * is intentionally opt-in so ordinary interactive API instances never start
 * background work just because they serve a request.
 */
@Injectable()
export class OwnerDailyBriefSchedulerService implements OnModuleInit, OnModuleDestroy {
  private bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduledTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly logger = new Logger(OwnerDailyBriefSchedulerService.name);

  constructor(
    private readonly database: DatabaseService,
    private readonly briefs: OwnerDailyBriefService,
  ) {}

  onModuleInit() {
    if (process.env.BASEER_OWNER_DAILY_BRIEF_SCHEDULER_ENABLED !== "true") return;
    // A short startup run fills a missed receipt after a deployment; the unique
    // constraint preserves any already-issued historical report.
    this.bootstrapTimer = setTimeout(() => { void this.runSafely(); }, 8_000);
    this.scheduleNextRun();
  }

  onModuleDestroy() {
    if (this.bootstrapTimer) clearTimeout(this.bootstrapTimer);
    if (this.scheduledTimer) clearTimeout(this.scheduledTimer);
  }

  async runScheduledBriefs() {
    const locked = await this.database.withSystemSchedulerLock(
      "owner-daily-brief-snapshots-v1",
      async () => {
        const tenantIds = await this.database.listTenantIdsForSystemScheduler();
        let createdCount = 0;
        for (const tenantId of tenantIds) {
          const result = await this.briefs.createScheduledSnapshot(tenantId);
          if (result.created) createdCount += 1;
        }
        return { status: "COMPLETED" as const, tenantCount: tenantIds.length, createdCount };
      },
    );
    return locked.acquired ? locked.result : { status: "SKIPPED_LOCKED" as const };
  }

  private scheduleNextRun() {
    this.scheduledTimer = setTimeout(() => {
      void this.runSafely();
      this.scheduleNextRun();
    }, millisecondsUntilNextRiyadhRun());
  }

  private async runSafely() {
    try {
      await this.runScheduledBriefs();
    } catch (error) {
      // The next day/startup retry remains available; an optional report job
      // must never take down an API process through an unhandled rejection.
      this.logger.error(`Owner daily-brief run failed: ${safeError(error)}`);
    }
  }
}

function millisecondsUntilNextRiyadhRun(now = new Date()) {
  const hour = configuredNumber("BASEER_OWNER_DAILY_BRIEF_SCHEDULE_HOUR", 12, 0, 23);
  const minute = configuredNumber("BASEER_OWNER_DAILY_BRIEF_SCHEDULE_MINUTE", 0, 0, 59);
  const fields = new Map(new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(now).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  const next = new Date(Date.UTC(Number(fields.get("year")), Number(fields.get("month")) - 1, Number(fields.get("day")), hour - 3, minute));
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return Math.max(1_000, next.getTime() - now.getTime());
}

function configuredNumber(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function safeError(error: unknown) { return error instanceof Error ? error.message.slice(0, 500) : "Unknown failure."; }
