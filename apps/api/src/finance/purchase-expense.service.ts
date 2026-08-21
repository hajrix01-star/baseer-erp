import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DocumentSerialService } from '../core-controls/document-serial.service.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceAccountStatus, FinanceAccountType, FinanceCashPerformanceDirection, FinanceCashPerformanceEventKind, FinanceCategoryStatus, FinanceOutflowDocumentKind, FinanceOutflowDocumentStatus, FinanceOutflowSettlementKind, FinanceRecurringExpenseStatus, FinanceSupplierDuePaymentStatus, FinanceSupplierDueStatus, FinanceSupplierStatus, FinanceVaultPaymentMethod, HrEmployeeFinancialMovementType, HrEmployeeServiceStatus, Prisma } from '../generated/prisma/client.js';
import { BusinessDateService } from '../business-date/business-date.service.js';
import { JournalPostingService } from './journal/journal-posting.service.js';
import { FinanceVaultService } from './finance-vault.service.js';
import { FinanceCashPerformanceEventService } from './finance-cash-performance-event.service.js';
import { HrService, type EmployeeServiceCreateInput } from '../hr/hr.service.js';
import type { RecordHrEmployeeServiceAndIssueCostRequest } from '@baseer-erp/contracts';

const DOCUMENT_OPERATION = 'finance.purchase_expense.create';
const BATCH_OPERATION = 'finance.purchase_expense.batch.create';
const REVERSE_DOCUMENT_OPERATION = 'finance.purchase_expense.reverse';
const RECURRING_PAYMENT_OPERATION = 'finance.recurring_expense.payment.create';
const RECURRING_PAYMENT_BATCH_OPERATION = 'finance.recurring_expense.payment.batch.create';
type PaymentAllocation = Readonly<{ vaultId: string; grossAmount: string; paymentMethod?: FinanceVaultPaymentMethod | undefined }>;
export type PurchaseExpenseRequest = Readonly<{ kind: 'PURCHASE' | 'EXPENSE'; settlementKind: 'PAID' | 'PAYABLE'; categoryId: string; supplierId?: string; supplierInvoiceNumber?: string; supplierInvoiceMissingReason?: string; businessDate: Date; supplierInvoiceDate?: Date; grossAmount: string; isTaxable: boolean; assetWarrantyFollowUp?: boolean; allocations: readonly PaymentAllocation[]; notes?: string }>;
export type PurchaseExpenseReceipt = Readonly<{ documentId: string; documentNumber: string; journalEntryId: string; kind: FinanceOutflowDocumentKind; settlementKind: FinanceOutflowSettlementKind; status: FinanceOutflowDocumentStatus; grossAmount: string; netAmount: string; vatAmount: string; supplierDueId: string | null }>;
export type PurchaseExpenseBatchRequest = Readonly<{ businessDate: Date; notes?: string; items: readonly Omit<PurchaseExpenseRequest, 'businessDate'>[] }>;
export type PurchaseExpenseBatchReceipt = Readonly<{ batchId: string; batchNumber: string; businessDate: Date; documentCount: number; grossAmount: string; netAmount: string; vatAmount: string; documents: readonly PurchaseExpenseReceipt[] }>;
export type ReversePurchaseExpenseDocumentRequest = Readonly<{ documentId: string; businessDate: Date; reason: string }>;
export type ReversePurchaseExpenseDocumentReceipt = Readonly<{ documentId: string; documentNumber: string; reversalJournalEntryId: string; supplierDueId: string | null; businessDate: string }>;
export type RecurringExpensePaymentRequest = Readonly<{ profileId: string; businessDate: Date; coverageYear: number; coverageStartMonth: number; grossAmount: string; isTaxable: boolean; vaultId?: string | undefined; allocations: readonly PaymentAllocation[]; supplierInvoiceNumber?: string | undefined; supplierInvoiceMissingReason?: string | undefined; supplierInvoiceDate?: Date | undefined; notes?: string | undefined }>;
export type RecurringExpensePaymentReceipt = PurchaseExpenseReceipt & Readonly<{ profileId: string; coverageYear: number; coverageStartMonth: number; coverageMonths: number }>;
export type RecurringExpensePaymentBatchRequest = Readonly<{ businessDate: Date; items: readonly Omit<RecurringExpensePaymentRequest, 'businessDate'>[] }>;
export type RecurringExpensePaymentBatchReceipt = Readonly<{ batchId: string; batchNumber: string; businessDate: Date; documentCount: number; grossAmount: string; netAmount: string; vatAmount: string; payments: readonly RecurringExpensePaymentReceipt[] }>;
export type IssueEmployeeServiceCostRequest = Readonly<{ serviceId: string; businessDate: Date; grossAmount: string; isTaxable: boolean; allocations: readonly PaymentAllocation[]; supplierInvoiceNumber?: string | undefined; supplierInvoiceMissingReason?: string | undefined; supplierInvoiceDate?: Date | undefined; notes?: string | undefined }>;
export type RecordEmployeeServiceAndIssueCostRequest = Readonly<Omit<RecordHrEmployeeServiceAndIssueCostRequest, 'idempotencyKey' | 'allocations'>> & Readonly<{ allocations: readonly PaymentAllocation[] }>;
export type RecordEmployeeServiceAndIssueCostReceipt = Readonly<{ serviceId: string; documentId: string; documentNumber: string; journalEntryId: string; replayed: boolean }>;
export type ReverseEmployeeServiceCostRequest = Readonly<{ serviceId: string; businessDate: Date; reason: string }>;
export type ReverseEmployeeServiceCostReceipt = Readonly<{ serviceId: string; documentId: string; documentNumber: string; reversalJournalEntryId: string; replayed: boolean }>;
 type StoredRecurringExpensePaymentBatchReceipt = Omit<RecurringExpensePaymentBatchReceipt, 'businessDate'> & { businessDate: string };
 type StoredPurchaseExpenseBatchReceipt = Omit<PurchaseExpenseBatchReceipt, 'businessDate'> & { businessDate: string };

@Injectable()
export class PurchaseExpenseService {
  constructor(private readonly db: DatabaseService, private readonly idem: IdempotencyService, private readonly serials: DocumentSerialService, private readonly journals: JournalPostingService, private readonly vaults: FinanceVaultService, private readonly dates: BusinessDateService, private readonly hr: HrService, private readonly cashEvents: FinanceCashPerformanceEventService) {}

  async create(input: { context: TrustedCompanyActorContext; idempotencyKey: string; request: PurchaseExpenseRequest }): Promise<PurchaseExpenseReceipt> {
    return this.db.inTenantTransaction(input.context.tenantId, async (tx) => {
      const request = this.normalise(input.request);
      const begun = await this.idem.beginInTransaction(tx, input.context, { operation: DOCUMENT_OPERATION, key: input.idempotencyKey, request: this.payload(request), expiresAt: new Date(Date.now() + 86_400_000) });
      if (begun.kind === 'replay') return begun.response.body as unknown as PurchaseExpenseReceipt;
      if (begun.kind === 'in-progress') throw new ConflictException('This purchase request is already being processed.');
      const receipt = await this.postDocument(tx, input.context, request, `purchase-expense:${input.idempotencyKey}`);
      await this.idem.completeInTransaction(tx, input.context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    }).catch((error) => { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with a different request.'); throw error; });
  }

  async createBatch(input: { context: TrustedCompanyActorContext; idempotencyKey: string; request: PurchaseExpenseBatchRequest }): Promise<PurchaseExpenseBatchReceipt> {
    return this.db.inTenantTransaction(input.context.tenantId, async (tx) => {
      const request = this.normaliseBatch(input.request);
      const begun = await this.idem.beginInTransaction(tx, input.context, { operation: BATCH_OPERATION, key: input.idempotencyKey, request: this.batchPayload(request), expiresAt: new Date(Date.now() + 86_400_000) });
      if (begun.kind === 'replay') return this.restoreBatchReceipt(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('This purchase batch is already being processed.');
      await this.dates.assertNotFutureInTransaction(tx, input.context, request.businessDate);
      const day = request.businessDate.toISOString().slice(0, 10) as `${number}-${number}-${number}`;
      const sequence = await this.serials.reserveInTransaction(tx, input.context, { series: 'PURCHASE_BATCH', businessDate: day });
      const batchId = randomUUID();
      const batchNumber = `PB-${day.replaceAll('-', '')}-${sequence.toString().padStart(4, '0')}`;
      // The database correctly rejects a zero-value batch. Calculate its
      // immutable header totals before inserting dependent documents, while
      // the final posted documents remain the source of the receipt values.
      const financeProfile = await tx.companyFinanceProfile.findFirst({
        where: { tenantId: input.context.tenantId, companyId: input.context.companyId },
        select: { vatAccountingEnabled: true, vatRateBasisPoints: true },
      });
      const initialAmounts = request.items.reduce((total, item) => {
        const gross = new Prisma.Decimal(item.grossAmount);
        const rate = item.isTaxable && financeProfile?.vatAccountingEnabled ? financeProfile.vatRateBasisPoints : 0;
        const net = rate ? gross.mul(10_000).div(10_000 + rate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP) : gross;
        return { gross: total.gross.plus(gross), net: total.net.plus(net), vat: total.vat.plus(gross.minus(net).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)) };
      }, { gross: new Prisma.Decimal(0), net: new Prisma.Decimal(0), vat: new Prisma.Decimal(0) });
      await tx.financeOutflowBatch.create({ data: { id: batchId, tenantId: input.context.tenantId, companyId: input.context.companyId, batchNumber, businessDate: request.businessDate, documentCount: request.items.length, grossAmount: initialAmounts.gross, netAmount: initialAmounts.net, vatAmount: initialAmounts.vat, notes: request.notes ?? null, createdByUserId: input.context.actorUserId } });
      const documents: PurchaseExpenseReceipt[] = [];
      for (const [index, item] of request.items.entries()) documents.push(await this.postDocument(tx, input.context, { ...item, businessDate: request.businessDate }, `purchase-expense-batch:${input.idempotencyKey}:${index + 1}`, batchId));
      const grossAmount = documents.reduce((total, item) => total.plus(item.grossAmount), new Prisma.Decimal(0));
      const netAmount = documents.reduce((total, item) => total.plus(item.netAmount), new Prisma.Decimal(0));
      const vatAmount = documents.reduce((total, item) => total.plus(item.vatAmount), new Prisma.Decimal(0));
      await tx.financeOutflowBatch.update({ where: { id: batchId }, data: { grossAmount, netAmount, vatAmount } });
      const receipt: PurchaseExpenseBatchReceipt = { batchId, batchNumber, businessDate: request.businessDate, documentCount: documents.length, grossAmount: grossAmount.toFixed(4), netAmount: netAmount.toFixed(4), vatAmount: vatAmount.toFixed(4), documents };
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: input.context.tenantId, companyId: input.context.companyId, actorUserId: input.context.actorUserId, action: 'finance.purchase_expense.batch_created', entityType: 'FinanceOutflowBatch', entityId: batchId, requestId: `purchase-expense-batch:${input.idempotencyKey}`, afterJson: receipt as unknown as Prisma.InputJsonValue } });
      await this.idem.completeInTransaction(tx, input.context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: this.storeBatchReceipt(receipt) } });
      return receipt;
    }).catch((error) => { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with a different request.'); throw error; });
  }

  /**
   * Financial documents remain immutable after posting. The only correction
   * path is a separately dated journal reversal, followed (when required) by
   * a new corrected document. A payable document can only be reversed while
   * its supplier due has never been paid.
   */
  async reverse(input: { context: TrustedCompanyActorContext; idempotencyKey: string; request: ReversePurchaseExpenseDocumentRequest }): Promise<ReversePurchaseExpenseDocumentReceipt> {
    const reason = input.request.reason.trim();
    if (!reason) throw new BadRequestException('A purchase or expense reversal reason is required.');
    return this.db.inTenantTransaction(input.context.tenantId, async (tx) => {
      const request = { documentId: input.request.documentId, businessDate: input.request.businessDate, reason };
      const begun = await this.idem.beginInTransaction(tx, input.context, {
        operation: REVERSE_DOCUMENT_OPERATION,
        key: input.idempotencyKey,
        request: { documentId: request.documentId, businessDate: request.businessDate.toISOString().slice(0, 10), reason: request.reason },
        expiresAt: new Date(Date.now() + 86_400_000),
      });
      if (begun.kind === 'replay') return begun.response.body as unknown as ReversePurchaseExpenseDocumentReceipt;
      if (begun.kind === 'in-progress') throw new ConflictException('The purchase or expense reversal is already in progress.');
      await this.dates.assertNotFutureInTransaction(tx, input.context, request.businessDate);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.context.tenantId}:${input.context.companyId}:finance-outflow-reversal:${request.documentId}`}, 0))`;
      const document = await tx.financeOutflowDocument.findFirst({
        where: { id: request.documentId, tenantId: input.context.tenantId, companyId: input.context.companyId },
        include: {
          journalEntry: { select: { id: true, reversalEntry: { select: { id: true } }, supplierDue: { include: { payments: { where: { status: FinanceSupplierDuePaymentStatus.POSTED }, select: { id: true } } } } } },
          recurringCoverage: { select: { id: true } },
          hrEmployeeService: { select: { id: true } },
        },
      });
      if (!document) throw new BadRequestException('The purchase or expense document was not found for this company.');
      if (document.hrEmployeeService) throw new ConflictException('Employee-service costs must be reversed from the employee service record to keep the employee financial file consistent.');
      if (document.status !== FinanceOutflowDocumentStatus.POSTED || document.journalEntry.reversalEntry) throw new ConflictException('The purchase or expense document has already been reversed.');
      if (request.businessDate < document.businessDate) throw new BadRequestException('A reversal cannot predate the original purchase or expense document.');
      const due = document.journalEntry.supplierDue;
      if (due && (due.status !== FinanceSupplierDueStatus.OPEN || !due.paidAmount.isZero() || due.payments.length)) {
        throw new ConflictException('A payable document can only be reversed before any supplier payment is recorded. Reverse its payments first.');
      }
      const requestId = `purchase-expense-reversal:${document.id}`;
      const journal = await this.journals.reverseInTransaction(tx, { ...input.context, requestId, journalEntryId: document.journalEntryId, businessDate: request.businessDate, reason: request.reason });
      await this.cashEvents.recordReversalForJournalInTransaction(tx, input.context, {
        originalJournalEntryId: document.journalEntryId, reversalJournalEntryId: journal.journalEntryId,
        reversalLedgerRevision: journal.ledgerRevision, businessDate: request.businessDate,
        sourceType: 'finance_outflow_document_reversal', sourceId: document.id,
      });
      const cancelled = await tx.financeOutflowDocument.updateMany({
        where: { id: document.id, tenantId: input.context.tenantId, companyId: input.context.companyId, status: FinanceOutflowDocumentStatus.POSTED },
        data: { status: FinanceOutflowDocumentStatus.CANCELLED },
      });
      if (cancelled.count !== 1) throw new ConflictException('The purchase or expense document changed while its reversal was being recorded.');
      if (due) {
        const dueCancelled = await tx.financeSupplierDue.updateMany({
          where: { id: due.id, tenantId: input.context.tenantId, companyId: input.context.companyId, status: FinanceSupplierDueStatus.OPEN, paidAmount: new Prisma.Decimal(0) },
          data: { status: FinanceSupplierDueStatus.CANCELLED, remainingAmount: new Prisma.Decimal(0) },
        });
        if (dueCancelled.count !== 1) throw new ConflictException('The supplier due changed while the source document was being reversed.');
      }
      // Coverage is an operational reservation, not a financial record. Once
      // the source document has a full journal reversal it is safe to make the
      // saved recurring period available for a corrected payment.
      if (document.recurringCoverage.length) await tx.financeRecurringExpenseCoverage.updateMany({
        where: { tenantId: input.context.tenantId, companyId: input.context.companyId, documentId: document.id },
        data: { documentId: null },
      });
      const receipt: ReversePurchaseExpenseDocumentReceipt = {
        documentId: document.id,
        documentNumber: document.documentNumber,
        reversalJournalEntryId: journal.journalEntryId,
        supplierDueId: due?.id ?? null,
        businessDate: request.businessDate.toISOString().slice(0, 10),
      };
      await tx.auditEvent.create({ data: {
        id: randomUUID(), tenantId: input.context.tenantId, companyId: input.context.companyId, actorUserId: input.context.actorUserId,
        action: 'finance.purchase_expense.reversed', entityType: 'FinanceOutflowDocument', entityId: document.id, requestId,
        afterJson: { ...receipt, reason: request.reason } as Prisma.InputJsonValue,
      } });
      await this.idem.completeInTransaction(tx, input.context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    }).catch((error) => { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different reversal data.'); throw error; });
  }

  /** Issues the cost of an already-recorded HR service in the same transaction as its expense document and employee-ledger projection. */
  async issueEmployeeServiceCost(input: { context: TrustedCompanyActorContext; idempotencyKey: string; request: IssueEmployeeServiceCostRequest }): Promise<PurchaseExpenseReceipt> {
    return this.db.inTenantTransaction(input.context.tenantId, async (tx) => {
      const request = this.normaliseEmployeeServiceCost(input.request);
      const begun = await this.idem.beginInTransaction(tx, input.context, { operation: 'hr.employee_service.cost.issue', key: input.idempotencyKey, request: this.employeeServiceCostPayload(request), expiresAt: new Date(Date.now() + 86_400_000) });
      if (begun.kind === 'replay') return begun.response.body as unknown as PurchaseExpenseReceipt;
      if (begun.kind === 'in-progress') throw new ConflictException('This employee-service cost request is already being processed.');
      const service = await tx.hrEmployeeService.findFirst({ where: { id: request.serviceId, tenantId: input.context.tenantId, companyId: input.context.companyId, status: HrEmployeeServiceStatus.DRAFT }, select: { id: true, employeeId: true, supplierId: true, categoryId: true } });
      if (!service?.supplierId || !service.categoryId) throw new BadRequestException('The employee service needs an active supplier and expense category before its cost can be issued.');
      const document = await this.postDocument(tx, input.context, {
        kind: 'EXPENSE', settlementKind: 'PAID', categoryId: service.categoryId, supplierId: service.supplierId,
        businessDate: request.businessDate, grossAmount: request.grossAmount, isTaxable: request.isTaxable,
        allocations: request.allocations, ...(request.supplierInvoiceNumber ? { supplierInvoiceNumber: request.supplierInvoiceNumber } : {}),
        ...(request.supplierInvoiceMissingReason ? { supplierInvoiceMissingReason: request.supplierInvoiceMissingReason } : {}),
        ...(request.supplierInvoiceDate ? { supplierInvoiceDate: request.supplierInvoiceDate } : {}), ...(request.notes ? { notes: request.notes } : {}),
      }, `hr-employee-service:${input.idempotencyKey}`);
      await tx.hrEmployeeService.update({ where: { id: service.id }, data: { status: HrEmployeeServiceStatus.ISSUED, outflowDocumentId: document.documentId } });
      await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId: input.context.tenantId, companyId: input.context.companyId, employeeId: service.employeeId, journalEntryId: document.journalEntryId, movementType: HrEmployeeFinancialMovementType.SERVICE_COST, businessDate: request.businessDate, amount: request.grossAmount, sourceReference: document.documentNumber, description: request.notes ?? null } });
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: input.context.tenantId, companyId: input.context.companyId, actorUserId: input.context.actorUserId, action: 'hr.employee_service.cost_issued', entityType: 'HrEmployeeService', entityId: service.id, requestId: `hr-employee-service:${input.idempotencyKey}`, afterJson: { ...document, serviceId: service.id } as unknown as Prisma.InputJsonValue } });
      await this.idem.completeInTransaction(tx, input.context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: document } });
      return document;
    }).catch((error) => { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different employee-service cost data.'); throw error; });
  }

  async reverseEmployeeServiceCost(input: { context: TrustedCompanyActorContext; idempotencyKey: string; request: ReverseEmployeeServiceCostRequest }): Promise<ReverseEmployeeServiceCostReceipt> {
    const request = { serviceId: input.request.serviceId, businessDate: input.request.businessDate, reason: input.request.reason.trim() };
    return this.db.inTenantTransaction(input.context.tenantId, async (tx) => {
      const begun = await this.idem.beginInTransaction(tx, input.context, { operation: 'hr.employee_service.cost.reverse', key: input.idempotencyKey, request: { serviceId: request.serviceId, businessDate: request.businessDate.toISOString(), reason: request.reason }, expiresAt: new Date(Date.now() + 86_400_000) });
      if (begun.kind === 'replay') return { ...(begun.response.body as unknown as ReverseEmployeeServiceCostReceipt), replayed: true };
      if (begun.kind === 'in-progress') throw new ConflictException('This employee-service cost reversal is already being processed.');
      await this.dates.assertNotFutureInTransaction(tx, input.context, request.businessDate);
      if (!request.reason) throw new BadRequestException('An employee-service cost reversal reason is required.');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${input.context.tenantId}:${input.context.companyId}:hr-employee-service-cost:${request.serviceId}`}, 0))`;
      const service = await tx.hrEmployeeService.findFirst({
        where: { id: request.serviceId, tenantId: input.context.tenantId, companyId: input.context.companyId },
        include: { outflowDocument: { include: { journalEntry: { select: { id: true, reversalEntry: { select: { id: true } } } } } } },
      });
      if (!service?.outflowDocument) throw new BadRequestException('The employee service has no issued financial cost to reverse.');
      const document = service.outflowDocument;
      if (document.status === FinanceOutflowDocumentStatus.CANCELLED || document.journalEntry.reversalEntry) throw new ConflictException('The employee-service cost has already been reversed.');
      if (document.status !== FinanceOutflowDocumentStatus.POSTED || document.settlementKind !== FinanceOutflowSettlementKind.PAID) throw new ConflictException('Only a posted paid employee-service cost can be reversed.');
      if (document.createdByUserId === input.context.actorUserId) throw new ConflictException('The employee-service cost issuer cannot reverse the same cost.');
      if (request.businessDate < document.businessDate) throw new BadRequestException('The employee-service cost reversal cannot predate the issued cost.');
      const journal = await this.journals.reverseInTransaction(tx, { ...input.context, requestId: `hr-employee-service-cost-reversal:${service.id}`, journalEntryId: document.journalEntryId, businessDate: request.businessDate, reason: request.reason });
      await this.cashEvents.recordReversalForJournalInTransaction(tx, input.context, {
        originalJournalEntryId: document.journalEntryId, reversalJournalEntryId: journal.journalEntryId,
        reversalLedgerRevision: journal.ledgerRevision, businessDate: request.businessDate,
        sourceType: 'finance_outflow_document_reversal', sourceId: document.id,
      });
      const cancelledDocument = await tx.financeOutflowDocument.updateMany({ where: { id: document.id, tenantId: input.context.tenantId, companyId: input.context.companyId, status: FinanceOutflowDocumentStatus.POSTED }, data: { status: FinanceOutflowDocumentStatus.CANCELLED } });
      if (cancelledDocument.count !== 1) throw new ConflictException('The employee-service cost changed while its reversal was being recorded.');
      await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId: input.context.tenantId, companyId: input.context.companyId, employeeId: service.employeeId, journalEntryId: journal.journalEntryId, movementType: HrEmployeeFinancialMovementType.SERVICE_COST, businessDate: request.businessDate, amount: document.grossAmount.negated(), sourceReference: `${document.documentNumber}-REV`, description: `Employee-service cost reversed: ${request.reason}` } });
      const receipt: ReverseEmployeeServiceCostReceipt = { serviceId: service.id, documentId: document.id, documentNumber: document.documentNumber, reversalJournalEntryId: journal.journalEntryId, replayed: false };
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: input.context.tenantId, companyId: input.context.companyId, actorUserId: input.context.actorUserId, action: 'hr.employee_service.cost_reversed', entityType: 'HrEmployeeService', entityId: service.id, requestId: `hr-employee-service-cost-reversal:${service.id}`, afterJson: { ...receipt, businessDate: request.businessDate.toISOString().slice(0, 10), reason: request.reason } as Prisma.InputJsonValue } });
      await this.idem.completeInTransaction(tx, input.context, { receiptId: begun.receiptId, response: { status: 200, headers: null, body: receipt } });
      return receipt;
    }).catch((error) => { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different employee-service cost reversal data.'); throw error; });
  }

  /** One user action: the operational service, paid supplier invoice and employee movement are atomic. */
  async recordEmployeeServiceAndIssueCost(input: { context: TrustedCompanyActorContext; idempotencyKey: string; request: RecordEmployeeServiceAndIssueCostRequest }): Promise<RecordEmployeeServiceAndIssueCostReceipt> {
    return this.db.inTenantTransaction(input.context.tenantId, async (tx) => {
      const request = this.normaliseRecordedEmployeeService(input.request);
      const begun = await this.idem.beginInTransaction(tx, input.context, { operation: 'hr.employee_service.record_and_issue', key: input.idempotencyKey, request: this.recordedEmployeeServicePayload(request), expiresAt: new Date(Date.now() + 86_400_000) });
      if (begun.kind === 'replay') return begun.response.body as RecordEmployeeServiceAndIssueCostReceipt;
      if (begun.kind === 'in-progress') throw new ConflictException('This employee-service request is already being processed.');
      const service = await this.hr.createServiceForFinancialIssueInTransaction(tx, input.context, this.employeeServiceCreateInput(request));
      const document = await this.postDocument(tx, input.context, {
        kind: 'EXPENSE', settlementKind: 'PAID', categoryId: request.categoryId, supplierId: request.supplierId,
        businessDate: request.businessDate, grossAmount: request.grossAmount, isTaxable: request.isTaxable, allocations: request.allocations,
        ...(request.supplierInvoiceNumber ? { supplierInvoiceNumber: request.supplierInvoiceNumber } : {}),
        ...(request.supplierInvoiceMissingReason ? { supplierInvoiceMissingReason: request.supplierInvoiceMissingReason } : {}),
        ...(request.supplierInvoiceDate ? { supplierInvoiceDate: request.supplierInvoiceDate } : {}),
        ...(request.notes ? { notes: request.notes } : {}),
      }, `hr-employee-service-record:${input.idempotencyKey}`);
      await tx.hrEmployeeService.update({ where: { id: service.id }, data: { status: HrEmployeeServiceStatus.ISSUED, outflowDocumentId: document.documentId } });
      await tx.hrEmployeeFinancialMovement.create({ data: { id: randomUUID(), tenantId: input.context.tenantId, companyId: input.context.companyId, employeeId: service.employeeId, journalEntryId: document.journalEntryId, movementType: HrEmployeeFinancialMovementType.SERVICE_COST, businessDate: request.businessDate, amount: request.grossAmount, sourceReference: document.documentNumber, description: request.notes ?? null } });
      const receipt: RecordEmployeeServiceAndIssueCostReceipt = { serviceId: service.id, documentId: document.documentId, documentNumber: document.documentNumber, journalEntryId: document.journalEntryId, replayed: false };
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: input.context.tenantId, companyId: input.context.companyId, actorUserId: input.context.actorUserId, action: 'hr.employee_service.recorded_and_cost_issued', entityType: 'HrEmployeeService', entityId: service.id, requestId: `hr-employee-service-record:${input.idempotencyKey}`, afterJson: receipt as unknown as Prisma.InputJsonValue } });
      await this.idem.completeInTransaction(tx, input.context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    }).catch((error) => { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different employee-service data.'); throw error; });
  }

  async createRecurringPayment(input: { context: TrustedCompanyActorContext; idempotencyKey: string; request: RecurringExpensePaymentRequest }): Promise<RecurringExpensePaymentReceipt> {
    return this.db.inTenantTransaction(input.context.tenantId, async (tx) => {
      const request = this.normaliseRecurringPayment(input.request);
      const begun = await this.idem.beginInTransaction(tx, input.context, { operation: RECURRING_PAYMENT_OPERATION, key: input.idempotencyKey, request: this.recurringPayload(request), expiresAt: new Date(Date.now() + 86_400_000) });
      if (begun.kind === 'replay') return begun.response.body as unknown as RecurringExpensePaymentReceipt;
      if (begun.kind === 'in-progress') throw new ConflictException('This recurring payment is already being processed.');
      const receipt = await this.postRecurringPaymentInTransaction(tx, input.context, request, `recurring-expense:${input.idempotencyKey}`);
      await this.idem.completeInTransaction(tx, input.context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: receipt } });
      return receipt;
    }).catch((error) => { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different recurring-payment data.'); throw error; });
  }

  async createRecurringPaymentBatch(input: { context: TrustedCompanyActorContext; idempotencyKey: string; request: RecurringExpensePaymentBatchRequest }): Promise<RecurringExpensePaymentBatchReceipt> {
    return this.db.inTenantTransaction(input.context.tenantId, async (tx) => {
      const request = this.normaliseRecurringBatch(input.request);
      const begun = await this.idem.beginInTransaction(tx, input.context, { operation: RECURRING_PAYMENT_BATCH_OPERATION, key: input.idempotencyKey, request: this.recurringBatchPayload(request), expiresAt: new Date(Date.now() + 86_400_000) });
      if (begun.kind === 'replay') return this.restoreRecurringBatchReceipt(begun.response.body);
      if (begun.kind === 'in-progress') throw new ConflictException('This recurring-payment batch is already being processed.');
      await this.dates.assertNotFutureInTransaction(tx, input.context, request.businessDate);
      const day = request.businessDate.toISOString().slice(0, 10) as `${number}-${number}-${number}`;
      const sequence = await this.serials.reserveInTransaction(tx, input.context, { series: 'RECURRING_EXPENSE_BATCH', businessDate: day });
      const batchId = randomUUID();
      const batchNumber = `REC-${day.replaceAll('-', '')}-${sequence.toString().padStart(4, '0')}`;
      const financeProfile = await tx.companyFinanceProfile.findFirst({ where: { tenantId: input.context.tenantId, companyId: input.context.companyId }, select: { vatAccountingEnabled: true, vatRateBasisPoints: true } });
      const initialAmounts = request.items.reduce((total, item) => {
        const gross = new Prisma.Decimal(item.grossAmount);
        const rate = item.isTaxable && financeProfile?.vatAccountingEnabled ? financeProfile.vatRateBasisPoints : 0;
        const net = rate ? gross.mul(10_000).div(10_000 + rate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP) : gross;
        return { gross: total.gross.plus(gross), net: total.net.plus(net), vat: total.vat.plus(gross.minus(net).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP)) };
      }, { gross: new Prisma.Decimal(0), net: new Prisma.Decimal(0), vat: new Prisma.Decimal(0) });
      await tx.financeOutflowBatch.create({ data: { id: batchId, tenantId: input.context.tenantId, companyId: input.context.companyId, batchNumber, businessDate: request.businessDate, documentCount: request.items.length, grossAmount: initialAmounts.gross, netAmount: initialAmounts.net, vatAmount: initialAmounts.vat, createdByUserId: input.context.actorUserId } });
      const payments: RecurringExpensePaymentReceipt[] = [];
      for (const [index, item] of request.items.entries()) payments.push(await this.postRecurringPaymentInTransaction(tx, input.context, { ...item, businessDate: request.businessDate }, `recurring-expense-batch:${input.idempotencyKey}:${index + 1}`, batchId));
      const grossAmount = payments.reduce((total, item) => total.plus(item.grossAmount), new Prisma.Decimal(0));
      const netAmount = payments.reduce((total, item) => total.plus(item.netAmount), new Prisma.Decimal(0));
      const vatAmount = payments.reduce((total, item) => total.plus(item.vatAmount), new Prisma.Decimal(0));
      await tx.financeOutflowBatch.update({ where: { id: batchId }, data: { grossAmount, netAmount, vatAmount } });
      const receipt: RecurringExpensePaymentBatchReceipt = { batchId, batchNumber, businessDate: request.businessDate, documentCount: payments.length, grossAmount: grossAmount.toFixed(4), netAmount: netAmount.toFixed(4), vatAmount: vatAmount.toFixed(4), payments };
      await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: input.context.tenantId, companyId: input.context.companyId, actorUserId: input.context.actorUserId, action: 'finance.recurring_expense.payment_batch_created', entityType: 'FinanceOutflowBatch', entityId: batchId, requestId: `recurring-expense-batch:${input.idempotencyKey}`, afterJson: receipt as unknown as Prisma.InputJsonValue } });
      await this.idem.completeInTransaction(tx, input.context, { receiptId: begun.receiptId, response: { status: 201, headers: null, body: this.storeRecurringBatchReceipt(receipt) } });
      return receipt;
    }).catch((error) => { if (error instanceof IdempotencyPayloadMismatchError) throw new ConflictException('The idempotency key was used with different recurring-payment batch data.'); throw error; });
  }

  private async postRecurringPaymentInTransaction(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, request: RecurringExpensePaymentRequest, requestId: string, batchId?: string): Promise<RecurringExpensePaymentReceipt> {
    await this.dates.assertNotFutureInTransaction(tx, context, request.businessDate);
    const profile = await tx.financeRecurringExpenseProfile.findFirst({
      where: { id: request.profileId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceRecurringExpenseStatus.ACTIVE },
      select: { id: true, categoryId: true, supplierId: true, expectedAmount: true, intervalMonths: true, allowAmountOverride: true },
    });
    if (!profile) throw new BadRequestException('The recurring expense profile is not active for this company.');
    const month = request.coverageStartMonth;
    const interval = profile.intervalMonths;
    if (!Number.isInteger(request.coverageYear) || request.coverageYear < 2000 || request.coverageYear > 2100 || !Number.isInteger(month) || month < 1 || month > 12 || (month - 1) % interval !== 0 || month + interval - 1 > 12) throw new BadRequestException('The selected recurring coverage does not match the configured interval.');
    const gross = new Prisma.Decimal(request.grossAmount);
    if (!profile.allowAmountOverride && !gross.equals(profile.expectedAmount)) throw new BadRequestException('This recurring expense uses its configured expected amount.');
    const months = Array.from({ length: interval }, (_, index) => month + index);
    try {
      await tx.financeRecurringExpenseCoverage.createMany({ data: months.map((coverageMonth) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, profileId: profile.id, coverageYear: request.coverageYear, coverageMonth })) });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('This recurring expense was already paid for one or more selected months.');
      throw error;
    }
    const document = await this.postDocument(tx, context, {
      kind: 'EXPENSE', settlementKind: 'PAID', categoryId: profile.categoryId,
      ...(profile.supplierId ? { supplierId: profile.supplierId } : {}),
      ...(request.supplierInvoiceNumber ? { supplierInvoiceNumber: request.supplierInvoiceNumber } : {}),
      ...(request.supplierInvoiceMissingReason ? { supplierInvoiceMissingReason: request.supplierInvoiceMissingReason } : {}), ...(request.supplierInvoiceDate ? { supplierInvoiceDate: request.supplierInvoiceDate } : {}),
      businessDate: request.businessDate, grossAmount: request.grossAmount, isTaxable: request.isTaxable,
      allocations: request.allocations, ...(request.notes ? { notes: request.notes } : {}),
    }, requestId, batchId, { profileId: profile.id, coverageYear: request.coverageYear, coverageStartMonth: month, coverageMonths: interval });
    await tx.financeRecurringExpenseCoverage.updateMany({ where: { tenantId: context.tenantId, companyId: context.companyId, profileId: profile.id, coverageYear: request.coverageYear, coverageMonth: { in: months }, documentId: null }, data: { documentId: document.documentId } });
    const nextReminderDate = new Date(Date.UTC(request.coverageYear, month - 1 + interval, 1));
    await tx.financeRecurringExpenseProfile.update({ where: { id: profile.id }, data: { nextReminderDate } });
    const receipt: RecurringExpensePaymentReceipt = { ...document, profileId: profile.id, coverageYear: request.coverageYear, coverageStartMonth: month, coverageMonths: interval };
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: 'finance.recurring_expense.payment.created', entityType: 'FinanceOutflowDocument', entityId: document.documentId, requestId, afterJson: receipt as unknown as Prisma.InputJsonValue } });
    return receipt;
  }

  /** Server-owned open-credit snapshot. Summary is complete; details use stable keyset pages. */
  async creditWorkspace(context: TrustedCompanyActorContext, query: { cursor?: string; pageSize: number }) {
    const [date, result] = await Promise.all([
      this.dates.currentForTrustedContext(context),
      this.db.inTenantTransaction(context.tenantId, async (tx) => {
        const baseWhere = { tenantId: context.tenantId, companyId: context.companyId, status: { in: [FinanceSupplierDueStatus.OPEN, FinanceSupplierDueStatus.PARTIALLY_PAID] } };
        const cursor = query.cursor ? await tx.financeSupplierDue.findFirst({ where: { ...baseWhere, id: query.cursor }, select: { id: true, originalBusinessDate: true } }) : null;
        if (query.cursor && !cursor) throw new BadRequestException('The credit page cursor is invalid.');
        const where = cursor ? { ...baseWhere, OR: [{ originalBusinessDate: { lt: cursor.originalBusinessDate } }, { originalBusinessDate: cursor.originalBusinessDate, id: { lt: cursor.id } }] } : baseWhere;
        const [summary, supplierCountRows, rows] = await Promise.all([
          tx.financeSupplierDue.aggregate({ where: baseWhere, _count: { _all: true }, _sum: { originalAmount: true, paidAmount: true, remainingAmount: true } }),
          tx.$queryRaw<Array<{ count: number }>>`SELECT COUNT(DISTINCT "supplierId")::int AS "count" FROM "FinanceSupplierDue" WHERE "tenantId" = ${context.tenantId} AND "companyId" = ${context.companyId} AND "status"::text IN ('OPEN', 'PARTIALLY_PAID')`,
          tx.financeSupplierDue.findMany({
            where,
            orderBy: [{ originalBusinessDate: 'desc' }, { id: 'desc' }],
            take: query.pageSize + 1,
            select: { id: true, supplierId: true, sourceDocumentNumber: true, originalBusinessDate: true, dueDate: true, originalAmount: true, paidAmount: true, remainingAmount: true, supplier: { select: { nameAr: true, nameEn: true } }, category: { select: { nameAr: true, nameEn: true } }, journalEntry: { select: { sourceReference: true } } },
          }),
        ]);
        const hasMore = rows.length > query.pageSize;
        const dues = hasMore ? rows.slice(0, query.pageSize) : rows;
        return { summary, openSupplierCount: supplierCountRows[0]?.count ?? 0, dues, hasMore, nextCursor: hasMore ? dues.at(-1)?.id ?? null : null };
      }),
    ]);
    const { dues } = result;
    const groups = new Map<string, { supplierId: string; supplierNameAr: string; supplierNameEn: string | null; original: Prisma.Decimal; paid: Prisma.Decimal; remaining: Prisma.Decimal; dues: Array<{ id: string; documentNumber: string; kind: 'PURCHASE' | 'EXPENSE'; businessDate: Date; dueDate: Date | null; categoryNameAr: string | null; categoryNameEn: string | null; originalAmount: string; paidAmount: string; remainingAmount: string }> }>();
    for (const due of dues) {
      const group = groups.get(due.supplierId) ?? { supplierId: due.supplierId, supplierNameAr: due.supplier.nameAr, supplierNameEn: due.supplier.nameEn, original: new Prisma.Decimal(0), paid: new Prisma.Decimal(0), remaining: new Prisma.Decimal(0), dues: [] };
      const kind: 'PURCHASE' | 'EXPENSE' = due.journalEntry?.sourceReference?.startsWith('PUR-') ? 'PURCHASE' : 'EXPENSE';
      group.original = group.original.plus(due.originalAmount); group.paid = group.paid.plus(due.paidAmount); group.remaining = group.remaining.plus(due.remainingAmount);
      group.dues.push({ id: due.id, documentNumber: due.sourceDocumentNumber, kind, businessDate: due.originalBusinessDate, dueDate: due.dueDate, categoryNameAr: due.category?.nameAr ?? null, categoryNameEn: due.category?.nameEn ?? null, originalAmount: due.originalAmount.toFixed(4), paidAmount: due.paidAmount.toFixed(4), remainingAmount: due.remainingAmount.toFixed(4) }); groups.set(due.supplierId, group);
    }
    const suppliers = [...groups.values()].map((group) => ({ supplierId: group.supplierId, supplierNameAr: group.supplierNameAr, supplierNameEn: group.supplierNameEn, invoiceCount: group.dues.length, originalAmount: group.original.toFixed(4), paidAmount: group.paid.toFixed(4), remainingAmount: group.remaining.toFixed(4), dues: group.dues }));
    return { companyId: context.companyId, asOfBusinessDate: date.businessDate, openSupplierCount: result.openSupplierCount, openInvoiceCount: result.summary._count._all, originalAmount: (result.summary._sum.originalAmount ?? new Prisma.Decimal(0)).toFixed(4), paidAmount: (result.summary._sum.paidAmount ?? new Prisma.Decimal(0)).toFixed(4), remainingAmount: (result.summary._sum.remainingAmount ?? new Prisma.Decimal(0)).toFixed(4), suppliers, hasMore: result.hasMore, nextCursor: result.nextCursor };
  }
  async list(context: TrustedCompanyActorContext, input: { cursor?: string; pageSize: number }) {
    return this.db.inTenantTransaction(context.tenantId, async (tx) => {
      const baseWhere: Prisma.FinanceOutflowDocumentWhereInput = { tenantId: context.tenantId, companyId: context.companyId };
      const cursor = input.cursor ? await tx.financeOutflowDocument.findFirst({ where: { ...baseWhere, id: input.cursor }, select: { id: true, businessDate: true, createdAt: true } }) : null;
      if (input.cursor && !cursor) throw new BadRequestException('The document history cursor is no longer valid.');
      const rows = await tx.financeOutflowDocument.findMany({
        where: cursor ? { ...baseWhere, OR: [
          { businessDate: { lt: cursor.businessDate } },
          { businessDate: cursor.businessDate, createdAt: { lt: cursor.createdAt } },
          { businessDate: cursor.businessDate, createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ] } : baseWhere,
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }], take: input.pageSize + 1,
        select: { id: true, documentNumber: true, kind: true, settlementKind: true, status: true, businessDate: true, grossAmount: true, batch: { select: { batchNumber: true } }, supplier: { select: { nameAr: true, nameEn: true } }, category: { select: { nameAr: true, nameEn: true } } },
      });
      const hasMore = rows.length > input.pageSize;
      const documents = hasMore ? rows.slice(0, input.pageSize) : rows;
      return { documents: documents.map((document) => ({ id: document.id, documentNumber: document.documentNumber, kind: document.kind, settlementKind: document.settlementKind, status: document.status, businessDate: document.businessDate, grossAmount: document.grossAmount.toFixed(4), batchNumber: document.batch?.batchNumber ?? null, supplierNameAr: document.supplier?.nameAr ?? null, supplierNameEn: document.supplier?.nameEn ?? null, categoryNameAr: document.category.nameAr, categoryNameEn: document.category.nameEn })), hasMore, nextCursor: hasMore ? documents.at(-1)?.id ?? null : null };
    });
  }

  private async postDocument(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, raw: PurchaseExpenseRequest, requestId: string, batchId?: string, recurring?: { profileId: string; coverageYear: number; coverageStartMonth: number; coverageMonths: number }): Promise<PurchaseExpenseReceipt> {
    const request = this.normalise(raw);
    await this.dates.assertNotFutureInTransaction(tx, context, request.businessDate);
    const category = await tx.financeCategory.findFirst({ where: { id: request.categoryId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceCategoryStatus.ACTIVE, isPosting: true, kind: request.kind }, include: { account: { select: { id: true, type: true, status: true } } } });
    if (!category?.account || category.account.status !== FinanceAccountStatus.ACTIVE || (category.account.type !== FinanceAccountType.ASSET && category.account.type !== FinanceAccountType.EXPENSE)) throw new BadRequestException('The selected category is not ready for financial posting.');
    if (request.supplierId) {
      const supplier = await tx.financeSupplier.findFirst({ where: { id: request.supplierId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceSupplierStatus.ACTIVE }, select: { id: true } });
      if (!supplier) throw new BadRequestException('The selected supplier is not active.');
    }
    if (request.settlementKind === 'PAYABLE' && !request.supplierId) throw new BadRequestException('A supplier is required for a payable document.');
    if (request.settlementKind === 'PAID' && !request.allocations.length) throw new BadRequestException('Choose at least one payment destination.');
    const gross = new Prisma.Decimal(request.grossAmount); if (!gross.isFinite() || gross.lte(0)) throw new BadRequestException('The gross amount is invalid.');
    const profile = await tx.companyFinanceProfile.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId }, select: { accountingMode: true, vatAccountingEnabled: true, vatRateBasisPoints: true } });
    if (!profile) throw new BadRequestException('The company financial setup is incomplete.');
    const rate = request.isTaxable && profile?.vatAccountingEnabled ? profile.vatRateBasisPoints : 0;
    const net = rate ? gross.mul(10_000).div(10_000 + rate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP) : gross;
    const vat = gross.minus(net).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
    const day = request.businessDate.toISOString().slice(0, 10) as `${number}-${number}-${number}`;
    const sequence = await this.serials.reserveInTransaction(tx, context, { series: request.kind === 'PURCHASE' ? 'PURCHASE' : 'EXPENSE', businessDate: day });
    const documentNumber = `${request.kind === 'PURCHASE' ? 'PUR' : 'EXP'}-${day.replaceAll('-', '')}-${sequence.toString().padStart(4, '0')}`;
    // Baseer management-cash policy: credit invoices establish a supplier obligation and a pending outflow, never a P&L expense. The expense is recognised atomically with each supplier payment.
    const debitAccountId = request.settlementKind === 'PAYABLE' && profile.accountingMode === 'management_cash' ? await this.account(tx, context, 'CASH_BASIS_PENDING_OUTFLOWS') : category.account.id;
    const lines: { accountId: string; debitAmount?: string; creditAmount?: string; description?: string }[] = [{ accountId: debitAccountId, debitAmount: net.toFixed(4), description: documentNumber }];
    if (!vat.isZero()) lines.push({ accountId: await this.account(tx, context, 'VAT_INPUT'), debitAmount: vat.toFixed(4), description: documentNumber });
    let allocations: { vaultId: string; grossAmount: string; paymentMethod: FinanceVaultPaymentMethod }[] = []; let supplierDueId: string | null = null;
    if (request.settlementKind === 'PAID') {
      const grouped = new Map<string, { vaultId: string; paymentMethod: FinanceVaultPaymentMethod | undefined; grossAmount: Prisma.Decimal }>();
      for (const allocation of request.allocations) {
        const key = `${allocation.vaultId}:${allocation.paymentMethod ?? ''}`;
        const prior = grouped.get(key);
        grouped.set(key, { vaultId: allocation.vaultId, paymentMethod: allocation.paymentMethod, grossAmount: (prior?.grossAmount ?? new Prisma.Decimal(0)).plus(allocation.grossAmount) });
      }
      const total = [...grouped.values()].reduce((sum, value) => sum.plus(value.grossAmount), new Prisma.Decimal(0));
      if (!total.equals(gross)) throw new BadRequestException('Payment allocations must equal the gross amount.');
      for (const allocation of grouped.values()) {
        const vault = await this.vaults.assertActivePaymentDestination(tx, { ...context, vaultId: allocation.vaultId });
        const paymentMethod = allocation.paymentMethod ?? vault.paymentMethod;
        if (!vault.paymentMethods.includes(paymentMethod)) throw new BadRequestException('The selected payment method is not enabled for this vault.');
        const grossAmount = allocation.grossAmount.toFixed(4);
        allocations.push({ vaultId: allocation.vaultId, grossAmount, paymentMethod });
        lines.push({ accountId: vault.accountId, creditAmount: grossAmount, description: documentNumber });
      }
    } else { lines.push({ accountId: await this.account(tx, context, 'SUPPLIER_DUES'), creditAmount: gross.toFixed(4), description: documentNumber }); supplierDueId = randomUUID(); }
    const journal = await this.journals.postInTransaction(tx, { ...context, requestId, sourceType: 'finance_outflow_document', sourceReference: documentNumber, businessDate: request.businessDate, description: request.notes ?? documentNumber, lines });
    const documentId = randomUUID();
    await tx.financeOutflowDocument.create({ data: { id: documentId, tenantId: context.tenantId, companyId: context.companyId, ...(batchId ? { batchId } : {}), ...(recurring ? { recurringExpenseProfileId: recurring.profileId, coverageYear: recurring.coverageYear, coverageStartMonth: recurring.coverageStartMonth, coverageMonths: recurring.coverageMonths } : {}), kind: request.kind, settlementKind: request.settlementKind, documentNumber, supplierId: request.supplierId ?? null, categoryId: request.categoryId, supplierInvoiceNumber: request.supplierInvoiceNumber ?? null, supplierInvoiceNumberNormalized: request.supplierInvoiceNumber?.toLocaleUpperCase('en-US') ?? null, supplierInvoiceMissingReason: request.supplierInvoiceMissingReason ?? null, businessDate: request.businessDate, supplierInvoiceDate: request.supplierInvoiceDate ?? null, grossAmount: gross, netAmount: net, vatAmount: vat, vatRateBasisPoints: rate, assetWarrantyFollowUp: request.assetWarrantyFollowUp ?? false, notes: request.notes ?? null, journalEntryId: journal.journalEntryId, createdByUserId: context.actorUserId } });
    if (request.settlementKind === 'PAID') {
      await this.cashEvents.recordInTransaction(tx, context, {
        kind: request.kind === 'PURCHASE' ? FinanceCashPerformanceEventKind.PURCHASE_PAYMENT : FinanceCashPerformanceEventKind.OPERATING_EXPENSE_PAYMENT,
        direction: FinanceCashPerformanceDirection.OUTFLOW, businessDate: request.businessDate,
        grossAmount: gross, netAmount: net, vatAmount: vat,
        sourceType: 'finance_outflow_document', sourceId: documentId, sourceJournalEntryId: journal.journalEntryId, ledgerRevision: journal.ledgerRevision,
        category: { code: category.code, nameAr: category.nameAr, nameEn: category.nameEn, kind: category.kind },
        destinations: allocations.map((allocation) => ({ vaultId: allocation.vaultId, amount: allocation.grossAmount, paymentMethod: allocation.paymentMethod })),
      });
    }
    if (allocations.length) await tx.financeOutflowAllocation.createMany({ data: allocations.map((allocation) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, documentId, vaultId: allocation.vaultId, grossAmount: allocation.grossAmount, paymentMethod: allocation.paymentMethod })) });
    if (supplierDueId) await tx.financeSupplierDue.create({ data: { id: supplierDueId, tenantId: context.tenantId, companyId: context.companyId, supplierId: request.supplierId!, categoryId: request.categoryId, sourceDocumentNumber: documentNumber, originalBusinessDate: request.businessDate, originalAmount: gross, remainingAmount: gross, status: FinanceSupplierDueStatus.OPEN, notes: request.notes ?? null, journalEntryId: journal.journalEntryId } });
    const receipt: PurchaseExpenseReceipt = { documentId, documentNumber, journalEntryId: journal.journalEntryId, kind: request.kind, settlementKind: request.settlementKind, status: FinanceOutflowDocumentStatus.POSTED, grossAmount: gross.toFixed(4), netAmount: net.toFixed(4), vatAmount: vat.toFixed(4), supplierDueId };
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: 'finance.purchase_expense.created', entityType: 'FinanceOutflowDocument', entityId: documentId, requestId, afterJson: receipt as unknown as Prisma.InputJsonValue } });
    return receipt;
  }

  private async account(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, key: string) { const account = await tx.financeAccount.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, systemKey: key, status: FinanceAccountStatus.ACTIVE }, select: { id: true } }); if (!account) throw new BadRequestException('The company financial setup is incomplete.'); return account.id; }
  private normalise(request: PurchaseExpenseRequest): PurchaseExpenseRequest { const invoice = request.supplierInvoiceNumber?.trim(); const missingReason = request.supplierInvoiceMissingReason?.trim(); if (!invoice && !missingReason) throw new BadRequestException('Provide the supplier invoice number or a missing reason.'); if (invoice && missingReason) throw new BadRequestException('Provide an invoice number or a missing reason, not both.'); if (request.supplierInvoiceDate && request.supplierInvoiceDate > request.businessDate) throw new BadRequestException('Supplier invoice date cannot be after the batch date.'); return { ...request, ...(invoice ? { supplierInvoiceNumber: invoice } : {}), ...(missingReason ? { supplierInvoiceMissingReason: missingReason } : {}), ...(request.notes?.trim() ? { notes: request.notes.trim() } : {}) }; }
  private normaliseEmployeeServiceCost(request: IssueEmployeeServiceCostRequest): IssueEmployeeServiceCostRequest { const invoice = request.supplierInvoiceNumber?.trim(); const missingReason = request.supplierInvoiceMissingReason?.trim(); if (!invoice && !missingReason) throw new BadRequestException('Provide the supplier invoice number or a missing reason.'); if (invoice && missingReason) throw new BadRequestException('Provide an invoice number or a missing reason, not both.'); if (request.supplierInvoiceDate && request.supplierInvoiceDate > request.businessDate) throw new BadRequestException('Supplier invoice date cannot be after the business date.'); return { ...request, ...(invoice ? { supplierInvoiceNumber: invoice } : {}), ...(missingReason ? { supplierInvoiceMissingReason: missingReason } : {}), ...(request.notes?.trim() ? { notes: request.notes.trim() } : {}) }; }
  private normaliseRecordedEmployeeService(request: RecordEmployeeServiceAndIssueCostRequest): RecordEmployeeServiceAndIssueCostRequest {
    const cost = this.normaliseEmployeeServiceCost({ serviceId: 'recorded-service', businessDate: request.businessDate, grossAmount: request.grossAmount, isTaxable: request.isTaxable, allocations: request.allocations, supplierInvoiceNumber: request.supplierInvoiceNumber, supplierInvoiceMissingReason: request.supplierInvoiceMissingReason, supplierInvoiceDate: request.supplierInvoiceDate, notes: request.notes });
    return { ...request, ...cost, employeeId: request.employeeId, serviceType: request.serviceType, supplierId: request.supplierId, categoryId: request.categoryId, referenceNumber: request.referenceNumber?.trim() || undefined };
  }
  private employeeServiceCreateInput(request: RecordEmployeeServiceAndIssueCostRequest): EmployeeServiceCreateInput {
    return { employeeId: request.employeeId, serviceType: request.serviceType, ...(request.referenceNumber ? { referenceNumber: request.referenceNumber } : {}), ...(request.issueDate ? { issueDate: request.issueDate } : {}), ...(request.expiryDate ? { expiryDate: request.expiryDate } : {}), ...(request.visaDurationMonths ? { visaDurationMonths: request.visaDurationMonths } : {}), supplierId: request.supplierId, categoryId: request.categoryId, ...(request.notes ? { notes: request.notes } : {}) };
  }
  private normaliseBatch(request: PurchaseExpenseBatchRequest): PurchaseExpenseBatchRequest { if (!request.items.length || request.items.length > 25) throw new BadRequestException('A batch must contain from 1 to 25 invoices.'); const items = request.items.map((item) => { const { businessDate: _businessDate, ...normalised } = this.normalise({ ...item, businessDate: request.businessDate }); return normalised; }); const notes = request.notes?.trim(); return { businessDate: request.businessDate, items, ...(notes ? { notes } : {}) }; }
  private storeBatchReceipt(receipt: PurchaseExpenseBatchReceipt): StoredPurchaseExpenseBatchReceipt { return { ...receipt, businessDate: receipt.businessDate.toISOString() }; }
  private restoreBatchReceipt(value: unknown): PurchaseExpenseBatchReceipt { const stored = value as StoredPurchaseExpenseBatchReceipt; return { ...stored, businessDate: new Date(stored.businessDate) }; }
  private payload(request: PurchaseExpenseRequest) { return { kind: request.kind, settlementKind: request.settlementKind, categoryId: request.categoryId, supplierId: request.supplierId ?? null, supplierInvoiceNumber: request.supplierInvoiceNumber ?? null, supplierInvoiceMissingReason: request.supplierInvoiceMissingReason ?? null, businessDate: request.businessDate.toISOString(), supplierInvoiceDate: request.supplierInvoiceDate?.toISOString() ?? null, grossAmount: request.grossAmount, isTaxable: request.isTaxable, assetWarrantyFollowUp: request.assetWarrantyFollowUp ?? false, allocations: request.allocations.map((item) => ({ vaultId: item.vaultId, grossAmount: item.grossAmount, paymentMethod: item.paymentMethod ?? null })), notes: request.notes ?? null } as const; }
  private batchPayload(request: PurchaseExpenseBatchRequest) { return { businessDate: request.businessDate.toISOString(), notes: request.notes ?? null, items: request.items.map((item) => this.payload({ ...item, businessDate: request.businessDate })) } as const; }
  private employeeServiceCostPayload(request: IssueEmployeeServiceCostRequest) { return { serviceId: request.serviceId, businessDate: request.businessDate.toISOString(), grossAmount: request.grossAmount, isTaxable: request.isTaxable, allocations: request.allocations.map((allocation) => ({ vaultId: allocation.vaultId, grossAmount: allocation.grossAmount, paymentMethod: allocation.paymentMethod ?? null })), supplierInvoiceNumber: request.supplierInvoiceNumber ?? null, supplierInvoiceMissingReason: request.supplierInvoiceMissingReason ?? null, supplierInvoiceDate: request.supplierInvoiceDate?.toISOString() ?? null, notes: request.notes ?? null } as const; }
  private recordedEmployeeServicePayload(request: RecordEmployeeServiceAndIssueCostRequest) { return { employeeId: request.employeeId, serviceType: request.serviceType, referenceNumber: request.referenceNumber ?? null, issueDate: request.issueDate?.toISOString() ?? null, expiryDate: request.expiryDate?.toISOString() ?? null, visaDurationMonths: request.visaDurationMonths ?? null, supplierId: request.supplierId, categoryId: request.categoryId, ...this.employeeServiceCostPayload({ serviceId: 'recorded-service', businessDate: request.businessDate, grossAmount: request.grossAmount, isTaxable: request.isTaxable, allocations: request.allocations, supplierInvoiceNumber: request.supplierInvoiceNumber, supplierInvoiceMissingReason: request.supplierInvoiceMissingReason, supplierInvoiceDate: request.supplierInvoiceDate, notes: request.notes }) } as const; }
  private recurringPayload(request: RecurringExpensePaymentRequest) { return { profileId: request.profileId, businessDate: request.businessDate.toISOString(), coverageYear: request.coverageYear, coverageStartMonth: request.coverageStartMonth, grossAmount: request.grossAmount, isTaxable: request.isTaxable, vaultId: request.vaultId ?? null, allocations: request.allocations.map((allocation) => ({ vaultId: allocation.vaultId, grossAmount: allocation.grossAmount, paymentMethod: allocation.paymentMethod ?? null })), supplierInvoiceNumber: request.supplierInvoiceNumber ?? null, supplierInvoiceMissingReason: request.supplierInvoiceMissingReason ?? null, supplierInvoiceDate: request.supplierInvoiceDate?.toISOString() ?? null, notes: request.notes ?? null } as const; }
  private normaliseRecurringPayment(request: RecurringExpensePaymentRequest): RecurringExpensePaymentRequest {
    const invoice = request.supplierInvoiceNumber?.trim(); const missingReason = request.supplierInvoiceMissingReason?.trim();
    if (!invoice && !missingReason) throw new BadRequestException('Provide the supplier invoice number or a missing reason.');
    if (invoice && missingReason) throw new BadRequestException('Provide an invoice number or a missing reason, not both.');
    if (request.supplierInvoiceDate && request.supplierInvoiceDate > request.businessDate) throw new BadRequestException('Supplier invoice date cannot be after the payment date.');
    const allocations = request.allocations.length ? request.allocations : request.vaultId ? [{ vaultId: request.vaultId, grossAmount: request.grossAmount }] : [];
    if (!allocations.length) throw new BadRequestException('Choose at least one payment destination.');
    return { ...request, allocations, ...(invoice ? { supplierInvoiceNumber: invoice } : {}), ...(missingReason ? { supplierInvoiceMissingReason: missingReason } : {}), ...(request.notes?.trim() ? { notes: request.notes.trim() } : {}) };
  }
  private normaliseRecurringBatch(request: RecurringExpensePaymentBatchRequest): RecurringExpensePaymentBatchRequest {
    if (!request.items.length || request.items.length > 25) throw new BadRequestException('A recurring-payment batch must contain from 1 to 25 rows.');
    return { businessDate: request.businessDate, items: request.items.map((item) => { const { businessDate: _businessDate, ...payment } = this.normaliseRecurringPayment({ ...item, businessDate: request.businessDate }); return payment; }) };
  }
  private storeRecurringBatchReceipt(receipt: RecurringExpensePaymentBatchReceipt): StoredRecurringExpensePaymentBatchReceipt { return { ...receipt, businessDate: receipt.businessDate.toISOString() }; }
  private restoreRecurringBatchReceipt(value: unknown): RecurringExpensePaymentBatchReceipt { const stored = value as StoredRecurringExpensePaymentBatchReceipt; return { ...stored, businessDate: new Date(stored.businessDate) }; }
  private recurringBatchPayload(request: RecurringExpensePaymentBatchRequest) { return { businessDate: request.businessDate.toISOString(), items: request.items.map((item) => this.recurringPayload({ ...item, businessDate: request.businessDate })) } as const; }
}
