import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceFiscalPeriodStatus, Prisma } from '../generated/prisma/client.js';
import { RequestContext } from '../observability/request-context.js';
import { FinancePeriodService } from './finance-period.service.js';
import { assertPayrollReadyForPeriodClose } from './finance-period-close-readiness.js';

type CreatePeriodInput = Readonly<{
  nameAr: string;
  nameEn: string;
  startDate: Date;
  endDate: Date;
}>;

type PeriodActionInput = Readonly<{
  periodId: string;
  reason?: string;
}>;

@Injectable()
export class FinancePeriodLifecycleService {
  constructor(
    private readonly database: DatabaseService,
    private readonly periods: FinancePeriodService,
  ) {}

  async createOpenPeriod(
    context: TrustedCompanyActorContext,
    input: CreatePeriodInput,
  ): Promise<string> {
    this.assertPeriodInput(input);
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await this.periods.assertNoPeriodOverlap(transaction, {
        tenantId: context.tenantId,
        companyId: context.companyId,
        startDate: input.startDate,
        endDate: input.endDate,
      });
      const periodId = randomUUID();
      await transaction.financeFiscalPeriod.create({
        data: {
          id: periodId,
          tenantId: context.tenantId,
          companyId: context.companyId,
          nameAr: input.nameAr.trim(),
          nameEn: input.nameEn.trim(),
          startDate: input.startDate,
          endDate: input.endDate,
          status: FinanceFiscalPeriodStatus.OPEN,
        },
      });
      await this.audit(transaction, context, 'finance.period.created', periodId, { status: 'OPEN' });
      return periodId;
    });
  }

  async close(
    context: TrustedCompanyActorContext,
    input: Required<PeriodActionInput>,
  ): Promise<void> {
    if (!isNonBlank(input.reason, 500)) {
      throw new BadRequestException('A non-blank close reason is required.');
    }
    return this.transition(context, input, FinanceFiscalPeriodStatus.OPEN, FinanceFiscalPeriodStatus.CLOSED, 'finance.period.closed');
  }

  async lock(
    context: TrustedCompanyActorContext,
    input: PeriodActionInput,
  ): Promise<void> {
    return this.transition(context, input, FinanceFiscalPeriodStatus.CLOSED, FinanceFiscalPeriodStatus.LOCKED, 'finance.period.locked');
  }

  /** Locked periods cannot reopen; their financial corrections must be reversals/adjustments. */
  async reopenClosed(
    context: TrustedCompanyActorContext,
    input: Required<PeriodActionInput>,
  ): Promise<void> {
    if (!isNonBlank(input.reason, 500)) {
      throw new BadRequestException('A non-blank reopen reason is required.');
    }
    return this.transition(context, input, FinanceFiscalPeriodStatus.CLOSED, FinanceFiscalPeriodStatus.OPEN, 'finance.period.reopened');
  }

  private async transition(
    context: TrustedCompanyActorContext,
    input: PeriodActionInput,
    expected: FinanceFiscalPeriodStatus,
    next: FinanceFiscalPeriodStatus,
    action: string,
  ): Promise<void> {
    if (!isUuid(input.periodId)) throw new BadRequestException('A valid fiscal period identifier is required.');
    if (input.reason !== undefined && !isNonBlank(input.reason, 500)) {
      throw new BadRequestException('The period reason must be non-blank and at most 500 characters.');
    }
    await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const selected = await transaction.financeFiscalPeriod.findFirst({
        where: { id: input.periodId, tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true },
      });
      if (!selected) throw new NotFoundException('The fiscal period was not found.');
      await transaction.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:finance-period:${selected.id}`}, 0))
      `;
      const existing = await transaction.financeFiscalPeriod.findFirst({
        where: { id: selected.id, tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, status: true, startDate: true, endDate: true },
      });
      if (!existing) throw new NotFoundException('The fiscal period was not found.');
      if (existing.status !== expected) {
        throw new ConflictException('The fiscal period is not in the required lifecycle state.');
      }
      if (next === FinanceFiscalPeriodStatus.CLOSED) {
        await assertPayrollReadyForPeriodClose(transaction, context, existing);
      }

      const now = new Date();
      const updated = await transaction.financeFiscalPeriod.updateMany({
        where: { id: existing.id, tenantId: context.tenantId, companyId: context.companyId, status: expected },
        data: {
          status: next,
          ...(next === FinanceFiscalPeriodStatus.CLOSED
            ? { closedAt: now, closeReason: input.reason!.trim() }
            : next === FinanceFiscalPeriodStatus.LOCKED
              ? { lockedAt: now }
              : { closedAt: null, closeReason: null }),
        },
      });
      if (updated.count !== 1) {
        throw new ConflictException('The fiscal period lifecycle changed concurrently.');
      }
      await this.audit(transaction, context, action, existing.id, {
        previousStatus: expected,
        nextStatus: next,
        reason: input.reason?.trim() ?? null,
      });
    });
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    action: string,
    entityId: string,
    afterJson: Prisma.InputJsonValue,
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        tenantId: context.tenantId,
        companyId: context.companyId,
        actorUserId: context.actorUserId,
        action,
        entityType: 'FinanceFiscalPeriod',
        entityId,
        requestId: RequestContext.correlationId() ?? randomUUID(),
        afterJson,
      },
    });
  }

  private assertPeriodInput(input: CreatePeriodInput): void {
    if (!isNonBlank(input.nameAr, 160) || !isNonBlank(input.nameEn, 160)) {
      throw new BadRequestException('Both Arabic and English fiscal-period names are required.');
    }
    if (!(input.startDate instanceof Date) || Number.isNaN(input.startDate.valueOf()) || !(input.endDate instanceof Date) || Number.isNaN(input.endDate.valueOf())) {
      throw new BadRequestException('Fiscal-period dates must be valid dates.');
    }
  }
}

function isNonBlank(value: unknown, maxLength: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maxLength;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
