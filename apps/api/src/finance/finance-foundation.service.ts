import { randomUUID } from 'node:crypto';

import { ConflictException, Injectable } from '@nestjs/common';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceAccountStatus,
  FinanceCategoryStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { RequestContext } from '../observability/request-context.js';
import {
  FINANCE_BASE_ACCOUNT_SEEDS,
  FINANCE_BASE_CATEGORY_SEEDS,
  FINANCE_BASE_CATEGORY_HIERARCHY_SEEDS,
} from './finance-foundation-seeds.js';

const BASE_SEED_VERSION = 4;

export type FinanceFoundationReceipt = Readonly<{
  initialized: boolean;
  accountCount: number;
  categoryCount: number;
  baseSeedVersion: number;
}>;

@Injectable()
export class FinanceFoundationService {
  constructor(private readonly database: DatabaseService) {}

  async initializeForCompany(
    context: TrustedCompanyActorContext,
  ): Promise<FinanceFoundationReceipt> {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) =>
      this.initializeInTransaction(transaction, context),
    );
  }

  async initializeInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
  ): Promise<FinanceFoundationReceipt> {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:finance-foundation`}, 0))
    `;

    const existingProfile = await transaction.companyFinanceProfile.findFirst({
      where: { tenantId: context.tenantId, companyId: context.companyId },
    });
    if (existingProfile && existingProfile.baseSeedVersion > BASE_SEED_VERSION) {
      throw new ConflictException('The company finance foundation uses an unsupported future seed version.');
    }

    const existingAccounts = await transaction.financeAccount.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId },
      select: { id: true, code: true },
    });
    const accountsByCode = new Map(existingAccounts.map((account) => [account.code, account.id]));
    for (const seed of FINANCE_BASE_ACCOUNT_SEEDS) {
      if (accountsByCode.has(seed.code)) continue;
      const account = await transaction.financeAccount.create({
        data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, code: seed.code, nameAr: seed.nameAr, nameEn: seed.nameEn, type: seed.type, systemKey: seed.systemKey, isSystem: true, status: FinanceAccountStatus.ACTIVE },
      });
      accountsByCode.set(seed.code, account.id);
    }

    const existingCategories = await transaction.financeCategory.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId },
      select: { id: true, code: true, accountId: true, parentId: true },
    });
    const categoriesByCode = new Map(existingCategories.map((category) => [category.code, category]));
    for (const seed of FINANCE_BASE_CATEGORY_SEEDS) {
      if (categoriesByCode.has(seed.code)) continue;
      const accountId = accountsByCode.get(seed.accountCode);
      if (!accountId) throw new ConflictException('Missing required seeded account ' + seed.accountCode + '.');
      const category = await transaction.financeCategory.create({
        data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, accountId, code: seed.code, nameAr: seed.nameAr, nameEn: seed.nameEn, kind: seed.kind, status: FinanceCategoryStatus.ACTIVE, sortOrder: seed.sortOrder },
        select: { id: true, code: true, accountId: true, parentId: true },
      });
      categoriesByCode.set(category.code, category);
    }

    const parentCodes = [...new Set(FINANCE_BASE_CATEGORY_HIERARCHY_SEEDS.map((seed) => seed.parentCode))];
    for (const seed of FINANCE_BASE_CATEGORY_HIERARCHY_SEEDS) {
      if (categoriesByCode.has(seed.code)) continue;
      const parent = categoriesByCode.get(seed.parentCode);
      if (!parent?.accountId) throw new ConflictException('Missing required seeded category ' + seed.parentCode + '.');
      const category = await transaction.financeCategory.create({
        data: {
          id: randomUUID(),
          tenantId: context.tenantId,
          companyId: context.companyId,
          parentId: parent.id,
          accountId: parent.accountId,
          code: seed.code,
          nameAr: seed.nameAr,
          nameEn: seed.nameEn,
          kind: seed.kind,
          status: FinanceCategoryStatus.ACTIVE,
          isPosting: true,
          sortOrder: seed.sortOrder,
        },
        select: { id: true, code: true, accountId: true, parentId: true },
      });
      categoriesByCode.set(category.code, category);
    }
    // A parent provides navigation only. Financial documents must select a posting leaf.
    await transaction.financeCategory.updateMany({
      where: { tenantId: context.tenantId, companyId: context.companyId, code: { in: parentCodes }, parentId: null },
      data: { isPosting: false },
    });
    if (!existingProfile) {
      await transaction.companyFinanceProfile.create({
        data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, baseSeedVersion: BASE_SEED_VERSION, accountingMode: 'management_cash', vatAccountingEnabled: false },
      });
    } else if (existingProfile.baseSeedVersion < BASE_SEED_VERSION) {
      await transaction.companyFinanceProfile.update({ where: { id: existingProfile.id }, data: { baseSeedVersion: BASE_SEED_VERSION } });
    }
    const [accountCount, categoryCount] = await Promise.all([
      transaction.financeAccount.count({ where: { tenantId: context.tenantId, companyId: context.companyId } }),
      transaction.financeCategory.count({ where: { tenantId: context.tenantId, companyId: context.companyId } }),
    ]);
    const receipt: FinanceFoundationReceipt = {
      initialized: !existingProfile,
      accountCount,
      categoryCount,
      baseSeedVersion: BASE_SEED_VERSION,
    };
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        tenantId: context.tenantId,
        companyId: context.companyId,
        actorUserId: context.actorUserId,
        action: 'finance.foundation.initialized',
        entityType: 'CompanyFinanceProfile',
        entityId: context.companyId,
        requestId: RequestContext.correlationId() ?? randomUUID(),
        afterJson: receipt as Prisma.InputJsonValue,
      },
    });
    return receipt;
  }
}
