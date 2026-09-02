import { createHash, randomUUID } from 'node:crypto';

import { accrualProfitLossRequestSchema } from '@baseer-erp/contracts';
import type { ReportLocale, ReportSnapshot } from '@baseer-erp/output-platform';
import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { BusinessDateService } from '../business-date/business-date.service.js';
import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { DatabaseService } from '../database/database.service.js';
import { REPORTING_R0_A_POLICY_VERSION } from '../finance/finance-pnl-mapping.service.js';
import { financeJournalPresentation } from '../finance/finance-journal-presentation.js';
import {
  FinanceAccountStatus,
  FinanceAccountType,
  FinanceCashPerformanceDirection,
  FinanceCashPerformanceEventKind,
  FinanceJournalEntryStatus,
  FinancePnlMappingVersionStatus,
  FinancePnlPresentationSign,
  HrPayrollRunStatus,
  Prisma,
} from '../generated/prisma/client.js';
import { ReportRunService, SEALED_LEDGER_ENTRY_PREDICATE_VERSION } from './report-run.service.js';
import { PersonalCashPerformanceReportService, type CollectedSalesByVault } from './personal-cash-performance-report.service.js';

const REPORT_CODE = 'accrual_profit_loss';
const DEFINITION_VERSION = 'accrual_profit_loss_v1';
const MAX_INTERACTIVE_DAYS = 366;
// Keep opaque source ids in the sealed ledger for lineage, but always pass a
// human-readable operation reference to financial-report readers.
const journalPresentationSelect = {
  outflowDocument: { select: { documentNumber: true, kind: true, supplierNameSnapshotAr: true, supplierNameSnapshotEn: true, supplier: { select: { nameAr: true, nameEn: true } } } },
  hrPayrollAccrual: { select: { runNumber: true } },
  hrPayrollPayment: { select: { paymentNumber: true, payrollRun: { select: { runNumber: true } } } },
  hrEmployeeAdvanceIssue: { select: { advanceNumber: true, employee: { select: { nameAr: true, nameEn: true } } } },
  hrEmployeeAdvanceSettlements: { take: 1, select: { source: true, advance: { select: { advanceNumber: true, employee: { select: { nameAr: true, nameEn: true } } } } } },
  hrFinalSettlementAccrual: { select: { settlementNumber: true, employee: { select: { nameAr: true, nameEn: true } } } },
  hrFinalSettlementPayment: { select: { paymentNumber: true, settlement: { select: { settlementNumber: true, employee: { select: { nameAr: true, nameEn: true } } } } } },
  dailySalesClosing: { select: { documentNumber: true } },
  vatSettlement: { select: { referenceNumber: true } },
} satisfies Prisma.FinanceJournalEntrySelect;

type Request = Readonly<{ from: Date; to: Date; months?: readonly string[]; vatInclusive?: boolean }>;
type StatementRow = Readonly<{
  statementLineId: string;
  code: string;
  nameAr: string;
  nameEn: string;
  section: 'REVENUE' | 'EXPENSE';
  presentationNature: 'REVENUE' | 'COST_OF_SALES' | 'OPERATING_INCOME' | 'OPERATING_EXPENSE' | 'INVESTING' | 'FINANCING' | 'INCOME_TAX' | 'DISCONTINUED_OPERATIONS';
  sortOrder: number;
  amount: Prisma.Decimal;
}>;
type Mapping = Readonly<{
  id: string;
  versionNumber: number;
  policyVersion: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  checksum: string;
  statementLines: readonly Readonly<{
    id: string;
    code: string;
    nameAr: string;
    nameEn: string;
    presentationNature: StatementRow['presentationNature'];
    sortOrder: number;
    isSubtotal: boolean;
    accountMappings: readonly Readonly<{
      accountId: string;
      presentationSign: FinancePnlPresentationSign;
      account: Readonly<{ id: string; type: FinanceAccountType; status: FinanceAccountStatus }>;
    }>[];
  }>[];
}>;
type VatPresentationAudit = Readonly<{
  scope: 'ALL_REVENUE_AND_EXPENSE';
  state: 'COMPLETE' | 'INCOMPLETE';
  adjustedJournalCount: number;
  unresolvedJournalCount: number;
  warningAr: string | null;
}>;
type AccrualEvidenceItem = Readonly<{
  journalEntryId: string;
  statementLineId: string;
  section: 'REVENUE' | 'EXPENSE';
  businessDate: Date;
  amount: Prisma.Decimal;
  sourceLabelAr: string;
  sourceLabelEn: string;
  sourceReference: string;
  description: string | null;
  counterparty: Counterparty | null;
}>;
type Counterparty = Readonly<{ labelAr: string; labelEn: string }>;
export type AccrualProfitLossCoverage = Readonly<{
  state: 'COMPLETE' | 'APPROVED_HISTORICAL_EXCEPTION';
  sourceKind: 'sealed_ledger_revenue_expense_lines';
  warningAr: string | null;
  historicalCashBasisPayrollRuns: number;
}>;

@Injectable()
export class AccrualProfitLossReportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly reportRuns: ReportRunService,
    private readonly dates: BusinessDateService,
    private readonly cashPerformance: PersonalCashPerformanceReportService,
  ) {}

  async run(context: TrustedCompanyActorContext, request: Request) {
    await this.assertRequest(context, request);
    const normalized = normalizeRequest(request);
    const source = await this.source(context);
    if (!source.company || !source.profile) return { state: 'NOT_READY' as const, messageAr: 'هذا التقرير غير متاح بعد لأن إعداد الشركة المالي غير مكتمل.' };
    const mapping = await this.mappingForPeriod(context, request);
    if (!mapping) return { state: 'NOT_READY' as const, messageAr: 'لا توجد خريطة ربح وخسارة معتمدة ومكتملة تغطي هذه الفترة.' };
    const [ledgerRevision, coverage] = await Promise.all([
      this.reportRuns.currentLedgerRevision(context),
      this.coverage(context, request),
    ]);
    const [{ rows, vatPresentation }, salesByVault] = await Promise.all([
      this.rows(context, normalized, ledgerRevision, mapping),
      this.cashPerformance.collectedSalesByVaultAtRevision(context, ledgerRevision, normalized),
    ]);
    const comparisonPeriods = comparisonMonthPeriods(normalized);
    const periodComparison = comparisonPeriods.length < 2 ? null : await this.periodComparison(context, ledgerRevision, mapping, normalized, comparisonPeriods, rows, salesByVault);
    return this.result(source, normalized, ledgerRevision, mapping, coverage, rows, vatPresentation, salesByVault, periodComparison);
  }

  /** Replays the report mapping and VAT basis for an exact P&L drill-down. */
  async liveEvidence(context: TrustedCompanyActorContext, request: Request, target: string, cursor?: string) {
    await this.assertRequest(context, request);
    const normalized = normalizeRequest(request);
    const mapping = await this.mappingForPeriod(context, normalized);
    if (!mapping) throw new BadRequestException('The accrual profit-and-loss presentation mapping is unavailable for this period.');
    const targetFilter = pnlEvidenceTarget(target, mapping);
    const ledgerRevision = await this.reportRuns.currentLedgerRevision(context);
    const { evidence } = await this.rows(context, normalized, ledgerRevision, mapping);
    const items = evidence
      .filter((item) => targetFilter(item))
      .sort((left, right) => dateText(left.businessDate).localeCompare(dateText(right.businessDate)) || left.journalEntryId.localeCompare(right.journalEntryId));
    const parsedCursor = cursor ? accrualEvidenceCursor(cursor) : null;
    if (parsedCursor && !items.some((item) => item.journalEntryId === parsedCursor.journalEntryId && dateText(item.businessDate) === parsedCursor.businessDate)) throw new BadRequestException('The accrual profit-and-loss evidence cursor is outside this report scope.');
    const afterCursor = parsedCursor ? items.filter((item) => dateText(item.businessDate) > parsedCursor.businessDate || (dateText(item.businessDate) === parsedCursor.businessDate && item.journalEntryId > parsedCursor.journalEntryId)) : items;
    const page = afterCursor.slice(0, 100);
    const last = page.at(-1);
    return {
      target,
      nextCursor: afterCursor.length > page.length && last ? `${dateText(last.businessDate)}:${last.journalEntryId}` : null,
      items: page.map((item) => ({ journalEntryId: item.journalEntryId, businessDate: dateText(item.businessDate), amount: money(item.amount), source: { labelAr: item.sourceLabelAr, labelEn: item.sourceLabelEn, reference: item.sourceReference, description: item.description, counterparty: item.counterparty } })),
    };
  }

  /** Opens the actual sealed journal behind a P&L evidence row. */
  async liveSourceJournal(context: TrustedCompanyActorContext, request: Request, journalEntryId: string) {
    await this.assertRequest(context, request);
    const normalized = normalizeRequest(request);
    const ledgerRevision = await this.reportRuns.currentLedgerRevision(context);
    const journal = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.financeJournalEntry.findFirst({
      where: { id: journalEntryId, ...ledgerPredicate(context, ledgerRevision), ...journalPeriodPredicate(normalized) },
      select: {
        id: true, businessDate: true, sourceType: true, sourceReference: true, description: true, status: true,
        ...journalPresentationSelect,
        lines: { orderBy: { lineNumber: 'asc' }, select: { id: true, lineNumber: true, debitAmount: true, creditAmount: true, account: { select: { code: true, nameAr: true, nameEn: true } } } },
      },
    }));
    if (!journal) throw new BadRequestException('The source journal is not available for this report period.');
    const presentation = financeJournalPresentation(journal);
    return {
      journalEntry: {
        id: journal.id, businessDate: dateText(journal.businessDate), labelAr: presentation.labelAr, labelEn: presentation.labelEn,
        sourceReference: presentation.reference, description: journal.description, counterparty: journalCounterparty(journal),
        status: journal.status === FinanceJournalEntryStatus.REVERSED ? 'REVERSED' as const : 'POSTED' as const,
        lines: journal.lines.map((line) => ({
          id: line.id, lineNumber: line.lineNumber, accountCode: line.account.code, accountNameAr: line.account.nameAr, accountNameEn: localizedFallback(line.account.nameEn, line.account.nameAr),
          debitAmount: line.debitAmount.toFixed(4), creditAmount: line.creditAmount.toFixed(4), debit: money(line.debitAmount), credit: money(line.creditAmount), description: null,
        })),
      },
    };
  }

  async issueOfficialRun(context: TrustedCompanyActorContext, request: Request) {
    await this.assertRequest(context, request);
    const normalized = normalizeRequest(request);
    const mapping = await this.mappingForPeriod(context, request);
    if (!mapping) throw new ConflictException('An approved and complete P&L mapping must cover the full report period.');
    const coverage = await this.coverage(context, request);
    return this.reportRuns.create(context, {
      reportCode: REPORT_CODE,
      definitionVersion: DEFINITION_VERSION,
      canonicalOptions: { from: dateText(request.from), to: dateText(request.to), ...(normalized.months.length ? { months: normalized.months } : {}), vatInclusive: normalized.vatInclusive },
      economicAsOfDate: request.to,
      sourceCoverage: coverage,
      accountMappingVersionId: mapping.id,
      accountMappingChecksum: mapping.checksum,
    });
  }

  async snapshotForDocument(context: TrustedCompanyActorContext, reportRunId: string, locale: ReportLocale): Promise<ReportSnapshot> {
    const { run, request, mapping, coverage } = await this.readyRun(context, reportRunId);
    const source = await this.source(context);
    if (!source.company || !source.profile) throw new NotFoundException('The company report source is unavailable.');
    const [{ rows, vatPresentation }, salesByVault] = await Promise.all([
      this.rows(context, request, run.ledgerRevision, mapping),
      this.cashPerformance.collectedSalesByVaultAtRevision(context, run.ledgerRevision, request),
    ]);
    const totals = calculateTotals(rows);
    const ar = locale === 'ar';
    const generatedAt = (await this.dates.currentForTrustedContext(context)).generatedAt;
    const warningRow = coverage.warningAr
      ? [{ section: ar ? 'تنبيه التغطية' : 'Coverage notice', account: ar ? coverage.warningAr : 'Approved historical payroll cash-basis treatment applies to part of this period.', amount: '0.0000' }]
      : [];
    return {
      snapshotId: randomUUID(), reportCode: REPORT_CODE, templateVersion: DEFINITION_VERSION,
      title: ar ? 'الربح والخسارة — القيود المثبتة' : 'Profit and loss — posted ledger', direction: ar ? 'rtl' : 'ltr', locale,
      generatedAtRiyadh: generatedAt,
      companies: [{ id: source.company.id, name: ar ? source.company.nameAr : source.company.nameEn || source.company.nameAr }],
      periodLabel: request.months.length ? request.months.join('، ') : `${dateText(request.from)} — ${dateText(request.to)}`,
      taxPresentation: request.vatInclusive ? 'gross' : 'taxSeparated',
      sourceLabel: ar
        ? `دفتر الأستاذ · ${request.vatInclusive ? 'شامل الضريبة' : 'بدون الضريبة'} · خريطة عرض ${mapping.versionNumber} · ${source.profile.functionalCurrencyCode} · مراجعة ${run.ledgerRevision.toString()}`
        : `General ledger · ${request.vatInclusive ? 'VAT inclusive' : 'excluding VAT'} · presentation mapping ${mapping.versionNumber} · ${source.profile.functionalCurrencyCode} · revision ${run.ledgerRevision.toString()}`,
      columns: [
        { key: 'section', label: ar ? 'القسم' : 'Section', kind: 'text', width: 20 },
        { key: 'account', label: ar ? 'البند المالي' : 'Financial item', kind: 'text', width: 46 },
        { key: 'amount', label: ar ? 'المبلغ' : 'Amount', kind: 'amount', width: 20 },
      ],
      rows: [
        ...warningRow,
        ...(vatPresentation.warningAr ? [{ section: ar ? 'تنبيه الضريبة' : 'VAT notice', account: ar ? vatPresentation.warningAr : 'Some journals do not have enough tax evidence for a complete VAT presentation.', amount: '0.0000' }] : []),
        ...rows.map((row) => ({ section: row.section === 'REVENUE' ? (ar ? 'الإيرادات' : 'Revenue') : (ar ? 'المصروفات' : 'Expenses'), account: `${row.code} · ${ar ? row.nameAr : row.nameEn || row.nameAr}`, amount: row.amount.toFixed(4) })),
        ...salesByVault.rows.map((row) => ({ section: ar ? 'المبيعات حسب الخزينة' : 'Sales by vault', account: ar ? row.vaultNameAr : row.vaultNameEn || row.vaultNameAr, amount: (request.vatInclusive ? row.grossAmount : row.netAmount).toFixed(4) })),
        { section: ar ? 'الإجمالي' : 'Total', account: ar ? 'صافي الربح أو الخسارة' : 'Net profit or loss', amount: totals.netProfit.toFixed(4) },
      ],
    };
  }

  private async readyRun(context: TrustedCompanyActorContext, reportRunId: string) {
    const run = await this.reportRuns.findReady(context, reportRunId);
    if (run.reportCode !== REPORT_CODE || run.definitionVersion !== DEFINITION_VERSION || run.eligibleEntryPredicateVersion !== SEALED_LEDGER_ENTRY_PREDICATE_VERSION) throw new BadRequestException('The report run does not match the supported accrual profit-and-loss policy.');
    if (!run.accountMappingVersionId || !run.accountMappingChecksum) throw new BadRequestException('The official P&L run does not retain its presentation mapping.');
    const parsed = accrualProfitLossRequestSchema.safeParse(run.canonicalOptionsJson);
    if (!parsed.success) throw new BadRequestException('The report run has invalid canonical accrual profit-and-loss options.');
    const request = { from: businessDate(parsed.data.from), to: businessDate(parsed.data.to), months: parsed.data.months ?? [], vatInclusive: parsed.data.vatInclusive };
    const mapping = await this.mappingByIdentity(context, run.accountMappingVersionId, run.accountMappingChecksum, request);
    if (!mapping) throw new BadRequestException('The presentation mapping retained by this official P&L run is unavailable or no longer verifiable.');
    return { run, request, mapping, coverage: coverageFromJson(run.sourceCoverageJson) };
  }

  private async assertRequest(context: TrustedCompanyActorContext, request: Request) {
    if (!(request.from instanceof Date) || Number.isNaN(request.from.valueOf()) || !(request.to instanceof Date) || Number.isNaN(request.to.valueOf()) || request.from > request.to) throw new BadRequestException('A valid accrual profit-and-loss period is required.');
    if (days(request) > MAX_INTERACTIVE_DAYS) throw new BadRequestException('The accrual profit-and-loss interactive period cannot exceed one year.');
    const current = await this.dates.currentForTrustedContext(context);
    if (request.to > businessDate(current.businessDate)) throw new BadRequestException('The accrual profit-and-loss end date cannot be after the current business date.');
  }

  private source(context: TrustedCompanyActorContext) {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [company, profile] = await Promise.all([
        transaction.company.findFirst({ where: { id: context.companyId, tenantId: context.tenantId }, select: { id: true, nameAr: true, nameEn: true, businessTimezone: true } }),
        transaction.companyFinanceProfile.findFirst({ where: { companyId: context.companyId, tenantId: context.tenantId }, select: { functionalCurrencyCode: true } }),
      ]);
      return { company, profile };
    });
  }

  mappingForPeriod(context: TrustedCompanyActorContext, request: Request): Promise<Mapping | null> {
    return this.mapping(context, request, undefined, undefined);
  }

  private mappingByIdentity(context: TrustedCompanyActorContext, id: string, checksum: string, request: Request): Promise<Mapping | null> {
    return this.mapping(context, request, id, checksum);
  }

  private async mapping(context: TrustedCompanyActorContext, request: Request, id?: string, checksum?: string): Promise<Mapping | null> {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const frozenIdentity = id !== undefined && checksum !== undefined ? { id, checksum } : null;
      const version = await transaction.financePnlMappingVersion.findFirst({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          ...(frozenIdentity
            ? frozenIdentity
            : { status: { in: [FinancePnlMappingVersionStatus.APPROVED, FinancePnlMappingVersionStatus.SUPERSEDED] } }),
          effectiveFrom: { lte: request.from },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: request.to } }],
        },
        include: {
          statementLines: {
            orderBy: { sortOrder: 'asc' },
            include: { accountMappings: { include: { account: { select: { id: true, type: true, status: true } } } } },
          },
        },
        orderBy: { versionNumber: 'desc' },
      });
      if (!version?.checksum) return null;
      const frozenContent = mappingChecksumContent(version as Mapping);
      if (!verifyAccrualProfitLossMappingSnapshot(frozenContent, frozenIdentity ?? { id: version.id, checksum: version.checksum })) return null;

      // A live report must always reflect the current chart of accounts. An
      // official run is different: its boundary is the mapping identity and
      // checksum captured when the run was issued. Adding a new active account
      // later must not invalidate that already-frozen document.
      if (!frozenIdentity) {
        const activeAccounts = await transaction.financeAccount.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, status: FinanceAccountStatus.ACTIVE, type: { in: [FinanceAccountType.REVENUE, FinanceAccountType.EXPENSE] } },
          select: { id: true },
        });
        const mappedAccountIds = version.statementLines.flatMap((line) => line.accountMappings.map((item) => item.accountId));
        if (!hasCompleteAccrualProfitLossAccountCoverage(mappedAccountIds, activeAccounts.map((account) => account.id))) return null;
      }
      return version as Mapping;
    });
  }

  private async coverage(context: TrustedCompanyActorContext, request: Request): Promise<AccrualProfitLossCoverage> {
    const normalized = normalizeRequest(request);
    const historicalCashBasisPayrollRuns = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.hrPayrollRun.count({
      where: {
        tenantId: context.tenantId,
        companyId: context.companyId,
        ...payrollMonthPredicate(normalized),
        status: { in: [HrPayrollRunStatus.APPROVED, HrPayrollRunStatus.PARTIALLY_PAID, HrPayrollRunStatus.PAID] },
        accrualJournalEntryId: null,
      },
    }));
    return accrualProfitLossCoverageForHistoricalPayrollRuns(historicalCashBasisPayrollRuns);
  }

  private async rows(context: TrustedCompanyActorContext, request: Required<Request>, ledgerRevision: bigint, mapping: Mapping): Promise<Readonly<{ rows: StatementRow[]; vatPresentation: VatPresentationAudit; evidence: readonly AccrualEvidenceItem[] }>> {
    const mappedAccounts = new Map(mapping.statementLines.flatMap((line) => line.accountMappings.map((item) => [item.accountId, {
      statementLineId: line.id,
      section: item.account.type === FinanceAccountType.REVENUE ? 'REVENUE' as const : 'EXPENSE' as const,
      presentationSign: item.presentationSign,
    }])));
    const source = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const movements = await transaction.financeJournalLine.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          accountId: { in: [...mappedAccounts.keys()] },
          journalEntry: { is: { ...ledgerPredicate(context, ledgerRevision), ...journalPeriodPredicate(request) } },
        },
        select: {
          accountId: true, debitAmount: true, creditAmount: true,
          journalEntry: { select: { id: true, businessDate: true, sourceType: true, sourceReference: true, description: true, ...journalPresentationSelect, cashPerformanceEvent: { select: { kind: true, direction: true, grossAmount: true, netAmount: true, vatAmount: true, vatBreakdownKnown: true } } } },
        },
      });
      const journalIds = [...new Set(movements.map((movement) => movement.journalEntry.id))];
      const vatLines = journalIds.length ? await transaction.financeJournalLine.findMany({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          journalEntryId: { in: journalIds },
          account: { is: { systemKey: { in: ['VAT_INPUT', 'VAT_OUTPUT'] } } },
        },
        select: { journalEntryId: true, debitAmount: true, creditAmount: true, account: { select: { systemKey: true } } },
      }) : [];
      return { movements, vatLines };
    });
    const contributions: JournalContribution[] = source.movements.flatMap((movement) => {
      const mapped = mappedAccounts.get(movement.accountId);
      if (!mapped) return [];
      const amount = mapped.presentationSign === FinancePnlPresentationSign.CREDIT_NATURE
        ? movement.creditAmount.minus(movement.debitAmount)
        : movement.debitAmount.minus(movement.creditAmount);
      return [{ journalEntryId: movement.journalEntry.id, statementLineId: mapped.statementLineId, section: mapped.section, amount, event: movement.journalEntry.cashPerformanceEvent }];
    });
    const vatByJournal = new Map<string, JournalVat>();
    for (const line of source.vatLines) {
      const current = vatByJournal.get(line.journalEntryId) ?? { input: zero(), output: zero() };
      if (line.account.systemKey === 'VAT_INPUT') current.input = current.input.plus(line.debitAmount.minus(line.creditAmount));
      if (line.account.systemKey === 'VAT_OUTPUT') current.output = current.output.plus(line.creditAmount.minus(line.debitAmount));
      vatByJournal.set(line.journalEntryId, current);
    }
    const adjusted = applyVatPresentationToJournalContributions(contributions, vatByJournal, request.vatInclusive);
    const rows = mapping.statementLines.flatMap((line) => {
      if (line.isSubtotal || !line.accountMappings.length) return [];
      const amount = adjusted.amountByStatementLine.get(line.id) ?? zero();
      if (amount.isZero()) return [];
      const section = line.accountMappings[0]!.account.type === FinanceAccountType.REVENUE ? 'REVENUE' as const : 'EXPENSE' as const;
      return [{ statementLineId: line.id, code: line.code, nameAr: line.nameAr, nameEn: line.nameEn, section, presentationNature: line.presentationNature, sortOrder: line.sortOrder, amount }];
    }).sort((left, right) => sectionOrder(left.section) - sectionOrder(right.section) || left.sortOrder - right.sortOrder);
    const journalMeta = new Map(source.movements.map((movement) => [movement.journalEntry.id, movement.journalEntry]));
    const evidence = [...adjusted.amountByJournalStatementLine.entries()].flatMap(([journalEntryId, lineAmounts]) => {
      const journal = journalMeta.get(journalEntryId);
      if (!journal) return [];
      return [...lineAmounts.entries()].flatMap(([statementLineId, amount]) => {
        if (amount.isZero()) return [];
        const statementLine = mapping.statementLines.find((line) => line.id === statementLineId);
        const section = statementLine?.accountMappings[0]?.account.type === FinanceAccountType.REVENUE ? 'REVENUE' as const : 'EXPENSE' as const;
        const presentation = financeJournalPresentation(journal);
        return [{ journalEntryId, statementLineId, section, businessDate: journal.businessDate, amount, sourceLabelAr: presentation.labelAr, sourceLabelEn: presentation.labelEn, sourceReference: presentation.reference, description: journal.description, counterparty: journalCounterparty(journal) } satisfies AccrualEvidenceItem];
      });
    });
    return { rows, vatPresentation: adjusted.audit, evidence };
  }

  /** Each comparison column is independently calculated on the server at the
   * same sealed-ledger revision as the selected-period total. */
  private async periodComparison(context: TrustedCompanyActorContext, ledgerRevision: bigint, mapping: Mapping, request: Required<Request>, columns: readonly MonthPeriod[], totalRows: readonly StatementRow[], totalSalesByVault: CollectedSalesByVault) {
    const reads = await Promise.all(columns.map(async (period) => {
      const periodRequest: Required<Request> = { ...period, months: [], vatInclusive: request.vatInclusive };
      const [{ rows }, salesByVault] = await Promise.all([
        this.rows(context, periodRequest, ledgerRevision, mapping),
        this.cashPerformance.collectedSalesByVaultAtRevision(context, ledgerRevision, periodRequest),
      ]);
      return { rows, salesByVault, totals: calculateTotals(rows) };
    }));
    const zeroAmount = new Prisma.Decimal(0);
    return {
      columns: columns.map(({ key }) => ({ key })),
      rows: totalRows.map((row) => ({
        statementLineId: row.statementLineId,
        amounts: reads.map((read) => money(read.rows.find((candidate) => candidate.statementLineId === row.statementLineId)?.amount ?? zeroAmount)),
      })),
      totals: {
        revenue: reads.map((read) => money(read.totals.revenue)),
        expenses: reads.map((read) => money(read.totals.expenses)),
        netProfit: reads.map((read) => money(read.totals.netProfit)),
        salesVat: reads.map((read) => money(read.salesByVault.vatTotal)),
      },
      salesByVaultTotals: reads.map((read) => money(request.vatInclusive ? read.salesByVault.grossTotal : read.salesByVault.netTotal)),
      salesByVault: totalSalesByVault.rows.map((row) => ({
        vaultId: row.vaultId,
        amounts: reads.map((read) => money((read.salesByVault.rows.find((candidate) => candidate.vaultId === row.vaultId)?.[request.vatInclusive ? 'grossAmount' : 'netAmount']) ?? zeroAmount)),
      })),
    };
  }

  private result(source: Awaited<ReturnType<AccrualProfitLossReportService['source']>>, request: Required<Request>, ledgerRevision: bigint, mapping: Mapping, coverage: AccrualProfitLossCoverage, rows: StatementRow[], vatPresentation: VatPresentationAudit, salesByVault: CollectedSalesByVault, periodComparison: Awaited<ReturnType<AccrualProfitLossReportService['periodComparison']>> | null) {
    const totals = calculateTotals(rows);
    const metadata = {
      reportCode: REPORT_CODE, definitionVersion: DEFINITION_VERSION, dataMode: 'LIVE' as const,
      ledgerRevision: ledgerRevision.toString(),
      company: { displayName: source.company!.nameAr || source.company!.nameEn, functionalCurrency: source.profile!.functionalCurrencyCode },
      businessTimezone: source.company!.businessTimezone,
      selectedPeriod: { from: dateText(request.from), to: dateText(request.to), ...(request.months.length ? { months: request.months } : {}) },
      vatInclusive: request.vatInclusive,
      vatPresentation,
      salesByVault: presentSalesByVault(salesByVault, request.vatInclusive, totals.revenue),
      basisLabelAr: `${coverage.state === 'COMPLETE' ? 'الاستحقاق — القيود المختومة وخريطة عرض معتمدة' : 'القيود المثبتة — مع معالجة نقدية تاريخية معتمدة للرواتب'} · ${request.vatInclusive ? 'جميع الإيرادات والمصروفات شاملة الضريبة' : 'جميع الإيرادات والمصروفات بدون الضريبة'}`,
      cancellationTreatmentAr: 'يبقى أثر العملية في تاريخها، ويبدأ أثر قيد الإلغاء من تاريخ عمله.',
      mappingVersion: { id: mapping.id, versionNumber: mapping.versionNumber, checksum: mapping.checksum },
      dataCoverage: coverage,
      roundingRule: 'تُحسب المبالغ بأربع منازل عشرية وتُعرض بمنزلتين عشريتين.',
    };
    const presented = {
      revenue: money(totals.revenue), expenses: money(totals.expenses), netProfit: money(totals.netProfit),
      revenueShareOfRevenuePercent: percentOfRevenue(totals.revenue, totals.revenue),
      expensesShareOfRevenuePercent: percentOfRevenue(totals.expenses, totals.revenue),
      netProfitShareOfRevenuePercent: percentOfRevenue(totals.netProfit, totals.revenue),
      revenueEvidence: pnlEvidence('REVENUE_TOTAL'),
      expensesEvidence: pnlEvidence('EXPENSES_TOTAL'),
      netProfitEvidence: pnlEvidence('NET_PROFIT'),
    };
    const reportRows = rows.map(({ sortOrder: _sortOrder, ...row }) => ({ ...row, amount: money(row.amount), shareOfRevenuePercent: percentOfRevenue(row.amount, totals.revenue), evidence: pnlEvidence('STATEMENT_LINE', row.statementLineId) }));
    if (!rows.length) return { state: 'NO_DATA' as const, messageAr: 'لا توجد إيرادات أو مصروفات مثبتة ضمن الفترة المحددة.', ...metadata, rows: [], totals: presented };
    return { state: 'READY' as const, ...metadata, rows: reportRows, totals: presented, ...(periodComparison ? { periodComparison } : {}) };
  }
}

export type CashEventSnapshot = Readonly<{
  kind: FinanceCashPerformanceEventKind;
  direction: FinanceCashPerformanceDirection;
  grossAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  vatAmount: Prisma.Decimal;
  vatBreakdownKnown: boolean;
}>;
export type JournalContribution = Readonly<{
  journalEntryId: string;
  statementLineId: string;
  section: 'REVENUE' | 'EXPENSE';
  amount: Prisma.Decimal;
  event: CashEventSnapshot | null;
}>;
export type JournalVat = { input: Prisma.Decimal; output: Prisma.Decimal };

/**
 * Applies the requested VAT basis journal by journal. Source events are the
 * first authority because migrated journals may already contain either gross
 * or net account values. VAT control-account lines are the fallback for
 * accrual journals that do not have a cash-performance event.
 */
export function applyVatPresentationToJournalContributions(
  contributions: readonly JournalContribution[],
  vatByJournal: ReadonlyMap<string, JournalVat>,
  vatInclusive: boolean,
) {
  const journals = new Map<string, { event: CashEventSnapshot | null; lines: Map<string, { statementLineId: string; section: 'REVENUE' | 'EXPENSE'; amount: Prisma.Decimal }> }>();
  for (const contribution of contributions) {
    const journal = journals.get(contribution.journalEntryId) ?? { event: contribution.event, lines: new Map() };
    const current = journal.lines.get(contribution.statementLineId);
    journal.lines.set(contribution.statementLineId, current
      ? { ...current, amount: current.amount.plus(contribution.amount) }
      : { statementLineId: contribution.statementLineId, section: contribution.section, amount: contribution.amount });
    journals.set(contribution.journalEntryId, journal);
  }
  const amountByStatementLine = new Map<string, Prisma.Decimal>();
  const amountByJournalStatementLine = new Map<string, Map<string, Prisma.Decimal>>();
  let adjustedJournalCount = 0;
  let unresolvedJournalCount = 0;
  for (const [journalId, journal] of journals) {
    const selected = new Map([...journal.lines].map(([key, value]) => [key, { ...value }]));
    const targetSection = eventSection(journal.event?.kind);
    let adjusted = false;
    let unresolved = false;
    if (journal.event && targetSection && !journal.event.grossAmount.equals(journal.event.netAmount)) {
      const candidates = [...selected.values()].filter((line) => line.section === targetSection);
      const base = candidates.reduce((sum, line) => sum.plus(line.amount), zero());
      const magnitude = base.abs();
      if (!journal.event.vatBreakdownKnown || magnitude.isZero()) unresolved = true;
      else if (moneyEqual(magnitude, journal.event.netAmount) || moneyEqual(magnitude, journal.event.grossAmount)) {
        const target = vatInclusive ? journal.event.grossAmount : journal.event.netAmount;
        if (!moneyEqual(magnitude, target)) {
          const ratio = target.div(magnitude);
          for (const line of candidates) selected.set(line.statementLineId, { ...line, amount: line.amount.mul(ratio) });
          adjusted = true;
        }
      } else unresolved = true;
    } else if (!journal.event || !targetSection) {
      const vat = vatByJournal.get(journalId);
      if (vatInclusive && vat) {
        for (const section of ['REVENUE', 'EXPENSE'] as const) {
          const tax = section === 'REVENUE' ? vat.output : vat.input;
          const candidates = [...selected.values()].filter((line) => line.section === section);
          const weight = candidates.reduce((sum, line) => sum.plus(line.amount.abs()), zero());
          if (tax.isZero() || weight.isZero()) continue;
          for (const line of candidates) {
            const current = selected.get(line.statementLineId)!;
            selected.set(line.statementLineId, { ...current, amount: current.amount.plus(tax.mul(line.amount.abs()).div(weight)) });
          }
          adjusted = true;
        }
      }
    }
    if (adjusted) adjustedJournalCount += 1;
    if (unresolved) unresolvedJournalCount += 1;
    const journalAmounts = new Map<string, Prisma.Decimal>();
    for (const line of selected.values()) {
      amountByStatementLine.set(line.statementLineId, (amountByStatementLine.get(line.statementLineId) ?? zero()).plus(line.amount));
      journalAmounts.set(line.statementLineId, line.amount);
    }
    amountByJournalStatementLine.set(journalId, journalAmounts);
  }
  const audit: VatPresentationAudit = {
    scope: 'ALL_REVENUE_AND_EXPENSE',
    state: unresolvedJournalCount ? 'INCOMPLETE' : 'COMPLETE',
    adjustedJournalCount,
    unresolvedJournalCount,
    warningAr: unresolvedJournalCount ? `تعذر تحديد أساس الضريبة في ${unresolvedJournalCount} قيدًا؛ بقيت مبالغها كما هي ولم تُقدّر الضريبة.` : null,
  };
  return { amountByStatementLine, amountByJournalStatementLine, audit };
}

function eventSection(kind: FinanceCashPerformanceEventKind | undefined): 'REVENUE' | 'EXPENSE' | null {
  if (kind === FinanceCashPerformanceEventKind.SALES_COLLECTION) return 'REVENUE';
  if (kind === FinanceCashPerformanceEventKind.PURCHASE_PAYMENT || kind === FinanceCashPerformanceEventKind.OPERATING_EXPENSE_PAYMENT) return 'EXPENSE';
  return null;
}

function moneyEqual(left: Prisma.Decimal, right: Prisma.Decimal) {
  return left.minus(right).abs().lte(new Prisma.Decimal('0.0001'));
}

function normalizeRequest(request: Request): Required<Request> {
  return { ...request, months: request.months ? [...request.months].sort() : [], vatInclusive: request.vatInclusive ?? false };
}

function presentSalesByVault(source: CollectedSalesByVault, vatInclusive: boolean, revenue: Prisma.Decimal) {
  return {
    sourceKind: 'SEALED_SALES_VAULT_LINES' as const,
    grossTotal: money(source.grossTotal),
    netTotal: money(source.netTotal),
    vatTotal: money(source.vatTotal),
    displayedTotal: money(vatInclusive ? source.grossTotal : source.netTotal),
    shareOfRevenuePercent: percentOfRevenue(vatInclusive ? source.grossTotal : source.netTotal, revenue),
    evidence: cashEvidence('sales'),
    rows: source.rows.map((row) => ({
      vaultId: row.vaultId,
      vaultNameAr: row.vaultNameAr,
      vaultNameEn: row.vaultNameEn,
      eventCount: row.eventCount,
      grossAmount: money(row.grossAmount),
      netAmount: money(row.netAmount),
      displayedAmount: money(vatInclusive ? row.grossAmount : row.netAmount),
      shareOfRevenuePercent: percentOfRevenue(vatInclusive ? row.grossAmount : row.netAmount, revenue),
      evidence: cashEvidence(`sales:destination:${row.vaultId}`),
    })),
  };
}

type MappingChecksumStatementLine = Readonly<{ code: string }> & Readonly<Record<string, unknown>>;
type MappingChecksumAccountMapping = Readonly<{ accountId: string }> & Readonly<Record<string, unknown>>;
export type AccrualProfitLossMappingSnapshot = Readonly<{
  id: string;
  checksum: string;
  policyVersion: string;
  versionNumber: number;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  statementLines: readonly MappingChecksumStatementLine[];
  accountMappings: readonly MappingChecksumAccountMapping[];
}>;

/** Replays the exact checksum contract used when a mapping version is approved. */
export function calculateAccrualProfitLossMappingChecksum(value: Pick<AccrualProfitLossMappingSnapshot, 'versionNumber' | 'effectiveFrom' | 'effectiveTo' | 'statementLines' | 'accountMappings'>): string {
  return createHash('sha256').update(JSON.stringify({
    policyVersion: REPORTING_R0_A_POLICY_VERSION,
    versionNumber: value.versionNumber,
    effectiveFrom: value.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: value.effectiveTo?.toISOString().slice(0, 10) ?? null,
    statementLines: [...value.statementLines].sort((left, right) => left.code.localeCompare(right.code)),
    accountMappings: [...value.accountMappings].sort((left, right) => left.accountId.localeCompare(right.accountId)),
  })).digest('hex');
}

/** Official runs validate only their frozen mapping identity and immutable content. */
export function verifyAccrualProfitLossMappingSnapshot(snapshot: AccrualProfitLossMappingSnapshot, expected: Readonly<{ id: string; checksum: string }>): boolean {
  return snapshot.id === expected.id
    && snapshot.checksum === expected.checksum
    && snapshot.policyVersion === REPORTING_R0_A_POLICY_VERSION
    && calculateAccrualProfitLossMappingChecksum(snapshot) === expected.checksum;
}

/** Live reports additionally require every currently active revenue/expense account. */
export function hasCompleteAccrualProfitLossAccountCoverage(mappedAccountIds: readonly string[], activeRevenueExpenseAccountIds: readonly string[]): boolean {
  const mapped = new Set(mappedAccountIds);
  return activeRevenueExpenseAccountIds.every((accountId) => mapped.has(accountId));
}

function mappingChecksumContent(version: Mapping): AccrualProfitLossMappingSnapshot {
  return {
    id: version.id,
    checksum: version.checksum,
    policyVersion: version.policyVersion,
    versionNumber: version.versionNumber,
    effectiveFrom: version.effectiveFrom,
    effectiveTo: version.effectiveTo,
    statementLines: version.statementLines.map(({ accountMappings: _accountMappings, ...line }) => line as MappingChecksumStatementLine),
    accountMappings: version.statementLines.flatMap((line) => line.accountMappings.map(({ account: _account, ...mapping }) => mapping as MappingChecksumAccountMapping)),
  };
}

/** Payroll runs use a first-of-month accounting key, so coverage follows every month touched by the requested dates. */
export function accrualProfitLossPayrollMonthCoverageRange(request: Readonly<{ from: Date; to: Date }>): Readonly<{ from: Date; to: Date }> {
  return {
    from: firstUtcDayOfMonth(request.from),
    to: firstUtcDayOfMonth(request.to),
  };
}

export function accrualProfitLossCoverageForHistoricalPayrollRuns(historicalCashBasisPayrollRuns: number): AccrualProfitLossCoverage {
  if (!historicalCashBasisPayrollRuns) return { state: 'COMPLETE', sourceKind: 'sealed_ledger_revenue_expense_lines', warningAr: null, historicalCashBasisPayrollRuns: 0 };
  return {
    state: 'APPROVED_HISTORICAL_EXCEPTION',
    sourceKind: 'sealed_ledger_revenue_expense_lines',
    warningAr: `تتضمن الفترة ${historicalCashBasisPayrollRuns} مسيرات رواتب تاريخية معتمدة على الأساس النقدي؛ لذلك لا يُوصف جزء الرواتب كاستحقاق كامل.`,
    historicalCashBasisPayrollRuns,
  };
}

function coverageFromJson(value: Prisma.JsonValue): AccrualProfitLossCoverage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BadRequestException('The official P&L run has invalid coverage metadata.');
  const record = value as Record<string, unknown>;
  const state = record.state;
  const count = record.historicalCashBasisPayrollRuns;
  const warning = record.warningAr;
  if ((state !== 'COMPLETE' && state !== 'APPROVED_HISTORICAL_EXCEPTION') || record.sourceKind !== 'sealed_ledger_revenue_expense_lines' || !Number.isInteger(count) || (warning !== null && typeof warning !== 'string')) throw new BadRequestException('The official P&L run has invalid coverage metadata.');
  return { state, sourceKind: 'sealed_ledger_revenue_expense_lines', warningAr: warning as string | null, historicalCashBasisPayrollRuns: count as number };
}

/**
 * The ledger keeps the immutable source id, while readers need to know who
 * the money relates to.  Prefer the snapshot saved on the posted document so
 * later master-data edits cannot rewrite historical report evidence.
 */
function journalCounterparty(journal: {
  sourceType: string;
  outflowDocument?: { supplierNameSnapshotAr: string | null; supplierNameSnapshotEn: string | null; supplier: { nameAr: string; nameEn: string | null } | null } | null;
  hrEmployeeAdvanceIssue?: { employee: { nameAr: string; nameEn: string | null } } | null;
  hrEmployeeAdvanceSettlements?: readonly { advance: { employee: { nameAr: string; nameEn: string | null } } }[];
  hrFinalSettlementAccrual?: { employee: { nameAr: string; nameEn: string | null } } | null;
  hrFinalSettlementPayment?: { settlement: { employee: { nameAr: string; nameEn: string | null } } } | null;
}): Counterparty | null {
  const outflow = journal.outflowDocument;
  if (outflow) {
    const labelAr = outflow.supplierNameSnapshotAr ?? outflow.supplier?.nameAr ?? null;
    const labelEn = outflow.supplierNameSnapshotEn ?? outflow.supplier?.nameEn ?? null;
    if (labelAr) return { labelAr, labelEn: labelEn ?? labelAr };
  }
  const employee = journal.hrEmployeeAdvanceIssue?.employee
    ?? journal.hrEmployeeAdvanceSettlements?.[0]?.advance.employee
    ?? journal.hrFinalSettlementAccrual?.employee
    ?? journal.hrFinalSettlementPayment?.settlement.employee;
  if (employee) return { labelAr: employee.nameAr, labelEn: employee.nameEn ?? employee.nameAr };
  if (journal.sourceType === 'finance_vat_settlement') return { labelAr: 'هيئة الزكاة والضريبة والجمارك', labelEn: 'Zakat, Tax and Customs Authority' };
  if (journal.sourceType === 'daily_sales_closing') return { labelAr: 'عملاء ومبيعات الشركة', labelEn: 'Company customers and sales' };
  if (journal.sourceType === 'hr_payroll_accrual' || journal.sourceType === 'hr_payroll_payment') return { labelAr: 'موظفو الشركة', labelEn: 'Company employees' };
  return null;
}
function ledgerPredicate(context: TrustedCompanyActorContext, revision: bigint): Prisma.FinanceJournalEntryWhereInput {
  return { tenantId: context.tenantId, companyId: context.companyId, isSealed: true, status: { in: [FinanceJournalEntryStatus.POSTED, FinanceJournalEntryStatus.REVERSED] }, ledgerRevision: { lte: revision } };
}
export function calculateAccrualProfitLossTotals(rows: readonly Pick<StatementRow, 'section' | 'amount'>[]) {
  const revenue = rows.filter((row) => row.section === 'REVENUE').reduce((sum, row) => sum.plus(row.amount), zero());
  const expenses = rows.filter((row) => row.section === 'EXPENSE').reduce((sum, row) => sum.plus(row.amount), zero());
  return { revenue, expenses, netProfit: revenue.minus(expenses) };
}
const calculateTotals = calculateAccrualProfitLossTotals;
function sectionOrder(value: 'REVENUE' | 'EXPENSE') { return value === 'REVENUE' ? 0 : 1; }
function money(value: Prisma.Decimal) { return { raw: value.toFixed(4), display: value.abs().toFixed(2), sign: value.gt(0) ? 'positive' as const : value.lt(0) ? 'negative' as const : 'zero' as const }; }
function localizedFallback(value: string | null | undefined, fallback: string) { return value?.trim() || fallback; }
function zero() { return new Prisma.Decimal(0); }
function percentOfRevenue(value: Prisma.Decimal, revenue: Prisma.Decimal) {
  if (revenue.isZero()) return null;
  return value.abs().mul(100).div(revenue.abs()).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);
}
type MonthPeriod = Readonly<{ key: string; from: Date; to: Date }>;
function comparisonMonthPeriods(request: Required<Request>): readonly MonthPeriod[] {
  if (request.months.length) return request.months.map(monthBounds);
  const months: MonthPeriod[] = [];
  const cursor = firstUtcDayOfMonth(request.from);
  const last = firstUtcDayOfMonth(request.to);
  while (cursor <= last) {
    const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}`;
    const month = monthBounds(key);
    months.push({ key, from: month.from < request.from ? request.from : month.from, to: month.to > request.to ? request.to : month.to });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
function monthBounds(value: string) {
  const [year, month] = value.split('-').map(Number);
  return { key: value, from: new Date(Date.UTC(year!, month! - 1, 1)), to: new Date(Date.UTC(year!, month!, 0)) };
}
function journalPeriodPredicate(request: Required<Request>): Prisma.FinanceJournalEntryWhereInput {
  if (!request.months.length) return { businessDate: { gte: request.from, lte: request.to } };
  return { OR: request.months.map((month) => { const period = monthBounds(month); return { businessDate: { gte: period.from, lte: period.to } }; }) };
}
function payrollMonthPredicate(request: Required<Request>): Prisma.HrPayrollRunWhereInput {
  if (request.months.length) return { payrollMonth: { in: request.months.map((month) => monthBounds(month).from) } };
  const range = accrualProfitLossPayrollMonthCoverageRange(request);
  return { payrollMonth: { gte: range.from, lte: range.to } };
}
function firstUtcDayOfMonth(value: Date) { return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), 1)); }
function pnlEvidence(kind: 'REVENUE_TOTAL' | 'EXPENSES_TOTAL' | 'NET_PROFIT'): { reportCode: 'accrual_profit_loss'; metric: { kind: 'REVENUE_TOTAL' | 'EXPENSES_TOTAL' | 'NET_PROFIT' } };
function pnlEvidence(kind: 'STATEMENT_LINE', statementLineId: string): { reportCode: 'accrual_profit_loss'; metric: { kind: 'STATEMENT_LINE'; statementLineId: string } };
function pnlEvidence(kind: 'REVENUE_TOTAL' | 'EXPENSES_TOTAL' | 'NET_PROFIT' | 'STATEMENT_LINE', statementLineId?: string) {
  return kind === 'STATEMENT_LINE'
    ? { reportCode: 'accrual_profit_loss' as const, metric: { kind, statementLineId: statementLineId! } }
    : { reportCode: 'accrual_profit_loss' as const, metric: { kind } };
}
function cashEvidence(rowCode: string) { return { reportCode: 'personal_cash_performance' as const, metric: { kind: 'CASH_ROW' as const, rowCode } }; }
function pnlEvidenceTarget(target: string, mapping: Mapping) {
  if (target === 'NET_PROFIT') return (_item: AccrualEvidenceItem) => true;
  if (target === 'REVENUE_TOTAL') return (item: AccrualEvidenceItem) => item.section === 'REVENUE';
  if (target === 'EXPENSES_TOTAL') return (item: AccrualEvidenceItem) => item.section === 'EXPENSE';
  if (!mapping.statementLines.some((line) => !line.isSubtotal && line.id === target)) throw new BadRequestException('The accrual profit-and-loss evidence target is not available in this report.');
  return (item: AccrualEvidenceItem) => item.statementLineId === target;
}
function accrualEvidenceCursor(value: string) {
  const match = /^(\d{4}-\d{2}-\d{2}):([0-9a-f-]{36})$/i.exec(value);
  if (!match || !match[1] || !match[2]) throw new BadRequestException('The accrual profit-and-loss evidence cursor is invalid.');
  return { businessDate: match[1], journalEntryId: match[2] };
}
function days(request: Request) { return Math.floor((request.to.valueOf() - request.from.valueOf()) / 86_400_000) + 1; }
function dateText(value: Date) { return value.toISOString().slice(0, 10); }
function businessDate(value: string) { const date = new Date(`${value}T00:00:00.000Z`); if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('A valid YYYY-MM-DD business date is required.'); return date; }
