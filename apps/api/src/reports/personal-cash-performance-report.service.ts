import { BadRequestException, Injectable } from '@nestjs/common';
import { personalCashPerformanceRequestSchema } from '@baseer-erp/contracts';
import { randomUUID } from 'node:crypto';
import type { ReportLocale, ReportSnapshot } from '@baseer-erp/output-platform';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { BusinessDateService } from '../business-date/business-date.service.js';
import { DatabaseService } from '../database/database.service.js';
import {
  FinanceCashPerformanceDirection,
  FinanceCashPerformanceEventKind,
  Prisma,
} from '../generated/prisma/client.js';
import { financeJournalPresentation } from '../finance/finance-journal-presentation.js';
import { interactiveReportPeriodMessage, interactiveReportSourceMessage } from './interactive-report-limits.js';
import { ReportRunService } from './report-run.service.js';

const REPORT_CODE = 'personal_cash_performance';
/**
 * v2 deliberately reads the sealed ledger lines on configured vault accounts.
 * It is not an event-feed report: every real movement is visible even when a
 * future workflow has not added a reporting-specific writer yet.
 */
const DEFINITION_VERSION = 'actual_financial_movements_v4';
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

export type PersonalCashPerformanceRequest = Readonly<{
  from: Date;
  to: Date;
  months?: readonly string[];
  vatInclusive: boolean;
}>;

type EventForAggregation = Readonly<{
  id: string;
  kind: FinanceCashPerformanceEventKind;
  direction: FinanceCashPerformanceDirection;
  grossAmount: Prisma.Decimal;
  netAmount: Prisma.Decimal;
  vatBreakdownKnown: boolean;
  categoryCodeSnapshot: string | null;
  categoryNameArSnapshot: string | null;
  categoryNameEnSnapshot: string | null;
  settlementDestinationsJson: Prisma.JsonValue | null;
}>;

type VaultLabels = ReadonlyMap<string, Readonly<{ nameAr: string; nameEn: string }>>;

type AggregateRow = Readonly<{
  code: string;
  labelAr: string;
  labelEn: string;
  kind: 'SECTION' | 'LINE';
  parentCode: string | null;
  direction: FinanceCashPerformanceDirection;
  amount: Prisma.Decimal;
  eventCount: number;
}>;

/**
 * Server-side calculation for the owner's actual collection/payment view.
 * It reads immutable source events at a frozen report-run ledger revision;
 * client code receives display values only and never sums financial facts.
 */
@Injectable()
export class PersonalCashPerformanceReportService {
  constructor(
    private readonly database: DatabaseService,
    private readonly reportRuns: ReportRunService,
    private readonly dates: BusinessDateService,
  ) {}

  async run(context: TrustedCompanyActorContext, request: PersonalCashPerformanceRequest) {
    assertPeriod(request);
    const periodMessage = interactiveReportPeriodMessage(request.from, request.to, request.months);
    if (periodMessage) return unavailable('NOT_READY', periodMessage);
    const source = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [company, profile] = await Promise.all([
        transaction.company.findFirst({
          where: { id: context.companyId, tenantId: context.tenantId },
          select: { nameAr: true, nameEn: true, businessTimezone: true },
        }),
        transaction.companyFinanceProfile.findFirst({
          where: { companyId: context.companyId, tenantId: context.tenantId },
          select: { functionalCurrencyCode: true },
        }),
      ]);
      return { company, profile };
    });
    if (!source.company || !source.profile) {
      return unavailable('NOT_READY', 'هذا التقرير غير متاح بعد لأن إعداد الشركة المالي غير مكتمل.');
    }
    const readySource = { company: source.company, profile: source.profile };

    const ledgerRevision = await this.reportRuns.currentLedgerRevision(context);
    const sourceMessage = interactiveReportSourceMessage(await this.interactiveSourceLineCount(context, ledgerRevision, request));
    if (sourceMessage) return unavailable('NOT_READY', sourceMessage);
    const movements = await this.loadVaultMovements(context, ledgerRevision, request);
    if (!request.vatInclusive && movements.some((movement) => movement.requiresVatEvidence && !movement.vatBreakdownKnown)) {
      return unavailable(
        'COVERAGE_INCOMPLETE',
        'لا تكتمل تغطية المصدر للوضع غير الشامل للضريبة؛ توجد عمليات تحتاج فصلًا ضريبيًا موثوقًا.',
        { ledgerRevision: ledgerRevision.toString() },
      );
    }
    const eligible = request.vatInclusive ? movements : movements.filter((movement) => movement.group !== 'vat');
    if (eligible.length === 0) {
      return {
        state: 'NO_DATA' as const,
        messageAr: 'لا توجد حركات مؤهلة ضمن الفترة المحددة.',
        ...metadata(readySource, request, ledgerRevision),
        rows: [],
        vaults: [],
        totals: zeroTotals(),
      };
    }
    const aggregation = aggregateFinancialMovements(eligible);
    const salesCollections = aggregation.rows.find((row) => row.code === 'sales')?.amount ?? new Prisma.Decimal(0);
    return {
      state: 'READY' as const,
      ...metadata(readySource, request, ledgerRevision),
      rows: aggregation.rows.map((row) => ({
        code: row.code, labelAr: row.labelAr, labelEn: row.labelEn,
        kind: row.kind, parentCode: row.parentCode,
        direction: row.direction === FinanceCashPerformanceDirection.INFLOW ? 'INFLOW' : 'OUTFLOW',
        eventCount: row.eventCount,
        amount: money(row.amount),
        shareOfCollectedSalesPercent: percentOfSales(row.amount, salesCollections),
      })),
      vaults: aggregateVaultLedger(eligible).map((vault) => ({ vaultId: vault.vaultId, vaultNameAr: vault.vaultNameAr, vaultNameEn: vault.vaultNameEn, inflows: money(vault.inflows), outflows: money(vault.outflows), balance: money(vault.balance) })),
      totals: {
        inflows: money(aggregation.inflows),
        outflows: money(aggregation.outflows.negated()),
        netCashResult: money(aggregation.netCashResult),
        netCashResultShareOfCollectedSalesPercent: percentOfSales(aggregation.netCashResult, salesCollections),
      },
    };
  }

  /**
   * Read-only daily projection using the exact sealed-vault scope of the
   * financial-movement report. Amounts are positive display values; their
   * ledger source remains an outflow.
   */
  async dailyOutflows(context: TrustedCompanyActorContext, period: Readonly<{ from: Date; to: Date }>) {
    assertPeriod({ ...period, vatInclusive: true });
    const ledgerRevision = await this.reportRuns.currentLedgerRevision(context);
    const movements = await this.loadVaultMovements(context, ledgerRevision, { ...period, vatInclusive: true });
    const byBusinessDate = new Map<string, { amount: Prisma.Decimal; count: number; purchaseAmount: Prisma.Decimal; purchaseCount: number }>();
    for (const movement of movements) {
      if (movement.direction !== FinanceCashPerformanceDirection.OUTFLOW || !movement.amount.lt(0)) continue;
      const key = dateText(movement.businessDate);
      const current = byBusinessDate.get(key) ?? { amount: new Prisma.Decimal(0), count: 0, purchaseAmount: new Prisma.Decimal(0), purchaseCount: 0 };
      const isPurchase = movement.group === 'purchases';
      byBusinessDate.set(key, {
        amount: current.amount.plus(movement.amount.abs()), count: current.count + 1,
        purchaseAmount: isPurchase ? current.purchaseAmount.plus(movement.amount.abs()) : current.purchaseAmount,
        purchaseCount: isPurchase ? current.purchaseCount + 1 : current.purchaseCount,
      });
    }
    return byBusinessDate;
  }

  /** Creates the immutable boundary only when the caller is producing an official output. */
  async issueOfficialRun(context: TrustedCompanyActorContext, request: PersonalCashPerformanceRequest) {
    assertPeriod(request);
    return this.reportRuns.create(context, {
      reportCode: REPORT_CODE,
      definitionVersion: DEFINITION_VERSION,
      canonicalOptions: { from: dateText(request.from), to: dateText(request.to), ...(request.months?.length ? { months: request.months } : {}), vatInclusive: request.vatInclusive },
      economicAsOfDate: request.to,
      sourceCoverage: {
        state: 'SEALED_LEDGER_VAULT_LINES',
        inclusionRule: 'Every sealed journal line on a configured vault account, except an internal vault transfer.',
        vatMode: request.vatInclusive ? 'cash_gross' : 'invoice_net_excluding_vat_settlements',
      },
    });
  }

  async evidence(context: TrustedCompanyActorContext, reportRunId: string, rowCode: string, cursor?: string) {
    const run = await this.reportRuns.findReady(context, reportRunId);
    if (run.reportCode !== REPORT_CODE || run.definitionVersion !== DEFINITION_VERSION) throw new BadRequestException('The report run does not match personal cash performance.');
    const options = personalCashPerformanceRequestSchema.safeParse(run.canonicalOptionsJson);
    if (!options.success) throw new BadRequestException('The report run has invalid canonical options.');
    const request = { from: parseBusinessDate(options.data.from), to: parseBusinessDate(options.data.to), ...(options.data.months ? { months: options.data.months } : {}), vatInclusive: options.data.vatInclusive };
    return this.evidenceAtRevision(context, run.ledgerRevision, request, rowCode, cursor, run.id);
  }

  /** Used by interactive drill-downs. It intentionally has no report snapshot dependency. */
  async liveEvidence(context: TrustedCompanyActorContext, request: PersonalCashPerformanceRequest, rowCode: string, cursor?: string) {
    assertPeriod(request);
    const ledgerRevision = await this.reportRuns.currentLedgerRevision(context);
    const page = await this.evidenceAtRevision(context, ledgerRevision, request, rowCode, cursor);
    return page;
  }

  private async evidenceAtRevision(context: TrustedCompanyActorContext, ledgerRevision: bigint, request: PersonalCashPerformanceRequest, rowCode: string, cursor?: string, reportRunId?: string) {
    const parsedCursor = cursor ? evidenceCursor(cursor) : null;
    const movements = (await this.loadVaultMovements(context, ledgerRevision, request))
      .filter((movement) => request.vatInclusive || movement.group !== 'vat')
      .filter((movement) => movementMatchesRow(movement, rowCode))
      .sort((left, right) => dateText(left.businessDate).localeCompare(dateText(right.businessDate)) || left.id.localeCompare(right.id));
    if (parsedCursor && !movements.some((movement) => movement.id === parsedCursor.id && dateText(movement.businessDate) === dateText(parsedCursor.businessDate))) {
      throw new BadRequestException('The report evidence cursor is not available for this row.');
    }
    const afterCursor = parsedCursor ? movements.filter((movement) => dateText(movement.businessDate) > dateText(parsedCursor.businessDate) || (dateText(movement.businessDate) === dateText(parsedCursor.businessDate) && movement.id > parsedCursor.id)) : movements;
    const page = afterCursor.slice(0, 100);
    const final = page.at(-1);
    return {
      ...(reportRunId ? { reportRunId } : {}), rowCode,
      nextCursor: afterCursor.length > page.length && final ? `${dateText(final.businessDate)}:${final.id}` : null,
      items: page.map((movement) => {
        return {
          eventId: movement.id, businessDate: dateText(movement.businessDate),
          direction: movement.direction === FinanceCashPerformanceDirection.INFLOW ? 'INFLOW' : 'OUTFLOW',
          amount: money(movement.amount),
          source: {
            journalEntryId: movement.journalEntryId, labelAr: movement.sourceLabelAr, labelEn: movement.sourceLabelEn, reference: movement.sourceReference,
            origin: sourceOrigin(movement.sourceType),
          },
        };
      }),
    };
  }

  /** Builds a server-owned table snapshot from the selected immutable ledger boundary. */
  async snapshotForDocument(context: TrustedCompanyActorContext, reportRunId: string, locale: ReportLocale): Promise<ReportSnapshot> {
    const run = await this.reportRuns.findReady(context, reportRunId);
    const generatedAt = (await this.dates.currentForTrustedContext(context)).generatedAt;
    if (run.reportCode !== REPORT_CODE || run.definitionVersion !== DEFINITION_VERSION) throw new BadRequestException('The report run does not match personal cash performance.');
    const options = personalCashPerformanceRequestSchema.safeParse(run.canonicalOptionsJson);
    if (!options.success) throw new BadRequestException('The report run has invalid canonical options.');
    const request = { from: parseBusinessDate(options.data.from), to: parseBusinessDate(options.data.to), ...(options.data.months ? { months: options.data.months } : {}), vatInclusive: options.data.vatInclusive };
    const source = await this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const [company, profile] = await Promise.all([
        transaction.company.findFirst({ where: { id: context.companyId, tenantId: context.tenantId }, select: { id: true, nameAr: true, nameEn: true, businessTimezone: true } }),
        transaction.companyFinanceProfile.findFirst({ where: { companyId: context.companyId, tenantId: context.tenantId }, select: { functionalCurrencyCode: true } }),
      ]);
      return { company, profile };
    });
    if (!source.company || !source.profile) throw new BadRequestException('The company report source is unavailable.');
    const movements = await this.loadVaultMovements(context, run.ledgerRevision, request);
    if (!request.vatInclusive && movements.some((movement) => movement.requiresVatEvidence && !movement.vatBreakdownKnown)) throw new BadRequestException('The report cannot be issued without VAT because its source coverage is incomplete.');
    const aggregation = aggregateFinancialMovements(request.vatInclusive ? movements : movements.filter((movement) => movement.group !== 'vat'));
    const ar = locale === 'ar';
    const amount = (value: Prisma.Decimal) => value.toFixed(4);
    return {
      snapshotId: randomUUID(), reportCode: REPORT_CODE, templateVersion: DEFINITION_VERSION,
      title: ar ? 'الربح والخسارة المالي' : 'Financial profit and loss', direction: ar ? 'rtl' : 'ltr', locale,
      generatedAtRiyadh: generatedAt, companies: [{ id: source.company.id, name: ar ? source.company.nameAr : source.company.nameEn || source.company.nameAr }],
      periodLabel: request.months?.length ? request.months.join('، ') : `${dateText(request.from)} — ${dateText(request.to)}`,
      taxPresentation: request.vatInclusive ? 'gross' : 'taxSeparated',
      sourceLabel: ar
        ? `${request.vatInclusive ? 'الحركات المالية الفعلية — شامل الضريبة' : 'الحركات المالية الفعلية — بدون الضريبة'} · ${source.profile.functionalCurrencyCode} · ${source.company.businessTimezone} · التقريب: منزلتان للعرض · الإلغاء يظهر في تاريخ عمله`
        : `${request.vatInclusive ? 'Actual financial movements — VAT inclusive' : 'Actual financial movements — excluding VAT'} · ${source.profile.functionalCurrencyCode} · ${source.company.businessTimezone} · display rounding: 2 decimals · cancellations take effect on their business date`,
      columns: [{ key: 'item', label: ar ? 'البند' : 'Item', kind: 'text', width: 48 }, { key: 'amount', label: ar ? 'المبلغ' : 'Amount', kind: 'amount', width: 22 }],
      rows: [
        ...aggregation.rows.map((row) => ({ item: `${row.parentCode ? '— ' : ''}${ar ? row.labelAr : row.labelEn}`, amount: amount(row.amount), kind: row.kind === 'SECTION' ? 'section' : 'line' })),
        { item: ar ? 'نتيجة التحصيل والدفع الفعلية' : 'Actual collection and payment result', amount: amount(aggregation.netCashResult), kind: 'total' },
      ],
    };
  }

  async sourceJournal(context: TrustedCompanyActorContext, reportRunId: string, eventId: string) {
    const run = await this.reportRuns.findReady(context, reportRunId);
    if (run.reportCode !== REPORT_CODE || run.definitionVersion !== DEFINITION_VERSION) throw new BadRequestException('The report run does not match personal cash performance.');
    const options = personalCashPerformanceRequestSchema.safeParse(run.canonicalOptionsJson);
    if (!options.success) throw new BadRequestException('The report run has invalid canonical options.');
    const request = { from: parseBusinessDate(options.data.from), to: parseBusinessDate(options.data.to), ...(options.data.months ? { months: options.data.months } : {}), vatInclusive: options.data.vatInclusive };
    return this.sourceJournalAtRevision(context, run.ledgerRevision, request, eventId);
  }

  /** Opens a source from a live drill-down without first issuing an output snapshot. */
  async liveSourceJournal(context: TrustedCompanyActorContext, request: PersonalCashPerformanceRequest, eventId: string) {
    assertPeriod(request);
    return this.sourceJournalAtRevision(context, await this.reportRuns.currentLedgerRevision(context), request, eventId);
  }

  private async sourceJournalAtRevision(context: TrustedCompanyActorContext, ledgerRevision: bigint, request: PersonalCashPerformanceRequest, eventId: string) {
    const movement = (await this.loadVaultMovements(context, ledgerRevision, request)).find((candidate) => candidate.id === eventId && (request.vatInclusive || candidate.group !== 'vat'));
    if (!movement) throw new BadRequestException('The source movement is not available in this report run.');
    const journal = await this.database.inTenantTransaction(context.tenantId, (transaction) => transaction.financeJournalEntry.findFirst({
      where: { id: movement.journalEntryId, tenantId: context.tenantId, companyId: context.companyId, isSealed: true, status: { in: ['POSTED', 'REVERSED'] }, ledgerRevision: { lte: ledgerRevision } },
      select: {
        id: true, businessDate: true, sourceType: true, sourceReference: true, description: true, postedAt: true,
        ...journalPresentationSelect,
        reversalEntry: { select: { ledgerRevision: true } },
        lines: { orderBy: { lineNumber: 'asc' }, select: { id: true, lineNumber: true, debitAmount: true, creditAmount: true, description: true, account: { select: { code: true, nameAr: true, nameEn: true } } } },
      },
    }));
    if (!journal) throw new BadRequestException('The source journal is not available in this report run.');
    return {
      journalEntry: {
        id: journal.id, businessDate: dateText(journal.businessDate), sourceType: journal.sourceType, sourceReference: financeJournalPresentation(journal).reference, description: journal.description,
        status: journal.reversalEntry && journal.reversalEntry.ledgerRevision <= ledgerRevision ? 'REVERSED' as const : 'POSTED' as const, postedAt: journal.postedAt.toISOString(),
        lines: journal.lines.map((line) => ({ id: line.id, lineNumber: line.lineNumber, accountCode: line.account.code, accountNameAr: line.account.nameAr, accountNameEn: line.account.nameEn, debitAmount: line.debitAmount.toFixed(4), creditAmount: line.creditAmount.toFixed(4), description: line.description })),
      },
    };
  }

  private async loadVaultMovements(context: TrustedCompanyActorContext, ledgerRevision: bigint, request: PersonalCashPerformanceRequest): Promise<readonly VaultMovement[]> {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const vaults = await transaction.financeVault.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        select: { id: true, accountId: true, nameAr: true, nameEn: true },
      });
      const vaultAccountIds = new Set(vaults.map((vault) => vault.accountId));
      if (!vaultAccountIds.size) return [];
      const lines = await transaction.financeJournalLine.findMany({
        where: {
          tenantId: context.tenantId, companyId: context.companyId, accountId: { in: [...vaultAccountIds] },
          journalEntry: {
            tenantId: context.tenantId, companyId: context.companyId, isSealed: true,
            status: { in: ['POSTED', 'REVERSED'] }, ledgerRevision: { lte: ledgerRevision },
            ...journalPeriodPredicate(request),
          },
        },
        select: {
          id: true, accountId: true, debitAmount: true, creditAmount: true,
          journalEntry: {
            select: {
              id: true, businessDate: true, sourceType: true, sourceReference: true, description: true,
              ...journalPresentationSelect,
              lines: { select: { accountId: true } },
            },
          },
        },
        orderBy: [{ journalEntry: { businessDate: 'asc' } }, { id: 'asc' }],
      });
      const journalIds = [...new Set(lines.map((line) => line.journalEntry.id))];
      const [events, categories] = await Promise.all([
        journalIds.length ? transaction.financeCashPerformanceEvent.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId, sourceJournalEntryId: { in: journalIds }, ledgerRevision: { lte: ledgerRevision } },
          select: {
            sourceJournalEntryId: true, sourceId: true, kind: true, grossAmount: true, netAmount: true, vatBreakdownKnown: true,
            categoryCodeSnapshot: true, categoryNameArSnapshot: true, categoryNameEnSnapshot: true,
          },
        }) : [],
        transaction.financeCategory.findMany({
          where: { tenantId: context.tenantId, companyId: context.companyId },
          select: { id: true, parentId: true, code: true, nameAr: true, nameEn: true },
        }),
      ]);
      const recurringDocuments = events.length ? await transaction.financeOutflowDocument.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId, id: { in: events.map((event) => event.sourceId) }, recurringExpenseProfileId: { not: null } },
        select: { id: true },
      }) : [];
      const recurringDocumentIds = new Set(recurringDocuments.map((document) => document.id));
      const eventByJournal = new Map(events.map((event) => [event.sourceJournalEntryId, { ...event, isRecurringExpense: recurringDocumentIds.has(event.sourceId) }]));
      const categoryByCode = new Map(categories.map((category) => [category.code, category]));
      const categoryById = new Map(categories.map((category) => [category.id, category]));
      const vaultByAccount = new Map(vaults.map((vault) => [vault.accountId, vault]));
      return lines.flatMap((line) => {
        const entry = line.journalEntry;
        const original = entry.reversalOfEntry;
        const sourceType = original?.sourceType ?? entry.sourceType;
        if (sourceType === 'vault_transfer' || entry.lines.every((candidate) => vaultAccountIds.has(candidate.accountId))) return [];
        const rawAmount = line.debitAmount.minus(line.creditAmount);
        if (rawAmount.isZero()) return [];
        const event = eventByJournal.get(entry.id);
        const direction = rawAmount.gt(0) ? FinanceCashPerformanceDirection.INFLOW : FinanceCashPerformanceDirection.OUTFLOW;
        const group = movementGroup(sourceType, event?.kind, direction, event?.isRecurringExpense ?? false);
        if (!request.vatInclusive && group === 'vat') return [];
        const amount = !request.vatInclusive && event && event.grossAmount.gt(0) && operationalEvent(event.kind)
          ? rawAmount.mul(event.netAmount).div(event.grossAmount)
          : rawAmount;
        const vault = vaultByAccount.get(line.accountId)!;
        const source = movementSourcePresentation(sourceType, financeJournalPresentation(entry).reference, original?.description ?? entry.description, rawAmount.gt(0));
        return [{
          id: line.id, journalEntryId: entry.id, businessDate: entry.businessDate, vaultId: vault.id, vaultNameAr: vault.nameAr, vaultNameEn: vault.nameEn,
          group, direction,
          amount, sourceType, sourceLabelAr: source.labelAr, sourceLabelEn: source.labelEn, sourceReference: source.reference,
          categoryPath: categoryPathFor(event, categoryByCode, categoryById),
          requiresVatEvidence: operationalSource(sourceType), vatBreakdownKnown: event?.vatBreakdownKnown ?? !operationalSource(sourceType),
        } satisfies VaultMovement];
      });
    });
  }

  private async interactiveSourceLineCount(context: TrustedCompanyActorContext, ledgerRevision: bigint, request: PersonalCashPerformanceRequest): Promise<number> {
    return this.database.inTenantTransaction(context.tenantId, async (transaction) => {
      const vaults = await transaction.financeVault.findMany({
        where: { tenantId: context.tenantId, companyId: context.companyId },
        select: { accountId: true },
      });
      const accountIds = vaults.map((vault) => vault.accountId);
      if (!accountIds.length) return 0;
      return transaction.financeJournalLine.count({
        where: {
          tenantId: context.tenantId,
          companyId: context.companyId,
          accountId: { in: accountIds },
          journalEntry: {
            tenantId: context.tenantId,
            companyId: context.companyId,
            isSealed: true,
            status: { in: ['POSTED', 'REVERSED'] },
            ledgerRevision: { lte: ledgerRevision },
            ...journalPeriodPredicate(request),
          },
        },
      });
    });
  }
}

type MovementGroup = 'sales' | 'purchases' | 'expenses' | 'recurring_expenses' | 'employee_payments' | 'final_settlement' | 'vat' | 'other_inflows' | 'other_outflows';

export type VaultMovement = Readonly<{
  id: string;
  journalEntryId: string;
  businessDate: Date;
  vaultId: string;
  vaultNameAr: string;
  vaultNameEn: string;
  group: MovementGroup;
  sourceType: string;
  direction: FinanceCashPerformanceDirection;
  amount: Prisma.Decimal;
  sourceLabelAr: string;
  sourceLabelEn: string;
  sourceReference: string;
  categoryPath: CategoryPath | null;
  requiresVatEvidence: boolean;
  vatBreakdownKnown: boolean;
}>;

type CategoryNode = Readonly<{ code: string; labelAr: string; labelEn: string }>;
type CategoryPath = Readonly<{ parent: CategoryNode | null; leaf: CategoryNode }>;
type FinancialMovementRow = {
  code: string; labelAr: string; labelEn: string; kind: 'SECTION' | 'LINE'; parentCode: string | null;
  direction: FinanceCashPerformanceDirection; amount: Prisma.Decimal; eventCount: number;
};

/**
 * Keeps the operational statement as one tree. Purchases and expenses may use
 * the configured category hierarchy; every other group keeps its direct child
 * presentation. The client can therefore switch between two and three levels
 * without changing the report result, totals, or evidence scope.
 */
export function aggregateFinancialMovements(movements: readonly VaultMovement[]) {
  const rows = new Map<string, FinancialMovementRow>();
  let inflows = new Prisma.Decimal(0);
  let outflows = new Prisma.Decimal(0);
  const addAmount = (presentation: Omit<FinancialMovementRow, 'amount' | 'eventCount'>, amount: Prisma.Decimal) => {
    const existing = rows.get(presentation.code);
    if (existing) {
      existing.amount = existing.amount.plus(amount);
      existing.eventCount += 1;
    } else rows.set(presentation.code, { ...presentation, amount, eventCount: 1 });
  };
  const ensure = (presentation: Omit<FinancialMovementRow, 'amount' | 'eventCount'>) => {
    if (!rows.has(presentation.code)) rows.set(presentation.code, { ...presentation, amount: new Prisma.Decimal(0), eventCount: 0 });
  };
  for (const movement of movements) {
    const parent = movementPresentation(movement.group, movement.direction);
    const presentation = movementRowPath(movement, parent.code);
    for (const intermediate of presentation.slice(0, -1)) ensure({ ...intermediate, kind: 'LINE', direction: movement.direction });
    const leaf = presentation.at(-1)!;
    addAmount({ ...leaf, kind: 'LINE', direction: movement.direction }, movement.amount);
    if (movement.amount.gt(0)) inflows = inflows.plus(movement.amount); else outflows = outflows.plus(movement.amount);
  }
  // Roll up category rows before their root sections. A category has only its
  // descendants' amount; it is not another financial movement.
  for (const row of [...rows.values()].sort((left, right) => rowDepth(right, rows) - rowDepth(left, rows))) {
    const children = [...rows.values()].filter((candidate) => candidate.parentCode === row.code);
    if (!children.length) continue;
    row.amount = children.reduce((sum, child) => sum.plus(child.amount), new Prisma.Decimal(0));
    row.eventCount = children.reduce((sum, child) => sum + child.eventCount, 0);
  }
  for (const parent of FINANCIAL_MOVEMENT_PARENTS) {
    const children = [...rows.values()].filter((row) => row.parentCode === parent.code);
    if (!children.length) continue;
    const amount = children.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0));
    rows.set(parent.code, { ...parent, direction: amount.gte(0) ? FinanceCashPerformanceDirection.INFLOW : FinanceCashPerformanceDirection.OUTFLOW, amount, eventCount: children.reduce((sum, row) => sum + row.eventCount, 0) });
  }
  const ordered: FinancialMovementRow[] = [];
  const visit = (parentCode: string | null) => {
    const children = [...rows.values()]
      .filter((row) => row.parentCode === parentCode)
      .sort((left, right) => parentCode === null
        ? financialMovementSortRank(left.code) - financialMovementSortRank(right.code)
        : left.labelAr.localeCompare(right.labelAr, 'ar'));
    for (const child of children) { ordered.push(child); visit(child.code); }
  };
  visit(null);
  return { rows: ordered, inflows, outflows, netCashResult: inflows.plus(outflows) };
}

function aggregateVaultLedger(movements: readonly VaultMovement[]) {
  const vaults = new Map<string, { vaultId: string; vaultNameAr: string; vaultNameEn: string; inflows: Prisma.Decimal; outflows: Prisma.Decimal; balance: Prisma.Decimal }>();
  for (const movement of movements) {
    const current = vaults.get(movement.vaultId) ?? { vaultId: movement.vaultId, vaultNameAr: movement.vaultNameAr, vaultNameEn: movement.vaultNameEn, inflows: new Prisma.Decimal(0), outflows: new Prisma.Decimal(0), balance: new Prisma.Decimal(0) };
    if (movement.amount.gte(0)) current.inflows = current.inflows.plus(movement.amount); else current.outflows = current.outflows.plus(movement.amount.negated());
    current.balance = current.balance.plus(movement.amount); vaults.set(movement.vaultId, current);
  }
  return [...vaults.values()].sort((left, right) => left.vaultNameAr.localeCompare(right.vaultNameAr, 'ar'));
}

const FINANCIAL_MOVEMENT_PARENTS = [
  { code: 'sales', labelAr: 'المبيعات المحصّلة', labelEn: 'Sales collections', kind: 'SECTION' as const, parentCode: null },
  { code: 'purchases', labelAr: 'المشتريات المدفوعة', labelEn: 'Paid purchases', kind: 'SECTION' as const, parentCode: null },
  { code: 'expenses', labelAr: 'المصروفات المدفوعة', labelEn: 'Paid expenses', kind: 'SECTION' as const, parentCode: null },
  { code: 'recurring_expenses', labelAr: 'المصروفات الدورية المدفوعة', labelEn: 'Paid recurring expenses', kind: 'SECTION' as const, parentCode: null },
  { code: 'employee_payments', labelAr: 'رواتب وسلف الموظفين', labelEn: 'Employee payroll and advances', kind: 'SECTION' as const, parentCode: null },
  { code: 'final_settlement', labelAr: 'مستحقات نهاية الخدمة المدفوعة', labelEn: 'Paid final settlements', kind: 'SECTION' as const, parentCode: null },
  { code: 'vat', labelAr: 'الضريبة المسددة أو المستردة', labelEn: 'VAT paid or refunded', kind: 'SECTION' as const, parentCode: null },
  { code: 'other_inflows', labelAr: 'حركات مالية داخلة أخرى', labelEn: 'Other financial inflows', kind: 'SECTION' as const, parentCode: null },
  { code: 'other_outflows', labelAr: 'حركات مالية خارجة أخرى', labelEn: 'Other financial outflows', kind: 'SECTION' as const, parentCode: null },
] as const;

function movementPresentation(group: MovementGroup, direction: FinanceCashPerformanceDirection) {
  return FINANCIAL_MOVEMENT_PARENTS.find((parent) => parent.code === group)!
    ?? FINANCIAL_MOVEMENT_PARENTS.find((parent) => parent.code === (direction === FinanceCashPerformanceDirection.INFLOW ? 'other_inflows' : 'other_outflows'))!;
}

function movementGroup(sourceType: string, eventKind: FinanceCashPerformanceEventKind | undefined, direction: FinanceCashPerformanceDirection, isRecurringExpense: boolean): MovementGroup {
  if (sourceType === 'daily_sales_closing') return 'sales';
  if (sourceType === 'finance_vat_settlement') return 'vat';
  if (sourceType === 'hr_employee_advance' || sourceType === 'hr_employee_advance_receipt' || sourceType === 'hr_payroll_payment') return 'employee_payments';
  if (sourceType === 'hr_final_settlement_payment') return 'final_settlement';
  if (eventKind === FinanceCashPerformanceEventKind.PURCHASE_PAYMENT) return 'purchases';
  if (eventKind === FinanceCashPerformanceEventKind.OPERATING_EXPENSE_PAYMENT) return isRecurringExpense ? 'recurring_expenses' : 'expenses';
  if (sourceType === 'finance_outflow_document') return 'expenses';
  return direction === FinanceCashPerformanceDirection.INFLOW ? 'other_inflows' : 'other_outflows';
}

function operationalEvent(kind: FinanceCashPerformanceEventKind) {
  return kind === FinanceCashPerformanceEventKind.SALES_COLLECTION
    || kind === FinanceCashPerformanceEventKind.PURCHASE_PAYMENT
    || kind === FinanceCashPerformanceEventKind.OPERATING_EXPENSE_PAYMENT;
}

function operationalSource(sourceType: string) {
  return sourceType === 'daily_sales_closing' || sourceType === 'finance_outflow_document';
}

function movementMatchesRow(movement: VaultMovement, rowCode: string) {
  if (rowCode === 'net_cash_result') return true;
  const parent = movementPresentation(movement.group, movement.direction).code;
  return rowCode === parent || movementRowPath(movement, parent).some((row) => row.code === rowCode);
}

function movementRowPath(movement: VaultMovement, parentCode: string): readonly Omit<FinancialMovementRow, 'amount' | 'eventCount' | 'direction' | 'kind'>[] {
  if ((movement.group === 'purchases' || movement.group === 'expenses' || movement.group === 'recurring_expenses') && movement.categoryPath) {
    const root = movement.categoryPath.parent ?? movement.categoryPath.leaf;
    const category = { code: `${parentCode}:category:${root.code}`, labelAr: root.labelAr, labelEn: root.labelEn, parentCode };
    if (!movement.categoryPath.parent) return [category];
    const leaf = movement.categoryPath.leaf;
    return [category, { code: `${category.code}:item:${leaf.code}`, labelAr: leaf.labelAr, labelEn: leaf.labelEn, parentCode: category.code }];
  }
  return [movementChildPresentation(movement, parentCode)];
}

function movementChildPresentation(movement: VaultMovement, parentCode: string): Omit<FinancialMovementRow, 'amount' | 'eventCount' | 'direction' | 'kind'> {
  if (movement.group === 'employee_payments') {
    if (movement.sourceLabelAr.includes('سلفة')) {
      const issue = movement.sourceLabelAr.includes('صرف');
      return issue
        ? { code: `${parentCode}:advance_issue`, labelAr: 'سلف موظفين مصروفة', labelEn: 'Employee advances issued', parentCode }
        : { code: `${parentCode}:advance_recovery`, labelAr: 'سلف موظفين مستردة', labelEn: 'Employee advances recovered', parentCode };
    }
    return { code: `${parentCode}:payroll`, labelAr: 'صافي الرواتب المدفوعة', labelEn: 'Net payroll paid', parentCode };
  }
  return { code: `${parentCode}:vault:${movement.vaultId}`, labelAr: movement.vaultNameAr, labelEn: movement.vaultNameEn, parentCode };
}

function rowDepth(row: Pick<FinancialMovementRow, 'parentCode'>, rows: ReadonlyMap<string, FinancialMovementRow>) {
  let depth = 1;
  let parentCode = row.parentCode;
  const seen = new Set<string>();
  while (parentCode && !seen.has(parentCode)) {
    seen.add(parentCode);
    depth += 1;
    parentCode = rows.get(parentCode)?.parentCode ?? null;
  }
  return depth;
}

function categoryPathFor(
  event: Pick<EventForAggregation, 'categoryCodeSnapshot' | 'categoryNameArSnapshot' | 'categoryNameEnSnapshot'> | undefined,
  categoryByCode: ReadonlyMap<string, { id: string; parentId: string | null; code: string; nameAr: string; nameEn: string }>,
  categoryById: ReadonlyMap<string, { id: string; parentId: string | null; code: string; nameAr: string; nameEn: string }>,
): CategoryPath | null {
  const code = event?.categoryCodeSnapshot?.trim();
  if (!code) return null;
  const category = categoryByCode.get(code);
  const leaf: CategoryNode = {
    code,
    labelAr: event?.categoryNameArSnapshot?.trim() || category?.nameAr || 'غير مصنف',
    labelEn: event?.categoryNameEnSnapshot?.trim() || category?.nameEn || 'Unclassified',
  };
  const parent = category?.parentId ? categoryById.get(category.parentId) : null;
  return { leaf, parent: parent ? { code: parent.code, labelAr: parent.nameAr, labelEn: parent.nameEn } : null };
}

function financialMovementSortRank(code: string) {
  const parent = code.split(':')[0]!;
  const index = FINANCIAL_MOVEMENT_PARENTS.findIndex((item) => item.code === parent);
  return (index < 0 ? 99 : index) * 10 + (code.includes(':') ? 1 : 0);
}

function movementSourcePresentation(sourceType: string, sourceReference: string, description: string | null, inflow: boolean) {
  if (sourceType === 'daily_sales_closing') {
    const document = description?.match(/Daily sales closing\s+([A-Z]+-\d{8}-\d{4})/i)?.[1] ?? sourceReference;
    return { labelAr: inflow ? 'تحصيل مبيعات' : 'إلغاء تحصيل مبيعات', labelEn: inflow ? 'Sales collection' : 'Cancelled sales collection', reference: document };
  }
  const labels: Record<string, readonly [string, string]> = {
    finance_outflow_document: ['فاتورة مشتريات أو مصروف', 'Purchase or expense invoice'],
    supplier_due_payment: ['سداد التزام مورد', 'Supplier due payment'],
    finance_vat_settlement: [inflow ? 'استرداد ضريبة' : 'سداد ضريبة', inflow ? 'VAT refund' : 'VAT payment'],
    hr_payroll_payment: [inflow ? 'إلغاء دفع رواتب' : 'دفع رواتب', inflow ? 'Cancelled payroll payment' : 'Payroll payment'],
    hr_employee_advance: [inflow ? 'إلغاء صرف سلفة موظف' : 'صرف سلفة موظف', inflow ? 'Cancelled employee advance issue' : 'Employee advance issue'],
    hr_employee_advance_receipt: [inflow ? 'استرداد سلفة موظف' : 'إلغاء استرداد سلفة موظف', inflow ? 'Employee advance repayment' : 'Cancelled employee advance repayment'],
    hr_final_settlement_payment: ['دفع نهاية خدمة', 'Final settlement payment'],
    inclusive_loan_repayment: [inflow ? 'تحصيل سداد قرض' : 'سداد قرض', inflow ? 'Loan repayment collection' : 'Loan repayment'],
  };
  const [labelAr, labelEn] = labels[sourceType] ?? [inflow ? 'حركة مالية داخلة' : 'حركة مالية خارجة', inflow ? 'Financial inflow' : 'Financial outflow'];
  return { labelAr, labelEn, reference: sourceReference };
}

/** The source journal is always available in the evidence dialog.  This route
 * additionally returns the operational screen that owns the transaction. */
function sourceOrigin(sourceType: string) {
  const origins: Record<string, { labelAr: string; labelEn: string; route: string }> = {
    daily_sales_closing: { labelAr: 'العمليات ← المبيعات', labelEn: 'Operations → Sales', route: '#module=operations&page=operations-sales' },
    finance_outflow_document: { labelAr: 'العمليات ← المشتريات', labelEn: 'Operations → Purchasing', route: '#module=operations&page=operations-purchases' },
    supplier_due_payment: { labelAr: 'العمليات ← المصروفات والالتزامات', labelEn: 'Operations → Expenses & obligations', route: '#module=operations&page=operations-expenses-obligations&stage=history' },
    finance_vat_settlement: { labelAr: 'التقارير ← التقرير الضريبي', labelEn: 'Reports → VAT report', route: '#module=reports&page=reports-vat' },
    hr_payroll_payment: { labelAr: 'الموارد البشرية ← الرواتب', labelEn: 'Human resources → Payroll', route: '#module=hr&page=hr-payroll' },
    hr_employee_advance: { labelAr: 'الموارد البشرية ← السلف والخصومات', labelEn: 'Human resources → Advances & deductions', route: '#module=hr&page=hr-advances-deductions' },
    hr_employee_advance_receipt: { labelAr: 'الموارد البشرية ← السلف والخصومات', labelEn: 'Human resources → Advances & deductions', route: '#module=hr&page=hr-advances-deductions' },
    hr_final_settlement_payment: { labelAr: 'الموارد البشرية ← الرواتب', labelEn: 'Human resources → Payroll', route: '#module=hr&page=hr-payroll' },
  };
  return origins[sourceType] ?? { labelAr: 'المالية والمحاسبة ← السجل المالي الموحد', labelEn: 'Finance & accounting → Unified financial register', route: '#module=finance&page=finance-ledger' };
}

export function aggregateCashPerformanceEvents(events: readonly EventForAggregation[], vatInclusive: boolean, vaultLabels: VaultLabels = new Map()) {
  const rows = new Map<string, { code: string; labelAr: string; labelEn: string; kind: 'SECTION' | 'LINE'; parentCode: string | null; direction: FinanceCashPerformanceDirection; amount: Prisma.Decimal; eventCount: number }>();
  let inflows = new Prisma.Decimal(0);
  let outflows = new Prisma.Decimal(0);
  const add = (rowIdentity: Omit<AggregateRow, 'amount' | 'eventCount'>, amount: Prisma.Decimal) => {
    const existing = rows.get(rowIdentity.code);
    if (existing) {
      existing.amount = existing.amount.plus(amount);
      existing.eventCount += 1;
    } else {
      rows.set(rowIdentity.code, { ...rowIdentity, amount, eventCount: 1 });
    }
  };
  for (const event of events) {
    if (!vatInclusive && !isOperational(event.kind)) continue;
    const amount = vatInclusive ? event.grossAmount : event.netAmount;
    const signed = event.direction === FinanceCashPerformanceDirection.INFLOW ? amount : amount.negated();
    add(presentationFor(event), signed);
    if (event.kind === FinanceCashPerformanceEventKind.SALES_COLLECTION) {
      for (const destination of salesDestinationPresentation(event, amount, vaultLabels)) add(destination, event.direction === FinanceCashPerformanceDirection.INFLOW ? destination.amount : destination.amount.negated());
    }
    if (signed.gte(0)) inflows = inflows.plus(signed); else outflows = outflows.plus(signed);
  }
  for (const group of statementGroups) {
    const children = [...rows.values()].filter((row) => row.parentCode === group.code);
    if (!children.length) continue;
    rows.set(group.code, { ...group, amount: children.reduce((sum, row) => sum.plus(row.amount), new Prisma.Decimal(0)), eventCount: children.reduce((sum, row) => sum + row.eventCount, 0) });
  }
  const sorted = [...rows.values()].sort((left, right) => sortRank(left.code) - sortRank(right.code) || left.labelAr.localeCompare(right.labelAr, 'ar'));
  const salesCollections = rows.get('sales_collections')?.amount ?? new Prisma.Decimal(0);
  return { rows: sorted satisfies readonly AggregateRow[], inflows, outflows, netCashResult: inflows.plus(outflows), salesCollections };
}

function presentationFor(event: EventForAggregation) {
  switch (event.kind) {
    case FinanceCashPerformanceEventKind.SALES_COLLECTION:
      return { code: 'sales_collections', labelAr: 'المبيعات المحصّلة', labelEn: 'Sales collections', kind: 'SECTION' as const, parentCode: null, direction: FinanceCashPerformanceDirection.INFLOW };
    case FinanceCashPerformanceEventKind.PURCHASE_PAYMENT:
      return categoryPresentation('purchases', 'المشتريات المدفوعة', 'Paid purchases', event, FinanceCashPerformanceDirection.OUTFLOW);
    case FinanceCashPerformanceEventKind.OPERATING_EXPENSE_PAYMENT:
      return categoryPresentation('expenses', 'المصروفات المدفوعة', 'Paid operating expenses', event, FinanceCashPerformanceDirection.OUTFLOW);
    case FinanceCashPerformanceEventKind.VAT_PAYMENT:
      return { code: 'vat_payment', labelAr: 'ضريبة مدفوعة', labelEn: 'VAT paid', kind: 'SECTION' as const, parentCode: null, direction: FinanceCashPerformanceDirection.OUTFLOW };
    case FinanceCashPerformanceEventKind.VAT_REFUND:
      return { code: 'vat_refund', labelAr: 'استرداد ضريبة', labelEn: 'VAT refund', kind: 'SECTION' as const, parentCode: null, direction: FinanceCashPerformanceDirection.INFLOW };
  }
}

function salesDestinationPresentation(event: EventForAggregation, reportAmount: Prisma.Decimal, vaultLabels: VaultLabels) {
  const destinations = parsedDestinations(event.settlementDestinationsJson);
  const destinationTotal = destinations.reduce((sum, destination) => sum.plus(destination.amount), new Prisma.Decimal(0));
  // Do not manufacture a channel split if the persisted destination evidence
  // does not reconcile to the collected source amount.
  if (!destinations.length || !destinationTotal.equals(event.grossAmount) || event.grossAmount.lte(0)) return [];
  return destinations.map((destination) => {
    const label = vaultLabels.get(destination.vaultId);
    return {
      code: `sales:destination:${destination.vaultId}`,
      labelAr: label?.nameAr || paymentMethodLabel(destination.paymentMethod, 'ar'),
      labelEn: label?.nameEn || paymentMethodLabel(destination.paymentMethod, 'en'),
      kind: 'LINE' as const,
      parentCode: 'sales_collections',
      direction: FinanceCashPerformanceDirection.INFLOW,
      amount: reportAmount.mul(destination.amount).div(event.grossAmount),
    };
  });
}

function parsedDestinations(value: Prisma.JsonValue | null) {
  if (!Array.isArray(value)) return [] as { vaultId: string; paymentMethod: string; amount: Prisma.Decimal }[];
  const destinations: { vaultId: string; paymentMethod: string; amount: Prisma.Decimal }[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.vaultId !== 'string' || !/^[0-9a-f-]{36}$/i.test(candidate.vaultId) || typeof candidate.paymentMethod !== 'string' || typeof candidate.amount !== 'string') continue;
    try {
      const amount = new Prisma.Decimal(candidate.amount);
      if (amount.gt(0) && amount.decimalPlaces()! <= 4) destinations.push({ vaultId: candidate.vaultId, paymentMethod: candidate.paymentMethod, amount });
    } catch { /* Ignore malformed historical destination evidence. */ }
  }
  return destinations;
}

function paymentMethodLabel(method: string, language: 'ar' | 'en') {
  const labels: Record<string, readonly [string, string]> = {
    CASH: ['نقد', 'Cash'], BANK_TRANSFER: ['تحويل بنكي', 'Bank transfer'], BANK_CARD: ['بطاقة بنكية', 'Bank card'], BANK_PAYMENT: ['دفع بنكي', 'Bank payment'], APP: ['تطبيق', 'App'],
  };
  return labels[method]?.[language === 'ar' ? 0 : 1] ?? (language === 'ar' ? 'قناة تحصيل' : 'Collection channel');
}

function categoryPresentation(prefix: string, fallbackAr: string, fallbackEn: string, event: EventForAggregation, direction: FinanceCashPerformanceDirection) {
  const categoryCode = event.categoryCodeSnapshot?.trim();
  return {
    code: categoryCode ? `${prefix}:${categoryCode}` : `${prefix}:uncategorized`,
    labelAr: event.categoryNameArSnapshot?.trim() || fallbackAr,
    labelEn: event.categoryNameEnSnapshot?.trim() || fallbackEn,
    kind: 'LINE' as const,
    parentCode: prefix,
    direction,
  };
}
const statementGroups = [
  { code: 'purchases', labelAr: 'المشتريات المدفوعة', labelEn: 'Paid purchases', kind: 'SECTION' as const, parentCode: null, direction: FinanceCashPerformanceDirection.OUTFLOW },
  { code: 'expenses', labelAr: 'مصروفات التشغيل المدفوعة', labelEn: 'Paid operating expenses', kind: 'SECTION' as const, parentCode: null, direction: FinanceCashPerformanceDirection.OUTFLOW },
] as const;
function sortRank(code: string): number {
  if (code === 'sales_collections') return 10;
  if (code.startsWith('sales:destination:')) return 11;
  if (code === 'vat_refund') return 20;
  if (code === 'purchases') return 30;
  if (code.startsWith('purchases:')) return 31;
  if (code === 'expenses') return 40;
  if (code.startsWith('expenses:')) return 41;
  if (code === 'vat_payment') return 50;
  return 100;
}
function isOperational(kind: FinanceCashPerformanceEventKind): boolean {
  return kind === FinanceCashPerformanceEventKind.SALES_COLLECTION
    || kind === FinanceCashPerformanceEventKind.PURCHASE_PAYMENT
    || kind === FinanceCashPerformanceEventKind.OPERATING_EXPENSE_PAYMENT;
}
function metadata(source: { company: { nameAr: string; nameEn: string; businessTimezone: string }; profile: { functionalCurrencyCode: string } }, request: PersonalCashPerformanceRequest, ledgerRevision: bigint) {
  return {
    reportCode: REPORT_CODE, definitionVersion: DEFINITION_VERSION,
    dataMode: 'LIVE' as const, ledgerRevision: ledgerRevision.toString(),
    company: { displayName: source.company.nameAr || source.company.nameEn, functionalCurrency: source.profile.functionalCurrencyCode },
    businessTimezone: source.company.businessTimezone,
    selectedPeriod: { from: dateText(request.from), to: dateText(request.to), ...(request.months?.length ? { months: request.months } : {}) },
    basisLabelAr: request.vatInclusive ? 'الربح والخسارة المالي — شامل الضريبة' : 'الربح والخسارة المالي — بدون الضريبة',
    vatInclusive: request.vatInclusive,
    cancellationTreatmentAr: 'يبقى الأصل في تاريخ العملية ويظهر أثر الإلغاء في تاريخ إلغاء العمل.',
    dataCoverage: { state: 'COMPLETE', sourceKind: 'sealed_ledger_vault_lines' },
    roundingRule: 'Amounts are calculated to four decimal places and rounded to two decimal places for display.',
  };
}
function unavailable(state: 'NOT_READY' | 'COVERAGE_INCOMPLETE', messageAr: string, extra: Record<string, unknown> = {}) { return { state, messageAr, ...extra }; }
function zeroTotals() { const zero = money(new Prisma.Decimal(0)); return { inflows: zero, outflows: zero, netCashResult: zero, netCashResultShareOfCollectedSalesPercent: null }; }
function money(value: Prisma.Decimal) {
  const sign = value.gt(0) ? 'positive' : value.lt(0) ? 'negative' : 'zero';
  return { raw: value.toFixed(4), display: value.abs().toFixed(2), sign };
}
export function percentOfSales(value: Prisma.Decimal, salesCollections: Prisma.Decimal): string | null {
  if (salesCollections.lte(0)) return null;
  return value.abs().mul(100).div(salesCollections).toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP).toFixed(4);
}
function rowPredicate(rowCode: string): Prisma.FinanceCashPerformanceEventWhereInput {
  if (rowCode === 'net_cash_result') return { kind: { in: [FinanceCashPerformanceEventKind.SALES_COLLECTION, FinanceCashPerformanceEventKind.PURCHASE_PAYMENT, FinanceCashPerformanceEventKind.OPERATING_EXPENSE_PAYMENT, FinanceCashPerformanceEventKind.VAT_PAYMENT, FinanceCashPerformanceEventKind.VAT_REFUND] } };
  if (rowCode === 'sales_collections') return { kind: FinanceCashPerformanceEventKind.SALES_COLLECTION };
  const salesDestination = /^sales:destination:([0-9a-f-]{36})$/i.exec(rowCode);
  if (salesDestination) return {
    kind: FinanceCashPerformanceEventKind.SALES_COLLECTION,
    settlementDestinationsJson: { array_contains: [{ vaultId: salesDestination[1] }] },
  };
  if (rowCode === 'vat_payment') return { kind: FinanceCashPerformanceEventKind.VAT_PAYMENT };
  if (rowCode === 'vat_refund') return { kind: FinanceCashPerformanceEventKind.VAT_REFUND };
  const match = /^(purchases|expenses|recurring_expenses)(?::([A-Za-z0-9_-]+))?$/.exec(rowCode);
  if (!match) throw new BadRequestException('The report row is not available for evidence.');
  const kind = match[1]! === 'purchases' ? FinanceCashPerformanceEventKind.PURCHASE_PAYMENT : FinanceCashPerformanceEventKind.OPERATING_EXPENSE_PAYMENT;
  const categoryCode = match[2];
  if (!categoryCode) return { kind };
  return { kind, ...(categoryCode === 'uncategorized' ? { categoryCodeSnapshot: null } : { categoryCodeSnapshot: categoryCode }) };
}
function evidenceCursor(value: string): { businessDate: Date; id: string } {
  const match = /^(\d{4}-\d{2}-\d{2}):([0-9a-f-]{36})$/i.exec(value);
  if (!match) throw new BadRequestException('An evidence cursor is invalid.');
  return { businessDate: parseBusinessDate(match[1]!), id: match[2]! };
}
function parseBusinessDate(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!dateOnly(date) || dateText(date) !== value) throw new BadRequestException('A report run has an invalid business date.');
  return date;
}
function evidencePresentation(sourceType: string, sourceReference: string, description: string | null, direction: FinanceCashPerformanceDirection) {
  if (sourceType === 'daily_sales_closing') {
    const documentNumber = description?.match(/Daily sales closing\s+([A-Z]+-\d{8}-\d{4})/i)?.[1] ?? sourceReference;
    return { labelAr: direction === FinanceCashPerformanceDirection.INFLOW ? 'تحصيل مبيعات' : 'إلغاء تحصيل مبيعات', labelEn: direction === FinanceCashPerformanceDirection.INFLOW ? 'Sales collection' : 'Cancelled sales collection', reference: documentNumber };
  }
  if (sourceType === 'finance_outflow_document') return { labelAr: 'فاتورة مشتريات أو مصروف', labelEn: 'Purchase or expense invoice', reference: sourceReference };
  if (sourceType === 'supplier_due_payment') return { labelAr: 'سداد التزام مورد', labelEn: 'Supplier due payment', reference: sourceReference };
  if (sourceType === 'finance_vat_settlement') return { labelAr: direction === FinanceCashPerformanceDirection.INFLOW ? 'استرداد ضريبة' : 'سداد ضريبة', labelEn: direction === FinanceCashPerformanceDirection.INFLOW ? 'VAT refund' : 'VAT payment', reference: sourceReference };
  return { labelAr: direction === FinanceCashPerformanceDirection.INFLOW ? 'عملية محصّلة' : 'عملية مدفوعة', labelEn: direction === FinanceCashPerformanceDirection.INFLOW ? 'Collected operation' : 'Paid operation', reference: sourceReference };
}
function assertPeriod(request: PersonalCashPerformanceRequest): void {
  if (!dateOnly(request.from) || !dateOnly(request.to) || request.from > request.to) throw new BadRequestException('A valid inclusive business-date range is required.');
  if (request.months && (!request.months.length || request.months.some((month) => !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)))) throw new BadRequestException('Selected report months are invalid.');
}

function periodPredicate(request: Pick<PersonalCashPerformanceRequest, 'from' | 'to' | 'months'>): Prisma.FinanceCashPerformanceEventWhereInput {
  if (!request.months?.length) return { businessDate: { gte: request.from, lte: request.to } };
  return { OR: request.months.map((month) => ({ businessDate: monthRange(month) })) };
}
function journalPeriodPredicate(request: Pick<PersonalCashPerformanceRequest, 'from' | 'to' | 'months'>): Prisma.FinanceJournalEntryWhereInput {
  if (!request.months?.length) return { businessDate: { gte: request.from, lte: request.to } };
  return { OR: request.months.map((month) => ({ businessDate: monthRange(month) })) };
}

function monthRange(month: string) {
  const [yearText, monthText] = month.split('-');
  const year = Number(yearText); const monthNumber = Number(monthText);
  const from = new Date(Date.UTC(year, monthNumber - 1, 1));
  const to = new Date(Date.UTC(year, monthNumber, 0));
  return { gte: from, lte: to };
}
function dateOnly(value: Date): boolean { return value instanceof Date && !Number.isNaN(value.valueOf()) && value.getUTCHours() === 0 && value.getUTCMinutes() === 0 && value.getUTCSeconds() === 0 && value.getUTCMilliseconds() === 0; }
function dateText(value: Date): string { return value.toISOString().slice(0, 10); }
