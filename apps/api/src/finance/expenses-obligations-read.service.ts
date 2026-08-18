import { Injectable } from '@nestjs/common';

import { BusinessDateService } from '../business-date/business-date.service.js';
import { CompanyContextService } from '../company-context/company-context.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { FinanceConfigurationService } from './finance-configuration.service.js';
import { InclusiveLoanService } from './inclusive-loan.service.js';
import { PurchaseExpenseService } from './purchase-expense.service.js';
import { RecurringExpenseService } from './recurring-expense.service.js';

const REQUIRED_CAPABILITIES = [
  'finance.configuration.read',
  'finance.loans.read',
  'finance.purchase_expense.read',
] as const;

/**
 * Server-owned workspace snapshot. The browser receives facts and dates from
 * one authorized receipt; it never assembles financial totals or scopes.
 */
@Injectable()
export class ExpensesObligationsReadService {
  constructor(
    private readonly companyContext: CompanyContextService,
    private readonly businessDates: BusinessDateService,
    private readonly configuration: FinanceConfigurationService,
    private readonly loans: InclusiveLoanService,
    private readonly recurring: RecurringExpenseService,
    private readonly documents: PurchaseExpenseService,
  ) {}

  async read(input: { accessToken: string; companyId: string }) {
    const authorized = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: REQUIRED_CAPABILITIES,
    });
    const context: TrustedCompanyActorContext = {
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    };
    const [businessDate, configuration, loans, profiles, documentPage] = await Promise.all([
      this.businessDates.currentForTrustedContext(context),
      this.configuration.read({ accessToken: input.accessToken, companyId: context.companyId }),
      this.loans.list(context),
      this.recurring.list(context),
      this.documents.list(context, { pageSize: 50 }),
    ]);
    return {
      companyId: context.companyId,
      businessDate: businessDate.businessDate,
      configuration,
      loans,
      recurringProfiles: profiles,
      documents: documentPage.documents,
    };
  }
}
