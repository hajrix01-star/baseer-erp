import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { IdempotencyService } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceAccountStatus, FinanceAccountType, FinanceVaultStatus, FinanceVaultType, Prisma } from '../generated/prisma/client.js';
import { RequestContext } from '../observability/request-context.js';
import { FinanceFoundationService } from './finance-foundation.service.js';
import { FinancePeriodService } from './finance-period.service.js';

const COMPANY_SETUP_OPERATION = 'finance.company_setup.initialize';
export const COMPANY_VAULT_CHOICES = ['CASH', 'BANK', 'HUNGERSTATION', 'JAHEZ', 'KEETA'] as const;
export type CompanyVaultChoice = typeof COMPANY_VAULT_CHOICES[number];
export type CompanyFinanceSetupRequest = Readonly<{ fiscalPeriodNameAr: string; fiscalPeriodNameEn: string; fiscalPeriodStartDate: Date; fiscalPeriodEndDate: Date; selectedVaults: readonly CompanyVaultChoice[] }>;
export type CompanyFinanceSetupReceipt = Readonly<{ periodId: string; vaultIds: readonly string[] }>;

@Injectable()
export class CompanyFinanceSetupService {
  constructor(private readonly database: DatabaseService, private readonly foundation: FinanceFoundationService, private readonly periods: FinancePeriodService, private readonly idempotency: IdempotencyService) {}

  /** Internal callers may omit the key; public commands must supply one. */
  async initialize(context: TrustedCompanyActorContext, input: CompanyFinanceSetupRequest, idempotencyKey?: string): Promise<CompanyFinanceSetupReceipt> {
    const choices = normalizeVaultChoices(input.selectedVaults);
    if (!(input.fiscalPeriodStartDate instanceof Date) || Number.isNaN(input.fiscalPeriodStartDate.valueOf()) || !(input.fiscalPeriodEndDate instanceof Date) || Number.isNaN(input.fiscalPeriodEndDate.valueOf())) throw new BadRequestException('Valid fiscal-period dates are required.');
    if (input.fiscalPeriodStartDate > input.fiscalPeriodEndDate) throw new BadRequestException('Fiscal-period start date must not be after its end date.');
    const nameAr = requiredText(input.fiscalPeriodNameAr, 160); const nameEn = requiredText(input.fiscalPeriodNameEn, 160);
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const begun = idempotencyKey ? await this.idempotency.beginInTransaction(transaction, context, {
        operation: COMPANY_SETUP_OPERATION, key: idempotencyKey,
        request: { fiscalPeriodNameAr: nameAr, fiscalPeriodNameEn: nameEn, fiscalPeriodStartDate: input.fiscalPeriodStartDate.toISOString(), fiscalPeriodEndDate: input.fiscalPeriodEndDate.toISOString(), selectedVaults: choices },
        expiresAt: new Date(Date.now() + 86_400_000),
      }) : null;
      if (begun?.kind === 'replay') return begun.response.body as unknown as CompanyFinanceSetupReceipt;
      if (begun?.kind === 'in-progress') throw new ConflictException('The company-finance setup request is still in progress.');
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:company-finance-setup`}, 0))`;
      await this.foundation.initializeInTransaction(transaction, context);
      let period = await transaction.financeFiscalPeriod.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, startDate: input.fiscalPeriodStartDate, endDate: input.fiscalPeriodEndDate }, select: { id: true } });
      if (!period) {
        await this.periods.assertNoPeriodOverlap(transaction, { tenantId: context.tenantId, companyId: context.companyId, startDate: input.fiscalPeriodStartDate, endDate: input.fiscalPeriodEndDate });
        const id = randomUUID();
        await transaction.financeFiscalPeriod.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, nameAr, nameEn, startDate: input.fiscalPeriodStartDate, endDate: input.fiscalPeriodEndDate } });
        period = { id };
      }
      const accounts = await transaction.financeAccount.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, status: FinanceAccountStatus.ACTIVE, type: FinanceAccountType.ASSET, systemKey: { in: choices } }, select: { id: true, systemKey: true } });
      if (accounts.length !== choices.length) throw new BadRequestException('A selected vault account is missing from the company foundation.');
      const existing = await transaction.financeVault.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, accountId: { in: accounts.map((account) => account.id) } }, select: { accountId: true, id: true } });
      const existingByAccount = new Map(existing.map((vault) => [vault.accountId, vault.id]));
      const vaultIds: string[] = [];
      for (const choice of choices) {
        const account = accounts.find((item) => item.systemKey === choice)!; const prior = existingByAccount.get(account.id);
        if (prior) { vaultIds.push(prior); continue; }
        const definition = VAULT_DEFINITIONS[choice]; const id = randomUUID();
        await transaction.financeVault.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, accountId: account.id, nameAr: definition.nameAr, nameEn: definition.nameEn, type: definition.type, status: FinanceVaultStatus.ACTIVE, isSalesChannel: definition.isSalesChannel, isPaymentDestination: definition.isPaymentDestination, sortOrder: definition.sortOrder } });
        vaultIds.push(id);
      }
      const receipt: CompanyFinanceSetupReceipt = { periodId: period.id, vaultIds };
      await transaction.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: 'finance.company_setup.initialized', entityType: 'Company', entityId: context.companyId, requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: { periodId: period.id, selectedVaults: choices } as Prisma.InputJsonValue } });
      if (begun?.kind === 'started') await this.idempotency.completeInTransaction(transaction, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    });
  }
}

const VAULT_DEFINITIONS: Record<CompanyVaultChoice, { nameAr: string; nameEn: string; type: FinanceVaultType; isSalesChannel: boolean; isPaymentDestination: boolean; sortOrder: number }> = {
  CASH: { nameAr: 'نقد', nameEn: 'Cash', type: FinanceVaultType.CASH, isSalesChannel: true, isPaymentDestination: true, sortOrder: 10 },
  BANK: { nameAr: 'بنك', nameEn: 'Bank', type: FinanceVaultType.BANK, isSalesChannel: false, isPaymentDestination: true, sortOrder: 20 },
  HUNGERSTATION: { nameAr: 'هنقرستيشن', nameEn: 'HungerStation', type: FinanceVaultType.APP, isSalesChannel: true, isPaymentDestination: false, sortOrder: 30 },
  JAHEZ: { nameAr: 'جاهز', nameEn: 'Jahez', type: FinanceVaultType.APP, isSalesChannel: true, isPaymentDestination: false, sortOrder: 40 },
  KEETA: { nameAr: 'كيتا', nameEn: 'Keeta', type: FinanceVaultType.APP, isSalesChannel: true, isPaymentDestination: false, sortOrder: 50 },
};
function normalizeVaultChoices(value: readonly CompanyVaultChoice[]): CompanyVaultChoice[] { const unique = [...new Set(value)]; if (!unique.length || unique.some((item) => !COMPANY_VAULT_CHOICES.includes(item))) throw new BadRequestException('Select at least one supported company vault.'); return unique; }
function requiredText(value: string, maximumLength: number): string { const text = value?.trim(); if (!text || text.length > maximumLength) throw new BadRequestException('A fiscal-period name is required.'); return text; }