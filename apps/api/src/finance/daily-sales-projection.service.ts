import { createHash, randomUUID } from 'node:crypto';

import { ConflictException, Injectable } from '@nestjs/common';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import {
  FinanceDailySalesClosingStatus,
  FinanceDailySalesDataStatus,
  FinanceOperationalDayStatus,
  Prisma,
} from '../generated/prisma/client.js';

export type DailySalesProjectionReceipt = Readonly<{
  businessDate: Date;
  operationalStatus: FinanceOperationalDayStatus;
  dataStatus: FinanceDailySalesDataStatus;
  salesGrossAmount: string;
  salesNetAmount: string;
  salesVatAmount: string;
  salesClosingCount: number;
  customerCount: number;
}>;

/**
 * Rebuilds only server-owned read models from active daily sales source records.
 * It never reads browser totals and is called inside the posting transaction.
 */
@Injectable()
export class DailySalesProjectionService {
  async rebuildInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    input: { businessDate: Date; requestId: string },
  ): Promise<DailySalesProjectionReceipt> {
    const [operationalDay, closings] = await Promise.all([
      transaction.financeOperationalDay.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, businessDate: input.businessDate },
        select: { status: true },
      }),
      transaction.financeDailySalesClosing.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          businessDate: input.businessDate,
          status: FinanceDailySalesClosingStatus.POSTED,
        },
        select: {
          grossAmount: true,
          netAmount: true,
          vatAmount: true,
          customerCount: true,
          allocations: { select: { vaultId: true, grossAmount: true } },
        },
      }),
    ]);
    const operationalStatus = operationalDay?.status ?? FinanceOperationalDayStatus.OPEN;
    if (operationalStatus === FinanceOperationalDayStatus.CLOSED && closings.length > 0) {
      throw new ConflictException('A scheduled closed day cannot have an active sales closing.');
    }

    const totals = closings.reduce(
      (current, closing) => ({
        gross: current.gross.plus(closing.grossAmount),
        net: current.net.plus(closing.netAmount),
        vat: current.vat.plus(closing.vatAmount),
        customerCount: current.customerCount + closing.customerCount,
      }),
      {
        gross: new Prisma.Decimal(0),
        net: new Prisma.Decimal(0),
        vat: new Prisma.Decimal(0),
        customerCount: 0,
      },
    );
    const dataStatus = operationalStatus === FinanceOperationalDayStatus.CLOSED
      ? FinanceDailySalesDataStatus.CLOSED
      : closings.length > 0
        ? FinanceDailySalesDataStatus.RECORDED
        : FinanceDailySalesDataStatus.PENDING;
    const channelAmounts = new Map<string, Prisma.Decimal>();
    for (const closing of closings) {
      for (const allocation of closing.allocations) {
        channelAmounts.set(
          allocation.vaultId,
          (channelAmounts.get(allocation.vaultId) ?? new Prisma.Decimal(0)).plus(allocation.grossAmount),
        );
      }
    }
    const checksum = this.checksum({
      businessDate: input.businessDate.toISOString().slice(0, 10),
      operationalStatus,
      dataStatus,
      closings: closings.map((closing) => ({
        gross: closing.grossAmount.toFixed(4),
        net: closing.netAmount.toFixed(4),
        vat: closing.vatAmount.toFixed(4),
        customerCount: closing.customerCount,
        allocations: closing.allocations.map((allocation) => ({
          vaultId: allocation.vaultId,
          gross: allocation.grossAmount.toFixed(4),
        })),
      })),
    });
    const summary = await transaction.financeDailyFinancialSummary.upsert({
      where: { companyId_businessDate: { companyId: context.companyId, businessDate: input.businessDate } },
      create: {
        id: randomUUID(),
        tenantId: context.tenantId,
        companyId: context.companyId,
        businessDate: input.businessDate,
        salesGrossAmount: totals.gross,
        salesNetAmount: totals.net,
        salesVatAmount: totals.vat,
        salesClosingCount: closings.length,
        customerCount: totals.customerCount,
        operationalDayStatus: operationalStatus,
        dataStatus,
        sourceChecksum: checksum,
      },
      update: {
        salesGrossAmount: totals.gross,
        salesNetAmount: totals.net,
        salesVatAmount: totals.vat,
        salesClosingCount: closings.length,
        customerCount: totals.customerCount,
        operationalDayStatus: operationalStatus,
        dataStatus,
        sourceChecksum: checksum,
        reconciledAt: new Date(),
      },
      select: { id: true },
    });
    await transaction.financeDailySalesChannelSummary.deleteMany({
      where: { tenantId: context.tenantId, companyId: context.companyId, dailySummaryId: summary.id },
    });
    if (channelAmounts.size > 0) {
      await transaction.financeDailySalesChannelSummary.createMany({
        data: [...channelAmounts.entries()].map(([vaultId, grossAmount]) => ({
          id: randomUUID(),
          tenantId: context.tenantId,
          companyId: context.companyId,
          dailySummaryId: summary.id,
          vaultId,
          grossAmount,
        })),
      });
    }
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        tenantId: context.tenantId,
        companyId: context.companyId,
        actorUserId: context.actorUserId,
        action: 'finance.daily_sales.summary_rebuilt',
        entityType: 'FinanceDailyFinancialSummary',
        entityId: summary.id,
        requestId: input.requestId,
        afterJson: {
          businessDate: input.businessDate.toISOString().slice(0, 10),
          operationalStatus,
          dataStatus,
          sourceChecksum: checksum,
        } as Prisma.InputJsonValue,
      },
    });
    return {
      businessDate: input.businessDate,
      operationalStatus,
      dataStatus,
      salesGrossAmount: totals.gross.toFixed(4),
      salesNetAmount: totals.net.toFixed(4),
      salesVatAmount: totals.vat.toFixed(4),
      salesClosingCount: closings.length,
      customerCount: totals.customerCount,
    };
  }

  private checksum(value: unknown): string {
    return createHash('sha256').update(JSON.stringify(value)).digest('hex');
  }
}