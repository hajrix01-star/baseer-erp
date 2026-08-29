import { strict as assert } from 'node:assert';

import { BackupPolicyService } from './backup-policy.service.js';

const tenantId = '11111111-1111-4111-8111-111111111111';
const companyId = '22222222-2222-4222-8222-222222222222';
const actorUserId = '33333333-3333-4333-8333-333333333333';

/**
 * Failure injection for the policy/audit transaction boundary. The fake DB
 * commits staged rows only after the callback resolves; an append-audit error
 * must therefore leave no enabled schedule behind.
 */
async function main(): Promise<void> {
  const committed: unknown[] = [];
  const database = {
    async inTenantTransaction<T>(_tenant: string, work: (transaction: never) => Promise<T>): Promise<T> {
      const staged: unknown[] = [];
      const transaction = {
        backupPolicy: {
          findFirst: async () => null,
          create: async ({ data }: { data: unknown }) => {
            const policy = { ...data as object, createdAt: new Date('2026-08-27T00:00:00.000Z'), updatedAt: new Date('2026-08-27T00:00:00.000Z') };
            staged.push(policy);
            return policy;
          },
        },
      };
      const result = await work(transaction as never);
      committed.push(...staged);
      return result;
    },
  };
  const failingAudit = {
    async recordBackupPolicyChangeInTransaction(): Promise<void> {
      throw new Error('injected append-only audit failure');
    },
  };
  const service = new BackupPolicyService(database as never, failingAudit as never);
  await assert.rejects(
    () => service.upsert({ tenantId, companyId, actorUserId }, {
      name: 'default', enabled: true, retentionCount: 7,
      schedule: { frequency: 'DAILY', schedule: { timezone: 'Asia/Riyadh', hour: 3, minute: 15 } },
    }),
    /injected append-only audit failure/,
  );
  assert.equal(committed.length, 0, 'A policy must not commit when its audit append fails.');
  process.stdout.write('backup policy audit atomicity verification passed\n');
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exitCode = 1;
});
