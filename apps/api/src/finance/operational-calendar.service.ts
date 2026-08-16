import { randomUUID } from 'node:crypto';

import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import {
  IdempotencyPayloadMismatchError,
  IdempotencyService,
  type CanonicalJsonValue,
} from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceDailySalesClosingStatus,
  FinanceDailySalesDataStatus,
  FinanceOperationalDaySource,
  FinanceOperationalDayStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { RequestContext } from '../observability/request-context.js';
import { DailySalesProjectionService } from './daily-sales-projection.service.js';

const SET_OPERATIONAL_DAY_OPERATION = 'finance.operational_day.set';
const MAX_CALENDAR_RANGE_DAYS = 400;

export type SetOperationalDayCommand = Readonly<{
  context: TrustedCompanyActorContext;
  idempotencyKey: string;
  request: Readonly<{
    businessDate: Date;
    status: FinanceOperationalDayStatus;
    source?: FinanceOperationalDaySource;
    note?: string;
  }>;
}>;

export type OperationalDayReceipt = Readonly<{
  businessDate: Date;
  status: FinanceOperationalDayStatus;
  source: FinanceOperationalDaySource;
  dataStatus: FinanceDailySalesDataStatus;
}>;

export type DailySalesCalendarItem = Readonly<{
  businessDate: Date;
  operationalStatus: FinanceOperationalDayStatus;
  dataStatus: FinanceDailySalesDataStatus;
  source: FinanceOperationalDaySource | null;
  hasActiveClosing: boolean;
  salesGrossAmount: string;
  customerCount: number;
}>;

@Injectable()
export class OperationalCalendarService {
  constructor(
    private readonly database: DatabaseService,
    private readonly idempotency: IdempotencyService,
    private readonly projections: DailySalesProjectionService,
  ) {}

  async setDay(command: SetOperationalDayCommand): Promise<OperationalDayReceipt> {
    return this.database.inTenantTransaction(command.context.tenantId, async (transaction) => {
      const businessDate = this.requiredDate(command.request.businessDate);
      const status = command.request.status;
      const source = command.request.source ?? FinanceOperationalDaySource.MANUAL;
      const note = this.optionalText(command.request.note, 1_000);
      if (status === FinanceOperationalDayStatus.CLOSED && !note) {
        throw new BadRequestException('A scheduled closed day requires a recorded reason.');
      }
      const begun = await this.begin(transaction, command.context, command.idempotencyKey, {
        businessDate: businessDate.toISOString().slice(0, 10),
        status,
        source,
        note,
      });
      if (begun.kind === 'replay') return this.hydrateReceipt(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('The operational-calendar request is still in progress.');

      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`${command.context.tenantId}:${command.context.companyId}:operational-day:${businessDate.toISOString().slice(0, 10)}`}, 0))
      `;
      const activeClosings = await transaction.financeDailySalesClosing.count({
        where: {
          tenantId: command.context.tenantId,
          companyId: command.context.companyId,
          businessDate,
          status: FinanceDailySalesClosingStatus.POSTED,
        },
      });
      if (status === FinanceOperationalDayStatus.CLOSED && activeClosings > 0) {
        throw new ConflictException('A day with active sales closings cannot be marked closed. Reverse the closings first.');
      }
      const before = await transaction.financeOperationalDay.findFirst({
        where: { tenantId: command.context.tenantId, companyId: command.context.companyId, businessDate },
        select: { id: true, status: true, source: true, note: true },
      });
      const day = await transaction.financeOperationalDay.upsert({
        where: { companyId_businessDate: { companyId: command.context.companyId, businessDate } },
        create: {
          id: randomUUID(),
          tenantId: command.context.tenantId,
          companyId: command.context.companyId,
          businessDate,
          status,
          source,
          note,
          createdByUserId: command.context.actorUserId,
          updatedByUserId: command.context.actorUserId,
        },
        update: {
          status,
          source,
          note,
          updatedByUserId: command.context.actorUserId,
        },
        select: { status: true, source: true },
      });
      const requestId = RequestContext.correlationId() ?? randomUUID();
      const summary = await this.projections.rebuildInTransaction(transaction, command.context, {
        businessDate,
        requestId,
      });
      const receipt: OperationalDayReceipt = {
        businessDate,
        status: day.status,
        source: day.source,
        dataStatus: summary.dataStatus,
      };
      await transaction.auditEvent.create({
        data: {
          id: randomUUID(),
          tenantId: command.context.tenantId,
          companyId: command.context.companyId,
          actorUserId: command.context.actorUserId,
          action: 'finance.operational_day.set',
          entityType: 'FinanceOperationalDay',
          entityId: before?.id ?? `${command.context.companyId}:${businessDate.toISOString().slice(0, 10)}`,
          requestId,
          beforeJson: (before ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          afterJson: this.serialiseReceipt(receipt) as Prisma.InputJsonValue,
        },
      });
      await this.idempotency.completeInTransaction(transaction, command.context, {
        receiptId: begun.receiptId,
        response: { status: 200, headers: null, body: this.serialiseReceipt(receipt) },
      });
      return receipt;
    });
  }

  async listCalendar(
    context: TrustedCompanyActorContext,
    input: { fromBusinessDate: Date; toBusinessDate: Date; businessMonths?: readonly string[] },
  ): Promise<readonly DailySalesCalendarItem[]> {
    const from = this.requiredDate(input.fromBusinessDate);
    const to = this.requiredDate(input.toBusinessDate);
    if (from > to) throw new BadRequestException('The calendar start date cannot be after the end date.');
    const dates = input.businessMonths?.length
      ? input.businessMonths.flatMap((month) => datesForMonth(month))
      : datesInclusive(from, to);
    if (dates.length > MAX_CALENDAR_RANGE_DAYS) {
      throw new BadRequestException(`The calendar range cannot exceed ${MAX_CALENDAR_RANGE_DAYS} days.`);
    }
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [days, summaries] = await Promise.all([
        transaction.financeOperationalDay.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, businessDate: { in: dates } },
          select: { businessDate: true, status: true, source: true },
        }),
        transaction.financeDailyFinancialSummary.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, businessDate: { in: dates } },
          select: { businessDate: true, dataStatus: true, salesGrossAmount: true, customerCount: true, salesClosingCount: true },
        }),
      ]);
      const daysByDate = new Map(days.map((day) => [day.businessDate.toISOString().slice(0, 10), day]));
      const summariesByDate = new Map(summaries.map((summary) => [summary.businessDate.toISOString().slice(0, 10), summary]));
      return dates.map((businessDate) => {
        const key = businessDate.toISOString().slice(0, 10);
        const day = daysByDate.get(key);
        const summary = summariesByDate.get(key);
        const operationalStatus = day?.status ?? FinanceOperationalDayStatus.OPEN;
        const dataStatus = summary?.dataStatus ?? (
          operationalStatus === FinanceOperationalDayStatus.CLOSED
            ? FinanceDailySalesDataStatus.CLOSED
            : FinanceDailySalesDataStatus.PENDING
        );
        return {
          businessDate,
          operationalStatus,
          dataStatus,
          source: day?.source ?? null,
          hasActiveClosing: (summary?.salesClosingCount ?? 0) > 0,
          salesGrossAmount: summary?.salesGrossAmount.toFixed(4) ?? '0.0000',
          customerCount: summary?.customerCount ?? 0,
        };
      });
    });
  }

  private serialiseReceipt(receipt: OperationalDayReceipt): CanonicalJsonValue {
    return {
      businessDate: receipt.businessDate.toISOString().slice(0, 10),
      status: receipt.status,
      source: receipt.source,
      dataStatus: receipt.dataStatus,
    };
  }

  private hydrateReceipt(value: CanonicalJsonValue | null): OperationalDayReceipt {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new ConflictException('The saved operational-calendar idempotency receipt is invalid.');
    }
    const item = value as Record<string, CanonicalJsonValue>;
    if (typeof item.businessDate !== 'string' || typeof item.status !== 'string' || typeof item.source !== 'string' || typeof item.dataStatus !== 'string') {
      throw new ConflictException('The saved operational-calendar idempotency receipt is invalid.');
    }
    return {
      businessDate: new Date(`${item.businessDate}T00:00:00.000Z`),
      status: item.status as FinanceOperationalDayStatus,
      source: item.source as FinanceOperationalDaySource,
      dataStatus: item.dataStatus as FinanceDailySalesDataStatus,
    };
  }
  private async begin(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    key: string,
    request: Record<string, string | null>,
  ) {
    try {
      return await this.idempotency.beginInTransaction(transaction, context, {
        operation: SET_OPERATIONAL_DAY_OPERATION,
        key,
        request,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      });
    } catch (error) {
      if (error instanceof IdempotencyPayloadMismatchError) {
        throw new ConflictException('The idempotency key was already used with a different operational-calendar request.');
      }
      throw error;
    }
  }

  private requiredDate(value: Date): Date {
    if (!(value instanceof Date) || Number.isNaN(value.valueOf())) throw new BadRequestException('A valid business date is required.');
    return value;
  }

  private optionalText(value: string | undefined, maximumLength: number): string | null {
    if (value === undefined) return null;
    const text = value.trim();
    if (!text) return null;
    if (text.length > maximumLength) throw new BadRequestException('The calendar note is too long.');
    return text;
  }
}

function datesInclusive(from: Date, to: Date): Date[] {
  const result: Date[] = [];
  for (let cursor = new Date(`${from.toISOString().slice(0, 10)}T00:00:00.000Z`); cursor <= to; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    result.push(new Date(cursor));
  }
  return result;
}
function datesForMonth(month: string): Date[] {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new BadRequestException('A selected business month is invalid.');
  const year = Number(month.slice(0, 4));
  const monthNumber = Number(month.slice(5, 7));
  return datesInclusive(new Date(Date.UTC(year, monthNumber - 1, 1)), new Date(Date.UTC(year, monthNumber, 0)));
}