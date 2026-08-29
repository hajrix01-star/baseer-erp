import { BadRequestException, Body, Controller, ForbiddenException, Get, Headers, HttpCode, Param, Post, Query, UnauthorizedException, UseGuards } from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { companyIdSchema, personalCashPerformanceCoverageRequestSchema, personalCashPerformanceEvidenceQuerySchema, personalCashPerformanceEvidenceReceiptSchema, personalCashPerformanceLiveEvidenceReceiptSchema, personalCashPerformanceRequestSchema, personalCashPerformanceResultSchema, personalCashPerformanceSourceReceiptSchema } from '@baseer-erp/contracts';

import { CompanyContextService } from '../company-context/company-context.service.js';
import { CashPerformanceCoverageService } from './cash-performance-coverage.service.js';
import { PersonalCashPerformanceReportService } from './personal-cash-performance-report.service.js';
import { REPORTS_READ_CAPABILITY } from './report-catalog.service.js';

const CASH_PERFORMANCE_ACTIVATE_CAPABILITY = 'reports.cash_performance.activate';

@Controller('reports')
@UseGuards(ThrottlerGuard)
@SkipThrottle({ authIp: true, authIdentity: true, output: true, fileWrite: true, attendancePin: true })
@Throttle({ report: { limit: 60, ttl: 60_000, blockDuration: 60_000 } })
export class ReportsController {
  constructor(
    private readonly companyContexts: CompanyContextService,
    private readonly coverage: CashPerformanceCoverageService,
    private readonly cashPerformance: PersonalCashPerformanceReportService,
  ) {}

  @Post('personal-cash-performance/coverage')
  @HttpCode(200)
  async activateCoverage(
    @Body() body: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const parsed = personalCashPerformanceCoverageRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException('Invalid report coverage request.');
    const start = parseDate(parsed.data.coverageStartBusinessDate);
    return this.coverage.activate(await this.context(authorization, companyId, CASH_PERFORMANCE_ACTIVATE_CAPABILITY), start);
  }

  @Get('personal-cash-performance')
  async personalCashPerformance(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Query('months') months: string | undefined,
    @Query('vatInclusive') vatInclusive: string | undefined,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const request = personalCashPerformanceRequestSchema.safeParse({ from, to, ...(months ? { months: months.split(',') } : {}), vatInclusive: parseBoolean(vatInclusive, true) });
    if (!request.success) throw new BadRequestException('Invalid personal cash-performance report request.');
    return personalCashPerformanceResultSchema.parse(await this.cashPerformance.run(
      await this.context(authorization, companyId, REPORTS_READ_CAPABILITY),
      { from: parseDate(request.data.from), to: parseDate(request.data.to), ...(request.data.months ? { months: request.data.months } : {}), vatInclusive: request.data.vatInclusive },
    ));
  }

  @Get('personal-cash-performance/live/evidence')
  async personalCashPerformanceLiveEvidence(
    @Query() query: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const request = liveEvidenceRequest(query);
    const parsed = personalCashPerformanceEvidenceQuerySchema.safeParse({ rowCode: query.rowCode, ...(typeof query.cursor === 'string' ? { cursor: query.cursor } : {}) });
    if (!parsed.success) throw new BadRequestException('Invalid live report evidence request.');
    return personalCashPerformanceLiveEvidenceReceiptSchema.parse(await this.cashPerformance.liveEvidence(
      await this.context(authorization, companyId, REPORTS_READ_CAPABILITY), request, parsed.data.rowCode, parsed.data.cursor,
    ));
  }

  @Get('personal-cash-performance/live/evidence/:eventId/source')
  async personalCashPerformanceLiveSource(
    @Param('eventId') eventId: string,
    @Query() query: Record<string, unknown>,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    if (!companyIdSchema.safeParse(eventId).success) throw new BadRequestException('Invalid report source event.');
    return personalCashPerformanceSourceReceiptSchema.parse(await this.cashPerformance.liveSourceJournal(
      await this.context(authorization, companyId, REPORTS_READ_CAPABILITY), liveEvidenceRequest(query), eventId,
    ));
  }

  // Static live routes must be registered before :reportRunId so Fastify
  // never interprets the literal "live" as a saved report-run identifier.
  @Get('personal-cash-performance/:reportRunId/evidence')
  async personalCashPerformanceEvidence(
    @Param('reportRunId') reportRunId: string,
    @Query() query: unknown,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    const parsed = personalCashPerformanceEvidenceQuerySchema.safeParse(query);
    if (!parsed.success) throw new BadRequestException('Invalid report evidence request.');
    return personalCashPerformanceEvidenceReceiptSchema.parse(await this.cashPerformance.evidence(
      await this.context(authorization, companyId, REPORTS_READ_CAPABILITY), reportRunId, parsed.data.rowCode, parsed.data.cursor,
    ));
  }

  @Get('personal-cash-performance/:reportRunId/evidence/:eventId/source')
  async personalCashPerformanceSource(
    @Param('reportRunId') reportRunId: string,
    @Param('eventId') eventId: string,
    @Headers('authorization') authorization?: string,
    @Headers('x-baseer-company-id') companyId?: string,
  ) {
    if (!companyIdSchema.safeParse(eventId).success) throw new BadRequestException('Invalid report source event.');
    return personalCashPerformanceSourceReceiptSchema.parse(await this.cashPerformance.sourceJournal(
      await this.context(authorization, companyId, REPORTS_READ_CAPABILITY), reportRunId, eventId,
    ));
  }

  private async context(authorization: string | undefined, companyId: string | undefined, capability: string) {
    const accessToken = /^Bearer\s+(.+)$/i.exec(authorization ?? '')?.[1];
    if (!accessToken) throw new UnauthorizedException('Invalid authentication credentials.');
    if (!companyId) throw new ForbiddenException('Company report scope is not permitted.');
    const authorized = await this.companyContexts.authorize({ accessToken, companyId, requiredCapabilities: [capability] });
    return { tenantId: authorized.principal.tenantId, companyId: authorized.company.id, actorUserId: authorized.principal.userId };
  }
}

function parseDate(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new BadRequestException('A valid YYYY-MM-DD business date is required.');
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('A valid YYYY-MM-DD business date is required.');
  return date;
}
function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new BadRequestException('vatInclusive must be true or false.');
}
function liveEvidenceRequest(query: Record<string, unknown>) {
  const months = Array.isArray(query.months) ? query.months : typeof query.months === 'string' ? query.months.split(',').filter(Boolean) : undefined;
  const request = personalCashPerformanceRequestSchema.safeParse({
    from: query.from,
    to: query.to,
    ...(months?.length ? { months } : {}),
    vatInclusive: parseBoolean(typeof query.vatInclusive === 'string' ? query.vatInclusive : undefined, true),
  });
  if (!request.success) throw new BadRequestException('Invalid live report evidence request.');
  return { from: parseDate(request.data.from), to: parseDate(request.data.to), ...(request.data.months ? { months: request.data.months } : {}), vatInclusive: request.data.vatInclusive };
}
