import { BadRequestException, Injectable } from "@nestjs/common";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { Prisma } from "../generated/prisma/client.js";

const MAX_RANGE_DAYS = 400;
export const CASHIER_CLOSING_HISTORY_LIMIT = 7;
export const FULL_CLOSING_HISTORY_LIMIT = MAX_RANGE_DAYS;

type DateRange = Readonly<{ fromBusinessDate: Date; toBusinessDate: Date; businessMonths?: readonly string[] }>;

@Injectable()
export class DailySalesReadService {
  constructor(private readonly database: DatabaseService) {}

  async listClosings(
    context: TrustedCompanyActorContext,
    range: DateRange,
    options: Readonly<{ limit?: number }> = {},
  ) {
    this.assertRange(range);
    const limit = options.limit ?? FULL_CLOSING_HISTORY_LIMIT;
    if (!Number.isInteger(limit) || limit < 1 || limit > FULL_CLOSING_HISTORY_LIMIT) {
      throw new BadRequestException("Invalid daily-sales history limit.");
    }
    return this.database.inTenantTransaction(
      context.tenantId,
      async (transaction) => {
        const closings = await transaction.financeDailySalesClosing.findMany({
          where: {
            tenantId: context.tenantId,
            companyId: context.companyId,
            ...this.businessDateWhere(range),
          },
          orderBy: [
            { businessDate: "desc" },
            { scope: "asc" },
            { postingVersion: "desc" },
          ],
          take: limit,
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
        return closings.map((closing) => ({
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
        }));
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
          take: MAX_RANGE_DAYS,
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
            isSalesChannel: true,
          },
        });
        return vaults;
      },
    );
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
    const days = this.periods(range).reduce(
      (total, period) => total + Math.floor((period.to.getTime() - period.from.getTime()) / 86_400_000) + 1,
      0,
    );
    if (days > MAX_RANGE_DAYS)
      throw new BadRequestException(
        "The daily-sales range may not exceed 400 days.",
      );
  }
}
