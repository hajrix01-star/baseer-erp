import { randomUUID } from 'node:crypto';

import { ConflictException, Injectable } from '@nestjs/common';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceAccountStatus,
  FinanceCategoryStatus,
  FinanceSupplierDueStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { RequestContext } from '../observability/request-context.js';
import {
  FINANCE_BASE_ACCOUNT_SEEDS,
  FINANCE_BASE_CATEGORY_SEEDS,
  FINANCE_BASE_CATEGORY_HIERARCHY_SEEDS,
  STANDARD_SUPPLIER_SEEDS,
} from './finance-foundation-seeds.js';

// v7 adds the utility parent/leaves and supplier suggestions for recurring costs.
/** The server is the single owner of the required financial foundation version. */
export const BASE_FINANCE_SEED_VERSION = 8;

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
    if (existingProfile && existingProfile.baseSeedVersion > BASE_FINANCE_SEED_VERSION) {
      throw new ConflictException('The company finance foundation uses an unsupported future seed version.');
    }

    const existingAccounts = await transaction.financeAccount.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId },
      select: { id: true, code: true, type: true, systemKey: true },
    });
    const accountsByCode = new Map(existingAccounts.map((account) => [account.code, account.id]));
    for (const seed of FINANCE_BASE_ACCOUNT_SEEDS) {
      const existing = existingAccounts.find((account) => account.code === seed.code);
      if (existing) {
        // A migration may create an evidence-matched account before the
        // foundation runs. Adopt it only when its accounting type agrees with
        // the canonical seed; this restores required system behaviour (such
        // as SALES_REVENUE) without replacing a user-defined account.
        if (existing.type !== seed.type) throw new ConflictException(`Existing account ${seed.code} conflicts with the required system account type.`);
        if (!existing.systemKey) await transaction.financeAccount.update({ where: { id: existing.id }, data: { systemKey: seed.systemKey, isSystem: true } });
        continue;
      }
      const account = await transaction.financeAccount.create({
        data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, code: seed.code, nameAr: seed.nameAr, nameEn: seed.nameEn, type: seed.type, systemKey: seed.systemKey, isSystem: true, status: FinanceAccountStatus.ACTIVE },
      });
      accountsByCode.set(seed.code, account.id);
    }

    const existingCategories = await transaction.financeCategory.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId },
      select: { id: true, code: true, accountId: true, parentId: true, kind: true },
    });
    const categoriesByCode = new Map(existingCategories.map((category) => [category.code, category]));
    for (const seed of FINANCE_BASE_CATEGORY_SEEDS) {
      const accountId = accountsByCode.get(seed.accountCode);
      if (!accountId) throw new ConflictException('Missing required seeded account ' + seed.accountCode + '.');
      const existing = categoriesByCode.get(seed.code);
      if (existing) {
        if (existing.kind !== seed.kind) throw new ConflictException(`Existing category ${seed.code} conflicts with the required system category kind.`);
        if (existing.accountId !== accountId) {
          await transaction.financeCategory.update({ where: { id: existing.id }, data: { accountId } });
          categoriesByCode.set(seed.code, { ...existing, accountId });
        }
        continue;
      }
      const category = await transaction.financeCategory.create({
        data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, accountId, code: seed.code, nameAr: seed.nameAr, nameEn: seed.nameEn, kind: seed.kind, status: FinanceCategoryStatus.ACTIVE, sortOrder: seed.sortOrder },
        select: { id: true, code: true, accountId: true, parentId: true, kind: true },
      });
      categoriesByCode.set(category.code, category);
    }

    const parentCodes = [...new Set(FINANCE_BASE_CATEGORY_HIERARCHY_SEEDS.map((seed) => seed.parentCode))];
    for (const seed of FINANCE_BASE_CATEGORY_HIERARCHY_SEEDS) {
      const parent = categoriesByCode.get(seed.parentCode);
      if (!parent?.accountId) throw new ConflictException('Missing required seeded category ' + seed.parentCode + '.');
      const existing = categoriesByCode.get(seed.code);
      if (existing) {
        if (existing.kind !== seed.kind) throw new ConflictException(`Existing category ${seed.code} conflicts with the required hierarchy category kind.`);
        if (existing.parentId !== parent.id || existing.accountId !== parent.accountId) {
          await transaction.financeCategory.update({ where: { id: existing.id }, data: { parentId: parent.id, accountId: parent.accountId } });
          categoriesByCode.set(seed.code, { ...existing, parentId: parent.id, accountId: parent.accountId });
        }
        continue;
      }
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
        select: { id: true, code: true, accountId: true, parentId: true, kind: true },
      });
      categoriesByCode.set(category.code, category);
    }
    // A parent provides navigation only. Financial documents must select a posting leaf.
    await transaction.financeCategory.updateMany({
      where: { tenantId: context.tenantId, companyId: context.companyId, code: { in: parentCodes }, parentId: null },
      data: { isPosting: false },
    });
    if (existingProfile && existingProfile.baseSeedVersion < BASE_FINANCE_SEED_VERSION) {
      await this.upgradeUtilities(transaction, context, categoriesByCode);
    }
    if (!existingProfile) {
      await transaction.companyFinanceProfile.create({
        data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, baseSeedVersion: BASE_FINANCE_SEED_VERSION, accountingMode: 'management_cash', vatAccountingEnabled: true, functionalCurrencyCode: 'SAR' },
      });
    } else if (existingProfile.baseSeedVersion < BASE_FINANCE_SEED_VERSION) {
      await transaction.companyFinanceProfile.update({ where: { id: existingProfile.id }, data: { baseSeedVersion: BASE_FINANCE_SEED_VERSION } });
    }
    const [accountCount, categoryCount] = await Promise.all([
      transaction.financeAccount.count({ where: { tenantId: context.tenantId, companyId: context.companyId } }),
      transaction.financeCategory.count({ where: { tenantId: context.tenantId, companyId: context.companyId } }),
    ]);
    const receipt: FinanceFoundationReceipt = {
      initialized: !existingProfile,
      accountCount,
      categoryCount,
      baseSeedVersion: BASE_FINANCE_SEED_VERSION,
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

  private async upgradeUtilities(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    categoriesByCode: ReadonlyMap<string, { id: string; code: string; accountId: string | null; parentId: string | null }>,
  ): Promise<void> {
    const utilityCodesBySupplierName = new Map(
      STANDARD_SUPPLIER_SEEDS
        .filter((supplier) => ['SAUDI_ENERGY', 'STC', 'MOBILY', 'ZAIN_SAUDI', 'SALAM', 'GO_TELECOM', 'NATIONAL_WATER_COMPANY'].includes(supplier.key))
        .map((supplier) => [supplier.nameAr, supplier.categoryCode]),
    );
    const utilities = await transaction.financeSupplier.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId, nameAr: { in: [...utilityCodesBySupplierName.keys()] } },
      select: { id: true, nameAr: true },
    });
    const targetBySupplierId = new Map(
      utilities.flatMap((supplier) => {
        const code = utilityCodesBySupplierName.get(supplier.nameAr);
        const category = code ? categoriesByCode.get(code) : null;
        return category ? [[supplier.id, category.id] as const] : [];
      }),
    );
    let suppliersReassigned = 0;
    for (const [supplierId, categoryId] of targetBySupplierId) {
      const result = await transaction.financeSupplier.updateMany({ where: { id: supplierId, tenantId: context.tenantId, companyId: context.companyId, categoryId: { not: categoryId } }, data: { categoryId } });
      suppliersReassigned += result.count;
    }

    const fallbackCategoryId = categoriesByCode.get('UTIL-001-OTHER')?.id;
    const profiles = await transaction.financeRecurringExpenseProfile.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId, category: { code: 'UTIL-001' }, status: 'ACTIVE' },
      select: { id: true, supplierId: true },
    });
    const dues = await transaction.financeSupplierDue.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId, category: { code: 'UTIL-001' }, status: { in: [FinanceSupplierDueStatus.OPEN, FinanceSupplierDueStatus.PARTIALLY_PAID] } },
      select: { id: true, supplierId: true },
    });
    let recurringProfilesReassigned = 0;
    for (const profile of profiles) {
      const categoryId = (profile.supplierId ? targetBySupplierId.get(profile.supplierId) : null) ?? fallbackCategoryId;
      if (!categoryId) continue;
      const result = await transaction.financeRecurringExpenseProfile.updateMany({ where: { id: profile.id, tenantId: context.tenantId, companyId: context.companyId, categoryId: { not: categoryId } }, data: { categoryId } });
      recurringProfilesReassigned += result.count;
    }
    let openDuesReassigned = 0;
    for (const due of dues) {
      const categoryId = targetBySupplierId.get(due.supplierId) ?? fallbackCategoryId;
      if (!categoryId) continue;
      const result = await transaction.financeSupplierDue.updateMany({ where: { id: due.id, tenantId: context.tenantId, companyId: context.companyId, categoryId: { not: categoryId } }, data: { categoryId } });
      openDuesReassigned += result.count;
    }

    const preferredSupplierKeys: ReadonlyArray<readonly [string, string]> = [
      ['E3-2', 'SAUDI_ENERGY'], ['E3-3', 'STC'], ['E3-4', 'NATIONAL_WATER_COMPANY'],
    ];
    for (const [categoryCode, supplierKey] of preferredSupplierKeys) {
      const category = categoriesByCode.get(categoryCode);
      const supplier = STANDARD_SUPPLIER_SEEDS.find((item) => item.key === supplierKey);
      const supplierId = supplier ? utilities.find((item) => item.nameAr === supplier.nameAr)?.id : null;
      if (category && supplierId) await transaction.financeCategory.updateMany({ where: { id: category.id, tenantId: context.tenantId, companyId: context.companyId, suggestedSupplierId: null }, data: { suggestedSupplierId: supplierId } });
    }
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
        action: 'finance.foundation.utilities_upgraded', entityType: 'CompanyFinanceProfile', entityId: context.companyId,
        requestId: RequestContext.correlationId() ?? randomUUID(),
        afterJson: { suppliersReassigned, recurringProfilesReassigned, openDuesReassigned, baseSeedVersion: BASE_FINANCE_SEED_VERSION } as Prisma.InputJsonValue,
      },
    });
  }
}
