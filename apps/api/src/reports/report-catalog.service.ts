import { Injectable } from '@nestjs/common';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { FinancePnlMappingVersionStatus } from '../generated/prisma/client.js';

export const REPORTS_READ_CAPABILITY = 'reports.read';

@Injectable()
export class ReportCatalogService {
  constructor(private readonly database: DatabaseService) {}

  async list(context: TrustedCompanyActorContext) {
    const { profile, pnlMapping } = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [profile, pnlMapping] = await Promise.all([
        transaction.companyFinanceProfile.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId }, select: { functionalCurrencyCode: true } }),
        transaction.financePnlMappingVersion.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, status: FinancePnlMappingVersionStatus.APPROVED }, select: { id: true } }),
      ]);
      return { profile, pnlMapping };
    });
    return [{
      code: 'ledger_trial_balance',
      titleAr: 'ميزان المراجعة',
      titleEn: 'Trial Balance',
      requiredCapability: REPORTS_READ_CAPABILITY,
      basis: 'ledger_accrual',
      supportedFilters: ['continuousBusinessDateRange', 'includeZeroRows'],
      definitionVersion: 'ledger_trial_balance_v1',
      readiness: profile ? 'READY' : 'NOT_READY',
      readinessMessageAr: profile ? undefined : 'هذا التقرير غير متاح بعد لأن إعداد الشركة المالي غير مكتمل.',
    }, {
      code: 'accrual_profit_loss',
      titleAr: 'الربح والخسارة',
      titleEn: 'Profit and loss',
      requiredCapability: REPORTS_READ_CAPABILITY,
      basis: 'sealed_ledger_revenue_expense_lines',
      supportedFilters: ['continuousBusinessDateRange'],
      definitionVersion: 'accrual_profit_loss_v1',
      readiness: profile && pnlMapping ? 'READY' : 'NOT_READY',
      readinessMessageAr: profile && pnlMapping ? undefined : 'يتطلب التقرير إعداداً مالياً وخريطة ربح وخسارة معتمدة.',
    }, {
      code: 'personal_cash_performance',
      titleAr: 'حركة النقد الفعلية',
      titleEn: 'Actual cash movement',
      requiredCapability: REPORTS_READ_CAPABILITY,
      basis: 'sealed_ledger_vault_lines',
      supportedFilters: ['businessDateRange', 'vatInclusive'],
      definitionVersion: 'actual_financial_movements_v5',
      readiness: profile ? 'READY' : 'NOT_READY',
      readinessMessageAr: profile ? undefined : 'هذا التقرير غير متاح بعد لأن إعداد الشركة المالي غير مكتمل.',
    }, {
      code: 'internal_vat_report',
      titleAr: 'التقرير الضريبي الداخلي',
      titleEn: 'Internal VAT report',
      requiredCapability: REPORTS_READ_CAPABILITY,
      basis: 'sealed_ledger_vat_control_lines',
      supportedFilters: ['businessDateRange'],
      definitionVersion: 'internal_vat_report_v1',
      readiness: profile ? 'READY' : 'NOT_READY',
      readinessMessageAr: profile ? undefined : 'هذا التقرير غير متاح بعد لأن إعداد الشركة المالي غير مكتمل.',
    }];
  }
}
