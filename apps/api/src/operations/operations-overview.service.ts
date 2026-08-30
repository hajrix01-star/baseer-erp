import { BadRequestException, Injectable } from "@nestjs/common";

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

  async period(context: TrustedCompanyActorContext, requested: { fromBusinessDate?: string; toBusinessDate?: string }) {
    const current = await this.businessDates.currentForTrustedContext(context);
    const fromBusinessDate = requested.fromBusinessDate ?? `${current.businessDate.slice(0, 7)}-01`;
    const toBusinessDate = requested.toBusinessDate ?? current.businessDate;
    if (fromBusinessDate > toBusinessDate || toBusinessDate > current.businessDate) throw new BadRequestException("The requested operations overview period is invalid.");
    const from = new Date(`${fromBusinessDate}T00:00:00.000Z`);
    const to = new Date(`${toBusinessDate}T00:00:00.000Z`);
    if ((to.getTime() - from.getTime()) / 86_400_000 > 365) throw new BadRequestException("The operations overview period must not exceed one year.");
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const [salesSummaries, operationalDays, purchaseDays] = await Promise.all([
        tx.financeDailyFinancialSummary.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, businessDate: { gte: from, lte: to } },
          select: { businessDate: true, salesGrossAmount: true, salesClosingCount: true, dataStatus: true, operationalDayStatus: true },
        }),
        tx.financeOperationalDay.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, businessDate: { gte: from, lte: to } },
          select: { businessDate: true, status: true },
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
      const operationalByDate = new Map(operationalDays.map((operationalDay) => [day(operationalDay.businessDate), operationalDay]));
      const purchasesByDate = new Map(purchaseDays.map((purchase) => [day(purchase.businessDate), purchase]));
      const businessDates = datesInclusive(from, to);
      let salesTotal = new Prisma.Decimal(0);
      let purchaseTotal = new Prisma.Decimal(0);
      let salesClosingCount = 0;
      let purchaseDocumentCount = 0;
      let recordedOperatingDays = 0;
      let requiredOperatingDays = 0;
      let scheduledClosedDays = 0;
      let missingDays = 0;
      let partialDays = 0;
      const timeline = businessDates.map((businessDate) => {
        const summary = salesByDate.get(businessDate);
        const operationalStatus = operationalByDate.get(businessDate)?.status ?? summary?.operationalDayStatus ?? FinanceOperationalDayStatus.OPEN;
        let salesDataQuality: "READY" | "INCOMPLETE" | "NO_DATA";
        let salesAmount: Prisma.Decimal | null = null;
        if (operationalStatus === FinanceOperationalDayStatus.CLOSED) {
          scheduledClosedDays += 1;
          salesDataQuality = "READY";
          salesAmount = new Prisma.Decimal(0);
        } else if (operationalStatus === FinanceOperationalDayStatus.PARTIAL) {
          requiredOperatingDays += 1;
          partialDays += 1;
          salesDataQuality = "INCOMPLETE";
        } else if (summary?.dataStatus === FinanceDailySalesDataStatus.RECORDED) {
          requiredOperatingDays += 1;
          recordedOperatingDays += 1;
          salesDataQuality = "READY";
          salesAmount = summary.salesGrossAmount;
          salesTotal = salesTotal.plus(summary.salesGrossAmount);
          salesClosingCount += summary.salesClosingCount;
        } else {
          requiredOperatingDays += 1;
          missingDays += 1;
          salesDataQuality = "INCOMPLETE";
        }
        const purchase = purchasesByDate.get(businessDate);
        const purchaseAmount = purchase?._sum.grossAmount ?? new Prisma.Decimal(0);
        const purchaseCount = purchase?._count.id ?? 0;
        purchaseTotal = purchaseTotal.plus(purchaseAmount);
        purchaseDocumentCount += purchaseCount;
        return {
          businessDate,
          sales: {
            dataQuality: salesDataQuality,
            displayGrossAmount: salesAmount === null ? null : formatAmount(salesAmount),
            plotValue: salesAmount === null ? null : plotValue(salesAmount),
          },
          purchases: {
            dataQuality: "READY" as const,
            displayGrossAmount: formatAmount(purchaseAmount),
            displayDocumentCount: formatCount(purchaseCount),
            plotValue: plotValue(purchaseAmount),
          },
        };
      });
      const salesDataQuality = businessDates.length === 0
        ? "NO_DATA" as const
        : missingDays || partialDays
          ? "INCOMPLETE" as const
          : "READY" as const;
      const salesComplete = salesDataQuality === "READY";
      return {
        companyId: context.companyId,
        businessDate: current.businessDate,
        currencyCode: "SAR" as const,
        amountBasis: "GROSS_VAT_INCLUSIVE" as const,
        vatInclusive: true as const,
        source: {
          sales: "FINANCE_DAILY_FINANCIAL_SUMMARY" as const,
          purchases: "FINANCE_OUTFLOW_DOCUMENT_PURCHASE" as const,
        },
        period: { fromBusinessDate, toBusinessDate, timezone: "Asia/Riyadh" as const },
        sales: {
          dataQuality: salesDataQuality,
          coverage: {
            recordedOperatingDays,
            requiredOperatingDays,
            scheduledClosedDays,
            missingDays,
            partialDays,
            display: `${formatCount(recordedOperatingDays)}/${formatCount(requiredOperatingDays)}`,
          },
          display: {
            grossAmount: salesComplete ? formatAmount(salesTotal) : null,
            closingCount: salesComplete ? formatCount(salesClosingCount) : null,
          },
        },
        purchases: {
          dataQuality: "READY" as const,
          display: {
            grossAmount: formatAmount(purchaseTotal),
            documentCount: formatCount(purchaseDocumentCount),
          },
        },
        timeline,
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

function plotValue(value: Prisma.Decimal): number {
  return Number(value.toDecimalPlaces(4).toFixed(4));
}

function formatAmount(value: Prisma.Decimal): string {
  return formatDecimal(value, 2);
}

function formatCount(value: number): string {
  return formatDecimal(new Prisma.Decimal(value), 0);
}

function formatDecimal(value: Prisma.Decimal, scale: number): string {
  const fixed = value.toDecimalPlaces(scale).toFixed(scale);
  const negative = fixed.startsWith("-");
  const [whole, fraction] = (negative ? fixed.slice(1) : fixed).split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${scale > 0 ? `.${fraction ?? "0".padStart(scale, "0")}` : ""}`;
}
