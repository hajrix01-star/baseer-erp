import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";

import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import {
  IdempotencyPayloadMismatchError,
  IdempotencyService,
} from "../core-controls/idempotency.service.js";
import { DatabaseService } from "../database/database.service.js";
import {
  FinanceAccountStatus,
  FinanceAccountType,
  FinanceInclusiveLoanPaymentStatus,
  FinanceInclusiveLoanStatus,
  FinanceVaultStatus,
  Prisma,
} from "../generated/prisma/client.js";
import { RequestContext } from "../observability/request-context.js";
import { BusinessDateService } from "../business-date/business-date.service.js";
import { JournalPostingService } from "./journal/journal-posting.service.js";

const RECORD_REPAYMENT_OPERATION = "finance.inclusive_loan.repayment.record";
const REVERSE_REPAYMENT_OPERATION = "finance.inclusive_loan.repayment.reverse";
const INCLUSIVE_LOANS_SYSTEM_KEY = "INCLUSIVE_LOANS";

export type RecordInclusiveLoanRepaymentRequest = Readonly<{
  loanId: string;
  vaultId: string;
  businessDate: Date;
  amount: string;
}>;
export type ReverseInclusiveLoanRepaymentRequest = Readonly<{
  paymentId: string;
  businessDate: Date;
  reason: string;
}>;
export type InclusiveLoanRepaymentCommand<T> = Readonly<{
  context: TrustedCompanyActorContext;
  idempotencyKey: string;
  request: T;
}>;
export type InclusiveLoanRepaymentReceipt = Readonly<{
  paymentId: string;
  loanId: string;
  journalEntryId: string;
  amount: string;
  remainingAmount: string;
  status: FinanceInclusiveLoanStatus;
}>;

@Injectable()
export class InclusiveLoanRepaymentService {
  constructor(
    private readonly database: DatabaseService,
    private readonly idempotency: IdempotencyService,
    private readonly journals: JournalPostingService,
    private readonly businessDates: BusinessDateService,
  ) {}

  async recordRepayment(
    command: InclusiveLoanRepaymentCommand<RecordInclusiveLoanRepaymentRequest>,
  ): Promise<InclusiveLoanRepaymentReceipt> {
    return this.database
      .inTenantTransaction(command.context.tenantId, async (transaction) => {
        const begin = await this.begin(
          transaction,
          command,
          RECORD_REPAYMENT_OPERATION,
          {
            loanId: command.request.loanId,
            vaultId: command.request.vaultId,
            businessDate: validDate(command.request.businessDate).toISOString(),
            amount: command.request.amount,
          },
        );
        if (begin.kind === "replay")
          return begin.response
            .body as unknown as InclusiveLoanRepaymentReceipt;
        if (begin.kind === "in-progress")
          throw new ConflictException(
            "The loan repayment command is already in progress.",
          );
        const receipt = await this.recordInTransaction(
          transaction,
          command.context,
          command.request,
        );
        await this.idempotency.completeInTransaction(
          transaction,
          command.context,
          {
            receiptId: begin.receiptId,
            response: { status: 201, headers: null, body: receipt },
          },
        );
        return receipt;
      })
      .catch(rethrowIdempotencyMismatch);
  }

  async reverseRepayment(
    command: InclusiveLoanRepaymentCommand<ReverseInclusiveLoanRepaymentRequest>,
  ): Promise<InclusiveLoanRepaymentReceipt> {
    return this.database
      .inTenantTransaction(command.context.tenantId, async (transaction) => {
        const begin = await this.begin(
          transaction,
          command,
          REVERSE_REPAYMENT_OPERATION,
          {
            paymentId: command.request.paymentId,
            businessDate: validDate(command.request.businessDate).toISOString(),
            reason: requiredText(
              command.request.reason,
              1_000,
              "A reversal reason is required.",
            ),
          },
        );
        if (begin.kind === "replay")
          return begin.response
            .body as unknown as InclusiveLoanRepaymentReceipt;
        if (begin.kind === "in-progress")
          throw new ConflictException(
            "The loan repayment reversal command is already in progress.",
          );
        const receipt = await this.reverseInTransaction(
          transaction,
          command.context,
          command.request,
        );
        await this.idempotency.completeInTransaction(
          transaction,
          command.context,
          {
            receiptId: begin.receiptId,
            response: { status: 201, headers: null, body: receipt },
          },
        );
        return receipt;
      })
      .catch(rethrowIdempotencyMismatch);
  }

  private async recordInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: RecordInclusiveLoanRepaymentRequest,
  ): Promise<InclusiveLoanRepaymentReceipt> {
    const amount = positiveAmount(request.amount);
    const businessDate = validDate(request.businessDate);
    await this.businessDates.assertNotFutureInTransaction(
      transaction,
      context,
      businessDate,
      'An inclusive-loan repayment cannot use a future business date.',
    );
    await this.lock(transaction, context, `loan:${request.loanId}`);
    const loan = await transaction.financeInclusiveLoan.findFirst({
      where: {
        id: request.loanId,
        tenantId: context.tenantId,
        companyId: context.companyId,
        status: FinanceInclusiveLoanStatus.ACTIVE,
      },
      select: { id: true, remainingAmount: true, paidAmount: true },
    });
    if (!loan)
      throw new NotFoundException("The active inclusive loan was not found.");
    if (amount.gt(loan.remainingAmount))
      throw new ConflictException(
        "The repayment exceeds the remaining inclusive-loan balance.",
      );
    const [vault, loanAccount] = await Promise.all([
      transaction.financeVault.findFirst({
        where: {
          id: request.vaultId,
          tenantId: context.tenantId,
          companyId: context.companyId,
          status: FinanceVaultStatus.ACTIVE,
          isPaymentDestination: true,
        },
        select: {
          id: true,
          account: { select: { id: true, type: true, status: true } },
        },
      }),
      transaction.financeAccount.findFirst({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          systemKey: INCLUSIVE_LOANS_SYSTEM_KEY,
          status: FinanceAccountStatus.ACTIVE,
          type: FinanceAccountType.LIABILITY,
        },
        select: { id: true },
      }),
    ]);
    if (
      !vault ||
      vault.account.type !== FinanceAccountType.ASSET ||
      vault.account.status !== FinanceAccountStatus.ACTIVE ||
      !loanAccount
    )
      throw new NotFoundException(
        "An active company vault and inclusive-loan account are required.",
      );
    const paymentId = randomUUID();
    const journal = await this.journals.postInTransaction(transaction, {
      tenantId: context.tenantId,
      companyId: context.companyId,
      actorUserId: context.actorUserId,
      requestId: RequestContext.correlationId() ?? randomUUID(),
      sourceType: "inclusive_loan_repayment",
      sourceReference: `inclusive-loan-payment:${paymentId}:v1`,
      businessDate,
      description: `Inclusive loan repayment ${loan.id}`,
      lines: [
        { accountId: loanAccount.id, debitAmount: amount.toFixed(4) },
        { accountId: vault.account.id, creditAmount: amount.toFixed(4) },
      ],
    });
    const remainingAmount = loan.remainingAmount.minus(amount);
    const status = remainingAmount.eq(0)
      ? FinanceInclusiveLoanStatus.SETTLED
      : FinanceInclusiveLoanStatus.ACTIVE;
    await transaction.financeInclusiveLoanPayment.create({
      data: {
        id: paymentId,
        tenantId: context.tenantId,
        companyId: context.companyId,
        loanId: loan.id,
        vaultId: vault.id,
        amount,
        businessDate,
        journalEntryId: journal.journalEntryId,
      },
    });
    const updated = await transaction.financeInclusiveLoan.updateMany({
      where: {
        id: loan.id,
        tenantId: context.tenantId,
        companyId: context.companyId,
        status: FinanceInclusiveLoanStatus.ACTIVE,
        remainingAmount: { gte: amount },
      },
      data: { paidAmount: { increment: amount }, remainingAmount, status },
    });
    if (updated.count !== 1)
      throw new ConflictException(
        "The inclusive-loan balance changed concurrently.",
      );
    const receipt: InclusiveLoanRepaymentReceipt = {
      paymentId,
      loanId: loan.id,
      journalEntryId: journal.journalEntryId,
      amount: amount.toFixed(4),
      remainingAmount: remainingAmount.toFixed(4),
      status,
    };
    await this.audit(
      transaction,
      context,
      "finance.inclusive_loan.repayment.recorded",
      paymentId,
      receipt,
    );
    return receipt;
  }

  private async reverseInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: ReverseInclusiveLoanRepaymentRequest,
  ): Promise<InclusiveLoanRepaymentReceipt> {
    const businessDate = validDate(request.businessDate);
    await this.businessDates.assertNotFutureInTransaction(
      transaction,
      context,
      businessDate,
      'An inclusive-loan repayment reversal cannot use a future business date.',
    );
    const reason = requiredText(
      request.reason,
      1_000,
      "A reversal reason is required.",
    );
    await this.lock(transaction, context, `loan-payment:${request.paymentId}`);
    const payment = await transaction.financeInclusiveLoanPayment.findFirst({
      where: {
        id: request.paymentId,
        tenantId: context.tenantId,
        companyId: context.companyId,
        status: FinanceInclusiveLoanPaymentStatus.POSTED,
      },
      select: {
        id: true,
        loanId: true,
        amount: true,
        journalEntryId: true,
        reversalPayment: { select: { id: true } },
      },
    });
    if (!payment || !payment.journalEntryId)
      throw new NotFoundException("The posted loan repayment was not found.");
    if (payment.reversalPayment)
      throw new ConflictException(
        "The loan repayment has already been reversed.",
      );
    await this.lock(transaction, context, `loan:${payment.loanId}`);
    const loan = await transaction.financeInclusiveLoan.findFirst({
      where: {
        id: payment.loanId,
        tenantId: context.tenantId,
        companyId: context.companyId,
      },
      select: { id: true, remainingAmount: true, paidAmount: true },
    });
    if (!loan || payment.amount.gt(loan.paidAmount))
      throw new ConflictException(
        "The loan balance cannot be reversed safely.",
      );
    const journal = await this.journals.reverseInTransaction(transaction, {
      tenantId: context.tenantId,
      companyId: context.companyId,
      actorUserId: context.actorUserId,
      requestId: RequestContext.correlationId() ?? randomUUID(),
      journalEntryId: payment.journalEntryId,
      businessDate,
      reason,
    });
    const remainingAmount = loan.remainingAmount.plus(payment.amount);
    await transaction.financeInclusiveLoanPayment.update({
      where: { id: payment.id },
      data: { status: FinanceInclusiveLoanPaymentStatus.REVERSED },
    });
    const reversalPaymentId = randomUUID();
    await transaction.financeInclusiveLoanPayment.create({
      data: {
        id: reversalPaymentId,
        tenantId: context.tenantId,
        companyId: context.companyId,
        loanId: loan.id,
        vaultId: (
          await transaction.financeInclusiveLoanPayment.findUniqueOrThrow({
            where: { id: payment.id },
            select: { vaultId: true },
          })
        ).vaultId,
        amount: payment.amount,
        businessDate,
        status: FinanceInclusiveLoanPaymentStatus.REVERSED,
        reversalOfId: payment.id,
        journalEntryId: journal.journalEntryId,
      },
    });
    const updated = await transaction.financeInclusiveLoan.updateMany({
      where: {
        id: loan.id,
        tenantId: context.tenantId,
        companyId: context.companyId,
        paidAmount: { gte: payment.amount },
      },
      data: {
        paidAmount: { decrement: payment.amount },
        remainingAmount,
        status: FinanceInclusiveLoanStatus.ACTIVE,
      },
    });
    if (updated.count !== 1)
      throw new ConflictException(
        "The inclusive-loan balance changed concurrently.",
      );
    const receipt: InclusiveLoanRepaymentReceipt = {
      paymentId: reversalPaymentId,
      loanId: loan.id,
      journalEntryId: journal.journalEntryId,
      amount: payment.amount.toFixed(4),
      remainingAmount: remainingAmount.toFixed(4),
      status: FinanceInclusiveLoanStatus.ACTIVE,
    };
    await this.audit(
      transaction,
      context,
      "finance.inclusive_loan.repayment.reversed",
      payment.id,
      { ...receipt, reason },
    );
    return receipt;
  }

  private begin<T>(
    transaction: Prisma.TransactionClient,
    command: InclusiveLoanRepaymentCommand<T>,
    operation: string,
    request: Record<string, string>,
  ): ReturnType<IdempotencyService["beginInTransaction"]> {
    return this.idempotency.beginInTransaction(transaction, command.context, {
      operation,
      key: command.idempotencyKey,
      request,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  }
  private async lock(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    key: string,
  ): Promise<void> {
    await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:${key}`}, 0))`;
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
        entityType: "FinanceInclusiveLoanPayment",
        entityId,
        requestId: RequestContext.correlationId() ?? randomUUID(),
        afterJson,
      },
    });
  }
}

function validDate(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.valueOf()))
    throw new BadRequestException("A valid business date is required.");
  return value;
}
function requiredText(
  value: string,
  maximumLength: number,
  message: string,
): string {
  const text = value?.trim();
  if (!text || text.length > maximumLength)
    throw new BadRequestException(message);
  return text;
}
function positiveAmount(value: string): Prisma.Decimal {
  try {
    const amount = new Prisma.Decimal(value);
    if (
      !amount.isFinite() ||
      amount.lte(0) ||
      (amount.decimalPlaces() ?? 0) > 4
    )
      throw new Error();
    return amount;
  } catch {
    throw new BadRequestException(
      "The repayment amount must be a positive decimal with at most four places.",
    );
  }
}
function rethrowIdempotencyMismatch(error: unknown): never {
  if (error instanceof IdempotencyPayloadMismatchError)
    throw new ConflictException(error.message);
  throw error;
}
