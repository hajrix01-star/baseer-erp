import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import {
  IdempotencyPayloadMismatchError,
  IdempotencyService,
} from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceAccountStatus,
  FinanceAccountType,
  FinanceCategoryKind,
  FinanceCategoryStatus,
  FinanceSupplierDuePaymentStatus,
  FinanceSupplierDueStatus,
  FinanceSupplierStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { RequestContext } from '../observability/request-context.js';
import { BusinessDateService } from '../business-date/business-date.service.js';
import { JournalPostingService } from './journal/journal-posting.service.js';
import { FinanceVaultService } from './finance-vault.service.js';

const CREATE_DUE_OPERATION = 'finance.supplier_due.create';
const RECORD_PAYMENT_OPERATION = 'finance.supplier_due.payment.record';
const REVERSE_PAYMENT_OPERATION = 'finance.supplier_due.payment.reverse';
const SUPPLIER_DUES_SYSTEM_KEY = 'SUPPLIER_DUES';
const CASH_BASIS_PENDING_OUTFLOWS_SYSTEM_KEY = 'CASH_BASIS_PENDING_OUTFLOWS';
const MAX_DECIMAL_18_4 = new Prisma.Decimal('99999999999999.9999');

export type CreateSupplierDueRequest = Readonly<{
  supplierId: string;
  categoryId: string;
  sourceDocumentNumber: string;
  businessDate: Date;
  dueDate?: Date;
  amount: string;
  notes?: string;
}>;

export type RecordSupplierDuePaymentRequest = Readonly<{
  dueId: string;
  vaultId: string;
  businessDate: Date;
  amount: string;
}>;

export type ReverseSupplierDuePaymentRequest = Readonly<{
  paymentId: string;
  businessDate: Date;
  reason: string;
}>;

export type SupplierDueCommand<TRequest> = Readonly<{
  context: TrustedCompanyActorContext;
  idempotencyKey: string;
  request: TRequest;
}>;

export type SupplierDueReceipt = Readonly<{
  dueId: string;
  journalEntryId: string;
  supplierId: string;
  categoryId: string;
  sourceDocumentNumber: string;
  originalAmount: string;
  remainingAmount: string;
  status: FinanceSupplierDueStatus;
}>;

export type SupplierDuePaymentReceipt = Readonly<{
  paymentId: string;
  dueId: string;
  journalEntryId: string;
  vaultId: string;
  amount: string;
  remainingAmount: string;
  status: FinanceSupplierDueStatus;
}>;

export type SupplierDueCashPaymentProjection = Readonly<{
  paymentId: string;
  dueId: string;
  journalEntryId: string;
  businessDate: Date;
  amount: string;
  recognizedNetAmount: string;
  vaultId: string;
  categoryCode: string;
  categoryNameAr: string;
  categoryKind: FinanceCategoryKind;
}>;

export type SupplierDueCashPaymentProjectionInput = Readonly<{
  tenantId: string;
  companyId: string;
  fromBusinessDate?: Date;
  toBusinessDate?: Date;
  vaultId?: string;
  cursor?: string;
  pageSize: number;
}>;
export type SupplierDueCashPaymentProjectionPage = Readonly<{
  payments: readonly SupplierDueCashPaymentProjection[];
  hasMore: boolean;
  nextCursor: string | null;
}>;
export type SupplierDuePaymentReversalReceipt = Readonly<{
  reversalPaymentId: string;
  originalPaymentId: string;
  dueId: string;
  journalEntryId: string;
  remainingAmount: string;
  status: FinanceSupplierDueStatus;
}>;

@Injectable()
export class SupplierDuesService {
  constructor(
    private readonly database: DatabaseService,
    private readonly idempotency: IdempotencyService,
    private readonly journals: JournalPostingService,
    private readonly vaults: FinanceVaultService,
    private readonly businessDates: BusinessDateService,
  ) {}

  async createDue(command: SupplierDueCommand<CreateSupplierDueRequest>): Promise<SupplierDueReceipt> {
    return this.database.inTenantTransaction(command.context.tenantId, async (transaction) => {
      const request = command.request;
      const begun = await this.begin(transaction, command.context, CREATE_DUE_OPERATION, command.idempotencyKey, {
        supplierId: request.supplierId,
        categoryId: request.categoryId,
        sourceDocumentNumber: request.sourceDocumentNumber,
        businessDate: this.dateValue(request.businessDate, 'A due business date is required.'),
        dueDate: request.dueDate ? this.dateValue(request.dueDate, 'A due date is invalid.') : null,
        amount: request.amount,
        notes: request.notes ?? null,
      });
      if (begun.kind === 'replay') return begun.response.body as SupplierDueReceipt;
      if (begun.kind === 'in-progress') throw new ConflictException('The supplier-due request is still in progress.');

      const receipt = await this.createDueInTransaction(
        transaction,
        command.context,
        request,
        this.requestId(),
      );
      await this.idempotency.completeInTransaction(transaction, command.context, {
        receiptId: begun.receiptId,
        response: { status: 201, headers: null, body: receipt },
      });
      return receipt;
    });
  }

  async recordPayment(
    command: SupplierDueCommand<RecordSupplierDuePaymentRequest>,
  ): Promise<SupplierDuePaymentReceipt> {
    return this.database.inTenantTransaction(command.context.tenantId, async (transaction) => {
      const request = command.request;
      const begun = await this.begin(transaction, command.context, RECORD_PAYMENT_OPERATION, command.idempotencyKey, {
        dueId: request.dueId,
        vaultId: request.vaultId,
        businessDate: this.dateValue(request.businessDate, 'A payment business date is required.'),
        amount: request.amount,
      });
      if (begun.kind === 'replay') return begun.response.body as SupplierDuePaymentReceipt;
      if (begun.kind === 'in-progress') throw new ConflictException('The supplier-due payment request is still in progress.');

      const receipt = await this.recordPaymentInTransaction(
        transaction,
        command.context,
        request,
        this.requestId(),
      );
      await this.idempotency.completeInTransaction(transaction, command.context, {
        receiptId: begun.receiptId,
        response: { status: 201, headers: null, body: receipt },
      });
      return receipt;
    });
  }

  async reversePayment(
    command: SupplierDueCommand<ReverseSupplierDuePaymentRequest>,
  ): Promise<SupplierDuePaymentReversalReceipt> {
    return this.database.inTenantTransaction(command.context.tenantId, async (transaction) => {
      const request = command.request;
      const begun = await this.begin(transaction, command.context, REVERSE_PAYMENT_OPERATION, command.idempotencyKey, {
        paymentId: request.paymentId,
        businessDate: this.dateValue(request.businessDate, 'A reversal business date is required.'),
        reason: request.reason,
      });
      if (begun.kind === 'replay') return begun.response.body as SupplierDuePaymentReversalReceipt;
      if (begun.kind === 'in-progress') throw new ConflictException('The supplier-due payment reversal request is still in progress.');

      const receipt = await this.reversePaymentInTransaction(
        transaction,
        command.context,
        request,
        this.requestId(),
      );
      await this.idempotency.completeInTransaction(transaction, command.context, {
        receiptId: begun.receiptId,
        response: { status: 201, headers: null, body: receipt },
      });
      return receipt;
    });
  }

  async createDueInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: CreateSupplierDueRequest,
    requestId: string,
  ): Promise<SupplierDueReceipt> {
    const sourceDocumentNumber = this.requiredText(request.sourceDocumentNumber, 'A supplier source document number is required.', 160);
    const amount = this.positiveAmount(request.amount);
    const businessDate = this.requiredDate(request.businessDate, 'A due business date is required.');
    const dueDate = request.dueDate ? this.requiredDate(request.dueDate, 'A due date is invalid.') : null;
    if (dueDate && dueDate < businessDate) throw new BadRequestException('A due date cannot be before the due business date.');
    await this.businessDates.assertNotFutureInTransaction(
      transaction,
      context,
      businessDate,
      'A supplier due cannot use a future business date.',
    );
    const notes = this.optionalText(request.notes, 2_000);

    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:supplier-due:${request.supplierId}:${sourceDocumentNumber}`}, 0))
    `;
    const [supplier, category, duesAccount, pendingOutflowsAccount, profile] = await Promise.all([
      transaction.financeSupplier.findFirst({
        where: { id: request.supplierId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceSupplierStatus.ACTIVE },
        select: { id: true },
      }),
      transaction.financeCategory.findFirst({
        where: {
          id: request.categoryId,
          tenantId: context.tenantId,
          companyId: context.companyId,
          status: FinanceCategoryStatus.ACTIVE,
          isPosting: true,
          kind: { in: [FinanceCategoryKind.PURCHASE, FinanceCategoryKind.EXPENSE] },
        },
        select: { id: true, accountId: true, account: { select: { id: true, status: true, type: true } } },
      }),
      transaction.financeAccount.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, systemKey: SUPPLIER_DUES_SYSTEM_KEY, status: FinanceAccountStatus.ACTIVE },
        select: { id: true },
      }),
      transaction.financeAccount.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, systemKey: CASH_BASIS_PENDING_OUTFLOWS_SYSTEM_KEY, status: FinanceAccountStatus.ACTIVE },
        select: { id: true },
      }),
      transaction.companyFinanceProfile.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        select: { accountingMode: true },
      }),
    ]);
    if (!supplier) throw new NotFoundException('The active supplier was not found for this company.');
    if (
      !category?.accountId
      || category.account?.status !== FinanceAccountStatus.ACTIVE
      || (category.account.type !== FinanceAccountType.EXPENSE && category.account.type !== FinanceAccountType.ASSET)
    ) {
      throw new ConflictException('The selected active purchase or expense category has no active posting account.');
    }
    if (!duesAccount) throw new ConflictException('The active supplier-dues system account is not available.');
    if (profile?.accountingMode === 'management_cash' && !pendingOutflowsAccount) throw new ConflictException('The cash-basis pending-outflows account is not available.');

    const duplicate = await transaction.financeSupplierDue.findFirst({
      where: { tenantId: context.tenantId, companyId: context.companyId, supplierId: supplier.id, sourceDocumentNumber },
      select: { id: true },
    });
    if (duplicate) throw new ConflictException('A supplier due already uses this source document number.');

    const dueId = randomUUID();
    await transaction.financeSupplierDue.create({
      data: {
        id: dueId,
        tenantId: context.tenantId,
        companyId: context.companyId,
        supplierId: supplier.id,
        categoryId: category.id,
        sourceDocumentNumber,
        originalBusinessDate: businessDate,
        dueDate,
        originalAmount: amount,
        paidAmount: new Prisma.Decimal(0),
        remainingAmount: amount,
        status: FinanceSupplierDueStatus.OPEN,
        notes,
      },
    });
    const dueDebitAccountId = profile?.accountingMode === 'management_cash' ? pendingOutflowsAccount!.id : category.accountId;
    const journal = await this.journals.postInTransaction(transaction, {
      tenantId: context.tenantId,
      companyId: context.companyId,
      actorUserId: context.actorUserId,
      requestId,
      sourceType: 'supplier_due',
      sourceReference: `${dueId}:v1`,
      businessDate,
      description: `Supplier due ${sourceDocumentNumber}`,
      lines: [
        { accountId: dueDebitAccountId, debitAmount: amount.toFixed(4) },
        { accountId: duesAccount.id, creditAmount: amount.toFixed(4) },
      ],
    });
    await transaction.financeSupplierDue.update({
      where: { id: dueId },
      data: { journalEntryId: journal.journalEntryId },
    });
    const receipt: SupplierDueReceipt = {
      dueId,
      journalEntryId: journal.journalEntryId,
      supplierId: supplier.id,
      categoryId: category.id,
      sourceDocumentNumber,
      originalAmount: amount.toFixed(4),
      remainingAmount: amount.toFixed(4),
      status: FinanceSupplierDueStatus.OPEN,
    };
    await this.audit(transaction, context, requestId, 'finance.supplier_due.created', dueId, receipt);
    return receipt;
  }

  async recordPaymentInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: RecordSupplierDuePaymentRequest,
    requestId: string,
  ): Promise<SupplierDuePaymentReceipt> {
    const amount = this.positiveAmount(request.amount);
    const businessDate = this.requiredDate(request.businessDate, 'A payment business date is required.');
    await this.businessDates.assertNotFutureInTransaction(
      transaction,
      context,
      businessDate,
      'A supplier-due payment cannot use a future business date.',
    );
    const dueId = this.requiredText(request.dueId, 'A supplier due is required.', 36);
    await this.lockDue(transaction, context, dueId);
    const vault = await this.vaults.assertActivePaymentDestination(transaction, {
      tenantId: context.tenantId,
      companyId: context.companyId,
      vaultId: this.requiredText(request.vaultId, 'A payment vault is required.', 36),
    });
    const due = await transaction.financeSupplierDue.findFirst({
      where: { id: dueId, tenantId: context.tenantId, companyId: context.companyId, status: { in: [FinanceSupplierDueStatus.OPEN, FinanceSupplierDueStatus.PARTIALLY_PAID] } },
      select: {
        id: true,
        originalAmount: true,
        remainingAmount: true,
        paidAmount: true,
        sourceDocumentNumber: true,
        category: { select: { code: true, nameAr: true, kind: true, accountId: true, account: { select: { status: true } } } },
      },
    });
    if (!due) throw new NotFoundException('The active supplier due was not found.');
    if (!due.category) throw new ConflictException('The supplier due has no category snapshot source for cash reporting.');
    if (amount.gt(due.remainingAmount)) throw new ConflictException('The payment exceeds the remaining supplier due.');
    const duesAccount = await this.dueAccount(transaction, context);
    const profile = await transaction.companyFinanceProfile.findFirst({
      where: { tenantId: context.tenantId, companyId: context.companyId },
      select: { accountingMode: true },
    });
    const cashOnPayment = profile?.accountingMode === 'management_cash';
    let recognizedNetAmount = new Prisma.Decimal(0);
    const lines: { accountId: string; debitAmount?: string; creditAmount?: string; description?: string }[] = [
      { accountId: duesAccount.id, debitAmount: amount.toFixed(4) },
      { accountId: vault.accountId, creditAmount: amount.toFixed(4) },
    ];
    if (cashOnPayment) {
      if (!due.category.accountId || due.category.account?.status !== FinanceAccountStatus.ACTIVE) {
        throw new ConflictException('The supplier due category has no active posting account.');
      }
      const pendingOutflowsAccount = await transaction.financeAccount.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, systemKey: CASH_BASIS_PENDING_OUTFLOWS_SYSTEM_KEY, status: FinanceAccountStatus.ACTIVE },
        select: { id: true },
      });
      if (!pendingOutflowsAccount) throw new ConflictException('The cash-basis pending-outflows account is not available.');
      const document = await transaction.financeOutflowDocument.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, documentNumber: due.sourceDocumentNumber },
        select: { netAmount: true },
      });
      const recognitionBase = document?.netAmount ?? due.originalAmount;
      const paidAfterThisPayment = due.paidAmount.plus(amount);
      const cumulativeRecognition = due.remainingAmount.eq(amount)
        ? recognitionBase
        : recognitionBase.mul(paidAfterThisPayment).div(due.originalAmount).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      const priorRecognition = recognitionBase.mul(due.paidAmount).div(due.originalAmount).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
      recognizedNetAmount = cumulativeRecognition.minus(priorRecognition);
      if (recognizedNetAmount.lt(0)) throw new ConflictException('The supplier due has an invalid cash-recognition state.');
      if (!recognizedNetAmount.isZero()) {
        lines.push({ accountId: due.category.accountId, debitAmount: recognizedNetAmount.toFixed(4) });
        lines.push({ accountId: pendingOutflowsAccount.id, creditAmount: recognizedNetAmount.toFixed(4) });
      }
    }
    const paymentId = randomUUID();
    const journal = await this.journals.postInTransaction(transaction, {
      tenantId: context.tenantId,
      companyId: context.companyId,
      actorUserId: context.actorUserId,
      requestId,
      sourceType: 'supplier_due_payment',
      sourceReference: `${paymentId}:v1`,
      businessDate,
      description: `Supplier due payment ${paymentId}`,
      lines,
    });
    const remainingAmount = due.remainingAmount.minus(amount);
    const status = remainingAmount.eq(0) ? FinanceSupplierDueStatus.PAID : FinanceSupplierDueStatus.PARTIALLY_PAID;
    const updated = await transaction.financeSupplierDue.updateMany({
      where: { id: due.id, tenantId: context.tenantId, companyId: context.companyId, remainingAmount: due.remainingAmount, status: { in: [FinanceSupplierDueStatus.OPEN, FinanceSupplierDueStatus.PARTIALLY_PAID] } },
      data: { paidAmount: { increment: amount }, remainingAmount, status },
    });
    if (updated.count !== 1) throw new ConflictException('The supplier due changed while the payment was being recorded.');
    await transaction.financeSupplierDuePayment.create({
      data: {
        id: paymentId,
        tenantId: context.tenantId,
        companyId: context.companyId,
        dueId: due.id,
        vaultId: vault.id,
        amount,
        recognizedNetAmount,
        businessDate,
        status: FinanceSupplierDuePaymentStatus.POSTED,
        journalEntryId: journal.journalEntryId,
        categoryCodeSnapshot: due.category.code,
        categoryNameArSnapshot: due.category.nameAr,
        categoryKindSnapshot: due.category.kind,
      },
    });
    const receipt: SupplierDuePaymentReceipt = {
      paymentId,
      dueId: due.id,
      journalEntryId: journal.journalEntryId,
      vaultId: vault.id,
      amount: amount.toFixed(4),
      remainingAmount: remainingAmount.toFixed(4),
      status,
    };
    await this.audit(transaction, context, requestId, 'finance.supplier_due.payment_recorded', paymentId, receipt);
    return receipt;
  }

  async reversePaymentInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: ReverseSupplierDuePaymentRequest,
    requestId: string,
  ): Promise<SupplierDuePaymentReversalReceipt> {
    const paymentId = this.requiredText(request.paymentId, 'A supplier-due payment is required.', 36);
    const businessDate = this.requiredDate(request.businessDate, 'A reversal business date is required.');
    await this.businessDates.assertNotFutureInTransaction(
      transaction,
      context,
      businessDate,
      'A supplier-due payment reversal cannot use a future business date.',
    );
    const reason = this.requiredText(request.reason, 'A payment reversal reason is required.', 1_000);
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:supplier-due-payment-reversal:${paymentId}`}, 0))
    `;
    const payment = await transaction.financeSupplierDuePayment.findFirst({
      where: { id: paymentId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceSupplierDuePaymentStatus.POSTED },
      include: { reversalPayment: { select: { id: true } }, due: { select: { id: true, paidAmount: true, remainingAmount: true, status: true } } },
    });
    if (!payment) throw new NotFoundException('The posted supplier-due payment was not found.');
    if (!payment.journalEntryId) throw new ConflictException('This supplier-due payment predates journal posting and cannot be reversed automatically.');
    if (payment.reversalPayment) throw new ConflictException('This supplier-due payment has already been reversed.');
    await this.lockDue(transaction, context, payment.dueId);
    await this.vaults.assertActivePaymentDestination(transaction, { tenantId: context.tenantId, companyId: context.companyId, vaultId: payment.vaultId });
    if (payment.due.status === FinanceSupplierDueStatus.CANCELLED || payment.due.paidAmount.lt(payment.amount)) {
      throw new ConflictException('The supplier due cannot safely accept this payment reversal.');
    }

    const journal = await this.journals.reverseInTransaction(transaction, {
      tenantId: context.tenantId,
      companyId: context.companyId,
      actorUserId: context.actorUserId,
      requestId,
      journalEntryId: payment.journalEntryId,
      businessDate,
      reason,
    });
    const paidAmount = payment.due.paidAmount.minus(payment.amount);
    const remainingAmount = payment.due.remainingAmount.plus(payment.amount);
    const status = paidAmount.eq(0) ? FinanceSupplierDueStatus.OPEN : FinanceSupplierDueStatus.PARTIALLY_PAID;
    const updated = await transaction.financeSupplierDue.updateMany({
      where: { id: payment.dueId, tenantId: context.tenantId, companyId: context.companyId, paidAmount: payment.due.paidAmount, status: { in: [FinanceSupplierDueStatus.OPEN, FinanceSupplierDueStatus.PARTIALLY_PAID, FinanceSupplierDueStatus.PAID] } },
      data: { paidAmount, remainingAmount, status },
    });
    if (updated.count !== 1) throw new ConflictException('The supplier due changed while the payment reversal was being recorded.');

    const originalPaymentMarkedReversed = await transaction.financeSupplierDuePayment.updateMany({
      where: {
        id: payment.id,
        tenantId: context.tenantId,
        companyId: context.companyId,
        status: FinanceSupplierDuePaymentStatus.POSTED,
      },
      data: { status: FinanceSupplierDuePaymentStatus.REVERSED },
    });
    if (originalPaymentMarkedReversed.count !== 1) {
      throw new ConflictException('The supplier-due payment changed while the reversal was being recorded.');
    }

    const reversalPaymentId = randomUUID();
    await transaction.financeSupplierDuePayment.create({
      data: {
        id: reversalPaymentId,
        tenantId: context.tenantId,
        companyId: context.companyId,
        dueId: payment.dueId,
        vaultId: payment.vaultId,
        amount: payment.amount,
        recognizedNetAmount: payment.recognizedNetAmount,
        businessDate,
        status: FinanceSupplierDuePaymentStatus.REVERSED,
        reversalOfId: payment.id,
        journalEntryId: journal.journalEntryId,
        categoryCodeSnapshot: payment.categoryCodeSnapshot,
        categoryNameArSnapshot: payment.categoryNameArSnapshot,
        categoryKindSnapshot: payment.categoryKindSnapshot,
      },
    });
    const receipt: SupplierDuePaymentReversalReceipt = {
      reversalPaymentId,
      originalPaymentId: payment.id,
      dueId: payment.dueId,
      journalEntryId: journal.journalEntryId,
      remainingAmount: remainingAmount.toFixed(4),
      status,
    };
    await this.audit(transaction, context, requestId, 'finance.supplier_due.payment_reversed', payment.id, receipt);
    return receipt;
  }

  /**
   * The cash-report source intentionally contains only settled supplier-due payments.
   * Unpaid dues never enter this projection; reversing a payment flips its original
   * row out of POSTED before commit, so it disappears from every consumer of this query.
   */
  async listPostedCashPaymentProjectionInTransaction(
    transaction: Prisma.TransactionClient,
    input: SupplierDueCashPaymentProjectionInput,
  ): Promise<SupplierDueCashPaymentProjectionPage> {
    const fromBusinessDate = input.fromBusinessDate
      ? this.requiredDate(input.fromBusinessDate, 'The cash-report start date is invalid.')
      : undefined;
    const toBusinessDate = input.toBusinessDate
      ? this.requiredDate(input.toBusinessDate, 'The cash-report end date is invalid.')
      : undefined;
    if (fromBusinessDate && toBusinessDate && fromBusinessDate > toBusinessDate) {
      throw new BadRequestException('The cash-report start date cannot be after its end date.');
    }
    const baseWhere: Prisma.FinanceSupplierDuePaymentWhereInput = {
        tenantId: input.tenantId,
        companyId: input.companyId,
        status: FinanceSupplierDuePaymentStatus.POSTED,
        journalEntryId: { not: null },
        categoryCodeSnapshot: { not: null },
        categoryNameArSnapshot: { not: null },
        categoryKindSnapshot: { not: null },
        ...(input.vaultId ? { vaultId: input.vaultId } : {}),
        ...(fromBusinessDate || toBusinessDate
          ? { businessDate: { ...(fromBusinessDate ? { gte: fromBusinessDate } : {}), ...(toBusinessDate ? { lte: toBusinessDate } : {}) } }
          : {}),
        journalEntry: { is: { status: 'POSTED', isSealed: true } },
      };
    const cursor = input.cursor
      ? await transaction.financeSupplierDuePayment.findFirst({
          where: { ...baseWhere, id: input.cursor },
          select: { id: true, businessDate: true },
        })
      : null;
    if (input.cursor && !cursor)
      throw new BadRequestException('The cash-report cursor is no longer valid.');
    const rows = await transaction.financeSupplierDuePayment.findMany({
      where: cursor
        ? {
            ...baseWhere,
            OR: [
              { businessDate: { gt: cursor.businessDate } },
              { businessDate: cursor.businessDate, id: { gt: cursor.id } },
            ],
          }
        : baseWhere,
      select: {
        id: true,
        dueId: true,
        journalEntryId: true,
        businessDate: true,
        amount: true,
        recognizedNetAmount: true,
        vaultId: true,
        categoryCodeSnapshot: true,
        categoryNameArSnapshot: true,
        categoryKindSnapshot: true,
      },
      orderBy: [{ businessDate: 'asc' }, { id: 'asc' }],
      take: input.pageSize + 1,
    });
    const hasMore = rows.length > input.pageSize;
    const page = hasMore ? rows.slice(0, input.pageSize) : rows;
    return {
      payments: page.map((row) => {
      if (
        !row.journalEntryId
        || !row.categoryCodeSnapshot
        || !row.categoryNameArSnapshot
        || !row.categoryKindSnapshot
      ) {
        throw new ConflictException('A posted supplier-due payment is missing its immutable cash-report snapshot.');
      }
      return {
        paymentId: row.id,
        dueId: row.dueId,
        journalEntryId: row.journalEntryId,
        businessDate: row.businessDate,
        amount: row.amount.toFixed(4),
        recognizedNetAmount: row.recognizedNetAmount.toFixed(4),
        vaultId: row.vaultId,
        categoryCode: row.categoryCodeSnapshot,
        categoryNameAr: row.categoryNameArSnapshot,
        categoryKind: row.categoryKindSnapshot,
      };
      }),
      hasMore,
      nextCursor: hasMore ? page.at(-1)?.id ?? null : null,
    };
  }
  private async dueAccount(transaction: Prisma.TransactionClient, context: TrustedCompanyActorContext): Promise<{ id: string }> {
    const account = await transaction.financeAccount.findFirst({
      where: { tenantId: context.tenantId, companyId: context.companyId, systemKey: SUPPLIER_DUES_SYSTEM_KEY, status: FinanceAccountStatus.ACTIVE },
      select: { id: true },
    });
    if (!account) throw new ConflictException('The active supplier-dues system account is not available.');
    return account;
  }

  private async lockDue(transaction: Prisma.TransactionClient, context: TrustedCompanyActorContext, dueId: string): Promise<void> {
    await transaction.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:supplier-due:${dueId}`}, 0))
    `;
  }

  private async begin(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    operation: string,
    key: string,
    request: Record<string, string | null>,
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
        throw new ConflictException('The idempotency key was already used with a different supplier-due request.');
      }
      throw error;
    }
  }

  private async audit(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    requestId: string,
    action: string,
    entityId: string,
    afterJson: object,
  ): Promise<void> {
    await transaction.auditEvent.create({
      data: {
        id: randomUUID(),
        tenantId: context.tenantId,
        companyId: context.companyId,
        actorUserId: context.actorUserId,
        action,
        entityType: 'FinanceSupplierDue',
        entityId,
        requestId,
        afterJson: afterJson as Prisma.InputJsonValue,
      },
    });
  }

  private positiveAmount(value: string): Prisma.Decimal {
    let amount: Prisma.Decimal;
    try {
      amount = new Prisma.Decimal(value);
    } catch {
      throw new BadRequestException('Supplier-due amounts must be valid decimal values.');
    }
    if (!amount.isFinite() || amount.lte(0) || (amount.decimalPlaces() ?? 0) > 4 || amount.gt(MAX_DECIMAL_18_4)) {
      throw new BadRequestException('Supplier-due amounts must be positive with at most four decimal places.');
    }
    return amount;
  }

  private requiredDate(value: Date, message: string): Date {
    if (!(value instanceof Date) || Number.isNaN(value.valueOf())) throw new BadRequestException(message);
    return value;
  }

  private dateValue(value: Date, message: string): string {
    return this.requiredDate(value, message).toISOString().slice(0, 10);
  }

  private requiredText(value: string, message: string, maximumLength: number): string {
    const text = value.trim();
    if (!text || text.length > maximumLength) throw new BadRequestException(message);
    return text;
  }

  private optionalText(value: string | undefined, maximumLength: number): string | null {
    if (value === undefined) return null;
    const text = value.trim();
    if (!text) return null;
    if (text.length > maximumLength) throw new BadRequestException('Supplier-due text exceeds the permitted length.');
    return text;
  }

  private requestId(): string {
    return RequestContext.correlationId() ?? randomUUID();
  }
}
