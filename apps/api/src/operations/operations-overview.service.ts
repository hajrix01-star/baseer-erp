import { Injectable } from "@nestjs/common";

import { BusinessDateService } from "../business-date/business-date.service.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { FinanceDailySalesDataStatus, FinanceOperationalDayStatus, FinanceOutflowDocumentKind, FinanceOutflowDocumentStatus, Prisma } from "../generated/prisma/client.js";

/**
 * A deliberately narrow dashboard read: operational month-to-date sales and
 * posted purchase invoices. It is not a cash report or a P&L calculation.
 */
@Injectable()
export class OperationsOverviewService {
  constructor(
    private readonly database: DatabaseService,
    private readonly businessDates: BusinessDateService,
  ) {}

  async currentMonth(context: TrustedCompanyActorContext) {
    const current = await this.businessDates.currentForTrustedContext(context);
    const fromBusinessDate = `${current.businessDate.slice(0, 7)}-01`;
    const from = new Date(`${fromBusinessDate}T00:00:00.000Z`);
    const to = new Date(`${current.businessDate}T00:00:00.000Z`);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [salesSummaries, purchaseDays] = await Promise.all([
        tx.financeDailyFinancialSummary.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, businessDate: { gte: from, lte: to } },
          select: { businessDate: true, salesGrossAmount: true, salesClosingCount: true, dataStatus: true, operationalDayStatus: true },
        }),
        tx.financeOutflowDocument.groupBy({
          by: ["businessDate"],
          where: {
            tenantId: context.tenantId,
            companyId: context.companyId,
            kind: FinanceOutflowDocumentKind.PURCHASE,
            status: FinanceOutflowDocumentStatus.POSTED,
            businessDate: { gte: from, lte: to },
          },
          _sum: { grossAmount: true },
          _count: { id: true },
          orderBy: { businessDate: "asc" },
        }),
      ]);
      const salesByDate = new Map(salesSummaries.map((summary) => [day(summary.businessDate), summary]));
      const purchasesByDate = new Map(purchaseDays.map((purchase) => [day(purchase.businessDate), purchase]));
      const businessDates = datesInclusive(from, to);
      const salesDays = businessDates.map((businessDate) => {
        const summary = salesByDate.get(businessDate);
        if (!summary || summary.dataStatus === FinanceDailySalesDataStatus.PENDING || summary.operationalDayStatus === FinanceOperationalDayStatus.PARTIAL) return { businessDate, grossAmount: null };
        return { businessDate, grossAmount: summary.salesGrossAmount.toFixed(4) };
      });
      const purchases = businessDates.map((businessDate) => {
        const purchase = purchasesByDate.get(businessDate);
        return { businessDate, grossAmount: purchase?._sum.grossAmount?.toFixed(4) ?? "0.0000", documentCount: purchase?._count.id ?? 0 };
      });
      const eligibleSales = salesDays.filter((item) => item.grossAmount !== null);
      const salesTotal = eligibleSales.reduce((total, item) => total.plus(item.grossAmount!), new Prisma.Decimal(0));
      const salesClosingCount = salesSummaries
        .filter((summary) => summary.dataStatus !== FinanceDailySalesDataStatus.PENDING && summary.operationalDayStatus !== FinanceOperationalDayStatus.PARTIAL)
        .reduce((total, summary) => total + summary.salesClosingCount, 0);
      const purchaseTotal = purchases.reduce((total, item) => total.plus(item.grossAmount), new Prisma.Decimal(0));
      const purchaseDocumentCount = purchases.reduce((total, item) => total + item.documentCount, 0);
      const incompleteDayCount = salesDays.length - eligibleSales.length;
      return {
        companyId: context.companyId,
        businessDate: current.businessDate,
        period: { fromBusinessDate, toBusinessDate: current.businessDate, timezone: "Asia/Riyadh" as const },
        sales: {
          grossAmount: eligibleSales.length ? salesTotal.toFixed(4) : null,
          closingCount: salesClosingCount,
          eligibleDayCount: eligibleSales.length,
          incompleteDayCount,
          dataQuality: eligibleSales.length === 0 ? "NO_DATA" as const : incompleteDayCount ? "INCOMPLETE" as const : "READY" as const,
          days: salesDays,
        },
        purchases: { grossAmount: purchaseTotal.toFixed(4), documentCount: purchaseDocumentCount, days: purchases },
      };
    });
  }
}

function day(value: Date) { return value.toISOString().slice(0, 10); }
function datesInclusive(from: Date, to: Date) {
  const dates: string[] = [];
  for (const cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(day(cursor));
  return dates;
}
