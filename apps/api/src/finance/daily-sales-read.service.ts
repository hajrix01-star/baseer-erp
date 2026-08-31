import { BadRequestException, Injectable } from "@nestjs/common";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { FinanceDailySalesDataStatus, FinanceOperationalDayStatus, Prisma } from "../generated/prisma/client.js";

export const CASHIER_CLOSING_HISTORY_LIMIT = 7;
export const FULL_CLOSING_HISTORY_LIMIT = 100;
const MAX_HANDOVER_ROWS = 100;

type DateRange = Readonly<{ fromBusinessDate: Date; toBusinessDate: Date; businessMonths?: readonly string[] }>;
type AnalyticsMonth = string;
type AnalyticsDataQuality = "READY" | "INCOMPLETE" | "NOT_STARTED";
type AnalyticsChange = Readonly<{
  dailyAverageSalesPercent: string | null;
  dailyAverageSalesDirection: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | null;
  dailyAverageCustomerCountPercent: string | null;
  dailyAverageCustomerCountDirection: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | null;
}>;
type SalesAnalyticsPeriod = Readonly<{
  fromBusinessDate: string;
  toBusinessDate: string;
  amountBasis: "GROSS_VAT_INCLUSIVE";
  vatInclusive: true;
  dataQuality: AnalyticsDataQuality;
  coverage: Readonly<{
    recordedSalesDays: number;
    requiredOperatingDays: number;
    scheduledClosedDays: number;
    missingDays: number;
    partialDays: number;
  }>;
  display: Readonly<{
    salesGrossAmount: string | null;
    applicationSalesGrossAmount: string | null;
    dailyAverageSalesAmount: string | null;
    recordedCustomerCount: string | null;
    dailyAverageCustomerCount: string | null;
    applicationSalesSharePercent: string | null;
    applicationSalesSharePlotValue: number | null;
    salesGrossPlotValue: number | null;
    applicationSalesGrossPlotValue: number | null;
  }>;
}>;
type ComputedSalesAnalyticsPeriod = Readonly<{
  receipt: SalesAnalyticsPeriod;
  dailyAverageSalesAmount: Prisma.Decimal | null;
  dailyAverageCustomerCount: Prisma.Decimal | null;
}>;

@Injectable()
export class DailySalesReadService {
  constructor(private readonly database: DatabaseService) {}

  async listClosings(context: TrustedCompanyActorContext, range: DateRange, options: Readonly<{ cursor?: string; pageSize: number }>) {
    this.assertRange(range);
    if (!Number.isInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > FULL_CLOSING_HISTORY_LIMIT) {
      throw new BadRequestException("Invalid daily-sales history limit.");
    }
    return this.database.inTenantTransaction(
      context.tenantId,
      async (transaction) => {
        const baseWhere = {
            tenantId: context.tenantId,
            companyId: context.companyId,
            ...this.businessDateWhere(range),
        };
        const cursor = options.cursor ? await transaction.financeDailySalesClosing.findFirst({ where: { ...baseWhere, id: options.cursor }, select: { id: true, businessDate: true } }) : null;
        if (options.cursor && !cursor) throw new BadRequestException("The daily-sales page cursor is invalid for the active period.");
        const closings = await transaction.financeDailySalesClosing.findMany({
          where: cursor ? { ...baseWhere, OR: [{ businessDate: { lt: cursor.businessDate } }, { businessDate: cursor.businessDate, id: { lt: cursor.id } }] } : baseWhere,
          orderBy: [
            { businessDate: "desc" },
            { id: "desc" },
          ],
          take: options.pageSize + 1,
          select: {
            id: true,
            documentNumber: true,
            businessDate: true,
            scope: true,
            postingVersion: true,
            journalEntryId: true,
            grossAmount: true,
            netAmount: true,
            vatAmount: true,
            vatRateBasisPoints: true,
            customerCount: true,
            cashHandoverAmount: true,
            cashHandoverVaultId: true,
            status: true,
            notes: true,
            allocations: {
              select: { vaultId: true, grossAmount: true },
            },
          },
        });
        const hasMore = closings.length > options.pageSize;
        const page = hasMore ? closings.slice(0, options.pageSize) : closings;
        return {
          hasMore,
          nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
          closings: page.map((closing) => ({
          closingId: closing.id,
          documentNumber: closing.documentNumber,
          businessDate: closing.businessDate,
          scope: closing.scope,
          postingVersion: closing.postingVersion,
          journalEntryId: closing.journalEntryId,
          grossAmount: closing.grossAmount.toFixed(4),
          netAmount: closing.netAmount.toFixed(4),
          vatAmount: closing.vatAmount.toFixed(4),
          vatRateBasisPoints: closing.vatRateBasisPoints,
          customerCount: closing.customerCount,
          cashHandoverAmount: closing.cashHandoverAmount?.toFixed(4) ?? null,
          cashHandoverVaultId: closing.cashHandoverVaultId,
          status: closing.status,
          notes: closing.notes,
          allocations: closing.allocations.map((allocation) => ({
            vaultId: allocation.vaultId,
            grossAmount: allocation.grossAmount.toFixed(4),
          })),
          })),
        };
      },
    );
  }

  async listCashHandovers(context: TrustedCompanyActorContext, range: DateRange) {
    this.assertRange(range);
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const where = {
        tenantId: context.tenantId,
        companyId: context.companyId,
        status: "POSTED" as const,
        cashHandoverAmount: { not: null },
        ...this.businessDateWhere(range),
      };
      const [summary, handovers] = await Promise.all([
        transaction.financeDailySalesClosing.aggregate({
          where,
          _sum: { cashHandoverAmount: true },
          _count: { _all: true },
        }),
        transaction.financeDailySalesClosing.findMany({
          where,
          orderBy: [{ businessDate: "desc" }, { scope: "asc" }],
          // The list is intentionally capped for the screen. Totals are always
          // computed by the aggregate above and hasMore makes truncation explicit.
          take: MAX_HANDOVER_ROWS,
          select: {
            id: true,
            documentNumber: true,
            businessDate: true,
            scope: true,
            cashHandoverAmount: true,
            cashHandoverVaultId: true,
            notes: true,
          },
        }),
      ]);
      return {
        totalCashHandoverAmount: (summary._sum.cashHandoverAmount ?? new Prisma.Decimal(0)).toFixed(4),
        recordCount: summary._count._all,
        hasMore: summary._count._all > handovers.length,
        handovers: handovers.flatMap((item) =>
          item.cashHandoverAmount
            ? [{
                closingId: item.id,
                documentNumber: item.documentNumber,
                businessDate: item.businessDate,
                scope: item.scope,
                cashHandoverAmount: item.cashHandoverAmount.toFixed(4),
                cashHandoverVaultId: item.cashHandoverVaultId,
                notes: item.notes,
              }]
            : [],
        ),
      };
    });
  }
  async listShiftSummary(context: TrustedCompanyActorContext, range: DateRange) {
    this.assertRange(range);
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const rows = await transaction.financeDailySalesClosing.groupBy({
        by: ["scope"],
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          status: "POSTED",
          ...this.businessDateWhere(range),
        },
        _sum: { grossAmount: true, customerCount: true },
        _count: { _all: true },
      });
      const byScope = new Map(rows.map((row) => [row.scope, row]));
      return (["MORNING", "EVENING", "ALL"] as const).map((scope) => {
        const item = byScope.get(scope);
        const gross = item?._sum.grossAmount ?? new Prisma.Decimal(0);
        const customers = item?._sum.customerCount ?? 0;
        return {
          scope,
          closingCount: item?._count._all ?? 0,
          grossAmount: gross.toFixed(4),
          customerCount: customers,
          averageOrderAmount: customers === 0 ? null : gross.div(customers).toDecimalPlaces(4).toFixed(4),
        };
      });
    });
  }

  async listChannelVaults(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(
      context.tenantId,
      async (transaction) => {
        const vaults = await transaction.financeVault.findMany({
          where: {
            tenantId: context.tenantId,
            companyId: context.companyId,
            status: "ACTIVE",
            isSalesChannel: true,
          },
          orderBy: [{ sortOrder: "asc" }, { nameAr: "asc" }],
          take: 100,
          select: {
            id: true,
            nameAr: true,
            nameEn: true,
            type: true,
            sortOrder: true,
            isSalesChannel: true,
          },
        });
        return vaults;
      },
    );
  }

  /** Server-owned analytics read. It deliberately consumes daily projections,
   * never the capped operational closing-history feed used by cashiers. */
  async salesAnalytics(context: TrustedCompanyActorContext, input: Readonly<{ year: number; primaryMonth: AnalyticsMonth; comparisonMonth: AnalyticsMonth; asOfBusinessDate: string }>) {
    const annualMonths = Array.from({ length: 12 }, (_, index) => `${input.year}-${String(index + 1).padStart(2, "0")}` as AnalyticsMonth);
    const months = [...new Set([...annualMonths, input.primaryMonth, input.comparisonMonth])];
    const dates = months.flatMap(monthDates);
    const asOf = input.asOfBusinessDate;
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [summaries, operationalDays, applicationChannels] = await Promise.all([
        transaction.financeDailyFinancialSummary.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, businessDate: { in: dates } }, select: { businessDate: true, salesGrossAmount: true, customerCount: true, dataStatus: true, operationalDayStatus: true } }),
        transaction.financeOperationalDay.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, businessDate: { in: dates } }, select: { businessDate: true, status: true } }),
        transaction.financeDailySalesChannelSummary.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId, dailySummary: { businessDate: { in: dates } }, vault: { type: "APP" } }, select: { grossAmount: true, dailySummary: { select: { businessDate: true } } } }),
      ]);
      const summaryByDate = new Map(summaries.map((summary) => [dateText(summary.businessDate), summary]));
      const operationalByDate = new Map(operationalDays.map((day) => [dateText(day.businessDate), day]));
      const applicationByDate = new Map<string, Prisma.Decimal>();
      for (const item of applicationChannels) {
        const key = dateText(item.dailySummary.businessDate);
        applicationByDate.set(key, (applicationByDate.get(key) ?? new Prisma.Decimal(0)).plus(item.grossAmount));
      }
      const period = (fromBusinessDate: string, toBusinessDate: string): ComputedSalesAnalyticsPeriod => {
        const datesInPeriod = datesInclusive(new Date(`${fromBusinessDate}T00:00:00.000Z`), new Date(`${toBusinessDate}T00:00:00.000Z`));
        const elapsed = datesInPeriod.filter((value) => dateText(value) <= asOf);
        if (!elapsed.length) return {
          receipt: analyticsPeriodReceipt(fromBusinessDate, toBusinessDate, "NOT_STARTED", {
            recordedSalesDays: 0, requiredOperatingDays: 0, scheduledClosedDays: 0, missingDays: 0, partialDays: 0,
          }),
          dailyAverageSalesAmount: null,
          dailyAverageCustomerCount: null,
        };
        let gross = new Prisma.Decimal(0); let applicationGross = new Prisma.Decimal(0); let customerCount = 0; let recordedSalesDays = 0; let requiredOperatingDays = 0; let scheduledClosedDays = 0; let missingDays = 0; let partialDays = 0;
        for (const value of elapsed) {
          const key = dateText(value); const summary = summaryByDate.get(key); const operational = operationalByDate.get(key)?.status ?? summary?.operationalDayStatus ?? FinanceOperationalDayStatus.OPEN;
          if (operational === FinanceOperationalDayStatus.CLOSED) { scheduledClosedDays += 1; continue; }
          requiredOperatingDays += 1;
          if (operational === FinanceOperationalDayStatus.PARTIAL) { partialDays += 1; continue; }
          if (summary?.dataStatus === FinanceDailySalesDataStatus.RECORDED) { recordedSalesDays += 1; gross = gross.plus(summary.salesGrossAmount); applicationGross = applicationGross.plus(applicationByDate.get(key) ?? 0); customerCount += summary.customerCount; }
          else missingDays += 1;
        }
        const dataQuality: AnalyticsDataQuality = missingDays || partialDays ? "INCOMPLETE" : "READY";
        const dailyAverageSalesAmount = dataQuality === "READY" && recordedSalesDays > 0 ? gross.div(recordedSalesDays) : null;
        const dailyAverageCustomerCount = dataQuality === "READY" && recordedSalesDays > 0 ? new Prisma.Decimal(customerCount).div(recordedSalesDays) : null;
        return {
          receipt: analyticsPeriodReceipt(fromBusinessDate, toBusinessDate, dataQuality, {
            recordedSalesDays, requiredOperatingDays, scheduledClosedDays, missingDays, partialDays,
          }, dataQuality === "READY" ? { gross, applicationGross, customerCount, dailyAverageSalesAmount, dailyAverageCustomerCount } : undefined),
          dailyAverageSalesAmount,
          dailyAverageCustomerCount,
        };
      };
      const weeks = (month: AnalyticsMonth) => Array.from({ length: Math.ceil(monthDates(month).length / 7) }, (_, index) => { const first = index * 7 + 1; const last = Math.min(first + 6, monthDates(month).length); return period(`${month}-${String(first).padStart(2, "0")}`, `${month}-${String(last).padStart(2, "0")}`); });
      const annual = annualMonths.map((month) => ({ month, ...period(`${month}-01`, `${month}-${String(monthDates(month).length).padStart(2, "0")}`) }));
      const primaryWeeks = weeks(input.primaryMonth);
      const comparisonWeeks = weeks(input.comparisonMonth);
      const primaryMonthSummary = period(`${input.primaryMonth}-01`, `${input.primaryMonth}-${String(monthDates(input.primaryMonth).length).padStart(2, "0")}`);
      const comparisonMonthSummary = period(`${input.comparisonMonth}-01`, `${input.comparisonMonth}-${String(monthDates(input.comparisonMonth).length).padStart(2, "0")}`);
      return {
        annualMonths: annual.map((item, index) => ({
          month: item.month,
          ...item.receipt,
          changeFromPreviousMonth: analyticsChange(item, annual[index - 1]),
        })),
        primary: {
          month: input.primaryMonth,
          monthSummary: primaryMonthSummary.receipt,
          weeks: primaryWeeks.map((item, index) => ({
            ...item.receipt,
            changeFromComparison: analyticsChange(item, comparisonWeeks[index]),
          })),
        },
        comparison: {
          month: input.comparisonMonth,
          monthSummary: comparisonMonthSummary.receipt,
          weeks: comparisonWeeks.map((item) => item.receipt),
        },
      };
    });
  }

  private businessDateWhere(range: DateRange): Prisma.FinanceDailySalesClosingWhereInput {
    const periods = this.periods(range);
    const onlyPeriod = periods[0];
    if (!onlyPeriod) throw new BadRequestException("A daily-sales period is required.");
    return periods.length === 1
      ? { businessDate: { gte: onlyPeriod.from, lte: onlyPeriod.to } }
      : { OR: periods.map((period) => ({ businessDate: { gte: period.from, lte: period.to } })) };
  }

  private periods(range: DateRange): ReadonlyArray<{ from: Date; to: Date }> {
    if (!range.businessMonths?.length) return [{ from: range.fromBusinessDate, to: range.toBusinessDate }];
    return range.businessMonths.map((month) => {
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException("Invalid selected business month.");
      const year = Number(month.slice(0, 4));
      const monthNumber = Number(month.slice(5, 7));
      const from = new Date(Date.UTC(year, monthNumber - 1, 1));
      const to = new Date(Date.UTC(year, monthNumber, 0));
      return { from, to };
    });
  }
  private assertRange(range: DateRange) {
    if (
      !(range.fromBusinessDate instanceof Date) ||
      Number.isNaN(range.fromBusinessDate.getTime()) ||
      !(range.toBusinessDate instanceof Date) ||
      Number.isNaN(range.toBusinessDate.getTime())
    ) {
      throw new BadRequestException("Daily-sales dates are required.");
    }
    if (range.fromBusinessDate > range.toBusinessDate) {
      throw new BadRequestException(
        "The start date must not be after the end date.",
      );
    }
  }
}

function dateText(value: Date) { return value.toISOString().slice(0, 10); }
function datesInclusive(from: Date, to: Date) { const dates: Date[] = []; for (let cursor = new Date(from); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) dates.push(new Date(cursor)); return dates; }
function monthDates(month: AnalyticsMonth) {
  const parts = month.split("-").map(Number);
  const year = Number(parts[0]);
  const monthNumber = Number(parts[1]);
  if (!Number.isInteger(year) || !Number.isInteger(monthNumber)) throw new BadRequestException("Invalid analytics month.");
  return datesInclusive(new Date(Date.UTC(year, monthNumber - 1, 1)), new Date(Date.UTC(year, monthNumber, 0)));
}

function analyticsPeriodReceipt(
  fromBusinessDate: string,
  toBusinessDate: string,
  dataQuality: AnalyticsDataQuality,
  coverage: SalesAnalyticsPeriod["coverage"],
  values?: Readonly<{
    gross: Prisma.Decimal;
    applicationGross: Prisma.Decimal;
    customerCount: number;
    dailyAverageSalesAmount: Prisma.Decimal | null;
    dailyAverageCustomerCount: Prisma.Decimal | null;
  }>,
): SalesAnalyticsPeriod {
  const ready = dataQuality === "READY" && values;
  const share = ready && values.gross.gt(0) ? values.applicationGross.div(values.gross).times(100) : null;
  return {
    fromBusinessDate,
    toBusinessDate,
    amountBasis: "GROSS_VAT_INCLUSIVE",
    vatInclusive: true,
    dataQuality,
    coverage,
    display: {
      salesGrossAmount: ready ? formatDecimal(values.gross, 2) : null,
      applicationSalesGrossAmount: ready ? formatDecimal(values.applicationGross, 2) : null,
      dailyAverageSalesAmount: ready && values.dailyAverageSalesAmount ? formatDecimal(values.dailyAverageSalesAmount, 2) : null,
      recordedCustomerCount: ready ? formatDecimal(new Prisma.Decimal(values.customerCount), 0) : null,
      dailyAverageCustomerCount: ready && values.dailyAverageCustomerCount ? formatDecimal(values.dailyAverageCustomerCount, 2) : null,
      applicationSalesSharePercent: share ? `${formatDecimal(share, 2)}%` : null,
      applicationSalesSharePlotValue: share ? Number(share.toDecimalPlaces(4).toFixed(4)) : null,
      // These values are only chart coordinates. Financial amounts remain the
      // formatted decimal strings above; a chart must not derive them client-side.
      salesGrossPlotValue: ready ? Number(values.gross.toDecimalPlaces(4).toFixed(4)) : null,
      applicationSalesGrossPlotValue: ready ? Number(values.applicationGross.toDecimalPlaces(4).toFixed(4)) : null,
    },
  };
}

function analyticsChange(
  current: ComputedSalesAnalyticsPeriod | undefined,
  comparison: ComputedSalesAnalyticsPeriod | undefined,
): AnalyticsChange {
  const sales = analyticsPercentChange(current?.dailyAverageSalesAmount ?? null, comparison?.dailyAverageSalesAmount ?? null);
  const customers = analyticsPercentChange(current?.dailyAverageCustomerCount ?? null, comparison?.dailyAverageCustomerCount ?? null);
  return {
    dailyAverageSalesPercent: sales.percent,
    dailyAverageSalesDirection: sales.direction,
    dailyAverageCustomerCountPercent: customers.percent,
    dailyAverageCustomerCountDirection: customers.direction,
  };
}

function analyticsPercentChange(
  current: Prisma.Decimal | null,
  comparison: Prisma.Decimal | null,
): Readonly<{ percent: string | null; direction: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | null }> {
  if (!current || !comparison || comparison.isZero()) return { percent: null, direction: null };
  const change = current.minus(comparison).div(comparison).times(100);
  return {
    percent: `${change.gte(0) ? "+" : ""}${formatDecimal(change, 2)}%`,
    direction: change.gt(0) ? "POSITIVE" : change.lt(0) ? "NEGATIVE" : "NEUTRAL",
  };
}

function formatDecimal(value: Prisma.Decimal, scale: number): string {
  const fixed = value.toDecimalPlaces(scale).toFixed(scale);
  const negative = fixed.startsWith("-");
  const [whole, fraction] = (negative ? fixed.slice(1) : fixed).split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${scale > 0 ? `.${fraction ?? "0".padStart(scale, "0")}` : ""}`;
}
