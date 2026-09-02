import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import { IdempotencyService } from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import {
  FinanceFiscalPeriodStatus,
  Prisma,
} from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";
import { assertPayrollReadyForPeriodClose } from "./finance-period-close-readiness.js";

@Injectable()
export class FinancePeriodCommandService {
  constructor(
    private readonly database: DatabaseService,
    private readonly idempotency: IdempotencyService,
  ) {}

  close(
    context: TrustedCompanyActorContext,
    periodId: string,
    reason: string,
    key: string,
  ) {
    return this.transition(
      context,
      periodId,
      reason,
      key,
      FinanceFiscalPeriodStatus.OPEN,
      FinanceFiscalPeriodStatus.CLOSED,
      "finance.period.close",
    );
  }
  lock(context: TrustedCompanyActorContext, periodId: string, key: string) {
    return this.transition(
      context,
      periodId,
      undefined,
      key,
      FinanceFiscalPeriodStatus.CLOSED,
      FinanceFiscalPeriodStatus.LOCKED,
      "finance.period.lock",
    );
  }
  reopen(
    context: TrustedCompanyActorContext,
    periodId: string,
    reason: string,
    key: string,
  ) {
    return this.transition(
      context,
      periodId,
      reason,
      key,
      FinanceFiscalPeriodStatus.CLOSED,
      FinanceFiscalPeriodStatus.OPEN,
      "finance.period.reopen",
    );
  }

  private async transition(
    context: TrustedCompanyActorContext,
    periodId: string,
    reason: string | undefined,
    key: string,
    expected: FinanceFiscalPeriodStatus,
    next: FinanceFiscalPeriodStatus,
    operation: string,
  ) {
    if (!uuid(periodId) || !key?.trim())
      throw new BadRequestException(
        "A valid period and idempotency key are required.",
      );
    if (
      (next === FinanceFiscalPeriodStatus.CLOSED ||
        next === FinanceFiscalPeriodStatus.OPEN) &&
      !text(reason, 500)
    )
      throw new BadRequestException("A non-blank reason is required.");
    return this.database.inTenantTransaction(
      context.tenantId,
      async (transaction) => {
        const begun = await this.idempotency.beginInTransaction(
          transaction,
          context,
          {
            operation,
            key,
            request: { periodId, reason: reason?.trim() ?? null, next },
            expiresAt: new Date(Date.now() + 86_400_000),
          },
        );
        if (begun.kind === "replay")
          return begun.response.body as {
            periodId: string;
            status: FinanceFiscalPeriodStatus;
          };
        if (begun.kind === "in-progress")
          throw new ConflictException(
            "The fiscal-period request is still in progress.",
          );
        const initial = await transaction.financeFiscalPeriod.findFirst({
          where: {
            id: periodId,
            tenantId: context.tenantId,
            companyId: context.companyId,
          },
          select: { id: true },
        });
        if (!initial)
          throw new NotFoundException("The fiscal period was not found.");
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:finance-period:${periodId}`}, 0))`;
        const current = await transaction.financeFiscalPeriod.findFirst({
          where: { id: periodId, tenantId: context.tenantId, companyId: context.companyId },
          select: { status: true, startDate: true, endDate: true },
        });
        if (!current) throw new NotFoundException("The fiscal period was not found.");
        if (current.status !== expected) throw new ConflictException("The fiscal period is not in the required lifecycle state.");
        if (next === FinanceFiscalPeriodStatus.CLOSED) await assertPayrollReadyForPeriodClose(transaction, context, current);
        const updated = await transaction.financeFiscalPeriod.updateMany({
          where: {
            id: periodId,
            tenantId: context.tenantId,
            companyId: context.companyId,
            status: expected,
          },
          data:
            next === FinanceFiscalPeriodStatus.CLOSED
              ? {
                  status: next,
                  closedAt: new Date(),
                  closeReason: reason!.trim(),
                }
              : next === FinanceFiscalPeriodStatus.LOCKED
                ? { status: next, lockedAt: new Date() }
                : { status: next, closedAt: null, closeReason: null },
        });
        if (updated.count !== 1)
          throw new ConflictException(
            "The fiscal period is not in the required lifecycle state.",
          );
        const receipt = { periodId, status: next };
        await transaction.auditEvent.create({
          data: {
            id: randomUUID(),
            tenantId: context.tenantId,
            companyId: context.companyId,
            actorUserId: context.actorUserId,
            action: operation,
            entityType: "FinanceFiscalPeriod",
            entityId: periodId,
            requestId: RequestContext.correlationId() ?? randomUUID(),
            afterJson: receipt as Prisma.InputJsonValue,
          },
        });
        await this.idempotency.completeInTransaction(transaction, context, {
          receiptId: begun.receiptId,
          response: { status: 200, headers: null, body: receipt },
        });
        return receipt;
      },
    );
  }
}
function text(value: string | undefined, max: number) {
  return (
    typeof value === "string" && value.trim().length > 0 && value.length <= max
  );
}
function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}
