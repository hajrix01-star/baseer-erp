import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceAccountStatus, FinanceAccountType, Prisma } from '../generated/prisma/client.js';
import { RequestContext } from '../observability/request-context.js';
import { JournalPostingService } from './journal/journal-posting.service.js';

const CREATE_OPENING_LOAN_OPERATION = 'finance.inclusive_loan.opening.create';
const INCLUSIVE_LOANS_SYSTEM_KEY = 'INCLUSIVE_LOANS';
const OPENING_BALANCE_CLEARING_SYSTEM_KEY = 'OPENING_BALANCE_CLEARING';

export type CreateOpeningInclusiveLoanRequest = Readonly<{
  sourceDocumentNumber: string;
  /** Total contractual amount, including all charges, exactly as the owner manages it. */
  originalAmount: string;
  /** Amount still owed when Baseer begins. This is the opening liability, not cash received. */
  openingOutstandingAmount: string;
  installmentAmount: string;
  termMonths: number;
  firstInstallmentDueDate: Date;
  openingBusinessDate: Date;
  notes?: string;
}>;

export type OpeningInclusiveLoanCommand = Readonly<{
  context: TrustedCompanyActorContext;
  idempotencyKey: string;
  request: CreateOpeningInclusiveLoanRequest;
}>;

export type OpeningInclusiveLoanReceipt = Readonly<{
  loanId: string;
  journalEntryId: string;
  originalAmount: string;
  openingOutstandingAmount: string;
  installmentAmount: string;
  termMonths: number;
}>;

/**
 * Creates an already-disbursed, inclusive loan as an opening liability.
 * It debits opening-balance clearing and credits inclusive loans; it never
 * increases a vault or records income/expense at creation.
 */
@Injectable()
export class InclusiveLoanService {
  constructor(
    private readonly database: DatabaseService,
    private readonly idempotency: IdempotencyService,
    private readonly journals: JournalPostingService,
  ) {}

  async createOpeningLoan(command: OpeningInclusiveLoanCommand): Promise<OpeningInclusiveLoanReceipt> {
    const { context, request } = command;
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const begin = await this.idempotency.beginInTransaction(transaction, context, {
        operation: CREATE_OPENING_LOAN_OPERATION,
        key: command.idempotencyKey,
        request: {
          sourceDocumentNumber: request.sourceDocumentNumber,
          originalAmount: request.originalAmount,
          openingOutstandingAmount: request.openingOutstandingAmount,
          installmentAmount: request.installmentAmount,
          termMonths: request.termMonths,
          firstInstallmentDueDate: request.firstInstallmentDueDate.toISOString(),
          openingBusinessDate: request.openingBusinessDate.toISOString(),
          notes: request.notes ?? null,
        },
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begin.kind === 'replay') return begin.response.body as unknown as OpeningInclusiveLoanReceipt;
      if (begin.kind === 'in-progress') throw new ConflictException('The loan command is already in progress.');

      const receipt = await this.createOpeningLoanInTransaction(transaction, context, request);
      await this.idempotency.completeInTransaction(transaction, context, {
        receiptId: begin.receiptId,
        response: { status: 201, headers: null, body: receipt },
      });
      return receipt;
    }).catch((error: unknown) => {
      if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException(error.message);
      throw error;
    });
  }

  private async createOpeningLoanInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: CreateOpeningInclusiveLoanRequest,
  ): Promise<OpeningInclusiveLoanReceipt> {
    const sourceDocumentNumber = requiredText(request.sourceDocumentNumber, 160, 'A loan source document number is required.');
    const originalAmount = positiveAmount(request.originalAmount, 'The original loan amount must be positive.');
    const outstanding = positiveAmount(request.openingOutstandingAmount, 'The opening outstanding balance must be positive.');
    const installmentAmount = positiveAmount(request.installmentAmount, 'The installment amount must be positive.');
    if (outstanding.gt(originalAmount)) throw new BadRequestException('The opening outstanding balance cannot exceed the original loan amount.');
    if (!Number.isInteger(request.termMonths) || request.termMonths < 1 || request.termMonths > 600) throw new BadRequestException('Loan term months must be from 1 through 600.');
    const installmentPlan = buildInstallmentPlan(outstanding, installmentAmount, request.termMonths, request.firstInstallmentDueDate);
    for (const date of [request.firstInstallmentDueDate, request.openingBusinessDate]) {
      if (!(date instanceof Date) || Number.isNaN(date.valueOf())) throw new BadRequestException('Loan dates must be valid dates.');
    }
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:inclusive-loan:${sourceDocumentNumber}`}, 0))
    `;
    const duplicate = await transaction.financeInclusiveLoan.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, sourceDocumentNumber }, select: { id: true } });
    if (duplicate) throw new ConflictException('A loan with this source document number already exists.');

    const accounts = await transaction.financeAccount.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId, status: FinanceAccountStatus.ACTIVE, systemKey: { in: [INCLUSIVE_LOANS_SYSTEM_KEY, OPENING_BALANCE_CLEARING_SYSTEM_KEY] } },
      select: { id: true, systemKey: true, type: true },
    });
    const inclusiveLoanAccount = accounts.find((account) => account.systemKey === INCLUSIVE_LOANS_SYSTEM_KEY);
    const openingClearingAccount = accounts.find((account) => account.systemKey === OPENING_BALANCE_CLEARING_SYSTEM_KEY);
    if (!inclusiveLoanAccount || inclusiveLoanAccount.type !== FinanceAccountType.LIABILITY || !openingClearingAccount || openingClearingAccount.type !== FinanceAccountType.EQUITY) {
      throw new NotFoundException('Required active inclusive-loan opening accounts were not found.');
    }

    const loanId = randomUUID();
    await transaction.financeInclusiveLoan.create({
      data: {
        id: loanId, tenantId: context.tenantId, companyId: context.companyId, sourceDocumentNumber,
        originalAmount, openingOutstandingAmount: outstanding, remainingAmount: outstanding,
        installmentAmount, termMonths: request.termMonths, firstInstallmentDueDate: request.firstInstallmentDueDate,
        openingBusinessDate: request.openingBusinessDate, notes: optionalText(request.notes, 2_000) ?? null,
      },
    });
    await transaction.financeInclusiveLoanInstallmentPlan.createMany({
      data: installmentPlan.map((installment) => ({
        id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, loanId,
        installmentNo: installment.installmentNo, dueDate: installment.dueDate, expectedAmount: installment.expectedAmount,
      })),
    });
    const journal = await this.journals.postInTransaction(transaction, {
      tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
      requestId: RequestContext.correlationId() ?? randomUUID(), sourceType: 'inclusive_loan_opening',
      sourceReference: `inclusive-loan:${loanId}:opening:v1`, businessDate: request.openingBusinessDate,
      description: `Opening inclusive loan ${sourceDocumentNumber}`,
      lines: [
        { accountId: openingClearingAccount.id, debitAmount: outstanding.toFixed(4) },
        { accountId: inclusiveLoanAccount.id, creditAmount: outstanding.toFixed(4) },
      ],
    });
    await transaction.financeInclusiveLoan.update({ where: { id: loanId }, data: { openingJournalEntryId: journal.journalEntryId } });
    const receipt: OpeningInclusiveLoanReceipt = { loanId, journalEntryId: journal.journalEntryId, originalAmount: originalAmount.toFixed(4), openingOutstandingAmount: outstanding.toFixed(4), installmentAmount: installmentAmount.toFixed(4), termMonths: request.termMonths };
    await transaction.auditEvent.create({
      data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
        action: 'finance.inclusive_loan.opening.created', entityType: 'FinanceInclusiveLoan', entityId: loanId,
        requestId: RequestContext.correlationId() ?? randomUUID(), afterJson: receipt as Prisma.InputJsonValue },
    });
    return receipt;
  }
}

function requiredText(value: string, maximumLength: number, message: string): string { const text = value?.trim(); if (!text || text.length > maximumLength) throw new BadRequestException(message); return text; }
function optionalText(value: string | undefined, maximumLength: number): string | undefined { if (value === undefined) return undefined; const text = value.trim(); if (!text) return undefined; if (text.length > maximumLength) throw new BadRequestException('Loan notes exceed the permitted length.'); return text; }
function positiveAmount(value: string, message: string): Prisma.Decimal { try { const amount = new Prisma.Decimal(value); if (!amount.isFinite() || amount.lte(0) || (amount.decimalPlaces() ?? 0) > 4) throw new Error(); return amount; } catch { throw new BadRequestException(message); } }

function buildInstallmentPlan(outstanding: Prisma.Decimal, installmentAmount: Prisma.Decimal, termMonths: number, firstDueDate: Date): Array<{ installmentNo: number; dueDate: Date; expectedAmount: Prisma.Decimal }> {
  const finalAmount = outstanding.minus(installmentAmount.times(termMonths - 1));
  if (finalAmount.lte(0) || finalAmount.gt(installmentAmount)) {
    throw new BadRequestException('The installment amount and term must cover the outstanding balance with a final installment no greater than the regular installment.');
  }
  return Array.from({ length: termMonths }, (_, index) => ({
    installmentNo: index + 1,
    dueDate: addMonthsUtc(firstDueDate, index),
    expectedAmount: index + 1 === termMonths ? finalAmount : installmentAmount,
  }));
}

function addMonthsUtc(date: Date, months: number): Date {
  const result = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, date.getUTCDate()));
  if (result.getUTCDate() !== date.getUTCDate()) {
    result.setUTCDate(0);
  }
  return result;
}