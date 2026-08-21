import { Injectable } from '@nestjs/common';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';

export const REPORTS_READ_CAPABILITY = 'reports.read';

@Injectable()
export class ReportCatalogService {
  constructor(private readonly database: DatabaseService) {}

  async list(context: TrustedCompanyActorContext) {
    const profile = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.companyFinanceProfile.findFirst({
      where: { tenantId: context.tenantId, companyId: context.companyId }, select: { functionalCurrencyCode: true },
    }));
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
      code: 'personal_cash_performance',
      titleAr: 'الربح والخسارة المالي',
      titleEn: 'Financial profit and loss',
      requiredCapability: REPORTS_READ_CAPABILITY,
      basis: 'sealed_ledger_vault_lines',
      supportedFilters: ['businessDateRange', 'vatInclusive'],
        definitionVersion: 'actual_financial_movements_v3',
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
