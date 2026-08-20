import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { STANDARD_SUPPLIER_SEEDS } from './finance-foundation-seeds.js';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { DatabaseService } from '../database/database.service.js';
import { IdempotencyService } from '../core-controls/idempotency.service.js';
import { FinanceCategoryStatus, FinanceSupplierStatus, Prisma } from '../generated/prisma/client.js';

const FINANCE_CONFIGURATION_READ_CAPABILITY = 'finance.configuration.read';

@Injectable()
export class FinanceConfigurationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly companyContext: CompanyContextService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async read(input: { accessToken: string; companyId: string }) {
    const authorized = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: [FINANCE_CONFIGURATION_READ_CAPABILITY],
    });
    return this.database.inTenantTransaction(authorized.principal.tenantId, async (transaction) => {
      const companyId = authorized.company.id;
      const [profile, periods, vaults, accounts, categories, suppliers] = await Promise.all([
        transaction.companyFinanceProfile.findFirst({ where: { tenantId: authorized.principal.tenantId, companyId }, select: { baseSeedVersion: true, accountingMode: true, vatAccountingEnabled: true, vatRateBasisPoints: true, initializedAt: true } }),
        transaction.financeFiscalPeriod.findMany({ where: { tenantId: authorized.principal.tenantId, companyId }, orderBy: { startDate: 'desc' }, take: 120, select: { id: true, nameAr: true, nameEn: true, startDate: true, endDate: true, status: true, closeReason: true } }),
        transaction.financeVault.findMany({ where: { tenantId: authorized.principal.tenantId, companyId }, orderBy: { sortOrder: 'asc' }, take: 100, select: { id: true, nameAr: true, nameEn: true, type: true, paymentMethod: true, paymentMethods: true, status: true, isSalesChannel: true, isPaymentDestination: true, sortOrder: true, account: { select: { id: true, code: true, nameAr: true, nameEn: true, status: true } } } }),
        transaction.financeAccount.findMany({ where: { tenantId: authorized.principal.tenantId, companyId }, orderBy: { code: 'asc' }, take: 500, select: { id: true, code: true, nameAr: true, nameEn: true, type: true, status: true, isSystem: true, systemKey: true } }),
        transaction.financeCategory.findMany({ where: { tenantId: authorized.principal.tenantId, companyId }, orderBy: { sortOrder: 'asc' }, take: 500, select: { id: true, code: true, nameAr: true, nameEn: true, kind: true, status: true, accountId: true, parentId: true, suggestedSupplierId: true, isPosting: true } }),
        transaction.financeSupplier.findMany({ where: { tenantId: authorized.principal.tenantId, companyId }, orderBy: [{ isFavorite: 'desc' }, { nameAr: 'asc' }], take: 1_000, select: { id: true, nameAr: true, nameEn: true, phone: true, taxNumber: true, isTaxRegistered: true, isFavorite: true, supplierType: true, status: true, categoryId: true } }),
      ]);
      return { companyId, profile, periods, vaults, accounts, categories, suppliers, standardSuppliers: STANDARD_SUPPLIER_SEEDS.map((supplier) => ({ key: supplier.key, nameAr: supplier.nameAr, nameEn: supplier.nameEn })) };
    });
  }

  /**
   * Setup is a readiness hub, not a duplicate master-data screen. Keep this
   * response bounded even when suppliers and categories grow very large.
   */
  async readiness(input: { accessToken: string; companyId: string }) {
    const authorized = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: [FINANCE_CONFIGURATION_READ_CAPABILITY],
    });
    return this.database.inTenantTransaction(authorized.principal.tenantId, async (transaction) => {
      const companyId = authorized.company.id;
      const [profile, openPeriod, activeVaults, activeAccounts, activeCategories, activeSuppliers] = await Promise.all([
        transaction.companyFinanceProfile.findFirst({ where: { tenantId: authorized.principal.tenantId, companyId }, select: { baseSeedVersion: true, accountingMode: true, vatAccountingEnabled: true, vatRateBasisPoints: true, initializedAt: true } }),
        transaction.financeFiscalPeriod.findFirst({ where: { tenantId: authorized.principal.tenantId, companyId, status: 'OPEN' }, orderBy: { startDate: 'desc' }, select: { id: true, nameAr: true, nameEn: true, startDate: true, endDate: true, status: true, closeReason: true } }),
        transaction.financeVault.count({ where: { tenantId: authorized.principal.tenantId, companyId, status: 'ACTIVE' } }),
        transaction.financeAccount.count({ where: { tenantId: authorized.principal.tenantId, companyId, status: 'ACTIVE' } }),
        transaction.financeCategory.count({ where: { tenantId: authorized.principal.tenantId, companyId, status: 'ACTIVE', isPosting: true } }),
        transaction.financeSupplier.count({ where: { tenantId: authorized.principal.tenantId, companyId, status: 'ACTIVE' } }),
      ]);
      const issues: Array<'FINANCE_NOT_INITIALIZED' | 'NO_OPEN_PERIOD' | 'NO_ACTIVE_VAULT' | 'NO_POSTING_CATEGORY'> = [];
      if (!profile) issues.push('FINANCE_NOT_INITIALIZED');
      if (profile && !openPeriod) issues.push('NO_OPEN_PERIOD');
      if (profile && !activeVaults) issues.push('NO_ACTIVE_VAULT');
      if (profile && !activeCategories) issues.push('NO_POSTING_CATEGORY');
      return {
        companyId,
        profile,
        openPeriod,
        counts: { activeVaults, activeAccounts, activeCategories, activeSuppliers },
        issues,
        standardSuppliers: STANDARD_SUPPLIER_SEEDS.map((supplier) => ({ key: supplier.key, nameAr: supplier.nameAr, nameEn: supplier.nameEn })),
      };
    });
  }

  /**
   * Long master-data lists are searched at the server, rather than shipped to
   * a browser and filtered there. An empty search intentionally returns only
   * the first useful choices (favourites first); typing reaches every record.
   */
  async searchSuppliers(input: { accessToken: string; companyId: string; q?: string; pageSize: number }) {
    const authorized = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: [FINANCE_CONFIGURATION_READ_CAPABILITY],
    });
    return this.database.inTenantTransaction(authorized.principal.tenantId, async (transaction) => {
      const term = input.q?.trim();
      const where: Prisma.FinanceSupplierWhereInput = {
        tenantId: authorized.principal.tenantId,
        companyId: authorized.company.id,
        status: FinanceSupplierStatus.ACTIVE,
        ...(term ? { OR: [
          { nameAr: { startsWith: term, mode: 'insensitive' } },
          { nameEn: { startsWith: term, mode: 'insensitive' } },
          { taxNumber: { startsWith: term, mode: 'insensitive' } },
        ] } : {}),
      };
      const suppliers = await transaction.financeSupplier.findMany({
        where,
        orderBy: [{ isFavorite: 'desc' }, { nameAr: 'asc' }, { id: 'asc' }],
        take: input.pageSize,
        select: { id: true, nameAr: true, nameEn: true, categoryId: true, supplierType: true, isFavorite: true },
      });
      return { companyId: authorized.company.id, suppliers };
    });
  }

  async searchCategories(input: { accessToken: string; companyId: string; q?: string; kind?: 'PURCHASE' | 'EXPENSE' | 'SALE'; pageSize: number }) {
    const authorized = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: [FINANCE_CONFIGURATION_READ_CAPABILITY],
    });
    return this.database.inTenantTransaction(authorized.principal.tenantId, async (transaction) => {
      const term = input.q?.trim();
      const where: Prisma.FinanceCategoryWhereInput = {
        tenantId: authorized.principal.tenantId,
        companyId: authorized.company.id,
        status: FinanceCategoryStatus.ACTIVE,
        isPosting: true,
        ...(input.kind ? { kind: input.kind } : {}),
        ...(term ? { OR: [
          { code: { startsWith: term.toUpperCase(), mode: 'insensitive' } },
          { nameAr: { startsWith: term, mode: 'insensitive' } },
          { nameEn: { startsWith: term, mode: 'insensitive' } },
        ] } : {}),
      };
      const categories = await transaction.financeCategory.findMany({
        where,
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }, { id: 'asc' }],
        take: input.pageSize,
        select: { id: true, code: true, nameAr: true, nameEn: true, kind: true },
      });
      return { companyId: authorized.company.id, categories };
    });
  }

  /**
   * Changes the company default only. Every posted document already stores
   * vatRateBasisPoints, so historical invoices and their journals are never
   * recalculated when the statutory rate changes.
   */
  async updateVatRate(input: { accessToken: string; companyId: string; vatRateBasisPoints: number; idempotencyKey: string }) {
    const authorized = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: ['finance.setup.write'],
    });
    return this.database.inTenantTransaction(authorized.principal.tenantId, async (transaction) => {
      const context = { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
      const begun = await this.idempotency.beginInTransaction(transaction, context, {
        operation: 'finance.configuration.vat_rate.update',
        key: input.idempotencyKey,
        request: { vatRateBasisPoints: input.vatRateBasisPoints },
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begun.kind === 'replay') return begun.response.body as { vatRateBasisPoints: number; vatAccountingEnabled: true };
      if (begun.kind === 'in-progress') throw new ConflictException('The company tax-rate update is still in progress.');
      const profile = await transaction.companyFinanceProfile.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, vatRateBasisPoints: true, vatAccountingEnabled: true },
      });
      if (!profile) throw new ConflictException('The company financial setup is incomplete.');
      const receipt = { vatRateBasisPoints: input.vatRateBasisPoints, vatAccountingEnabled: true as const };
      await transaction.companyFinanceProfile.update({
        where: { id: profile.id },
        data: { vatAccountingEnabled: true, vatRateBasisPoints: input.vatRateBasisPoints },
      });
      await transaction.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId,
          actorUserId: context.actorUserId, action: 'finance.configuration.vat_rate.updated',
          entityType: 'CompanyFinanceProfile', entityId: profile.id, requestId: input.idempotencyKey,
          beforeJson: { vatRateBasisPoints: profile.vatRateBasisPoints, vatAccountingEnabled: profile.vatAccountingEnabled },
          afterJson: receipt,
        },
      });
      await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    });
  }
}
