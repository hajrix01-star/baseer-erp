import { Injectable } from '@nestjs/common';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { DatabaseService } from '../database/database.service.js';

const FINANCE_CONFIGURATION_READ_CAPABILITY = 'finance.configuration.read';

@Injectable()
export class FinanceConfigurationService {
  constructor(
    private readonly database: DatabaseService,
    private readonly companyContext: CompanyContextService,
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
        transaction.companyFinanceProfile.findFirst({ where: { tenantId: authorized.principal.tenantId, companyId }, select: { baseSeedVersion: true, accountingMode: true, vatAccountingEnabled: true, initializedAt: true } }),
        transaction.financeFiscalPeriod.findMany({ where: { tenantId: authorized.principal.tenantId, companyId }, orderBy: { startDate: 'desc' }, take: 120, select: { id: true, nameAr: true, nameEn: true, startDate: true, endDate: true, status: true, closeReason: true } }),
        transaction.financeVault.findMany({ where: { tenantId: authorized.principal.tenantId, companyId }, orderBy: { sortOrder: 'asc' }, take: 100, select: { id: true, nameAr: true, nameEn: true, type: true, status: true, isSalesChannel: true, isPaymentDestination: true, account: { select: { id: true, code: true, nameAr: true, nameEn: true, status: true } } } }),
        transaction.financeAccount.findMany({ where: { tenantId: authorized.principal.tenantId, companyId }, orderBy: { code: 'asc' }, take: 500, select: { id: true, code: true, nameAr: true, nameEn: true, type: true, status: true, isSystem: true, systemKey: true } }),
        transaction.financeCategory.findMany({ where: { tenantId: authorized.principal.tenantId, companyId }, orderBy: { sortOrder: 'asc' }, take: 500, select: { id: true, code: true, nameAr: true, nameEn: true, kind: true, status: true, accountId: true, parentId: true, isPosting: true } }),
        transaction.financeSupplier.findMany({ where: { tenantId: authorized.principal.tenantId, companyId }, orderBy: { nameAr: 'asc' }, take: 1_000, select: { id: true, nameAr: true, nameEn: true, phone: true, taxNumber: true, isTaxRegistered: true, status: true, categoryId: true } }),
      ]);
      return { companyId, profile, periods, vaults, accounts, categories, suppliers };
    });
  }
}
