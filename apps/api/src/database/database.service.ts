import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';

import { Prisma, PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class DatabaseService implements OnModuleDestroy {
  readonly client: PrismaClient;

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
  ): Promise<T> {
    return this.client.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT set_config('app.tenant_id', ${tenantId}, true)
      `;
      return operation(transaction);
    });
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
   * Coordinates code-owned schedulers across API replicas. The callback may
   * open normal tenant transactions; the lock-owning transaction deliberately
   * spans that callback and never carries tenant data itself.
   */
  async withSystemSchedulerLock<T>(lockName: string, operation: () => Promise<T>): Promise<
    | { acquired: true; result: T }
    | { acquired: false }
  > {
    return this.client.$transaction(async (transaction) => {
      const rows = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext(${lockName})) AS "acquired"
      `;
      if (!rows[0]?.acquired) return { acquired: false };
      return { acquired: true, result: await operation() };
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
