import { BadRequestException, Injectable } from '@nestjs/common';

import { FinanceFiscalPeriodStatus, type Prisma } from '../generated/prisma/client.js';

@Injectable()
export class FinancePeriodService {
  async assertExactlyOneOpenPeriodForDate(
    transaction: Prisma.TransactionClient,
    input: { tenantId: string; companyId: string; businessDate: Date },
  ): Promise<string> {
    const candidates = await transaction.financeFiscalPeriod.findMany({
      where: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        status: FinanceFiscalPeriodStatus.OPEN,
        startDate: { lte: input.businessDate },
        endDate: { gte: input.businessDate },
      },
      select: { id: true },
      take: 2,
    });
    if (candidates.length !== 1) {
      throw new BadRequestException('Every financial operation must belong to exactly one open fiscal period.');
    }

    const periodId = candidates[0]!.id;
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${input.tenantId}:${input.companyId}:finance-period:${periodId}`}, 0))
    `;
    const period = await transaction.financeFiscalPeriod.findFirst({
      where: {
        id: periodId,
        tenantId: input.tenantId,
        companyId: input.companyId,
        status: FinanceFiscalPeriodStatus.OPEN,
        startDate: { lte: input.businessDate },
        endDate: { gte: input.businessDate },
      },
      select: { id: true },
    });
    if (!period) {
      throw new BadRequestException('The fiscal period was closed or locked before the financial operation could post.');
    }
    return period.id;
  }

  async assertNoPeriodOverlap(
    transaction: Prisma.TransactionClient,
    input: { tenantId: string; companyId: string; startDate: Date; endDate: Date; excludingId?: string },
  ): Promise<void> {
    if (input.startDate > input.endDate) {
      throw new BadRequestException('A fiscal period start date must not be after its end date.');
    }
    const overlapping = await transaction.financeFiscalPeriod.findFirst({
      where: {
        tenantId: input.tenantId,
        companyId: input.companyId,
        ...(input.excludingId ? { id: { not: input.excludingId } } : {}),
        startDate: { lte: input.endDate },
        endDate: { gte: input.startDate },
      },
      select: { id: true },
    });
    if (overlapping) throw new BadRequestException('Fiscal periods may not overlap.');
  }
}