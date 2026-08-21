import { randomUUID } from "node:crypto";

import { ConflictException, Injectable, NotFoundException } from "@nestjs/common";

import { DocumentSerialService } from "../core-controls/document-serial.service.js";
import type { TrustedCompanyActorContext } from "../core-controls/trusted-context.js";
import {
  FinanceDailySalesClosingScope,
  FinanceDailySalesClosingStatus,
  FinanceCashPerformanceDirection,
  FinanceCashPerformanceEventKind,
  Prisma,
} from "../generated/prisma/client.js";
import { DailySalesProjectionService } from "./daily-sales-projection.service.js";
import {
  DailySalesPostingService,
  type DailySalesAccounting,
  type ValidatedDailySalesFields,
} from "./daily-sales-posting.service.js";
import { JournalPostingService } from "./journal/journal-posting.service.js";
import { DailySalesCommandSupportService } from "./daily-sales-command-support.service.js";
import { FinanceCashPerformanceEventService } from './finance-cash-performance-event.service.js';
import {
  DAILY_SALES_SERIAL_SERIES,
  type CreateDailySalesClosingRequest,
  type CorrectDailySalesClosingRequest,
  type DailySalesClosingReceipt,
  type DailySalesClosingReversalReceipt,
  type ReverseDailySalesClosingRequest,
} from "./daily-sales.types.js";

@Injectable()
export class DailySalesWriteService {
  constructor(
    private readonly serials: DocumentSerialService,
    private readonly journals: JournalPostingService,
    private readonly projections: DailySalesProjectionService,
    private readonly posting: DailySalesPostingService,
    private readonly support: DailySalesCommandSupportService,
    private readonly cashEvents: FinanceCashPerformanceEventService,
  ) {}
  async createInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: CreateDailySalesClosingRequest,
    requestId: string,
  ): Promise<DailySalesClosingReceipt> {
    const fields = await this.posting.validateFields(
      transaction,
      context,
      request,
    );
    await this.posting.assertOpenPeriodAndNotFuture(
      transaction,
      context,
      fields.businessDate,
    );
    await this.support.lockScope(
      transaction,
      context,
      fields.businessDate,
      fields.scope,
    );
    await this.support.lockBusinessDate(transaction, context, fields.businessDate);
    await this.support.assertScopeCombination(transaction, context, fields.businessDate, fields.scope);
    await this.posting.assertOperationalDayAllowsClosing(
      transaction,
      context,
      fields.businessDate,
    );
    const duplicate = await transaction.financeDailySalesClosing.findFirst({
      where: {
        tenantId: context.tenantId,
        companyId: context.companyId,
        businessDate: fields.businessDate,
        scope: fields.scope,
      },
      select: { id: true },
    });
    if (duplicate)
      throw new ConflictException(
        "A daily sales closing already exists for this business date and scope.",
      );

    const accounting = await this.posting.resolveAccounting(
      transaction,
      context,
      fields.grossAmount,
    );
    const closingId = randomUUID();
    const serial = await this.serials.reserveInTransaction(
      transaction,
      context,
      {
        series: DAILY_SALES_SERIAL_SERIES,
        businessDate: this.support.sqlDateValue(fields.businessDate),
      },
    );
    const documentNumber = `DS-${this.support.dateValue(fields.businessDate).replaceAll("-", "")}-${serial.toString().padStart(4, "0")}`;
    const journal = await this.posting.postJournal(transaction, context, {
      closingId,
      version: 1,
      documentNumber,
      requestId,
      fields,
      accounting,
    });
    await transaction.financeDailySalesClosing.create({
      data: {
        id: closingId,
        tenantId: context.tenantId,
        companyId: context.companyId,
        businessDate: fields.businessDate,
        scope: fields.scope,
        documentNumber,
        postingVersion: 1,
        grossAmount: fields.grossAmount,
        netAmount: accounting.netAmount,
        vatAmount: accounting.vatAmount,
        vatRateBasisPoints: accounting.vatRateBasisPoints,
        customerCount: fields.customerCount,
        cashHandoverAmount: fields.cashHandoverAmount,
        cashHandoverVaultId: fields.cashHandoverVaultId,
        notes: fields.notes,
        status: FinanceDailySalesClosingStatus.POSTED,
        journalEntryId: journal.journalEntryId,
        sourceSystem: "BASEER",
        sourceReference: closingId,
        sourceChecksum: this.support.checksumFor(fields, accounting),
        createdByUserId: context.actorUserId,
      },
    });
    await transaction.financeDailySalesAllocation.createMany({
      data: fields.allocations.map((allocation) => ({
        id: randomUUID(),
        tenantId: context.tenantId,
        companyId: context.companyId,
        closingId,
        vaultId: allocation.vaultId,
        grossAmount: allocation.grossAmount,
      })),
    });
    await this.cashEvents.recordInTransaction(transaction, context, {
      kind: FinanceCashPerformanceEventKind.SALES_COLLECTION,
      direction: FinanceCashPerformanceDirection.INFLOW,
      businessDate: fields.businessDate, grossAmount: fields.grossAmount, netAmount: accounting.netAmount, vatAmount: accounting.vatAmount,
      sourceType: 'daily_sales_closing', sourceId: closingId, sourceJournalEntryId: journal.journalEntryId, ledgerRevision: journal.ledgerRevision,
      destinations: fields.allocations.map((allocation) => ({ vaultId: allocation.vaultId, amount: allocation.grossAmount.toFixed(4), paymentMethod: allocation.paymentMethod })),
    });
    await this.projections.rebuildInTransaction(transaction, context, {
      businessDate: fields.businessDate,
      requestId,
    });
    const receipt = this.support.receipt({
      closingId,
      documentNumber,
      postingVersion: 1,
      journalEntryId: journal.journalEntryId,
      fields,
      accounting,
      status: FinanceDailySalesClosingStatus.POSTED,
    });
    await this.support.audit(
      transaction,
      context,
      requestId,
      "finance.daily_sales.created",
      closingId,
      null,
      this.support.serialiseReceipt(receipt),
    );
    return receipt;
  }

  async correctInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: CorrectDailySalesClosingRequest,
    requestId: string,
  ): Promise<DailySalesClosingReceipt> {
    const closingId = this.support.requiredText(
      request.closingId,
      "A daily sales closing is required.",
      36,
    );
    await this.support.lockClosing(transaction, context, closingId);
    const closing = await transaction.financeDailySalesClosing.findFirst({
      where: {
        id: closingId,
        tenantId: context.tenantId,
        companyId: context.companyId,
      },
      include: { allocations: { orderBy: { vaultId: "asc" } } },
    });
    if (!closing)
      throw new NotFoundException(
        "The daily sales closing was not found for this company.",
      );
    if (closing.status !== FinanceDailySalesClosingStatus.POSTED)
      throw new ConflictException(
        "Only an active daily sales closing can be corrected.",
      );
    await this.posting.assertOpenPeriodAndNotFuture(
      transaction,
      context,
      closing.businessDate,
    );

    const fields = await this.posting.validateFields(transaction, context, {
      ...request,
      businessDate: closing.businessDate,
      scope: closing.scope,
    });
    await this.posting.assertOperationalDayAllowsClosing(
      transaction,
      context,
      closing.businessDate,
    );
    const accounting = await this.posting.resolveAccounting(
      transaction,
      context,
      fields.grossAmount,
    );
    const before = this.support.closingSnapshot(closing);
    const reversed = await this.journals.reverseInTransaction(transaction, {
      tenantId: context.tenantId,
      companyId: context.companyId,
      actorUserId: context.actorUserId,
      requestId,
      journalEntryId: closing.journalEntryId,
      businessDate: closing.businessDate,
      reason: "Daily sales closing corrected while fiscal period is open.",
    });
    await this.cashEvents.recordReversalForJournalInTransaction(transaction, context, {
      originalJournalEntryId: closing.journalEntryId, reversalJournalEntryId: reversed.journalEntryId,
      reversalLedgerRevision: reversed.ledgerRevision, businessDate: closing.businessDate,
      sourceType: 'daily_sales_closing_reversal', sourceId: closing.id,
    });
    const postingVersion = closing.postingVersion + 1;
    const journal = await this.posting.postJournal(transaction, context, {
      closingId,
      version: postingVersion,
      documentNumber: closing.documentNumber,
      requestId,
      fields,
      accounting,
    });
    await transaction.financeDailySalesAllocation.deleteMany({
      where: {
        tenantId: context.tenantId,
        companyId: context.companyId,
        closingId,
      },
    });
    await transaction.financeDailySalesClosing.update({
      where: { id: closing.id },
      data: {
        postingVersion,
        grossAmount: fields.grossAmount,
        netAmount: accounting.netAmount,
        vatAmount: accounting.vatAmount,
        vatRateBasisPoints: accounting.vatRateBasisPoints,
        customerCount: fields.customerCount,
        cashHandoverAmount: fields.cashHandoverAmount,
        cashHandoverVaultId: fields.cashHandoverVaultId,
        notes: fields.notes,
        journalEntryId: journal.journalEntryId,
        sourceChecksum: this.support.checksumFor(fields, accounting),
      },
    });
    await transaction.financeDailySalesAllocation.createMany({
      data: fields.allocations.map((allocation) => ({
        id: randomUUID(),
        tenantId: context.tenantId,
        companyId: context.companyId,
        closingId,
        vaultId: allocation.vaultId,
        grossAmount: allocation.grossAmount,
      })),
    });
    await this.cashEvents.recordInTransaction(transaction, context, {
      kind: FinanceCashPerformanceEventKind.SALES_COLLECTION,
      direction: FinanceCashPerformanceDirection.INFLOW,
      businessDate: closing.businessDate, grossAmount: fields.grossAmount, netAmount: accounting.netAmount, vatAmount: accounting.vatAmount,
      sourceType: 'daily_sales_closing', sourceId: closingId, sourceJournalEntryId: journal.journalEntryId, ledgerRevision: journal.ledgerRevision,
      destinations: fields.allocations.map((allocation) => ({ vaultId: allocation.vaultId, amount: allocation.grossAmount.toFixed(4), paymentMethod: allocation.paymentMethod })),
    });
    await this.projections.rebuildInTransaction(transaction, context, {
      businessDate: closing.businessDate,
      requestId,
    });
    const receipt = this.support.receipt({
      closingId,
      documentNumber: closing.documentNumber,
      postingVersion,
      journalEntryId: journal.journalEntryId,
      fields,
      accounting,
      status: FinanceDailySalesClosingStatus.POSTED,
    });
    await this.support.audit(
      transaction,
      context,
      requestId,
      "finance.daily_sales.corrected",
      closingId,
      before,
      {
        receipt: this.support.serialiseReceipt(receipt),
        reversedJournalEntryId: reversed.journalEntryId,
      },
    );
    return receipt;
  }

  async reverseInTransaction(
    transaction: Prisma.TransactionClient,
    context: TrustedCompanyActorContext,
    request: ReverseDailySalesClosingRequest,
    requestId: string,
  ): Promise<DailySalesClosingReversalReceipt> {
    const closingId = this.support.requiredText(
      request.closingId,
      "A daily sales closing is required.",
      36,
    );
    const businessDate = this.support.requiredDate(
      request.businessDate,
      "A reversal business date is required.",
    );
    const reason = this.support.requiredText(
      request.reason,
      "A reversal reason is required.",
      1_000,
    );
    await this.posting.assertOpenPeriodAndNotFuture(
      transaction,
      context,
      businessDate,
    );
    await this.support.lockClosing(transaction, context, closingId);
    const closing = await transaction.financeDailySalesClosing.findFirst({
      where: {
        id: closingId,
        tenantId: context.tenantId,
        companyId: context.companyId,
      },
      select: {
        id: true,
        businessDate: true,
        documentNumber: true,
        journalEntryId: true,
        status: true,
      },
    });
    if (!closing)
      throw new NotFoundException(
        "The daily sales closing was not found for this company.",
      );
    if (closing.status !== FinanceDailySalesClosingStatus.POSTED)
      throw new ConflictException(
        "The daily sales closing is already reversed.",
      );
    const journal = await this.journals.reverseInTransaction(transaction, {
      tenantId: context.tenantId,
      companyId: context.companyId,
      actorUserId: context.actorUserId,
      requestId,
      journalEntryId: closing.journalEntryId,
      businessDate,
      reason,
    });
    await this.cashEvents.recordReversalForJournalInTransaction(transaction, context, {
      originalJournalEntryId: closing.journalEntryId, reversalJournalEntryId: journal.journalEntryId,
      reversalLedgerRevision: journal.ledgerRevision, businessDate,
      sourceType: 'daily_sales_closing_reversal', sourceId: closing.id,
    });
    const updated = await transaction.financeDailySalesClosing.updateMany({
      where: {
        id: closing.id,
        tenantId: context.tenantId,
        companyId: context.companyId,
        status: FinanceDailySalesClosingStatus.POSTED,
      },
      data: { status: FinanceDailySalesClosingStatus.REVERSED },
    });
    if (updated.count !== 1)
      throw new ConflictException(
        "The daily sales closing changed while it was being reversed.",
      );
    await this.projections.rebuildInTransaction(transaction, context, {
      businessDate: closing.businessDate,
      requestId,
    });
    const receipt: DailySalesClosingReversalReceipt = {
      closingId: closing.id,
      documentNumber: closing.documentNumber,
      originalJournalEntryId: closing.journalEntryId,
      reversalJournalEntryId: journal.journalEntryId,
      status: "REVERSED",
    };
    await this.support.audit(
      transaction,
      context,
      requestId,
      "finance.daily_sales.reversed",
      closing.id,
      null,
      receipt,
    );
    return receipt;
  }


}
