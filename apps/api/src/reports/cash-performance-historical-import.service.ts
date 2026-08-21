import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceCashPerformanceDirection, FinanceCashPerformanceEventKind, FinanceDailySalesClosingStatus, FinanceJournalEntryStatus, FinanceSupplierDuePaymentStatus, FinanceVatSettlementStatus, Prisma } from '../generated/prisma/client.js';
import { FinanceCashPerformanceEventService } from '../finance/finance-cash-performance-event.service.js';
import { RequestContext } from '../observability/request-context.js';

const SOURCE_KIND = 'daily_sales_closing_v1';
const IMPORT_POLICY_VERSION = 'PERSONAL_CASH_PERFORMANCE_HISTORICAL_DAILY_SALES_IMPORT_V1';
const PAYROLL_SOURCE_KIND = 'hr_payroll_payment_backfill_v1';
const PAYROLL_BACKFILL_POLICY_VERSION = 'PERSONAL_CASH_PERFORMANCE_PAYROLL_PAYMENT_BACKFILL_V1';

/**
 * A deliberately narrow, auditable import. It recreates events only from
 * posted daily-sales documents whose allocations and sealed journal entry are
 * still available. It refuses to widen coverage when another supported cash
 * source is present but cannot be reconstructed by this importer.
 */
@Injectable()
export class CashPerformanceHistoricalImportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly cashEvents: FinanceCashPerformanceEventService,
  ) {}

  async importDailySales(context: TrustedCompanyActorContext, coverageStartBusinessDate: Date, reason: string) {
    assertBusinessDate(coverageStartBusinessDate);
    const normalizedReason = reason.trim();
    if (!normalizedReason || normalizedReason.length > 500) throw new BadRequestException('A historical-import reason is required.');

    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:cash-performance-historical-import`}, 0))`;
      const coverage = await transaction.financeCashPerformanceCoverage.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        select: { coverageStartBusinessDate: true },
      });
      if (!coverage) throw new ConflictException('Cash-performance coverage must be activated before a historical import.');
      if (coverageStartBusinessDate >= coverage.coverageStartBusinessDate) throw new BadRequestException('Historical import coverage must begin before the active coverage declaration.');

      const previous = await transaction.financeCashPerformanceHistoricalImport.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, sourceKind: SOURCE_KIND, coverageStartBusinessDate },
        select: { id: true, importedEventCount: true, checksum: true, importedAt: true },
      });
      if (previous) return { ...previous, coverageStartBusinessDate, replayed: true };

      const [paidOutflows, supplierPayments, vatSettlements] = await Promise.all([
        transaction.financeOutflowDocument.count({ where: { tenantId: context.tenantId, companyId: context.companyId, settlementKind: 'PAID', businessDate: { gte: coverageStartBusinessDate, lt: coverage.coverageStartBusinessDate } } }),
        transaction.financeSupplierDuePayment.count({ where: { tenantId: context.tenantId, companyId: context.companyId, status: FinanceSupplierDuePaymentStatus.POSTED, businessDate: { gte: coverageStartBusinessDate, lt: coverage.coverageStartBusinessDate } } }),
        transaction.financeVatSettlement.count({ where: { tenantId: context.tenantId, companyId: context.companyId, status: FinanceVatSettlementStatus.POSTED, businessDate: { gte: coverageStartBusinessDate, lt: coverage.coverageStartBusinessDate } } }),
      ]);
      if (paidOutflows || supplierPayments || vatSettlements) {
        throw new ConflictException('Historical coverage contains a supported payment source that this daily-sales importer cannot reconstruct.');
      }

      const closings = await transaction.financeDailySalesClosing.findMany({
        where: {
          tenantId: context.tenantId, companyId: context.companyId,
          businessDate: { gte: coverageStartBusinessDate, lt: coverage.coverageStartBusinessDate },
          status: FinanceDailySalesClosingStatus.POSTED,
        },
        orderBy: [{ businessDate: 'asc' }, { id: 'asc' }],
        select: {
          id: true, businessDate: true, grossAmount: true, netAmount: true, vatAmount: true, journalEntryId: true,
          journalEntry: { select: { isSealed: true, status: true, ledgerRevision: true } },
          allocations: { select: { vaultId: true, grossAmount: true, vault: { select: { paymentMethod: true } } } },
        },
      });
      const journalIds = closings.map((closing) => closing.journalEntryId);
      const existing = journalIds.length ? await transaction.financeCashPerformanceEvent.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, sourceJournalEntryId: { in: journalIds } },
        select: { sourceJournalEntryId: true },
      }) : [];
      if (existing.length) throw new ConflictException('A selected historical sales journal already has cash-performance evidence.');

      for (const closing of closings) {
        const allocated = closing.allocations.reduce((sum, allocation) => sum.plus(allocation.grossAmount), new Prisma.Decimal(0));
        if (!closing.journalEntry.isSealed || closing.journalEntry.status !== FinanceJournalEntryStatus.POSTED || closing.journalEntry.ledgerRevision <= 0n || !allocated.equals(closing.grossAmount)) {
          throw new ConflictException('A historical daily-sales source is not sealed, posted, or allocation-reconciled.');
        }
      }
      for (const closing of closings) {
        await this.cashEvents.recordInTransaction(transaction, context, {
          kind: FinanceCashPerformanceEventKind.SALES_COLLECTION,
          direction: FinanceCashPerformanceDirection.INFLOW,
          businessDate: closing.businessDate,
          grossAmount: closing.grossAmount,
          netAmount: closing.netAmount,
          vatAmount: closing.vatAmount,
          sourceType: 'daily_sales_closing',
          sourceId: closing.id,
          sourceJournalEntryId: closing.journalEntryId,
          ledgerRevision: closing.journalEntry.ledgerRevision,
          destinations: closing.allocations.map((allocation) => ({ vaultId: allocation.vaultId, amount: allocation.grossAmount.toFixed(4), paymentMethod: allocation.vault.paymentMethod })),
        });
      }
      const checksum = importChecksum(coverageStartBusinessDate, coverage.coverageStartBusinessDate, closings);
      const id = randomUUID();
      const importedAt = new Date();
      await transaction.financeCashPerformanceHistoricalImport.create({
        data: {
          id, tenantId: context.tenantId, companyId: context.companyId,
          coverageStartBusinessDate, sourceKind: SOURCE_KIND, importedEventCount: closings.length,
          checksum, reason: normalizedReason, importedByUserId: context.actorUserId, importedAt,
        },
      });
      await transaction.auditEvent.create({
        data: {
          id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId,
          requestId: RequestContext.correlationId() ?? randomUUID(),
          action: 'reports.cash_performance.historical_daily_sales_imported', entityType: 'FinanceCashPerformanceHistoricalImport', entityId: id,
          afterJson: { policyVersion: IMPORT_POLICY_VERSION, coverageStartBusinessDate: dateText(coverageStartBusinessDate), previousCoverageStartBusinessDate: dateText(coverage.coverageStartBusinessDate), importedEventCount: closings.length, checksum } as Prisma.InputJsonValue,
        },
      });
      return { id, coverageStartBusinessDate, importedEventCount: closings.length, checksum, importedAt, replayed: false };
    });
  }

  /** Repairs the event-model gap for already-posted payroll payments. The
   * payment itself remains the source; this never invents a payment from an
   * accrued payroll liability or an account balance. */
  async backfillPayrollPayments(context: TrustedCompanyActorContext, reason: string) {
    const normalizedReason = reason.trim();
    if (!normalizedReason || normalizedReason.length > 500) throw new BadRequestException('A payroll-payment backfill reason is required.');

    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${context.tenantId}:${context.companyId}:cash-performance-payroll-backfill`}, 0))`;
      const coverage = await transaction.financeCashPerformanceCoverage.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        select: { coverageStartBusinessDate: true },
      });
      if (!coverage) throw new ConflictException('Cash-performance coverage must be activated before payroll-payment backfill.');
      const previous = await transaction.financeCashPerformanceHistoricalImport.findFirst({
        where: { tenantId: context.tenantId, companyId: context.companyId, sourceKind: PAYROLL_SOURCE_KIND, coverageStartBusinessDate: coverage.coverageStartBusinessDate },
        select: { id: true, importedEventCount: true, checksum: true, importedAt: true },
      });
      if (previous) return { ...previous, coverageStartBusinessDate: coverage.coverageStartBusinessDate, replayed: true };

      const payments = await transaction.hrPayrollPayment.findMany({
        where: {
          tenantId: context.tenantId, companyId: context.companyId,
          businessDate: { gte: coverage.coverageStartBusinessDate },
          journalEntry: { isSealed: true, status: FinanceJournalEntryStatus.POSTED, ledgerRevision: { gt: 0n } },
        },
        orderBy: [{ businessDate: 'asc' }, { id: 'asc' }],
        select: {
          id: true, paymentNumber: true, businessDate: true, amount: true, journalEntryId: true,
          journalEntry: { select: { ledgerRevision: true } },
          allocations: { select: { vaultId: true, amount: true, paymentMethod: true } },
        },
      });
      const existing = payments.length ? await transaction.financeCashPerformanceEvent.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, sourceJournalEntryId: { in: payments.map((payment) => payment.journalEntryId) } },
        select: { sourceJournalEntryId: true },
      }) : [];
      const existingJournalIds = new Set(existing.map((event) => event.sourceJournalEntryId));
      const missing = payments.filter((payment) => !existingJournalIds.has(payment.journalEntryId));
      for (const payment of missing) {
        const allocated = payment.allocations.reduce((sum, allocation) => sum.plus(allocation.amount), new Prisma.Decimal(0));
        if (!allocated.equals(payment.amount)) throw new ConflictException('A payroll payment is not allocation-reconciled and cannot be backfilled.');
        await this.cashEvents.recordInTransaction(transaction, context, {
          kind: FinanceCashPerformanceEventKind.OPERATING_EXPENSE_PAYMENT,
          direction: 'OUTFLOW', businessDate: payment.businessDate,
          grossAmount: payment.amount, netAmount: payment.amount, vatAmount: '0.0000',
          sourceType: 'hr_payroll_payment', sourceId: payment.id, sourceJournalEntryId: payment.journalEntryId, ledgerRevision: payment.journalEntry.ledgerRevision,
          category: { code: 'PAYROLL', nameAr: 'الرواتب المدفوعة', nameEn: 'Paid payroll', kind: 'EXPENSE' },
          destinations: payment.allocations.map((allocation) => ({ vaultId: allocation.vaultId, amount: allocation.amount.toFixed(4), paymentMethod: allocation.paymentMethod })),
        });
      }
      const checksum = payrollChecksum(coverage.coverageStartBusinessDate, missing);
      const id = randomUUID(); const importedAt = new Date();
      await transaction.financeCashPerformanceHistoricalImport.create({
        data: { id, tenantId: context.tenantId, companyId: context.companyId, coverageStartBusinessDate: coverage.coverageStartBusinessDate, sourceKind: PAYROLL_SOURCE_KIND, importedEventCount: missing.length, checksum, reason: normalizedReason, importedByUserId: context.actorUserId, importedAt },
      });
      await transaction.auditEvent.create({
        data: { id: randomUUID(), tenantId: context.tenantId, companyId: context.companyId, actorUserId: context.actorUserId, requestId: RequestContext.correlationId() ?? randomUUID(), action: 'reports.cash_performance.payroll_payments_backfilled', entityType: 'FinanceCashPerformanceHistoricalImport', entityId: id, afterJson: { policyVersion: PAYROLL_BACKFILL_POLICY_VERSION, coverageStartBusinessDate: dateText(coverage.coverageStartBusinessDate), importedEventCount: missing.length, checksum } as Prisma.InputJsonValue },
      });
      return { id, coverageStartBusinessDate: coverage.coverageStartBusinessDate, importedEventCount: missing.length, checksum, importedAt, replayed: false };
    });
  }
}

function importChecksum(start: Date, priorStart: Date, closings: readonly { id: string; journalEntryId: string; businessDate: Date; grossAmount: Prisma.Decimal; netAmount: Prisma.Decimal; vatAmount: Prisma.Decimal; journalEntry: { ledgerRevision: bigint } }[]) {
  return createHash('sha256').update(JSON.stringify({ policy: IMPORT_POLICY_VERSION, start: dateText(start), priorStart: dateText(priorStart), closings: closings.map((closing) => ({ id: closing.id, journalEntryId: closing.journalEntryId, businessDate: dateText(closing.businessDate), grossAmount: closing.grossAmount.toFixed(4), netAmount: closing.netAmount.toFixed(4), vatAmount: closing.vatAmount.toFixed(4), ledgerRevision: closing.journalEntry.ledgerRevision.toString() })) })).digest('hex');
}
function payrollChecksum(start: Date, payments: readonly { id: string; paymentNumber: string; businessDate: Date; amount: Prisma.Decimal; journalEntryId: string; journalEntry: { ledgerRevision: bigint } }[]) {
  return createHash('sha256').update(JSON.stringify({ policy: PAYROLL_BACKFILL_POLICY_VERSION, start: dateText(start), payments: payments.map((payment) => ({ id: payment.id, paymentNumber: payment.paymentNumber, businessDate: dateText(payment.businessDate), amount: payment.amount.toFixed(4), journalEntryId: payment.journalEntryId, ledgerRevision: payment.journalEntry.ledgerRevision.toString() })) })).digest('hex');
}
function assertBusinessDate(value: Date) { if (!(value instanceof Date) || Number.isNaN(value.valueOf()) || value.getUTCHours() !== 0 || value.getUTCMinutes() !== 0 || value.getUTCSeconds() !== 0 || value.getUTCMilliseconds() !== 0) throw new BadRequestException('A valid business date is required.'); }
function dateText(value: Date) { return value.toISOString().slice(0, 10); }
