import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly client: PrismaClient;
  private readonly schedulerOwnerId = randomUUID();

  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL must be configured for the Baseer API.');
    }

    this.client = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    });
  }

  async inTenantTransaction<T>(
    tenantId: string,
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
    options?: { maxWait?: number; timeout?: number },
  ): Promise<T> {
    return this.client.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT set_config('app.tenant_id', ${tenantId}, true)
      `;
      return operation(transaction);
    }, options);
  }

  /**
   * Backup exporters use one read-only repeatable snapshot so a company archive
   * cannot contain rows observed before and after concurrent business writes.
   * This intentionally remains a caller-owned bounded transaction; no worker
   * may open nested tenant transactions while it is active.
   */
  async inTenantReadSnapshot<T>(
    tenantId: string,
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.client.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT set_config('app.tenant_id', ${tenantId}, true)
      `;
      await transaction.$executeRawUnsafe('SET TRANSACTION READ ONLY');
      return operation(transaction);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  }

  /**
   * Reserved for code-owned host schedulers that need to fan out into the
   * tenant-isolated transaction method above. It exposes IDs only; every
   * tenant data operation must still use inTenantTransaction().
   */
  async listTenantIdsForSystemScheduler(): Promise<string[]> {
    const tenants = await this.client.tenant.findMany({ select: { id: true } });
    return tenants.map((tenant) => tenant.id);
  }

  /**
   * Coordinates code-owned schedulers across API replicas without holding an
   * interactive transaction over tenant work. The previous transaction-scoped
   * advisory lock kept a Prisma transaction open while the callback opened
   * additional tenant transactions; under the pg adapter this can invalidate
   * the outer transaction and terminate the API process. A short durable lease
   * separates lock acquisition from the callback and survives a crashed worker.
   */
  async withSystemSchedulerLock<T>(lockName: string, operation: () => Promise<T>): Promise<
    | { acquired: true; result: T }
    | { acquired: false }
  > {
    const leaseDurationMs = 10 * 60 * 1_000;
    const now = new Date();
    const expiresAt = new Date(now.valueOf() + leaseDurationMs);
    const rows = await this.client.$queryRaw<Array<{ lockName: string }>>`
      INSERT INTO "SystemSchedulerLease" ("lockName", "ownerId", "leaseExpiresAt", "updatedAt")
      VALUES (${lockName}, ${this.schedulerOwnerId}::uuid, ${expiresAt}, ${now})
      ON CONFLICT ("lockName") DO UPDATE
        SET "ownerId" = EXCLUDED."ownerId", "leaseExpiresAt" = EXCLUDED."leaseExpiresAt", "updatedAt" = EXCLUDED."updatedAt"
        WHERE "SystemSchedulerLease"."leaseExpiresAt" <= ${now}
      RETURNING "lockName"
    `;
    if (!rows[0]) return { acquired: false };
    try {
      return { acquired: true, result: await operation() };
    } finally {
      await this.client.$executeRaw`
        DELETE FROM "SystemSchedulerLease"
        WHERE "lockName" = ${lockName} AND "ownerId" = ${this.schedulerOwnerId}::uuid
      `;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
