import { BadRequestException, Body, Controller, ForbiddenException, Headers, HttpCode, Post, UnauthorizedException, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { officialReportRunReceiptSchema, officialReportRunRequestSchema } from '@baseer-erp/contracts';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { InternalVatReportService } from './internal-vat-report.service.js';
import { LedgerTrialBalanceReportService } from './ledger-trial-balance-report.service.js';
import { PersonalCashPerformanceReportService } from './personal-cash-performance-report.service.js';
import { REPORTS_READ_CAPABILITY } from './report-catalog.service.js';

/**
 * Explicit boundary issuer for print, Excel and saved report documents.
 * Interactive GET report endpoints never call this controller or persist a
 * ReportRun; the client must opt into an official output first.
 */
@Controller('reports/official-runs')
@UseGuards(ThrottlerGuard)
@SkipThrottle({ authIp: true, authIdentity: true, report: true, fileWrite: true })
@Throttle({ output: { limit: 20, ttl: 60_000, blockDuration: 60_000 } })
export class OfficialReportRunsController {
  constructor(
    private readonly contexts: CompanyContextService,
    private readonly cashPerformance: PersonalCashPerformanceReportService,
    private readonly trialBalance: LedgerTrialBalanceReportService,
    private readonly internalVat: InternalVatReportService,
  ) {}

  @Post()
  @HttpCode(201)
  async issue(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const parsed = officialReportRunRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid official report-run request.');
    const context = await this.context(authorization, companyId, parsed.data.purpose);
    const receipt = await this.create(context, parsed.data);
    return officialReportRunReceiptSchema.parse({
      ...receipt,
      reportCode: parsed.data.reportCode,
      definitionVersion: definitionVersion(parsed.data.reportCode),
      expiresAt: receipt.expiresAt.toISOString(),
    });
  }

  private create(
    context: { tenantId: string; companyId: string; actorUserId: string },
    input: typeof officialReportRunRequestSchema._output,
  ) {
    switch (input.reportCode) {
      case 'personal_cash_performance':
        return this.cashPerformance.issueOfficialRun(context, { from: businessDate(input.request.from), to: businessDate(input.request.to), ...(input.request.months ? { months: input.request.months } : {}), vatInclusive: input.request.vatInclusive });
      case 'ledger_trial_balance':
        return this.trialBalance.issueOfficialRun(context, { from: businessDate(input.request.from), to: businessDate(input.request.to), includeZeroRows: input.request.includeZeroRows });
      case 'internal_vat_report':
        return this.internalVat.issueOfficialRun(context, { from: businessDate(input.request.from), to: businessDate(input.request.to), ...(input.request.months ? { months: input.request.months } : {}) });
    }
  }

  private async context(authorization: string | undefined, companyId: string | undefined, purpose: 'evidence' | 'preview' | 'xlsx' | 'save') {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    if (!companyId) throw new ForbiddenException('Company report scope is not permitted.');
    const additional = purpose === 'preview' ? ['platform.output.preview'] : purpose === 'xlsx' ? ['platform.output.export'] : [];
    const authorized = await this.contexts.authorize({ accessToken, companyId, requiredCapabilities: [REPORTS_READ_CAPABILITY, ...additional] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}

function businessDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Invalid business date.');
  return date;
}

function definitionVersion(reportCode: 'personal_cash_performance' | 'ledger_trial_balance' | 'internal_vat_report') {
  switch (reportCode) {
    case 'personal_cash_performance': return 'actual_financial_movements_v4';
    case 'ledger_trial_balance': return 'ledger_trial_balance_v1';
    case 'internal_vat_report': return 'internal_vat_report_v1';
  }
}
