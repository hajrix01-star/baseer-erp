import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DocumentSerialService } from '../core-controls/document-serial.service.js';
import { IdempotencyPayloadMismatchError, IdempotencyService } from '../core-controls/idempotency.service.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceAccountStatus, FinanceAccountType, FinanceCategoryStatus, FinanceOutflowDocumentKind, FinanceOutflowDocumentStatus, FinanceOutflowSettlementKind, FinanceSupplierDueStatus, FinanceSupplierStatus, Prisma } from '../generated/prisma/client.js';
import { BusinessDateService } from '../business-date/business-date.service.js';
import { JournalPostingService } from './journal/journal-posting.service.js';
import { FinanceVaultService } from './finance-vault.service.js';

const DOCUMENT_OPERATION = 'finance.purchase_expense.create';
const BATCH_OPERATION = 'finance.purchase_expense.batch.create';
export type PurchaseExpenseRequest = Readonly<{ kind: 'PURCHASE' | 'EXPENSE'; settlementKind: 'PAID' | 'PAYABLE'; categoryId: string; supplierId?: string; supplierInvoiceNumber?: string; supplierInvoiceMissingReason?: string; businessDate: Date; supplierInvoiceDate?: Date; grossAmount: string; isTaxable: boolean; allocations: readonly Readonly<{ vaultId: string; grossAmount: string }>[]; notes?: string }>;
export type PurchaseExpenseReceipt = Readonly<{ documentId: string; documentNumber: string; journalEntryId: string; kind: FinanceOutflowDocumentKind; settlementKind: FinanceOutflowSettlementKind; status: FinanceOutflowDocumentStatus; grossAmount: string; netAmount: string; vatAmount: string; supplierDueId: string | null }>;
export type PurchaseExpenseBatchRequest = Readonly<{ businessDate: Date; notes?: string; items: readonly Omit<PurchaseExpenseRequest, 'businessDate'>[] }>;
export type PurchaseExpenseBatchReceipt = Readonly<{ batchId: string; batchNumber: string; businessDate: Date; documentCount: number; grossAmount: string; netAmount: string; vatAmount: string; documents: readonly PurchaseExpenseReceipt[] }>;
 type StoredPurchaseExpenseBatchReceipt = Omit<PurchaseExpenseBatchReceipt, 'businessDate'> & { businessDate: string };

@Injectable()
export class PurchaseExpenseService {
  constructor(private readonly db: DatabaseService, private readonly idem: IdempotencyService, private readonly serials: DocumentSerialService, private readonly journals: JournalPostingService, private readonly vaults: FinanceVaultService, private readonly dates: BusinessDateService) {}

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
      await tx.financeOutflowBatch.create({ data: { id: batchId, tenantId: input.context.tenantId, companyId: input.context.companyId, batchNumber, businessDate: request.businessDate, documentCount: request.items.length, grossAmount: new Prisma.Decimal(0), netAmount: new Prisma.Decimal(0), vatAmount: new Prisma.Decimal(0), notes: request.notes ?? null, createdByUserId: input.context.actorUserId } });
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

  async list(context: TrustedCompanyActorContext) {
    return this.db.inTenantTransaction(context.tenantId, async (tx) => tx.financeOutflowDocument.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId }, orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }], take: 250,
      select: { id: true, documentNumber: true, kind: true, settlementKind: true, status: true, businessDate: true, grossAmount: true, batch: { select: { batchNumber: true } }, supplier: { select: { nameAr: true } }, category: { select: { nameAr: true } } },
    }).then((documents) => documents.map((document) => ({ id: document.id, documentNumber: document.documentNumber, kind: document.kind, settlementKind: document.settlementKind, status: document.status, businessDate: document.businessDate, grossAmount: document.grossAmount.toFixed(4), batchNumber: document.batch?.batchNumber ?? null, supplierNameAr: document.supplier?.nameAr ?? null, categoryNameAr: document.category.nameAr }))));
  }

  private async postDocument(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, raw: PurchaseExpenseRequest, requestId: string, batchId?: string): Promise<PurchaseExpenseReceipt> {
    const request = this.normalise(raw);
    await this.dates.assertNotFutureInTransaction(tx, context, request.businessDate);
    const category = await tx.financeCategory.findFirst({ where: { id: request.categoryId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceCategoryStatus.ACTIVE, isPosting: true, kind: request.kind }, include: { account: { select: { id: true, type: true, status: true } } } });
    if (!category?.account || category.account.status !== FinanceAccountStatus.ACTIVE || (category.account.type !== FinanceAccountType.ASSET && category.account.type !== FinanceAccountType.EXPENSE)) throw new BadRequestException('The selected category is not ready for financial posting.');
    if (request.supplierId && !await tx.financeSupplier.findFirst({ where: { id: request.supplierId, tenantId: context.tenantId, companyId: context.companyId, status: FinanceSupplierStatus.ACTIVE }, select: { id: true } })) throw new BadRequestException('The selected supplier is not active.');
    if (request.settlementKind === 'PAYABLE' && !request.supplierId) throw new BadRequestException('A supplier is required for a payable document.');
    if (request.settlementKind === 'PAID' && !request.allocations.length) throw new BadRequestException('Choose at least one payment destination.');
    const gross = new Prisma.Decimal(request.grossAmount); if (!gross.isFinite() || gross.lte(0)) throw new BadRequestException('The gross amount is invalid.');
    const profile = await tx.companyFinanceProfile.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId }, select: { vatAccountingEnabled: true, vatRateBasisPoints: true } });
    const rate = request.isTaxable && profile?.vatAccountingEnabled ? profile.vatRateBasisPoints : 0;
    const net = rate ? gross.mul(10_000).div(10_000 + rate).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP) : gross;
    const vat = gross.minus(net).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
    const day = request.businessDate.toISOString().slice(0, 10) as `${number}-${number}-${number}`;
    const sequence = await this.serials.reserveInTransaction(tx, context, { series: request.kind === 'PURCHASE' ? 'PURCHASE' : 'EXPENSE', businessDate: day });
    const documentNumber = `${request.kind === 'PURCHASE' ? 'PUR' : 'EXP'}-${day.replaceAll('-', '')}-${sequence.toString().padStart(4, '0')}`;
    const lines: { accountId: string; debitAmount?: string; creditAmount?: string; description?: string }[] = [{ accountId: category.account.id, debitAmount: net.toFixed(4), description: documentNumber }];
    if (!vat.isZero()) lines.push({ accountId: await this.account(tx, context, 'VAT_INPUT'), debitAmount: vat.toFixed(4), description: documentNumber });
    let allocations: { vaultId: string; grossAmount: string }[] = []; let supplierDueId: string | null = null;
    if (request.settlementKind === 'PAID') {
      const grouped = new Map<string, Prisma.Decimal>();
      for (const allocation of request.allocations) grouped.set(allocation.vaultId, (grouped.get(allocation.vaultId) ?? new Prisma.Decimal(0)).plus(allocation.grossAmount));
      const total = [...grouped.values()].reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0));
      if (!total.equals(gross)) throw new BadRequestException('Payment allocations must equal the gross amount.');
      allocations = [...grouped.entries()].map(([vaultId, value]) => ({ vaultId, grossAmount: value.toFixed(4) }));
      for (const allocation of allocations) { const vault = await this.vaults.assertActivePaymentDestination(tx, { ...context, vaultId: allocation.vaultId }); lines.push({ accountId: vault.accountId, creditAmount: allocation.grossAmount, description: documentNumber }); }
    } else { lines.push({ accountId: await this.account(tx, context, 'SUPPLIER_DUES'), creditAmount: gross.toFixed(4), description: documentNumber }); supplierDueId = randomUUID(); }
    const journal = await this.journals.postInTransaction(tx, { ...context, requestId, sourceType: 'finance_outflow_document', sourceReference: documentNumber, businessDate: request.businessDate, description: request.notes ?? documentNumber, lines });
    const documentId = randomUUID();
    await tx.financeOutflowDocument.create({ data: { id: documentId, tenantId: context.tenantId, companyId: context.companyId, ...(batchId ? { batchId } : {}), kind: request.kind, settlementKind: request.settlementKind, documentNumber, supplierId: request.supplierId ?? null, categoryId: request.categoryId, supplierInvoiceNumber: request.supplierInvoiceNumber ?? null, supplierInvoiceNumberNormalized: request.supplierInvoiceNumber?.toLocaleUpperCase('en-US') ?? null, supplierInvoiceMissingReason: request.supplierInvoiceMissingReason ?? null, businessDate: request.businessDate, supplierInvoiceDate: request.supplierInvoiceDate ?? null, grossAmount: gross, netAmount: net, vatAmount: vat, vatRateBasisPoints: rate, notes: request.notes ?? null, journalEntryId: journal.journalEntryId, createdByUserId: context.actorUserId } });
    if (allocations.length) await tx.financeOutflowAllocation.createMany({ data: allocations.map((allocation) => ({ id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, documentId, vaultId: allocation.vaultId, grossAmount: allocation.grossAmount })) });
    if (supplierDueId) await tx.financeSupplierDue.create({ data: { id: supplierDueId, tenantId: context.tenantId, companyId: context.companyId, supplierId: request.supplierId!, categoryId: request.categoryId, sourceDocumentNumber: documentNumber, originalBusinessDate: request.businessDate, originalAmount: gross, remainingAmount: gross, status: FinanceSupplierDueStatus.OPEN, notes: request.notes ?? null, journalEntryId: journal.journalEntryId } });
    const receipt: PurchaseExpenseReceipt = { documentId, documentNumber, journalEntryId: journal.journalEntryId, kind: request.kind, settlementKind: request.settlementKind, status: FinanceOutflowDocumentStatus.POSTED, grossAmount: gross.toFixed(4), netAmount: net.toFixed(4), vatAmount: vat.toFixed(4), supplierDueId };
    await tx.auditEvent.create({ data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, action: 'finance.purchase_expense.created', entityType: 'FinanceOutflowDocument', entityId: documentId, requestId, afterJson: receipt as unknown as Prisma.InputJsonValue } });
    return receipt;
  }

  private async account(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext, key: string) { const account = await tx.financeAccount.findFirst({ where: { tenantId: context.tenantId, companyId: context.companyId, systemKey: key, status: FinanceAccountStatus.ACTIVE }, select: { id: true } }); if (!account) throw new BadRequestException('The company financial setup is incomplete.'); return account.id; }
  private normalise(request: PurchaseExpenseRequest): PurchaseExpenseRequest { const invoice = request.supplierInvoiceNumber?.trim(); const missingReason = request.supplierInvoiceMissingReason?.trim(); if (!invoice && !missingReason) throw new BadRequestException('Provide the supplier invoice number or a missing reason.'); if (invoice && missingReason) throw new BadRequestException('Provide an invoice number or a missing reason, not both.'); if (request.supplierInvoiceDate && request.supplierInvoiceDate > request.businessDate) throw new BadRequestException('Supplier invoice date cannot be after the batch date.'); return { ...request, ...(invoice ? { supplierInvoiceNumber: invoice } : {}), ...(missingReason ? { supplierInvoiceMissingReason: missingReason } : {}), ...(request.notes?.trim() ? { notes: request.notes.trim() } : {}) }; }
  private normaliseBatch(request: PurchaseExpenseBatchRequest): PurchaseExpenseBatchRequest { if (!request.items.length || request.items.length > 25) throw new BadRequestException('A batch must contain from 1 to 25 invoices.'); const items = request.items.map((item) => { const { businessDate: _businessDate, ...normalised } = this.normalise({ ...item, businessDate: request.businessDate }); return normalised; }); const notes = request.notes?.trim(); return { businessDate: request.businessDate, items, ...(notes ? { notes } : {}) }; }
  private storeBatchReceipt(receipt: PurchaseExpenseBatchReceipt): StoredPurchaseExpenseBatchReceipt { return { ...receipt, businessDate: receipt.businessDate.toISOString() }; }
  private restoreBatchReceipt(value: unknown): PurchaseExpenseBatchReceipt { const stored = value as StoredPurchaseExpenseBatchReceipt; return { ...stored, businessDate: new Date(stored.businessDate) }; }
  private payload(request: PurchaseExpenseRequest) { return { kind: request.kind, settlementKind: request.settlementKind, categoryId: request.categoryId, supplierId: request.supplierId ?? null, supplierInvoiceNumber: request.supplierInvoiceNumber ?? null, supplierInvoiceMissingReason: request.supplierInvoiceMissingReason ?? null, businessDate: request.businessDate.toISOString(), supplierInvoiceDate: request.supplierInvoiceDate?.toISOString() ?? null, grossAmount: request.grossAmount, isTaxable: request.isTaxable, allocations: request.allocations.map((item) => ({ vaultId: item.vaultId, grossAmount: item.grossAmount })), notes: request.notes ?? null } as const; }
  private batchPayload(request: PurchaseExpenseBatchRequest) { return { businessDate: request.businessDate.toISOString(), notes: request.notes ?? null, items: request.items.map((item) => this.payload({ ...item, businessDate: request.businessDate })) } as const; }
}