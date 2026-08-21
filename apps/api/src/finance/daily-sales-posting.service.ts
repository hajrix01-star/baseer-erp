import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import { BusinessDateService } from '../business-date/business-date.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceAccountStatus,
  FinanceAccountType,
  FinanceDailySalesClosingScope,
  FinanceVaultPaymentMethod,
  FinanceOperationalDayStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { FinancePeriodService } from './finance-period.service.js';
import { FinanceVaultService } from './finance-vault.service.js';
import { JournalPostingService } from './journal/journal-posting.service.js';
import type { DailySalesFields } from './daily-sales.types.js';

const SALES_REVENUE_SYSTEM_KEY = 'SALES_REVENUE';
const VAT_OUTPUT_SYSTEM_KEY = 'VAT_OUTPUT';
const MAX_DECIMAL_18_4 = new Prisma.Decimal('99999999999999.9999');

export type ValidatedDailySalesFields = Readonly<{
  businessDate: Date;
  scope: FinanceDailySalesClosingScope;
  customerCount: number;
  allocations: readonly Readonly<{ vaultId: string; grossAmount: Prisma.Decimal; accountId: string; paymentMethod: FinanceVaultPaymentMethod }>[];
  cashHandoverAmount: Prisma.Decimal | null;
  cashHandoverVaultId: string | null;
  notes: string | null;
  grossAmount: Prisma.Decimal;
}>;

export type DailySalesAccounting = Readonly<{
  netAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  vatRateBasisPoints: number;
  revenueAccountId: string;
  vatOutputAccountId: string | null;
}>;

/** The financial validation and posting boundary for an aggregated daily close. */
@Injectable()
export class DailySalesPostingService {
  constructor(
    private readonly journals: JournalPostingService,
    private readonly periods: FinancePeriodService,
    private readonly vaults: FinanceVaultService,
    private readonly businessDates: BusinessDateService,
  ) {}

  async validateFields(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: DailySalesFields,
  ): Promise<ValidatedDailySalesFields> {
    const businessDate = this.requiredDate(request.businessDate, 'A daily sales business date is required.');
    if (!Object.values(FinanceDailySalesClosingScope).includes(request.scope)) {
      throw new BadRequestException('A valid daily sales closing scope is required.');
    }
    if (!Number.isSafeInteger(request.customerCount) || request.customerCount < 0 || request.customerCount > 10_000_000) {
      throw new BadRequestException('Customer count must be a non-negative whole number.');
    }
    if (!Array.isArray(request.allocations) || request.allocations.length === 0 || request.allocations.length > 25) {
      throw new BadRequestException('At least one and at most 25 sales-channel allocations are required.');
    }
    const seenVaults = new Set<string>();
    const allocations: Array<{ vaultId: string; grossAmount: Prisma.Decimal; accountId: string; paymentMethod: FinanceVaultPaymentMethod }> = [];
    for (const input of request.allocations) {
      const vaultId = this.requiredText(input.vaultId, 'A sales-channel vault is required.', 36);
      if (seenVaults.has(vaultId)) throw new BadRequestException('Each sales-channel vault may appear only once.');
      seenVaults.add(vaultId);
      const grossAmount = this.positiveAmount(input.grossAmount, 'Every sales-channel amount must be positive.');
      const vault = await this.vaults.assertActiveSalesChannel(transaction, {
        tenantId: context.tenantId,
        companyId: context.companyId,
        vaultId,
      });
      allocations.push({ vaultId: vault.id, grossAmount, accountId: vault.accountId, paymentMethod: vault.paymentMethod });
    }
    const grossAmount = allocations.reduce((total, allocation) => total.plus(allocation.grossAmount), new Prisma.Decimal(0));
    const cashHandoverAmount = request.cashHandoverAmount === undefined
      ? null
      : this.nonNegativeAmount(request.cashHandoverAmount, 'Cash handover must be a non-negative amount.');
    // Cash handover is a management observation only. It never moves a vault balance
    // and is deliberately not tied to a vault or included in the posting journal.
    const cashHandoverVaultId = null;
    return {
      businessDate,
      scope: request.scope,
      customerCount: request.customerCount,
      allocations,
      cashHandoverAmount,
      cashHandoverVaultId,
      notes: this.optionalText(request.notes, 2_000),
      grossAmount,
    };
  }

  async resolveAccounting(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    grossAmount: Prisma.Decimal,
  ): Promise<DailySalesAccounting> {
    const [profile, revenueAccount] = await Promise.all([
      transaction.companyFinanceProfile.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        select: { vatAccountingEnabled: true, vatRateBasisPoints: true },
      }),
      transaction.financeAccount.findFirst({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          systemKey: SALES_REVENUE_SYSTEM_KEY,
          status: FinanceAccountStatus.ACTIVE,
          type: FinanceAccountType.REVENUE,
        },
        select: { id: true },
      }),
    ]);
    if (!profile) throw new ConflictException('The company finance profile has not been initialized.');
    if (!revenueAccount) throw new ConflictException('The active system sales-revenue account is unavailable.');
    const vatRateBasisPoints = profile.vatAccountingEnabled ? profile.vatRateBasisPoints : 0;
    if (!Number.isInteger(vatRateBasisPoints) || vatRateBasisPoints < 0 || vatRateBasisPoints > 10_000) {
      throw new ConflictException('The company VAT configuration is invalid.');
    }
    const netAmount = vatRateBasisPoints === 0
      ? grossAmount
      : grossAmount.mul(10_000).div(new Prisma.Decimal(10_000 + vatRateBasisPoints)).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
    const vatAmount = grossAmount.minus(netAmount);
    const vatOutputAccount = vatAmount.eq(0)
      ? null
      : await transaction.financeAccount.findFirst({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          systemKey: VAT_OUTPUT_SYSTEM_KEY,
          status: FinanceAccountStatus.ACTIVE,
          type: FinanceAccountType.LIABILITY,
        },
        select: { id: true },
      });
    if (vatAmount.gt(0) && !vatOutputAccount) throw new ConflictException('The active output-VAT system account is unavailable.');
    return {
      netAmount,
      vatAmount,
      vatRateBasisPoints,
      revenueAccountId: revenueAccount.id,
      vatOutputAccountId: vatOutputAccount?.id ?? null,
    };
  }

  async postJournal(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    input: Readonly<{
      closingId: string;
      version: number;
      documentNumber: string;
      requestId: string;
      fields: ValidatedDailySalesFields;
      accounting: DailySalesAccounting;
    }>,
  ) {
    return this.journals.postInTransaction(transaction, {
      tenantId: context.tenantId,
      companyId: context.companyId,
      actorUserId: context.actorUserId,
      requestId: input.requestId,
      sourceType: 'daily_sales_closing',
      sourceReference: `${input.closingId}:v${input.version}`,
      businessDate: input.fields.businessDate,
      description: `Daily sales closing ${input.documentNumber}`,
      lines: [
        ...input.fields.allocations.map((allocation) => ({ accountId: allocation.accountId, debitAmount: allocation.grossAmount.toFixed(4) })),
        { accountId: input.accounting.revenueAccountId, creditAmount: input.accounting.netAmount.toFixed(4) },
        ...(input.accounting.vatAmount.gt(0) && input.accounting.vatOutputAccountId
          ? [{ accountId: input.accounting.vatOutputAccountId, creditAmount: input.accounting.vatAmount.toFixed(4) }]
          : []),
      ],
    });
  }

  async assertOperationalDayAllowsClosing(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    businessDate: Date,
  ): Promise<void> {
    const day = await transaction.financeOperationalDay.findFirst({
      where: { tenantId: context.tenantId, companyId: context.companyId, businessDate },
      select: { status: true },
    });
    if (day?.status === FinanceOperationalDayStatus.CLOSED) {
      throw new ConflictException('A sales closing cannot be created for a scheduled closed day.');
    }
  }

  async assertOpenPeriodAndNotFuture(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    businessDate: Date,
  ): Promise<void> {
    await this.businessDates.assertNotFutureInTransaction(
      transaction,
      context,
      businessDate,
      'A daily sales closing cannot use a future business date.',
    );
    await this.periods.assertExactlyOneOpenPeriodForDate(transaction, {
      tenantId: context.tenantId,
      companyId: context.companyId,
      businessDate,
    });
  }

  private positiveAmount(value: string, message: string): Prisma.Decimal {
    const amount = this.amount(value, message);
    if (amount.lte(0)) throw new BadRequestException(message);
    return amount;
  }

  private nonNegativeAmount(value: string, message: string): Prisma.Decimal {
    const amount = this.amount(value, message);
    if (amount.lt(0)) throw new BadRequestException(message);
    return amount;
  }

  private amount(value: string, message: string): Prisma.Decimal {
    let amount: Prisma.Decimal;
    try { amount = new Prisma.Decimal(value); } catch { throw new BadRequestException(message); }
    if (!amount.isFinite() || (amount.decimalPlaces() ?? 0) > 4 || amount.gt(MAX_DECIMAL_18_4)) throw new BadRequestException(message);
    return amount;
  }

  private requiredDate(value: Date, message: string): Date {
    if (!(value instanceof Date) || Number.isNaN(value.valueOf())) throw new BadRequestException(message);
    return value;
  }

  private requiredText(value: string, message: string, maximumLength: number): string {
    const text = value.trim();
    if (!text || text.length > maximumLength) throw new BadRequestException(message);
    return text;
  }

  private optionalText(value: string | undefined, maximumLength: number): string | null {
    if (value === undefined) return null;
    const text = value.trim();
    if (!text) return null;
    if (text.length > maximumLength) throw new BadRequestException('Daily sales text exceeds the permitted length.');
    return text;
  }
}
