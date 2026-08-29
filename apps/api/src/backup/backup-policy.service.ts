import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { UpsertBackupPolicyRequest } from '@baseer-erp/contracts';

import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';
import { BackupService, type BackupCompanyContext } from './backup.service.js';

@Injectable()
export class BackupPolicyService {
  constructor(private readonly database: DatabaseService, private readonly backups: BackupService) {}

  async list(context: BackupCompanyContext, limit: number) {
    const policies = await this.database.inTenantTransaction(context.tenantId, (tx) => tx.backupPolicy.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId },
      orderBy: [{ name: 'asc' }], take: limit,
    }));
    return policies.map((policy) => this.receipt(policy));
  }

  async upsert(context: BackupCompanyContext, request: UpsertBackupPolicyRequest) {
    const record = await this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const existing = await tx.backupPolicy.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, name: request.name } });
      const data = {
        enabled: request.enabled,
        frequency: request.schedule.frequency,
        scheduleJson: request.schedule.schedule === null ? Prisma.JsonNull : request.schedule.schedule as Prisma.InputJsonValue,
        retentionCount: request.retentionCount,
      };
      const record = existing
        ? { created: false, policy: await tx.backupPolicy.update({ where: { id: existing.id }, data }) }
        : { created: true, policy: await tx.backupPolicy.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, name: request.name, createdByUserId: context.actorUserId, ...data } }) };
      await this.backups.recordBackupPolicyChangeInTransaction(tx, context, record.policy.id, record.created ? 'backup.policy.created' : 'backup.policy.updated', {
        enabled: record.policy.enabled, frequency: record.policy.frequency, retentionCount: record.policy.retentionCount,
      });
      return record;
    });
    return this.receipt(record.policy);
  }

  async read(context: BackupCompanyContext, policyId: string) {
    const policy = await this.database.inTenantTransaction(context.tenantId, (tx) => tx.backupPolicy.findFirst({ where: { id: policyId, tenantId: context.tenantId, companyId: context.companyId } }));
    if (!policy) throw new NotFoundException('Backup policy was not found.');
    return this.receipt(policy);
  }

  private receipt(policy: { id: string; companyId: string; name: string; enabled: boolean; frequency: string; scheduleJson: unknown; retentionCount: number; createdAt: Date; updatedAt: Date }) {
    return { id: policy.id, companyId: policy.companyId, name: policy.name, enabled: policy.enabled, frequency: policy.frequency, schedule: policy.scheduleJson, retentionCount: policy.retentionCount, createdAt: policy.createdAt.toISOString(), updatedAt: policy.updatedAt.toISOString() };
  }
}
