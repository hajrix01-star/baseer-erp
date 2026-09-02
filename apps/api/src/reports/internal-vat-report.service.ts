import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { internalVatReportRequestSchema } from '@baseer-erp/contracts';
import { randomUUID } from 'node:crypto';
import type { ReportLocale, ReportSnapshot } from '@baseer-erp/output-platform';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { BusinessDateService } from '../business-date/business-date.service.js';
import { DatabaseService } from '../database/database.service.js';
import { FinanceJournalEntryStatus, Prisma } from '../generated/prisma/client.js';
import { financeJournalPresentation } from '../finance/finance-journal-presentation.js';
import { ReportRunService, SEALED_LEDGER_ENTRY_PREDICATE_VERSION } from './report-run.service.js';
import { interactiveReportPeriodMessage, interactiveReportSourceMessage } from './interactive-report-limits.js';

const REPORT_CODE = 'internal_vat_report';
const DEFINITION_VERSION = 'internal_vat_report_v1';
type RowCode = 'output_vat' | 'input_vat' | 'vat_paid' | 'vat_refunded';
type Request = Readonly<{ from: Date; to: Date; months?: readonly string[] }>;
const journalPresentationSelect = {
  hrPayrollAccrual: { select: { runNumber: true } },
  hrPayrollPayment: { select: { paymentNumber: true, payrollRun: { select: { runNumber: true } } } },
  hrEmployeeAdvanceIssue: { select: { advanceNumber: true } },
  hrEmployeeAdvanceSettlements: { take: 1, select: { source: true, advance: { select: { advanceNumber: true } } } },
  hrFinalSettlementAccrual: { select: { settlementNumber: true } },
  hrFinalSettlementPayment: { select: { paymentNumber: true, settlement: { select: { settlementNumber: true } } } },
  dailySalesClosing: { select: { documentNumber: true } },
  vatSettlement: { select: { referenceNumber: true } },
  reversalOfEntry: { select: {
    sourceType: true, sourceReference: true, description: true,
    hrPayrollAccrual: { select: { runNumber: true } },
    hrPayrollPayment: { select: { paymentNumber: true, payrollRun: { select: { runNumber: true } } } },
    hrEmployeeAdvanceIssue: { select: { advanceNumber: true } },
    hrEmployeeAdvanceSettlements: { take: 1, select: { source: true, advance: { select: { advanceNumber: true } } } },
    hrFinalSettlementAccrual: { select: { settlementNumber: true } },
    hrFinalSettlementPayment: { select: { paymentNumber: true, settlement: { select: { settlementNumber: true } } } },
    dailySalesClosing: { select: { documentNumber: true } },
    vatSettlement: { select: { referenceNumber: true } },
  } },
} satisfies Prisma.FinanceJournalEntrySelect;
type VatLine = Readonly<{ id: string; journalEntryId: string; businessDate: Date; accountKey: 'VAT_OUTPUT' | 'VAT_INPUT'; debit: Prisma.Decimal; credit: Prisma.Decimal; reference: string; sourceType: string; originalSourceType: string | null; labelAr: string; labelEn: string }>;

/**
 * Internal VAT analysis only. It isolates tax-control ledger lines from cash
 * settlements, which ensures a VAT payment never reduces the period's invoice
 * output tax and a refund never reduces the period's input tax.
 */
@Injectable()
export class InternalVatReportService {
  constructor(private readonly database: DatabaseService, private readonly reportRuns: ReportRunService, private readonly dates: BusinessDateService) {}

  async run(context: TrustedCompanyActorContext, request: Request) {
    assertPeriod(request);
    const periodMessage = interactiveReportPeriodMessage(request.from, request.to, request.months);
    if (periodMessage) return { state: 'NOT_READY' as const, messageAr: periodMessage };
    const source = await this.source(context);
    if (!source.company || !source.profile) return { state: 'NOT_READY' as const, messageAr: 'هذا التقرير غير متاح بعد لأن إعداد الشركة المالي غير مكتمل.' };
    const readySource = { company: source.company, profile: source.profile };
    const ledgerRevision = await this.reportRuns.currentLedgerRevision(context);
    const sourceMessage = interactiveReportSourceMessage(await this.sourceLineCount(context, ledgerRevision, request));
    if (sourceMessage) return { state: 'NOT_READY' as const, messageAr: sourceMessage };
    const rows = aggregate(await this.lines(context, ledgerRevision, request));
    const metadata = reportMetadata(readySource, request, ledgerRevision);
    if (!rows.some((row) => !row.amount.isZero())) return { state: 'NO_DATA' as const, messageAr: 'لا توجد حركات ضريبية مؤهلة ضمن الفترة المحددة.', ...metadata, rows: [], netVat: money(zero()), netVatEvidence: vatEvidence('VAT_NET') };
    const output = amountFor(rows, 'output_vat'); const input = amountFor(rows, 'input_vat');
    return { state: 'READY' as const, ...metadata, rows: rows.filter((row) => !row.amount.isZero()).map(displayRow), netVat: money(output.minus(input)), netVatEvidence: vatEvidence('VAT_NET') };
  }

  /** Creates the immutable boundary only when the caller is producing an official output. */
  async issueOfficialRun(context: TrustedCompanyActorContext, request: Request) {
    assertPeriod(request);
    return this.reportRuns.create(context, {
      reportCode: REPORT_CODE, definitionVersion: DEFINITION_VERSION,
      canonicalOptions: { from: day(request.from), to: day(request.to), ...(request.months?.length ? { months: request.months } : {}) },
      economicAsOfDate: request.to,
      sourceCoverage: { sourceKind: 'sealed_ledger_vat_control_lines', settlementTreatment: 'separate_from_period_tax' },
    });
  }

  async evidence(context: TrustedCompanyActorContext, reportRunId: string, rowCode: RowCode, cursor?: string) {
    const { run, request } = await this.readyRun(context, reportRunId);
    const all = (await this.lines(context, run.ledgerRevision, request)).filter((line) => classify(line) === rowCode).sort((a, b) => day(a.businessDate).localeCompare(day(b.businessDate)) || a.id.localeCompare(b.id));
    const marker = cursor ? cursorValue(cursor) : null;
    if (marker && !all.some((line) => line.id === marker.id && day(line.businessDate) === marker.businessDate)) throw new BadRequestException('The VAT evidence cursor is outside this report scope.');
    const eligible = marker ? all.filter((line) => day(line.businessDate) > marker.businessDate || (day(line.businessDate) === marker.businessDate && line.id > marker.id)) : all;
    const page = eligible.slice(0, 100); const last = page.at(-1);
    return { reportRunId: run.id, rowCode, nextCursor: eligible.length > page.length && last ? `${day(last.businessDate)}:${last.id}` : null, items: page.map((line) => ({ lineId: line.id, businessDate: day(line.businessDate), amount: money(valueFor(line)), reference: line.reference, labelAr: line.labelAr, labelEn: line.labelEn })) };
  }

  /** Live evidence shares the report's sealed-ledger predicate and does not
   * require a browser-held official report run. */
  async liveEvidence(context: TrustedCompanyActorContext, request: Request, target: RowCode | 'VAT_NET', cursor?: string) {
    assertPeriod(request);
    const periodMessage = interactiveReportPeriodMessage(request.from, request.to, request.months);
    if (periodMessage) throw new BadRequestException(periodMessage);
    const revision = await this.reportRuns.currentLedgerRevision(context);
    const all = (await this.lines(context, revision, request))
      .filter((line) => target === 'VAT_NET'
        ? classify(line) === 'output_vat' || classify(line) === 'input_vat'
        : classify(line) === target)
      .sort((a, b) => day(a.businessDate).localeCompare(day(b.businessDate)) || a.id.localeCompare(b.id));
    const marker = cursor ? cursorValue(cursor) : null;
    if (marker && !all.some((line) => line.id === marker.id && day(line.businessDate) === marker.businessDate)) throw new BadRequestException('The VAT evidence cursor is outside this live report scope.');
    const eligible = marker ? all.filter((line) => day(line.businessDate) > marker.businessDate || (day(line.businessDate) === marker.businessDate && line.id > marker.id)) : all;
    const page = eligible.slice(0, 100);
    const last = page.at(-1);
    return {
      nextCursor: eligible.length > page.length && last ? `${day(last.businessDate)}:${last.id}` : null,
      items: page.map((line) => ({
        lineId: line.id,
        journalEntryId: line.journalEntryId,
        businessDate: day(line.businessDate),
        amount: money(evidenceAmountFor(line, target)),
        reference: line.reference,
        labelAr: line.labelAr,
        labelEn: line.labelEn || line.labelAr,
      })),
    };
  }

  /** The source is verified against the same live VAT predicate before it is
   * exposed, preventing a journal id from becoming a cross-report escape. */
  async liveSource(context: TrustedCompanyActorContext, request: Request, target: RowCode | 'VAT_NET', journalEntryId: string) {
    assertPeriod(request);
    const periodMessage = interactiveReportPeriodMessage(request.from, request.to, request.months);
    if (periodMessage) throw new BadRequestException(periodMessage);
    const revision = await this.reportRuns.currentLedgerRevision(context);
    const permitted = (await this.lines(context, revision, request)).some((line) => line.journalEntryId === journalEntryId && (target === 'VAT_NET'
      ? classify(line) === 'output_vat' || classify(line) === 'input_vat'
      : classify(line) === target));
    if (!permitted) throw new NotFoundException('The VAT source journal is not available in this live report scope.');
    const entry = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.financeJournalEntry.findFirst({
      where: { id: journalEntryId, tenantId: context.tenantId, companyId: context.companyId },
      select: {
        id: true, businessDate: true, sourceType: true, sourceReference: true, description: true,
        reversalEntry: { select: { ledgerRevision: true } }, ...journalPresentationSelect,
        lines: { orderBy: { lineNumber: 'asc' }, select: { id: true, lineNumber: true, debitAmount: true, creditAmount: true, description: true, account: { select: { code: true, nameAr: true, nameEn: true } } } },
      },
    }));
    if (!entry) throw new NotFoundException('The VAT source journal is not available.');
    const presentation = financeJournalPresentation(entry);
    const reversed = entry.sourceType === 'journal_reversal' || Boolean(entry.reversalEntry && entry.reversalEntry.ledgerRevision <= revision);
    return {
      journalEntry: {
        id: entry.id, businessDate: day(entry.businessDate), labelAr: presentation.labelAr,
        labelEn: presentation.labelEn || presentation.labelAr, sourceReference: presentation.reference,
        description: entry.description, counterparty: null, status: reversed ? 'REVERSED' as const : 'POSTED' as const,
        lines: entry.lines.map((line) => ({
          id: line.id, lineNumber: line.lineNumber, accountCode: line.account.code, accountNameAr: line.account.nameAr,
          accountNameEn: line.account.nameEn || line.account.nameAr, debit: money(line.debitAmount), credit: money(line.creditAmount), description: line.description,
        })),
      },
    };
  }

  async sourceJournal(context: TrustedCompanyActorContext, reportRunId: string, lineId: string) {
    const { run, request } = await this.readyRun(context, reportRunId);
    const lines = await this.lines(context, run.ledgerRevision, request);
    if (!lines.some((line) => line.id === lineId)) throw new NotFoundException('The source line is not available in this VAT report run.');
    const journal = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.financeJournalLine.findFirst({
      where: { id: lineId, tenantId: context.tenantId, companyId: context.companyId },
      select: { journalEntry: { select: { id: true, businessDate: true, sourceType: true, sourceReference: true, description: true, postedAt: true, reversalEntry: { select: { ledgerRevision: true } }, ...journalPresentationSelect, lines: { orderBy: { lineNumber: 'asc' }, select: { id: true, lineNumber: true, debitAmount: true, creditAmount: true, description: true, account: { select: { code: true, nameAr: true, nameEn: true } } } } } } },
    }));
    if (!journal) throw new NotFoundException('The VAT source journal is not available.');
    const entry = journal.journalEntry;
    const presentation = financeJournalPresentation(entry);
    return { journalEntry: { id: entry.id, businessDate: day(entry.businessDate), sourceType: entry.sourceType, labelAr: presentation.labelAr, labelEn: presentation.labelEn, sourceReference: presentation.reference, description: entry.description, status: entry.reversalEntry && entry.reversalEntry.ledgerRevision <= run.ledgerRevision ? 'REVERSED' as const : 'POSTED' as const, postedAt: entry.postedAt.toISOString(), lines: entry.lines.map((line) => ({ id: line.id, lineNumber: line.lineNumber, accountCode: line.account.code, accountNameAr: line.account.nameAr, accountNameEn: line.account.nameEn, debitAmount: line.debitAmount.toFixed(4), creditAmount: line.creditAmount.toFixed(4), description: line.description })) } };
  }

  async snapshotForDocument(context: TrustedCompanyActorContext, reportRunId: string, locale: ReportLocale): Promise<ReportSnapshot> {
    const { run, request } = await this.readyRun(context, reportRunId); const source = await this.source(context);
    if (!source.company || !source.profile) throw new NotFoundException('The VAT report company source is unavailable.');
    const rows = aggregate(await this.lines(context, run.ledgerRevision, request)); const ar = locale === 'ar';
    const output = amountFor(rows, 'output_vat'); const input = amountFor(rows, 'input_vat');
    return { snapshotId: randomUUID(), reportCode: REPORT_CODE, templateVersion: DEFINITION_VERSION, title: ar ? 'التقرير الضريبي الداخلي' : 'Internal VAT report', direction: ar ? 'rtl' : 'ltr', locale, generatedAtRiyadh: (await this.dates.currentForTrustedContext(context)).generatedAt, companies: [{ id: source.company.id, name: ar ? source.company.nameAr : source.company.nameEn || source.company.nameAr }], periodLabel: request.months?.length ? request.months.join('، ') : `${day(request.from)} — ${day(request.to)}`, taxPresentation: 'taxSeparated', sourceLabel: ar ? `داخلي — حسابات ضريبة الدخل والمخرجات من القيود المختومة · ${source.profile.functionalCurrencyCode}` : `Internal — VAT control accounts from sealed entries · ${source.profile.functionalCurrencyCode}`, columns: [{ key: 'item', label: ar ? 'البند' : 'Item', kind: 'text', width: 54 }, { key: 'amount', label: ar ? 'المبلغ' : 'Amount', kind: 'amount', width: 24 }], rows: [...rows.map((row) => ({ item: ar ? row.labelAr : row.labelEn, amount: row.amount.toFixed(4) })), { item: ar ? 'صافي ضريبة الفترة' : 'Net VAT for period', amount: output.minus(input).toFixed(4), kind: 'total' }] };
  }

  private async source(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [company, profile] = await Promise.all([transaction.company.findFirst({ where: { id: context.companyId, tenantId: context.tenantId }, select: { id: true, nameAr: true, nameEn: true, businessTimezone: true } }), transaction.companyFinanceProfile.findFirst({ where: { companyId: context.companyId, tenantId: context.tenantId }, select: { functionalCurrencyCode: true } })]);
      return { company, profile };
    });
  }

  private async lines(context: TrustedCompanyActorContext, revision: bigint | string, request: Request): Promise<VatLine[]> {
    const eligible = this.eligibleEntryWhere(context, revision, request);
    const records = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.financeJournalLine.findMany({
      where: { tenantId: context.tenantId, companyId: context.companyId, account: { is: { systemKey: { in: ['VAT_OUTPUT', 'VAT_INPUT'] } } }, journalEntry: { is: eligible } },
      select: { id: true, debitAmount: true, creditAmount: true, account: { select: { systemKey: true } }, journalEntry: { select: { id: true, businessDate: true, sourceReference: true, sourceType: true, description: true, ...journalPresentationSelect } } },
    }));
    return records.flatMap((line): VatLine[] => {
      if (line.account.systemKey !== 'VAT_OUTPUT' && line.account.systemKey !== 'VAT_INPUT') return [];
      const presentation = financeJournalPresentation(line.journalEntry);
      return [{ id: line.id, journalEntryId: line.journalEntry.id, businessDate: line.journalEntry.businessDate, accountKey: line.account.systemKey, debit: line.debitAmount, credit: line.creditAmount, reference: presentation.reference, sourceType: line.journalEntry.sourceType, originalSourceType: line.journalEntry.reversalOfEntry?.sourceType ?? null, labelAr: presentation.labelAr, labelEn: presentation.labelEn }];
    });
  }

  private sourceLineCount(context: TrustedCompanyActorContext, revision: bigint | string, request: Request) {
    const eligible = this.eligibleEntryWhere(context, revision, request);
    return this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.financeJournalLine.count({
      where: { tenantId: context.tenantId, companyId: context.companyId, account: { is: { systemKey: { in: ['VAT_OUTPUT', 'VAT_INPUT'] } } }, journalEntry: { is: eligible } },
    }));
  }

  private eligibleEntryWhere(context: TrustedCompanyActorContext, revision: bigint | string, request: Request): Prisma.FinanceJournalEntryWhereInput {
    return {
      tenantId: context.tenantId,
      companyId: context.companyId,
      isSealed: true,
      status: { in: [FinanceJournalEntryStatus.POSTED, FinanceJournalEntryStatus.REVERSED] },
      ledgerRevision: { lte: BigInt(revision) },
      ...(request.months?.length
        ? { OR: request.months.map((month) => ({ businessDate: monthRange(month) })) }
        : { businessDate: { gte: request.from, lte: request.to } }),
    };
  }

  private async readyRun(context: TrustedCompanyActorContext, reportRunId: string) {
    const run = await this.reportRuns.findReady(context, reportRunId);
    if (run.reportCode !== REPORT_CODE || run.definitionVersion !== DEFINITION_VERSION || run.eligibleEntryPredicateVersion !== SEALED_LEDGER_ENTRY_PREDICATE_VERSION) throw new BadRequestException('The report run does not match the supported internal VAT policy.');
    const parsed = internalVatReportRequestSchema.safeParse(run.canonicalOptionsJson);
    if (!parsed.success) throw new BadRequestException('The report run has invalid VAT report options.');
    return { run, request: { from: dateOf(parsed.data.from), to: dateOf(parsed.data.to), ...(parsed.data.months ? { months: parsed.data.months } : {}) } };
  }
}

function isSettlement(line: VatLine) { return line.sourceType === 'finance_vat_settlement' || (line.sourceType === 'journal_reversal' && line.originalSourceType === 'finance_vat_settlement'); }
function classify(line: VatLine): RowCode { if (isSettlement(line)) return line.accountKey === 'VAT_OUTPUT' ? 'vat_paid' : 'vat_refunded'; return line.accountKey === 'VAT_OUTPUT' ? 'output_vat' : 'input_vat'; }
function valueFor(line: VatLine) { const row = classify(line); return row === 'output_vat' ? line.credit.minus(line.debit) : row === 'input_vat' ? line.debit.minus(line.credit) : row === 'vat_paid' ? line.debit.minus(line.credit) : line.credit.minus(line.debit); }
function aggregate(lines: readonly VatLine[]) { const definitions: ReadonlyArray<Readonly<{ code: RowCode; labelAr: string; labelEn: string }>> = [{ code: 'output_vat', labelAr: 'ضريبة المخرجات', labelEn: 'Output VAT' }, { code: 'input_vat', labelAr: 'ضريبة المدخلات', labelEn: 'Input VAT' }, { code: 'vat_paid', labelAr: 'ضريبة مسددة', labelEn: 'VAT paid' }, { code: 'vat_refunded', labelAr: 'ضريبة مستردة', labelEn: 'VAT refunded' }]; return definitions.map((definition) => { const selected = lines.filter((line) => classify(line) === definition.code); return { ...definition, amount: selected.reduce((sum, line) => sum.plus(valueFor(line)), zero()), eventCount: selected.length }; }); }
function amountFor(rows: ReadonlyArray<{ code: RowCode; amount: Prisma.Decimal }>, code: RowCode) { return rows.find((row) => row.code === code)?.amount ?? zero(); }
function displayRow(row: { code: RowCode; labelAr: string; labelEn: string; amount: Prisma.Decimal; eventCount: number }) { return { ...row, amount: money(row.amount), evidence: vatEvidence(row.code) }; }
function vatEvidence(target: RowCode | 'VAT_NET') { return target === 'VAT_NET'
  ? { reportCode: 'internal_vat_report' as const, metric: { kind: 'VAT_NET' as const } }
  : { reportCode: 'internal_vat_report' as const, metric: { kind: 'VAT_ROW' as const, rowCode: target } };
}
/** VAT rows display their own natural magnitude, while the net-VAT evidence
 * must sum to output minus input.  Input lines are therefore signed only in
 * the composite VAT_NET proof. */
function evidenceAmountFor(line: VatLine, target: RowCode | 'VAT_NET') {
  const amount = valueFor(line);
  return target === 'VAT_NET' && classify(line) === 'input_vat' ? amount.negated() : amount;
}
function reportMetadata(source: { company: { nameAr: string; nameEn: string; businessTimezone: string }; profile: { functionalCurrencyCode: string } }, request: Request, ledgerRevision: bigint) { return { reportCode: REPORT_CODE, definitionVersion: DEFINITION_VERSION, dataMode: 'LIVE' as const, ledgerRevision: ledgerRevision.toString(), company: { displayName: source.company.nameAr || source.company.nameEn, functionalCurrency: source.profile.functionalCurrencyCode }, selectedPeriod: { from: day(request.from), to: day(request.to), ...(request.months?.length ? { months: request.months } : {}) }, basisLabelAr: 'دفتر الأستاذ — حسابات الضريبة' }; }
function money(value: Prisma.Decimal) { const sign = value.gt(0) ? 'positive' as const : value.lt(0) ? 'negative' as const : 'zero' as const; return { raw: value.toFixed(4), display: value.abs().toFixed(2), sign }; }
function zero() { return new Prisma.Decimal(0); }
function day(value: Date) { return value.toISOString().slice(0, 10); }
function dateOf(value: string) { const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.valueOf()) || day(date) !== value) throw new BadRequestException('A valid business date is required.'); return date; }
function assertPeriod(value: Request) { if (!(value.from instanceof Date) || !(value.to instanceof Date) || Number.isNaN(value.from.valueOf()) || Number.isNaN(value.to.valueOf()) || value.from > value.to) throw new BadRequestException('A valid VAT report period is required.'); }
function cursorValue(value: string): { businessDate: string; id: string } { const match = /^(\d{4}-\d{2}-\d{2}):([0-9a-f-]{36})$/i.exec(value); if (!match || !match[1] || !match[2]) throw new BadRequestException('The VAT evidence cursor is invalid.'); return { businessDate: match[1], id: match[2] }; }
function monthRange(month: string) { const [year, monthNumber] = month.split('-').map(Number); return { gte: new Date(Date.UTC(year!, monthNumber! - 1, 1)), lte: new Date(Date.UTC(year!, monthNumber!, 0)) }; }
