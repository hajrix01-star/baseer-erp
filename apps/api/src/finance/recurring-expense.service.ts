import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceCategoryKind,
  FinanceCategoryStatus,
  FinanceRecurringExpenseStatus,
  FinanceSupplierStatus,
  FinanceVaultStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { RequestContext } from '../observability/request-context.js';

export type CreateRecurringExpenseProfileRequest = Readonly<{
  nameAr: string;
  nameEn?: string | undefined;
  categoryId: string;
  supplierId?: string | undefined;
  serviceNumber?: string | undefined;
  expectedAmount: string;
  intervalMonths: number;
  nextReminderDate: Date;
  defaultVaultId?: string | undefined;
  allowAmountOverride: boolean;
  notes?: string | undefined;
}>;

@Injectable()
export class RecurringExpenseService {
  constructor(private readonly database: DatabaseService, private readonly idempotency: IdempotencyService) {}

  async list(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const profiles = await tx.financeRecurringExpenseProfile.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        orderBy: [{ status: 'asc' }, { nextReminderDate: 'asc' }, { nameAr: 'asc' }],
        include: { supplier: { select: { nameAr: true, nameEn: true } }, category: { select: { nameAr: true, nameEn: true } } },
      });
      return profiles.map((profile) => ({
        id: profile.id,
        nameAr: profile.nameAr,
        nameEn: profile.nameEn,
        supplierId: profile.supplierId,
        supplierNameAr: profile.supplier?.nameAr ?? null,
        supplierNameEn: profile.supplier?.nameEn ?? null,
        categoryId: profile.categoryId,
        categoryNameAr: profile.category.nameAr,
        categoryNameEn: profile.category.nameEn,
        serviceNumber: profile.serviceNumber,
        expectedAmount: profile.expectedAmount.toFixed(4),
        intervalMonths: profile.intervalMonths,
        nextReminderDate: profile.nextReminderDate,
        defaultVaultId: profile.defaultVaultId,
        allowAmountOverride: profile.allowAmountOverride,
        status: profile.status,
        notes: profile.notes,
      }));
    });
  }

  async createProfile(context: TrustedCompanyActorContext, input: CreateRecurringExpenseProfileRequest, idempotencyKey: string) {
    const payload = normalise(input);
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, {
        operation: 'finance.recurring_expense.profile.create', key: idempotencyKey, request: profilePayload(payload),
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begun.kind === 'replay') return begun.response.body as { id: string; status: 'ACTIVE'; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The recurring-expense request is already being processed.');
      await this.assertReferences(tx, context, payload);
      const id = randomUUID();
      await tx.financeRecurringExpenseProfile.create({ data: { id, tenantId: context.tenantId, companyId: context.companyId, ...payload, status: FinanceRecurringExpenseStatus.ACTIVE } });
      const receipt = { id, status: 'ACTIVE' as const, replayed: false };
      await this.audit(tx, context, 'finance.recurring_expense.profile.created', id, null, { ...payload, expectedAmount: payload.expectedAmount.toFixed(4), nextReminderDate: payload.nextReminderDate.toISOString() });
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    }).catch((error) => { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different recurring-expense data.'); throw error; });
  }

  async archiveProfile(context: TrustedCompanyActorContext, profileId: string, idempotencyKey: string) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      const begun = await this.idempotency.beginInTransaction(tx, context, {
        operation: 'finance.recurring_expense.profile.archive', key: idempotencyKey, request: { profileId },
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begun.kind === 'replay') return begun.response.body as { id: string; status: 'ARCHIVED'; replayed: boolean };
      if (begun.kind === 'in-progress') throw new ConflictException('The recurring-expense request is already being processed.');
      const profile = await tx.financeRecurringExpenseProfile.findFirst({ where: { id: profileId, tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, status: true } });
      if (!profile) throw new NotFoundException('The recurring expense was not found.');
      if (profile.status !== FinanceRecurringExpenseStatus.ARCHIVED) await tx.financeRecurringExpenseProfile.update({ where: { id: profile.id }, data: { status: FinanceRecurringExpenseStatus.ARCHIVED } });
      const receipt = { id: profile.id, status: 'ARCHIVED' as const, replayed: false };
      await this.audit(tx, context, 'finance.recurring_expense.profile.archived', profile.id, { status: profile.status }, receipt);
      await this.idempotency.completeInTransaction(tx, context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    }).catch((error) => { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different recurring-expense data.'); throw error; });
  }

  private async assertReferences(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, value: NormalisedProfile) {
    const category = await tx.financeCategory.findFirst({ where: { id: value.categoryId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceCategoryStatus.ACTIVE, isPosting: true, kind: FinanceCategoryKind.EXPENSE }, select: { id: true } });
    if (!category) throw new BadRequestException('A posting expense category is required for a recurring expense.');
    if (value.supplierId) {
      const supplier = await tx.financeSupplier.findFirst({ where: { id: value.supplierId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceSupplierStatus.ACTIVE }, select: { id: true } });
      if (!supplier) throw new NotFoundException('The active supplier was not found.');
    }
    if (value.defaultVaultId) {
      const vault = await tx.financeVault.findFirst({ where: { id: value.defaultVaultId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceVaultStatus.ACTIVE, isPaymentDestination: true }, select: { id: true } });
      if (!vault) throw new BadRequestException('The default payment destination is unavailable.');
    }
  }

  private async audit(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, action: string, entityId: string, beforeJson: unknown, afterJson: unknown) {
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action, entityType: 'FinanceRecurringExpenseProfile', entityId, requestId: RequestContext.correlationId() ?? randomUUID(), beforeJson: beforeJson === null ? Prisma.JsonNull : beforeJson as Prisma.InputJsonValue, afterJson: afterJson as Prisma.InputJsonValue } });
  }
}

type NormalisedProfile = { nameAr: string; nameEn: string; categoryId: string; supplierId: string | null; serviceNumber: string | null; expectedAmount: Prisma.Decimal; intervalMonths: number; nextReminderDate: Date; defaultVaultId: string | null; allowAmountOverride: boolean; notes: string | null };
function normalise(input: CreateRecurringExpenseProfileRequest): NormalisedProfile {
  const nameAr = required(input.nameAr, 160, 'A recurring-expense name is required.');
  const nameEn = optional(input.nameEn, 160) ?? nameAr;
  const amount = money(input.expectedAmount);
  if (![1, 2, 3, 4, 6, 12].includes(input.intervalMonths)) throw new BadRequestException('Recurring intervals must be 1, 2, 3, 4, 6, or 12 months.');
  if (!(input.nextReminderDate instanceof Date) || Number.isNaN(input.nextReminderDate.valueOf())) throw new BadRequestException('A valid next due date is required.');
  return { nameAr, nameEn, categoryId: input.categoryId, supplierId: input.supplierId ?? null, serviceNumber: optional(input.serviceNumber, 160), expectedAmount: amount, intervalMonths: input.intervalMonths, nextReminderDate: input.nextReminderDate, defaultVaultId: input.defaultVaultId ?? null, allowAmountOverride: input.allowAmountOverride, notes: optional(input.notes, 2_000) };
}
function required(value: string, max: number, message: string) { const text = value?.trim(); if (!text || text.length > max) throw new BadRequestException(message); return text; }
function optional(value: string | undefined, max: number) { const text = value?.trim(); if (!text) return null; if (text.length > max) throw new BadRequestException('Text exceeds the permitted length.'); return text; }
function money(value: string) { try { const amount = new Prisma.Decimal(value); if (!amount.isFinite() || amount.lte(0) || (amount.decimalPlaces() ?? 0) > 4) throw new Error(); return amount; } catch { throw new BadRequestException('The expected recurring amount is invalid.'); } }
function profilePayload(value: NormalisedProfile) { return { ...value, expectedAmount: value.expectedAmount.toFixed(4), nextReminderDate: value.nextReminderDate.toISOString() } as const; }