import { BadRequestException, Injectable } from "@nestjs/common";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { DatabaseService } from "../database/database.service.js";
import { Prisma } from "../generated/prisma/client.js";

const MAX_RANGE_DAYS = 400;
export const CASHIER_CLOSING_HISTORY_LIMIT = 7;
export const FULL_CLOSING_HISTORY_LIMIT = MAX_RANGE_DAYS;

type DateRange = Readonly<{ fromBusinessDate: Date; toBusinessDate: Date }>;

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
            businessDate: {
              gte: range.fromBusinessDate,
              lte: range.toBusinessDate,
            },
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
      const handovers = await transaction.financeDailySalesClosing.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          status: "POSTED",
          cashHandoverAmount: { not: null },
          businessDate: { gte: range.fromBusinessDate, lte: range.toBusinessDate },
        },
        orderBy: [{ businessDate: "desc" }, { scope: "asc" }],
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
      });
      const total = handovers.reduce(
        (sum, item) => sum.plus(item.cashHandoverAmount ?? 0),
        new Prisma.Decimal(0),
      );
      return {
        totalCashHandoverAmount: total.toFixed(4),
        recordCount: handovers.length,
        handovers: handovers.flatMap((item) =>
          item.cashHandoverAmount && item.cashHandoverVaultId
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
    const closings = await this.listClosings(context, range);
    const scopes = ["MORNING", "EVENING", "ALL"] as const;
    return scopes.map((scope) => {
      const items = closings.filter((item) => item.scope === scope && item.status === "POSTED");
      const gross = items.reduce(
        (sum, item) => sum.plus(item.grossAmount),
        new Prisma.Decimal(0),
      );
      const customers = items.reduce((sum, item) => sum + item.customerCount, 0);
      return {
        scope,
        closingCount: items.length,
        grossAmount: gross.toFixed(4),
        customerCount: customers,
        averageOrderAmount: customers === 0 ? null : gross.div(customers).toDecimalPlaces(4).toFixed(4),
      };
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
    const days =
      Math.floor(
        (range.toBusinessDate.getTime() - range.fromBusinessDate.getTime()) /
          86_400_000,
      ) + 1;
    if (days > MAX_RANGE_DAYS)
      throw new BadRequestException(
        "The daily-sales range may not exceed 400 days.",
      );
  }
}
