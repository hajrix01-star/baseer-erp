import type { FinancialEvidenceDescriptor } from '@baseer-erp/contracts';
import { BadRequestException, Injectable } from '@nestjs/common';

import type { TrustedCompanyActorContext } from '../core-controls/trusted-context.js';
import { AccrualProfitLossReportService } from './accrual-profit-loss-report.service.js';
import { InternalVatReportService } from './internal-vat-report.service.js';
import { LedgerTrialBalanceReportService } from './ledger-trial-balance-report.service.js';
import { PersonalCashPerformanceReportService } from './personal-cash-performance-report.service.js';

/**
 * One boundary for interactive financial drill-downs.  Each report retains
 * its own accounting predicate, but callers receive one evidence/source
 * shape and never choose a report-specific endpoint themselves.
 */
@Injectable()
export class FinancialEvidenceRegistryService {
  constructor(
    private readonly cash: PersonalCashPerformanceReportService,
    private readonly profitLoss: AccrualProfitLossReportService,
    private readonly trialBalance: LedgerTrialBalanceReportService,
    private readonly vat: InternalVatReportService,
  ) {}

  async liveEvidence(context: TrustedCompanyActorContext, request: LiveEvidenceRequest) {
    if (request.descriptor.reportCode === 'personal_cash_performance') {
      const page = await this.cash.liveEvidence(context, reportPeriod(request), request.descriptor.metric.rowCode, request.cursor);
      return {
        descriptor: request.descriptor,
        nextCursor: page.nextCursor,
        items: page.items.map((item) => ({
          evidenceId: item.eventId,
          businessDate: item.businessDate,
          amount: item.amount,
          source: {
            journalEntryId: item.source.journalEntryId,
            labelAr: item.source.labelAr,
            labelEn: item.source.labelEn,
            reference: item.source.reference,
            description: null,
            counterparty: item.source.counterparty ?? null,
          },
        })),
      };
    }

    if (request.descriptor.reportCode === 'ledger_trial_balance') {
      const target = request.descriptor.metric.kind === 'TRIAL_ACCOUNT'
        ? { accountId: request.descriptor.metric.accountId, scope: request.descriptor.metric.scope, side: request.descriptor.metric.side }
        : { scope: request.descriptor.metric.scope, side: request.descriptor.metric.side };
      const page = await this.trialBalance.liveEvidence(context, { from: request.from, to: request.to, includeZeroRows: false }, target, request.cursor);
      return {
        descriptor: request.descriptor,
        nextCursor: page.nextCursor,
        items: page.items.map((item) => ({
          evidenceId: item.lineId, businessDate: item.businessDate, amount: item.amount,
          source: { journalEntryId: item.journalEntryId, labelAr: item.labelAr, labelEn: item.labelEn, reference: item.reference, description: item.description, counterparty: null },
        })),
      };
    }

    if (request.descriptor.reportCode === 'internal_vat_report') {
      const target = request.descriptor.metric.kind === 'VAT_ROW' ? request.descriptor.metric.rowCode : 'VAT_NET';
      const page = await this.vat.liveEvidence(context, vatPeriod(request), target, request.cursor);
      return {
        descriptor: request.descriptor,
        nextCursor: page.nextCursor,
        items: page.items.map((item) => ({
          evidenceId: item.lineId, businessDate: item.businessDate, amount: item.amount,
          source: { journalEntryId: item.journalEntryId, labelAr: item.labelAr, labelEn: item.labelEn, reference: item.reference, description: null, counterparty: null },
        })),
      };
    }

    const page = await this.profitLoss.liveEvidence(context, reportPeriod(request), profitLossTarget(request.descriptor), request.cursor);
    return {
      descriptor: request.descriptor,
      nextCursor: page.nextCursor,
      items: page.items.map((item) => ({
        evidenceId: item.journalEntryId,
        businessDate: item.businessDate,
        amount: item.amount,
        source: {
          journalEntryId: item.journalEntryId,
          labelAr: item.source.labelAr,
          labelEn: item.source.labelEn,
          reference: item.source.reference,
          description: item.source.description,
          counterparty: item.source.counterparty,
        },
      })),
    };
  }

  async liveSource(context: TrustedCompanyActorContext, request: Omit<LiveEvidenceRequest, 'cursor'>, journalEntryId: string) {
    const source = request.descriptor.reportCode === 'personal_cash_performance'
      ? await this.cash.liveSourceJournalByJournalEntry(context, reportPeriod(request), journalEntryId)
      : request.descriptor.reportCode === 'accrual_profit_loss'
        ? await this.profitLoss.liveSourceJournal(context, reportPeriod(request), journalEntryId)
        : request.descriptor.reportCode === 'ledger_trial_balance'
          ? await this.trialBalance.liveSource(
            context,
            { from: request.from, to: request.to, includeZeroRows: false },
            request.descriptor.metric.kind === 'TRIAL_ACCOUNT'
              ? { accountId: request.descriptor.metric.accountId, scope: request.descriptor.metric.scope, side: request.descriptor.metric.side }
              : { scope: request.descriptor.metric.scope, side: request.descriptor.metric.side },
            journalEntryId,
          )
          : await this.vat.liveSource(
            context,
            vatPeriod(request),
            request.descriptor.metric.kind === 'VAT_ROW' ? request.descriptor.metric.rowCode : 'VAT_NET',
            journalEntryId,
          );
    const journal = source.journalEntry;
    return {
      journalEntry: {
        id: journal.id,
        businessDate: journal.businessDate,
        labelAr: journal.labelAr,
        labelEn: journal.labelEn,
        sourceReference: journal.sourceReference,
        description: journal.description,
        counterparty: journal.counterparty ?? null,
        status: journal.status,
        lines: journal.lines.map((line) => ({
          id: line.id,
          lineNumber: line.lineNumber,
          accountCode: line.accountCode,
          accountNameAr: line.accountNameAr,
          accountNameEn: line.accountNameEn,
          debit: line.debit,
          credit: line.credit,
          description: line.description,
        })),
      },
    };
  }
}

export type LiveEvidenceRequest = Readonly<{
  descriptor: FinancialEvidenceDescriptor;
  from: Date;
  to: Date;
  months?: readonly string[];
  vatInclusive: boolean;
  cursor?: string;
}>;

function reportPeriod(request: Omit<LiveEvidenceRequest, 'descriptor' | 'cursor'> | LiveEvidenceRequest) {
  return {
    from: request.from,
    to: request.to,
    ...(request.months?.length ? { months: request.months } : {}),
    vatInclusive: request.vatInclusive,
  };
}

function vatPeriod(request: Omit<LiveEvidenceRequest, 'descriptor' | 'cursor'> | LiveEvidenceRequest) {
  return {
    from: request.from,
    to: request.to,
    ...(request.months?.length ? { months: request.months } : {}),
  };
}

function profitLossTarget(descriptor: Extract<FinancialEvidenceDescriptor, { reportCode: 'accrual_profit_loss' }>) {
  switch (descriptor.metric.kind) {
    case 'STATEMENT_LINE': return descriptor.metric.statementLineId;
    case 'REVENUE_TOTAL': return 'REVENUE_TOTAL';
    case 'EXPENSES_TOTAL': return 'EXPENSES_TOTAL';
    case 'NET_PROFIT': return 'NET_PROFIT';
    default: throw new BadRequestException('The financial evidence metric is not supported.');
  }
}
