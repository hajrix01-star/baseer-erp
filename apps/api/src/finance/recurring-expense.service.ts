import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceCategoryKind,
  FinanceCategoryStatus,
  FinanceRecurringExpenseStatus,
  FinanceSupplierStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { RequestContext } from '../observability/request-context.js';

export type CreateRecurringExpenseProfileRequest = Readonly<{
  nameAr: string;
  nameEn: string;
  categoryId: string;
  supplierId?: string;
  expectedAmount: string;
  intervalMonths: number;
  nextReminderDate: Date;
  notes?: string;
}>;

/** A reminder template only. It never posts an expense, due, cash movement, or journal entry. */
@Injectable()
export class RecurringExpenseService {
  constructor(private readonly database: DatabaseService) {}

  async createProfile(
    context: TrustedCompanyActorContext,
    input: CreateRecurringExpenseProfileRequest,
  ): Promise<string> {
    const nameAr = requiredText(input.nameAr, 160, 'An Arabic recurring-expense name is required.');
    const nameEn = requiredText(input.nameEn, 160, 'An English recurring-expense name is required.');
    const amount = positiveAmount(input.expectedAmount, 'The expected recurring amount must be positive.');
    if (!Number.isInteger(input.intervalMonths) || input.intervalMonths < 1 || input.intervalMonths > 12) {
      throw new BadRequestException('Recurring interval months must be from 1 through 12.');
    }
    if (!(input.nextReminderDate instanceof Date) || Number.isNaN(input.nextReminderDate.valueOf())) {
      throw new BadRequestException('A valid next reminder date is required.');
    }
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const category = await transaction.financeCategory.findFirst({
        where: {
          id: input.categoryId,
          tenantId: context.tenantId,
          companyId: context.companyId,
          status: FinanceCategoryStatus.ACTIVE,
          isPosting: true,
          kind: { in: [FinanceCategoryKind.PURCHASE, FinanceCategoryKind.EXPENSE] },
        },
        select: { id: true },
      });
      if (!category) throw new NotFoundException('An active purchase or expense category is required.');
      if (input.supplierId) {
        const supplier = await transaction.financeSupplier.findFirst({
          where: { id: input.supplierId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceSupplierStatus.ACTIVE },
          select: { id: true },
        });
        if (!supplier) throw new NotFoundException('The active supplier was not found.');
      }
      const id = randomUUID();
      await transaction.financeRecurringExpenseProfile.create({
        data: {
          id,
          tenantId: context.tenantId,
          companyId: context.companyId,
          categoryId: category.id,
          supplierId: input.supplierId ?? null,
          nameAr,
          nameEn,
          expectedAmount: amount,
          intervalMonths: input.intervalMonths,
          nextReminderDate: input.nextReminderDate,
          status: FinanceRecurringExpenseStatus.ACTIVE,
          notes: optionalText(input.notes, 2_000) ?? null,
        },
      });
      await transaction.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
          action: 'finance.recurring_expense.created', entityType: 'FinanceRecurringExpenseProfile', entityId: id,
          requestId: RequestContext.correlationId() ?? randomUUID(),
          afterJson: { expectedAmount: amount.toFixed(4), intervalMonths: input.intervalMonths, nextReminderDate: input.nextReminderDate.toISOString() } as Prisma.InputJsonValue,
        },
      });
      return id;
    });
  }
}

function requiredText(value: string, maximumLength: number, message: string): string {
  const text = value?.trim();
  if (!text || text.length > maximumLength) throw new BadRequestException(message);
  return text;
}
function optionalText(value: string | undefined, maximumLength: number): string | undefined {
  if (value === undefined) return undefined;
  const text = value.trim();
  if (!text) return undefined;
  if (text.length > maximumLength) throw new BadRequestException('Recurring-expense notes exceed the permitted length.');
  return text;
}
function positiveAmount(value: string, message: string): Prisma.Decimal {
  try {
    const amount = new Prisma.Decimal(value);
    if (!amount.isFinite() || amount.lte(0) || (amount.decimalPlaces() ?? 0) > 4) throw new Error();
    return amount;
  } catch { throw new BadRequestException(message); }
}
