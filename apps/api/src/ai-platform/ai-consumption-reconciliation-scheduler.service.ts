import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";

import { DatabaseService } from "../database/database.service.js";
import { AiConsumptionGuardService } from "./ai-consumption-guard.service.js";

/**
 * Converts lapsed pre-provider reservations into an auditable conservative
 * outcome even when no later AI request arrives. It never contacts a provider
 * or releases cost: only authoritative usage may settle the reservation.
 */
@Injectable()
export class AiConsumptionReconciliationSchedulerService implements OnModuleInit, OnModuleDestroy {
  private bootstrapTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduledTimer: ReturnType<typeof setInterval> | null = null;
  private readonly logger = new Logger(AiConsumptionReconciliationSchedulerService.name);

  constructor(private readonly database: DatabaseService, private readonly consumption: AiConsumptionGuardService) {}

  onModuleInit() {
    if (process.env.BASEER_AI_CONSUMPTION_RECONCILIATION_SCHEDULER_ENABLED === "false") return;
    this.bootstrapTimer = setTimeout(() => { void this.runSafely(); }, 15_000);
    this.scheduledTimer = setInterval(() => { void this.runSafely(); }, 5 * 60 * 1_000);
  }

  onModuleDestroy() {
    if (this.bootstrapTimer) clearTimeout(this.bootstrapTimer);
    if (this.scheduledTimer) clearInterval(this.scheduledTimer);
  }

  async runScheduledReconciliation(now = new Date()) {
    const locked = await this.database.withSystemSchedulerLock("ai-consumption-reconciliation-v1", async () => {
      const tenantIds = await this.database.listTenantIdsForSystemScheduler();
      let markedUnknown = 0;
      for (const tenantId of tenantIds) markedUnknown += (await this.consumption.reconcileExpiredReservationsForTenant(tenantId, now)).markedUnknown;
      return { status: "COMPLETED" as const, tenantCount: tenantIds.length, markedUnknown };
    });
    return locked.acquired ? locked.result : { status: "SKIPPED_LOCKED" as const };
  }

  private async runSafely() {
    try {
      const result = await this.runScheduledReconciliation();
      if (result.status === "COMPLETED" && result.markedUnknown) this.logger.warn(JSON.stringify({ event: "basira.provider_outcome_reconciliation_required", ...result }));
    } catch (error) {
      this.logger.error(`Basira consumption reconciliation failed: ${error instanceof Error ? error.message.slice(0, 500) : "Unknown failure."}`);
    }
  }
}
