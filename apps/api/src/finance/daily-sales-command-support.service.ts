import { createHash, randomUUID } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
} from "@nestjs/common";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import {
  IdempotencyPayloadMismatchError,
  IdempotencyService,
  type CanonicalJsonValue,
} from "../core-controls/idempotency.service.js";
import type { SqlDate } from "../core-controls/document-serial.service.js";
import { Prisma, FinanceDailySalesClosingScope, FinanceDailySalesClosingStatus } from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";
import type { DailySalesAccounting, ValidatedDailySalesFields } from "./daily-sales-posting.service.js";
import type {
  CreateDailySalesClosingRequest,
  CorrectDailySalesClosingRequest,
  DailySalesAllocationInput,
  DailySalesClosingReceipt,
} from "./daily-sales.types.js";

@Injectable()
export class DailySalesCommandSupportService {
  constructor(private readonly idempotency: IdempotencyService) {}
  async complete(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    input: Parameters<IdempotencyService["completeInTransaction"]>[2],
  ) {
    return this.idempotency.completeInTransaction(transaction, context, input);
  }
  async lockScope(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    businessDate: Date,
    scope: FinanceDailySalesClosingScope,
  ): Promise<void> {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:daily-sales:${this.dateValue(businessDate)}:${scope}`}, 0))
    `;
  }

  async lockBusinessDate(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    businessDate: Date,
  ): Promise<void> {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:daily-sales-day:${this.dateValue(businessDate)}`}, 0))
    `;
  }

  async assertScopeCombination(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    businessDate: Date,
    scope: FinanceDailySalesClosingScope,
  ): Promise<void> {
    const conflictingScope = scope === FinanceDailySalesClosingScope.ALL
      ? { in: [FinanceDailySalesClosingScope.MORNING, FinanceDailySalesClosingScope.EVENING] }
      : { equals: FinanceDailySalesClosingScope.ALL };
    const conflict = await transaction.financeDailySalesClosing.findFirst({
      where: {
        tenantId: context.tenantId,
        companyId: context.companyId,
        businessDate,
        status: FinanceDailySalesClosingStatus.POSTED,
        scope: conflictingScope,
      },
      select: { id: true },
    });
    if (conflict) {
      throw new ConflictException(
        "Whole-day closing cannot be combined with morning or evening closings for the same date.",
      );
    }
  }

  async lockClosing(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    closingId: string,
  ): Promise<void> {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:daily-sales-closing:${closingId}`}, 0))
    `;
  }

  async begin(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    operation: string,
    key: string,
    request: CanonicalJsonValue,
  ) {
    try {
      return await this.idempotency.beginInTransaction(transaction, context, {
        operation,
        key,
        request,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1_000),
      });
    } catch (error) {
      if (error instanceof IdempotencyPayloadMismatchError) {
        throw new ConflictException(
          "The idempotency key was already used with a different daily-sales request.",
        );
      }
      throw error;
    }
  }

  receipt(
    input: Readonly<{
      closingId: string;
      documentNumber: string;
      postingVersion: number;
      journalEntryId: string;
      fields: ValidatedDailySalesFields;
      accounting: DailySalesAccounting;
      status: FinanceDailySalesClosingStatus;
    }>,
  ): DailySalesClosingReceipt {
    return {
      closingId: input.closingId,
      documentNumber: input.documentNumber,
      businessDate: input.fields.businessDate,
      scope: input.fields.scope,
      postingVersion: input.postingVersion,
      journalEntryId: input.journalEntryId,
      grossAmount: input.fields.grossAmount.toFixed(4),
      netAmount: input.accounting.netAmount.toFixed(4),
      vatAmount: input.accounting.vatAmount.toFixed(4),
      vatRateBasisPoints: input.accounting.vatRateBasisPoints,
      customerCount: input.fields.customerCount,
      cashHandoverAmount: input.fields.cashHandoverAmount?.toFixed(4) ?? null,
      cashHandoverVaultId: input.fields.cashHandoverVaultId,
      status: input.status,
      allocations: input.fields.allocations.map((allocation) => ({
        vaultId: allocation.vaultId,
        grossAmount: allocation.grossAmount.toFixed(4),
      })),
    };
  }

  requestForCreate(
    request: CreateDailySalesClosingRequest,
  ): CanonicalJsonValue {
    return {
      businessDate: this.dateValue(request.businessDate),
      scope: request.scope,
      customerCount: request.customerCount,
      allocations: request.allocations,
      cashHandoverAmount: request.cashHandoverAmount ?? null,
      cashHandoverVaultId: request.cashHandoverVaultId ?? null,
      notes: request.notes ?? null,
    };
  }

  requestForCorrect(
    request: CorrectDailySalesClosingRequest,
  ): CanonicalJsonValue {
    return {
      closingId: request.closingId,
      customerCount: request.customerCount,
      allocations: request.allocations,
      cashHandoverAmount: request.cashHandoverAmount ?? null,
      cashHandoverVaultId: request.cashHandoverVaultId ?? null,
      notes: request.notes ?? null,
    };
  }

  closingSnapshot(closing: {
    id: string;
    documentNumber: string;
    postingVersion: number;
    grossAmount: Prisma.Decimal;
    netAmount: Prisma.Decimal;
    vatAmount: Prisma.Decimal;
    customerCount: number;
    cashHandoverAmount: Prisma.Decimal | null;
    cashHandoverVaultId: string | null;
    notes: string | null;
    journalEntryId: string;
    allocations: readonly { vaultId: string; grossAmount: Prisma.Decimal }[];
  }): Prisma.InputJsonValue {
    return {
      closingId: closing.id,
      documentNumber: closing.documentNumber,
      postingVersion: closing.postingVersion,
      grossAmount: closing.grossAmount.toFixed(4),
      netAmount: closing.netAmount.toFixed(4),
      vatAmount: closing.vatAmount.toFixed(4),
      customerCount: closing.customerCount,
      cashHandoverAmount: closing.cashHandoverAmount?.toFixed(4) ?? null,
      cashHandoverVaultId: closing.cashHandoverVaultId,
      notes: closing.notes,
      journalEntryId: closing.journalEntryId,
      allocations: closing.allocations.map((allocation) => ({
        vaultId: allocation.vaultId,
        grossAmount: allocation.grossAmount.toFixed(4),
      })),
    };
  }

  async audit(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    requestId: string,
    action: string,
    closingId: string,
    beforeJson: Prisma.InputJsonValue | null,
    afterJson: CanonicalJsonValue,
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        tenantId: context.tenantId,
        companyId: context.companyId,
        actorUserId: context.actorUserId,
        action,
        entityType: "FinanceDailySalesClosing",
        entityId: closingId,
        requestId,
        ...(beforeJson === null ? {} : { beforeJson }),
        afterJson: afterJson as Prisma.InputJsonValue,
      },
    });
  }

  serialiseReceipt(
    receipt: DailySalesClosingReceipt,
  ): CanonicalJsonValue {
    return {
      ...receipt,
      businessDate: this.dateValue(receipt.businessDate),
      allocations: receipt.allocations.map((allocation) => ({ ...allocation })),
    };
  }

  hydrateReceipt(
    value: CanonicalJsonValue | null,
  ): DailySalesClosingReceipt {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new ConflictException(
        "The saved daily-sales idempotency receipt is invalid.",
      );
    }
    const item = value as Record<string, CanonicalJsonValue>;
    if (
      typeof item.businessDate !== "string" ||
      !Array.isArray(item.allocations)
    ) {
      throw new ConflictException(
        "The saved daily-sales idempotency receipt is invalid.",
      );
    }
    return {
      ...(item as unknown as Omit<
        DailySalesClosingReceipt,
        "businessDate" | "allocations"
      >),
      businessDate: new Date(`${item.businessDate}T00:00:00.000Z`),
      allocations:
        item.allocations as unknown as readonly DailySalesAllocationInput[],
    };
  }

  sqlDateValue(value: Date): SqlDate {
    return this.dateValue(value) as SqlDate;
  }
  checksumFor(
    fields: ValidatedDailySalesFields,
    accounting: DailySalesAccounting,
  ): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          businessDate: this.sqlDateValue(fields.businessDate),
          scope: fields.scope,
          customerCount: fields.customerCount,
          allocations: fields.allocations.map((allocation) => ({
            vaultId: allocation.vaultId,
            grossAmount: allocation.grossAmount.toFixed(4),
          })),
          cashHandoverAmount: fields.cashHandoverAmount?.toFixed(4) ?? null,
          cashHandoverVaultId: fields.cashHandoverVaultId,
          notes: fields.notes,
          netAmount: accounting.netAmount.toFixed(4),
          vatAmount: accounting.vatAmount.toFixed(4),
          vatRateBasisPoints: accounting.vatRateBasisPoints,
        }),
      )
      .digest("hex");
  }

  requiredDate(value: Date, message: string): Date {
    if (!(value instanceof Date) || Number.isNaN(value.valueOf()))
      throw new BadRequestException(message);
    return value;
  }

  dateValue(value: Date): string {
    return this.requiredDate(value, "A valid business date is required.")
      .toISOString()
      .slice(0, 10);
  }

  requiredText(
    value: string,
    message: string,
    maximumLength: number,
  ): string {
    const text = value.trim();
    if (!text || text.length > maximumLength)
      throw new BadRequestException(message);
    return text;
  }

  optionalText(
    value: string | undefined,
    maximumLength: number,
  ): string | null {
    if (value === undefined) return null;
    const text = value.trim();
    if (!text) return null;
    if (text.length > maximumLength)
      throw new BadRequestException(
        "Daily sales text exceeds the permitted length.",
      );
    return text;
  }

  requestId(): string {
    return RequestContext.correlationId() ?? randomUUID();
  }
}
