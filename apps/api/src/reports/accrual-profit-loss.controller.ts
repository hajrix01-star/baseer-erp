import { accrualProfitLossEvidenceQuerySchema, accrualProfitLossEvidenceReceiptSchema, accrualProfitLossRequestSchema, accrualProfitLossResultSchema, accrualProfitLossSourceJournalSchema } from '@baseer-erp/contracts';
import { BadRequestException, Controller, ForbiddenException, Get, Headers, Param, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { AccrualProfitLossReportService } from './accrual-profit-loss-report.service.js';
import { REPORTS_READ_CAPABILITY } from './report-catalog.service.js';

@Controller('reports/accrual-profit-loss')
@UseGuards(ThrottlerGuard)
@SkipThrottle({ authIp: true, authIdentity: true, output: true, fileWrite: true, attendancePin: true })
@Throttle({ report: { limit: 60, ttl: 60_000, blockDuration: 60_000 } })
export class AccrualProfitLossController {
  constructor(
    private readonly contexts: CompanyContextService,
    private readonly report: AccrualProfitLossReportService,
  ) {}

  @Get('live/evidence')
  async evidence(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('months') months: string | undefined,
    @Query('vatInclusive') vatInclusive: string | undefined,
    @Query('target') target: string | undefined,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const parsed = accrualProfitLossEvidenceQuerySchema.safeParse({ from, to, ...(months ? { months: months.split(',') } : {}), vatInclusive: parseBoolean(vatInclusive, false), target });
    if (!parsed.success) throw new BadRequestException('Invalid accrual profit-and-loss evidence request.');
    return accrualProfitLossEvidenceReceiptSchema.parse(await this.report.liveEvidence(
      await this.context(authorization, companyId),
      { from: businessDate(parsed.data.from), to: businessDate(parsed.data.to), ...(parsed.data.months ? { months: parsed.data.months } : {}), vatInclusive: parsed.data.vatInclusive },
      parsed.data.target,
    ));
  }

  @Get('live/evidence/:journalEntryId/source')
  async evidenceSource(
    @Param('journalEntryId') journalEntryId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('months') months: string | undefined,
    @Query('vatInclusive') vatInclusive: string | undefined,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const parsed = accrualProfitLossRequestSchema.safeParse({ from, to, ...(months ? { months: months.split(',') } : {}), vatInclusive: parseBoolean(vatInclusive, false) });
    if (!parsed.success) throw new BadRequestException('Invalid accrual profit-and-loss source request.');
    return accrualProfitLossSourceJournalSchema.parse(await this.report.liveSourceJournal(
      await this.context(authorization, companyId),
      { from: businessDate(parsed.data.from), to: businessDate(parsed.data.to), ...(parsed.data.months ? { months: parsed.data.months } : {}), vatInclusive: parsed.data.vatInclusive },
      journalEntryId,
    ));
  }

  @Get()
  async run(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('months') months: string | undefined,
    @Query('vatInclusive') vatInclusive: string | undefined,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const parsed = accrualProfitLossRequestSchema.safeParse({ from, to, ...(months ? { months: months.split(',') } : {}), vatInclusive: parseBoolean(vatInclusive, false) });
    if (!parsed.success) throw new BadRequestException('Invalid accrual profit-and-loss request.');
    return accrualProfitLossResultSchema.parse(await this.report.run(
      await this.context(authorization, companyId),
      { from: businessDate(parsed.data.from), to: businessDate(parsed.data.to), ...(parsed.data.months ? { months: parsed.data.months } : {}), vatInclusive: parsed.data.vatInclusive },
    ));
  }

  private async context(authorization: string | undefined, companyId: string | undefined) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    if (!companyId) throw new ForbiddenException('Company report scope is not permitted.');
    const authorized = await this.contexts.authorize({ accessToken, companyId, requiredCapabilities: [REPORTS_READ_CAPABILITY] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException('vatInclusive must be true or false.');
}

function businessDate(value: string) {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('Invalid business date.');
  return date;
}
