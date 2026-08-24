import { Injectable } from '@nestjs/common';

import { BusinessDateService } from '../business-date/business-date.service.js';
import { CompanyContextService } from '../company-context/company-context.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { FinanceConfigurationService } from './finance-configuration.service.js';
import { InclusiveLoanService } from './inclusive-loan.service.js';
import { PurchaseExpenseService } from './purchase-expense.service.js';
import { RecurringExpenseService } from './recurring-expense.service.js';

const ITEMS_CAPABILITIES = ['finance.configuration.read', 'finance.loans.read', 'finance.purchase_expense.read'] as const;
const BATCH_CAPABILITIES = ['finance.configuration.read', 'finance.purchase_expense.read'] as const;
const HISTORY_CAPABILITIES = ['finance.loans.read', 'finance.purchase_expense.read'] as const;

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
    const [items, batch, history] = await Promise.all([
      this.readItems(input),
      this.readBatch(input),
      this.readHistory(input),
    ]);
    return {
      companyId: items.companyId,
      businessDate: items.businessDate,
      configuration: items.configuration,
      loans: items.loans,
      recurringProfiles: items.recurringProfiles,
      documents: history.documents,
    };
  }

  async readItems(input: { accessToken: string; companyId: string }) {
    const context = await this.authorize(input, ITEMS_CAPABILITIES);
    const [businessDate, configuration, loans, profiles] = await Promise.all([
      this.businessDates.currentForTrustedContext(context),
      this.configuration.read({ accessToken: input.accessToken, companyId: context.companyId }),
      this.loans.list(context),
      this.recurring.list(context),
    ]);
    return { companyId: context.companyId, businessDate: businessDate.businessDate, configuration, loans, recurringProfiles: profiles };
  }

  async readBatch(input: { accessToken: string; companyId: string }) {
    const context = await this.authorize(input, BATCH_CAPABILITIES);
    const [businessDate, configuration, profiles] = await Promise.all([
      this.businessDates.currentForTrustedContext(context),
      this.configuration.read({ accessToken: input.accessToken, companyId: context.companyId }),
      this.recurring.list(context),
    ]);
    return { companyId: context.companyId, businessDate: businessDate.businessDate, configuration, recurringProfiles: profiles };
  }

  async readHistory(input: { accessToken: string; companyId: string }) {
    const context = await this.authorize(input, HISTORY_CAPABILITIES);
    const [loans, documentPage] = await Promise.all([
      this.loans.list(context),
      this.documents.list(context, { pageSize: 50 }),
    ]);
    return { companyId: context.companyId, loans, documents: documentPage.documents };
  }

  private async authorize(input: { accessToken: string; companyId: string }, requiredCapabilities: readonly string[]) {
    const authorized = await this.companyContext.authorize({
      accessToken: input.accessToken,
      companyId: input.companyId,
      requiredCapabilities: [...requiredCapabilities],
    });
    const context: TrustedCompanyActorContext = {
      tenantId: authorized.principal.tenantId,
      companyId: authorized.company.id,
      actorUserId: authorized.principal.userId,
    };
    return context;
  }
}
