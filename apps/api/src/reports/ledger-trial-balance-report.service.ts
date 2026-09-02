import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ledgerTrialBalanceRequestSchema } from '@baseer-erp/contracts';
import type { ReportLocale, ReportSnapshot } from '@baseer-erp/output-platform';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { BusinessDateService } from '../business-date/business-date.service.js';
import { FinanceJournalEntryStatus, Prisma } from '../generated/prisma/client.js';
import { financeJournalPresentation } from '../finance/finance-journal-presentation.js';
import { ReportRunService, SEALED_LEDGER_ENTRY_PREDICATE_VERSION } from './report-run.service.js';

const REPORT_CODE = 'ledger_trial_balance';
const DEFINITION_VERSION = 'ledger_trial_balance_v1';
const PAGE_SIZE = 100;
const MAX_INTERACTIVE_DAYS = 366;
const MAX_INTERACTIVE_ACCOUNTS = 1_000;
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

type TrialBalanceRequest = Readonly<{ from: Date; to: Date; includeZeroRows: boolean }>;
type TrialAmounts = Readonly<{ openingDebit: Prisma.Decimal; openingCredit: Prisma.Decimal; periodDebit: Prisma.Decimal; periodCredit: Prisma.Decimal; closingDebit: Prisma.Decimal; closingCredit: Prisma.Decimal }>;
type Aggregate = Readonly<{ debitAmount: Prisma.Decimal | null; creditAmount: Prisma.Decimal | null }>;

/**
 * The Trial Balance reads the immutable journal directly. Daily/monthly
 * projections intentionally are not used because they do not carry the
 * ReportRun ledger revision required for a frozen historical result.
 */
@Injectable()
export class LedgerTrialBalanceReportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly reportRuns: ReportRunService,
    private readonly dates: BusinessDateService,
  ) {}

  async run(context: TrustedCompanyActorContext, request: TrialBalanceRequest) {
    assertPeriod(request);
    const current = await this.dates.currentForTrustedContext(context);
    if (request.to > businessDate(current.businessDate)) throw new BadRequestException('The Trial Balance end date cannot be after the current business date.');

    if (Math.floor((request.to.valueOf() - request.from.valueOf()) / 86_400_000) + 1 > MAX_INTERACTIVE_DAYS) return { state: 'RANGE_EXCEEDS_INTERACTIVE_LIMIT' as const, messageAr: 'الفترة المحددة أكبر من الحد التفاعلي لميزان المراجعة. اختر سنة واحدة أو نطاقاً أقصر.' };
    const source = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [company, profile, accountCount] = await Promise.all([
        transaction.company.findFirst({ where: { id: context.companyId, tenantId: context.tenantId }, select: { nameAr: true, nameEn: true, businessTimezone: true } }),
        transaction.companyFinanceProfile.findFirst({ where: { companyId: context.companyId, tenantId: context.tenantId }, select: { functionalCurrencyCode: true } }),
        transaction.financeAccount.count({ where: { companyId: context.companyId, tenantId: context.tenantId } }),
      ]);
      return { company, profile, accountCount };
    });
    if (!source.company || !source.profile) return { state: 'NOT_READY' as const, messageAr: 'هذا التقرير غير متاح بعد لأن إعداد الشركة المالي غير مكتمل.' };
    if (source.accountCount > MAX_INTERACTIVE_ACCOUNTS) return { state: 'RANGE_EXCEEDS_INTERACTIVE_LIMIT' as const, messageAr: 'عدد الحسابات أكبر من الحد التفاعلي لميزان المراجعة. استخدم مخرجاً خادمياً عند توفره.' };

    const ledgerRevision = await this.reportRuns.currentLedgerRevision(context);
    const { accounts, opening, period } = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const eligible = ledgerPredicate(context, ledgerRevision);
      const lineWhere = { tenantId: context.tenantId, companyId: context.companyId } satisfies Prisma.FinanceJournalLineWhereInput;
      const [accounts, opening, period] = await Promise.all([
        transaction.financeAccount.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId },
          select: { id: true, code: true, nameAr: true, nameEn: true, type: true, status: true, isSystem: true },
        }),
        transaction.financeJournalLine.groupBy({
          by: ['accountId'],
          where: { ...lineWhere, journalEntry: { is: { ...eligible, businessDate: { lt: request.from } } } },
          _sum: { debitAmount: true, creditAmount: true },
        }),
        transaction.financeJournalLine.groupBy({
          by: ['accountId'],
          where: { ...lineWhere, journalEntry: { is: { ...eligible, businessDate: { gte: request.from, lte: request.to } } } },
          _sum: { debitAmount: true, creditAmount: true },
        }),
      ]);
      return { accounts, opening, period };
    });
    const openingByAccount = new Map(opening.map((row) => [row.accountId, row]));
    const periodByAccount = new Map(period.map((row) => [row.accountId, row]));
    const rows = accounts
      .map((account) => ({ account, amounts: calculateTrialAmounts(openingByAccount.get(account.id)?._sum, periodByAccount.get(account.id)?._sum) }))
      .filter(({ account, amounts }) => isEligibleTrialBalanceAccount(account, openingByAccount.has(account.id) || periodByAccount.has(account.id), amounts, request.includeZeroRows))
      .sort((left, right) => left.account.type.localeCompare(right.account.type) || left.account.code.localeCompare(right.account.code));
    const totals = rows.reduce<TrialAmounts>((sum, row) => addAmounts(sum, row.amounts), zeroAmounts());
    assertBalanced(totals);
    const metadata = metadataFor({ company: source.company, profile: source.profile }, request, ledgerRevision);
    if (!rows.length) {
      return { state: 'NO_DATA' as const, messageAr: 'لا توجد حسابات مؤهلة ضمن الفترة المحددة.', ...metadata, rows: [], totals: displayAmounts(totals), totalsEvidence: trialEvidence() };
    }
    return {
      state: 'READY' as const,
      ...metadata,
      rows: rows.map(({ account, amounts }) => ({
        accountId: account.id, code: account.code, nameAr: account.nameAr, nameEn: account.nameEn, type: account.type, isSystem: account.isSystem,
        amounts: displayAmounts(amounts), evidence: trialEvidence(account.id),
      })),
      totals: displayAmounts(totals), totalsEvidence: trialEvidence(),
    };
  }

  /** Creates the immutable boundary only when the caller is producing an official output. */
  async issueOfficialRun(context: TrustedCompanyActorContext, request: TrialBalanceRequest) {
    assertPeriod(request);
    const current = await this.dates.currentForTrustedContext(context);
    if (request.to > businessDate(current.businessDate)) throw new BadRequestException('The Trial Balance end date cannot be after the current business date.');
    return this.reportRuns.create(context, {
      reportCode: REPORT_CODE,
      definitionVersion: DEFINITION_VERSION,
      canonicalOptions: { from: dateText(request.from), to: dateText(request.to), includeZeroRows: request.includeZeroRows },
      economicAsOfDate: request.to,
      sourceCoverage: { sourceKind: 'sealed_ledger', projection: 'none', freshness: 'NOT_APPLICABLE' },
    });
  }

  async evidence(context: TrustedCompanyActorContext, reportRunId: string, accountId: string, scope: 'OPENING' | 'PERIOD' | 'CLOSING', cursor?: string) {
    const { run, request } = await this.readyRun(context, reportRunId);
    const parsedCursor = cursor ? decodeCursor(cursor) : null;
    const dateScope = scopeDateFilter(scope, request);
    const entries = ledgerPredicate(context, run.ledgerRevision);
    const baseWhere: Prisma.FinanceJournalLineWhereInput = {
      tenantId: context.tenantId,
      companyId: context.companyId,
      accountId,
      journalEntry: { is: { ...entries, businessDate: dateScope } },
    };
    const lines = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const verifiedCursor = parsedCursor ? await transaction.financeJournalLine.findFirst({ where: { ...baseWhere, id: parsedCursor.id }, select: { businessDate: true, createdAt: true, lineNumber: true, id: true } }) : null;
      if (parsedCursor && !verifiedCursor) throw new BadRequestException('The Trial Balance evidence cursor is outside this report scope.');
      const cursorWhere: Prisma.FinanceJournalLineWhereInput | undefined = verifiedCursor ? { OR: [
        { businessDate: { lt: verifiedCursor.businessDate } }, { businessDate: verifiedCursor.businessDate, createdAt: { lt: verifiedCursor.createdAt } },
        { businessDate: verifiedCursor.businessDate, createdAt: verifiedCursor.createdAt, lineNumber: { lt: verifiedCursor.lineNumber } },
        { businessDate: verifiedCursor.businessDate, createdAt: verifiedCursor.createdAt, lineNumber: verifiedCursor.lineNumber, id: { lt: verifiedCursor.id } },
      ] } : undefined;
      return transaction.financeJournalLine.findMany({
      where: cursorWhere ? { ...baseWhere, AND: [cursorWhere] } : baseWhere,
      orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }, { lineNumber: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      select: {
        id: true, businessDate: true, createdAt: true, lineNumber: true, debitAmount: true, creditAmount: true,
        journalEntry: { select: { id: true, businessDate: true, sourceType: true, sourceReference: true, description: true, reversalEntry: { select: { ledgerRevision: true } }, ...journalPresentationSelect } },
      },
      });
    });
    const page = lines.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      reportRunId: run.id, accountId, scope,
      nextCursor: lines.length > page.length && last ? encodeCursor(last) : null,
      items: page.map((line) => ({
        lineId: line.id, journalEntryId: line.journalEntry.id, businessDate: dateText(line.journalEntry.businessDate),
        ...journalLabel(line.journalEntry),
        description: line.journalEntry.description,
        debit: money(line.debitAmount), credit: money(line.creditAmount),
        cancellationLabelAr: cancellationLabel(line.journalEntry, run.ledgerRevision),
      })),
    };
  }

  /**
   * Interactive drill-down deliberately reads the current sealed ledger.  It
   * shares the exact predicate with the table, but never depends on an
   * official-report snapshot id that the browser may no longer hold.
   */
  async liveEvidence(
    context: TrustedCompanyActorContext,
    request: TrialBalanceRequest,
    target: Readonly<{ accountId?: string; scope: 'OPENING' | 'PERIOD' | 'CLOSING'; side: 'DEBIT' | 'CREDIT' }>,
    cursor?: string,
  ) {
    assertPeriod(request);
    const current = await this.dates.currentForTrustedContext(context);
    if (request.to > businessDate(current.businessDate)) throw new BadRequestException('The Trial Balance evidence end date cannot be after the current business date.');
    if (Math.floor((request.to.valueOf() - request.from.valueOf()) / 86_400_000) + 1 > MAX_INTERACTIVE_DAYS) throw new BadRequestException('The Trial Balance evidence period exceeds the interactive limit.');
    const revision = await this.reportRuns.currentLedgerRevision(context);
    const parsedCursor = cursor ? decodeCursor(cursor) : null;
    const dateScope = scopeDateFilter(target.scope, request);
    const baseWhere: Prisma.FinanceJournalLineWhereInput = {
      tenantId: context.tenantId,
      companyId: context.companyId,
      ...(target.accountId ? { accountId: target.accountId } : {}),
      ...(target.side === 'DEBIT' ? { debitAmount: { gt: new Prisma.Decimal(0) } } : { creditAmount: { gt: new Prisma.Decimal(0) } }),
      journalEntry: { is: { ...ledgerPredicate(context, revision), businessDate: dateScope } },
    };
    const lines = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const verifiedCursor = parsedCursor ? await transaction.financeJournalLine.findFirst({
        where: { ...baseWhere, id: parsedCursor.id },
        select: { businessDate: true, createdAt: true, lineNumber: true, id: true },
      }) : null;
      if (parsedCursor && !verifiedCursor) throw new BadRequestException('The Trial Balance evidence cursor is outside this live report scope.');
      const cursorWhere: Prisma.FinanceJournalLineWhereInput | undefined = verifiedCursor ? { OR: [
        { businessDate: { lt: verifiedCursor.businessDate } },
        { businessDate: verifiedCursor.businessDate, createdAt: { lt: verifiedCursor.createdAt } },
        { businessDate: verifiedCursor.businessDate, createdAt: verifiedCursor.createdAt, lineNumber: { lt: verifiedCursor.lineNumber } },
        { businessDate: verifiedCursor.businessDate, createdAt: verifiedCursor.createdAt, lineNumber: verifiedCursor.lineNumber, id: { lt: verifiedCursor.id } },
      ] } : undefined;
      return transaction.financeJournalLine.findMany({
        where: cursorWhere ? { ...baseWhere, AND: [cursorWhere] } : baseWhere,
        orderBy: [{ businessDate: 'desc' }, { createdAt: 'desc' }, { lineNumber: 'desc' }, { id: 'desc' }],
        take: PAGE_SIZE + 1,
        select: {
          id: true, businessDate: true, createdAt: true, lineNumber: true, debitAmount: true, creditAmount: true,
          journalEntry: { select: { id: true, businessDate: true, sourceType: true, sourceReference: true, description: true, reversalEntry: { select: { ledgerRevision: true } }, ...journalPresentationSelect } },
        },
      });
    });
    const page = lines.slice(0, PAGE_SIZE);
    const last = page.at(-1);
    return {
      nextCursor: lines.length > page.length && last ? encodeCursor(last) : null,
      items: page.map((line) => {
        const label = journalLabel(line.journalEntry);
        return {
          lineId: line.id,
          journalEntryId: line.journalEntry.id,
          businessDate: dateText(line.journalEntry.businessDate),
          // One ledger side per descriptor: an amount cell can never silently
          // include the opposite side of a Trial Balance account.
          amount: money(target.side === 'DEBIT' ? line.debitAmount : line.creditAmount),
          labelAr: label.labelAr,
          labelEn: label.labelEn || label.labelAr,
          reference: label.reference,
          description: line.journalEntry.description,
        };
      }),
    };
  }

  /** Opens a source only if it belongs to the live evidence predicate. */
  async liveSource(
    context: TrustedCompanyActorContext,
    request: TrialBalanceRequest,
    target: Readonly<{ accountId?: string; scope: 'OPENING' | 'PERIOD' | 'CLOSING'; side: 'DEBIT' | 'CREDIT' }>,
    journalEntryId: string,
  ) {
    assertPeriod(request);
    const current = await this.dates.currentForTrustedContext(context);
    if (request.to > businessDate(current.businessDate)) throw new BadRequestException('The Trial Balance evidence end date cannot be after the current business date.');
    if (Math.floor((request.to.valueOf() - request.from.valueOf()) / 86_400_000) + 1 > MAX_INTERACTIVE_DAYS) throw new BadRequestException('The Trial Balance evidence period exceeds the interactive limit.');
    const revision = await this.reportRuns.currentLedgerRevision(context);
    const entry = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.financeJournalEntry.findFirst({
      where: {
        id: journalEntryId,
        ...ledgerPredicate(context, revision),
        businessDate: scopeDateFilter(target.scope, request),
        lines: { some: {
          ...(target.accountId ? { accountId: target.accountId } : {}),
          ...(target.side === 'DEBIT' ? { debitAmount: { gt: new Prisma.Decimal(0) } } : { creditAmount: { gt: new Prisma.Decimal(0) } }),
        } },
      },
      select: {
        id: true, businessDate: true, sourceType: true, sourceReference: true, description: true,
        reversalEntry: { select: { ledgerRevision: true } }, ...journalPresentationSelect,
        lines: { orderBy: { lineNumber: 'asc' }, select: { id: true, lineNumber: true, debitAmount: true, creditAmount: true, description: true, account: { select: { code: true, nameAr: true, nameEn: true } } } },
      },
    }));
    if (!entry) throw new NotFoundException('The Trial Balance source journal is not available in this live report scope.');
    const label = journalLabel(entry);
    return {
      journalEntry: {
        id: entry.id,
        businessDate: dateText(entry.businessDate),
        labelAr: label.labelAr,
        labelEn: label.labelEn || label.labelAr,
        sourceReference: label.reference,
        description: entry.description,
        counterparty: null,
        status: cancellationLabel(entry, revision) ? 'REVERSED' as const : 'POSTED' as const,
        lines: entry.lines.map((line) => ({
          id: line.id, lineNumber: line.lineNumber, accountCode: line.account.code,
          accountNameAr: line.account.nameAr, accountNameEn: localizedFallback(line.account.nameEn, line.account.nameAr),
          debit: money(line.debitAmount), credit: money(line.creditAmount), description: line.description,
        })),
      },
    };
  }

  /** Builds a server-owned table snapshot from an existing frozen report run. */
  async snapshotForDocument(context: TrustedCompanyActorContext, reportRunId: string, locale: ReportLocale): Promise<ReportSnapshot> {
    const { run, request } = await this.readyRun(context, reportRunId);
    const generatedAt = (await this.dates.currentForTrustedContext(context)).generatedAt;
    const source = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [company, profile, accounts, opening, period] = await Promise.all([
        transaction.company.findFirst({ where: { id: context.companyId, tenantId: context.tenantId }, select: { id: true, nameAr: true, nameEn: true, businessTimezone: true } }),
        transaction.companyFinanceProfile.findFirst({ where: { companyId: context.companyId, tenantId: context.tenantId }, select: { functionalCurrencyCode: true } }),
        transaction.financeAccount.findMany({ where: { tenantId: context.tenantId, companyId: context.companyId }, select: { id: true, code: true, nameAr: true, nameEn: true, type: true, status: true, isSystem: true } }),
        transaction.financeJournalLine.groupBy({ by: ['accountId'], where: { tenantId: context.tenantId, companyId: context.companyId, journalEntry: { is: { ...ledgerPredicate(context, run.ledgerRevision), businessDate: { lt: request.from } } } }, _sum: { debitAmount: true, creditAmount: true } }),
        transaction.financeJournalLine.groupBy({ by: ['accountId'], where: { tenantId: context.tenantId, companyId: context.companyId, journalEntry: { is: { ...ledgerPredicate(context, run.ledgerRevision), businessDate: { gte: request.from, lte: request.to } } } }, _sum: { debitAmount: true, creditAmount: true } }),
      ]);
      return { company, profile, accounts, opening, period };
    });
    if (!source.company || !source.profile) throw new NotFoundException('The company report source is unavailable.');
    const openingByAccount = new Map(source.opening.map((row) => [row.accountId, row]));
    const periodByAccount = new Map(source.period.map((row) => [row.accountId, row]));
    const rows = source.accounts
      .map((account) => ({ account, amounts: calculateTrialAmounts(openingByAccount.get(account.id)?._sum, periodByAccount.get(account.id)?._sum) }))
      .filter(({ account, amounts }) => isEligibleTrialBalanceAccount(account, openingByAccount.has(account.id) || periodByAccount.has(account.id), amounts, request.includeZeroRows))
      .sort((left, right) => left.account.type.localeCompare(right.account.type) || left.account.code.localeCompare(right.account.code));
    const totals = rows.reduce<TrialAmounts>((sum, row) => addAmounts(sum, row.amounts), zeroAmounts());
    assertBalanced(totals);
    const ar = locale === 'ar';
    const values = (amounts: TrialAmounts) => ({ openingDebit: amounts.openingDebit.toFixed(4), openingCredit: amounts.openingCredit.toFixed(4), periodDebit: amounts.periodDebit.toFixed(4), periodCredit: amounts.periodCredit.toFixed(4), closingDebit: amounts.closingDebit.toFixed(4), closingCredit: amounts.closingCredit.toFixed(4) });
    return {
      snapshotId: randomUUID(), reportCode: REPORT_CODE, templateVersion: DEFINITION_VERSION,
      title: ar ? 'ميزان المراجعة' : 'Trial Balance', direction: ar ? 'rtl' : 'ltr', locale,
      generatedAtRiyadh: generatedAt,
      companies: [{ id: source.company.id, name: ar ? source.company.nameAr : source.company.nameEn || source.company.nameAr }],
      periodLabel: `${dateText(request.from)} — ${dateText(request.to)}`,
      taxPresentation: 'gross', sourceLabel: ar
        ? `دفتر الأستاذ — القيود المختومة · ${source.profile.functionalCurrencyCode} · ${source.company.businessTimezone} · التقريب: منزلتان للعرض · الإلغاء يظهر في تاريخ عمله`
        : `General ledger — sealed entries · ${source.profile.functionalCurrencyCode} · ${source.company.businessTimezone} · display rounding: 2 decimals · cancellations take effect on their business date`,
      columns: [
        { key: 'account', label: ar ? 'الحساب' : 'Account', kind: 'text', width: 32 },
        { key: 'openingDebit', label: ar ? 'افتتاحي مدين' : 'Opening debit', kind: 'amount', width: 16 }, { key: 'openingCredit', label: ar ? 'افتتاحي دائن' : 'Opening credit', kind: 'amount', width: 16 },
        { key: 'periodDebit', label: ar ? 'حركة مدين' : 'Period debit', kind: 'amount', width: 16 }, { key: 'periodCredit', label: ar ? 'حركة دائن' : 'Period credit', kind: 'amount', width: 16 },
        { key: 'closingDebit', label: ar ? 'ختامي مدين' : 'Closing debit', kind: 'amount', width: 16 }, { key: 'closingCredit', label: ar ? 'ختامي دائن' : 'Closing credit', kind: 'amount', width: 16 },
      ],
      rows: [
        ...rows.map(({ account, amounts }) => ({ account: `${account.code} · ${ar ? account.nameAr : account.nameEn || account.nameAr}`, ...values(amounts) })),
        { account: ar ? 'إجمالي الدفتر' : 'Ledger total', ...values(totals) },
      ],
    };
  }

  async source(context: TrustedCompanyActorContext, reportRunId: string, lineId: string, accountId: string, scope: 'OPENING' | 'PERIOD' | 'CLOSING') {
    const { run, request } = await this.readyRun(context, reportRunId);
    const entryPredicate = { ...ledgerPredicate(context, run.ledgerRevision), businessDate: scopeDateFilter(scope, request) };
    const line = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.financeJournalLine.findFirst({
      where: { id: lineId, tenantId: context.tenantId, companyId: context.companyId, accountId, journalEntry: { is: entryPredicate } },
      select: {
        journalEntry: { select: {
          id: true, businessDate: true, sourceType: true, sourceReference: true, description: true, reversalEntry: { select: { ledgerRevision: true } }, ...journalPresentationSelect,
          lines: { orderBy: { lineNumber: 'asc' }, select: { id: true, lineNumber: true, debitAmount: true, creditAmount: true, description: true, account: { select: { code: true, nameAr: true, nameEn: true } } } },
        } },
      },
    }));
    if (!line) throw new NotFoundException('The source journal line is not available in this report run.');
    const entry = line.journalEntry;
    return {
      journalEntry: {
        id: entry.id, businessDate: dateText(entry.businessDate),
        ...journalLabel(entry), description: entry.description, cancellationLabelAr: cancellationLabel(entry, run.ledgerRevision),
        lines: entry.lines.map((item) => ({ id: item.id, lineNumber: item.lineNumber, accountCode: item.account.code, accountNameAr: item.account.nameAr, accountNameEn: localizedFallback(item.account.nameEn, item.account.nameAr), debit: money(item.debitAmount), credit: money(item.creditAmount), description: item.description })),
      },
    };
  }

  private async readyRun(context: TrustedCompanyActorContext, reportRunId: string) {
    const run = await this.reportRuns.findReady(context, reportRunId);
    if (run.reportCode !== REPORT_CODE || run.definitionVersion !== DEFINITION_VERSION || run.eligibleEntryPredicateVersion !== SEALED_LEDGER_ENTRY_PREDICATE_VERSION) throw new BadRequestException('The report run does not match the supported Ledger Trial Balance policy.');
    const parsed = ledgerTrialBalanceRequestSchema.safeParse(run.canonicalOptionsJson);
    if (!parsed.success) throw new BadRequestException('The report run has invalid canonical Trial Balance options.');
    return { run, request: { from: businessDate(parsed.data.from), to: businessDate(parsed.data.to), includeZeroRows: parsed.data.includeZeroRows } };
  }
}

function ledgerPredicate(context: TrustedCompanyActorContext, revision: bigint): Prisma.FinanceJournalEntryWhereInput {
  return { tenantId: context.tenantId, companyId: context.companyId, isSealed: true, status: { in: [FinanceJournalEntryStatus.POSTED, FinanceJournalEntryStatus.REVERSED] }, ledgerRevision: { lte: revision } };
}
export function calculateTrialAmounts(opening: Aggregate | undefined, period: Aggregate | undefined): TrialAmounts {
  const openingDebit = decimal(opening?.debitAmount); const openingCredit = decimal(opening?.creditAmount);
  const periodDebit = decimal(period?.debitAmount); const periodCredit = decimal(period?.creditAmount);
  const openingNet = openingDebit.minus(openingCredit);
  const closingNet = openingNet.plus(periodDebit).minus(periodCredit);
  return { openingDebit: openingNet.gt(0) ? openingNet : zero(), openingCredit: openingNet.lt(0) ? openingNet.negated() : zero(), periodDebit, periodCredit, closingDebit: closingNet.gt(0) ? closingNet : zero(), closingCredit: closingNet.lt(0) ? closingNet.negated() : zero() };
}
function zeroAmounts(): TrialAmounts { return { openingDebit: zero(), openingCredit: zero(), periodDebit: zero(), periodCredit: zero(), closingDebit: zero(), closingCredit: zero() }; }
function addAmounts(left: TrialAmounts, right: TrialAmounts): TrialAmounts { return { openingDebit: left.openingDebit.plus(right.openingDebit), openingCredit: left.openingCredit.plus(right.openingCredit), periodDebit: left.periodDebit.plus(right.periodDebit), periodCredit: left.periodCredit.plus(right.periodCredit), closingDebit: left.closingDebit.plus(right.closingDebit), closingCredit: left.closingCredit.plus(right.closingCredit) }; }
function displayAmounts(value: TrialAmounts) { return { openingDebit: money(value.openingDebit), openingCredit: money(value.openingCredit), periodDebit: money(value.periodDebit), periodCredit: money(value.periodCredit), closingDebit: money(value.closingDebit), closingCredit: money(value.closingCredit) }; }
function trialEvidence(accountId?: string) {
  const metric = (scope: 'OPENING' | 'PERIOD' | 'CLOSING', side: 'DEBIT' | 'CREDIT') => accountId
    ? { reportCode: 'ledger_trial_balance' as const, metric: { kind: 'TRIAL_ACCOUNT' as const, accountId, scope, side } }
    : { reportCode: 'ledger_trial_balance' as const, metric: { kind: 'TRIAL_TOTAL' as const, scope, side } };
  return {
    openingDebit: metric('OPENING', 'DEBIT'), openingCredit: metric('OPENING', 'CREDIT'),
    periodDebit: metric('PERIOD', 'DEBIT'), periodCredit: metric('PERIOD', 'CREDIT'),
    closingDebit: metric('CLOSING', 'DEBIT'), closingCredit: metric('CLOSING', 'CREDIT'),
  };
}
function isZero(value: TrialAmounts) { return Object.values(value).every((amount) => amount.isZero()); }
export function isEligibleTrialBalanceAccount(account: { status: string; isSystem: boolean }, hasHistoricalEvidence: boolean, amounts: TrialAmounts, includeZeroRows: boolean) { if (!(account.status === 'ACTIVE' || account.isSystem || hasHistoricalEvidence)) return false; return includeZeroRows || !isZero(amounts); }
function assertBalanced(value: TrialAmounts) { for (const [debit, credit] of [['openingDebit', 'openingCredit'], ['periodDebit', 'periodCredit'], ['closingDebit', 'closingCredit']] as const) if (!value[debit].equals(value[credit])) throw new BadRequestException('The Trial Balance is not balanced for the eligible ledger scope.'); }
function metadataFor(source: { company: { nameAr: string; nameEn: string; businessTimezone: string }; profile: { functionalCurrencyCode: string } }, request: TrialBalanceRequest, ledgerRevision: bigint) { return { reportCode: REPORT_CODE, definitionVersion: DEFINITION_VERSION, dataMode: 'LIVE' as const, ledgerRevision: ledgerRevision.toString(), company: { displayName: source.company.nameAr || source.company.nameEn, functionalCurrency: source.profile.functionalCurrencyCode }, businessTimezone: source.company.businessTimezone, selectedPeriod: { from: dateText(request.from), to: dateText(request.to) }, economicAsOfDate: dateText(request.to), basisLabelAr: 'دفتر الأستاذ — القيود المختومة', sourceKindAr: 'قيود دفتر مختومة', cancellationTreatmentAr: 'يبقى أصل العملية في تاريخه الاقتصادي، ويبدأ أثر الإلغاء من تاريخ عمل قيد الإلغاء.', dataCoverage: { state: 'COMPLETE' as const }, reconciliation: { state: 'RECONCILED' as const, messageAr: 'تساوت إجماليات المدين والدائن للافتتاح والحركة والختام.' }, roundingRule: 'تُحسب المبالغ بأربع منازل عشرية وتُعرض بمنزلتين عشريتين.' }; }
function scopeDateFilter(scope: 'OPENING' | 'PERIOD' | 'CLOSING', request: TrialBalanceRequest) { return scope === 'OPENING' ? { lt: request.from } : scope === 'PERIOD' ? { gte: request.from, lte: request.to } : { lte: request.to }; }
function journalLabel(entry: Parameters<typeof financeJournalPresentation>[0]) { return financeJournalPresentation(entry); }
function localizedFallback(value: string | null | undefined, fallback: string) { return value?.trim() || fallback; }
function cancellationLabel(entry: { sourceType: string; reversalEntry?: { ledgerRevision: bigint } | null }, reportRevision: bigint) { if (entry.sourceType === 'journal_reversal') return 'قيد إلغاء'; return entry.reversalEntry && entry.reversalEntry.ledgerRevision <= reportRevision ? 'ملغى' : null; }
function money(value: Prisma.Decimal) { const sign = value.gt(0) ? 'positive' as const : value.lt(0) ? 'negative' as const : 'zero' as const; return { raw: value.toFixed(4), display: value.abs().toFixed(2), sign }; }
function decimal(value: Prisma.Decimal | null | undefined) { return value ?? zero(); }
function zero() { return new Prisma.Decimal(0); }
function businessDate(value: string) { const parsed = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) throw new BadRequestException('A valid YYYY-MM-DD business date is required.'); return parsed; }
function dateText(value: Date) { return value.toISOString().slice(0, 10); }
function assertPeriod(value: TrialBalanceRequest) { if (!(value.from instanceof Date) || Number.isNaN(value.from.valueOf()) || !(value.to instanceof Date) || Number.isNaN(value.to.valueOf()) || value.from > value.to) throw new BadRequestException('A valid continuous Trial Balance period is required.'); }
function encodeCursor(line: { businessDate: Date; createdAt: Date; lineNumber: number; id: string }) { return Buffer.from(JSON.stringify({ businessDate: dateText(line.businessDate), createdAt: line.createdAt.toISOString(), lineNumber: line.lineNumber, id: line.id })).toString('base64url'); }
function decodeCursor(value: string) { try { const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as { businessDate?: unknown; createdAt?: unknown; lineNumber?: unknown; id?: unknown }; const business = typeof parsed.businessDate === 'string' ? businessDate(parsed.businessDate) : null; const created = typeof parsed.createdAt === 'string' ? new Date(parsed.createdAt) : null; const lineNumber = typeof parsed.lineNumber === 'number' ? parsed.lineNumber : null; const id = typeof parsed.id === 'string' ? parsed.id : null; if (!business || !created || Number.isNaN(created.valueOf()) || lineNumber === null || !Number.isInteger(lineNumber) || !id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error(); return { businessDate: business, createdAt: created, lineNumber, id }; } catch { throw new BadRequestException('The Trial Balance evidence cursor is invalid.'); } }
