import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { Prisma } from '../generated/prisma/client.js';

type HistoricalPayrollQuery = Readonly<{
  cursor?: string;
  pageSize: number;
  periodFrom?: Date;
  periodTo?: Date;
  search?: string;
}>;
type HistoricalPayrollDetailQuery = Readonly<{ lineCursor?: string; linePageSize: number }>;

/**
 * Read model for migrated Noorix payroll evidence.
 *
 * It intentionally has no dependency on HrPayrollService and never reads or
 * writes HrPayrollRun, payment, journal, or employee-financial-movement data.
 * The separate endpoint contract makes an evidence id unusable by operational
 * payroll commands.
 */
@Injectable()
export class HrHistoricalPayrollEvidenceReadService {
  constructor(private readonly database: DatabaseService) {}

  async list(context: TrustedCompanyActorContext, query: HistoricalPayrollQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.assertNoDuplicateSourceRuns(tx, context);
      const baseWhere: Prisma.NurixHistoricalPayrollEvidenceWhereInput = {
        tenantId: context.tenantId,
        companyId: context.companyId,
        status: 'EVIDENCE_ONLY',
        ...(query.periodFrom ? { payrollMonth: { gte: query.periodFrom } } : {}),
        ...(query.periodTo ? { payrollMonth: { lte: query.periodTo } } : {}),
        ...(query.search ? { sourceRunNumber: { contains: query.search, mode: 'insensitive' } } : {}),
      };
      const cursor = query.cursor
        ? await tx.nurixHistoricalPayrollEvidence.findFirst({
          where: { id: query.cursor, ...baseWhere },
          select: { id: true, payrollMonth: true },
        })
        : null;
      if (query.cursor && !cursor) throw new NotFoundException('Historical payroll evidence cursor was not found.');

      const [rows, aggregate] = await Promise.all([tx.nurixHistoricalPayrollEvidence.findMany({
        where: {
          ...baseWhere,
          ...(cursor ? { OR: [{ payrollMonth: { lt: cursor.payrollMonth } }, { payrollMonth: cursor.payrollMonth, id: { lt: cursor.id } }] } : {}),
        },
        orderBy: [{ payrollMonth: 'desc' }, { id: 'desc' }],
        take: query.pageSize + 1,
        select: headerSelect,
      }), tx.nurixHistoricalPayrollEvidence.aggregate({
        where: baseWhere,
        _count: { id: true },
        _sum: { grossAmount: true, deductionsAmount: true, appliedAdvancesAmount: true, netAmount: true },
      })]);
      const hasMore = rows.length > query.pageSize;
      if (hasMore) throw new ConflictException('Historical payroll evidence exceeds the safe read-only display limit; the archive view must be extended before it can be shown completely.');
      const page = hasMore ? rows.slice(0, query.pageSize) : rows;
      return {
        payrollRuns: page.map(mapHeader),
        summary: {
          count: aggregate._count.id,
          grossAmount: fixedOrZero(aggregate._sum.grossAmount),
          deductionsAmount: fixedOrZero(aggregate._sum.deductionsAmount),
          advancesAmount: fixedOrZero(aggregate._sum.appliedAdvancesAmount),
          netAmount: fixedOrZero(aggregate._sum.netAmount),
        },
      };
    });
  }

  async detail(context: TrustedCompanyActorContext, evidenceId: string, query: HistoricalPayrollDetailQuery) {
    return this.database.inTenantTransaction(context.tenantId, async (tx) => {
      await this.assertNoDuplicateSourceRuns(tx, context);
      const evidence = await tx.nurixHistoricalPayrollEvidence.findFirst({
        where: { id: evidenceId, tenantId: context.tenantId, companyId: context.companyId, status: 'EVIDENCE_ONLY' },
        select: headerSelect,
      });
      if (!evidence) throw new NotFoundException('Historical payroll evidence was not found.');

      const lineCursor = query.lineCursor
        ? await tx.nurixHistoricalPayrollLineEvidence.findFirst({
          where: { id: query.lineCursor, tenantId: context.tenantId, companyId: context.companyId, runEvidenceId: evidenceId },
          select: { id: true },
        })
        : null;
      if (query.lineCursor && !lineCursor) throw new NotFoundException('Historical payroll evidence line cursor was not found.');

      const lines = await tx.nurixHistoricalPayrollLineEvidence.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          runEvidenceId: evidenceId,
          ...(lineCursor ? { id: { lt: lineCursor.id } } : {}),
        },
        orderBy: { id: 'desc' },
        take: query.linePageSize + 1,
        select: {
          id: true,
          employeeId: true,
          grossSalary: true,
          allowancesAdd: true,
          deductionsAmount: true,
          sourceAdvancesAmount: true,
          appliedAdvancesAmount: true,
          advanceCarryoverEvidence: true,
          netSalary: true,
        },
      });
      const hasMoreLines = lines.length > query.linePageSize;
      if (hasMoreLines) throw new ConflictException('Historical payroll lines exceed the safe read-only display limit; the archive view must be extended before it can be shown completely.');
      const page = hasMoreLines ? lines.slice(0, query.linePageSize) : lines;
      const employeeIds = page.flatMap((line) => line.employeeId ? [line.employeeId] : []);
      const employees = employeeIds.length
        ? await tx.hrEmployee.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, id: { in: employeeIds } },
          select: { id: true, employeeNumber: true, nameAr: true, nameEn: true },
        })
        : [];
      const employeeById = new Map(employees.map((employee) => [employee.id, employee]));

      const payrollRun = mapHeader(evidence);
      const invoiceEvidence = evidence.accountingEvidence.find((item) => item.evidenceKind === 'PAYROLL_INVOICE') ?? null;
      const ledgerEvidence = evidence.accountingEvidence.filter((item) => item.evidenceKind === 'JOURNAL_ENTRY');
      const vaultEvidence = evidence.accountingEvidence.filter((item) => item.evidenceKind === 'VAULT_ALLOCATION');
      return {
        payrollRun,
        lines: page.map((line) => {
          const employee = line.employeeId ? employeeById.get(line.employeeId) : undefined;
          return {
            id: line.id,
            employeeId: employee?.id ?? null,
            employeeNumber: employee?.employeeNumber ?? null,
            employeeNameAr: employee?.nameAr ?? 'موظف نوركس غير مطابق',
            employeeNameEn: employee?.nameEn ?? null,
            grossSalary: fixed(line.grossSalary),
            deductionsAmount: fixed(line.deductionsAmount),
            advancesAmount: fixed(line.appliedAdvancesAmount),
            netAmount: fixed(line.netSalary),
            notes: null,
          };
        }),
        invoice: invoiceEvidence ? {
          id: invoiceEvidence.id,
          number: invoiceEvidence.sourceNumber ?? invoiceEvidence.sourceRecordId,
          transactionDate: dateOrFallback(invoiceEvidence.sourceDate, evidence.payrollMonth),
          amount: fixedOrZero(invoiceEvidence.amount),
          status: 'SOURCE_EVIDENCE_ONLY',
        } : null,
        ledgerEntries: ledgerEvidence.map((item) => ({
          id: item.id,
          reference: item.sourceNumber ?? item.sourceRecordId,
          transactionDate: dateOrFallback(item.sourceDate, evidence.payrollMonth),
          postedAt: item.sourceDate ? ymd(item.sourceDate) : null,
          amount: fixedOrZero(item.amount),
          status: 'SOURCE_EVIDENCE_ONLY',
          vaultNameAr: null,
          vaultNameEn: null,
        })),
        vaultAllocations: vaultEvidence.map((item) => ({
          id: item.id,
          vaultNameAr: sourceVaultNameAr(item.vaultSourceId),
          vaultNameEn: sourceVaultNameEn(item.vaultSourceId),
          amount: fixedOrZero(item.amount),
        })),
      };
    });
  }

  private async assertNoDuplicateSourceRuns(tx: Prisma.TransactionClient, context: TrustedCompanyActorContext) {
    const rows = await tx.nurixHistoricalPayrollEvidence.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId, status: 'EVIDENCE_ONLY' },
      select: { sourceCompanyId: true, sourceRunId: true, sourceChecksum: true },
    });
    const seen = new Map<string, string>();
    for (const row of rows) {
      const key = `${row.sourceCompanyId}:${row.sourceRunId}`;
      const existing = seen.get(key);
      if (existing) throw new ConflictException(existing === row.sourceChecksum
        ? 'Historical payroll evidence has a duplicate source run.'
        : 'Historical payroll evidence has conflicting source run checksums.');
      seen.set(key, row.sourceChecksum);
    }
  }
}

const headerSelect = {
  id: true,
  sourceRunNumber: true,
  payrollMonth: true,
  sourceAccruedAt: true,
  sourceStatus: true,
  employeeCount: true,
  grossAmount: true,
  deductionsAmount: true,
  sourceAdvancesAmount: true,
  appliedAdvancesAmount: true,
  advanceCarryoverEvidenceAmount: true,
  netAmount: true,
  paymentEvidenceKind: true,
  paymentEvidenceAmount: true,
  paymentEvidenceAt: true,
  sourceInvoiceEvidence: true,
  sourceJournalEvidence: true,
  status: true,
  accountingEvidence: {
    orderBy: { id: 'asc' },
    select: { id: true, evidenceKind: true, sourceRecordId: true, sourceNumber: true, sourceDate: true, vaultSourceId: true, amount: true },
  },
} satisfies Prisma.NurixHistoricalPayrollEvidenceSelect;

function mapHeader(value: Prisma.NurixHistoricalPayrollEvidenceGetPayload<{ select: typeof headerSelect }>) {
  return {
    id: value.id,
    runNumber: value.sourceRunNumber,
    payrollMonth: ymd(value.payrollMonth),
    sourceTransactionDate: sourceTransactionDate(value),
    sourcePostedAt: sourcePostedAt(value),
    sourceStatus: value.sourceStatus,
    employeeCount: value.employeeCount,
    grossAmount: fixed(value.grossAmount),
    deductionsAmount: fixed(value.deductionsAmount),
    advancesAmount: fixed(value.appliedAdvancesAmount),
    netAmount: fixed(value.netAmount),
    invoiceNumber: value.accountingEvidence.find((item) => item.evidenceKind === 'PAYROLL_INVOICE')?.sourceNumber ?? null,
    invoiceStatus: value.sourceInvoiceEvidence === 'PRESENT' ? 'SOURCE_EVIDENCE_ONLY' : null,
    ledgerEntryCount: value.accountingEvidence.filter((item) => item.evidenceKind === 'JOURNAL_ENTRY').length,
    vaultAllocationCount: value.accountingEvidence.filter((item) => item.evidenceKind === 'VAULT_ALLOCATION').length,
    historicalStatus: historicalStatus(value),
    targetFinancialStatus: 'NOT_POSTED_IN_BASEER' as const,
  };
}

function fixed(value: Prisma.Decimal) { return value.toFixed(4); }
function fixedOrZero(value: Prisma.Decimal | null) { return value ? fixed(value) : '0.0000'; }
function ymd(value: Date) { return value.toISOString().slice(0, 10); }
function dateOrFallback(value: Date | null, fallback: Date) { return ymd(value ?? fallback); }
function sourceVaultNameAr(sourceId: string | null) { return sourceId ? `خزينة نوركس (${sourceId})` : 'خزينة نوركس'; }
function sourceVaultNameEn(sourceId: string | null) { return sourceId ? `Noorix vault (${sourceId})` : 'Noorix vault'; }

function sourceTransactionDate(value: Prisma.NurixHistoricalPayrollEvidenceGetPayload<{ select: typeof headerSelect }>) {
  const invoice = value.accountingEvidence.find((item) => item.evidenceKind === 'PAYROLL_INVOICE');
  return dateOrFallback(invoice?.sourceDate ?? null, value.sourceAccruedAt);
}

function sourcePostedAt(value: Prisma.NurixHistoricalPayrollEvidenceGetPayload<{ select: typeof headerSelect }>) {
  const journal = value.accountingEvidence.find((item) => item.evidenceKind === 'JOURNAL_ENTRY');
  return journal?.sourceDate ? ymd(journal.sourceDate) : null;
}

function historicalStatus(value: Prisma.NurixHistoricalPayrollEvidenceGetPayload<{ select: typeof headerSelect }>) {
  if (/(CANCEL|VOID|REVERSE|SUPERSEDE)/i.test(value.sourceStatus)) return 'SOURCE_CANCELLED_SUPERSEDED' as const;
  if (value.paymentEvidenceKind === 'AMOUNT_ONLY' && value.paymentEvidenceAmount && value.paymentEvidenceAmount.equals(value.netAmount)) return 'SOURCE_PAID_RECONCILED' as const;
  return 'SOURCE_EVIDENCE_INCOMPLETE' as const;
}
